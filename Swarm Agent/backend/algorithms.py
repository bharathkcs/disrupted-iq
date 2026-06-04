"""
algorithms.py — DisruptIQ's three domain-specific algorithms.

These formalize the quantitative logic used across the swarm. Each function
documents its formula, intuition, and the prior art it extends. They are the
named, citable algorithms behind MCAS (Memory-Calibrated Agent Swarm).
"""

import logging

logger = logging.getLogger(__name__)


def memory_calibrated_forecast(
    base_forecast: float,
    historical_records: list[dict],
    memory_weight: float = 0.5,
    max_adjustment: float = 0.30,
) -> dict:
    """
    MCF — Memory-Calibrated Forecast.

    Formula:
        forecast_{t+1} = base_forecast
                         + memory_weight * mean(historical_actual - historical_predicted)

    Intuition:
        A Bayesian-style online calibration loop. Each resolved event contributes
        an (actual - predicted) delta. The mean delta nudges the next forecast
        toward reality. Bounded by `max_adjustment` to prevent overcorrection.

    Prior art:
        Extends online/Bayesian calibration; novel in being driven by agent-swarm
        counterfactual write-backs rather than a static training set.

    Args:
        base_forecast: The raw forecast from the heuristic/LLM (e.g. -15.0 for -15%).
        historical_records: Stage-2 memory dicts with
            'predicted_demand_shift' and 'actual_demand_shift'.
        memory_weight: How strongly history adjusts the base (0.0-1.0).
        max_adjustment: Cap on the absolute adjustment as a fraction of base.

    Returns:
        dict with calibrated_forecast, adjustment_applied, confidence_boost,
        sample_size.
    """
    if not historical_records:
        return {
            "calibrated_forecast": round(base_forecast, 2),
            "adjustment_applied": 0.0,
            "confidence_boost": 0.0,
            "sample_size": 0,
        }

    deltas = [
        r.get("actual_demand_shift", 0) - r.get("predicted_demand_shift", 0)
        for r in historical_records
        if "actual_demand_shift" in r and "predicted_demand_shift" in r
    ]
    if not deltas:
        return {
            "calibrated_forecast": round(base_forecast, 2),
            "adjustment_applied": 0.0,
            "confidence_boost": 0.0,
            "sample_size": 0,
        }

    mean_delta = sum(deltas) / len(deltas)
    raw_adjustment = memory_weight * mean_delta

    # Bound the adjustment to +/- max_adjustment * |base_forecast|
    cap = abs(base_forecast) * max_adjustment if base_forecast else max_adjustment * 10
    adjustment = max(-cap, min(cap, raw_adjustment))

    calibrated = base_forecast + adjustment

    # More confirming records => more confidence (caps at +15 pts at n>=5)
    confidence_boost = min(len(deltas) * 3.0, 15.0)

    return {
        "calibrated_forecast": round(calibrated, 2),
        "adjustment_applied": round(adjustment, 2),
        "confidence_boost": round(confidence_boost, 1),
        "sample_size": len(deltas),
    }


def compound_cascade_severity(
    severity_a: float,
    severity_b: float,
    shared_suppliers: int,
    total_at_risk: int,
    cascade_multiplier: float = 1.2,
) -> dict:
    """
    CCS — Compound Cascade Severity.

    Formula:
        shared_zone_factor = 1 + (shared_suppliers / total_at_risk)
        combined_severity  = max(s_a, s_b) * cascade_multiplier * shared_zone_factor

    Intuition:
        Two overlapping disruptions are worse than the sum of their parts when
        they share suppliers. The shared_zone_factor scales severity up as the
        overlap of affected suppliers grows.

    Prior art:
        Extends compound-risk modeling; novel in tying severity escalation to
        the concrete supplier-overlap ratio inside an agent swarm.

    Returns:
        dict with combined_severity (capped at 10), shared_zone_factor, base_severity.
    """
    if total_at_risk <= 0:
        shared_zone_factor = 1.0
    else:
        shared_zone_factor = 1 + (shared_suppliers / total_at_risk)

    base = max(severity_a, severity_b)
    combined = base * cascade_multiplier * shared_zone_factor

    return {
        "combined_severity": round(min(combined, 10.0), 2),
        "shared_zone_factor": round(shared_zone_factor, 3),
        "base_severity": round(base, 2),
        "cascade_multiplier": cascade_multiplier,
    }


def multi_signal_dissent_score(
    forecast_signal: float,
    risk_signal: float,
    max_signal: float = 100.0,
    confidence_high: bool = True,
    dissent_threshold: float = 0.15,
) -> dict:
    """
    MSDS — Multi-Signal Dissent Score.

    Formula:
        divergence       = |forecast_signal - risk_signal| / max_signal
        dissent_detected = divergence > threshold AND confidence_high

    Intuition:
        When the forecast agent and the risk agent disagree substantially AND
        the system is otherwise confident, that disagreement is meaningful and
        should force a human checkpoint rather than be silently averaged away.

    Prior art:
        Extends ensemble-disagreement detection; novel in gating a server-side
        human-in-the-loop checkpoint on the divergence of two specialized agents.

    Returns:
        dict with divergence, dissent_detected, threshold.
    """
    if max_signal <= 0:
        max_signal = 100.0

    divergence = abs(forecast_signal - risk_signal) / max_signal
    dissent_detected = (divergence > dissent_threshold) and confidence_high

    return {
        "divergence": round(divergence, 4),
        "divergence_pct": round(divergence * 100, 1),
        "dissent_detected": dissent_detected,
        "threshold": dissent_threshold,
    }
