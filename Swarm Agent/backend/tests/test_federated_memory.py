"""Unit tests for federated_memory.py - Section 5 of the Market Differentiation Sprint.

Covers:
  - k-anonymity threshold enforcement (no baseline below 3 clients)
  - aggregate correctness (mean computation, normalisation)
  - get_baseline_for_forecast: only triggers when own Stage-2 is empty
  - no client_id leak in returned payload
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import federated_memory as fm
import storage


def _seed_stage2(records):
    """Replace the in-memory Stage-2 store with the given list."""
    storage._mem_swarm_memory.clear()
    for rec in records:
        rec.setdefault("stage", 2)
        storage._mem_swarm_memory.append(rec)


@pytest.fixture(autouse=True)
def _isolate_memory_store():
    original = list(storage._mem_swarm_memory)
    storage._mem_swarm_memory.clear()
    yield
    storage._mem_swarm_memory.clear()
    storage._mem_swarm_memory.extend(original)


class TestAggregateBaseline:
    def test_empty_store_returns_none(self):
        _seed_stage2([])
        assert fm.aggregate_baseline("Port Strike", "Mumbai") is None

    def test_below_k_anonymity_returns_none(self):
        # Only 2 distinct clients - below k=3 threshold
        _seed_stage2([
            {"client_id": "c1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 20},
            {"client_id": "c2", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 25},
            {"client_id": "c1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 22},
        ])
        assert fm.aggregate_baseline("Port Strike", "Mumbai") is None

    def test_at_k_anonymity_returns_baseline(self):
        _seed_stage2([
            {"client_id": "c1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 20},
            {"client_id": "c2", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 25},
            {"client_id": "c3", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 30},
        ])
        baseline = fm.aggregate_baseline("Port Strike", "Mumbai")
        assert baseline is not None
        assert baseline["sample_size"] == 3
        assert baseline["contributing_clients"] == 3
        assert baseline["mean_actual_demand_shift"] == 25.0

    def test_filters_by_event_type_and_geography(self):
        _seed_stage2([
            {"client_id": "c1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 20},
            {"client_id": "c2", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 30},
            {"client_id": "c3", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 40},
            # Off-topic records that must not contribute:
            {"client_id": "c4", "event_type": "Cyclone", "geography": "Mumbai", "actual_demand_shift": 99},
            {"client_id": "c5", "event_type": "Port Strike", "geography": "Tokyo", "actual_demand_shift": 99},
        ])
        baseline = fm.aggregate_baseline("Port Strike", "Mumbai")
        assert baseline["sample_size"] == 3
        assert baseline["mean_actual_demand_shift"] == 30.0

    def test_case_insensitive_matching(self):
        _seed_stage2([
            {"client_id": "c1", "event_type": "port strike", "geography": "MUMBAI", "actual_demand_shift": 20},
            {"client_id": "c2", "event_type": "Port Strike", "geography": "mumbai", "actual_demand_shift": 25},
            {"client_id": "c3", "event_type": "PORT STRIKE", "geography": "Mumbai", "actual_demand_shift": 30},
        ])
        baseline = fm.aggregate_baseline("Port Strike", "Mumbai")
        assert baseline is not None
        assert baseline["sample_size"] == 3

    def test_no_client_id_in_payload(self):
        _seed_stage2([
            {"client_id": "secret_co_1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 20},
            {"client_id": "secret_co_2", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 25},
            {"client_id": "secret_co_3", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 30},
        ])
        baseline = fm.aggregate_baseline("Port Strike", "Mumbai")
        # No client_id leaks into the payload
        assert "client_id" not in baseline
        # And no field contains a client_id string
        for value in baseline.values():
            assert "secret_co" not in str(value)

    def test_confidence_band_low_medium_high(self):
        def make_records(n):
            return [
                {"client_id": f"c{i}", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 25}
                for i in range(n)
            ]
        _seed_stage2(make_records(3))
        assert fm.aggregate_baseline("Port Strike", "Mumbai")["confidence"] == "low"
        _seed_stage2(make_records(6))
        assert fm.aggregate_baseline("Port Strike", "Mumbai")["confidence"] == "medium"
        _seed_stage2(make_records(12))
        assert fm.aggregate_baseline("Port Strike", "Mumbai")["confidence"] == "high"

    def test_missing_actual_fields_handled(self):
        # Some records lack actual_demand_shift - should be skipped silently
        _seed_stage2([
            {"client_id": "c1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 20},
            {"client_id": "c2", "event_type": "Port Strike", "geography": "Mumbai"},  # no actual
            {"client_id": "c3", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 30},
        ])
        baseline = fm.aggregate_baseline("Port Strike", "Mumbai")
        # 3 records met the k-anonymity threshold by client_id
        assert baseline["sample_size"] == 3
        # But the mean is over the 2 with non-null actuals
        assert baseline["mean_actual_demand_shift"] == 25.0


class TestGetBaselineForForecast:
    def test_returns_none_when_own_history_exists(self):
        _seed_stage2([
            {"client_id": "c1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 20},
            {"client_id": "c2", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 25},
            {"client_id": "c3", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 30},
        ])
        # Caller has own Stage-2 history -> federated should not override it
        assert fm.get_baseline_for_forecast("Port Strike", "Mumbai", own_stage2_count=2) is None

    def test_returns_baseline_when_own_history_empty(self):
        _seed_stage2([
            {"client_id": "c1", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 20},
            {"client_id": "c2", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 25},
            {"client_id": "c3", "event_type": "Port Strike", "geography": "Mumbai", "actual_demand_shift": 30},
        ])
        baseline = fm.get_baseline_for_forecast("Port Strike", "Mumbai", own_stage2_count=0)
        assert baseline is not None
        assert baseline["sample_size"] == 3
