"""
DisruptIQ V2 — Storage Layer (BR-012 compliant)

Implements Swarm Memory + Audit Log + Event Records.
Backed by Azure Cosmos DB in production. Falls back to in-memory store
in DEMO_MODE so the app runs without any cloud setup.

Memory writes are append-only (BR-012, NFR-06). Two-stage writes:
  Stage 1 — at event completion (predictions + selected option)
  Stage 2 — at event resolution (actuals + learning signal)
"""

import json
import logging
import os as _os
import time
import uuid
from typing import Optional
from datetime import datetime, timezone

import config
from seed_data import (
    SEED_MEMORY, CASCADE_ZONE_MAP, SUPPLIERS,
    SEED_STAGE2_MEMORY, SEED_COUNTERFACTUALS, SEED_EVENTS,
)

logger = logging.getLogger("disruptiq.storage")

# Cosmos health surfaced via GET /health so silent persistence failures are visible.
_cosmos_health: dict = {"status": "unknown", "last_error": None, "last_error_at": None}


def get_cosmos_health() -> dict:
    return dict(_cosmos_health)

# ─── In-memory fallback stores (used in DEMO_MODE) ───────────────────────────
# SEED_STAGE2_MEMORY provides stage-2 (resolved) records for R-09 report data.
_mem_swarm_memory: list[dict] = list(SEED_MEMORY) + list(SEED_STAGE2_MEMORY)
_mem_audit_log: list[dict] = []
# SEED_EVENTS provides historical events with simulation + HIL data for R-05.
_mem_events: dict[str, dict] = dict(SEED_EVENTS)
_mem_active_events: list[dict] = []
_mem_nl_queries: list[dict] = []
# SEED_COUNTERFACTUALS provides explicit counterfactual records for R-05.
_mem_counterfactuals: list[dict] = list(SEED_COUNTERFACTUALS)
_mem_config_events: list[dict] = []
_pipeline_metrics: list[dict] = []

# ─── Cosmos client (lazy) ────────────────────────────────────────────────────
_cosmos_client = None
_cosmos_db = None
_cosmos_containers: dict = {}


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _now_unix() -> float:
    return time.time()


def _infer_client_id(event_id: str | None = None, explicit_client_id: str | None = None) -> str | None:
    if explicit_client_id:
        return explicit_client_id
    if not event_id:
        return None
    if event_id.startswith("registration_"):
        return event_id.replace("registration_", "", 1)
    if event_id.startswith("password_change_"):
        return event_id.replace("password_change_", "", 1)
    if event_id.startswith("password_reset_"):
        return event_id.replace("password_reset_", "", 1)
    event = _mem_events.get(event_id)
    if event:
        return event.get("client_id")
    return None


def _get_cosmos():
    """Lazy Cosmos initialization. Returns None if not configured or in demo mode."""
    global _cosmos_client, _cosmos_db, _cosmos_containers
    if config.DEMO_MODE or not config.is_real_cosmos():
        return None
    if _cosmos_client is not None:
        return _cosmos_containers
    try:
        from azure.cosmos import CosmosClient, PartitionKey
        _cosmos_client = CosmosClient(config.COSMOS_ENDPOINT, credential=config.COSMOS_KEY)
        _cosmos_db = _cosmos_client.create_database_if_not_exists(id=config.COSMOS_DATABASE)
        for name in [config.COSMOS_CONTAINER_MEMORY, config.COSMOS_CONTAINER_AUDIT, config.COSMOS_CONTAINER_EVENTS]:
            _cosmos_containers[name] = _get_or_create_container(_cosmos_db, PartitionKey, name)
        for name in [config.COSMOS_CONTAINER_PREMIUM, config.COSMOS_CONTAINER_SUPPORT, config.COSMOS_CONTAINER_FEEDBACK]:
            try:
                c = _cosmos_db.get_container_client(name)
                c.read()
                _cosmos_containers[name] = c
            except Exception:
                _cosmos_containers[name] = _cosmos_db.create_container_if_not_exists(
                    id=name, partition_key=PartitionKey(path="/id"))
        # Seed memory + stage-2 memory on first run (for R-05/R-09 data)
        try:
            existing = list(_cosmos_containers[config.COSMOS_CONTAINER_MEMORY].read_all_items(max_item_count=1))
            if not existing:
                # Seed Stage-1 memory (original SEED_MEMORY)
                for rec in SEED_MEMORY:
                    _cosmos_containers[config.COSMOS_CONTAINER_MEMORY].create_item(
                        body={**rec, "id": rec["memory_id"]}
                    )
                # Seed Stage-2 memory (resolved events for R-09 data)
                for rec in SEED_STAGE2_MEMORY:
                    _cosmos_containers[config.COSMOS_CONTAINER_MEMORY].create_item(
                        body={**rec, "id": rec["memory_id"]}
                    )
        except Exception as e:
            logger.error("Cosmos memory seed write failed: %s: %s", type(e).__name__, e, exc_info=True)

        # Seed counterfactuals on first run (for R-05 data)
        try:
            existing_cf = list(_cosmos_containers[config.COSMOS_CONTAINER_CF].read_all_items(max_item_count=1))
            if not existing_cf:
                for rec in SEED_COUNTERFACTUALS:
                    _cosmos_containers[config.COSMOS_CONTAINER_CF].create_item(
                        body={**rec, "id": rec["counterfactual_id"]}
                    )
        except Exception as e:
            logger.error("Cosmos counterfactuals seed write failed: %s: %s", type(e).__name__, e, exc_info=True)
        _cosmos_health["status"] = "healthy"
        _cosmos_health["last_error"] = None
        return _cosmos_containers
    except Exception as e:
        logger.error("Cosmos init failed, falling back to in-memory: %s", e, exc_info=True)
        _cosmos_health["status"] = "error"
        _cosmos_health["last_error"] = str(e)[:200]
        _cosmos_health["last_error_at"] = _now_utc()
        return None


def _get_or_create_container(db, partition_key_cls, name: str):
    """Prefer existing containers and avoid forcing new dedicated throughput on constrained accounts."""
    try:
        container = db.get_container_client(name)
        container.read()
        return container
    except Exception:
        try:
            return db.create_container_if_not_exists(
                id=name,
                partition_key=partition_key_cls(path="/event_id"),
            )
        except Exception:
            return db.create_container_if_not_exists(
                id=name,
                partition_key=partition_key_cls(path="/event_id"),
                offer_throughput=400,
            )


# ═══════════════════════════════════════════════════════════════════════════
# AUDIT LOG (NFR-09 — observability, BR-012 — append-only)
# ═══════════════════════════════════════════════════════════════════════════

def write_audit(event_id: str, agent: str, action: str,
                input_summary: str = "", output_summary: str = "",
                status: str = "OK", client_id: str | None = None):
    record = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "client_id": _infer_client_id(event_id, client_id),
        "agent": agent,
        "action": action,
        "input_summary": str(input_summary)[:500],
        "output_summary": str(output_summary)[:500],
        "status": status,
        "timestamp_utc": _now_utc(),
    }
    cont = _get_cosmos()
    if cont:
        try:
            cont[config.COSMOS_CONTAINER_AUDIT].create_item(body=record)
        except Exception:
            _mem_audit_log.append(record)
    else:
        _mem_audit_log.append(record)


def get_audit_log(limit: int = 200) -> list[dict]:
    cont = _get_cosmos()
    if cont:
        try:
            items = list(cont[config.COSMOS_CONTAINER_AUDIT].query_items(
                query="SELECT * FROM c ORDER BY c.timestamp_utc DESC OFFSET 0 LIMIT @limit",
                parameters=[{"name": "@limit", "value": limit}],
                enable_cross_partition_query=True,
            ))
            return items
        except Exception:
            pass
    return list(reversed(_mem_audit_log[-limit:]))


# ═══════════════════════════════════════════════════════════════════════════
# SWARM MEMORY (BR-012 — two-stage append-only)
# ═══════════════════════════════════════════════════════════════════════════

def recall_memory(geography: str, supplier_ids: list[str], client_id: str = "demo") -> list[dict]:
    """BR-002 — Memory recall by geography and supplier set. (Bug fix: limit context window + client isolation)"""
    zones = CASCADE_ZONE_MAP.get(geography, [geography])
    results = []
    cont = _get_cosmos()
    if cont:
        try:
            items = list(cont[config.COSMOS_CONTAINER_MEMORY].read_all_items())
        except Exception:
            items = _mem_swarm_memory
    else:
        items = _mem_swarm_memory

    # Strict client isolation: each client only sees their own memory records.
    # Seed clients share seed memory with each other but are completely
    # isolated from real clients, and real clients never see each other's records.
    seed_client_ids = {"demo", "ifb", "tata_motors"}
    is_seed_client = client_id in seed_client_ids

    for rec in items:
        rec_owner = rec.get("client_id", "demo")
        if is_seed_client:
            # Seed clients only see seed memory, not real-client memory
            if rec_owner not in seed_client_ids:
                continue
        else:
            # Real clients only see their own memory — never another real
            # client's records and never seed-client memory
            if rec_owner != client_id:
                continue

        geo_match = rec.get("geography") in zones
        sup_match = rec.get("supplier_id") in supplier_ids
        if geo_match or sup_match:
            results.append(rec)

    # Sort by timestamp descending (most recent first) and apply limit
    results.sort(key=lambda r: r.get("timestamp_utc", ""), reverse=True)
    memory_limit = config.MEMORY_CONTEXT_LIMIT
    results = results[:memory_limit]

    return results


def write_memory_stage1(event_id: str, geography: str,
                         supplier_scores: list[dict], demand_prediction: float,
                         event_type: str, option_selected: str = "pending",
                         supplier_ids: Optional[list[str]] = None,
                         action_options: Optional[list[dict]] = None,
                         monitor: Optional[dict] = None,
                         client_id: str | None = None) -> dict:
    """BR-012 Stage 1 — write predictions at event completion."""
    # AC-13 / NFR-06: memory immutability — prevent overwriting an existing stage-1 record.
    existing_stage1 = next(
        (r for r in _mem_swarm_memory if r.get("event_id") == event_id and r.get("stage") == 1),
        None,
    )
    if existing_stage1:
        logger.warning("Memory immutability: stage-1 record already exists for event_id=%s — returning existing", event_id)
        return existing_stage1

    mem_id = f"MEM-{str(uuid.uuid4())[:8].upper()}"
    record = {
        "id": mem_id,
        "memory_id": mem_id,
        "stage": 1,
        "event_id": event_id,
        "client_id": _infer_client_id(event_id, client_id),
        "event_type": event_type,
        "geography": geography,
        "supplier_ids": supplier_ids or [s.get("supplier_id") for s in supplier_scores],
        "supplier_scores": supplier_scores,
        "predicted_demand_shift": demand_prediction,
        "option_selected": option_selected,
        "action_options": action_options or [],
        "risk_scores_assigned": supplier_scores,
        "severity_score": (monitor or {}).get("severity_score"),
        "source": (monitor or {}).get("source"),
        "timestamp_utc": _now_utc(),
    }
    cont = _get_cosmos()
    if cont:
        try:
            cont[config.COSMOS_CONTAINER_MEMORY].create_item(body=record)
        except Exception:
            _mem_swarm_memory.append(record)
    else:
        _mem_swarm_memory.append(record)
    write_audit(event_id, "SwarmMemory", "stage1_write", f"geo={geography}", record["memory_id"], client_id=record["client_id"])
    return record


def write_memory_stage2(event_id: str, actual_outcome: str,
                         actual_demand_shift: Optional[float],
                         learning_signal: str,
                         delivery_performance: Optional[str] = None,
                         counterfactual_id: Optional[str] = None,
                         client_id: str | None = None) -> Optional[dict]:
    """BR-012 Stage 2 — write actuals at resolution. Never modifies stage 1."""
    # AC-13 / NFR-06: memory immutability — prevent overwriting an existing stage-2 record.
    existing_stage2 = next(
        (r for r in _mem_swarm_memory if r.get("event_id") == event_id and r.get("stage") == 2),
        None,
    )
    if existing_stage2:
        logger.warning("Memory immutability: stage-2 record already exists for event_id=%s — returning existing", event_id)
        return existing_stage2

    cont = _get_cosmos()
    items = []
    if cont:
        try:
            items = list(cont[config.COSMOS_CONTAINER_MEMORY].query_items(
                query="SELECT * FROM c WHERE c.event_id = @eid AND c.stage = 1",
                parameters=[{"name": "@eid", "value": event_id}],
                enable_cross_partition_query=True,
            ))
        except Exception:
            items = [r for r in _mem_swarm_memory if r.get("event_id") == event_id and r.get("stage") == 1]
    else:
        items = [r for r in _mem_swarm_memory if r.get("event_id") == event_id and r.get("stage") == 1]

    if not items:
        return None
    stage1 = items[0]
    stage2 = dict(stage1)
    stage2["id"] = f"MEM-{str(uuid.uuid4())[:8].upper()}"
    stage2["memory_id"] = stage2["id"]
    stage2["stage"] = 2
    stage2["client_id"] = stage2.get("client_id") or _infer_client_id(event_id, client_id)
    stage2["actual_outcome"] = actual_outcome
    stage2["actual_demand_shift"] = actual_demand_shift
    stage2["learning_signal"] = learning_signal
    stage2["delivery_performance"] = delivery_performance or actual_outcome
    stage2["counterfactual_id"] = counterfactual_id
    stage2["resolution_timestamp_utc"] = _now_utc()

    if cont:
        try:
            cont[config.COSMOS_CONTAINER_MEMORY].create_item(body=stage2)
        except Exception:
            _mem_swarm_memory.append(stage2)
    else:
        _mem_swarm_memory.append(stage2)
    write_audit(event_id, "SwarmMemory", "stage2_write", actual_outcome[:80], learning_signal[:80], client_id=stage2.get("client_id"))
    return stage2


def get_memory_store(limit: int = 100) -> list[dict]:
    cont = _get_cosmos()
    if cont:
        try:
            return list(cont[config.COSMOS_CONTAINER_MEMORY].read_all_items(max_item_count=limit))
        except Exception:
            pass
    return list(reversed(_mem_swarm_memory[-limit:]))


# ═══════════════════════════════════════════════════════════════════════════
# EVENT RECORDS
# ═══════════════════════════════════════════════════════════════════════════

def save_event(event_id: str, state: dict):
    state["event_id"] = event_id
    state.setdefault("client_id", _infer_client_id(event_id))
    state["last_updated_utc"] = _now_utc()
    cont = _get_cosmos()
    if cont:
        try:
            state["id"] = event_id
            cont[config.COSMOS_CONTAINER_EVENTS].upsert_item(body=state)
            return
        except Exception:
            pass
    _mem_events[event_id] = state


def load_event(event_id: str) -> Optional[dict]:
    cont = _get_cosmos()
    if cont:
        try:
            return cont[config.COSMOS_CONTAINER_EVENTS].read_item(item=event_id, partition_key=event_id)
        except Exception:
            pass
    return _mem_events.get(event_id)


def list_events() -> list[dict]:
    cont = _get_cosmos()
    if cont:
        try:
            return list(cont[config.COSMOS_CONTAINER_EVENTS].read_all_items(max_item_count=100))
        except Exception:
            pass
    return list(_mem_events.values())


# ─── Active events (for cascade detection) ───────────────────────────────────

def add_active_event(event: dict):
    _mem_active_events.append(event)


def get_active_events() -> list[dict]:
    return list(_mem_active_events)


def remove_active_event(event_id: str):
    global _mem_active_events
    _mem_active_events = [e for e in _mem_active_events if e.get("event_id") != event_id]


# ─── NL query log ───────────────────────────────────────────────────────────

def log_nl_query(event_id: str, question: str, agent_context: str, response: str,
                 context_window: Optional[dict] = None, client_id: str | None = None):
    rec = {
        "id": str(uuid.uuid4()),
        "event_id": event_id,
        "client_id": _infer_client_id(event_id, client_id),
        "question": question,
        "agent_context": agent_context,
        "routing_target_agent": agent_context,
        "context_window_used": context_window or {},
        "response": response,
        "timestamp_utc": _now_utc(),
    }
    _mem_nl_queries.append(rec)
    write_audit(event_id, "NLInterrogation", "query", question[:80], f"context={agent_context}", client_id=rec["client_id"])


def get_nl_queries(event_id: Optional[str] = None) -> list[dict]:
    if event_id:
        return [q for q in _mem_nl_queries if q["event_id"] == event_id]
    return list(_mem_nl_queries)


# ─── Counterfactuals ─────────────────────────────────────────────────────────

def store_counterfactual(record: dict):
    record.setdefault("client_id", _infer_client_id(record.get("event_id"), record.get("client_id")))
    _mem_counterfactuals.append(record)


def get_counterfactuals() -> list[dict]:
    """All explicit counterfactual records plus stage-2 (resolved) memory records."""
    stage2 = [r for r in _mem_swarm_memory if r.get("stage") == 2]
    return list(reversed(_mem_counterfactuals + stage2))


def record_pipeline_metric(event_id: str, metric: dict):
    _pipeline_metrics.append({
        "event_id": event_id,
        "client_id": _infer_client_id(event_id, metric.get("client_id")),
        "timestamp_utc": _now_utc(),
        **metric,
    })


def get_pipeline_metrics() -> list[dict]:
    return list(_pipeline_metrics)


def log_config_change(changes: dict, actor: str = "PlatformAdmin", client_id: str | None = None) -> dict:
    rec = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "actor": actor,
        "changes": changes,
        "timestamp_utc": _now_utc(),
    }
    _mem_config_events.append(rec)
    write_audit("config", "PlatformAdmin", "config_update", actor, str(changes)[:200], client_id=client_id)
    return rec


def get_config_events(limit: int = 100) -> list[dict]:
    return list(reversed(_mem_config_events[-limit:]))


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3: STORAGE HELPERS FOR REPORTS (Report infrastructure)
# ═══════════════════════════════════════════════════════════════════════════

def get_all_events() -> list[dict]:
    """Return all events stored (for reporting)."""
    cont = _get_cosmos()
    if cont:
        try:
            return list(cont[config.COSMOS_CONTAINER_EVENTS].read_all_items(max_item_count=1000))
        except Exception:
            pass
    return list(_mem_events.values())


# ═══════════════════════════════════════════════════════════════════════════
# PREMIUM REQUESTS — Cosmos-backed write-through
# ═══════════════════════════════════════════════════════════════════════════

_mem_premium_requests: list[dict] = []
_mem_support_tickets: list[dict] = []
_mem_feedback_records: list[dict] = []


def write_premium_request(req: dict) -> dict:
    req.setdefault("id", str(uuid.uuid4()))
    idx = next((i for i, r in enumerate(_mem_premium_requests) if r["id"] == req["id"]), None)
    if idx is not None:
        _mem_premium_requests[idx] = req
    else:
        _mem_premium_requests.append(req)
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_PREMIUM in cont:
        try:
            cont[config.COSMOS_CONTAINER_PREMIUM].upsert_item(body=req)
        except Exception as e:
            logger.error("Cosmos premium upsert: %s", e)
    return req


def get_premium_requests() -> list[dict]:
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_PREMIUM in cont:
        try:
            items = list(cont[config.COSMOS_CONTAINER_PREMIUM].read_all_items())
            _mem_premium_requests.clear()
            _mem_premium_requests.extend(items)
        except Exception:
            pass
    return list(_mem_premium_requests)


def delete_premium_requests_for_client(client_id: str):
    global _mem_premium_requests
    ids = [r["id"] for r in _mem_premium_requests if r.get("client_id") == client_id]
    _mem_premium_requests = [r for r in _mem_premium_requests if r.get("client_id") != client_id]
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_PREMIUM in cont:
        for rid in ids:
            try:
                cont[config.COSMOS_CONTAINER_PREMIUM].delete_item(item=rid, partition_key=rid)
            except Exception:
                pass


# ═══════════════════════════════════════════════════════════════════════════
# SUPPORT TICKETS — Cosmos-backed write-through
# ═══════════════════════════════════════════════════════════════════════════

def write_support_ticket(ticket: dict) -> dict:
    tid = ticket.get("ticket_id") or str(uuid.uuid4())
    ticket["id"] = tid
    idx = next((i for i, t in enumerate(_mem_support_tickets) if t.get("ticket_id") == tid), None)
    if idx is not None:
        _mem_support_tickets[idx] = ticket
    else:
        _mem_support_tickets.append(ticket)
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_SUPPORT in cont:
        try:
            cont[config.COSMOS_CONTAINER_SUPPORT].upsert_item(body=ticket)
        except Exception as e:
            logger.error("Cosmos support upsert: %s", e)
    return ticket


def get_support_tickets(client_id: str | None = None) -> list[dict]:
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_SUPPORT in cont:
        try:
            items = list(cont[config.COSMOS_CONTAINER_SUPPORT].read_all_items())
            _mem_support_tickets.clear()
            _mem_support_tickets.extend(items)
        except Exception:
            pass
    if client_id:
        return [t for t in _mem_support_tickets if t.get("client_id") == client_id]
    return list(_mem_support_tickets)


def delete_support_tickets_for_client(client_id: str):
    global _mem_support_tickets
    ids = [t["id"] for t in _mem_support_tickets if t.get("client_id") == client_id]
    _mem_support_tickets = [t for t in _mem_support_tickets if t.get("client_id") != client_id]
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_SUPPORT in cont:
        for rid in ids:
            try:
                cont[config.COSMOS_CONTAINER_SUPPORT].delete_item(item=rid, partition_key=rid)
            except Exception:
                pass


# ═══════════════════════════════════════════════════════════════════════════
# FEEDBACK RECORDS — Cosmos-backed write-through
# ═══════════════════════════════════════════════════════════════════════════

def write_feedback_record(record: dict) -> dict:
    record.setdefault("id", str(uuid.uuid4()))
    _mem_feedback_records.append(record)
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_FEEDBACK in cont:
        try:
            cont[config.COSMOS_CONTAINER_FEEDBACK].upsert_item(body=record)
        except Exception as e:
            logger.error("Cosmos feedback upsert: %s", e)
    return record


def get_feedback_records(client_id: str | None = None) -> list[dict]:
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_FEEDBACK in cont:
        try:
            items = list(cont[config.COSMOS_CONTAINER_FEEDBACK].read_all_items())
            _mem_feedback_records.clear()
            _mem_feedback_records.extend(items)
        except Exception:
            pass
    if client_id:
        return [r for r in _mem_feedback_records if r.get("client_id") == client_id]
    return list(_mem_feedback_records)


def delete_feedback_for_client(client_id: str):
    global _mem_feedback_records
    ids = [r["id"] for r in _mem_feedback_records if r.get("client_id") == client_id]
    _mem_feedback_records = [r for r in _mem_feedback_records if r.get("client_id") != client_id]
    cont = _get_cosmos()
    if cont and config.COSMOS_CONTAINER_FEEDBACK in cont:
        for rid in ids:
            try:
                cont[config.COSMOS_CONTAINER_FEEDBACK].delete_item(item=rid, partition_key=rid)
            except Exception:
                pass


# ═══════════════════════════════════════════════════════════════════════════
# LANDING-PAGE SURVEY RESPONSES — Cosmos-backed write-through (public, no auth)
# ═══════════════════════════════════════════════════════════════════════════

_mem_survey_responses: list[dict] = []
_SURVEY_FILE = _os.path.join(_os.path.dirname(__file__), "survey_responses.json")


def _load_surveys_from_disk() -> None:
    """Best-effort load of persisted survey responses on first access."""
    if _mem_survey_responses or not _os.path.exists(_SURVEY_FILE):
        return
    try:
        with open(_SURVEY_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            _mem_survey_responses.extend(data)
    except Exception as e:
        logger.warning("survey load failed: %s", e)


def _persist_surveys_to_disk() -> None:
    try:
        tmp = _SURVEY_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_mem_survey_responses, fh, default=str)
        _os.replace(tmp, _SURVEY_FILE)
    except Exception as e:
        logger.warning("survey persist failed: %s", e)


def write_survey_response(record: dict) -> dict:
    """Persist a single landing-page product-survey response."""
    _load_surveys_from_disk()
    record.setdefault("id", str(uuid.uuid4()))
    _mem_survey_responses.append(record)
    cont = _get_cosmos()
    container = getattr(config, "COSMOS_CONTAINER_SURVEY", None)
    if cont and container and container in cont:
        try:
            cont[container].upsert_item(body=record)
        except Exception as e:
            logger.error("Cosmos survey upsert: %s", e)
    else:
        _persist_surveys_to_disk()
    return record


def get_survey_responses() -> list[dict]:
    """Return all landing-page survey responses."""
    _load_surveys_from_disk()
    cont = _get_cosmos()
    container = getattr(config, "COSMOS_CONTAINER_SURVEY", None)
    if cont and container and container in cont:
        try:
            items = list(cont[container].read_all_items())
            _mem_survey_responses.clear()
            _mem_survey_responses.extend(items)
        except Exception:
            pass
    return list(_mem_survey_responses)
