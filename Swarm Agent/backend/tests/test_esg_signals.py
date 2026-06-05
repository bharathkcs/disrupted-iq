"""Unit tests for esg_signals.py - Section 4 of the Market Differentiation Sprint."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import esg_signals as esg


class TestLookupIndex:
    def test_known_industry_returns_exact(self):
        name, val = esg._lookup_index(esg.INDUSTRY_CARBON_INTENSITY_INDEX, "Steel")
        assert name == "Steel"
        assert val == 9.5

    def test_unknown_returns_default(self):
        name, val = esg._lookup_index(esg.INDUSTRY_CARBON_INTENSITY_INDEX, "Cyberpunk Holographics")
        assert name == "Cyberpunk Holographics"
        assert val == esg.DEFAULT_INDEX_VALUE

    def test_case_insensitive(self):
        _, val = esg._lookup_index(esg.INDUSTRY_LABOR_RISK_INDEX, "textile")
        assert val == 7.0

    def test_empty_string_returns_unknown(self):
        name, val = esg._lookup_index(esg.ZONE_CLIMATE_RISK_INDEX, "")
        assert name == "Unknown"
        assert val == esg.DEFAULT_INDEX_VALUE


class TestClassifyTier:
    def test_tier_a_at_boundary(self):
        tier, color = esg._classify_tier(80.0)
        assert tier == "A"
        assert color == "green"

    def test_tier_b_band(self):
        tier, color = esg._classify_tier(65.0)
        assert tier == "B"
        assert color == "amber"

    def test_tier_c_band(self):
        tier, color = esg._classify_tier(45.0)
        assert tier == "C"
        assert color == "orange"

    def test_tier_d_band(self):
        tier, color = esg._classify_tier(25.0)
        assert tier == "D"
        assert color == "red"


class TestComputeEsgScore:
    def test_clean_industry_clean_zone(self):
        # Pharma + Frankfurt = best-of-best
        rec = esg.compute_esg_score("HealthyCo", "Pharma", "Frankfurt")
        assert rec["tier"] in ("A", "B")
        assert rec["esg_composite"] > 70

    def test_dirty_industry_dirty_zone(self):
        # Steel + Kolkata = worst-of-worst
        rec = esg.compute_esg_score("DirtyCo", "Steel", "Kolkata")
        assert rec["tier"] in ("C", "D")
        assert rec["esg_composite"] < 50

    def test_unknown_industry_uses_neutral(self):
        rec = esg.compute_esg_score("Co", "Unknown Sector", "Frankfurt")
        # Should not crash; falls back to defaults
        assert isinstance(rec["esg_composite"], float)
        assert rec["breakdown"]["industry"] == "Unknown Sector"

    def test_breakdown_present(self):
        rec = esg.compute_esg_score("Co", "Electronics", "Taipei")
        assert "breakdown" in rec
        assert "carbon_score" in rec["breakdown"]
        assert "climate_score" in rec["breakdown"]
        assert "labor_score" in rec["breakdown"]

    def test_includes_timestamp(self):
        rec = esg.compute_esg_score("Co", "FMCG", "Mumbai")
        assert "last_computed_utc" in rec
        assert "T" in rec["last_computed_utc"]


class TestSummariseEsgPortfolio:
    def test_empty(self):
        s = esg.summarise_esg_portfolio([])
        assert s["total"] == 0
        assert s["avg_composite"] == 0.0
        assert s["A"] == s["B"] == s["C"] == s["D"] == 0

    def test_counts_per_tier(self):
        records = [
            {"tier": "A", "esg_composite": 85.0},
            {"tier": "A", "esg_composite": 90.0},
            {"tier": "B", "esg_composite": 70.0},
            {"tier": "D", "esg_composite": 30.0},
        ]
        s = esg.summarise_esg_portfolio(records)
        assert s["total"] == 4
        assert s["A"] == 2
        assert s["B"] == 1
        assert s["D"] == 1
        assert s["avg_composite"] == round((85 + 90 + 70 + 30) / 4, 1)
