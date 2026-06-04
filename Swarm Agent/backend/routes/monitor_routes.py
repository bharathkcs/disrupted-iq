"""routes/monitor_routes.py - Auto-monitoring configuration endpoints.

Section 1 of the Market Differentiation Sprint. Exposes per-client settings
for the proactive disruption monitor that's wired into the existing news /
weather polling loops in main.py.

Endpoints:
  GET  /api/monitor/config  - read this client's auto-trigger settings + zones
  PUT  /api/monitor/config  - update settings (enabled / threshold / cooldown)

Shared state (``clients_db``, ``_resolve_suppliers``) is imported lazily from
main.py inside each handler to avoid a circular import (matches the pattern
used by every other ``routes/*.py``).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

import auth
import storage
from models import MonitorConfigRequest

logger = logging.getLogger("disruptiq.routes.monitor")

monitor_router = APIRouter(tags=["monitor"])


@monitor_router.get("/api/monitor/config")
async def get_monitor_config(current_user: dict = Depends(auth.require_auth)):
    """Return the client's auto-monitoring configuration plus the list of
    zones that monitoring will currently watch (derived from this client's
    own suppliers - never seed data for real clients).
    """
    from main import clients_db, _resolve_suppliers, _ensure_client_defaults

    client_id = current_user["client_id"]
    _ensure_client_defaults(client_id)
    cfg = clients_db.get(client_id, {})
    zones = sorted({
        (s.get("zone") or "").strip()
        for s in _resolve_suppliers(client_id)
        if s.get("zone")
    })
    return {
        "auto_trigger_enabled": cfg.get("auto_trigger_enabled", True),
        "auto_trigger_threshold": float(cfg.get("auto_trigger_threshold", 7.0)),
        "cooldown_hours": int(cfg.get("auto_trigger_cooldown_hours", 6)),
        "monitored_zones": zones,
    }


@monitor_router.put("/api/monitor/config")
async def update_monitor_config(
    req: MonitorConfigRequest,
    current_user: dict = Depends(auth.require_auth),
):
    """Update auto-monitoring settings. Bounds are enforced server-side so a
    malformed frontend (or a curl user) can't disable monitoring with values
    that would silently never trigger."""
    from main import clients_db, _ensure_client_defaults, _save_local_state

    client_id = current_user["client_id"]
    _ensure_client_defaults(client_id)
    profile = clients_db.setdefault(client_id, {})

    profile["auto_trigger_enabled"] = bool(req.auto_trigger_enabled)
    profile["auto_trigger_threshold"] = max(1.0, min(10.0, float(req.threshold)))
    profile["auto_trigger_cooldown_hours"] = max(1, min(24, int(req.cooldown_hours)))

    storage.write_audit(
        event_id="SYSTEM",
        agent="MonitorConfig",
        action="monitor_config_updated",
        input_summary=f"client={client_id}",
        output_summary=(
            f"enabled={profile['auto_trigger_enabled']} "
            f"threshold={profile['auto_trigger_threshold']} "
            f"cooldown_h={profile['auto_trigger_cooldown_hours']}"
        ),
        client_id=client_id,
    )
    _save_local_state()
    return {
        "status": "updated",
        "auto_trigger_enabled": profile["auto_trigger_enabled"],
        "auto_trigger_threshold": profile["auto_trigger_threshold"],
        "cooldown_hours": profile["auto_trigger_cooldown_hours"],
    }
