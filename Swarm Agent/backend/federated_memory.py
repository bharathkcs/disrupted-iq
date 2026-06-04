"""federated_memory.py - Anonymised cross-tenant baseline memory.

Section 5 of the Market Differentiation Sprint. Closes the "cold-start
problem": a brand new client has no Stage-2 records of their own, so the
existing MCF (Memory-Calibrated Forecast) can't calibrate their first events.

Approach:
  When the platform has Stage-2 outcomes from 3+ distinct clients matching
  the same (event_type, geography), publish an *anonymised aggregate*:
    {sample_size, mean_actual_demand_shift, mean_actual_cost_impact, ...}
  k-anonymity is enforced (default k = 3) so no single client's data can be
  reverse-engineered from the aggregate.

The forecast agent can then blend this federated baseline at reduced weight
(default 0.5) into its MCF calculation, accelerating learning for new
clients while protecting tenant privacy.

Strictly internal. No client_ids ever leave this module; the caller only
sees counts and aggregate floats.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from statistics import mean
from typing import Optional

import storage

logger = logging.getLogger("disruptiq.federated_memory")

K_ANONYMITY_MIN = 3            # minimum distinct clients before publishing
FEDERATED_WEIGHT_DEFAULT = 0.5  # multiplier when blending into own-history MCF


def _normalize(value: str) -> str:
    return (value or "").strip().lower()


def aggregate_baseline(event_type: str, geography: str) -> Optional[dict]:
    """Compute an anonymised baseline for (event_type, geography).

    Returns None when fewer than K_ANONYMITY_MIN distinct clients contributed,
    so a single client's data can never be inferred. Returns a structured
    aggregate dict otherwise.
    """
    if not event_type or not geography:
        return None
    et_norm = _normalize(event_type)
    geo_norm = _normalize(geography)

    records = [
        r for r in storage.get_memory_store(5000)
        if r.get("stage") == 2
        and _normalize(r.get("event_type", "")) == et_norm
        and _normalize(r.get("geography", "")) == geo_norm
    ]
    if not records:
        return None

    distinct_clients = {r.get("client_id") for r in records if r.get("client_id")}
    if len(distinct_clients) < K_ANONYMITY_MIN:
        return None

    demand_shifts = [
        float(r["actual_demand_shift"])
        for r in records
        if r.get("actual_demand_shift") is not None
    ]
    cost_impacts = [
        float(r["actual_cost_impact"])
        for r in records
        if r.get("actual_cost_impact") is not None
    ]
    recovery_days = [
        float(r["actual_recovery_days"])
        for r in records
        if r.get("actual_recovery_days") is not None
    ]

    # Confidence band based on how many contributing events we have
    n = len(records)
    if n >= 12:
        confidence = "high"
    elif n >= 6:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "event_type": event_type,
        "geography": geography,
        "sample_size": n,
        "contributing_clients": len(distinct_clients),
        "mean_actual_demand_shift": round(mean(demand_shifts), 2) if demand_shifts else None,
        "mean_actual_cost_impact": round(mean(cost_impacts), 2) if cost_impacts else None,
        "mean_recovery_days": round(mean(recovery_days), 1) if recovery_days else None,
        "confidence": confidence,
        "k_anonymity_min": K_ANONYMITY_MIN,
        "is_anonymised": True,
        "last_computed_utc": datetime.now(timezone.utc).isoformat(),
    }


def get_baseline_for_forecast(
    event_type: str,
    geography: str,
    own_stage2_count: int = 0,
) -> Optional[dict]:
    """Helper for the Forecast agent. Returns a baseline only when the
    caller has NO own Stage-2 history yet - federated data should accelerate
    cold start, not override calibrated own-history when it exists.
    """
    if own_stage2_count > 0:
        return None
    return aggregate_baseline(event_type, geography)
