"""
routes/report_routes.py — /api/reports/* router (R-01..R-09 + summary).

All read-only report endpoints. Each filters by ``current_user["client_id"]``
from the JWT. Shared helpers (``_filter_events``, ``_parse_utc``, ``_mean``,
``_percent``, ``_percentile``, ``_event_timestamp``) are still defined in
main.py and imported lazily inside each handler to avoid a circular import
at module load time.
"""

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends

import agents
import auth
import config
import storage

logger = logging.getLogger("disruptiq.routes.reports")

report_router = APIRouter(prefix="/api/reports", tags=["reports"])


@report_router.get("/health")
async def reports_health():
    """Light health check — confirms the reports router is mounted."""
    return {"status": "ok", "router": "report_routes"}


@report_router.get("/r01-event-log")
async def report_r01_event_log(
    source: Optional[str] = None,
    geography: Optional[str] = None,
    severity_min: Optional[int] = None,
    severity_max: Optional[int] = None,
    date_from: Optional[str] = None,
    current_user: dict = Depends(auth.require_auth),
):
    from main import _filter_events, _event_timestamp
    client_id = current_user["client_id"]
    events = _filter_events(storage.list_events(), source, geography, severity_min, severity_max, date_from)
    events = [e for e in events if e.get("client_id") == client_id]
    return [{
        "event_id": event.get("event_id"),
        "source": event.get("monitor", {}).get("source"),
        "geography": event.get("monitor", {}).get("geography"),
        "severity": event.get("monitor", {}).get("severity_score"),
        "type": event.get("monitor", {}).get("event_type"),
        "cascade_flag": bool(event.get("cascade_alert")),
        "escalated": event.get("monitor", {}).get("escalate", False),
        "status": event.get("status"),
        "timestamp_utc": _event_timestamp(event),
    } for event in events]


@report_router.get("/r02-swarm-performance")
async def report_r02_swarm_performance(current_user: dict = Depends(auth.require_auth)):
    from main import _parse_utc, _mean, _percentile, _percent
    client_id = current_user["client_id"]
    metrics = storage.get_pipeline_metrics()
    metrics = [m for m in metrics if m.get("client_id") == client_id]
    nl_queries = storage.get_nl_queries()
    nl_queries = [q for q in nl_queries if q.get("client_id") == client_id]
    audit = storage.get_audit_log(5000)
    audit = [a for a in audit if a.get("client_id") == client_id]
    now = datetime.now(timezone.utc)
    last_30 = [m for m in metrics if (_parse_utc(m.get("timestamp_utc")) or now) >= now - timedelta(days=30)]
    total_durations = [float(m.get("total_duration_seconds", 0)) for m in metrics]
    source_counter = Counter(m.get("news_source", "Manual") for m in metrics)
    geo_counter = Counter(m.get("geography", "Unknown") for m in metrics)
    validations = [a for a in audit if a.get("action") == "validation"]
    validator_passes = [a for a in validations if "Pass" in (a.get("output_summary") or "")]
    timeline_counter = Counter()
    for metric in last_30:
        ts = _parse_utc(metric.get("timestamp_utc"))
        if ts:
            timeline_counter[ts.strftime("%Y-%m-%d")] += 1
    return {
        "total_events_processed": len(metrics),
        "events_last_30_days": len(last_30),
        "avg_execution_time_seconds": _mean(total_durations),
        "p95_execution_time_seconds": _percentile(total_durations, 0.95),
        "sla_compliance_rate_pct": _percent(sum(1 for m in metrics if m.get("sla_met")), len(metrics)),
        "validator_pass_rate_pct": _percent(len(validator_passes), len(validations)),
        "validator_rerun_rate_pct": _percent(sum(1 for m in metrics if m.get("validator_reruns", 0) > 0), len(metrics)),
        "avg_validator_reruns": _mean([float(m.get("validator_reruns", 0)) for m in metrics]),
        "simulation_sla_compliance_rate_pct": _percent(sum(1 for m in metrics if float(m.get("simulation_duration", 0)) <= 30), len(metrics)),
        "nl_query_total": len(nl_queries),
        "nl_queries_per_event_avg": round(len(nl_queries) / max(len(metrics), 1), 2),
        "source_breakdown": {
            "NewsAPI": source_counter.get("NewsAPI", 0),
            "Open-Meteo": source_counter.get("Open-Meteo", 0),
            "Manual": source_counter.get("Manual", 0),
            "Demo": source_counter.get("Demo", 0),
        },
        "events_by_geography": dict(geo_counter),
        "timeline": [{"date": date, "count": timeline_counter[date]} for date in sorted(timeline_counter.keys())],
        "recent_metrics": sorted(metrics, key=lambda item: item.get("timestamp_utc", ""), reverse=True)[:20],
    }


@report_router.get("/r03-memory-accuracy")
async def report_r03_memory_accuracy(current_user: dict = Depends(auth.require_auth)):
    from main import _mean, _percent
    client_id = current_user["client_id"]
    memory = storage.get_memory_store(5000)
    memory = [m for m in memory if m.get("client_id") == client_id]
    events = storage.list_events()
    events = [e for e in events if e.get("client_id") == client_id]
    recalls_per_event = [len(event.get("memory_recalls", []) or []) for event in events]
    adjustments = 0
    for event in events:
        suppliers = event.get("risk", {}).get("suppliers", [])
        if any(float(s.get("memory_adjustment", 0) or 0) > 0 for s in suppliers):
            adjustments += 1
    by_geo = Counter(record.get("geography", "Unknown") for record in memory)
    prediction_vs_actual = []
    for record in memory:
        predicted = record.get("predicted_demand_shift")
        actual = record.get("actual_demand_shift")
        if predicted is None or actual is None:
            continue
        prediction_vs_actual.append({
            "memory_id": record.get("memory_id"),
            "event_type": record.get("event_type"),
            "geography": record.get("geography"),
            "predicted_demand_shift": predicted,
            "actual_demand_shift": actual,
            "variance_pct": round(actual - predicted, 2),
        })
    return {
        "total_memory_records": len(memory),
        "stage1_records": sum(1 for record in memory if record.get("stage") == 1),
        "stage2_records": sum(1 for record in memory if record.get("stage") == 2),
        "total_events_with_memory_recall": sum(1 for event in events if len(event.get("memory_recalls", []) or []) > 0),
        "memory_recall_rate_pct": _percent(sum(1 for event in events if len(event.get("memory_recalls", []) or []) > 0), len(events)),
        "memory_adjustment_application_rate_pct": _percent(adjustments, len(events)),
        "avg_recalls_per_event": _mean([float(value) for value in recalls_per_event]),
        "geographies_covered": sorted(by_geo.keys()),
        "memory_records_by_geography": dict(by_geo),
        "prediction_vs_actual": prediction_vs_actual,
    }


@report_router.get("/r04-dissent-detection")
async def report_r04_dissent_detection(current_user: dict = Depends(auth.require_auth)):
    from main import _mean, _percent, _event_timestamp
    client_id = current_user["client_id"]
    metrics = storage.get_pipeline_metrics()
    metrics = [m for m in metrics if m.get("client_id") == client_id]
    events = {event.get("event_id"): event for event in storage.list_events() if event.get("client_id") == client_id}
    dissent_metrics = [metric for metric in metrics if metric.get("dissent_detected")]
    distribution = {"0_to_30": 0, "30_to_50": 0, "50_to_70": 0, "70_plus": 0}
    dissent_events = []
    divergence_scores = []
    for event in events.values():
        divergence = event.get("divergence", {})
        score = float(divergence.get("divergence_score", 0) or 0)
        if score < 30:
            distribution["0_to_30"] += 1
        elif score < 50:
            distribution["30_to_50"] += 1
        elif score < 70:
            distribution["50_to_70"] += 1
        else:
            distribution["70_plus"] += 1
        if divergence.get("dissent_detected"):
            divergence_scores.append(score)
            suppliers = event.get("risk", {}).get("suppliers", [])
            avg_supplier_risk = _mean([float(s.get("composite_score", 0)) for s in suppliers]) if suppliers else 0.0
            dissent_events.append({
                "event_id": event.get("event_id"),
                "geography": event.get("monitor", {}).get("geography"),
                "severity": event.get("monitor", {}).get("severity_score"),
                "divergence_score": score,
                "forecast_severity_normalised": divergence.get("forecast_position", {}).get("normalized_score", 0),
                "avg_supplier_risk": avg_supplier_risk,
                "timestamp_utc": _event_timestamp(event),
            })
    return {
        "total_events_analyzed": len(metrics),
        "dissent_detected_count": len(dissent_metrics),
        "dissent_detection_rate_pct": _percent(len(dissent_metrics), len(metrics)),
        "no_dissent_count": max(len(metrics) - len(dissent_metrics), 0),
        "dissent_events": dissent_events,
        "divergence_score_distribution": distribution,
        "avg_divergence_score_when_dissent": _mean(divergence_scores),
        "current_threshold": config.DISSENT_DIVERGENCE_THRESHOLD,
    }


@report_router.get("/r05-simulation-accuracy")
async def report_r05_simulation_accuracy(current_user: dict = Depends(auth.require_auth)):
    from main import _mean, _percent
    client_id = current_user["client_id"]
    events = storage.list_events()
    events = [e for e in events if e.get("client_id") == client_id]
    counterfactuals = storage.get_counterfactuals()
    counterfactuals = [c for c in counterfactuals if c.get("client_id") == client_id]
    confirmed_events = [event for event in events if event.get("hil_decision")]
    simulations = [event for event in events if event.get("simulation")]
    durations = [float(event.get("simulation", {}).get("duration_seconds", 0) or 0) for event in simulations]
    prob_valid = 0
    for event in simulations:
        sims = event.get("simulation", {}).get("simulations", [])
        if sims and all(sim.get("probability_valid", False) for sim in sims):
            prob_valid += 1
    return {
        "total_simulations_run": len(simulations),
        "total_counterfactuals_completed": len(counterfactuals),
        "simulation_coverage_rate_pct": _percent(len(simulations), len(confirmed_events)),
        "sla_compliance_rate_pct": _percent(sum(1 for duration in durations if duration <= 30), len(simulations)),
        "sla_breach_count": sum(1 for event in simulations if event.get("simulation", {}).get("sla_breached")),
        "avg_simulation_duration_seconds": _mean(durations),
        "probability_validity_rate_pct": _percent(prob_valid, len(simulations)),
        "counterfactual_records": [{
            "counterfactual_id": record.get("counterfactual_id"),
            "event_id": record.get("event_id"),
            "actual_outcome": record.get("actual_outcome"),
            "prediction_variance": record.get("prediction_variance"),
            "recalibration_recommended": record.get("recalibration_recommended"),
            "learning_signal": record.get("learning_signal"),
            "timestamp_utc": record.get("timestamp_utc"),
        } for record in counterfactuals],
        "recalibration_recommended_count": sum(1 for record in counterfactuals if record.get("recalibration_recommended")),
        "recalibration_rate_pct": _percent(sum(1 for record in counterfactuals if record.get("recalibration_recommended")), max(len(counterfactuals), 1)),
    }


@report_router.get("/r06-cascade-detection")
async def report_r06_cascade_detection(current_user: dict = Depends(auth.require_auth)):
    from main import _mean, _percent, _event_timestamp
    client_id = current_user["client_id"]
    all_events = storage.list_events()
    all_events = [e for e in all_events if e.get("client_id") == client_id]
    events = [event for event in all_events if event.get("cascade_alert")]
    cascade_type_counter = Counter()
    overlap_counter = Counter()
    combined = []
    supplier_counts = []
    cascade_events = []
    for event in events:
        cascade = event.get("cascade_alert", {})
        cascade_type_counter[cascade.get("cascade_type", "Unknown")] += 1
        overlap_counter[cascade.get("overlap_zone", "Unknown")] += 1
        score = float(cascade.get("combined_severity_score", 0) or 0)
        combined.append(score)
        shared_suppliers = cascade.get("shared_suppliers", []) or []
        supplier_counts.append(len(shared_suppliers))
        cascade_events.append({
            "event_id": event.get("event_id"),
            "cascade_type": cascade.get("cascade_type"),
            "combined_severity_score": score,
            "overlap_zone": cascade.get("overlap_zone"),
            "shared_suppliers": shared_suppliers,
            "overlap_multiplier": cascade.get("overlap_multiplier"),
            "primary_event_id": cascade.get("primary_event_id"),
            "secondary_event_id": cascade.get("secondary_event_id"),
            "timestamp_utc": _event_timestamp(event),
        })
    return {
        "total_cascade_events": len(events),
        "cascade_rate_pct": _percent(len(events), len(all_events)),
        "cascade_type_breakdown": {
            "Infrastructure Compound": cascade_type_counter.get("Infrastructure Compound", 0),
            "Geographic Concentration": cascade_type_counter.get("Geographic Concentration", 0),
            "Supplier Network Cascade": cascade_type_counter.get("Supplier Network Cascade", 0),
            "Demand Shock Compound": cascade_type_counter.get("Demand Shock Compound", 0),
        },
        "avg_combined_severity": _mean(combined),
        "max_combined_severity": max(combined) if combined else 0,
        "cascade_events": cascade_events,
        "most_common_cascade_geography": overlap_counter.most_common(1)[0][0] if overlap_counter else None,
        "avg_shared_suppliers_count": _mean([float(value) for value in supplier_counts]),
    }


@report_router.get("/r07-counterfactual-summary")
async def report_r07_counterfactual_summary(current_user: dict = Depends(auth.require_auth)):
    from main import _mean, _percent, _parse_utc, _event_timestamp
    client_id = current_user["client_id"]
    counterfactuals = storage.get_counterfactuals()
    counterfactuals = [c for c in counterfactuals if c.get("client_id") == client_id]
    events = {event.get("event_id"): event for event in storage.list_events() if event.get("client_id") == client_id}
    resolution_hours = []
    for record in counterfactuals:
        event = events.get(record.get("event_id"))
        if not event:
            continue
        event_ts = _parse_utc(_event_timestamp(event))
        cf_ts = _parse_utc(record.get("timestamp_utc"))
        if event_ts and cf_ts:
            resolution_hours.append((cf_ts - event_ts).total_seconds() / 3600)
    return {
        "total_counterfactuals": len(counterfactuals),
        "recalibration_signals_raised": sum(1 for record in counterfactuals if record.get("recalibration_recommended")),
        "recalibration_rate_pct": _percent(sum(1 for record in counterfactuals if record.get("recalibration_recommended")), max(len(counterfactuals), 1)),
        "avg_resolution_time_hours": _mean(resolution_hours),
        "records": counterfactuals,
        "learning_signal_summary": sorted(set(record.get("learning_signal") for record in counterfactuals if record.get("learning_signal"))),
        "events_with_demand_variance": [
            record for record in storage.get_memory_store(5000)
            if record.get("client_id") == client_id and record.get("stage") == 2 and record.get("actual_demand_shift") is not None
        ],
    }


@report_router.get("/r08-hil-decisions")
async def report_r08_hil_decisions(current_user: dict = Depends(auth.require_auth)):
    from main import _percent
    client_id = current_user["client_id"]
    events = [event for event in storage.list_events() if event.get("hil_decision") and event.get("client_id") == client_id]
    nl_queries = storage.get_nl_queries()
    nl_queries = [q for q in nl_queries if q.get("client_id") == client_id]
    option_counter = Counter()
    decisions = []
    dissent_events = [event for event in events if event.get("divergence", {}).get("dissent_detected")]
    cascade_events = [event for event in events if event.get("cascade_alert")]
    dissent_ack = 0
    cascade_ack = 0
    for event in events:
        decision = event.get("hil_decision", {})
        rank = int(decision.get("selected_option_rank", 0) or 0)
        option_counter[f"option_{rank}"] += 1
        if event.get("divergence", {}).get("dissent_detected") and "dissent" in event.get("acknowledgements", {}):
            dissent_ack += 1
        if event.get("cascade_alert") and "cascade" in event.get("acknowledgements", {}):
            cascade_ack += 1
        decisions.append({
            "event_id": event.get("event_id"),
            "selected_option_rank": rank,
            "reviewer_id": decision.get("reviewer_id"),
            "co_reviewer_id": decision.get("co_reviewer_id"),
            "timestamp_utc": decision.get("timestamp_utc"),
            "had_dissent": event.get("divergence", {}).get("dissent_detected", False),
            "had_cascade": bool(event.get("cascade_alert")),
            "severity": event.get("monitor", {}).get("severity_score"),
            "nl_queries_in_session": sum(1 for query in nl_queries if query.get("event_id") == event.get("event_id")),
        })
    total_confirmed = len(events)
    return {
        "total_confirmations": total_confirmed,
        "option_selection_breakdown": {
            "option_1": option_counter.get("option_1", 0),
            "option_2": option_counter.get("option_2", 0),
            "option_3": option_counter.get("option_3", 0),
        },
        "co_review_required_count": sum(1 for event in events if event.get("hil_decision", {}).get("co_review_required")),
        "co_review_completed_count": sum(1 for event in events if event.get("hil_decision", {}).get("co_reviewer_id")),
        "avg_nl_queries_per_session": round(len(nl_queries) / max(total_confirmed, 1), 2),
        "dissent_ack_rate_pct": _percent(dissent_ack, len(dissent_events)),
        "cascade_ack_rate_pct": _percent(cascade_ack, len(cascade_events)),
        "simulation_reviewed_count": sum(1 for event in events if event.get("simulation")),
        "hil_decisions": decisions,
    }


@report_router.get("/r09-forecast-risk-accuracy")
async def report_r09_forecast_risk_accuracy(current_user: dict = Depends(auth.require_auth)):
    from main import _mean, _percent
    client_id = current_user["client_id"]
    memory = storage.get_memory_store(5000)
    memory = [m for m in memory if m.get("client_id") == client_id]
    stage2 = [record for record in memory if record.get("stage") == 2]
    forecast_accuracy = []
    risk_accuracy = []
    memory_adjustment_records = 0
    accurate_negative_adjustments = 0
    absolute_errors = []
    over_count = 0
    under_count = 0
    for record in stage2:
        predicted = record.get("predicted_demand_shift")
        actual = record.get("actual_demand_shift")
        if predicted is not None and actual is not None:
            error = abs(actual - predicted)
            absolute_errors.append(error)
            if predicted > actual:
                over_count += 1
                direction = "over"
            else:
                under_count += 1
                direction = "under"
            forecast_accuracy.append({
                "memory_id": record.get("memory_id"),
                "event_type": record.get("event_type"),
                "geography": record.get("geography"),
                "predicted_demand_shift_pct": predicted,
                "actual_demand_shift_pct": actual,
                "absolute_error_pct": round(error, 2),
                "error_direction": direction,
                "memory_calibration_applied": bool(record.get("learning_signal")),
            })
        for supplier in record.get("supplier_scores", []) or record.get("risk_scores_assigned", []) or []:
            adjustment = float(supplier.get("memory_adjustment", 0) or 0)
            actual_outcome = (record.get("actual_outcome") or "").lower()
            negative = "delay" in actual_outcome or "disruption" in actual_outcome
            if adjustment > 0:
                memory_adjustment_records += 1
                if negative:
                    accurate_negative_adjustments += 1
            risk_accuracy.append({
                "supplier_id": supplier.get("supplier_id"),
                "supplier_name": supplier.get("supplier_name"),
                "predicted_risk_score": supplier.get("score") or supplier.get("predicted_risk_score"),
                "memory_adjustment_applied": adjustment,
                "actual_outcome": record.get("actual_outcome"),
                "outcome_was_negative": negative,
            })
    return {
        "total_events_with_actuals": len(stage2),
        "forecast_accuracy": forecast_accuracy,
        "mean_absolute_error_pct": _mean(absolute_errors),
        "over_prediction_rate_pct": _percent(over_count, len(forecast_accuracy)),
        "under_prediction_rate_pct": _percent(under_count, len(forecast_accuracy)),
        "risk_accuracy": risk_accuracy,
        "memory_adjustment_accuracy_rate_pct": _percent(accurate_negative_adjustments, memory_adjustment_records),
        "model_version": "xgb-v1.3",
    }


@report_router.get("/r10-compliance")
async def report_r10_compliance(current_user: dict = Depends(auth.require_auth)):
    """Section 6 Sprint: AI Compliance Report.

    Aggregates existing audit signals into a procurement-grade compliance
    scorecard. Each metric: green (>= 85%), amber (60-84%), red (< 60%).
    All inputs are already filtered by client_id - no new data, just
    derivations from events, audit log, and memory store.
    """
    from main import _percent
    client_id = current_user["client_id"]
    events = [e for e in storage.list_events() if e.get("client_id") == client_id]

    total = len(events)

    def _status(pct: float) -> str:
        if pct >= 85:
            return "green"
        if pct >= 60:
            return "amber"
        return "red"

    def _metric(name: str, value: int, denominator: int, description: str) -> dict:
        pct = _percent(value, denominator) if denominator else 0.0
        return {
            "metric_name": name,
            "value": value,
            "denominator": denominator,
            "percent": pct,
            "status": _status(pct),
            "description": description,
        }

    # 1. HIL approval rate - events that reached HIL confirmation
    hil_approved = sum(1 for e in events if e.get("hil_decision"))
    # 2. Co-reviewer rate for severity >= 9
    high_sev = [e for e in events if (e.get("monitor", {}) or {}).get("severity_score", 0) >= 9]
    co_reviewed = sum(
        1 for e in high_sev
        if e.get("hil_decision") and e.get("hil_decision", {}).get("co_reviewer_id")
    )
    # 3. Content Safety pass rate - risk_agent output flag
    cs_pass = sum(1 for e in events if (e.get("risk", {}) or {}).get("content_safety_passed"))
    # 4. Memory provenance - events whose forecast cited MCF or federated source
    provenance_count = sum(
        1 for e in events
        if (e.get("forecast", {}) or {}).get("mcf_sample_size", 0) > 0
        or (e.get("forecast", {}) or {}).get("baseline_source") == "federated"
    )
    # 5. Auto-trigger rate (Section 1 integration)
    auto_count = sum(
        1 for e in events
        if str((e.get("monitor", {}) or {}).get("source", "")).startswith("auto_monitor")
    )
    # 6. Resolved events with counterfactual - the learning loop closes
    resolved_with_cf = sum(
        1 for e in events
        if e.get("status") == "resolved" and e.get("counterfactual")
    )

    metrics = [
        _metric(
            "HIL Approval Rate", hil_approved, total,
            "Share of events where a human reviewer confirmed the AI recommendation.",
        ),
        _metric(
            "Co-Reviewer Compliance (severity >=9)", co_reviewed, len(high_sev),
            "High-severity events require a second human approver. Compliance share.",
        ),
        _metric(
            "Content Safety Pass Rate", cs_pass, total,
            "Risk agent narratives that passed Azure AI Content Safety filtering.",
        ),
        _metric(
            "Memory Provenance Traceability", provenance_count, total,
            "Forecasts that cite either own Stage-2 calibration or anonymised federated baseline.",
        ),
        _metric(
            "Auto-Trigger Coverage", auto_count, total,
            "Share of events detected proactively by the auto-monitor versus manually triggered.",
        ),
        _metric(
            "Counterfactual Closure Rate", resolved_with_cf,
            sum(1 for e in events if e.get("status") == "resolved"),
            "Resolved events with a logged counterfactual outcome (the learning loop closed).",
        ),
    ]

    # Overall compliance score: weighted average of metric percents
    if metrics:
        overall_pct = round(sum(m["percent"] for m in metrics) / len(metrics), 1)
    else:
        overall_pct = 0.0

    return {
        "client_id": client_id,
        "total_events_audited": total,
        "overall_compliance_pct": overall_pct,
        "overall_status": _status(overall_pct),
        "metrics": metrics,
        "model_version": "r10-v1.0",
        "report_id": "R-10",
        "report_title": "AI Compliance & Audit Report",
    }


@report_router.get("/summary")
async def reports_summary(current_user: dict = Depends(auth.get_optional_user)):
    from main import _mean, _percent, _parse_utc, _event_timestamp
    client_id = current_user["client_id"]
    events = storage.list_events()
    events = [e for e in events if e.get("client_id") == client_id]
    metrics = storage.get_pipeline_metrics()
    metrics = [m for m in metrics if m.get("client_id") == client_id]
    memory = storage.get_memory_store(5000)
    memory = [m for m in memory if m.get("client_id") == client_id]
    counterfactuals = storage.get_counterfactuals()
    counterfactuals = [c for c in counterfactuals if c.get("client_id") == client_id]
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    today_events = [event for event in events if (_parse_utc(_event_timestamp(event)) or now).strftime("%Y-%m-%d") == today]
    severities = [float(event.get("monitor", {}).get("severity_score", 0) or 0) for event in events if event.get("monitor")]
    news_today = [
        item for item in agents.get_latest_news_articles()
        if (_parse_utc(item.get("published_at") or item.get("timestamp_utc")) or now).strftime("%Y-%m-%d") == today
    ]

    response_times = []
    for event in events:
        monitor_ts = _parse_utc(event.get("monitor", {}).get("timestamp_utc"))
        action_ts = _parse_utc(event.get("action", {}).get("timestamp_utc"))
        if monitor_ts and action_ts:
            diff_minutes = (action_ts - monitor_ts).total_seconds() / 60
            response_times.append(diff_minutes)
    avg_response_minutes = round(_mean(response_times), 1) if response_times else 0

    return {
        "total_events": len(events),
        "events_today": len(today_events),
        "avg_severity": _mean(severities),
        "sla_compliance_pct": _percent(sum(1 for metric in metrics if metric.get("sla_met")), len(metrics)),
        "dissent_rate_pct": _percent(sum(1 for metric in metrics if metric.get("dissent_detected")), len(metrics)),
        "cascade_rate_pct": _percent(sum(1 for event in events if event.get("cascade_alert")), len(events)),
        "counterfactuals_completed": len(counterfactuals),
        "memory_records": len(memory),
        "active_events": sum(1 for event in events if event.get("status") not in {"resolved", "below_threshold"}),
        "news_articles_processed_today": len(news_today),
        "nl_queries_today": sum(1 for query in storage.get_nl_queries() if (_parse_utc(query.get("timestamp_utc")) or now).strftime("%Y-%m-%d") == today),
        "cascade_events": sum(1 for event in events if event.get("cascade_alert")),
        "avg_response_minutes": avg_response_minutes,
    }
