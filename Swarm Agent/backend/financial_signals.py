"""financial_signals.py - Supplier Financial Health assessment.

Section 2 of the Market Differentiation Sprint. Closes the "insolvency blind
spot" gap by adding a 6th, inferred factor on top of the existing 5-factor
risk score.

Design choices:
  - No paid API. Everything is inference from public signals already
    available: industry sector stress, supplier-news distress mentions,
    and operational proxies (buffer + reliability).
  - Dataset-agnostic. Works identically for the demo seed client and for
    any real client who has uploaded their own suppliers. Categories that
    aren't in the curated stress index fall back to a neutral mid value.
  - Deterministic. Same inputs always produce the same outputs, so two
    consecutive risk runs over the same supplier list yield identical
    financial-health scores.

Scoring (0-100, higher == healthier):
  Factor 1 (40%): sector_score = (10 - sector_stress) * 10
  Factor 2 (40%): news_score   = 100 - (distress_mentions * 15), floored at 0
  Factor 3 (20%): operational  = reliability * 0.6 + min(buffer*2, 100) * 0.4

Tier mapping (final_score):
  >= 75  Stable    (green)
  55-74  Watch     (amber)
  35-54  At Risk   (orange)
  < 35   Critical  (red)

Tier-to-risk feedback (used by risk_agent when enrichment is enabled):
  Stable     +0
  Watch      +0
  At Risk    +5
  Critical   +12
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable

logger = logging.getLogger("disruptiq.financial_signals")

# Sector-level stress index. 0 = healthy industry, 10 = severe distress.
# Curated from public macro indicators; revise quarterly.
SECTOR_STRESS_INDEX: dict[str, float] = {
    "Electronics": 4.2,
    "Automotive": 3.8,
    "Pharma": 2.1,
    "Pharmaceutical": 2.1,
    "FMCG": 2.8,
    "Logistics": 4.5,
    "Textile": 5.1,
    "Steel": 4.8,
    "Aerospace": 2.5,
    "Food and Beverage": 3.1,
    "Food & Beverage": 3.1,
    "Chemicals": 3.7,
    "Cold Chain": 3.9,
    "Industrial Parts": 4.0,
    "Mining": 5.5,
    "Manufacturing": 4.0,
    "Semiconductors": 4.4,
    "PCB Assemblies": 4.3,
    "Control Electronics": 4.2,
}

DEFAULT_SECTOR_STRESS = 4.0  # neutral fallback for unknown categories

FINANCIAL_DISTRESS_KEYWORDS: tuple[str, ...] = (
    "bankruptcy", "insolvency", "liquidation", "receiver",
    "layoffs", "restructuring", "debt default", "credit downgrade",
    "wound up", "major losses", "financial distress",
    "plant closure", "job cuts", "default", "cash crunch",
    "liquidity crisis", "covenant breach",
)

DISTRESS_PENALTY_PER_HIT = 15.0
MAX_DISTRESS_HITS = 6  # floor news_score at 10 even if 100 articles match


def _resolve_sector(category: str) -> tuple[str, float]:
    """Return (canonical_sector_name, stress_value). Unknown categories map
    to a neutral default so we don't penalise the long tail of niche sectors.
    """
    if not category:
        return "Unknown", DEFAULT_SECTOR_STRESS
    if category in SECTOR_STRESS_INDEX:
        return category, SECTOR_STRESS_INDEX[category]
    # Case-insensitive lookup as a courtesy for raw uploads
    lowered = category.lower()
    for known, stress in SECTOR_STRESS_INDEX.items():
        if known.lower() == lowered:
            return known, stress
    return category, DEFAULT_SECTOR_STRESS


def _count_distress_signals(news_alerts: Iterable[dict]) -> tuple[int, list[str]]:
    """Count how many news alerts mention financial distress and return the
    matched keywords (capped) for explainability.
    """
    if not news_alerts:
        return 0, []
    count = 0
    matched: list[str] = []
    for alert in news_alerts:
        headline = str((alert.get("headline") or alert.get("title") or "")).lower()
        description = str(alert.get("description") or "").lower()
        body = headline + " " + description
        for kw in FINANCIAL_DISTRESS_KEYWORDS:
            if kw in body:
                count += 1
                if kw not in matched:
                    matched.append(kw)
                break  # one signal per alert
    return count, matched[:5]


def _classify_tier(score: float) -> tuple[str, str, int]:
    """Map a 0-100 health score to (tier_name, color, risk_adjustment_points)."""
    if score >= 75:
        return "Stable", "green", 0
    if score >= 55:
        return "Watch", "amber", 0
    if score >= 35:
        return "At Risk", "orange", 5
    return "Critical", "red", 12


def compute_financial_health(
    supplier_name: str,
    supplier_category: str,
    reliability_pct: float,
    buffer_days: float,
    news_alerts: Iterable[dict] | None = None,
) -> dict:
    """Compute a financial-health record for one supplier.

    Returns a dict with score, tier, risk_adjustment, and a breakdown that
    callers can show in the UI (factor scores + matched distress keywords).

    Synchronous and side-effect free: tests and the risk agent can call this
    in tight loops without worrying about I/O.
    """
    sector_name, sector_stress = _resolve_sector(supplier_category or "")
    sector_score = max(0.0, (10.0 - sector_stress) * 10.0)

    distress_hits, matched_keywords = _count_distress_signals(news_alerts or [])
    distress_hits = min(distress_hits, MAX_DISTRESS_HITS)
    news_score = max(0.0, 100.0 - (distress_hits * DISTRESS_PENALTY_PER_HIT))

    rel = max(0.0, min(float(reliability_pct or 0), 100.0))
    buf = max(0.0, float(buffer_days or 0))
    operational_score = (rel * 0.6) + (min(buf * 2.0, 100.0) * 0.4)

    final_score = round(
        sector_score * 0.40 + news_score * 0.40 + operational_score * 0.20,
        1,
    )
    tier, color, risk_adjustment = _classify_tier(final_score)

    return {
        "supplier_name": supplier_name,
        "financial_health_score": final_score,
        "tier": tier,
        "tier_color": color,
        "risk_adjustment": risk_adjustment,
        "breakdown": {
            "sector": sector_name,
            "sector_stress": sector_stress,
            "sector_score": round(sector_score, 1),
            "news_score": round(news_score, 1),
            "operational_score": round(operational_score, 1),
            "distress_hits": distress_hits,
            "matched_distress_signals": matched_keywords,
        },
        "last_computed_utc": datetime.now(timezone.utc).isoformat(),
    }


def summarise_portfolio(records: list[dict]) -> dict:
    """Aggregate per-supplier records into a portfolio-level summary suitable
    for the dashboard widget.
    """
    if not records:
        return {"total": 0, "critical": 0, "at_risk": 0, "watch": 0, "stable": 0}
    counter = {"Critical": 0, "At Risk": 0, "Watch": 0, "Stable": 0}
    for r in records:
        counter[r.get("tier", "Stable")] = counter.get(r.get("tier", "Stable"), 0) + 1
    return {
        "total": len(records),
        "critical": counter["Critical"],
        "at_risk": counter["At Risk"],
        "watch": counter["Watch"],
        "stable": counter["Stable"],
    }
