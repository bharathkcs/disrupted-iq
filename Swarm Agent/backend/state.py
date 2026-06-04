"""
state.py — Centralized accessors for cross-module shared state.

The historical layout puts most mutable state (users_db, clients_db,
swarm_states, audit_log, etc.) on module-level dicts in ``main.py`` and lets
route modules pull them in via lazy ``from main import ...`` calls inside each
handler. That avoided a circular import but spread the lazy-import pattern
across every route file.

This module is the forward path. It exposes thin getter helpers so route
modules and tests can ``from state import get_client_suppliers`` without
importing ``main``. Each getter dispatches through ``main`` lazily so the
existing dictionaries remain the single source of truth (no double-bookkeeping
between this module and ``main.py``).

When you add a new shared structure, prefer registering a getter here over
adding a fresh lazy ``from main import ...`` inside another route handler.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("disruptiq.state")


def _main():
    """Lazy import of the live ``main`` module so callers don't trigger a circular import at import time."""
    import main as _m  # noqa: WPS433 — intentional runtime import
    return _m


# ─────────────────────────────────────────────────────────────────────────────
# Shared-state getters
# ─────────────────────────────────────────────────────────────────────────────

def get_swarm_states() -> dict:
    """Return ``{client_id: {event_id: state_dict}}`` — live partitioned swarm state."""
    return _main().swarm_states


def get_users_db() -> dict:
    return _main().users_db


def get_clients_db() -> dict:
    return _main().clients_db


def get_sessions_db() -> dict:
    return _main().sessions_db


def get_custom_scenarios_db() -> dict:
    return _main().custom_scenarios_db


def get_notifications_db() -> dict:
    return _main().notifications_db


def get_premium_requests_db() -> list:
    return _main().premium_requests_db


def get_self_deletions_db() -> list:
    return _main().self_deletions_db


def get_seed_client_ids() -> set:
    return _main().SEED_CLIENT_IDS


# ─────────────────────────────────────────────────────────────────────────────
# Higher-level helpers — useful for routes and tests
# ─────────────────────────────────────────────────────────────────────────────

def get_client_suppliers(client_id: str) -> list[dict]:
    """Resolve a client's suppliers.

    Returns the empty list for a non-seed client with no uploaded suppliers —
    never falls back to seed data (prevents demo-data leaks to real tenants).
    """
    m = _main()
    return m._resolve_suppliers(client_id)


def get_client_memory(client_id: str, stage: int | None = None) -> list[dict]:
    """Return memory records for one client. Filter by stage (1 or 2) if given."""
    import storage  # local import — storage is the authoritative memory store
    cont = storage._mem_swarm_memory
    out = []
    for rec in cont:
        if rec.get("client_id") != client_id:
            continue
        if stage is not None and rec.get("stage") != stage:
            continue
        out.append(rec)
    return out


def is_seed_client(client_id: str | None) -> bool:
    if not client_id:
        return False
    try:
        return client_id in get_seed_client_ids()
    except Exception as exc:
        logger.debug("is_seed_client lookup failed (main not yet initialised?): %s", exc)
        return False


def get_event(event_id: str) -> dict | None:
    """Locate one event across all client partitions."""
    states = get_swarm_states()
    for events in states.values():
        if event_id in events:
            return events[event_id]
    return None


def find_client_for_event(event_id: str) -> str | None:
    states = get_swarm_states()
    for cid, events in states.items():
        if event_id in events:
            return cid
    return None
