"""Unit tests for tier2_inference.py - Section 3 of the Market Differentiation Sprint.

Covers:
  - infer_tier2_dependencies: knowledge graph lookup, dedup, sorting, empty case
  - identify_tier2_single_points_of_failure: confidence + exposure gates
  - Dual-client behavior: same logic for seed and real clients

Run with:
    cd "Swarm Agent/backend"
    pytest tests/test_tier2_inference.py -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import tier2_inference as t2


# --- infer_tier2_dependencies ----------------------------------------------

class TestInferTier2Dependencies:
    def test_empty_supplier_list_returns_empty(self):
        assert t2.infer_tier2_dependencies([]) == []

    def test_supplier_without_categories_returns_empty(self):
        suppliers = [{"name": "Supplier A", "categories": []}]
        assert t2.infer_tier2_dependencies(suppliers) == []

    def test_unknown_category_returns_empty(self):
        # Category not in TIER2_KNOWLEDGE_GRAPH -> no Tier-2 inferred
        suppliers = [{"name": "Supplier A", "categories": ["UnknownCategory"]}]
        assert t2.infer_tier2_dependencies(suppliers) == []

    def test_electronics_supplier_infers_known_dependencies(self):
        suppliers = [{"name": "ChipCo", "categories": ["Electronics"]}]
        result = t2.infer_tier2_dependencies(suppliers)
        assert len(result) == 4  # 4 deps for Electronics
        tier2_cats = {n["tier2_category"] for n in result}
        assert "Semiconductor Wafers" in tier2_cats
        assert "Rare Earth Minerals" in tier2_cats
        assert "PCB Manufacturing" in tier2_cats

    def test_all_results_marked_estimated(self):
        suppliers = [{"name": "Co", "categories": ["Steel"]}]
        result = t2.infer_tier2_dependencies(suppliers)
        for node in result:
            assert node["is_estimated"] is True
            assert "probable_zones" in node
            assert 0.0 < node["confidence"] <= 1.0

    def test_dedupes_dependencies_across_suppliers(self):
        # Two suppliers in same category -> Tier-2 inferred once, with both
        # suppliers appearing in dependent_tier1_suppliers
        suppliers = [
            {"name": "ChipCo A", "categories": ["Electronics"]},
            {"name": "ChipCo B", "categories": ["Electronics"]},
        ]
        result = t2.infer_tier2_dependencies(suppliers)
        for node in result:
            assert node["exposure_count"] == 2
            assert "ChipCo A" in node["dependent_tier1_suppliers"]
            assert "ChipCo B" in node["dependent_tier1_suppliers"]

    def test_multiple_categories_aggregate_correctly(self):
        suppliers = [
            {"name": "Multi Co", "categories": ["Electronics", "Steel"]},
        ]
        result = t2.infer_tier2_dependencies(suppliers)
        # Should include deps from both Electronics and Steel knowledge entries
        tier2_cats = {n["tier2_category"] for n in result}
        # Electronics deps
        assert "Semiconductor Wafers" in tier2_cats
        # Steel deps
        assert "Iron Ore" in tier2_cats

    def test_sorted_by_exposure_times_confidence_desc(self):
        suppliers = [
            {"name": "ElectronicsCo 1", "categories": ["Electronics"]},
            {"name": "ElectronicsCo 2", "categories": ["Electronics"]},
            {"name": "ElectronicsCo 3", "categories": ["Electronics"]},
            {"name": "SteelCo", "categories": ["Steel"]},
        ]
        result = t2.infer_tier2_dependencies(suppliers)
        # The top result must have the highest exposure_count * confidence
        scores = [n["exposure_count"] * n["confidence"] for n in result]
        assert scores == sorted(scores, reverse=True)

    def test_handles_whitespace_in_category_names(self):
        suppliers = [{"name": "Co", "categories": ["  Steel  "]}]
        result = t2.infer_tier2_dependencies(suppliers)
        assert len(result) > 0
        # Steel inferences came through despite the padding
        tier2_cats = {n["tier2_category"] for n in result}
        assert "Iron Ore" in tier2_cats

    def test_dependent_categories_not_duplicated(self):
        suppliers = [
            {"name": "A", "categories": ["Electronics"]},
            {"name": "B", "categories": ["Electronics"]},
        ]
        result = t2.infer_tier2_dependencies(suppliers)
        for node in result:
            cats = node["dependent_tier1_categories"]
            assert cats == list(dict.fromkeys(cats))  # no duplicates


# --- identify_tier2_single_points_of_failure -------------------------------

class TestIdentifyTier2SPOFs:
    def test_empty_nodes_returns_empty(self):
        assert t2.identify_tier2_single_points_of_failure([]) == []

    def test_below_confidence_threshold_not_flagged(self):
        nodes = [{
            "tier2_category": "Low confidence",
            "confidence": 0.5,
            "exposure_count": 10,
        }]
        assert t2.identify_tier2_single_points_of_failure(nodes, tier1_count=20) == []

    def test_below_exposure_count_not_flagged(self):
        nodes = [{
            "tier2_category": "High confidence, low exposure",
            "confidence": 0.95,
            "exposure_count": 1,
        }]
        # Default min is 3 dependents; with tier1_count not specified, falls back to 3
        assert t2.identify_tier2_single_points_of_failure(nodes) == []

    def test_qualifies_when_both_thresholds_met(self):
        nodes = [{
            "tier2_category": "Critical Dependency",
            "confidence": 0.90,
            "exposure_count": 5,
        }]
        spofs = t2.identify_tier2_single_points_of_failure(nodes, tier1_count=10)
        assert len(spofs) == 1
        assert spofs[0]["is_spof"] is True

    def test_small_portfolio_uses_half_threshold(self):
        # 4 Tier-1 suppliers, half = 2. A node depended on by 2 with high
        # confidence qualifies even though it's below the absolute min of 3.
        nodes = [{
            "tier2_category": "Small portfolio SPOF",
            "confidence": 0.90,
            "exposure_count": 2,
        }]
        spofs = t2.identify_tier2_single_points_of_failure(nodes, tier1_count=4)
        assert len(spofs) == 1


# --- Realistic end-to-end scenarios ----------------------------------------

class TestRealisticPortfolios:
    def test_seed_demo_supplier_set(self):
        # Mimics a slice of the seed_data.py demo client.
        suppliers = [
            {"name": "Precision Circuits Chennai", "categories": ["PCB Assemblies", "Control Electronics"]},
            {"name": "Coromandel Auto Forgings", "categories": ["Automotive"]},
            {"name": "Pune Steel Works", "categories": ["Steel"]},
        ]
        result = t2.infer_tier2_dependencies(suppliers)
        assert len(result) >= 5  # Multiple Tier-2 deps from these 3 Tier-1 cats
        assert all(node["is_estimated"] is True for node in result)

    def test_real_uploaded_supplier_set(self):
        # Mimics a real-client upload with mixed categories
        suppliers = [
            {"name": "Bayern Pumpen", "categories": ["Industrial Parts"]},
            {"name": "Chennai Chemicals", "categories": ["Chemicals"]},
            {"name": "PuneFood", "categories": ["Food and Beverage"]},
            {"name": "Logistics Hub Co", "categories": ["Logistics"]},
        ]
        result = t2.infer_tier2_dependencies(suppliers)
        # Should produce Tier-2 inferences for every Tier-1 category
        tier1_cats_with_t2 = {cat for node in result for cat in node["dependent_tier1_categories"]}
        assert "Industrial Parts" in tier1_cats_with_t2
        assert "Chemicals" in tier1_cats_with_t2
        assert "Food and Beverage" in tier1_cats_with_t2
        assert "Logistics" in tier1_cats_with_t2
