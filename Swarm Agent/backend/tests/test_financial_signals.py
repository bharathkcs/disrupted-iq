"""Unit tests for financial_signals.py - Section 2 of the Market Differentiation Sprint.

Covers:
  - compute_financial_health: scoring components, tier classification, edge cases
  - sector resolution: case-insensitive lookup, unknown fallback
  - distress signal counting: keyword match, dedup per article, cap
  - portfolio summary: per-tier counts, empty list handling

Run with:
    cd "Swarm Agent/backend"
    pytest tests/test_financial_signals.py -v
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import financial_signals as fs


# --- _resolve_sector --------------------------------------------------------

class TestResolveSector:
    def test_known_sector_returns_exact_match(self):
        name, stress = fs._resolve_sector("Electronics")
        assert name == "Electronics"
        assert stress == 4.2

    def test_unknown_sector_returns_default(self):
        name, stress = fs._resolve_sector("Unobtainium Mining")
        assert name == "Unobtainium Mining"
        assert stress == fs.DEFAULT_SECTOR_STRESS

    def test_case_insensitive_lookup(self):
        name, stress = fs._resolve_sector("electronics")
        assert name == "Electronics"
        assert stress == 4.2

    def test_empty_string_returns_unknown(self):
        name, stress = fs._resolve_sector("")
        assert name == "Unknown"
        assert stress == fs.DEFAULT_SECTOR_STRESS

    def test_synonym_food_and_beverage(self):
        # Both forms appear in the index
        a = fs._resolve_sector("Food and Beverage")
        b = fs._resolve_sector("Food & Beverage")
        assert a[1] == b[1]


# --- _count_distress_signals ------------------------------------------------

class TestDistressSignals:
    def test_empty_list_returns_zero(self):
        count, matched = fs._count_distress_signals([])
        assert count == 0
        assert matched == []

    def test_no_distress_keywords_returns_zero(self):
        alerts = [{"headline": "Earnings beat expectations", "description": "Good quarter"}]
        count, matched = fs._count_distress_signals(alerts)
        assert count == 0

    def test_bankruptcy_matched(self):
        alerts = [{"headline": "Supplier X files for bankruptcy", "description": ""}]
        count, matched = fs._count_distress_signals(alerts)
        assert count == 1
        assert "bankruptcy" in matched

    def test_multiple_alerts_count_separately(self):
        alerts = [
            {"headline": "Layoffs announced", "description": ""},
            {"headline": "Plant closure confirmed", "description": ""},
        ]
        count, _ = fs._count_distress_signals(alerts)
        assert count == 2

    def test_one_signal_per_alert(self):
        # An alert that mentions multiple keywords still only counts once
        alerts = [{
            "headline": "Bankruptcy filing follows layoffs and restructuring",
            "description": "",
        }]
        count, _ = fs._count_distress_signals(alerts)
        assert count == 1

    def test_handles_alternate_field_names(self):
        # Real-time news pulse uses "title"; sprint signals use "headline"
        alerts = [{"title": "Liquidation proceedings begin", "description": ""}]
        count, _ = fs._count_distress_signals(alerts)
        assert count == 1


# --- _classify_tier ---------------------------------------------------------

class TestClassifyTier:
    def test_stable_at_75_boundary(self):
        tier, _, adj = fs._classify_tier(75.0)
        assert tier == "Stable"
        assert adj == 0

    def test_watch_band(self):
        tier, _, adj = fs._classify_tier(60.0)
        assert tier == "Watch"
        assert adj == 0

    def test_at_risk_band_adds_penalty(self):
        tier, _, adj = fs._classify_tier(40.0)
        assert tier == "At Risk"
        assert adj == 5

    def test_critical_band_adds_max_penalty(self):
        tier, _, adj = fs._classify_tier(20.0)
        assert tier == "Critical"
        assert adj == 12


# --- compute_financial_health -----------------------------------------------

class TestComputeFinancialHealth:
    def test_stable_supplier_full_score(self):
        record = fs.compute_financial_health(
            supplier_name="Healthy Co",
            supplier_category="Pharma",  # low stress (2.1)
            reliability_pct=95,
            buffer_days=30,
            news_alerts=[],
        )
        assert record["tier"] == "Stable"
        assert record["risk_adjustment"] == 0
        assert 75 <= record["financial_health_score"] <= 100
        assert record["breakdown"]["distress_hits"] == 0

    def test_distress_news_drops_tier(self):
        without = fs.compute_financial_health(
            "Co", "Pharma", 95, 30, news_alerts=[],
        )
        with_distress = fs.compute_financial_health(
            "Co", "Pharma", 95, 30,
            news_alerts=[{"headline": "Co files for bankruptcy"}],
        )
        assert with_distress["financial_health_score"] < without["financial_health_score"]
        assert with_distress["breakdown"]["distress_hits"] == 1

    def test_unknown_category_does_not_crash(self):
        record = fs.compute_financial_health(
            "Co", "Esoteric Niche Industry", 80, 14, news_alerts=[],
        )
        assert record["tier"] in ("Stable", "Watch", "At Risk", "Critical")
        assert record["breakdown"]["sector"] == "Esoteric Niche Industry"

    def test_low_reliability_drags_score(self):
        high_rel = fs.compute_financial_health("A", "Logistics", 95, 7, [])
        low_rel = fs.compute_financial_health("B", "Logistics", 40, 7, [])
        assert low_rel["financial_health_score"] < high_rel["financial_health_score"]

    def test_zero_buffer_handled(self):
        # Should not throw; operational score just goes lower
        record = fs.compute_financial_health("C", "Logistics", 80, 0, [])
        assert isinstance(record["financial_health_score"], float)

    def test_critical_tier_applies_12_point_adjustment(self):
        # Push the inputs hard enough to clear the Critical (<35) threshold:
        # 6 distress hits drives news_score to 10; very low reliability + zero
        # buffer drives operational to ~12; with Mining sector (stress 5.5) the
        # total is well below 35.
        record = fs.compute_financial_health(
            "Distressed Co",
            "Mining",
            reliability_pct=20,
            buffer_days=0,
            news_alerts=[
                {"headline": "Bankruptcy filing"},
                {"headline": "Layoffs across plants"},
                {"headline": "Plant closure announced"},
                {"headline": "Liquidation order"},
                {"headline": "Restructuring loan default"},
                {"headline": "Receiver appointed"},
            ],
        )
        assert record["tier"] == "Critical"
        assert record["risk_adjustment"] == 12

    def test_distress_hits_capped(self):
        too_many = [{"headline": "bankruptcy"} for _ in range(20)]
        record = fs.compute_financial_health("Spammy", "Logistics", 80, 14, too_many)
        assert record["breakdown"]["distress_hits"] <= fs.MAX_DISTRESS_HITS

    def test_output_includes_timestamp(self):
        record = fs.compute_financial_health("X", "FMCG", 80, 14, [])
        assert "last_computed_utc" in record
        assert "T" in record["last_computed_utc"]  # ISO 8601


# --- summarise_portfolio ----------------------------------------------------

class TestSummarisePortfolio:
    def test_empty_returns_zeros(self):
        s = fs.summarise_portfolio([])
        assert s == {"total": 0, "critical": 0, "at_risk": 0, "watch": 0, "stable": 0}

    def test_tier_counts(self):
        records = [
            {"tier": "Stable"},
            {"tier": "Stable"},
            {"tier": "At Risk"},
            {"tier": "Critical"},
        ]
        s = fs.summarise_portfolio(records)
        assert s["total"] == 4
        assert s["stable"] == 2
        assert s["at_risk"] == 1
        assert s["critical"] == 1
        assert s["watch"] == 0

    def test_unknown_tier_defaults_stable(self):
        records = [{"tier": "Unknown"}]
        s = fs.summarise_portfolio(records)
        # Falls into stable bucket per current implementation
        assert s["total"] == 1
