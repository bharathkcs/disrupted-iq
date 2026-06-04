"""
routes/misc_routes.py - remaining miscellaneous endpoints.

Includes /health, /api/config*, /api/audit-log*, /api/registrations,
/api/memory, /api/counterfactuals, /api/config/history, /api/nl-queries,
/api/clients, /api/clients/switch.

Shared state and helpers remain in main.py and are imported lazily inside
each handler to avoid a circular import.
"""

import csv
import io
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse

import auth
import config
import federated_memory
import llm
import storage
from models import ConfigUpdate, SupplierUpdate

logger = logging.getLogger("disruptiq.routes.misc")

misc_router = APIRouter(tags=["misc"])


@misc_router.get("/health")
async def health():
    llm_health = llm.get_llm_health()
    cosmos_health = storage.get_cosmos_health()
    overall = "degraded" if llm_health["degraded"] or cosmos_health["status"] == "error" else "ok"
    return {
        "status": overall,
        "service": "DisruptIQ",
        "version": "2.0.0",
        **config.status_summary(),
        "health": {
            "llm": llm_health,
            "cosmos_db": cosmos_health,
        },
    }


@misc_router.get("/api/config")
async def get_config(current_user: dict = Depends(auth.require_auth)):
    from main import _config_payload
    return _config_payload()


@misc_router.post("/api/config/update")
async def update_config(req: ConfigUpdate, current_user: dict = Depends(auth.require_auth)):
    from main import _now_utc
    section_map = {
        "thresholds": {
            "severity_escalation_threshold": "SEVERITY_THRESHOLD",
            "cascade_detection_window_hours": "CASCADE_WINDOW_HOURS",
            "dissent_divergence_threshold": "DISSENT_DIVERGENCE_THRESHOLD",
            "cascade_overlap_multiplier": "CASCADE_OVERLAP_MULTIPLIER",
            "simulation_sla_seconds": "SIMULATION_SLA_SECONDS",
            "max_validator_reruns": "MAX_VALIDATOR_RERUNS",
        },
        "polling": {
            "newsapi_poll_interval_minutes": "NEWSAPI_POLL_INTERVAL_MINUTES",
            "openmeteo_poll_interval_minutes": "OPENMETEO_POLL_INTERVAL_MINUTES",
            "minimum_severity_to_alert": "MINIMUM_SEVERITY_TO_ALERT",
        },
    }
    if req.section not in section_map:
        raise HTTPException(400, "Unknown config section")

    mapped_values = {}
    for key, value in req.values.items():
        target = section_map[req.section].get(key)
        if target:
            mapped_values[target] = value
    applied = config.apply_runtime_overrides(mapped_values)
    storage.log_config_change(applied, "PlatformAdmin", client_id=current_user["client_id"])
    storage.write_audit("SYSTEM", "Config", "config_update", f"section={req.section}", str(applied),
                        client_id=current_user["client_id"])
    return {"success": True, "applied": applied, "timestamp_utc": _now_utc()}


@misc_router.post("/api/config/suppliers/update")
async def update_supplier(req: SupplierUpdate, current_user: dict = Depends(auth.require_auth)):
    """Update a supplier in the authenticated client's own list."""
    from main import _client_user
    user, client = _client_user(current_user)
    client_suppliers = client.get("suppliers", [])
    supplier = next((s for s in client_suppliers
                     if s.get("id") == req.supplier_id or s.get("supplier_id") == req.supplier_id), None)
    if not supplier:
        raise HTTPException(404, "Supplier not found in your account")
    for key, value in req.updates.items():
        supplier[key] = value
    storage.write_audit("SYSTEM", "Config", "supplier_update", req.supplier_id, str(req.updates),
                        client_id=current_user["client_id"])
    return supplier


@misc_router.get("/api/audit-log")
async def audit_log(event_id: Optional[str] = None,
                    current_user: dict = Depends(auth.get_optional_user)):
    client_id = current_user["client_id"]
    entries = storage.get_audit_log(1000)
    if event_id:
        entries = [entry for entry in entries if entry.get("event_id") == event_id]
    entries = [entry for entry in entries if entry.get("client_id") == client_id]
    return entries


@misc_router.get("/api/audit-log/export", response_class=PlainTextResponse)
async def audit_log_export(current_user: dict = Depends(auth.require_auth)):
    client_id = current_user["client_id"]
    rows = storage.get_audit_log(1000)
    rows = [row for row in rows if row.get("client_id") == client_id]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "event_id", "agent", "action", "input_summary", "output_summary", "status", "timestamp_utc",
    ])
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key) for key in writer.fieldnames})
    return output.getvalue()


@misc_router.get("/api/registrations")
async def registrations(current_user: dict = Depends(auth.require_auth)):
    """Get recent registrations - seed/admin clients only."""
    from main import SEED_CLIENT_IDS
    if current_user.get("client_id") not in SEED_CLIENT_IDS:
        raise HTTPException(status_code=403, detail="Admin access required")
    audit_entries = storage.get_audit_log(500)
    registrations_list = []

    for entry in audit_entries:
        if entry.get("agent") == "OnboardingSystem" and entry.get("action") == "new_user_signup":
            input_summary = entry.get("input_summary", "")
            output_summary = entry.get("output_summary", "")

            email = ""
            if "email=" in input_summary:
                email = input_summary.split("email=")[1].strip()

            client_id = ""
            company_name = ""
            industry = ""

            if "client_id=" in output_summary:
                client_id = output_summary.split("client_id=")[1].split("|")[0].strip()
            if "company=" in output_summary:
                company_name = output_summary.split("company=")[1].split("|")[0].strip()
            if "industry=" in output_summary:
                industry = output_summary.split("industry=")[1].strip()

            registrations_list.append({
                "client_id": client_id,
                "email": email,
                "company_name": company_name,
                "industry": industry,
                "registered_at": entry.get("timestamp_utc"),
                "status": "active",
            })

    return {
        "total": len(registrations_list),
        "registrations": registrations_list,
    }


@misc_router.get("/api/memory")
async def memory_route(current_user: dict = Depends(auth.require_auth)):
    client_id = current_user["client_id"]
    records = storage.get_memory_store(1000)
    records = [r for r in records if r.get("client_id") == client_id]
    return records


@misc_router.get("/api/memory/federated-baseline")
async def federated_baseline(
    event_type: str,
    geography: str,
    current_user: dict = Depends(auth.require_auth),
):
    """Section 5 Sprint: anonymised cross-tenant baseline for cold-start
    forecasting. Returns None / 404 when fewer than K_ANONYMITY_MIN clients
    have contributed Stage-2 records for the given (event_type, geography).

    Never exposes another client's data - aggregates are stripped of any
    identifying fields before publication.
    """
    baseline = federated_memory.aggregate_baseline(event_type, geography)
    if baseline is None:
        raise HTTPException(
            status_code=404,
            detail="No federated baseline available yet for this event_type + geography "
                   "(below the k-anonymity threshold).",
        )
    return baseline


@misc_router.get("/api/counterfactuals")
async def counterfactuals_route(current_user: dict = Depends(auth.get_optional_user)):
    client_id = current_user["client_id"]
    records = storage.get_counterfactuals()
    records = [r for r in records if r.get("client_id") == client_id]
    return records


@misc_router.get("/api/config/history")
async def config_history(current_user: dict = Depends(auth.require_auth)):
    client_id = current_user["client_id"]
    events = storage.get_config_events()
    events = [e for e in events if e.get("client_id") == client_id]
    return events


@misc_router.get("/api/nl-queries/{event_id}")
async def nl_queries_route(event_id: str, current_user: dict = Depends(auth.get_optional_user)):
    from main import swarm_states
    state = swarm_states.get(current_user["client_id"], {}).get(event_id) or storage.load_event(event_id)
    if not state or state.get("client_id") != current_user["client_id"]:
        raise HTTPException(status_code=404, detail="Event not found")
    return [item for item in storage.get_nl_queries(event_id)
            if item.get("client_id") == current_user["client_id"]]


@misc_router.get("/api/clients")
async def list_clients(current_user: dict = Depends(auth.require_auth)):
    """List available client IDs and their supplier counts."""
    from main import clients_db, SEED_CLIENT_IDS
    from seed_data import CLIENT_SUPPLIER_DATABASES
    client_id = current_user["client_id"]
    if client_id not in SEED_CLIENT_IDS:
        own_client = clients_db.get(client_id, {})
        return {
            "clients": [{
                "id": client_id,
                "name": own_client.get("company_name", client_id),
                "supplier_count": len(own_client.get("suppliers", [])),
            }],
            "active_client": client_id,
        }
    return {
        "clients": [
            {
                "id": cid,
                "name": cid.replace("_", " ").title(),
                "supplier_count": len(CLIENT_SUPPLIER_DATABASES[cid]),
            }
            for cid in CLIENT_SUPPLIER_DATABASES.keys()
        ],
        "active_client": config.ACTIVE_CLIENT_ID,
    }


@misc_router.post("/api/clients/switch")
async def switch_client(body: dict, current_user: dict = Depends(auth.require_auth)):
    """Switch active client - only seed clients can switch (legacy demo feature)."""
    from main import SEED_CLIENT_IDS, _now_utc
    from seed_data import CLIENT_SUPPLIER_DATABASES
    if current_user["client_id"] not in SEED_CLIENT_IDS:
        raise HTTPException(403, "Real clients cannot switch active client context")
    client_id = body.get("client_id", "demo")
    if client_id not in CLIENT_SUPPLIER_DATABASES:
        raise HTTPException(400, f"Client '{client_id}' not found")
    config.ACTIVE_CLIENT_ID = client_id
    storage.write_audit("SYSTEM", "Config", "client_switched",
                        f"old={getattr(switch_client, '_prev_client', 'demo')}",
                        f"new={client_id}", client_id=client_id)
    switch_client._prev_client = client_id
    return {
        "success": True,
        "active_client": config.ACTIVE_CLIENT_ID,
        "suppliers_loaded": len(CLIENT_SUPPLIER_DATABASES[client_id]),
        "timestamp_utc": _now_utc(),
    }
