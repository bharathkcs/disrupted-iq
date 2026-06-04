"""
routes/events_routes.py — /api/events/* + /api/demo/chaos-mode router.

Event pipeline endpoints. Shared state (``swarm_states``,
``_idempotency_cache``, ``_daily_swarm_counts``, ``SEED_CLIENT_IDS``,
``FREE_TIER_DAILY_SWARM_LIMIT``) and helpers (``run_swarm``,
``emit_update``, ``_now_utc``, ``_event_timestamp``,
``_resolve_suppliers``, ``_mark_onboarding_step``, ``_create_notification``,
``_log_telemetry``) remain in main.py and are imported lazily inside each
handler to avoid a circular import.
"""

import asyncio
import logging
from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

import agents
import auth
import storage
from models import (
    EventTrigger, Acknowledgement, HILDecision, NLQuery,
    Resolution, SupplierMessageRequest,
)

logger = logging.getLogger("disruptiq.routes.events")

events_router = APIRouter(prefix="/api/events", tags=["events"])
chaos_router = APIRouter(prefix="/api/demo", tags=["demo"])


@events_router.post("/trigger")
async def trigger_event(req: EventTrigger, current_user: dict = Depends(auth.require_auth)):
    """Trigger swarm analysis for authenticated user's client. Events are isolated per client."""
    from main import (swarm_states, _idempotency_cache, _daily_swarm_counts,
                      SEED_CLIENT_IDS, FREE_TIER_DAILY_SWARM_LIMIT, run_swarm)
    if req.demo_mode:
        client_id = "demo"
    else:
        client_id = current_user.get("client_id")
        if not client_id:
            raise HTTPException(status_code=400, detail="User has no associated client")

    if req.idempotency_key:
        idem_key = f"{client_id}:{req.idempotency_key}"
        existing_event_id = _idempotency_cache.get(idem_key)
        if existing_event_id:
            existing = swarm_states.get(client_id, {}).get(existing_event_id) or storage.load_event(existing_event_id)
            if existing:
                return existing
            logger.info("Idempotency key %s had no stored event; re-running", idem_key)

    if client_id not in SEED_CLIENT_IDS:
        day_key = f"{client_id}:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        count = _daily_swarm_counts.get(day_key, 0)
        if count >= FREE_TIER_DAILY_SWARM_LIMIT:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "Daily event limit reached",
                    "limit": FREE_TIER_DAILY_SWARM_LIMIT,
                    "current": count,
                    "message": (
                        f"You have triggered {count} events today. The limit resets at "
                        f"00:00 UTC. Contact us to raise your limit."
                    ),
                },
            )
        _daily_swarm_counts.set(day_key, count + 1)

    event_trigger_with_client = EventTrigger(**{k: v for k, v in req.dict().items() if k in EventTrigger.__fields__})
    result = await run_swarm(event_trigger_with_client, client_id=client_id)

    if req.idempotency_key and isinstance(result, dict):
        produced_id = result.get("event_id")
        if produced_id:
            _idempotency_cache.set(f"{client_id}:{req.idempotency_key}", produced_id)

    return result


@chaos_router.post("/chaos-mode")
async def trigger_chaos_mode(current_user: dict = Depends(auth.require_auth)):
    """Fire 3 simultaneous compound disruptions to exercise the cascade detector and dissent gates."""
    from main import SEED_CLIENT_IDS, _resolve_suppliers, run_swarm
    client_id = current_user.get("client_id")

    default_events = [
        {"description": "Port workers strike halts container handling.",
         "location": "Port of Shanghai", "source": "manual",
         "geography": "Shanghai", "event_type": "Port Strike",
         "severity_score": 8, "type": "Disruption Event"},
        {"description": "Taiwan Strait shipping disruption chokes semiconductor exports.",
         "location": "Hsinchu Science Park", "source": "manual",
         "geography": "Taipei", "event_type": "Geopolitical",
         "severity_score": 9, "type": "Disruption Event"},
        {"description": "Category 4 hurricane forces petrochemical shutdowns.",
         "location": "Gulf Coast", "source": "manual",
         "geography": "Houston", "event_type": "Weather Event",
         "severity_score": 8, "type": "Disruption Event"},
    ]

    suppliers = _resolve_suppliers(client_id)
    if suppliers and client_id not in SEED_CLIENT_IDS:
        top_zones = [z for z, _ in Counter(
            s.get("zone") for s in suppliers if s.get("zone")
        ).most_common(3)]
        templates = [
            ("Cyclone disrupts regional logistics and supplier operations.", "Cyclone", 8),
            ("Port worker strike halts container handling across the region.", "Port Strike", 8),
            ("Critical supplier insolvency disrupts category supply.", "Supplier Failure", 9),
        ]
        chaos_events = []
        for idx, (desc, etype, sev) in enumerate(templates):
            zone = top_zones[idx] if idx < len(top_zones) else (top_zones[0] if top_zones else "Mumbai")
            chaos_events.append({
                "description": desc, "location": zone, "source": "manual",
                "geography": zone, "event_type": etype,
                "severity_score": sev, "type": "Disruption Event",
            })
    else:
        chaos_events = default_events

    async def _run(payload):
        trigger = EventTrigger(**payload)
        return await run_swarm(trigger, client_id=client_id)

    results = await asyncio.gather(*(_run(p) for p in chaos_events), return_exceptions=True)
    event_ids = []
    for r in results:
        if isinstance(r, dict):
            eid = r.get("event_id")
            if eid:
                event_ids.append(eid)

    return {"status": "chaos_triggered", "event_ids": event_ids,
            "count": len(event_ids), "requested": len(chaos_events)}


@events_router.get("/{event_id}")
async def get_event(event_id: str, current_user: dict = Depends(auth.get_optional_user)):
    from main import swarm_states
    client_id = current_user["client_id"]
    state = swarm_states.get(client_id, {}).get(event_id) or storage.load_event(event_id)
    if not state:
        raise HTTPException(404, "Event not found")
    if state.get("client_id") != client_id:
        raise HTTPException(403, "Unauthorized: event belongs to a different client")
    return state


@events_router.get("/{event_id}/risk-changes")
async def event_risk_changes(event_id: str, current_user: dict = Depends(auth.get_optional_user)):
    """Feature 5 - per-supplier 'what changed' risk score explanations."""
    from main import swarm_states
    client_id = current_user["client_id"]
    state = swarm_states.get(client_id, {}).get(event_id) or storage.load_event(event_id)
    if not state:
        raise HTTPException(404, "Event not found")
    if state.get("client_id") != client_id:
        raise HTTPException(403, "Unauthorized: event belongs to a different client")
    risk = state.get("risk", {})
    return {
        "event_id": event_id,
        "narrative": risk.get("narrative"),
        "explanations": risk.get("risk_change_explanations", []),
    }


@events_router.get("")
async def list_events_route(
    current_user: dict = Depends(auth.get_optional_user),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List events for the authenticated user's client."""
    from main import swarm_states, _event_timestamp
    client_id = current_user.get("client_id", "demo")
    persisted = storage.list_events()
    in_mem = [event for client_events in swarm_states.values() for event in client_events.values()]
    by_id = {}
    for event in persisted + in_mem:
        event_id = event.get("event_id")
        event_client = event.get("client_id", "demo")
        if event_id and (event_client == client_id or (event_client == "demo" and client_id == "demo")):
            by_id[event_id] = event
    ordered = sorted(by_id.values(), key=lambda e: _event_timestamp(e), reverse=True)
    return ordered[offset:offset + limit]


@events_router.post("/acknowledge")
async def acknowledge(req: Acknowledgement, current_user: dict = Depends(auth.get_optional_user)):
    from main import swarm_states, emit_update, _now_utc
    client_id = current_user["client_id"]
    state = swarm_states.get(client_id, {}).get(req.event_id) or storage.load_event(req.event_id)
    if not state:
        raise HTTPException(404, "Event not found")
    if state.get("client_id") != client_id:
        raise HTTPException(403, "Unauthorized: event belongs to a different client")
    state.setdefault("acknowledgements", {})[req.ack_type] = {
        "reviewer_id": req.reviewer_id,
        "timestamp_utc": _now_utc(),
    }
    if client_id not in swarm_states:
        swarm_states[client_id] = {}
    swarm_states[client_id][req.event_id] = state
    storage.save_event(req.event_id, state)
    storage.write_audit(req.event_id, "HIL", f"ack_{req.ack_type}", req.reviewer_id, "", client_id=client_id)
    await emit_update(req.event_id, "HIL", f"ack_{req.ack_type}", {"reviewer_id": req.reviewer_id}, client_id=client_id)
    return {"event_id": req.event_id, "acknowledgements": state["acknowledgements"]}


@events_router.post("/hil-confirm")
async def hil_confirm(req: HILDecision, current_user: dict = Depends(auth.get_optional_user)):
    from main import swarm_states, emit_update, _now_utc, _log_telemetry
    client_id = current_user["client_id"]
    state = swarm_states.get(client_id, {}).get(req.event_id) or storage.load_event(req.event_id)
    if not state:
        raise HTTPException(404, "Event not found")
    if state.get("client_id") != client_id:
        raise HTTPException(403, "Unauthorized: event belongs to a different client")

    if not state.get("simulation"):
        raise HTTPException(400, "BR-007 violation: Simulation Agent has not completed")

    acks = state.get("acknowledgements", {})
    if state.get("divergence", {}).get("dissent_detected") and "dissent" not in acks:
        raise HTTPException(400, "BR-008 violation: Agent Dissent must be acknowledged")
    if state.get("cascade_alert") and "cascade" not in acks:
        raise HTTPException(400, "BR-008 violation: Cascade Risk must be acknowledged")
    if state.get("memory_recalls") and "memory" not in acks:
        raise HTTPException(400, "BR-008 violation: Memory recall must be acknowledged")
    if state.get("sla_breach_ack_required") and "sla_breach" not in acks:
        raise HTTPException(400, "Simulation SLA breach must be acknowledged before confirming")

    severity = state.get("monitor", {}).get("severity_score", 0)
    critical_count = state.get("risk", {}).get("critical_count", 0)
    co_review_required = severity >= 9 or critical_count >= 2
    if co_review_required and not req.co_reviewer_id:
        raise HTTPException(400, f"BR-008 violation: Co-review required (severity={severity}, critical={critical_count})")

    reviewer_id = current_user.get("email") or req.reviewer_id

    state["hil_decision"] = {
        "selected_option_rank": req.selected_option_rank,
        "reviewer_id": reviewer_id,
        "co_reviewer_id": req.co_reviewer_id,
        "co_review_required": co_review_required,
        "timestamp_utc": _now_utc(),
    }
    state["status"] = "confirmed"
    if client_id not in swarm_states:
        swarm_states[client_id] = {}
    swarm_states[client_id][req.event_id] = state
    storage.save_event(req.event_id, state)
    storage.write_audit(
        req.event_id, "HIL", "confirmed",
        f"reviewer={reviewer_id}",
        f"option={req.selected_option_rank}",
        client_id=client_id,
    )
    await emit_update(req.event_id, "HIL", "confirmed", {
        "selected_option": req.selected_option_rank,
        "reviewer_id": reviewer_id,
    }, client_id=client_id)

    _log_telemetry(
        "hil_confirmed",
        properties={
            "event_id": req.event_id,
            "option": req.selected_option_rank,
            "co_review": co_review_required,
        },
        metrics={"severity": severity}
    )

    return {"event_id": req.event_id, "status": "confirmed", "hil_decision": state["hil_decision"]}


@events_router.post("/supplier-message")
async def supplier_message(req: SupplierMessageRequest, current_user: dict = Depends(auth.get_optional_user)):
    """Feature 4 - draft a supplier communication for a selected action option."""
    from main import swarm_states
    client_id = current_user["client_id"]
    state = swarm_states.get(client_id, {}).get(req.event_id) or storage.load_event(req.event_id)
    if not state:
        raise HTTPException(404, "Event not found")
    if state.get("client_id") != client_id:
        raise HTTPException(403, "Unauthorized: event belongs to a different client")
    options = state.get("action", {}).get("options", [])
    option = next((o for o in options if o.get("rank") == req.option_rank), None)
    if not option:
        raise HTTPException(404, "Action option not found")
    result = await agents.supplier_communication_agent(state.get("monitor", {}), option)
    storage.write_audit(req.event_id, "SupplierCommsDrafter", "message_drafted",
                        f"option={req.option_rank}", result["message_type"], client_id=client_id)
    return result


@events_router.post("/nl-query")
async def nl_query(req: NLQuery, current_user: dict = Depends(auth.get_optional_user)):
    from main import swarm_states, emit_update
    client_id = current_user["client_id"]
    safe_question = agents._sanitize_for_prompt(req.question, max_length=400)

    if not req.event_id:
        result = await agents.nl_interrogation(None, safe_question, {})
        return result

    state = swarm_states.get(client_id, {}).get(req.event_id) or storage.load_event(req.event_id)
    if not state:
        raise HTTPException(404, "Event not found")
    if state.get("client_id") != client_id:
        raise HTTPException(403, "Unauthorized: event belongs to a different client")
    result = await agents.nl_interrogation(req.event_id, safe_question, state)
    await emit_update(req.event_id, "NLInterrogation", "answered", {
        "question": req.question[:60],
        "agent": result.get("answered_by", "Analysis Team"),
    }, client_id=client_id)
    return result


@events_router.post("/resolve")
async def resolve(req: Resolution, current_user: dict = Depends(auth.get_optional_user)):
    from main import (swarm_states, emit_update, _mark_onboarding_step,
                      _create_notification, _log_telemetry)
    client_id = current_user["client_id"]
    state = swarm_states.get(client_id, {}).get(req.event_id) or storage.load_event(req.event_id)
    if not state:
        raise HTTPException(404, "Event not found")
    if state.get("client_id") != client_id:
        raise HTTPException(403, "Unauthorized: event belongs to a different client")
    await emit_update(req.event_id, "CounterfactualAgent", "activating", client_id=client_id)
    cf = await agents.counterfactual_agent(req.event_id, state, req.actual_outcome)
    storage.write_memory_stage2(
        req.event_id,
        req.actual_outcome,
        req.actual_demand_shift,
        cf.get("learning_signal", ""),
        delivery_performance=req.actual_outcome,
        counterfactual_id=cf.get("counterfactual_id"),
    )
    storage.remove_active_event(req.event_id)
    state["status"] = "resolved"
    state["counterfactual"] = cf
    if client_id not in swarm_states:
        swarm_states[client_id] = {}
    swarm_states[client_id][req.event_id] = state
    storage.save_event(req.event_id, state)
    _mark_onboarding_step(client_id, "first_resolved", True)
    _create_notification(
        client_id, "resolution", "Disruption resolved",
        f"Event {req.event_id} has been resolved and the learning record has been saved.",
        "/history",
    )
    await emit_update(req.event_id, "CounterfactualAgent", "complete", {
        "recalibration_recommended": cf.get("recalibration_recommended"),
        "learning_signal": (cf.get("learning_signal") or "")[:80],
    }, client_id=client_id)

    _log_telemetry(
        "event_resolved",
        properties={"event_id": req.event_id, "outcome": req.actual_outcome},
        metrics={"demand_shift": req.actual_demand_shift}
    )

    return cf
