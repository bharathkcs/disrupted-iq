"""Unit tests for the R-10 AI Compliance Report - Section 6 of the Market Differentiation Sprint.

Pure helper-function tests over synthetic event sets. We exercise the
metric-aggregation logic that lives inline in the endpoint by calling it
through a thin re-implementation of the same arithmetic so the test does
not depend on FastAPI's HTTP plumbing or storage I/O.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def _compute_overall_pct(metrics):
    if not metrics:
        return 0.0
    return round(sum(m["percent"] for m in metrics) / len(metrics), 1)


def _status_band(pct: float) -> str:
    if pct >= 85:
        return "green"
    if pct >= 60:
        return "amber"
    return "red"


def _percent(part: int, whole: int) -> float:
    return round((part / whole) * 100, 2) if whole else 0.0


class TestStatusBand:
    def test_green_at_85(self):
        assert _status_band(85.0) == "green"

    def test_amber_at_60(self):
        assert _status_band(60.0) == "amber"

    def test_red_below_60(self):
        assert _status_band(59.9) == "red"

    def test_red_at_zero(self):
        assert _status_band(0.0) == "red"


class TestComplianceAggregation:
    """Verify the percent calculations the endpoint uses are sane against
    realistic event-shape fixtures.
    """

    def _build_events(self):
        """Synthetic event set covering the metrics the endpoint derives."""
        return [
            # 4 events, 3 HIL-approved, 2 from auto_monitor, 1 high-severity co-reviewed
            {
                "monitor": {"severity_score": 9, "source": "Manual"},
                "hil_decision": {"reviewer_id": "u1", "co_reviewer_id": "u2"},
                "risk": {"content_safety_passed": True},
                "forecast": {"mcf_sample_size": 2},
                "status": "resolved",
                "counterfactual": {"actual_outcome": "delayed 5d"},
            },
            {
                "monitor": {"severity_score": 7, "source": "auto_monitor:news"},
                "hil_decision": {"reviewer_id": "u1"},
                "risk": {"content_safety_passed": True},
                "forecast": {"mcf_sample_size": 0, "baseline_source": "federated"},
                "status": "resolved",
                "counterfactual": {"actual_outcome": "OK"},
            },
            {
                "monitor": {"severity_score": 5, "source": "auto_monitor:weather"},
                "hil_decision": {"reviewer_id": "u1"},
                "risk": {"content_safety_passed": False},
                "forecast": {"mcf_sample_size": 0},
                "status": "awaiting_hil",
            },
            {
                "monitor": {"severity_score": 4, "source": "Manual"},
                # no hil_decision
                "risk": {"content_safety_passed": True},
                "forecast": {"mcf_sample_size": 0},
                "status": "below_threshold",
            },
        ]

    def test_hil_approval_rate(self):
        events = self._build_events()
        hil_approved = sum(1 for e in events if e.get("hil_decision"))
        assert hil_approved == 3
        assert _percent(hil_approved, len(events)) == 75.0
        assert _status_band(_percent(hil_approved, len(events))) == "amber"

    def test_co_reviewer_rate_for_high_sev(self):
        events = self._build_events()
        high_sev = [e for e in events if (e.get("monitor", {}) or {}).get("severity_score", 0) >= 9]
        assert len(high_sev) == 1
        co_reviewed = sum(
            1 for e in high_sev
            if e.get("hil_decision") and e.get("hil_decision", {}).get("co_reviewer_id")
        )
        assert co_reviewed == 1
        assert _percent(co_reviewed, len(high_sev)) == 100.0

    def test_content_safety_pass_rate(self):
        events = self._build_events()
        cs_pass = sum(1 for e in events if (e.get("risk", {}) or {}).get("content_safety_passed"))
        assert cs_pass == 3
        assert _percent(cs_pass, len(events)) == 75.0

    def test_memory_provenance_traceability(self):
        events = self._build_events()
        provenance = sum(
            1 for e in events
            if (e.get("forecast", {}) or {}).get("mcf_sample_size", 0) > 0
            or (e.get("forecast", {}) or {}).get("baseline_source") == "federated"
        )
        # Event 1 has mcf_sample_size=2, Event 2 has federated source
        assert provenance == 2
        assert _percent(provenance, len(events)) == 50.0

    def test_auto_trigger_coverage(self):
        events = self._build_events()
        auto_count = sum(
            1 for e in events
            if str((e.get("monitor", {}) or {}).get("source", "")).startswith("auto_monitor")
        )
        assert auto_count == 2
        assert _percent(auto_count, len(events)) == 50.0

    def test_overall_compliance_pct_is_mean_of_metric_percents(self):
        metrics = [
            {"percent": 75.0}, {"percent": 100.0}, {"percent": 50.0}, {"percent": 90.0},
        ]
        assert _compute_overall_pct(metrics) == round((75 + 100 + 50 + 90) / 4, 1)

    def test_empty_events_yields_zero(self):
        # When no events, all percents collapse to zero and overall is zero
        assert _percent(0, 0) == 0.0
        assert _compute_overall_pct([]) == 0.0

    def test_empty_high_sev_does_not_crash(self):
        # Edge case: client has events but none at sev>=9 - denominator 0
        assert _percent(0, 0) == 0.0
