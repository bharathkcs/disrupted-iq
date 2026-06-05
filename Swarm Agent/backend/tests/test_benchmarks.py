"""Unit tests for benchmarks.py - Section 8 of the Market Differentiation Sprint."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import benchmarks as bm


@pytest.fixture(autouse=True)
def _isolate_benchmark_store():
    original = dict(bm.BENCHMARK_INDUSTRIES)
    bm.BENCHMARK_INDUSTRIES = {}
    yield
    bm.BENCHMARK_INDUSTRIES = original


def _supplier(name="X", zone="Mumbai", reliability=85, buffer_days=14, sites=2, categories=("Cat A",)):
    return {
        "name": name,
        "zone": zone,
        "reliability": reliability,
        "buffer_stock_days": buffer_days,
        "sites": sites,
        "categories": list(categories),
    }


class TestInferIndustryFromFilename:
    def test_automotive(self):
        assert bm._infer_industry_from_filename("01_Automotive_Global_25_suppliers.xlsx") == "Automotive"

    def test_renewable(self):
        assert bm._infer_industry_from_filename("06_Renewable_Energy_28_suppliers.xlsx") == "Renewable Energy"

    def test_food_beverage(self):
        assert bm._infer_industry_from_filename("07_Food_Beverage_India.xlsx") == "Food and Beverage"

    def test_unknown(self):
        assert bm._infer_industry_from_filename("random_file.xlsx") is None


class TestComputeMetrics:
    def test_empty_list(self):
        m = bm._compute_metrics([])
        assert m["supplier_count"] == 0
        assert m["avg_reliability"] == 0.0
        assert m["geo_concentration_top_zone"] is None

    def test_single_supplier(self):
        m = bm._compute_metrics([_supplier()])
        assert m["supplier_count"] == 1
        assert m["avg_reliability"] == 85.0
        assert m["avg_buffer_days"] == 14.0
        assert m["geo_concentration_top_zone"] == "Mumbai"
        assert m["geo_concentration_top_zone_pct"] == 100.0

    def test_multiple_suppliers_average(self):
        suppliers = [
            _supplier(reliability=90, buffer_days=20, zone="Mumbai", categories=("A",)),
            _supplier(reliability=70, buffer_days=10, zone="Mumbai", categories=("B",)),
            _supplier(reliability=80, buffer_days=15, zone="Chennai", categories=("A",)),
        ]
        m = bm._compute_metrics(suppliers)
        assert m["avg_reliability"] == 80.0
        assert m["avg_buffer_days"] == 15.0
        assert m["geo_concentration_top_zone"] == "Mumbai"
        # 2 of 3 in Mumbai
        assert m["geo_concentration_top_zone_pct"] == round(2 / 3 * 100, 1)

    def test_single_source_rate(self):
        # Cat A covered by 2 suppliers, Cat B by 1 supplier -> 1 of 2 cats is single-sourced
        suppliers = [
            _supplier(name="s1", categories=("A",)),
            _supplier(name="s2", categories=("A",)),
            _supplier(name="s3", categories=("B",)),
        ]
        m = bm._compute_metrics(suppliers)
        assert m["single_source_rate"] == 50.0


class TestVerdict:
    def test_better_when_delta_positive_and_higher_better(self):
        assert bm._verdict(5.0, higher_is_better=True) == "better"

    def test_worse_when_delta_positive_and_higher_worse(self):
        assert bm._verdict(5.0, higher_is_better=False) == "worse"

    def test_in_line_when_delta_zero(self):
        assert bm._verdict(0.0, higher_is_better=True) == "in_line"

    def test_better_when_delta_negative_and_higher_worse(self):
        # Concentration: lower is better, negative delta means client is more diversified
        assert bm._verdict(-5.0, higher_is_better=False) == "better"


class TestComputeClientVsIndustry:
    def test_returns_none_for_unknown_industry(self):
        assert bm.compute_client_vs_industry([_supplier()], "Cyberpunk Holographics") is None

    def test_returns_comparison_when_baseline_loaded(self):
        # Seed a synthetic Automotive baseline
        bm.BENCHMARK_INDUSTRIES["Automotive"] = bm._compute_metrics([
            _supplier(name="b1", reliability=90, buffer_days=20, zone="Mumbai", categories=("A",)),
            _supplier(name="b2", reliability=85, buffer_days=18, zone="Mumbai", categories=("B",)),
            _supplier(name="b3", reliability=80, buffer_days=22, zone="Pune", categories=("C",)),
        ])
        bm.BENCHMARK_INDUSTRIES["Automotive"]["source_file"] = "synthetic.xlsx"
        bm.BENCHMARK_INDUSTRIES["Automotive"]["industry"] = "Automotive"

        client = [
            _supplier(name="c1", reliability=95, buffer_days=25, zone="Chennai", categories=("A",)),
        ]
        result = bm.compute_client_vs_industry(client, "Automotive")
        assert result is not None
        assert result["industry"] == "Automotive"
        assert result["client_supplier_count"] == 1
        m = result["metrics"]
        # Client's reliability is higher than baseline
        assert m["avg_reliability"]["verdict"] == "better"
        assert m["avg_reliability"]["delta"] > 0
        # Buffer days also higher
        assert m["avg_buffer_days"]["verdict"] == "better"

    def test_empty_client_still_returns_comparison(self):
        bm.BENCHMARK_INDUSTRIES["Pharma"] = bm._compute_metrics([
            _supplier(name="b1", reliability=90, buffer_days=20),
        ])
        bm.BENCHMARK_INDUSTRIES["Pharma"]["industry"] = "Pharma"
        result = bm.compute_client_vs_industry([], "Pharma")
        assert result is not None
        assert result["client_supplier_count"] == 0


class TestRealDatasetLoad:
    """Smoke test: the bundled dataset files actually load without error
    (skipped if the dataset directory isn't present in this environment)."""

    def test_load_benchmarks_populates_industries(self):
        if not bm.DATASET_DIR.exists():
            pytest.skip(f"Dataset dir {bm.DATASET_DIR} not present")
        result = bm.load_benchmarks()
        # At least some industries should resolve from the real files
        assert isinstance(result, dict)
        if not result:
            pytest.skip("Dataset dir present but no .xlsx files matched the file-hint map")
        # Each loaded baseline has the required keys
        for industry, metrics in result.items():
            assert isinstance(industry, str)
            assert "avg_reliability" in metrics
            assert "avg_buffer_days" in metrics
            assert "supplier_count" in metrics
            assert metrics["supplier_count"] > 0
