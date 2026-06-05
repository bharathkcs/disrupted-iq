"""Unit tests for briefing_history.py - Section 7 of the Market Differentiation Sprint."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import briefing_history as bh


@pytest.fixture(autouse=True)
def _reset():
    bh.reset()
    yield
    bh.reset()


class TestAppendBriefing:
    def test_appends_record(self):
        result = bh.append_briefing("c1", {"score": 42, "tier": "medium", "zones": ["A", "B"], "supplier_count": 5})
        assert result is not None
        assert result["client_id"] == "c1"
        assert result["score"] == 42
        assert result["tier"] == "medium"
        assert result["zone_count"] == 2
        assert result["supplier_count"] == 5
        assert "captured_at_utc" in result
        assert "date" in result

    def test_idempotent_per_day(self):
        first = bh.append_briefing("c1", {"score": 42, "tier": "medium"})
        second = bh.append_briefing("c1", {"score": 99, "tier": "high"})
        assert first is not None
        assert second is None  # already captured today
        history = bh.get_briefing_history("c1")
        assert len(history) == 1
        # First record is preserved (not overwritten by the second attempt)
        assert history[0]["score"] == 42

    def test_empty_client_id_returns_none(self):
        assert bh.append_briefing("", {"score": 50, "tier": "medium"}) is None
        assert bh.append_briefing(None, {"score": 50, "tier": "medium"}) is None

    def test_isolated_per_client(self):
        bh.append_briefing("c1", {"score": 10, "tier": "low"})
        bh.append_briefing("c2", {"score": 90, "tier": "high"})
        h1 = bh.get_briefing_history("c1")
        h2 = bh.get_briefing_history("c2")
        assert len(h1) == 1 and len(h2) == 1
        assert h1[0]["score"] == 10
        assert h2[0]["score"] == 90


class TestGetBriefingHistory:
    def test_empty_client_returns_empty_list(self):
        assert bh.get_briefing_history("c_unknown") == []

    def test_newest_first(self):
        # Manually inject 3 records with ascending dates
        bh._history["c1"] = [
            {"client_id": "c1", "date": "2026-05-01", "score": 10, "tier": "low", "zone_count": 0, "supplier_count": 0, "captured_at_utc": "2026-05-01T00:00:00Z"},
            {"client_id": "c1", "date": "2026-05-02", "score": 20, "tier": "low", "zone_count": 0, "supplier_count": 0, "captured_at_utc": "2026-05-02T00:00:00Z"},
            {"client_id": "c1", "date": "2026-05-03", "score": 30, "tier": "low", "zone_count": 0, "supplier_count": 0, "captured_at_utc": "2026-05-03T00:00:00Z"},
        ]
        history = bh.get_briefing_history("c1")
        assert history[0]["date"] == "2026-05-03"
        assert history[-1]["date"] == "2026-05-01"

    def test_respects_days_window(self):
        bh._history["c1"] = [
            {"client_id": "c1", "date": f"2026-05-{i:02d}", "score": i, "tier": "low", "zone_count": 0, "supplier_count": 0, "captured_at_utc": ""}
            for i in range(1, 11)
        ]
        history = bh.get_briefing_history("c1", days=3)
        assert len(history) == 3
        # Most recent first
        assert history[0]["date"] == "2026-05-10"

    def test_zero_or_negative_days_returns_empty(self):
        bh._history["c1"] = [
            {"client_id": "c1", "date": "2026-05-01", "score": 10, "tier": "low", "zone_count": 0, "supplier_count": 0, "captured_at_utc": ""},
        ]
        assert bh.get_briefing_history("c1", days=0) == []
        assert bh.get_briefing_history("c1", days=-5) == []


class TestStats:
    def test_empty(self):
        assert bh.stats() == {"clients_tracked": 0, "total_records": 0}

    def test_aggregates(self):
        bh.append_briefing("c1", {"score": 10, "tier": "low"})
        bh.append_briefing("c2", {"score": 20, "tier": "low"})
        s = bh.stats()
        assert s["clients_tracked"] == 2
        assert s["total_records"] == 2


class TestReset:
    def test_reset_single_client(self):
        bh.append_briefing("c1", {"score": 10, "tier": "low"})
        bh.append_briefing("c2", {"score": 20, "tier": "low"})
        bh.reset("c1")
        assert bh.get_briefing_history("c1") == []
        assert len(bh.get_briefing_history("c2")) == 1

    def test_reset_all(self):
        bh.append_briefing("c1", {"score": 10, "tier": "low"})
        bh.append_briefing("c2", {"score": 20, "tier": "low"})
        bh.reset()
        assert bh.stats()["total_records"] == 0
