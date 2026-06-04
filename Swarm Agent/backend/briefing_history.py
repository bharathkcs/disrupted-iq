"""briefing_history.py - Daily disruption-risk briefing persistence.

Section 7 of the Market Differentiation Sprint. The existing
``predict_disruption_risk`` agent already computes a live 0-100 score per
client; this module stores one snapshot per client per UTC day so the user
can see a 14-day trend instead of just "today".

Strictly in-memory (loaded/saved alongside main's local_state.json shim).
Per-client list is capped so a long-running server cannot grow unbounded.

Schema (one record):
  {
    "client_id":     str,
    "date":          "YYYY-MM-DD"  (UTC),
    "score":         int,           # 0-100
    "tier":          "low"|"medium"|"high"|"none",
    "zone_count":    int,
    "supplier_count": int,
    "captured_at_utc": ISO-8601,
  }
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("disruptiq.briefing_history")

# In-memory store: {client_id: [briefing_record, ...]} - newest LAST
_history: dict[str, list[dict]] = {}

MAX_RECORDS_PER_CLIENT = 90  # keep ~3 months


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append_briefing(client_id: str, briefing: dict) -> Optional[dict]:
    """Append a briefing snapshot for client_id, idempotent per UTC day.

    If a snapshot already exists for today, the function is a no-op and
    returns None - this prevents the daily loop from double-recording if
    it ticks twice in a single day.
    """
    if not client_id:
        return None
    today = _today_utc()
    records = _history.setdefault(client_id, [])
    if records and records[-1].get("date") == today:
        return None  # already captured today

    record = {
        "client_id": client_id,
        "date": today,
        "score": int(briefing.get("score", 0)),
        "tier": briefing.get("tier", "none"),
        "zone_count": len(briefing.get("zones", []) or []),
        "supplier_count": briefing.get("supplier_count", 0),
        "captured_at_utc": _now_utc_iso(),
    }
    records.append(record)
    # Keep the list bounded (oldest dropped first)
    if len(records) > MAX_RECORDS_PER_CLIENT:
        del records[: len(records) - MAX_RECORDS_PER_CLIENT]
    return record


def get_briefing_history(client_id: str, days: int = 30) -> list[dict]:
    """Return the most recent `days` snapshots for the client, newest first."""
    if not client_id or days <= 0:
        return []
    records = _history.get(client_id, [])
    # Snapshot is appended at the end; return newest first for the UI.
    return list(reversed(records[-days:]))


def reset(client_id: Optional[str] = None) -> None:
    """Clear history - used by tests and admin tooling."""
    if client_id is None:
        _history.clear()
    else:
        _history.pop(client_id, None)


def stats() -> dict:
    """Aggregate stats useful for admin diagnostics."""
    return {
        "clients_tracked": len(_history),
        "total_records": sum(len(v) for v in _history.values()),
    }
