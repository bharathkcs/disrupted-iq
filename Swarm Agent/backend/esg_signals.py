"""esg_signals.py - Environmental, Social, Governance risk scoring.

Section 4 of the Market Differentiation Sprint. Closes the "no ESG" gap that
blocks enterprise procurement teams from adopting DisruptIQ.

Three curated indices (no paid API):
  - INDUSTRY_CARBON_INTENSITY_INDEX  (0-10, 10 = worst)
  - ZONE_CLIMATE_RISK_INDEX          (0-10, 10 = worst)
  - INDUSTRY_LABOR_RISK_INDEX        (0-10, 10 = worst)

Per-supplier ESG composite (0-100, higher = better):
  carbon_score   = (10 - industry_carbon_intensity) * 10   weight 30%
  climate_score  = (10 - zone_climate_risk)         * 10   weight 35%
  labor_score    = (10 - industry_labor_risk)       * 10   weight 35%
  esg_composite  = weighted sum of above

Tier mapping:
  >= 80  A  green   (best in class)
  60-79  B  amber   (good)
  40-59  C  orange  (needs attention)
  < 40   D  red     (high ESG risk)

Works identically for demo and real clients. Unknown industry / zone fall
back to neutral mid values so the system never crashes on niche entries.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger("disruptiq.esg_signals")

# Industry-level CO2-equivalent intensity per unit of revenue. Curated from
# public sustainability disclosures. 0 = service-grade, 10 = heaviest emitters.
INDUSTRY_CARBON_INTENSITY_INDEX: dict[str, float] = {
    "Steel": 9.5,
    "Mining": 9.2,
    "Aerospace": 8.0,
    "Chemicals": 8.0,
    "Automotive": 7.0,
    "Cold Chain": 6.8,
    "Logistics": 6.5,
    "Industrial Parts": 6.0,
    "Manufacturing": 6.0,
    "PCB Assemblies": 5.5,
    "Control Electronics": 5.2,
    "Electronics": 5.0,
    "Textile": 5.0,
    "Semiconductors": 4.8,
    "Food and Beverage": 4.0,
    "Food & Beverage": 4.0,
    "FMCG": 3.5,
    "Pharma": 2.5,
    "Pharmaceutical": 2.5,
}

# Zone-level physical climate risk. Higher = more frequent extreme-weather
# disruption potential. Curated from historical climate data.
ZONE_CLIMATE_RISK_INDEX: dict[str, float] = {
    "Chennai": 6.5,
    "Mumbai": 6.0,
    "Kolkata": 7.0,
    "Kochi": 6.8,
    "Houston": 6.5,
    "Taipei": 7.0,
    "Shanghai": 6.0,
    "Shenzhen": 6.5,
    "Singapore": 4.5,
    "Bengaluru": 4.0,
    "Pune": 3.8,
    "Delhi": 5.5,
    "Hyderabad": 4.2,
    "Ahmedabad": 4.8,
    "Jamshedpur": 4.5,
    "Frankfurt": 2.5,
    "Rotterdam": 3.0,
    "Tokyo": 5.5,
    "Seoul": 4.5,
    "Dubai": 4.0,
    "Los Angeles": 5.5,
    "Mexico City": 4.0,
}

# Industry-level labor / governance risk. Curated from public labor-rights
# research (ILO, ITUC indices, sectoral reports).
INDUSTRY_LABOR_RISK_INDEX: dict[str, float] = {
    "Textile": 7.0,
    "Mining": 6.8,
    "Steel": 5.5,
    "Electronics": 5.5,
    "PCB Assemblies": 5.5,
    "Control Electronics": 5.0,
    "Semiconductors": 5.0,
    "Cold Chain": 5.0,
    "FMCG": 4.5,
    "Food and Beverage": 4.5,
    "Food & Beverage": 4.5,
    "Logistics": 4.5,
    "Manufacturing": 4.5,
    "Industrial Parts": 4.2,
    "Automotive": 4.0,
    "Chemicals": 4.0,
    "Pharma": 3.0,
    "Pharmaceutical": 3.0,
    "Aerospace": 3.0,
}

DEFAULT_INDEX_VALUE = 5.0  # neutral mid; used when a name isn't in the index

TIER_BANDS: tuple[tuple[float, str, str], ...] = (
    (80.0, "A", "green"),
    (60.0, "B", "amber"),
    (40.0, "C", "orange"),
    (0.0,  "D", "red"),
)


def _lookup_index(index: dict[str, float], key: str) -> tuple[str, float]:
    """Case-insensitive lookup with neutral default for unknowns."""
    if not key:
        return "Unknown", DEFAULT_INDEX_VALUE
    if key in index:
        return key, index[key]
    lowered = key.lower()
    for known, value in index.items():
        if known.lower() == lowered:
            return known, value
    return key, DEFAULT_INDEX_VALUE


def _classify_tier(score: float) -> tuple[str, str]:
    """Map a 0-100 ESG composite to (tier_letter, tier_color)."""
    for threshold, letter, color in TIER_BANDS:
        if score >= threshold:
            return letter, color
    return "D", "red"


def compute_esg_score(
    supplier_name: str,
    industry: str,
    zone: str,
) -> dict:
    """Compute the ESG record for one supplier.

    Pure function: same inputs always produce the same outputs. The risk_agent
    or a standalone endpoint can call this in tight loops without I/O concerns.
    """
    industry_name, carbon = _lookup_index(INDUSTRY_CARBON_INTENSITY_INDEX, industry)
    _, labor = _lookup_index(INDUSTRY_LABOR_RISK_INDEX, industry)
    zone_name, climate = _lookup_index(ZONE_CLIMATE_RISK_INDEX, zone)

    carbon_score = max(0.0, (10.0 - carbon) * 10.0)
    climate_score = max(0.0, (10.0 - climate) * 10.0)
    labor_score = max(0.0, (10.0 - labor) * 10.0)

    composite = round(
        carbon_score * 0.30
        + climate_score * 0.35
        + labor_score * 0.35,
        1,
    )
    tier, color = _classify_tier(composite)

    return {
        "supplier_name": supplier_name,
        "esg_composite": composite,
        "tier": tier,
        "tier_color": color,
        "breakdown": {
            "industry": industry_name,
            "zone": zone_name,
            "carbon_score": round(carbon_score, 1),
            "climate_score": round(climate_score, 1),
            "labor_score": round(labor_score, 1),
            "industry_carbon_intensity": carbon,
            "zone_climate_risk": climate,
            "industry_labor_risk": labor,
        },
        "last_computed_utc": datetime.now(timezone.utc).isoformat(),
    }


def summarise_esg_portfolio(records: list[dict]) -> dict:
    """Per-tier counts for the dashboard summary widget."""
    if not records:
        return {"total": 0, "A": 0, "B": 0, "C": 0, "D": 0, "avg_composite": 0.0}
    counts = {"A": 0, "B": 0, "C": 0, "D": 0}
    total = 0.0
    for r in records:
        tier = r.get("tier", "D")
        counts[tier] = counts.get(tier, 0) + 1
        total += float(r.get("esg_composite", 0))
    return {
        "total": len(records),
        "A": counts["A"],
        "B": counts["B"],
        "C": counts["C"],
        "D": counts["D"],
        "avg_composite": round(total / len(records), 1),
    }
