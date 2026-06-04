"""tier2_inference.py - Probabilistic Tier-2 dependency inference.

Section 3 of the Market Differentiation Sprint. Closes the "Tier-1 only" gap
without trying to compete with Resilinc-style hand-curated supplier databases.

Approach:
  Real Tier-2 visibility requires years of supplier surveys. Instead we infer
  the most likely Tier-2 dependencies from each Tier-1 category using a
  curated domain knowledge graph that maps "if you have an Electronics
  supplier, you almost certainly depend on Semiconductor Wafers, PCB
  Manufacturing, Rare Earth Minerals" etc.

  Every Tier-2 node is clearly flagged ``is_estimated: True``. Confidence
  scores (0-1) are surfaced so the UI can distinguish high-confidence
  inferences from speculative ones.

Single-Point-of-Failure (SPOF) detection:
  A Tier-2 category that:
    - is depended on by 3+ Tier-1 suppliers (or 50%+ of the portfolio), AND
    - has inference confidence >= 0.80
  is flagged as a structural single-point-of-failure. The dashboard
  highlights these in red because losing that one Tier-2 input affects
  most of the client's Tier-1 base simultaneously.

Works identically for demo (seed categories) and real clients (uploaded
categories). When the supplier list is empty, returns an empty result with
a helpful message.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("disruptiq.tier2_inference")

# Knowledge graph: Tier-1 category -> list of (tier2_category, zone_hint, confidence_0_to_1)
TIER2_KNOWLEDGE_GRAPH: dict[str, list[tuple[str, str, float]]] = {
    "Electronics": [
        ("Semiconductor Wafers", "Taiwan, South Korea", 0.85),
        ("Rare Earth Minerals", "China, Australia", 0.80),
        ("PCB Manufacturing", "China, Vietnam", 0.75),
        ("Packaging Materials", "India, Malaysia", 0.60),
    ],
    "Automotive": [
        ("Steel", "India, China, Japan", 0.90),
        ("Electronics", "Germany, Japan", 0.85),
        ("Rubber", "Thailand, India", 0.80),
        ("Glass", "India, China", 0.65),
        ("Plastics", "India, Germany", 0.70),
    ],
    "Pharma": [
        ("Active Pharmaceutical Ingredients", "China, India", 0.90),
        ("Chemical Reagents", "Germany, China", 0.80),
        ("Packaging (Glass/Plastic)", "India, Europe", 0.65),
        ("Cold Chain Logistics", "India", 0.75),
    ],
    "Pharmaceutical": [
        ("Active Pharmaceutical Ingredients", "China, India", 0.90),
        ("Chemical Reagents", "Germany, China", 0.80),
        ("Packaging (Glass/Plastic)", "India, Europe", 0.65),
        ("Cold Chain Logistics", "India", 0.75),
    ],
    "FMCG": [
        ("Agricultural Commodities", "India, Brazil", 0.85),
        ("Packaging Materials", "India, China", 0.80),
        ("Flavours & Additives", "Germany, USA", 0.60),
    ],
    "Logistics": [
        ("Fuel & Energy", "Gulf States, India", 0.90),
        ("Vehicle Parts", "India, Germany", 0.80),
        ("Warehousing Infrastructure", "India", 0.70),
    ],
    "Steel": [
        ("Iron Ore", "Australia, Brazil, India", 0.90),
        ("Coking Coal", "Australia, USA", 0.85),
        ("Scrap Metal", "India, USA", 0.70),
        ("Energy", "India", 0.80),
    ],
    "Chemicals": [
        ("Crude Oil", "Gulf States", 0.85),
        ("Natural Gas", "Gulf States, Russia", 0.80),
        ("Minerals", "India, China", 0.70),
    ],
    "Cold Chain": [
        ("Refrigeration Components", "China, Germany", 0.85),
        ("Energy", "India", 0.90),
        ("Packaging (Insulated)", "India, China", 0.70),
    ],
    "Industrial Parts": [
        ("Raw Steel", "India, Japan", 0.80),
        ("Machining Services", "India, China", 0.75),
        ("Fasteners", "India, Germany", 0.70),
    ],
    "Food and Beverage": [
        ("Agricultural Raw Materials", "India, Brazil", 0.85),
        ("Spices & Ingredients", "India, Vietnam", 0.80),
        ("Packaging (Food-grade)", "India, China", 0.70),
    ],
    "Mining": [
        ("Explosives & Blasting", "India, USA", 0.75),
        ("Heavy Equipment Parts", "Germany, USA", 0.70),
        ("Land Transport", "India", 0.80),
    ],
    "Textile": [
        ("Raw Cotton", "India, Vietnam, Brazil", 0.85),
        ("Dyes & Chemicals", "China, Germany", 0.75),
        ("Machinery Parts", "Germany, India", 0.70),
    ],
    "Aerospace": [
        ("Precision Machining", "Germany, USA", 0.80),
        ("Composite Materials", "USA, Europe", 0.75),
        ("Electronics", "Germany, USA", 0.80),
    ],
    "PCB Assemblies": [
        ("PCB Manufacturing", "China, Vietnam, India", 0.85),
        ("Solder & Flux", "Germany, China", 0.70),
        ("Electronic Components", "Taiwan, China", 0.85),
    ],
    "Control Electronics": [
        ("Semiconductor Wafers", "Taiwan, South Korea", 0.80),
        ("Sensors", "Germany, Japan", 0.75),
        ("Passive Components", "Japan, China", 0.70),
    ],
    # ── Logistics sub-categories ─────────────────────────────────────────────
    "Air Freight": [
        ("Aviation Fuel", "Gulf States, Singapore", 0.90),
        ("Aircraft Maintenance Parts", "USA, Germany", 0.75),
        ("Airport Handling Equipment", "Germany, India", 0.65),
    ],
    "Ocean Freight": [
        ("Marine Fuel (Bunker)", "Singapore, Rotterdam", 0.90),
        ("Container Manufacturing", "China, South Korea", 0.80),
        ("Port Equipment", "China, Germany", 0.70),
    ],
    "Rail Freight": [
        ("Railway Track Components", "India, China, Germany", 0.80),
        ("Locomotive Parts", "Germany, India", 0.75),
        ("Fuel & Energy", "India, Gulf States", 0.85),
    ],
    "Cross-Docking": [
        ("Warehouse Racking & Equipment", "India, China", 0.75),
        ("Material Handling Systems", "Germany, China", 0.70),
        ("Fuel & Energy", "India, Gulf States", 0.80),
    ],
    "Express Courier": [
        ("Vehicle Parts", "India, Germany", 0.80),
        ("Fuel & Energy", "India, Gulf States", 0.85),
        ("Packaging Materials", "India, China", 0.65),
    ],
    "Last-Mile Delivery": [
        ("Vehicle Parts", "India, Germany", 0.85),
        ("Fuel & Energy", "India, Gulf States", 0.90),
        ("Digital Mapping / GPS", "USA, India", 0.60),
    ],
    "Freight Forwarding": [
        ("Port & Customs Services", "India, Singapore", 0.80),
        ("Fuel & Energy", "Gulf States, India", 0.85),
        ("Packaging & Labelling", "India, China", 0.65),
    ],
    "Warehousing": [
        ("Warehouse Racking & Equipment", "India, China", 0.75),
        ("Security Systems", "Germany, India", 0.65),
        ("Fuel & Energy", "India", 0.80),
    ],
    # ── Automotive sub-categories ────────────────────────────────────────────
    "Wiring Harness": [
        ("Copper Wire & Cables", "India, Chile, China", 0.90),
        ("Plastic Insulation Compounds", "Germany, India", 0.80),
        ("Connector Components", "Germany, Japan, China", 0.85),
    ],
    "Brake Systems": [
        ("Steel", "India, China, Japan", 0.85),
        ("Friction Materials", "Germany, India", 0.80),
        ("Hydraulic Fluids", "Germany, USA", 0.70),
    ],
    "Chassis Parts": [
        ("Steel", "India, China, Japan", 0.90),
        ("Aluminium Castings", "India, Germany", 0.80),
        ("Surface Treatment Chemicals", "Germany, China", 0.65),
    ],
    "Transmission Parts": [
        ("Alloy Steel", "Japan, Germany, India", 0.85),
        ("Precision Bearings", "Germany, Japan", 0.80),
        ("Lubricants & Gear Oil", "Germany, India", 0.70),
    ],
    "Engine Components": [
        ("Alloy Steel", "Japan, Germany, India", 0.90),
        ("Aluminium Alloys", "India, Germany", 0.80),
        ("Precision Castings", "India, China", 0.75),
    ],
    "Forged Components": [
        ("Steel Billets", "India, Japan, Germany", 0.90),
        ("Forging Dies", "Germany, India", 0.75),
        ("Heat Treatment Services", "India, Germany", 0.70),
    ],
    "Steel Stampings": [
        ("Steel Coils", "India, Japan, South Korea", 0.90),
        ("Stamping Dies & Tooling", "Germany, India", 0.75),
        ("Surface Coating Chemicals", "Germany, China", 0.65),
    ],
    "Suspension Parts": [
        ("Steel", "India, China, Japan", 0.90),
        ("Rubber Bushings", "India, Thailand", 0.80),
        ("Aluminium Extrusions", "India, Germany", 0.70),
    ],
    "Powertrain Components": [
        ("Alloy Steel", "Japan, Germany, India", 0.90),
        ("Precision Machining Services", "India, Germany", 0.80),
        ("Electronics", "Germany, Japan", 0.75),
    ],
    "Lighting Systems": [
        ("LED Components", "China, Taiwan", 0.85),
        ("Plastic Compounds", "Germany, India", 0.70),
        ("Connector Components", "Germany, Japan, China", 0.75),
    ],
    "Electronic Control Units": [
        ("Semiconductor Wafers", "Taiwan, South Korea", 0.85),
        ("PCB Manufacturing", "China, Vietnam, India", 0.80),
        ("Passive Components", "Japan, China", 0.75),
    ],
    "Plastics": [
        ("Crude Oil / Petrochemicals", "Gulf States, India", 0.90),
        ("Polymer Compounds", "Germany, India, China", 0.85),
        ("Additives & Colorants", "Germany, China", 0.65),
    ],
    # ── Steel / Metal sub-categories ─────────────────────────────────────────
    "Steel Manufacturing": [
        ("Iron Ore", "Australia, Brazil, India", 0.90),
        ("Coking Coal", "Australia, USA", 0.85),
        ("Energy", "India", 0.80),
    ],
    "Machined Parts": [
        ("Raw Steel / Aluminium", "India, Japan, Germany", 0.85),
        ("Cutting Tools", "Germany, Japan", 0.80),
        ("CNC Machine Parts", "Germany, Japan, China", 0.70),
    ],
}

SPOF_CONFIDENCE_THRESHOLD = 0.80
SPOF_MIN_DEPENDENT_SUPPLIERS = 3


def infer_tier2_dependencies(client_suppliers: list[dict]) -> list[dict]:
    """Infer probable Tier-2 dependencies from a client's Tier-1 supplier list.

    For each Tier-1 supplier, look up its categories in the knowledge graph
    and accumulate the implied Tier-2 categories. Returns a sorted list of
    Tier-2 nodes, each with the Tier-1 suppliers that depend on it, the
    probable geography hint, and a confidence score.

    Pure function - no I/O, no globals beyond the static knowledge graph.
    """
    if not client_suppliers:
        return []

    # Group Tier-1 suppliers by their categories so we can deduplicate
    # dependencies that come from multiple suppliers sharing a category.
    tier1_by_category: dict[str, list[dict]] = {}
    for supplier in client_suppliers:
        cats = supplier.get("categories") or []
        for raw_cat in cats:
            cat = str(raw_cat).strip()
            if not cat:
                continue
            tier1_by_category.setdefault(cat, []).append(supplier)

    if not tier1_by_category:
        return []

    # Build the Tier-2 inferences, keyed by tier2_category for dedup.
    tier2_nodes: dict[str, dict] = {}

    _kg_lower = {k.lower(): k for k in TIER2_KNOWLEDGE_GRAPH}

    def _resolve_kg_key(cat: str) -> str | None:
        """Return the matching knowledge-graph key for a Tier-1 category.

        Tries (in order): exact → case-insensitive exact → substring containment.
        Returns None when no match is found.
        """
        if cat in TIER2_KNOWLEDGE_GRAPH:
            return cat
        low = cat.lower()
        if low in _kg_lower:
            return _kg_lower[low]
        for kg_low, kg_key in _kg_lower.items():
            if low in kg_low or kg_low in low:
                return kg_key
        return None

    for tier1_cat, suppliers_in_cat in tier1_by_category.items():
        resolved_key = _resolve_kg_key(tier1_cat)
        inferred_deps = TIER2_KNOWLEDGE_GRAPH.get(resolved_key, []) if resolved_key else []
        if not inferred_deps:
            continue
        for tier2_cat, zone_hint, confidence in inferred_deps:
            node = tier2_nodes.get(tier2_cat)
            if node is None:
                node = {
                    "tier2_category": tier2_cat,
                    "probable_zones": zone_hint,
                    "confidence": confidence,
                    "dependent_tier1_categories": [],
                    "dependent_tier1_suppliers": [],
                    "is_estimated": True,
                }
                tier2_nodes[tier2_cat] = node
            if tier1_cat not in node["dependent_tier1_categories"]:
                node["dependent_tier1_categories"].append(tier1_cat)
            for s in suppliers_in_cat:
                name = s.get("name")
                if name and name not in node["dependent_tier1_suppliers"]:
                    node["dependent_tier1_suppliers"].append(name)
            # Aggregate confidence: take the highest reported confidence
            # across the Tier-1 categories that surface this Tier-2 node.
            if confidence > node["confidence"]:
                node["confidence"] = confidence

    # Finalise exposure counts and sort by (exposure_count * confidence) DESC.
    for node in tier2_nodes.values():
        node["exposure_count"] = len(node["dependent_tier1_suppliers"])

    return sorted(
        tier2_nodes.values(),
        key=lambda n: n["exposure_count"] * n["confidence"],
        reverse=True,
    )


def identify_tier2_single_points_of_failure(
    tier2_nodes: list[dict],
    tier1_count: int = 0,
) -> list[dict]:
    """Flag Tier-2 categories that are structural single-points-of-failure.

    A Tier-2 node qualifies as a SPOF when:
      - confidence >= SPOF_CONFIDENCE_THRESHOLD (>= 0.80), AND
      - exposure_count >= SPOF_MIN_DEPENDENT_SUPPLIERS (>= 3),
        OR exposure_count >= 50% of the client's Tier-1 supplier count
        (whichever is lower for small portfolios).

    Returns nodes annotated with ``is_spof: True``.
    """
    if not tier2_nodes:
        return []
    half_portfolio = max(1, (tier1_count // 2))
    threshold = min(SPOF_MIN_DEPENDENT_SUPPLIERS, half_portfolio) if tier1_count else SPOF_MIN_DEPENDENT_SUPPLIERS
    return [
        {**node, "is_spof": True}
        for node in tier2_nodes
        if node.get("confidence", 0.0) >= SPOF_CONFIDENCE_THRESHOLD
        and node.get("exposure_count", 0) >= threshold
    ]
