"""
DisruptIQ V2 — 9-Agent Swarm
Each agent maps directly to a BRD V2 Agent Profile Card and Business Rule.
"""

import asyncio
import logging
import math
import re
import time
import uuid
import json
from collections import deque
from datetime import datetime, timezone
from typing import Optional

import httpx

import config
import federated_memory
import financial_signals
import llm
import storage
from algorithms import (
    memory_calibrated_forecast,
    compound_cascade_severity,
    multi_signal_dissent_score,
)
from seed_data import SUPPLIERS, CASCADE_ZONE_MAP

logger = logging.getLogger("disruptiq.agents")


def _now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


_MEMORY_ADJ_MAX = 15.0  # cap on the memory-driven risk add-on (points)


def _memory_risk_adjustment(mem: dict) -> float:
    """Risk add-on from a stage-2 memory record, scaled by recency and severity.

    A minor delay three years ago should not weigh the same as a catastrophic
    failure last week. Recency decays with a 180-day half-life; severity is taken
    from the recorded actual demand shift. Capped at _MEMORY_ADJ_MAX.
    """
    ts = mem.get("resolution_timestamp_utc") or mem.get("timestamp_utc")
    age_days = 90.0
    if ts:
        try:
            parsed = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            age_days = max(0.0, (datetime.now(timezone.utc) - parsed).days)
        except (ValueError, TypeError):
            age_days = 90.0
    recency_factor = math.exp(-math.log(2) / 180.0 * age_days)  # 1.0 today -> 0.5 at 180d

    actual_impact = abs(mem.get("actual_demand_shift") or 0)
    severity_factor = min(actual_impact / 20.0, 1.0) if actual_impact else 0.5

    return round(min(_MEMORY_ADJ_MAX * recency_factor * severity_factor, _MEMORY_ADJ_MAX), 1)


_PROMPT_INJECTION_PATTERNS = [
    r"ignore (?:previous|all|above|prior) instructions?",
    r"you are now",
    r"new instructions?:",
    r"system\s*:",
    r"<\|im_start\|>",
    r"<\|im_end\|>",
    r"###\s*(?:instruction|system|human|assistant)",
]


def _sanitize_for_prompt(user_input: str, max_length: int = 500) -> str:
    """Defense-in-depth sanitisation of user text before it enters an LLM prompt.

    Truncates, strips control characters, and neutralises common prompt-injection
    phrases. Not a guarantee, but it raises the bar significantly.
    """
    if not user_input:
        return ""
    text = str(user_input)[:max_length]
    text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", text)
    for pattern in _PROMPT_INJECTION_PATTERNS:
        text = re.sub(pattern, "[redacted]", text, flags=re.IGNORECASE)
    return text.strip()


NEWS_QUERY = "supply chain disruption OR port closure OR cyclone OR strike OR factory shutdown India"
INDIA_LOCATION_KEYWORDS = [
    "Chennai",
    "Mumbai",
    "Pune",
    "Bengaluru",
    "Delhi",
    "Tamil Nadu",
    "Maharashtra",
    "Gujarat",
    "Rajasthan",
    "Kolkata",
    "Hyderabad",
]
WEATHER_MONITOR_POINTS = {
    "Chennai": {"latitude": 13.08, "longitude": 80.27},
    "Mumbai": {"latitude": 19.07, "longitude": 72.87},
    "Kolkata": {"latitude": 22.57, "longitude": 88.36},
    "Bengaluru": {"latitude": 12.97, "longitude": 77.59},
    "Pune": {"latitude": 18.52, "longitude": 73.85},
    "Delhi": {"latitude": 28.61, "longitude": 77.20},
    "Ahmedabad": {"latitude": 23.03, "longitude": 72.58},
    "Kochi": {"latitude": 9.93, "longitude": 76.26},
}
WMO_WEATHER_DESCRIPTIONS = [
    (95, "Thunderstorm"),
    (80, "Heavy Rain Showers"),
    (71, "Snow / Sleet"),
    (61, "Heavy Rain"),
    (51, "Drizzle / Light Rain"),
    (45, "Fog"),
    (1, "Clear / Partly Cloudy"),
    (0, "Clear Sky"),
]
_processed_urls: set[str] = set()
_processed_weather_events: set[str] = set()
_recent_alerts = deque(maxlen=50)
_city_weather: dict[str, dict] = {}
_city_air_quality: dict[str, dict] = {}
_news_emit_callback = None


def compute_severity(description, location: str = "") -> int:
    """Compute event severity 1-10 from description/location keywords.

    Accepts either:
      - compute_severity(description: str, location: str) — legacy positional form
      - compute_severity(event: dict) — single-arg form used by tests and
        downstream callers that already have the event object. When an
        explicit ``severity_score`` is present on the event dict, it wins.
    """
    if isinstance(description, dict):
        event = description
        explicit = event.get("severity_score")
        if explicit is not None:
            try:
                return int(max(1, min(10, round(float(explicit)))))
            except (TypeError, ValueError):
                pass
        description = str(event.get("description", ""))
        location = str(event.get("location") or event.get("geography") or "")

    text = (str(description) + " " + str(location)).lower()
    score = 4

    if any(w in text for w in ["cyclone", "hurricane", "typhoon"]):
        score += 3
    if any(w in text for w in ["flood", "earthquake", "tsunami"]):
        score += 3
    if any(w in text for w in ["strike", "protest", "shutdown", "closure"]):
        score += 2
    if any(w in text for w in ["delay", "disruption", "shortage"]):
        score += 1
    if any(w in text for w in ["geopolitical", "war", "sanction", "blockade"]):
        score += 3
    if any(w in text for w in ["fire", "explosion", "accident"]):
        score += 2

    if any(w in text for w in ["chennai", "mumbai", "nhava sheva", "jnpt"]):
        score += 1
    if any(w in text for w in ["port", "harbour", "terminal", "airport"]):
        score += 1

    if any(w in text for w in ["category 4", "category 5", "severe", "major"]):
        score += 1
    if any(w in text for w in ["72 hours", "week", "extended", "indefinite"]):
        score += 1

    return min(score, 10)


def compute_scenario_probabilities(effectiveness_score: int, severity: int) -> dict:
    base_optimistic = 40 + (effectiveness_score - 50) * 0.6
    base_optimistic = max(25, min(75, base_optimistic))

    severity_penalty = (severity - 5) * 2
    optimistic = round(base_optimistic - severity_penalty)
    optimistic = max(20, min(70, optimistic))

    pessimistic = max(5, round(30 - effectiveness_score * 0.2 + severity_penalty * 0.5))
    pessimistic = max(5, min(25, pessimistic))

    baseline = 100 - optimistic - pessimistic

    return {"Optimistic": optimistic, "Baseline": baseline, "Pessimistic": pessimistic}


def compute_cost_delta(action_type: str, urgency: str, quantity: int) -> float:
    base = 0.0
    action_lower = action_type.lower()
    if "air" in action_lower or "freight" in action_lower:
        base = 20.0
    elif "alternate" in action_lower or "switch" in action_lower:
        base = 8.0
    elif "defer" in action_lower or "delay" in action_lower:
        base = 0.0
    elif "buffer" in action_lower or "stock" in action_lower:
        base = 5.0

    if urgency == "Immediate":
        base *= 1.4
    elif urgency == "Urgent":
        base *= 1.2

    return round(base, 1)


def compute_rto(option: dict, severity: int) -> dict:
    """Feature 7 — estimate the Recovery Time Objective for an action option.
    Deterministic: action archetype base hours, scaled by severity and urgency."""
    action_type = (option.get("action_type") or "").lower()
    urgency = option.get("urgency_tier", "Medium")

    if "air" in action_type or "freight" in action_type:
        base = 48
    elif "buffer" in action_type or "stock" in action_type:
        base = 36
    elif "alternate" in action_type or "switch" in action_type or "activate" in action_type:
        base = 96
    elif "defer" in action_type or "delay" in action_type:
        base = 240
    else:
        base = 120

    severity_factor = round(1.0 + max(0, severity - 5) * 0.12, 2)
    urgency_factor = {"Immediate": 0.8, "Urgent": 0.9, "Medium": 1.0}.get(urgency, 1.0)
    rto_hours = round(base * severity_factor * urgency_factor)

    tier = "fast" if rto_hours <= 48 else "moderate" if rto_hours <= 120 else "slow"
    days = rto_hours / 24
    if rto_hours < 24:
        human = f"~{rto_hours}h"
    elif days < 1.5:
        human = "~1 day"
    else:
        human = f"~{round(days)} days"

    return {
        "rto_hours": rto_hours,
        "rto_human": human,
        "rto_tier": tier,
        "basis": f"{base}h base x{severity_factor} severity x{urgency_factor} urgency",
    }


def weather_code_to_severity(code: int, wind_kmh: float, precip_mm: float) -> int:
    base = 0
    if code >= 95:
        base = 7
    elif code >= 80:
        base = 6
    elif code >= 71:
        base = 5
    elif code >= 61:
        base = 5
    elif code >= 51:
        base = 3
    else:
        base = 1
    if wind_kmh > 80:
        base += 2
    elif wind_kmh > 50:
        base += 1
    if precip_mm > 100:
        base += 2
    elif precip_mm > 50:
        base += 1
    return min(base, 10)


def weather_code_to_description(code: int) -> str:
    for threshold, label in WMO_WEATHER_DESCRIPTIONS:
        if code >= threshold:
            return label
    return "Clear / Partly Cloudy"


def _alert_status_for_severity(severity: int) -> str:
    if severity >= 6:
        return "warning"
    if severity >= 5:
        return "watch"
    return "clear"


def _detected_locations(text: str) -> list[str]:
    lowered = text.lower()
    return [loc for loc in INDIA_LOCATION_KEYWORDS if loc.lower() in lowered]


def _build_severity_rationale(description: str, location: str, severity: int) -> str:
    triggers = []
    text = f"{description} {location}".lower()
    if any(w in text for w in ["cyclone", "flood", "earthquake", "tsunami"]):
        triggers.append("natural hazard")
    if any(w in text for w in ["strike", "shutdown", "closure", "protest"]):
        triggers.append("operational stoppage")
    if any(w in text for w in ["port", "harbour", "terminal", "airport"]):
        triggers.append("logistics hub exposure")
    if any(w in text for w in ["week", "extended", "indefinite", "72 hours"]):
        triggers.append("extended disruption window")
    if not triggers:
        triggers.append("localized supply impact")
    return f"Severity {severity}/10 driven by {', '.join(triggers[:3])} around {location or 'the affected area'}."


def _compute_effectiveness_score(option: dict, severity: int, risk: dict) -> int:
    score = 55
    action_type = (option.get("action_type") or "").lower()
    urgency = option.get("urgency_tier")
    quantity = int(option.get("quantity") or 0)
    supplier_id = option.get("supplier_id")

    supplier = next((s for s in risk.get("suppliers", []) if s["supplier_id"] == supplier_id), None)
    if supplier:
        if supplier["is_critical"]:
            score -= 25
        elif supplier["risk_tier"] == "High":
            score += 6
        else:
            score += 14

    if "alternate" in action_type or "switch" in action_type:
        score += 12
    if "air" in action_type or "freight" in action_type:
        score += 8
    if "buffer" in action_type or "stock" in action_type:
        score += 6
    if "defer" in action_type or "delay" in action_type:
        score -= 4

    if urgency == "Immediate":
        score += 4 if severity >= 8 else 1
    elif urgency == "Urgent":
        score += 3

    score += min(10, round(quantity / 100))
    return max(1, min(100, score))


def _append_recent_alert(item: dict):
    _recent_alerts.appendleft(item)


def get_latest_news_articles() -> list[dict]:
    items = list(_recent_alerts)
    return sorted(
        items,
        key=lambda item: item.get("published_at") or item.get("timestamp_utc") or "",
        reverse=True,
    )[:50]


def get_current_weather_snapshot() -> dict:
    cities = []
    for city_name, coords in WEATHER_MONITOR_POINTS.items():
        weather = _city_weather.get(city_name, {})
        cities.append({
            "name": city_name,
            "lat": coords["latitude"],
            "lon": coords["longitude"],
            "weathercode": weather.get("weathercode"),
            "weather_description": weather.get("weather_description"),
            "wind_kmh": weather.get("wind_kmh"),
            "precip_mm_24h": weather.get("precip_mm_24h"),
            "severity_score": weather.get("severity_score"),
            "alert_status": weather.get("alert_status", "clear"),
            "last_updated_utc": weather.get("last_updated_utc"),
            "air_quality": _city_air_quality.get(city_name, {}),
        })
    return {"cities": cities}


def set_news_emit_callback(callback):
    global _news_emit_callback
    _news_emit_callback = callback


async def poll_news_and_trigger() -> list[dict]:
    if not config.NEWSAPI_KEY or config.NEWSAPI_KEY.startswith("PLACEHOLDER"):
        return []

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": NEWS_QUERY,
                    "language": "en",
                    "sortBy": "publishedAt",
                    "pageSize": 10,
                    "apiKey": config.NEWSAPI_KEY,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        print(f"[news] poll failed: {exc}")
        return []

    results = []
    for article in payload.get("articles", []):
        article_url = article.get("url")
        if not article_url or article_url in _processed_urls:
            continue

        title = article.get("title") or ""
        description = article.get("description") or ""
        matches = _detected_locations(f"{title} {description}")
        if not matches:
            continue

        detected_location = matches[0]
        publisher = ((article.get("source") or {}).get("name")) or "Unknown Publisher"
        event_raw = {
            "description": f"{title} - {description}".strip(" -"),
            "location": detected_location,
            "source": "NewsAPI",
            "type": "News Alert",
        }
        monitor_result = await monitor_agent(event_raw)
        news_item = {
            "title": title,
            "description": description,
            "source": "NewsAPI",
            "source_name": publisher,
            "published_at": article.get("publishedAt") or _now_utc(),
            "timestamp_utc": article.get("publishedAt") or _now_utc(),
            "url": article_url,
            "location": detected_location,
            "severity": monitor_result.get("severity_score"),
            "event_type": monitor_result.get("event_type"),
        }
        _append_recent_alert(news_item)
        _processed_urls.add(article_url)
        if _news_emit_callback and monitor_result.get("severity_score", 0) >= config.MINIMUM_SEVERITY_TO_ALERT:
            await _news_emit_callback(news_item, monitor_result)
        results.append({"article": news_item, "monitor": monitor_result})

    return results


async def news_polling_loop():
    while True:
        await poll_news_and_trigger()
        await asyncio.sleep(config.NEWSAPI_POLL_INTERVAL_MINUTES * 60)


async def poll_open_meteo() -> list[dict]:
    results = []
    for city, coords in WEATHER_MONITOR_POINTS.items():
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                forecast_response = await client.get(
                    config.OPENMETEO_BASE.rstrip("/") + "/forecast",
                    params={
                        "latitude": coords["latitude"],
                        "longitude": coords["longitude"],
                        "daily": "weathercode,precipitation_sum,windspeed_10m_max,temperature_2m_max",
                        "timezone": "Asia/Kolkata",
                        "forecast_days": 3,
                    },
                )
                forecast_response.raise_for_status()
                forecast_payload = forecast_response.json()

                air_response = await client.get(
                    config.OPENMETEO_AIR_QUALITY_BASE.rstrip("/") + "/air-quality",
                    params={
                        "latitude": coords["latitude"],
                        "longitude": coords["longitude"],
                        "hourly": "pm10,pm2_5",
                        "timezone": "Asia/Kolkata",
                    },
                )
                air_response.raise_for_status()
                air_payload = air_response.json()
        except Exception as exc:
            print(f"[weather] poll failed for {city}: {exc}")
            continue

        daily = forecast_payload.get("daily", {})
        dates = daily.get("time", [])
        codes = daily.get("weathercode", [])
        precipitation = daily.get("precipitation_sum", [])
        windspeeds = daily.get("windspeed_10m_max", [])
        if dates:
            weather_code = int(codes[0]) if codes else 0
            wind_kmh = float(windspeeds[0]) if windspeeds else 0.0
            precip_mm = float(precipitation[0]) if precipitation else 0.0
            severity = weather_code_to_severity(weather_code, wind_kmh, precip_mm)
            updated_at = _now_utc()
            _city_weather[city] = {
                "weathercode": weather_code,
                "weather_description": weather_code_to_description(weather_code),
                "wind_kmh": round(wind_kmh, 1),
                "precip_mm_24h": round(precip_mm, 1),
                "severity_score": severity,
                "alert_status": _alert_status_for_severity(severity),
                "last_updated_utc": updated_at,
            }

            if severity >= 5:
                fingerprint = f"{city}:{dates[0]}"
                if fingerprint not in _processed_weather_events:
                    event_raw = {
                        "description": (
                            f"Open-Meteo weather alert: WMO code {weather_code} forecast for {city}. "
                            f"Wind {round(wind_kmh, 1)} km/h, precipitation {round(precip_mm, 1)}mm expected."
                        ),
                        "location": city,
                        "source": "Open-Meteo",
                        "type": "Weather Alert",
                    }
                    monitor_result = await monitor_agent(event_raw)
                    alert = {
                        "title": f"Open-Meteo weather alert for {city}",
                        "description": event_raw["description"],
                        "source": "Open-Meteo",
                        "published_at": updated_at,
                        "timestamp_utc": updated_at,
                        "url": None,
                        "location": city,
                        "severity": monitor_result.get("severity_score"),
                        "event_type": "Weather Alert",
                    }
                    _append_recent_alert(alert)
                    _processed_weather_events.add(fingerprint)
                    if _news_emit_callback and monitor_result.get("severity_score", 0) >= config.MINIMUM_SEVERITY_TO_ALERT:
                        await _news_emit_callback(alert, monitor_result)
                    results.append({"article": alert, "monitor": monitor_result})

        hourly = air_payload.get("hourly", {})
        hours = hourly.get("time", [])
        pm10_values = hourly.get("pm10", [])
        pm25_values = hourly.get("pm2_5", [])
        if hours:
            _city_air_quality[city] = {
                "timestamp": hours[0],
                "pm10": pm10_values[0] if pm10_values else None,
                "pm2_5": pm25_values[0] if pm25_values else None,
            }
    return results


async def openmeteo_polling_loop():
    while True:
        await poll_open_meteo()
        await asyncio.sleep(config.OPENMETEO_POLL_INTERVAL_MINUTES * 60)


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-001 — MONITOR AGENT (BR-001)
# Disruption Event Watchdog and Cascade Pre-Screener
# ════════════════════════════════════════════════════════════════════════════

async def monitor_agent(event_raw: dict) -> dict:
    event_id = f"EVT-{str(uuid.uuid4())[:8].upper()}"
    storage.write_audit(event_id, "MonitorAgent", "event_received",
                        f"src={event_raw.get('source','manual')}",
                        event_raw.get("description", "")[:80])

    description = event_raw.get("description", "")
    fallback = {
        "affected_geography": event_raw.get("location", "Chennai"),
        "event_type": event_raw.get("type", "Disruption Event"),
    }

    # Sanitise user-supplied text before it reaches the LLM (prompt-injection
    # defense). Originals are kept for deterministic scoring and storage below.
    safe_description = _sanitize_for_prompt(description, max_length=500)
    safe_location = _sanitize_for_prompt(event_raw.get("location", "Unknown"), max_length=100)
    safe_source = _sanitize_for_prompt(event_raw.get("source", "Manual"), max_length=100)

    parsed = await llm.chat_json(
        system=("You are the Monitor Agent for DisruptIQ supply chain disruption AI. "
                "Classify the event only. Do not compute scores or probabilities. "
                'Schema: {"affected_geography": str, "event_type": str}'),
        user=f"Event description: {safe_description}\n"
             f"Location: {safe_location}\n"
             f"Source: {safe_source}",
        max_tokens=300,
        fallback=fallback,
    )

    geography = parsed.get("affected_geography", event_raw.get("location", "Chennai"))
    severity = compute_severity(description, geography)
    rationale = _build_severity_rationale(description, geography, severity)

    # Cascade pre-screen (BR-001) — check active events within window
    active_events = storage.get_active_events()
    cascade_flag = False
    cascade_partner = None
    overlap_zones = CASCADE_ZONE_MAP.get(geography, [geography])
    for ae in active_events:
        if ae.get("geography") in overlap_zones or geography in CASCADE_ZONE_MAP.get(ae.get("geography", ""), []):
            hours_diff = abs(time.time() - ae.get("timestamp_unix", 0)) / 3600
            if hours_diff <= config.CASCADE_WINDOW_HOURS:
                cascade_flag = True
                cascade_partner = {k: v for k, v in ae.items() if k != "cascade_partner_event"}
                break

    result = {
        "event_id": event_id,
        "source": event_raw.get("source", "Manual"),
        "description": description,
        "geography": geography,
        "event_type": parsed.get("event_type", "Unknown"),
        "severity_score": severity,
        "severity_rationale": rationale,
        "escalate": severity >= config.SEVERITY_THRESHOLD,
        "cascade_flag": cascade_flag,
        "cascade_partner_event": cascade_partner,
        "timestamp_unix": time.time(),
        "timestamp_utc": _now_utc(),
    }

    storage.write_audit(event_id, "MonitorAgent", "scored",
                        f"severity={severity}",
                        f"escalate={result['escalate']} cascade={cascade_flag}")
    return result


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-003 — FORECAST AGENT (BR-003)
# Memory-Calibrated Demand Impact Predictor
# ════════════════════════════════════════════════════════════════════════════

# Lazy-loaded XGBoost model
def _xgb_predict(
    severity: float, geo_id: float, event_type_id: float,
    supplier_count: float = 0, avg_buffer_days: float = 14.0, avg_reliability: float = 85.0
) -> float:
    """Transparent, explainable demand-shift estimate.

    This is intentionally rule-based, NOT a machine-learning model. The earlier
    XGBoost variant was trained on randomly generated data at startup, so its
    "predictions" were noise dressed up as ML. The factors below (severity,
    event type, buffer depth, reliability, supplier count) are honest domain
    heuristics. `geo_id` is accepted for signature compatibility but unused.
    """
    base = severity * 3.0 + event_type_id * 1.0
    # Thin buffers amplify impact; deep buffers absorb it.
    if avg_buffer_days <= 3:
        base *= 1.3
    elif avg_buffer_days >= 14:
        base *= 0.8
    # Low-reliability suppliers amplify; high-reliability dampen.
    if avg_reliability <= 70:
        base *= 1.2
    elif avg_reliability >= 95:
        base *= 0.85
    # More suppliers means more alternatives, so less net shift.
    if supplier_count >= 10:
        base *= 0.85
    elif 0 < supplier_count <= 3:
        base *= 1.2
    return round(base, 2)


async def forecast_agent(event: dict, memory_context: list[dict], suppliers: list = None) -> dict:
    severity = event.get("severity_score", 6)
    geography = event.get("geography", "")
    geo_id = abs(hash(geography)) % 10
    event_type = event.get("event_type", "")
    event_type_id = abs(hash(event_type)) % 10

    # Compute supplier statistics for enhanced XGBoost features
    supplier_count = len(suppliers) if suppliers else 0
    if suppliers:
        avg_buffer_days = sum(s.get("buffer_stock_days", 14) for s in suppliers) / max(supplier_count, 1)
        avg_reliability = sum(s.get("reliability", 85) for s in suppliers) / max(supplier_count, 1)
    else:
        avg_buffer_days = 14.0
        avg_reliability = 85.0

    base_shift = _xgb_predict(severity, geo_id, event_type_id, supplier_count, avg_buffer_days, avg_reliability)

    # Memory calibration (BR-003) — recalibrate from prior actuals via MCF algorithm
    matching_stage2 = [
        m for m in memory_context
        if m.get("stage") == 2
        and m.get("event_type") == event_type
        and m.get("actual_demand_shift") is not None
        and m.get("predicted_demand_shift") is not None
    ]
    mcf_result = memory_calibrated_forecast(base_shift, matching_stage2)
    calibration_applied = mcf_result["sample_size"] > 0
    calibration_delta = mcf_result["adjustment_applied"]
    calibration_note = None
    federated_baseline_used = None
    if calibration_applied:
        first = matching_stage2[0]
        predicted = first.get("predicted_demand_shift", 0)
        actual = first.get("actual_demand_shift", 0)
        calibration_note = (
            f"Prior {event_type} in {first.get('geography')}: "
            f"predicted {predicted:.1f}%, actual {actual:.1f}% "
            f"(MCF n={mcf_result['sample_size']}, applied {calibration_delta:+.1f}% calibration, "
            f"+{mcf_result['confidence_boost']}pt confidence)"
        )
        base_shift = mcf_result["calibrated_forecast"]
    else:
        # Section 5 Sprint - federated baseline cold start.
        # Only consulted when this client has no own Stage-2 history for this
        # event_type. Blended at reduced weight so federated wisdom never
        # outvotes the client's own future calibration.
        try:
            baseline = federated_memory.get_baseline_for_forecast(
                event_type, geography, own_stage2_count=len(matching_stage2),
            )
            if baseline and baseline.get("mean_actual_demand_shift") is not None:
                baseline_shift = float(baseline["mean_actual_demand_shift"])
                blend_weight = federated_memory.FEDERATED_WEIGHT_DEFAULT
                blended = base_shift * (1 - blend_weight) + baseline_shift * blend_weight
                calibration_delta = round(blended - base_shift, 2)
                base_shift = blended
                federated_baseline_used = baseline
                calibration_note = (
                    f"Federated baseline cold-start: n={baseline['sample_size']} events "
                    f"across {baseline['contributing_clients']} clients (confidence={baseline['confidence']}). "
                    f"Blended at weight {blend_weight} -> {calibration_delta:+.1f}% adjustment."
                )
        except Exception as exc:
            logger.warning("Federated baseline lookup failed: %s", exc)

    # Build categories from THIS client's actual supplier categories.
    # Never hardcode "Refrigeration / HVAC / Electronics" — they leak demo data into real clients.
    client_categories: list[str] = []
    seen_cats = set()
    for sup in (suppliers or []):
        for cat in sup.get("categories", []) or []:
            normalized = str(cat).strip()
            if normalized and normalized.lower() not in seen_cats:
                client_categories.append(normalized)
                seen_cats.add(normalized.lower())
            if len(client_categories) >= 3:
                break
        if len(client_categories) >= 3:
            break

    # If client has no suppliers yet, fall back to a single generic "Operations" entry.
    if not client_categories:
        client_categories = ["Operations"]

    fallback_categories = []
    confidence_levels = [0.87, 0.62, 0.78]
    shift_multipliers = [1.0, 0.5, 0.75]
    cal_multipliers = [1.0, 0.5, 0.7]
    for i, cat in enumerate(client_categories[:3]):
        conf = confidence_levels[i] if i < len(confidence_levels) else 0.7
        fallback_categories.append({
            "category": cat,
            "demand_shift_pct": round(base_shift * shift_multipliers[i] + calibration_delta * cal_multipliers[i], 1),
            "confidence": conf,
            "low_confidence": conf < 0.70,
        })

    # Build a dataset-aware, severity-specific narrative (not a generic template).
    primary_cat = client_categories[0]
    secondary_part = f" and {client_categories[1]}" if len(client_categories) > 1 else ""
    tertiary_part = f", with secondary effects on {client_categories[2]}" if len(client_categories) > 2 else ""
    event_label = (event_type or "disruption").lower()
    sev_word = (
        "severe" if severity >= 8 else
        "significant" if severity >= 6 else
        "moderate" if severity >= 4 else "mild"
    )
    direction = "spike" if base_shift > 5 else ("dip" if base_shift < -5 else "shift")
    buffer_phrase = (
        f"avg buffer {avg_buffer_days:.0f}d gives limited cushion" if avg_buffer_days < 14 else
        f"buffer stock ({avg_buffer_days:.0f}d avg) provides reasonable cushion" if avg_buffer_days < 30 else
        f"strong buffer cushion ({avg_buffer_days:.0f}d avg) absorbs short-term shock"
    )
    fallback = {
        "affected_categories": fallback_categories,
        "narrative": (
            f"A {sev_word} {event_label} in {geography} is projected to drive a {direction} "
            f"in {primary_cat}{secondary_part}{tertiary_part}. Across your {supplier_count} supplier(s), "
            f"{buffer_phrase}; prioritise procurement re-routing for the {primary_cat} category first."
        ),
    }

    memory_block = f"\nMemory calibration: {calibration_note}" if calibration_note else ""
    cats_block = (
        f"\nThe affected client procures these categories ONLY (you MUST pick from these — "
        f"do NOT invent unrelated categories like refrigeration/HVAC/electronics): "
        f"{', '.join(client_categories)}"
    ) if suppliers else ""
    parsed = await llm.chat_json(
        system=("You are the Forecast Agent for DisruptIQ. Predict demand shift across affected categories. "
                "ALWAYS pick categories from the client's own supplier categories provided in the prompt. "
                "Schema: {\"affected_categories\":[{\"category\":str,\"demand_shift_pct\":float,"
                "\"confidence\":float (0-1),\"low_confidence\":bool}], \"narrative\":str (<60 words)}"),
        user=(f"Event: {event.get('description')}\nGeography: {geography}\n"
              f"Severity: {severity}/10\nBase model prediction: {base_shift:.1f}%{memory_block}{cats_block}"),
        max_tokens=400, fallback=fallback,
    )

    # Add confidence intervals (Feature 5b)
    for cat in parsed.get("affected_categories", []):
        shift = cat.get("demand_shift_pct", 0)
        conf = cat.get("confidence", 0.7)
        if conf < 0.70:
            cat["confidence_interval"] = {"low": round(shift * 0.6, 1), "high": round(shift * 1.4, 1)}
        else:
            cat["confidence_interval"] = {"low": round(shift * 0.8, 1), "high": round(shift * 1.2, 1)}

    parsed["memory_calibration_applied"] = calibration_applied
    parsed["memory_context_used"] = calibration_note
    parsed["mcf_adjustment"] = mcf_result["adjustment_applied"]
    parsed["mcf_confidence_boost"] = mcf_result["confidence_boost"]
    parsed["mcf_sample_size"] = mcf_result["sample_size"]
    # Section 5 Sprint: tag the response when federated cold-start was used,
    # so the UI's MemoryLedger panel can show "calibrated from N events across
    # K clients" instead of leaving the user thinking the forecast is naive.
    if federated_baseline_used:
        parsed["baseline_source"] = "federated"
        parsed["federated_baseline"] = federated_baseline_used
    parsed["model_version"] = "xgb-v1.4+mcf"
    parsed["model_run_timestamp_utc"] = _now_utc()

    storage.write_audit(event["event_id"], "ForecastAgent", "forecast_complete",
                        f"geo={geography} severity={severity}",
                        f"categories={len(parsed.get('affected_categories', []))} "
                        f"memory_calib={calibration_applied}")
    return parsed


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-004 — RISK AGENT (BR-004)
# Memory-Adjusted Supplier Risk Scorer
# ════════════════════════════════════════════════════════════════════════════

# Feature 5 — "What Changed?": per-supplier plain-English score breakdown.
_RISK_FACTOR_WEIGHTS = {
    "proximity": 0.30, "buffer_score": 0.25, "site_score": 0.20,
    "reliability_score": 0.15, "category_score": 0.10,
}

# Dynamic category exposure: which supplier categories face elevated risk per event type
_EVENT_CATEGORY_RISK: dict[str, list[str]] = {
    "port closure":        ["logistics", "cold-chain", "import", "shipping", "freight", "export"],
    "cyclone":             ["logistics", "refrigeration", "cold-chain", "outdoor", "agriculture", "fisheries"],
    "flood":               ["agriculture", "food", "beverage", "raw material", "chemicals", "textiles"],
    "fire":                ["manufacturing", "electronics", "chemicals", "plastics", "warehousing"],
    "earthquake":          ["manufacturing", "infrastructure", "construction", "utilities"],
    "strike":              ["logistics", "manufacturing", "assembly", "ports", "transport"],
    "insolvency":          [],
    "pandemic":            ["healthcare", "pharmaceutical", "food", "fmcg", "ppe"],
    "drought":             ["agriculture", "food", "beverage", "raw material", "water"],
    "highway closure":     ["logistics", "cold-chain", "freight", "transport"],
    "supplier insolvency": [],
    "trade dispute":       ["electronics", "manufacturing", "automotive", "import", "export"],
    "power outage":        ["manufacturing", "electronics", "cold-chain", "refrigeration"],
    "rail disruption":     ["automotive", "manufacturing", "bulk materials", "logistics"],
}


def _compute_category_exposure(event_type: str, categories: list[str], severity: float) -> int:
    """Dynamic category exposure score (0–40) based on event type × supplier categories × severity."""
    event_lower = event_type.lower()
    risk_keywords: list[str] = []
    for etype, keywords in _EVENT_CATEGORY_RISK.items():
        if etype in event_lower:
            risk_keywords = keywords
            break

    sup_cats_text = " ".join(categories).lower()

    if not risk_keywords:
        return min(35, max(5, int(severity * 3)))

    match_count = sum(1 for kw in risk_keywords if kw in sup_cats_text)

    base_exposure = min(40, 5 + match_count * 12)
    severity_amp = 1.0 + max(0.0, severity - 5) * 0.06
    return min(40, round(base_exposure * severity_amp))


def _factor_status(key: str, raw_val: float) -> str:
    """Return critical/warning/ok health status for each risk factor."""
    thresholds = {
        "proximity":         (70, 40),
        "buffer_score":      (70, 40),
        "site_score":        (40, 20),
        "reliability_score": (30, 15),
        "category_score":    (30, 15),
    }
    hi, mid = thresholds.get(key, (70, 40))
    if raw_val >= hi:
        return "critical"
    if raw_val >= mid:
        return "warning"
    return "ok"


def _build_risk_explanation(s: dict, memory_context: list[dict], event: dict | None = None) -> dict:
    """Explain WHY a supplier received its composite risk score — with rich factor context."""
    factors = s["factors"]
    contributions = {k: round(v * _RISK_FACTOR_WEIGHTS[k], 1) for k, v in factors.items()}
    top_factor = max(contributions, key=contributions.get)
    event_type = (event or {}).get("event_type", "disruption")
    geography  = (event or {}).get("geography", "the affected zone")
    severity   = (event or {}).get("severity_score", 5)

    buffer_risk_label = (
        "CRITICAL — imminent stockout" if s["buffer_stock_days"] <= 3
        else "HIGH — limited runway" if s["buffer_stock_days"] <= 7
        else "MODERATE" if s["buffer_stock_days"] <= 14
        else "LOW"
    )
    reliability_label = (
        "Well below target" if s["reliability"] < 75
        else "Below threshold" if s["reliability"] < 85
        else "Meets threshold" if s["reliability"] < 95
        else "Excellent"
    )
    cats_str = ", ".join((s.get("categories") or ["general"])[:3])
    prox_raw = s.get("proximity_score_raw", round(factors["proximity"] / 10))

    factor_details = {
        "proximity": {
            "label": "Geographic Proximity",
            "icon": "📍",
            "raw": factors["proximity"],
            "weighted": contributions["proximity"],
            "status": _factor_status("proximity", factors["proximity"]),
            "interpretation": (
                f"Proximity score {prox_raw}/10 — supplier is "
                f"{'directly inside' if prox_raw >= 8 else 'adjacent to' if prox_raw >= 5 else 'distant from'} "
                f"the {geography} disruption zone, contributing {contributions['proximity']} weighted points."
            ),
        },
        "buffer_score": {
            "label": "Buffer Stock",
            "icon": "📦",
            "raw": factors["buffer_score"],
            "weighted": contributions["buffer_score"],
            "status": _factor_status("buffer_score", factors["buffer_score"]),
            "interpretation": (
                f"{s['buffer_stock_days']} day{'s' if s['buffer_stock_days'] != 1 else ''} of buffer on hand — "
                f"stockout risk is {buffer_risk_label}. "
                f"If the {event_type} lasts longer than {s['buffer_stock_days']}d, supply will be exhausted."
            ),
        },
        "site_score": {
            "label": "Site Concentration",
            "icon": "🏭",
            "raw": factors["site_score"],
            "weighted": contributions["site_score"],
            "status": _factor_status("site_score", factors["site_score"]),
            "interpretation": (
                f"{s['sites']} production site{'s' if s['sites'] != 1 else ''}. "
                + (
                    "Single-site operation — zero geographic failover; one hit takes down all capacity."
                    if s["sites"] == 1
                    else f"Limited redundancy across {s['sites']} sites reduces but does not eliminate single-point failure."
                    if s["sites"] <= 2
                    else "Multi-site distribution significantly reduces concentration risk."
                )
            ),
        },
        "reliability_score": {
            "label": "Historical Reliability",
            "icon": "✅",
            "raw": factors["reliability_score"],
            "weighted": contributions["reliability_score"],
            "status": _factor_status("reliability_score", factors["reliability_score"]),
            "interpretation": (
                f"{s['reliability']}% on-time delivery ({reliability_label}). "
                + (
                    "Under disruption stress, unreliable suppliers fail first and recover last."
                    if s["reliability"] < 85
                    else "Reliable under normal conditions, but performance under major disruptions is unknown."
                )
            ),
        },
        "category_score": {
            "label": "Category Exposure",
            "icon": "🏷",
            "raw": factors["category_score"],
            "weighted": contributions["category_score"],
            "status": _factor_status("category_score", factors["category_score"]),
            "interpretation": (
                f"Supplies: {cats_str}. "
                f"These categories face "
                f"{'high' if factors['category_score'] >= 30 else 'moderate' if factors['category_score'] >= 15 else 'low'} "
                f"direct exposure to {event_type} events at severity {severity}/10."
            ),
        },
    }

    drivers = []
    if factors["proximity"] >= 70:
        drivers.append(f"Geographic proximity directly exposes this supplier to the {event_type} impact in {geography}")
    if factors["buffer_score"] >= 60:
        drivers.append(f"Only {s['buffer_stock_days']}d of buffer — stockout is likely if disruption exceeds this window")
    if factors["site_score"] >= 30:
        drivers.append(f"{'Single-site' if s['sites'] == 1 else 'Limited-site'} operation — no redundancy if {geography} is affected")
    if factors["reliability_score"] >= 20:
        drivers.append(f"Reliability {s['reliability']}% raises failure probability under disruption stress")
    if factors["category_score"] >= 25:
        drivers.append(f"Supplier categories ({cats_str}) are directly impacted by {event_type} events")
    if not drivers:
        drivers.append("Risk is distributed across factors with no single dominant driver — supplier shows relative resilience.")

    memory_note = None
    if s["memory_adjustment"] > 0:
        mem = next((m for m in memory_context if m.get("memory_id") == s.get("memory_source_event")), None)
        if mem:
            memory_note = (
                f"Score raised +{s['memory_adjustment']} pts from historical data: "
                f"a {mem.get('event_type', 'similar event')} in {mem.get('geography', 'this zone')} "
                f"previously resulted in \"{mem.get('actual_outcome', 'a negative outcome')}\" — "
                f"the AI has learned this supplier underperforms in similar conditions."
            )
        else:
            memory_note = (
                f"Score raised +{s['memory_adjustment']} pts because prior disruption scenarios "
                f"recorded negative outcomes for this supplier."
            )

    recommended_action = {
        "Critical": f"Immediately activate contingency — switch procurement away from this supplier. Do not rely on them during the {event_type}.",
        "High":     f"Pre-negotiate contingency orders with alternates now. Request {s['supplier_name']} confirm current stock and delivery timelines.",
        "Medium":   f"Place on watch status. Consider topping up buffer beyond {s['buffer_stock_days']}d to extend your coverage window.",
        "Low":      "No immediate action required. Continue standard monitoring and reassess if severity escalates.",
    }.get(s["risk_tier"], "Monitor and reassess as the situation evolves.")

    return {
        "supplier_id":          s["supplier_id"],
        "supplier_name":        s["supplier_name"],
        "composite_score":      s["composite_score"],
        "base_score":           s["base_score"],
        "memory_adjustment":    s["memory_adjustment"],
        "risk_tier":            s["risk_tier"],
        "buffer_stock_days":    s["buffer_stock_days"],
        "sites":                s["sites"],
        "reliability":          s["reliability"],
        "categories":           s.get("categories", []),
        "factor_contributions": contributions,
        "factor_details":       factor_details,
        "top_factor":           top_factor,
        "primary_drivers":      drivers,
        "memory_explanation":   memory_note,
        "recommended_action":   recommended_action,
        "llm_narrative":        None,
        "summary": (
            f"{s['supplier_name']} scores {s['composite_score']}/100 ({s['risk_tier']} tier). "
            f"Primary driver: {factor_details[top_factor]['label']} — "
            f"{factor_details[top_factor]['interpretation']}"
        ),
    }


async def _llm_enrich_risk_explanation(s: dict, event: dict, explanation: dict) -> str:
    """Generate a 3-sentence LLM narrative explaining supplier risk in plain business English."""
    fallback = explanation["summary"]
    prompt = {
        "supplier":       s["supplier_name"],
        "zone":           s["zone"],
        "risk_score":     s["composite_score"],
        "risk_tier":      s["risk_tier"],
        "event_type":     event.get("event_type"),
        "geography":      event.get("geography"),
        "severity":       event.get("severity_score"),
        "buffer_days":    s["buffer_stock_days"],
        "sites":          s["sites"],
        "reliability_pct":s["reliability"],
        "categories":     s.get("categories", []),
        "top_driver":     explanation["top_factor"],
        "primary_drivers":explanation["primary_drivers"],
    }
    return await llm.chat_text(
        system=(
            "You are a supply chain risk analyst explaining a supplier's risk score to a business manager. "
            "Write exactly 3 sentences: "
            "(1) What the score means and why this supplier is at this risk tier. "
            "(2) The single biggest risk factor and its real-world business implication. "
            "(3) What will likely happen to supply continuity if this disruption persists beyond the supplier's buffer. "
            "Use plain business English. Reference actual numbers from the data. Max 90 words total."
        ),
        user=json.dumps(prompt),
        max_tokens=220,
        fallback=fallback,
    )


async def fetch_supplier_news(supplier_name: str, zone: str = "", limit: int = 2) -> list[dict]:
    """Query NewsAPI for recent articles relevant to one supplier.

    Returns ``[]`` when the NewsAPI key is missing or the call fails. This is
    intentional — there is no synthetic fallback because fake supplier news
    would be misleading. Empty list = "we couldn't verify any current alerts".

    Caller responsibility: rate-limit. We only call this for the top-N scored
    suppliers in ``risk_agent`` so a swarm doesn't burn 30+ NewsAPI calls.
    """
    api_key = getattr(config, "NEWSAPI_KEY", None)
    if not api_key or str(api_key).startswith("PLACEHOLDER"):
        return []
    if not supplier_name:
        return []

    quoted_name = f'"{supplier_name}"'
    extras = f" OR ({zone})" if zone else ""
    query = f"({quoted_name}{extras}) AND (supply OR shipment OR production OR strike OR shortage)"

    url = "https://newsapi.org/v2/everything"
    params = {
        "q": query,
        "sortBy": "publishedAt",
        "language": "en",
        "pageSize": min(limit, 5),
        "apiKey": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, params=params)
            if r.status_code != 200:
                return []
            data = r.json()
    except Exception as exc:
        logger.debug("fetch_supplier_news failed for %s: %s", supplier_name, exc)
        return []

    articles = data.get("articles") or []
    out = []
    for a in articles[:limit]:
        out.append({
            "headline": (a.get("title") or "")[:160],
            "source": ((a.get("source") or {}).get("name") or "NewsAPI")[:60],
            "url": a.get("url"),
            "published_at": a.get("publishedAt"),
            "summary": (a.get("description") or "")[:240],
        })
    return out


async def risk_agent(event: dict, memory_context: list[dict], suppliers: list = None) -> dict:
    geography = event.get("geography", "")
    overlap_zones = CASCADE_ZONE_MAP.get(geography, [geography])
    # Never fall back to the global seed SUPPLIERS list — that would leak demo
    # suppliers into a real tenant. Callers must pass the client's own list.
    if suppliers is None:
        logger.warning("risk_agent called without suppliers; returning empty risk set")
        supplier_pool = []
    else:
        supplier_pool = suppliers
    directly_affected = [s for s in supplier_pool if s["zone"] in overlap_zones or s["zone"] == geography]
    # When no suppliers sit in the event zone (common for global portfolios where
    # the event location is in a different country), score the full portfolio.
    # Out-of-zone suppliers get proximity = 0 so they still appear ranked by
    # buffer, reliability, category exposure, and memory adjustment.
    affected    = directly_affected if directly_affected else supplier_pool
    in_zone_ids = {s["id"] for s in directly_affected}

    severity = event.get("severity_score", 5)

    # Five-factor weighted scoring (BRD §4.4 — deterministic core, dynamic category)
    scored = []
    for sup in affected:
        in_zone   = sup["id"] in in_zone_ids
        proximity = (sup["proximity_score"] * 10) if in_zone else 0
        buffer_score  = max(0, 100 - sup["buffer_stock_days"] * 5)
        site_score    = 40 if sup["sites"] == 1 else (20 if sup["sites"] == 2 else 5)
        reliability_s = max(0, 100 - sup["reliability"])
        # Dynamic: category exposure varies by event type × supplier categories × severity
        category_s    = _compute_category_exposure(
            event.get("event_type", ""), sup.get("categories", []), severity
        )

        base = round(proximity * 0.30 + buffer_score * 0.25 + site_score * 0.20 +
                     reliability_s * 0.15 + category_s * 0.10, 1)

        # Memory variance modifier (BR-004) — disclosed, scaled by recency + severity
        mem_adj = 0.0
        mem_source = None
        for mem in memory_context:
            if mem.get("supplier_id") == sup["id"] and mem.get("stage") == 2:
                outcome = (mem.get("actual_outcome") or "").lower()
                if "delay" in outcome or "disruption" in outcome or "late" in outcome:
                    mem_adj = _memory_risk_adjustment(mem)
                    mem_source = mem.get("memory_id")
                break

        # Memory confidence badge (Feature 5d) — based on count of stage-2 records
        stage2_count = sum(1 for m in memory_context
                          if m.get("supplier_id") == sup["id"] and m.get("stage") == 2)
        memory_confidence = "high" if stage2_count >= 3 else "medium" if stage2_count >= 1 else "low"

        final_score = min(100.0, round(base + mem_adj, 1))
        if final_score >= 85:    tier = "Critical"
        elif final_score >= 70:  tier = "High"
        elif final_score >= 31:  tier = "Medium"
        else:                    tier = "Low"

        scored.append({
            "supplier_id": sup["id"],
            "supplier_name": sup["name"],
            "zone": sup["zone"],
            "composite_score": final_score,
            "base_score": base,
            "memory_adjustment": mem_adj,
            "memory_source_event": mem_source,
            "memory_adjustment_disclosed": mem_adj > 0,
            "memory_confidence": memory_confidence,
            "risk_tier": tier,
            "is_critical": tier == "Critical",
            "buffer_stock_days": sup["buffer_stock_days"],
            "sites": sup["sites"],
            "reliability": sup["reliability"],
            "categories": sup["categories"],
            "proximity_score_raw": sup["proximity_score"],
            "in_event_zone": in_zone,
            "factors": {
                "proximity": proximity, "buffer_score": buffer_score,
                "site_score": site_score, "reliability_score": reliability_s,
                "category_score": category_s,
            },
        })
    scored.sort(key=lambda x: x["composite_score"], reverse=True)

    # Feature 5 — rich per-supplier explanation with event context
    explanations = []
    for s in scored:
        explanation = _build_risk_explanation(s, memory_context, event)
        explanations.append(explanation)

    # LLM narrative enrichment: run in parallel for all suppliers when severity >= 5
    if severity >= 5 and explanations:
        tasks = [_llm_enrich_risk_explanation(scored[i], event, explanations[i])
                 for i in range(len(explanations))]
        narratives = await asyncio.gather(*tasks, return_exceptions=True)
        for explanation, narrative in zip(explanations, narratives):
            explanation["llm_narrative"] = narrative if isinstance(narrative, str) else explanation["summary"]
    else:
        for explanation in explanations:
            explanation["llm_narrative"] = explanation["summary"]

    for s, explanation in zip(scored, explanations):
        s["change_explanation"] = explanation

    # Real-time NewsAPI pulse — fetch recent supplier-relevant news for top-3 scored
    # suppliers only (bounds quota). Returns empty list when NewsAPI is unconfigured.
    try:
        top_for_news = scored[:3]
        news_results = await asyncio.gather(
            *[fetch_supplier_news(s["supplier_name"], s.get("zone", ""), limit=2)
              for s in top_for_news],
            return_exceptions=True,
        )
        news_lookup = {}
        for s, news in zip(top_for_news, news_results):
            news_lookup[s["supplier_id"]] = news if isinstance(news, list) else []
        for s in scored:
            articles = news_lookup.get(s["supplier_id"], [])
            s["news_alerts"] = articles
            s["news_alert_count"] = len(articles)
    except Exception as exc:
        logger.warning("News pulse aggregation failed: %s", exc)
        for s in scored:
            s.setdefault("news_alerts", [])
            s.setdefault("news_alert_count", 0)

    # Section 2 Sprint — Financial Health enrichment (6th factor).
    # Reads the news_alerts that the pulse block just attached, so distress
    # detection benefits from the real-time news feed when NewsAPI is live;
    # falls back to sector + operational signals otherwise.
    for s in scored:
        health = financial_signals.compute_financial_health(
            supplier_name=s["supplier_name"],
            supplier_category=(s.get("categories") or ["Unknown"])[0] if s.get("categories") else "Unknown",
            reliability_pct=float(s.get("reliability", 80)),
            buffer_days=float(s.get("buffer_stock_days", 7)),
            news_alerts=s.get("news_alerts", []),
        )
        s["financial_health"] = health
        adjustment = int(health.get("risk_adjustment", 0))
        if adjustment > 0:
            new_score = min(100.0, round(s["composite_score"] + adjustment, 1))
            s["composite_score"] = new_score
            # Re-classify tier with the adjusted score so the dashboard's
            # critical/high counts include financial-distress upgrades.
            if new_score >= 85:
                s["risk_tier"] = "Critical"
                s["is_critical"] = True
            elif new_score >= 70:
                s["risk_tier"] = "High"
                s["is_critical"] = False
            elif new_score >= 31:
                s["risk_tier"] = "Medium"
                s["is_critical"] = False
        s["financial_adjustment_applied"] = adjustment

    # Re-sort after financial adjustments — a Critical-tier supplier might
    # have leap-frogged a higher-numbered base score.
    scored.sort(key=lambda x: x["composite_score"], reverse=True)

    # Azure AI Content Safety pass (BR-004 guardrail)
    summary_text = "; ".join(f"{s['supplier_name']} {s['composite_score']}" for s in scored[:5])
    safety = await llm.content_safety_check(summary_text)
    narrative_fallback = (
        f"{len(scored)} suppliers were scored for {geography}. "
        f"{sum(1 for s in scored if s['is_critical'])} are Critical based on proximity, buffer, site concentration, reliability, and memory adjustments."
    )
    narrative = await llm.chat_text(
        system=("You are the Risk Agent for DisruptIQ. Write a short risk summary using only the provided "
                "deterministic scoring context. Do not recalculate or invent numbers. Max 60 words."),
        user=json.dumps({
            "geography": geography,
            "critical_count": sum(1 for s in scored if s["is_critical"]),
            "top_suppliers": [
                {
                    "supplier_name": s["supplier_name"],
                    "composite_score": s["composite_score"],
                    "risk_tier": s["risk_tier"],
                    "memory_adjustment": s["memory_adjustment"],
                }
                for s in scored[:3]
            ],
        }),
        max_tokens=160,
        fallback=narrative_fallback,
    )

    output = {
        "suppliers": scored,
        "total_scored": len(scored),
        "critical_count": sum(1 for s in scored if s["is_critical"]),
        "narrative": narrative,
        "risk_change_explanations": explanations,
        "content_safety_passed": safety["safe"],
        "content_safety_demo_mode": safety.get("demo_mode", False),
        "model_run_timestamp_utc": _now_utc(),
    }
    storage.write_audit(event["event_id"], "RiskAgent", "scoring_complete",
                        f"zone={geography}", f"scored={len(scored)} crit={output['critical_count']}")
    return output


# ════════════════════════════════════════════════════════════════════════════
# DIVERGENCE SCORING (BR-005) — Orchestrator computes
# ════════════════════════════════════════════════════════════════════════════

def _compute_supplier_risk_score(supplier: dict, geography: str = "",
                                 severity: float = 5.0) -> float:
    """Standalone 5-factor risk score 0-100 for a single supplier.

    Mirrors the inline scoring logic inside risk_agent so it can be
    unit-tested and reused without an event/memory context. Weighted:
        proximity 30 · buffer 25 · sites 20 · reliability 15 · category 10.
    The category-exposure factor is approximated by severity here because
    no event_type/category mapping is available standalone.
    """
    proximity = float(supplier.get("proximity_score", 5)) * 10.0
    buffer_score = max(0.0, 100.0 - float(supplier.get("buffer_stock_days", 7)) * 5.0)
    sites = int(supplier.get("sites", 1))
    if sites == 1:
        site_score = 40.0
    elif sites == 2:
        site_score = 20.0
    else:
        site_score = 5.0
    reliability_s = max(0.0, 100.0 - float(supplier.get("reliability", 85)))
    # Standalone category exposure approximation: severity scaled to 0-100.
    category_s = max(0.0, min(100.0, float(severity) * 10.0))

    base = (proximity * 0.30 + buffer_score * 0.25 + site_score * 0.20 +
            reliability_s * 0.15 + category_s * 0.10)
    return round(max(0.0, min(100.0, base)), 1)


def compute_divergence(forecast_out: dict, risk_out: dict) -> dict:
    cats = forecast_out.get("affected_categories", [])
    max_shift = max((c.get("demand_shift_pct", 0) for c in cats), default=0)
    forecast_severity = min(100, max_shift * 2)  # normalise 50% shift = 100/100

    # Confidence signal — MSDS gates on high confidence so noisy low-confidence
    # forecasts don't trigger dissent. Treat "high" or numeric ≥ 70 as confident.
    raw_conf = max((c.get("confidence", 0) for c in cats), default=0)
    if isinstance(raw_conf, str):
        confidence_high = raw_conf.lower() in ("high", "very_high")
    else:
        confidence_high = float(raw_conf) >= 70

    suppliers = risk_out.get("suppliers", [])
    top3 = suppliers[:3]
    if top3:
        avg_risk = sum(s["composite_score"] for s in top3) / len(top3)
    else:
        # Fallback when no supplier list provided (e.g. unit tests, lightweight
        # callers). Derive a 0-100 risk signal from the tier counts so MSDS has
        # a comparable scale to forecast_severity.
        critical = float(risk_out.get("critical_count", 0))
        high = float(risk_out.get("high_count", 0))
        total = float(risk_out.get("total_scored", 0)) or 1.0
        avg_risk = round((critical + high) / total * 100.0, 1)

    # MSDS — Multi-Signal Dissent Score (algorithms.py). Threshold expressed
    # as a fraction (default 0.15 = 15 pts on a 100-pt scale).
    msds_threshold = config.DISSENT_DIVERGENCE_THRESHOLD / 100.0
    msds = multi_signal_dissent_score(
        forecast_signal=forecast_severity,
        risk_signal=avg_risk,
        max_signal=100.0,
        confidence_high=confidence_high,
        dissent_threshold=msds_threshold,
    )
    divergence = msds["divergence_pct"]  # 0-100 scale to keep downstream code stable
    dissent = msds["dissent_detected"]

    return {
        "divergence_score": round(divergence, 1),
        "forecast_severity_normalised": round(forecast_severity, 1),
        "avg_supplier_risk": round(avg_risk, 1),
        "dissent_detected": dissent,
        "divergence_type": "Demand vs Supplier Risk",
        "surface_timestamp_utc": _now_utc(),
        "forecast_position": {
            "demand_shift_pct": round(max_shift, 1),
            "confidence": max((c.get("confidence", 0) for c in cats), default=0),
        },
        "risk_position": {
            "composite_score": round(avg_risk, 1),
            "tier": top3[0]["risk_tier"] if top3 else "Low",
        },
        "threshold": config.DISSENT_DIVERGENCE_THRESHOLD,
        "algorithm": "MSDS",
        "confidence_high": confidence_high,
        "dissent_description": (
            (f"Forecast Agent predicts high demand impact ({max_shift:.1f}% shift, "
             f"severity index {forecast_severity:.1f}/100) while Risk Agent shows "
             f"moderate supplier exposure (avg {avg_risk:.1f}/100). "
             f"Divergence {divergence:.1f} pts > threshold {config.DISSENT_DIVERGENCE_THRESHOLD}.")
            if dissent else None
        ),
        "computed_at_utc": _now_utc(),
    }


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-005 — ACTION AGENT (BRD §4.5)
# Response Option Generator
# ════════════════════════════════════════════════════════════════════════════

async def action_agent(event: dict, forecast: dict, risk: dict) -> dict:
    safe_suppliers = [s for s in risk.get("suppliers", []) if not s["is_critical"]]
    best_alt = safe_suppliers[0] if safe_suppliers else None
    second_alt = safe_suppliers[1] if len(safe_suppliers) > 1 else None
    cats = forecast.get("affected_categories", [])
    top_cat = cats[0]["category"] if cats else "affected category"
    top_shift = cats[0]["demand_shift_pct"] if cats else 0
    second_zone = second_alt.get("zone") if second_alt else event.get("geography", "regional")

    # Build dataset-aware rationales using THIS client's actual supplier metadata.
    severity = event.get("severity_score", 5)
    geography = event.get("geography", "the affected zone")
    best_zone = best_alt.get("zone", "alternate region") if best_alt else "alternate region"
    best_buffer = best_alt.get("buffer_stock_days", 14) if best_alt else 14
    best_reliability = best_alt.get("reliability", 85) if best_alt else 85
    best_score = best_alt.get("composite_score", 50) if best_alt else 50
    second_buffer = second_alt.get("buffer_stock_days", 14) if second_alt else 14

    # Quantity scales with severity and demand shift, not a fixed magic number
    rank1_qty = int(300 + (top_shift if top_shift > 0 else 10) * 10 + severity * 20)
    rank2_qty = int(150 + severity * 15)

    # 3-line rationales: WHY (supplier fit) + HOW (mechanism) + RISK (caveat)
    rank1_why = (
        f"{best_alt['supplier_name']} ({best_zone}) is your strongest non-critical alternate with "
        f"{best_reliability}% reliability and {best_buffer}-day buffer stock (risk score {best_score}/100). "
    ) if best_alt else "No safe alternate supplier identified — falling back to next-best."
    rank1_how = (
        f"Re-route {top_cat} procurement to absorb the {'+' if top_shift >= 0 else ''}{top_shift:.1f}% demand shift. "
        f"At qty {rank1_qty} units this covers the projected gap with ~{round(6.0 + severity * 0.4, 1)}% cost premium. "
    )
    rank1_risk = (
        f"Watch for any secondary disruption at {best_zone}; activate rank-2 air-freight if onboarding slips past 24h."
    )

    rank2_why = (
        f"{second_alt['supplier_name']} ({second_zone}) holds a {second_buffer}-day buffer and is geographically "
        f"distinct from {geography} — minimal contagion exposure. "
    ) if second_alt else f"Use buffer warehouse stock — no second safe alternate available in your network. "
    rank2_how = (
        f"Air-freight {rank2_qty} units of {top_cat} for next 7–10 days while rank-1 onboards. "
        f"Cost premium ~{round(18.0 + severity * 1.2, 1)}% but fastest resolution path. "
    )
    rank2_risk = (
        f"Higher cost and capacity constraints — confirm cargo capacity before commitment."
    )

    rank3_why = (
        f"Defer non-critical {top_cat} POs by {14 if severity < 7 else 21} days. "
    )
    rank3_how = (
        f"This preserves the current ~{best_buffer}d buffer at your primary alternate while "
        f"{geography} {event.get('event_type','disruption').lower()} stabilises. "
    )
    rank3_risk = (
        f"Only safe for non-urgent customer commitments; check downstream SLAs before deferring."
    )

    fallback = {"options": [
        {"rank": 1,
         "action_type": (
             f"Re-route {top_cat} procurement to {best_alt['supplier_name']} ({best_zone})"
             if best_alt else "Re-route procurement to next-best supplier"
         ),
         "supplier_id": best_alt["supplier_id"] if best_alt else None,
         "supplier_name": best_alt["supplier_name"] if best_alt else None,
         "quantity": rank1_qty,
         "cost_delta_pct": round(6.0 + severity * 0.4, 1),
         "urgency_tier": "Urgent" if severity < 8 else "Immediate",
         "rationale": rank1_why + rank1_how + rank1_risk,
         "effectiveness_score": min(95, 75 + int(best_reliability / 10))},
        {"rank": 2,
         "action_type": (
             f"Emergency air-freight from {second_alt['supplier_name']} ({second_zone})"
             if second_alt else "Emergency air-freight from buffer warehouse"
         ),
         "supplier_id": second_alt["supplier_id"] if second_alt else None,
         "supplier_name": second_alt["supplier_name"] if second_alt else None,
         "quantity": rank2_qty,
         "cost_delta_pct": round(18.0 + severity * 1.2, 1),
         "urgency_tier": "Immediate",
         "rationale": rank2_why + rank2_how + rank2_risk,
         "effectiveness_score": 74},
        {"rank": 3, "action_type": f"Defer non-critical {top_cat} orders by {14 if severity < 7 else 21} days",
         "supplier_id": None, "supplier_name": None,
         "quantity": 0, "cost_delta_pct": 0.0, "urgency_tier": "Medium",
         "rationale": rank3_why + rank3_how + rank3_risk,
         "effectiveness_score": 55 + int(severity)},
    ]}

    # BR-005 hard rule: never recommend Critical-tier supplier as primary
    safe_supplier_list = "\n".join([
        f"  - {s['supplier_name']} (id={s['supplier_id']}, zone={s.get('zone','?')}, "
        f"score={s.get('composite_score','?')}, tier={s.get('risk_tier','?')})"
        for s in safe_suppliers[:10]
    ]) or "  (no safe suppliers available — recommend deferral only)"

    user_prompt = (f"Event: {event.get('description')}\n"
                   f"Geography: {event.get('geography')} Severity: {event.get('severity_score')}/10\n"
                   f"Top demand impact: {top_cat} +{top_shift:.1f}%\n"
                   f"Safe (non-Critical) suppliers FROM THIS CLIENT'S DATA ONLY:\n"
                   f"{safe_supplier_list}\n"
                   f"Generate 3 ranked response options. You MUST pick supplier_id/supplier_name "
                   f"ONLY from the list above. NEVER invent suppliers or use names like FastTrack, "
                   f"Apex, BridgeTech, or other demo placeholders.")

    parsed = await llm.chat_json(
        system=("You are the Action Agent for DisruptIQ. Generate exactly 3 ranked response options. "
                "Each rationale MUST be 3 sentences (60-100 words) covering: "
                "(1) WHY this supplier — cite their actual reliability%, buffer days, zone, risk score; "
                "(2) HOW it works — quantity, cost premium, what gap it covers; "
                "(3) RISK / WATCH-OUT — one caveat or trigger condition. "
                "Schema: {\"options\":[{\"rank\":int (1-3), \"action_type\":str, "
                "\"supplier_id\":str|null, \"supplier_name\":str|null, \"quantity\":int, "
                "\"cost_delta_pct\":float, \"urgency_tier\":\"Immediate\"|\"Urgent\"|\"Medium\", "
                "\"rationale\":str (60-100 words, 3 sentences), \"effectiveness_score\":int (1-100)}]}. "
                "NEVER recommend a Critical-tier supplier as primary. "
                "ALWAYS pick supplier names/IDs from the user's supplier list — never invent suppliers. "
                "Rank by effectiveness desc."),
        user=user_prompt, max_tokens=1200, fallback=fallback,
    )

    # Enforce: every option's supplier_id must be in the client's safe supplier set (or null)
    safe_ids = {s.get("supplier_id") for s in safe_suppliers}
    safe_names = {s.get("supplier_name") for s in safe_suppliers}
    for o in parsed.get("options", []):
        sid = o.get("supplier_id")
        sname = o.get("supplier_name")
        if sid and sid not in safe_ids:
            # LLM hallucinated a supplier — replace with the best available real one
            o["supplier_id"] = best_alt["supplier_id"] if best_alt else None
            o["supplier_name"] = best_alt["supplier_name"] if best_alt else None
        elif sname and sname not in safe_names and sid is None:
            o["supplier_name"] = best_alt["supplier_name"] if best_alt else None

    # Enforce hard guardrail post-LLM (BR-005)
    critical_ids = {s["supplier_id"] for s in risk.get("suppliers", []) if s["is_critical"]}
    for o in parsed.get("options", []):
        if o.get("supplier_id") in critical_ids:
            o["rejected_reason"] = "Critical-tier supplier blocked by guardrail"
        o["cost_delta_pct"] = compute_cost_delta(
            o.get("action_type", ""),
            o.get("urgency_tier", "Medium"),
            int(o.get("quantity") or 0),
        )
        o["effectiveness_score"] = _compute_effectiveness_score(
            o, event.get("severity_score", 5), risk
        )
        # Feature 7 — Recovery Time Objective per option
        o["time_impact"] = compute_rto(o, event.get("severity_score", 5))

    # Multi-LLM consensus voting — three persona agents independently rank the options.
    # Adds explainability: judges/users see WHY each option is recommended (cost vs risk vs speed).
    consensus = await _consensus_vote(event, forecast, parsed.get("options", []))
    for i, option in enumerate(parsed.get("options", [])):
        votes_for_this = sum(1 for v in consensus.values() if v == i)
        option["consensus"] = {
            "persona_votes": consensus,
            "votes_for_this_option": votes_for_this,
            "total_personas": len(consensus),
        }
    parsed["consensus_metadata"] = consensus

    storage.write_audit(event["event_id"], "ActionAgent", "options_generated",
                        f"top_cat={top_cat}", f"options={len(parsed.get('options', []))}")
    return parsed


async def _consensus_vote(event: dict, forecast: dict, options: list[dict]) -> dict[str, int]:
    """Three LLM personas independently rank the action options.

    Each persona returns the 0-indexed option it would pick. Used to surface
    explainability (cost vs risk vs speed) per option in the UI.

    Failure mode: when the LLM is unavailable, falls back to a deterministic
    scoring matrix derived from each option's cost_delta_pct, supplier risk,
    and urgency tier. The UI always shows three persona picks — real LLM
    votes when quota allows, deterministic otherwise.
    """
    if not options:
        return {}

    # Deterministic fallback first — used directly if LLM unavailable, or as
    # fallback per persona when one call fails.
    def _det_cost_pick() -> int:
        return min(range(len(options)), key=lambda i: options[i].get("cost_delta_pct", 0) or 0)

    def _det_risk_pick() -> int:
        return max(range(len(options)),
                   key=lambda i: options[i].get("effectiveness_score", 0)
                   - (options[i].get("cost_delta_pct", 0) or 0) * 0.5)

    def _det_speed_pick() -> int:
        urgency_rank = {"Immediate": 3, "Urgent": 2, "Medium": 1}
        return max(range(len(options)),
                   key=lambda i: urgency_rank.get(options[i].get("urgency_tier", "Medium"), 0))

    persona_specs = [
        ("cost_optimizer",
         "You are the Cost Optimizer persona. Your only goal is to minimize cost impact (%) "
         "while still being feasible.",
         _det_cost_pick),
        ("risk_minimizer",
         "You are the Risk Minimizer persona. Your only goal is to pick the safest option — "
         "highest effectiveness with the least exposure to supplier risk.",
         _det_risk_pick),
        ("speed_maximizer",
         "You are the Speed Maximizer persona. Your only goal is the fastest recovery, "
         "preferring Immediate-urgency options over slower ones.",
         _det_speed_pick),
    ]

    options_summary = "\n".join(
        f"{i+1}. {o.get('action_type','?')} (urgency={o.get('urgency_tier','?')}, "
        f"cost_delta_pct={o.get('cost_delta_pct',0)}, effectiveness={o.get('effectiveness_score',0)})"
        for i, o in enumerate(options[:3])
    )

    votes: dict[str, int] = {}
    for name, system, det in persona_specs:
        fallback_idx = det()
        fallback = {"choice": fallback_idx + 1}
        try:
            response = await llm.chat_json(
                system=system + " Reply ONLY with JSON: {\"choice\": <option number 1, 2, or 3>}.",
                user=(
                    f"Event: {event.get('event_type','?')} in {event.get('geography','?')}\n"
                    f"Severity: {event.get('severity_score','?')}/10\n"
                    f"Forecast demand shift: {(forecast.get('affected_categories') or [{}])[0].get('demand_shift_pct', 0)}%\n"
                    f"Candidate options:\n{options_summary}\n"
                    f"Pick the option number that best matches your persona's goal."
                ),
                max_tokens=80,
                fallback=fallback,
                temperature=0.2,
            )
            raw = response.get("choice", fallback_idx + 1)
            try:
                idx = max(0, min(len(options) - 1, int(raw) - 1))
            except (ValueError, TypeError):
                idx = fallback_idx
        except Exception as exc:
            logger.warning("Consensus persona %s failed: %s — using deterministic fallback", name, exc)
            idx = fallback_idx
        votes[name] = idx

    return votes


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-006 — VALIDATOR AGENT (BR-006)
# Output Consistency and Dissent Quality Gate
# ════════════════════════════════════════════════════════════════════════════

async def validator_agent(event: dict, forecast: dict, risk: dict,
                          action: dict, divergence: dict) -> dict:
    contradictions = []
    options = action.get("options", [])
    suppliers = risk.get("suppliers", [])
    critical_ids = {s["supplier_id"] for s in suppliers if s["is_critical"]}

    # Hard check 1: 3 options present
    if len(options) < 3:
        contradictions.append(f"Action Agent returned {len(options)} options — 3 required.")

    # Hard check 2: primary option not a Critical supplier
    if options:
        primary = options[0]
        if primary.get("supplier_id") in critical_ids:
            contradictions.append("Primary option recommends Critical-tier supplier — blocked by guardrail.")

    # Hard check 3: urgency proportionate to severity
    severity = event.get("severity_score", 5)
    immediate_count = sum(1 for o in options if o.get("urgency_tier") == "Immediate")
    if severity <= 6 and immediate_count >= 2:
        contradictions.append("Multiple Immediate-urgency options for moderate severity event.")

    # BR-006: dissent passed through, not suppressed
    dissent = divergence.get("dissent_detected", False)

    if contradictions:
        status = "Fail"
        passed = False
    elif dissent:
        status = "Pass with Dissent Noted"
        passed = True
    else:
        status = "Pass"
        passed = True

    result = {
        "status": status,
        "pass": passed,
        "contradictions": contradictions,
        "dissent_detected": dissent,
        "dissent_metadata": divergence if dissent else None,
        "validated_at_utc": _now_utc(),
    }
    storage.write_audit(event["event_id"], "ValidatorAgent", "validation",
                        f"options={len(options)}", f"status={status}")
    return result


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-007 — SIMULATION AGENT (BR-007)
# Monte Carlo Probabilistic Outcome Modeller
# ════════════════════════════════════════════════════════════════════════════

async def simulation_agent(event: dict, action: dict,
                            memory_context: list[dict]) -> dict:
    """Simulation Agent with 30-second SLA enforcement (BR-007)."""

    async def _run_simulation():
        options = action.get("options", [])
        memory_note = ""
        if memory_context:
            m = memory_context[0]
            memory_note = f"Historical reference: {m.get('actual_outcome', 'N/A')} from prior {m.get('event_type', 'event')}."

        fallback = {"simulations": [
            {"option_rank": 1, "scenarios": [
                {"name": "Optimistic", "probability": 70,
                 "outcome": "Alternate supplier delivers on schedule. Demand spike absorbed. No SLA breach.",
                 "delivery_timing": "On time", "cost_deviation_pct": 0.0,
                 "key_assumption": "Onboarding completes within 24 hours"},
                {"name": "Baseline", "probability": 20,
                 "outcome": "3-day delay on initial onboarding. Minor SLA impact on 12% of orders.",
                 "delivery_timing": "+3 days", "cost_deviation_pct": 2.5,
                 "key_assumption": "Standard onboarding lag"},
                {"name": "Pessimistic", "probability": 10,
                 "outcome": "Partial fulfillment — 60% week 1, remainder week 3.",
                 "delivery_timing": "Partial w1 + w3", "cost_deviation_pct": 8.0,
                 "key_assumption": "Capacity constraint at alternate supplier"},
            ]},
            {"option_rank": 2, "scenarios": [
                {"name": "Optimistic", "probability": 60,
                 "outcome": "Air-freight arrives 48 hours. Full quantity delivered. Premium absorbed.",
                 "delivery_timing": "+2 days", "cost_deviation_pct": 0.0,
                 "key_assumption": "Cargo capacity available"},
                {"name": "Baseline", "probability": 30,
                 "outcome": "Minor logistics delay — 4-day delivery, 95% on first shipment.",
                 "delivery_timing": "+4 days", "cost_deviation_pct": 3.0,
                 "key_assumption": "Standard freight handling"},
                {"name": "Pessimistic", "probability": 10,
                 "outcome": "Flight cancellation forces 9-day ground transport at additional cost.",
                 "delivery_timing": "+9 days", "cost_deviation_pct": 14.0,
                 "key_assumption": "Weather or capacity disruption"},
            ]},
            {"option_rank": 3, "scenarios": [
                {"name": "Optimistic", "probability": 55,
                 "outcome": "Deferral accepted by all customers. Disruption resolves in 10 days.",
                 "delivery_timing": "+10 days", "cost_deviation_pct": 0.0,
                 "key_assumption": "Customer flexibility"},
                {"name": "Baseline", "probability": 35,
                 "outcome": "2 of 8 customers escalate. Penalty clauses triggered on 2 contracts.",
                 "delivery_timing": "+14 days", "cost_deviation_pct": 4.0,
                 "key_assumption": "Partial customer acceptance"},
                {"name": "Pessimistic", "probability": 10,
                 "outcome": "Disruption extends 30+ days — emergency air-freight needed anyway.",
                 "delivery_timing": "+30 days", "cost_deviation_pct": 25.0,
                 "key_assumption": "Extended disruption window"},
            ]},
        ]}

        options_text = "\n".join(
            f"Option {o.get('rank',i+1)}: {o.get('action_type','')} (cost {o.get('cost_delta_pct',0)}%)"
            for i, o in enumerate(options[:3])
        )

        parsed = await llm.chat_json(
            system=("You are the Simulation Agent for DisruptIQ. For each action option, generate "
                    "exactly 3 scenarios (Optimistic, Baseline, Pessimistic). "
                    "Do not generate numeric probabilities. They are computed separately. "
                    "Schema: {\"simulations\":[{\"option_rank\":int, \"scenarios\":["
                    "{\"name\":\"Optimistic\"|\"Baseline\"|\"Pessimistic\","
                    "\"outcome\":str (<40 words),\"delivery_timing\":str,\"cost_deviation_pct\":float,"
                    "\"key_assumption\":str}]}]}"),
            user=f"Event severity: {event.get('severity_score')}/10. {memory_note}\nOptions:\n{options_text}",
            max_tokens=900, fallback=fallback,
        )

        # Validate probabilities sum to 100 (BR-007 guardrail)
        probability_map_by_rank = {
            o.get("rank"): compute_scenario_probabilities(
                int(o.get("effectiveness_score") or 50),
                int(event.get("severity_score", 5)),
            )
            for o in options
        }
        for sim in parsed.get("simulations", []):
            probabilities = probability_map_by_rank.get(sim.get("option_rank"), {})
            for scenario in sim.get("scenarios", []):
                scenario["probability"] = probabilities.get(
                    scenario.get("name"), scenario.get("probability", 0)
                )
            total = sum(s.get("probability", 0) for s in sim.get("scenarios", []))
            sim["probability_sum"] = total
            sim["probability_valid"] = abs(total - 100) <= 1

        parsed["simulation_run_timestamp_utc"] = _now_utc()
        storage.write_audit(event["event_id"], "SimulationAgent", "monte_carlo_complete",
                            f"options={len(options)}",
                            f"simulations={len(parsed.get('simulations', []))}")
        return parsed

    # Enforce 30-second SLA timeout (BR-007)
    sla_seconds = config.SIMULATION_SLA_SECONDS
    try:
        return await asyncio.wait_for(_run_simulation(), timeout=sla_seconds)
    except asyncio.TimeoutError:
        # SLA exceeded — return partial results with flag
        print(f"⚠️  Simulation SLA exceeded ({sla_seconds}s). Returning baseline scenarios.")
        storage.write_audit(event["event_id"], "SimulationAgent", "sla_exceeded",
                            f"timeout={sla_seconds}s", "Returned baseline scenarios only")
        return {
            "sla_exceeded": True,
            "sla_seconds": sla_seconds,
            "message": "Simulation exceeded SLA. Baseline scenarios returned.",
            "simulations": [
                {
                    "option_rank": i+1,
                    "scenarios": [
                        {
                            "name": "Baseline",
                            "probability": 100,
                            "outcome": "Standard delivery outcome based on historical average.",
                            "delivery_timing": "On schedule",
                            "cost_deviation_pct": 0,
                            "key_assumption": "No further disruptions"
                        }
                    ],
                    "probability_sum": 100,
                    "probability_valid": True
                }
                for i in range(min(3, len(action.get("options", []))))
            ],
            "sla_breach_requires_ack": True,
            "simulation_run_timestamp_utc": _now_utc(),
        }


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-008 — CASCADE DETECTION AGENT (BR-009)
# Multi-Event Compound Risk Analyst
# ════════════════════════════════════════════════════════════════════════════

async def cascade_detection_agent(primary: dict, secondary: dict, suppliers: list = None) -> dict:
    """Cascade Detection Agent with zone overlap revalidation (BR-009, Bug fix #3)."""
    s1 = primary.get("severity_score", 5)
    s2 = secondary.get("severity_score", 5)
    g1 = primary.get("geography", "")
    g2 = secondary.get("geography", "")

    # Bug fix: Revalidate geographic overlap before proceeding
    primary_zones = set(CASCADE_ZONE_MAP.get(g1, [g1]))
    secondary_zones = set(CASCADE_ZONE_MAP.get(g2, [g2]))
    overlap = primary_zones & secondary_zones

    if not overlap:
        result = {
            "status": "no_overlap",
            "cascade_detected": False,
            "message": f"Geographic zones {g1} and {g2} do not overlap. Cascade condition not met.",
            "combined_severity_score": 0,
            "primary_event_id": primary.get("event_id"),
            "secondary_event_id": secondary.get("event_id"),
            "computed_at_utc": _now_utc(),
        }
        storage.write_audit(primary["event_id"], "CascadeDetectionAgent", "no_overlap_detected",
                            f"zones={g1},{g2}", "No geographic overlap found")
        return result

    # Revalidation passed — continue with scoring
    overlap_zone = list(overlap)[0]

    # Identify shared suppliers FROM THE CLIENT'S OWN SUPPLIER LIST (not global demo data)
    overlap_zones = overlap
    client_suppliers = suppliers or []
    shared_suppliers = [s.get("name") for s in client_suppliers if s.get("zone") in overlap_zones]

    # CCS — Compound Cascade Severity (algorithms.py). Replaces the prior
    # simple average so severity escalates with the supplier-overlap ratio.
    total_at_risk = max(1, len(client_suppliers))
    ccs = compound_cascade_severity(
        severity_a=s1,
        severity_b=s2,
        shared_suppliers=len(shared_suppliers),
        total_at_risk=total_at_risk,
        cascade_multiplier=config.CASCADE_OVERLAP_MULTIPLIER,
    )
    combined = ccs["combined_severity"]
    shared_zone_factor = ccs["shared_zone_factor"]
    shared_categories = sorted({
        cat for s in client_suppliers if s.get("zone") in overlap_zones
        for cat in (s.get("categories", []) or [])
    })

    # Build a dataset-specific summary
    if shared_suppliers:
        sample_names = ", ".join(shared_suppliers[:3])
        suppliers_phrase = f"{len(shared_suppliers)} of your suppliers ({sample_names}{'...' if len(shared_suppliers) > 3 else ''})"
    else:
        suppliers_phrase = "no overlapping suppliers in your network"

    cats_phrase = f" affecting {', '.join(shared_categories[:3])}" if shared_categories else ""

    fallback = {
        "cascade_type": "Infrastructure Compound",
        "overlap_zone": " / ".join(sorted(overlap_zones)) if overlap_zones else f"{g1}/{g2}",
        "shared_suppliers": shared_suppliers[:5],
        "summary": (
            f"{g1} disruption (sev {s1}/10) compounded by {g2} secondary event "
            f"(sev {s2}/10) creates {' / '.join(sorted(overlap_zones))} compound risk. "
            f"This impacts {suppliers_phrase}{cats_phrase}. "
            f"Combined severity {combined}/10 exceeds individual thresholds."
        ),
    }

    parsed = await llm.chat_json(
        system=("You are the Cascade Detection Agent for DisruptIQ. Classify compound risk. "
                "ALWAYS reference the user's actual suppliers (provided in the prompt) — never invent names. "
                "Make the summary DATASET-SPECIFIC, mentioning the actual supplier categories and zones affected. "
                "Schema: {\"cascade_type\":\"Infrastructure Compound\"|\"Geographic Concentration\""
                "|\"Supplier Network Cascade\"|\"Demand Shock Compound\","
                "\"overlap_zone\":str,\"shared_suppliers\":[str],\"summary\":str (<60 words)}"),
        user=(f"Primary: {primary.get('description')} in {g1} (sev {s1}/10)\n"
              f"Secondary: {secondary.get('description')} in {g2} (sev {s2}/10)\n"
              f"Time gap: {abs(time.time() - secondary.get('timestamp_unix', time.time()))/3600:.1f}h\n"
              f"Client suppliers in overlap zones: {', '.join(shared_suppliers[:8]) if shared_suppliers else '(none)'}\n"
              f"Affected categories from client's data: {', '.join(shared_categories[:5]) if shared_categories else '(none)'}\n"
              "DO NOT mention 'GlobalParts', 'Apex', 'BridgeTech', 'FastTrack' or any supplier not in the list above."),
        max_tokens=400, fallback=fallback,
    )

    result = {
        "primary_event_id": primary.get("event_id"),
        "secondary_event_id": secondary.get("event_id"),
        "individual_scores": [s1, s2],
        "overlap_multiplier": config.CASCADE_OVERLAP_MULTIPLIER,
        "combined_severity_score": combined,
        "combined_severity": combined,
        "shared_zone_factor": shared_zone_factor,
        "algorithm": "CCS",
        "cascade_type": parsed.get("cascade_type", "Infrastructure Compound"),
        "overlap_zone": parsed.get("overlap_zone", f"{g1}/{g2}"),
        "shared_suppliers": parsed.get("shared_suppliers", shared_suppliers[:5]),
        "summary": parsed.get("summary", ""),
        "computed_at_utc": _now_utc(),
    }
    storage.write_audit(primary["event_id"], "CascadeDetectionAgent", "classified",
                        f"events={primary['event_id']}+{secondary.get('event_id')}",
                        f"combined={combined} type={result['cascade_type']}")
    return result


# ════════════════════════════════════════════════════════════════════════════
# AG-DQ-009 — COUNTERFACTUAL AGENT (BR-010)
# Post-Event Outcome Auditor
# ════════════════════════════════════════════════════════════════════════════

async def counterfactual_agent(event_id: str, swarm_output: dict,
                                actual_outcome: str) -> dict:
    options = swarm_output.get("action", {}).get("options", [])
    selected_rank = swarm_output.get("hil_decision", {}).get("selected_option_rank", 1)

    selected_opt = next((o for o in options if o.get("rank") == selected_rank), options[0] if options else {})
    alternates = [o for o in options if o.get("rank") != selected_rank]

    fallback = {
        "prediction_variance": (f"Selected option '{selected_opt.get('action_type','N/A')}' actual outcome: "
                                f"{actual_outcome}. Variance from prediction noted for model recalibration."),
        "alternate_option_a_estimate": (f"Option {alternates[0].get('rank') if alternates else '?'} "
                                         "estimate: would likely have produced comparable timing with different cost profile."),
        "alternate_option_b_estimate": (f"Option {alternates[1].get('rank') if len(alternates)>1 else '?'} "
                                         "estimate: deferral path would have created customer SLA pressure."),
        "learning_signal": (f"Risk Agent score adjustment recommended for affected supplier and "
                            f"geography based on actual delivery variance."),
        "recalibration_recommended": True,
    }

    parsed = await llm.chat_json(
        system=("You are the Counterfactual Agent for DisruptIQ. Compare prediction vs actual vs alternates. "
                "Schema: {\"prediction_variance\":str,\"alternate_option_a_estimate\":str,"
                "\"alternate_option_b_estimate\":str,\"learning_signal\":str,"
                "\"recalibration_recommended\":bool}"),
        user=(f"Event ID: {event_id}\nSelected option: {selected_opt.get('action_type','N/A')}\n"
              f"Actual outcome: {actual_outcome}\n"
              f"Alternate options: {[o.get('action_type') for o in alternates]}"),
        max_tokens=500, fallback=fallback,
    )

    record = {
        "counterfactual_id": f"CF-{str(uuid.uuid4())[:8].upper()}",
        "event_id": event_id,
        "actual_outcome": actual_outcome,
        "recommended_option": selected_opt.get("action_type"),
        "selected_option_rank": selected_rank,
        "selected_option_type": selected_opt.get("action_type"),
        "selected_supplier_id": selected_opt.get("supplier_id"),
        "prediction_variance": parsed.get("prediction_variance"),
        "alternate_option_a_estimate": parsed.get("alternate_option_a_estimate"),
        "alternate_option_b_estimate": parsed.get("alternate_option_b_estimate"),
        "learning_signal": parsed.get("learning_signal"),
        "learning_signal_flag": bool(parsed.get("learning_signal")),
        "recalibration_recommended": parsed.get("recalibration_recommended", True),
        "timestamp_utc": _now_utc(),
    }
    storage.store_counterfactual(record)
    storage.write_audit(event_id, "CounterfactualAgent", "audit_complete",
                        actual_outcome[:80],
                        (parsed.get("learning_signal") or "")[:80])
    return record


# ════════════════════════════════════════════════════════════════════════════
# NL INTERROGATION ROUTER (BR-011)
# Orchestrator routes question to relevant agent context, GPT-4o answers.
# ════════════════════════════════════════════════════════════════════════════

def _route_nl_question(question: str) -> str:
    q = question.lower()
    # Platform navigation questions (check FIRST, before supplier/risk keywords)
    if any(w in q for w in ["how to", "how do", "how can", "where", "navigate", "find", "add supplier", "delete supplier", "edit supplier", "upload", "export", "trigger", "report disruption", "view report"]):
        return "Orchestrator"
    # Risk analysis questions
    if any(w in q for w in ["risk", "score", "critical", "tier", "buffer", "high risk", "why is", "dangerous", "vulnerable"]):
        return "RiskAgent"
    if any(w in q for w in ["demand", "forecast", "shift", "category", "spike"]):
        return "ForecastAgent"
    if any(w in q for w in ["simulate", "scenario", "probability", "chance", "monte", "outcome"]):
        return "SimulationAgent"
    if any(w in q for w in ["cascade", "compound", "both events", "combined", "overlap"]):
        return "CascadeDetectionAgent"
    if any(w in q for w in ["action", "option", "recommend", "alternate", "switch"]):
        return "ActionAgent"
    if any(w in q for w in ["dissent", "diverge", "disagree", "conflict"]):
        return "Orchestrator"
    if any(w in q for w in ["memory", "past", "prior", "history", "before"]):
        return "SwarmMemory"
    return "Orchestrator"


# Friendly names shown to end-users instead of internal agent identifiers
AGENT_FRIENDLY_NAMES = {
    "RiskAgent": "Risk Analysis",
    "ForecastAgent": "Demand Forecast",
    "SimulationAgent": "Scenario Testing",
    "CascadeDetectionAgent": "Chain Reaction Analysis",
    "ActionAgent": "Action Planning",
    "Orchestrator": "Analysis Team",
    "SwarmMemory": "Past Experience",
}


def _demo_nl_answer(target: str, context: dict, question: str) -> str:
    """Build a specific, grounded answer from stored agent output for use
    when the live AI model is unavailable. Keeps demo mode genuinely useful
    instead of showing a placeholder."""
    try:
        if target == "RiskAgent":
            suppliers = context.get("suppliers") or []
            if not suppliers:
                return "Supplier risk scores haven't been calculated for this disruption yet."
            ranked = sorted(suppliers, key=lambda s: s.get("composite_score", 0), reverse=True)
            top = ranked[0]
            critical = [s for s in suppliers if s.get("risk_tier") == "Critical"]
            parts = [
                f"{top.get('supplier_name', 'The top supplier')} carries the highest risk "
                f"at {top.get('composite_score', 'N/A')}/100 ({top.get('risk_tier', 'unrated')} tier)."
            ]
            buffer = top.get("buffer_stock_days")
            if buffer is not None:
                parts.append(f"It holds {buffer} days of buffer stock"
                             + (" — a thin safety margin." if buffer <= 3 else "."))
            if critical:
                parts.append(f"{len(critical)} supplier(s) are rated Critical and should be addressed first.")
            return " ".join(parts)

        if target == "ForecastAgent":
            cats = context.get("affected_categories") or []
            if not cats:
                return "No demand impact has been forecast for this disruption yet."
            worst = max(cats, key=lambda c: abs(c.get("demand_shift_pct", 0)))
            parts = [
                f"Demand for {worst.get('category', 'the affected category')} is expected to shift "
                f"{worst.get('demand_shift_pct', 0):+.1f}%."
            ]
            if worst.get("low_confidence"):
                parts.append("Confidence is low, so treat this as a rough estimate.")
            if len(cats) > 1:
                parts.append(f"{len(cats)} product categories are affected in total.")
            return " ".join(parts)

        if target == "SimulationAgent":
            sims = context.get("simulations") or []
            if not sims:
                return "Scenario testing hasn't run for this disruption yet."
            scenarios = (sims[0].get("scenarios") or [])
            if scenarios:
                best = max(scenarios, key=lambda s: s.get("probability", 0))
                return (f"For the top option, the most likely outcome is "
                        f"\"{best.get('name', 'Expected')}\" at {best.get('probability', 0)}% probability: "
                        f"{best.get('outcome', 'see scenario details above')}.")
            return "Scenario testing has run — open the Recommended Actions panel for outcome details."

        if target == "CascadeDetectionAgent":
            if not context:
                return "Good news — no chain reaction was detected for this disruption."
            parts = [f"A chain reaction was detected: {context.get('summary', 'multiple linked disruptions')}."]
            if context.get("combined_severity_score") is not None:
                parts.append(f"Combined risk level is {context['combined_severity_score']}/10.")
            shared = context.get("shared_suppliers") or []
            if shared:
                parts.append(f"{len(shared)} supplier(s) are exposed to both events.")
            return " ".join(parts)

        if target == "ActionAgent":
            options = context.get("options") or []
            if not options:
                return "No recovery options have been generated for this disruption yet."
            top = sorted(options, key=lambda o: o.get("rank", 99))[0]
            parts = [
                f"The top recommendation is \"{top.get('action_type', 'a recovery action')}\" "
                f"with an effectiveness score of {top.get('effectiveness_score', 'N/A')}%."
            ]
            if top.get("cost_delta_pct"):
                parts.append(f"Estimated cost impact: +{top['cost_delta_pct']}%.")
            parts.append(f"{len(options)} ranked options are available for you to compare.")
            return " ".join(parts)

        if target == "SwarmMemory":
            recalls = context.get("recalls") or []
            if not recalls:
                return "We have no past experiences on record that closely match this disruption."
            parts = [f"We found {len(recalls)} similar past disruption(s) to learn from."]
            if recalls[0].get("actual_outcome"):
                parts.append(f"Most recent outcome: {recalls[0]['actual_outcome']}")
            return " ".join(parts)

        # Orchestrator / default
        monitor = context.get("monitor") or {}
        divergence = context.get("divergence") or {}
        parts = []
        if monitor:
            parts.append(
                f"This is a {monitor.get('event_type', 'disruption')} in "
                f"{monitor.get('geography', 'the affected region')}, "
                f"rated {monitor.get('severity_score', 'N/A')}/10 for risk."
            )
        if divergence.get("dissent_detected"):
            parts.append(
                f"Our experts disagree on this one (disagreement level "
                f"{divergence.get('divergence_score', 'N/A')}) — review the options carefully."
            )
        elif divergence:
            parts.append("Our experts are aligned on the recommendation.")
        return " ".join(parts) or "The analysis team has reviewed this disruption — open the panels above for details."
    except Exception:
        return "Here's what we found from the analysis so far. Open the panels above for the full breakdown."


def _build_comprehensive_nl_context(swarm_outputs: dict) -> str:
    """Build a rich, conversational context narrative for the LLM to answer questions."""
    parts = []

    # Event context: what happened
    monitor = swarm_outputs.get("monitor", {})
    if monitor:
        evt_type = monitor.get("event_type", "disruption").title()
        geo = monitor.get("geography", "the supply chain")
        sev = monitor.get("severity_score", "unknown")
        desc = monitor.get("description", "")
        parts.append(f"**EVENT OVERVIEW**: {evt_type} in {geo}, severity {sev}/10.")
        if desc:
            parts.append(f"Description: {desc}")

    # Suppliers affected
    risk_output = swarm_outputs.get("risk", {})
    suppliers = risk_output.get("suppliers", [])
    if suppliers:
        critical_count = len([s for s in suppliers if s.get("risk_tier") == "Critical"])
        high_count = len([s for s in suppliers if s.get("risk_tier") == "High"])
        parts.append(f"**SUPPLIER IMPACT**: {len(suppliers)} suppliers analyzed. {critical_count} Critical, {high_count} High risk.")
        top_3 = sorted(suppliers, key=lambda s: s.get("composite_score", 0), reverse=True)[:3]
        for i, s in enumerate(top_3, 1):
            name = s.get("supplier_name", "Unknown")
            score = s.get("composite_score", 0)
            tier = s.get("risk_tier", "Unrated")
            buf = s.get("buffer_stock_days", "N/A")
            parts.append(f"  {i}. {name}: {score}/100 ({tier}), buffer {buf} days")

    # Demand forecast
    forecast = swarm_outputs.get("forecast", {})
    if forecast:
        cats = forecast.get("affected_categories", [])
        if cats:
            parts.append(f"**DEMAND IMPACT**: {len(cats)} product categories affected.")
            for cat in cats[:3]:
                name = cat.get("category", "Unknown")
                shift = cat.get("demand_shift_pct", 0)
                conf = "high" if not cat.get("low_confidence") else "low"
                parts.append(f"  • {name}: {shift:+.1f}% shift ({conf} confidence)")

    # Recommended actions
    action = swarm_outputs.get("action", {})
    if action:
        options = action.get("options", [])
        if options:
            parts.append(f"**RECOVERY OPTIONS**: {len(options)} ranked alternatives generated.")
            for i, opt in enumerate(options[:3], 1):
                atype = opt.get("action_type", "Unknown action")
                eff = opt.get("effectiveness_score", "N/A")
                rto = opt.get("rto_tag", "unknown")
                parts.append(f"  {i}. {atype} (effectiveness {eff}%, RTO {rto})")

    # Cascade risk
    cascade = swarm_outputs.get("cascade_alert", {})
    if cascade and cascade.get("cascade_detected"):
        parts.append(f"**CHAIN REACTION ALERT**: {cascade.get('summary', 'Multiple linked disruptions detected')}.")
        shared = cascade.get("shared_suppliers", [])
        if shared:
            parts.append(f"  {len(shared)} suppliers exposed to both events.")

    # Memory recalls
    recalls = swarm_outputs.get("memory_recalls", [])
    if recalls:
        parts.append(f"**PAST EXPERIENCE**: {len(recalls)} similar disruption(s) found in history.")
        recent = recalls[0] if recalls else {}
        if recent.get("actual_outcome"):
            parts.append(f"  Most recent: {recent.get('actual_outcome')}")

    # Dissent / validator output
    divergence = swarm_outputs.get("divergence", {})
    if divergence:
        if divergence.get("dissent_detected"):
            score = divergence.get("divergence_score", "unknown")
            parts.append(f"**EXPERT DISAGREEMENT**: Divergence score {score} — our analysts have differing views.")
        else:
            parts.append(f"**EXPERT CONSENSUS**: Our team is aligned on this analysis.")

    return "\n".join(parts)


def _interpret_supplier_risk_from_raw(supplier: dict, evt_type: str, geo: str, sev: float) -> list[str]:
    """Compute human-readable factor explanations directly from raw supplier fields.

    Called when the precomputed factor_details dict is absent or empty,
    which happens frequently in demo/fallback mode.
    """
    explanations = []
    buf = supplier.get("buffer_stock_days", 0)
    reliability = supplier.get("reliability", 0)
    sites = supplier.get("sites", 1)
    prox = supplier.get("proximity_score", 5)
    categories = [c.lower() for c in supplier.get("categories", [])]
    score = supplier.get("composite_score", 0)
    tier = supplier.get("risk_tier", "Medium")

    # Geographic proximity factor (30% weight)
    if prox >= 8:
        explanations.append(
            f"Geographic proximity is HIGH risk (score {prox}/10). This supplier is close to or within the "
            f"{evt_type} impact zone in {geo}. Physical operations may be directly disrupted — "
            f"roads, port access, and workforce availability are all affected."
        )
    elif prox >= 5:
        explanations.append(
            f"Geographic proximity is MODERATE risk (score {prox}/10). This supplier is in the "
            f"broader region affected by the {evt_type}. Indirect effects like logistics delays "
            f"and workforce disruptions are likely."
        )
    else:
        explanations.append(
            f"Geographic proximity is LOW risk (score {prox}/10). This supplier operates "
            f"far from the {evt_type} epicenter, so direct physical disruption is unlikely."
        )

    # Buffer stock factor (25% weight)
    if buf == 0:
        explanations.append(
            "Buffer stock is CRITICAL — zero days on hand. Any supply interruption immediately "
            "halts your production. This is the single most dangerous vulnerability for this supplier."
        )
    elif buf <= 3:
        explanations.append(
            f"Buffer stock is dangerously LOW at only {buf} days. That means if supply stops today, "
            f"you run out in {buf} day{'s' if buf != 1 else ''}. In a severity {sev}/10 event, "
            f"disruptions typically last 5-14 days — far beyond this safety margin."
        )
    elif buf <= 7:
        explanations.append(
            f"Buffer stock of {buf} days is below the recommended 10-day threshold. While not immediately "
            f"critical, this gives you less than a week to secure alternatives before operations are impacted."
        )
    else:
        explanations.append(
            f"Buffer stock of {buf} days is adequate, providing a reasonable window to respond. "
            f"However, extended disruptions beyond {buf} days would still create supply gaps."
        )

    # Site diversity factor (20% weight)
    if sites == 1:
        explanations.append(
            "Single manufacturing site is a major concentration risk. There is no backup production "
            "facility — if this location is disrupted, you lose 100% of this supplier's capacity "
            "with no internal failover possible."
        )
    elif sites == 2:
        explanations.append(
            f"Two manufacturing sites provide limited redundancy. Some capacity can shift if one site "
            f"is disrupted, but load distribution means neither site alone can cover 100% of demand."
        )
    else:
        explanations.append(
            f"{sites} manufacturing sites provide good geographic redundancy. Even if one facility "
            f"is disrupted, production can be redistributed across remaining locations."
        )

    # Reliability factor (15% weight)
    if reliability < 70:
        explanations.append(
            f"Reliability at {reliability}% is below the acceptable threshold of 70%. This supplier "
            f"already fails to deliver on-time 1 in 3 orders under normal conditions. During a "
            f"{evt_type}, this unreliability will worsen significantly."
        )
    elif reliability < 85:
        explanations.append(
            f"Reliability at {reliability}% is moderate. Under normal operations this is acceptable, "
            f"but disruption events strain logistics and workforce, typically dropping delivery "
            f"performance by 15-25 percentage points."
        )
    else:
        explanations.append(
            f"Reliability at {reliability}% is strong. This supplier has a good track record of "
            f"delivering on time, which helps manage disruption scenarios — but reliability alone "
            f"cannot compensate for supply shortages during physical disruptions."
        )

    # Category exposure factor (10% weight)
    evt_lower = evt_type.lower()
    high_exposure_combos = [
        (["logistics", "freight", "shipping", "transport"], ["port closure", "cyclone", "flood", "strike"]),
        (["food", "beverage", "agriculture", "cold-chain", "refrigeration"], ["flood", "cyclone", "drought"]),
        (["oil", "fuel", "energy", "chemical"], ["port closure", "strike", "political"]),
        (["raw material", "mining", "steel", "metal"], ["earthquake", "flood", "cyclone"]),
    ]
    category_exposed = False
    for cat_keywords, event_keywords in high_exposure_combos:
        if any(c in " ".join(categories) for c in cat_keywords):
            if any(e in evt_lower for e in event_keywords):
                category_exposed = True
                break

    if category_exposed:
        explanations.append(
            f"Category exposure is HIGH — {', '.join(supplier.get('categories', [])[:2])} supplies "
            f"are directly vulnerable to {evt_type} events. This type of disruption specifically "
            f"targets your supplier's industry, amplifying the overall risk score."
        )
    else:
        explanations.append(
            f"Category exposure ({', '.join(supplier.get('categories', [])[:2]) if supplier.get('categories') else 'general supplies'}) "
            f"has moderate correlation with {evt_type} disruptions. Indirect effects through "
            f"logistics and market pricing are the primary concerns."
        )

    return explanations


def _smart_fallback_nl_answer(question: str, context_narrative: str, target: str, swarm_outputs: dict) -> str:
    """Generate comprehensive, conversational answers from event data.

    This function functions as a full AI assistant replacement when the LLM
    is unavailable. It reads raw event data, computes interpretations, and
    returns detailed explanations that sound like ChatGPT — no 'check the
    panel' redirects, no vague summaries.
    """
    try:
        q_lower = question.lower()
        monitor = swarm_outputs.get("monitor", {})
        risk_data = swarm_outputs.get("risk", {})
        forecast_data = swarm_outputs.get("forecast", {})
        action_data = swarm_outputs.get("action", {})
        cascade_data = swarm_outputs.get("cascade_alert", {})
        suppliers = risk_data.get("suppliers", [])

        # Extract event context for narrative
        evt_type = monitor.get("event_type", "disruption").title()
        geo = monitor.get("geography", "the region")
        sev = monitor.get("severity_score", 0)
        q_stripped = q_lower.strip().rstrip("?!.")
        word_count = len(q_stripped.split())

        # Navigation intent — used to disambiguate "how do I…" / "where is…"
        # questions from event-analysis questions that share a keyword.
        has_nav_intent = any(w in q_lower for w in [
            "how to", "how do", "how can", "how would", "where", "open", "view", "show me",
            "go to", "navigate", "find the", "find my", "which page", "which section",
            "access", "download", "check the", "see the", "look at", "get to", "can i see",
        ])

        # ── GREETINGS & SMALL TALK ─────────────────────────────────────────
        if q_stripped in ("hi", "hello", "hey", "yo", "hiya", "hi there", "hello there", "good morning",
                           "good afternoon", "good evening", "sup", "howdy"):
            sup_line = (f"You have {len(suppliers)} supplier(s) in this analysis. " if suppliers
                        else "")
            return (
                "Hi! I'm your DisruptIQ supply-chain assistant. "
                f"{sup_line}I can explain this disruption, tell you which suppliers are at risk and why, "
                "walk you through recovery options step by step, forecast demand impact, and guide you "
                "around the platform — adding suppliers, reports, weather, maps and more.\n\n"
                "What would you like to know? For example: \"What should I do first?\", "
                "\"Which suppliers are most affected?\", or \"How do I add a supplier?\""
            )

        # ── THANKS ─────────────────────────────────────────────────────────
        if any(w in q_lower for w in ["thank", "appreciate", "great help", "well done", "perfect", "awesome"]) and word_count <= 6:
            return (
                "You're welcome! I'm here whenever you want to dig deeper — supplier risks, recovery "
                "options, demand impact, or anything about using the platform. Just ask."
            )

        # ── DISSATISFACTION / VAGUE FEEDBACK ───────────────────────────────
        if any(w in q_lower for w in [
            "not satisfied", "not helpful", "useless", "that's wrong", "thats wrong", "doesn't help",
            "does not help", "bad answer", "not good", "unclear", "confusing", "didn't help",
            "didnt help", "wrong answer", "not what i", "makes no sense", "gibberish", "irrelevant",
            "this is bad", "terrible", "not working", "rubbish",
        ]):
            top_sup = suppliers[0].get("supplier_name") if suppliers else None
            sup_hint = (f"\"Why is {top_sup} at risk?\"" if top_sup
                        else "\"Why is my top supplier at risk?\"")
            return (
                "I'm sorry that wasn't helpful — let me do better. I give the best answers to specific "
                "questions. Try one of these and I'll go deep with real numbers from your data:\n\n"
                f"  • {sup_hint} — a full factor-by-factor risk breakdown\n"
                "  • \"What exactly should I do in the next 24 hours?\" — a step-by-step action plan\n"
                "  • \"How bad is the demand impact?\" — the forecast explained per category\n"
                "  • \"Which recovery option is best and why?\" — ranked options compared\n"
                "  • \"How do I add a supplier / view reports / check the weather?\" — platform guidance\n\n"
                "Which area matters most right now? Tell me and I'll focus there."
            )

        # ── WEATHER ────────────────────────────────────────────────────────
        if any(w in q_lower for w in ["weather", "temperature", "rainfall", "humidity", "how's the climate",
                                       "weather forecast", "is it raining"]) and "demand" not in q_lower:
            return (
                "To check weather, open the Weather Monitor page from the navigation menu. It shows live "
                "conditions for the cities where your suppliers operate — temperature, rainfall, wind and "
                "active weather alerts from Open-Meteo. Weather that threatens a supplier zone (heavy rain, "
                "cyclones, extreme heat) also appears in your alerts feed and feeds into the "
                "geographic-proximity part of each supplier's risk score during a disruption. If you've "
                "just onboarded, you'll see weather only for your own supplier zones."
            )

        # ── PLATFORM AREA NAVIGATION (map, trends, history, config, etc.) ──
        if has_nav_intent or any(k in q_lower for k in [
            "supply chain map", "twin map", "dependency heatmap", "heatmap", "resilience score",
            "data quality", "notification bell", "support ticket", "global search",
        ]):
            nav_answers = [
                (["supply chain map", "twin map", "supplier map", " map", "supplier location", "where are my supplier"],
                 "Open the Supply Chain Map from the navigation menu. It plots your suppliers as nodes on a "
                 "regional map, shows port hubs and trade routes, and animates active disruptions as pulses, "
                 "so you can see at a glance which parts of your network are exposed."),
                (["dependency", "heatmap", "concentration"],
                 "Open the Dependency Heatmap from the navigation menu. It's a category-by-zone matrix showing "
                 "where your supply is concentrated — bright cells mean many suppliers clustered in one "
                 "category/region, which is a concentration risk because a single disruption there hits "
                 "multiple suppliers at once."),
                (["trend", "30-day", "30 day", "health over time", "supplier health"],
                 "Open Supplier Trends from the navigation menu. It shows a 30-day health trend for each "
                 "supplier so you can spot gradual decline before it turns critical."),
                (["history", "past event", "event log", "previous disruption", "earlier event"],
                 "Open Event History from the navigation menu. It lists every disruption you've analysed, with "
                 "the full analysis and the record of how each one actually resolved."),
                (["config", "threshold", "sensitivity", "severity setting"],
                 "Open the Config page from the navigation menu. You can view and tune detection thresholds — "
                 "the severity trigger level, cascade-overlap multiplier and dissent-divergence threshold — and "
                 "review the change history. Raise or lower these to make the system more or less sensitive."),
                (["account", "profile", "change password", "session", "delete account", "notification setting", "export data", "export all"],
                 "Open Account Settings from the top-right menu. It has seven tabs: Profile, Change Password, "
                 "Notifications, Security (active sessions), Feedback, Onboarding, and Account Info — which "
                 "includes full data export and the danger-zone account delete."),
                (["resilience", "preparedness", "how prepared"],
                 "Your Resilience Score sits on the dashboard — a 0-100 preparedness dial built from four parts: "
                 "supplier diversification, buffer stock, route diversity and recovery capability. It's computed "
                 "before any disruption so you can harden weak areas proactively."),
                (["data quality", "feed quality", "data fresh", "how fresh"],
                 "The Data Quality meter on your dashboard shows how fresh and confident your news and weather "
                 "feeds are — filtered to your supplier zones and industry — so you know how much to trust the "
                 "live signals."),
                (["search", "global search", "find anything"],
                 "Press Ctrl+K anywhere to open global search across your events, suppliers and audit log."),
                (["notification", "alert bell", "bell"],
                 "The notification bell at the top-right of the header shows your latest alerts — new "
                 "disruptions, resolutions and system messages. Click any item to jump to the relevant page."),
                (["support", "raise ticket", "report a problem", "report a bug", "contact you", "help desk"],
                 "Click the \"?\" button in the header to open a support ticket. Choose a category and priority, "
                 "describe the issue (at least 20 characters) and you'll get a ticket ID (TKT-XXXXXX) — a copy "
                 "is emailed to you and to our team."),
                (["feedback", "rate the", "leave a review", "csat"],
                 "Leave a star rating and comment in Account Settings → Feedback. We read every one."),
                (["scenario", "what-if", "what if", "simulate", "rehearse", "pre-built", "test a disruption"],
                 "Use the Scenario Creator on your dashboard to launch a pre-built or custom what-if disruption. "
                 "Pick a template (or set your own geography, type and severity) and the full analysis pipeline "
                 "runs so you can rehearse your response before a real event hits."),
            ]
            for keywords, answer in nav_answers:
                if any(k in q_lower for k in keywords):
                    return answer

        # ── PLATFORM NAVIGATION QUESTIONS ──────────────────────────────────
        is_how_to = any(w in q_lower for w in ["how to", "how do", "how can", "how do i", "where", "navigate", "find", "go to"])
        if is_how_to or any(w in q_lower for w in ["add supplier", "new supplier", "delete supplier", "remove supplier",
                                                     "edit supplier", "update supplier", "upload", "export"]):
            if any(w in q_lower for w in ["add", "new", "create"]) and "supplier" in q_lower:
                return (
                    "To add a new supplier, go to the Supplier Management section from your dashboard. "
                    "Click the 'Add Supplier' button and fill in the details: Supplier Name, Zone/Region, "
                    "Categories (e.g., Oil, Logistics), Buffer Stock Days, Number of Sites, Reliability %, "
                    "and Proximity Score (1-10). Save to add it. Once added, the next disruption analysis "
                    "will automatically include this supplier in risk scoring, demand forecasting, and "
                    "recovery planning. You can also bulk-upload multiple suppliers using an Excel template "
                    "from the Suppliers → Upload Excel option."
                )
            if any(w in q_lower for w in ["delete", "remove"]) and "supplier" in q_lower:
                return (
                    "To delete a supplier, go to Supplier Management from your dashboard. Find the supplier "
                    "in the list, click the action menu (three dots) next to their name, and select 'Delete'. "
                    "You'll be asked to confirm before it's permanently removed. If you want to remove "
                    "multiple suppliers at once, use the checkboxes to select them and click 'Bulk Delete'. "
                    "Note: deleting a supplier only removes them from future analyses — past event records "
                    "that included them are preserved in your history."
                )
            if any(w in q_lower for w in ["edit", "update", "change", "modify"]) and "supplier" in q_lower:
                return (
                    "To edit a supplier's details, go to Supplier Management and click on the supplier's "
                    "name or the edit (pencil) icon next to it. You can update any field — name, zone, "
                    "categories, buffer stock, reliability, or proximity score. Changes take effect "
                    "immediately and will be reflected in the next disruption analysis you run."
                )
            if "upload" in q_lower or "excel" in q_lower or "bulk" in q_lower:
                return (
                    "To upload multiple suppliers at once, go to Suppliers → Upload Excel. Download the "
                    "template first (it shows the exact column format required), fill it in with your "
                    "supplier data, then upload the completed file. Required columns are: Supplier Name, "
                    "Zone, and Categories. Optional but recommended: Buffer Stock Days, Sites, Reliability %, "
                    "Proximity Score. The system supports up to 50 suppliers on the current tier."
                )
            if "export" in q_lower:
                return (
                    "To export your supplier data, go to Supplier Management and click the 'Export' button "
                    "in the top-right corner. This downloads a styled Excel file with all your current "
                    "suppliers and their attributes. For a full data export including events, audit log, "
                    "and memory, go to Account Settings → Account Info → Export All Data."
                )
            if "scenario" in q_lower or "trigger" in q_lower or "event" in q_lower:
                return (
                    "To trigger a disruption scenario, use the 'Report Disruption' button on your dashboard "
                    "(bottom-right area). Fill in the event details: geography, event type (cyclone, port "
                    "closure, strike, etc.), severity (1-10), and a description. Click Submit and the "
                    "9-agent analysis pipeline starts immediately. Results stream in via the Live Activity "
                    "Feed within 60-90 seconds. You can also browse pre-built scenarios in the Scenario "
                    "Creator to quickly simulate common disruption types."
                )
            if "report" in q_lower:
                return (
                    "DisruptIQ generates 9 types of reports: Event Log, Swarm Performance, Memory Accuracy, "
                    "Dissent Detection, Simulation Accuracy, Cascade Detection, Counterfactual Summary, "
                    "HIL Decisions, and Forecast-Risk Accuracy. Access them from the Reports page in the "
                    "navigation menu. All reports are filtered to your client data only and can be "
                    "downloaded as structured data."
                )

        # ── WHAT CAN YOU DO / CAPABILITIES QUESTION ────────────────────────
        if any(w in q_lower for w in [
            "what can you", "what else", "what do you", "capabilities", "features", "help me with",
            "can you do", "what all", "what you can", "things you can", "list of features",
            "list your", "what are you able", "how can you help", "what can i ask", "what can i do here",
            "what is this", "who are you", "what do you do",
        ]):
            return (
                "I'm your supply chain intelligence assistant for this disruption event. Here's what I can help you with:\n\n"
                "About this disruption:\n"
                f"  • Why specific suppliers like {suppliers[0].get('supplier_name', 'your suppliers') if suppliers else 'your suppliers'} "
                f"are at risk and what factors drive their score\n"
                "  • What the demand impact means for each of your product categories\n"
                "  • Which recovery option to choose and how to implement it step-by-step\n"
                "  • Whether a cascade/chain-reaction risk exists and how to respond\n"
                "  • What past similar disruptions taught us and how those lessons apply now\n\n"
                "Platform guidance:\n"
                "  • How to add, edit, or delete suppliers\n"
                "  • How to upload suppliers in bulk via Excel\n"
                "  • How to trigger disruption scenarios\n"
                "  • How to view reports, export data, or manage your account\n\n"
                "Just ask me anything — 'Why is [supplier] high risk?', 'What should I do next?', "
                "'What will demand look like?', or 'How do I add a new supplier?' — and I'll explain it fully."
            )

        # ── SPECIFIC SUPPLIER QUESTION ─────────────────────────────────────
        for supplier in suppliers:
            supplier_name = supplier.get("supplier_name", "").lower()
            if supplier_name and supplier_name in q_lower:
                score = supplier.get("composite_score", 0)
                tier = supplier.get("risk_tier", "Unrated")
                buf = supplier.get("buffer_stock_days", 0)
                reliability = supplier.get("reliability", 0)
                sites = supplier.get("sites", 1)
                categories = supplier.get("categories", [])

                # Get fields — use precomputed explanation if present, else compute from raw
                explanation = supplier.get("explanation", {}) if isinstance(supplier.get("explanation"), dict) else {}
                llm_narrative = explanation.get("llm_narrative", "")
                recommended_action = explanation.get("recommended_action", "")
                memory_adjustment = explanation.get("memory_adjustment", 0)
                base_score = explanation.get("base_score", score)
                primary_drivers = explanation.get("primary_drivers", [])
                factor_details = explanation.get("factor_details", {})

                name = supplier.get("supplier_name", "This supplier")
                categories_str = ", ".join(categories) if categories else "general supplies"

                # Build the response in a conversational, explanatory way
                parts = []

                # Opening: direct answer
                tier_phrases = {
                    "Critical": f"{name} is rated Critical risk — the highest danger level. Here's why:",
                    "High": f"{name} is rated High risk, making it one of your most vulnerable suppliers right now. Here's the full picture:",
                    "Medium": f"{name} is at Medium risk. While not immediately critical, the {evt_type} creates real vulnerabilities. Here's why:",
                    "Low": f"{name} is currently Low risk. However, let me explain how the {evt_type} still affects them:",
                }
                parts.append(tier_phrases.get(tier, f"{name} has a risk score of {score}/100 ({tier}). Here's the breakdown:"))
                parts.append("")

                # Risk score explanation
                if memory_adjustment and memory_adjustment != 0:
                    parts.append(f"Risk score: {score}/100 (base {base_score}/100, adjusted {memory_adjustment:+.1f} pts from past similar events)")
                else:
                    parts.append(f"Risk score: {score}/100")
                parts.append("")

                # Factor-by-factor explanation — prefer precomputed, fallback to raw computation
                if factor_details:
                    parts.append("Why this score? Five factors drive it:")
                    factor_order = [
                        ("proximity", "Geographic proximity"),
                        ("buffer_score", "Buffer stock"),
                        ("site_score", "Site diversity"),
                        ("reliability_score", "Reliability"),
                        ("category_score", "Category exposure"),
                    ]
                    top_factor = explanation.get("top_factor", "")
                    for fkey, flabel in factor_order:
                        if fkey in factor_details:
                            fd = factor_details[fkey]
                            marker = " ← MAIN DRIVER" if fkey == top_factor else ""
                            parts.append(f"  • {flabel} ({fd.get('weighted', 0)} pts): {fd.get('interpretation', '')} [{fd.get('status', '').upper()}]{marker}")
                else:
                    # Compute from raw data using our interpreter
                    parts.append("Here's what's driving the risk:")
                    factor_explanations = _interpret_supplier_risk_from_raw(supplier, evt_type, geo, sev)
                    for i, exp in enumerate(factor_explanations, 1):
                        factor_labels = ["Geographic proximity", "Buffer stock", "Site diversity", "Reliability", "Category exposure"]
                        label = factor_labels[i - 1] if i <= len(factor_labels) else "Factor"
                        parts.append(f"  {i}. {label}: {exp}")
                parts.append("")

                # LLM narrative if available
                if llm_narrative:
                    parts.append(f"AI assessment: {llm_narrative}")
                    parts.append("")

                # Business impact in context of this specific event
                parts.append(f"In context of this {evt_type} (severity {sev}/10 in {geo}):")
                if prox := supplier.get("proximity_score", 5):
                    if prox >= 7:
                        parts.append(f"  — This supplier is physically close to the disruption zone. Operations may already be impacted.")
                if buf <= 3:
                    days_left = buf
                    parts.append(f"  — With only {days_left} day{'s' if days_left != 1 else ''} of buffer stock, you could face a production stoppage within days if supply is cut.")
                elif buf <= 7:
                    parts.append(f"  — {buf} days of buffer gives a narrow window. A disruption lasting more than {buf} days will cause production impact.")
                else:
                    parts.append(f"  — {buf} days of buffer provides room to find alternatives before operations are affected.")
                if sites == 1:
                    parts.append("  — Single manufacturing site means zero internal backup if this location is shut down.")
                if reliability < 75:
                    parts.append(f"  — {reliability}% reliability under normal conditions will drop further during disruption stress.")
                parts.append(f"  — Supplies: {categories_str}. Assess how critical these inputs are to your production line.")
                parts.append("")

                # Primary drivers if available
                if primary_drivers:
                    parts.append("Key risk drivers:")
                    for d in primary_drivers[:3]:
                        parts.append(f"  • {d}")
                    parts.append("")

                # What to do
                if recommended_action:
                    parts.append(f"Recommended action: {recommended_action}")
                elif tier == "Critical":
                    parts.append(
                        "What to do: Activate your secondary suppliers immediately. Contact this supplier "
                        "today to confirm their operational status. Place emergency purchase orders with "
                        f"alternates to cover at least {max(14 - buf, 7)} days of supply gap."
                    )
                elif tier == "High":
                    parts.append(
                        "What to do: Begin contingency planning now — don't wait for disruption to materialise. "
                        "Identify and alert your backup suppliers, review open purchase orders, and increase "
                        "monitoring frequency. Prepare customer communication templates in case of delays."
                    )
                else:
                    parts.append(
                        "What to do: No immediate action required, but keep a close eye on this supplier over "
                        f"the next 48-72 hours as the {evt_type} develops. Confirm their current operational "
                        "status and review your inventory position as a precaution."
                    )

                return "\n".join(parts)

        # ── GENERAL RISK OVERVIEW ──────────────────────────────────────────
        if any(w in q_lower for w in ["risk", "which supplier", "critical", "high risk", "dangerous", "vulnerable", "most at risk"]):
            if not suppliers:
                return "The risk analysis hasn't completed yet for this disruption. It typically finishes within 90 seconds of triggering the event."

            critical = [s for s in suppliers if s.get("risk_tier") == "Critical"]
            high = [s for s in suppliers if s.get("risk_tier") == "High"]
            medium = [s for s in suppliers if s.get("risk_tier") == "Medium"]
            low = [s for s in suppliers if s.get("risk_tier") == "Low"]

            parts = [
                f"Here's a full risk picture of your {len(suppliers)} suppliers under this {evt_type} "
                f"(severity {sev}/10) in {geo}:\n"
            ]

            if critical:
                parts.append(f"CRITICAL ({len(critical)} supplier{'s' if len(critical) != 1 else ''}) — Immediate action needed:")
                for s in critical:
                    buf = s.get("buffer_stock_days", 0)
                    rel = s.get("reliability", 0)
                    cats = ", ".join(s.get("categories", [])[:2])
                    exp = s.get("explanation", {})
                    top = exp.get("top_factor", "") if isinstance(exp, dict) else ""
                    parts.append(f"  • {s.get('supplier_name')} — Score {s.get('composite_score')}/100")
                    parts.append(f"    Buffer: {buf} days | Reliability: {rel}% | Supplies: {cats}")
                    if top:
                        parts.append(f"    Main risk driver: {top.replace('_', ' ')}")

            if high:
                parts.append(f"\nHIGH ({len(high)} supplier{'s' if len(high) != 1 else ''}) — Begin contingency planning:")
                for s in high:
                    buf = s.get("buffer_stock_days", 0)
                    parts.append(f"  • {s.get('supplier_name')} — Score {s.get('composite_score')}/100, {buf} days buffer")

            if medium:
                parts.append(f"\nMEDIUM ({len(medium)} supplier{'s' if len(medium) != 1 else ''}) — Monitor closely:")
                for s in medium:
                    parts.append(f"  • {s.get('supplier_name')} — Score {s.get('composite_score')}/100")

            if low:
                parts.append(f"\nLOW ({len(low)} supplier{'s' if len(low) != 1 else ''}) — Currently stable.")

            parts.append(
                f"\nThe {evt_type}'s severity of {sev}/10 means disruptions could last 5-14 days. "
                f"Suppliers with under 7 days of buffer stock are at immediate stockout risk. "
                f"Focus your response on critical and high-tier suppliers first."
            )

            if critical:
                names = " and ".join([s.get("supplier_name", "") for s in critical[:2]])
                parts.append(f"\nPriority: Contact {names} today to confirm their operational status.")

            return "\n".join(parts)

        # ── DEMAND FORECAST ────────────────────────────────────────────────
        if any(w in q_lower for w in ["demand", "forecast", "impact", "shift", "category", "product", "what happen", "how bad"]):
            cats = forecast_data.get("affected_categories", [])
            if not cats:
                return f"Demand forecast for this {evt_type} hasn't completed yet. It runs in parallel with the supplier risk analysis."

            parts = [
                f"The {evt_type} in {geo} (severity {sev}/10) is reshaping demand across your supply chain. "
                f"Here's what to expect:\n"
            ]

            for cat in cats:
                name = cat.get("category", "Unknown")
                shift = cat.get("demand_shift_pct", 0)
                low_conf = cat.get("low_confidence", False)
                direction = "surge" if shift > 0 else "drop"
                confidence = "lower confidence" if low_conf else "high confidence"

                if shift > 20:
                    severity_word = "major"
                elif shift > 10:
                    severity_word = "significant"
                elif shift > 0:
                    severity_word = "moderate"
                elif shift < -20:
                    severity_word = "severe"
                else:
                    severity_word = "moderate"

                parts.append(f"  • {name}: {shift:+.1f}% {direction} ({severity_word}, {confidence})")

            parts.append("")

            positive_cats = [c for c in cats if c.get("demand_shift_pct", 0) > 0]
            negative_cats = [c for c in cats if c.get("demand_shift_pct", 0) < 0]

            if positive_cats:
                cat_names = ", ".join([c.get("category", "") for c in positive_cats[:2]])
                parts.append(
                    f"Demand surges in {cat_names} reflect panic buying and stockpiling behaviour "
                    f"— typical in {evt_type.lower()} scenarios. This means your competitors are also "
                    f"scrambling for the same supply, driving up prices and reducing availability."
                )
            if negative_cats:
                cat_names = ", ".join([c.get("category", "") for c in negative_cats[:2]])
                parts.append(
                    f"Demand drops in {cat_names} reflect reduced economic activity and consumer "
                    f"spending freezes post-disruption. This may give you breathing room on those lines "
                    f"but signals downstream revenue risk."
                )

            parts.append(
                f"\nWhat this means for you: Cross-reference these shifts against your current inventory "
                f"and open purchase orders. For categories with demand surge and low buffer stock, "
                f"expedite procurement immediately — price premiums will only increase over time."
            )

            return "\n".join(parts)

        # ── WHAT SHOULD I DO / RECOMMENDATIONS ────────────────────────────
        if any(w in q_lower for w in ["suggest", "recommend", "action", "option", "should", "what next", "what do", "what to", "how do i respond", "do next", "shall i"]):
            options = action_data.get("options", [])
            if not options:
                return f"Recovery options are being generated for this {evt_type}. They should be ready within 90 seconds of triggering the event."

            critical = [s for s in suppliers if s.get("risk_tier") == "Critical"]
            high = [s for s in suppliers if s.get("risk_tier") == "High"]
            affected_cats = forecast_data.get("affected_categories", [])

            parts = [
                f"You're dealing with a {evt_type} (severity {sev}/10) in {geo} that's affecting "
                f"{len(suppliers)} suppliers. Here's your action plan:\n"
            ]

            # Immediate context
            if critical:
                names = ", ".join([s.get("supplier_name", "") for s in critical])
                parts.append(
                    f"Most urgent: {names} {'is' if len(critical) == 1 else 'are'} at Critical risk. "
                    f"{'This supplier has' if len(critical) == 1 else 'These suppliers have'} "
                    f"limited buffer and may already be experiencing operational disruption."
                )
                parts.append("")

            # Recovery options
            parts.append("Your 3 ranked recovery options:\n")
            top_eff = 0
            for i, opt in enumerate(options[:3], 1):
                atype = opt.get("action_type", "Recovery action")
                eff = opt.get("effectiveness_score", 0)
                rto = opt.get("rto_tag", "unknown")
                cost = opt.get("cost_delta_pct", 0)
                rationale = opt.get("rationale", "")
                safe_sup = opt.get("supplier_name", "") or opt.get("alternate_supplier", "")
                if i == 1:
                    top_eff = eff

                parts.append(f"Option {i}: {atype}")
                parts.append(f"  Effectiveness: {eff}% | Recovery time: {rto} | Extra cost: +{cost}%")
                if safe_sup:
                    parts.append(f"  Alternate supplier: {safe_sup}")
                if rationale:
                    parts.append(f"  Why: {rationale}")
                parts.append("")

            # Step-by-step plan
            parts.append("Implementation steps:")
            parts.append("")
            parts.append("Today (next 24 hours):")
            if critical:
                for s in critical[:2]:
                    parts.append(f"  1. Call {s.get('supplier_name')} — confirm if their facility is operational")
                    parts.append(f"     Ask about current lead times and available stock")
            parts.append(f"  2. Activate Option 1 ({options[0].get('action_type', 'top option')}) — start alternate supplier outreach now")
            parts.append(f"  3. Alert your top customers to possible {3 + round(sev)}-day delays")
            parts.append("")

            parts.append("Days 2-7:")
            parts.append(f"  4. Execute purchase orders through alternate suppliers")
            if affected_cats:
                worst = max(affected_cats, key=lambda c: abs(c.get("demand_shift_pct", 0)))
                parts.append(f"  5. Prioritise {worst.get('category', 'high-impact')} category — largest demand shift ({worst.get('demand_shift_pct', 0):+.1f}%)")
            parts.append(f"  6. Daily check-in with all high-risk suppliers")
            parts.append("")

            parts.append("Week 2-4:")
            parts.append(f"  7. Assess full recovery — measure actual vs forecast impact")
            parts.append(f"  8. Once disruption resolves, log the outcome so the system learns from this event")

            if cascade_data.get("cascade_detected"):
                parts.append(
                    f"\nWarning: A chain-reaction risk has been detected alongside this event. "
                    f"Multiple suppliers are exposed to both disruptions simultaneously, which "
                    f"significantly limits your alternate-supplier options. Consider temporary "
                    f"production reduction and customer rationing to protect your most critical orders."
                )

            return "\n".join(parts)

        # ── CASCADE / CHAIN REACTION ───────────────────────────────────────
        if any(w in q_lower for w in ["cascade", "compound", "chain", "multiple events", "linked", "both events"]):
            if cascade_data.get("cascade_detected"):
                summary = cascade_data.get("summary", "Multiple linked disruptions")
                shared = cascade_data.get("shared_suppliers", [])
                combined = cascade_data.get("combined_severity_score", sev)
                parts = [
                    f"Yes — a chain reaction has been detected. {summary}\n",
                    f"Combined risk score: {combined}/10 (higher than either disruption alone)",
                    f"{len(shared)} of your suppliers are exposed to both events simultaneously.",
                ]
                if shared:
                    parts.append(f"Shared vulnerable suppliers: {', '.join([s if isinstance(s, str) else s.get('supplier_name', '') for s in shared[:3]])}")
                parts.append(
                    "\nWhy this matters: When two disruptions overlap, alternate suppliers that would normally "
                    "save you are also disrupted. Your recovery options shrink dramatically, and market "
                    "prices for available supply spike due to universal demand for the same alternatives."
                )
                parts.append(
                    "Recommended response: Escalate to senior leadership immediately. Consider temporary "
                    "production slowdown to conserve inventory. Negotiate extended payment terms with "
                    "customers. Activate your crisis-response protocol if you have one."
                )
                return "\n".join(parts)
            return (
                f"No chain reaction detected — this {evt_type} in {geo} appears to be an isolated event. "
                f"Your alternate suppliers outside the affected region should still be operational, "
                f"which gives you more flexibility in your recovery options."
            )

        # ── PAST EXPERIENCE / MEMORY ──────────────────────────────────────
        if any(w in q_lower for w in ["past", "history", "before", "similar", "learn", "previous", "memory"]):
            recalls = swarm_outputs.get("memory_recalls", [])
            if recalls:
                parts = [f"We found {len(recalls)} similar past disruption{'s' if len(recalls) != 1 else ''} in your history:\n"]
                for i, r in enumerate(recalls[:3], 1):
                    parts.append(f"Event {i}: {r.get('event_type', 'Disruption')} in {r.get('geography', 'unknown region')}")
                    if r.get("actual_demand_shift"):
                        parts.append(f"  Actual demand shift: {r.get('actual_demand_shift'):+.1f}%")
                    if r.get("actual_outcome"):
                        parts.append(f"  How it resolved: {r.get('actual_outcome')}")
                    if r.get("learning_signal"):
                        parts.append(f"  Key learning: {r.get('learning_signal')}")
                    parts.append("")
                parts.append(
                    "These past events have been used to calibrate the current risk scores and demand "
                    "forecasts — suppliers that performed poorly in similar conditions have higher scores "
                    "now, and the demand projections are adjusted based on what actually happened before."
                )
                return "\n".join(parts)
            return (
                f"No closely matching historical events found in your system's memory for a {evt_type} "
                f"in {geo}. This means the current forecasts are based on the disruption parameters "
                f"and your supplier data alone, without historical calibration. Consider logging "
                f"the actual outcome after resolution — it becomes the baseline for future events."
            )

        # ── DEFAULT: FULL SITUATION OVERVIEW ──────────────────────────────
        critical = [s for s in suppliers if s.get("risk_tier") == "Critical"]
        high = [s for s in suppliers if s.get("risk_tier") == "High"]
        options = action_data.get("options", [])
        cats = forecast_data.get("affected_categories", [])

        # No suppliers were analysed — this happens when the disruption ran before
        # the client imported suppliers. Guide them instead of showing empty zeros.
        if not suppliers:
            return (
                f"This {evt_type} in {geo} (severity {sev}/10) was analysed, but there were no suppliers "
                "in your account at the time — so I can't yet tell you who's at risk or recommend "
                "supplier-specific actions.\n\n"
                "To get a full, personalised analysis:\n"
                "  1. Go to Supplier Management and add your suppliers (or bulk-upload an Excel file).\n"
                "  2. Re-run this disruption with the 'Report Disruption' button.\n"
                "  3. Come back here and I'll explain each supplier's risk, the demand impact, and your "
                "best recovery options in detail.\n\n"
                "In the meantime, ask me how to add suppliers, how the risk scoring works, or anything "
                "about using the platform — I'm happy to help."
            )

        parts = [
            f"Here's a full summary of what's happening with this {evt_type} in {geo} "
            f"(severity {sev}/10):\n"
        ]

        parts.append(f"Your supply chain exposure:")
        parts.append(f"  • {len(suppliers)} suppliers analysed")
        parts.append(f"  • {len(critical)} at Critical risk — immediate action needed")
        parts.append(f"  • {len(high)} at High risk — begin contingency planning")
        parts.append("")

        if cats:
            worst = max(cats, key=lambda c: abs(c.get("demand_shift_pct", 0)))
            parts.append(
                f"Biggest demand impact: {worst.get('category', 'key category')} "
                f"is forecast to shift {worst.get('demand_shift_pct', 0):+.1f}% — "
                f"{'a surge that will strain alternate supply sources' if worst.get('demand_shift_pct', 0) > 0 else 'a drop signalling downstream revenue risk'}."
            )
            parts.append("")

        if options:
            top = options[0]
            parts.append(
                f"Top recommended action: {top.get('action_type', 'recovery option')} "
                f"({top.get('effectiveness_score', 0)}% effectiveness, {top.get('rto_tag', 'unknown')} recovery time)."
            )
            parts.append("")

        parts.append(
            "Ask me anything specific — 'Why is [supplier name] at risk?', "
            "'What exactly should I do in the next 24 hours?', "
            "'How bad is the demand impact?', or 'How do I add a new supplier?' — "
            "and I'll give you a detailed answer."
        )

        return "\n".join(parts)

    except Exception:
        return (
            "Something went wrong generating the analysis. The disruption event is still being "
            "processed — please try your question again in a few seconds."
        )


async def nl_interrogation(event_id: str, question: str,
                            swarm_outputs: dict) -> dict:
    """Answer natural language questions about the event using comprehensive context."""
    target = _route_nl_question(question)
    answered_by = AGENT_FRIENDLY_NAMES.get(target, "Analysis Team")

    # Build comprehensive context narrative
    full_context = _build_comprehensive_nl_context(swarm_outputs)

    # Create intelligent fallback that uses the context to generate specific answers
    smart_fallback = _smart_fallback_nl_answer(question, full_context, target, swarm_outputs)

    # System-aware prompt: the assistant understands BOTH this disruption AND the
    # whole DisruptIQ platform, so it can answer event questions and "how do I…"
    # navigation questions with the same fluency a human product expert would.
    system_prompt = (
        "You are DisruptIQ's AI assistant — an expert supply-chain analyst embedded in the "
        "DisruptIQ disruption-response platform. You help the user understand and act on a live "
        "supply-chain disruption, and you also know the platform inside-out so you can guide them "
        "around it.\n\n"
        "ANSWER STYLE:\n"
        "• Be genuinely helpful, specific, and confident — like ChatGPT or Claude would be.\n"
        "• ALWAYS use the concrete numbers, supplier names, categories, and scores from the CONTEXT "
        "below. Never invent suppliers or data that isn't there.\n"
        "• Connect the dots: relate risk → buffer stock → demand shift → recovery option so the user "
        "sees the full chain of reasoning, not isolated facts.\n"
        "• Structure longer answers with short labelled lines or bullets (use '•' and newlines).\n"
        "• If the user seems unsatisfied or vague, acknowledge it and offer 3-4 specific things you "
        "can answer next. Never repeat the same generic summary twice.\n"
        "• If the disruption has 0 suppliers analysed, explain that the analysis ran before suppliers "
        "were added and tell them to re-run the disruption after importing suppliers.\n\n"
        "PLATFORM KNOWLEDGE (use to answer 'how do I…' / 'where is…' questions):\n"
        "• Suppliers: add/edit/delete and bulk Excel upload/export in Supplier Management.\n"
        "• Dashboard: live Swarm Feed, Supplier Risk table (with a 'Why?' drill-down), Demand Impact "
        "chart, ranked Recovery Actions, Resilience Score dial, Data Quality meter, Scenario Creator.\n"
        "• Pages: Supply Chain Map, Dependency Heatmap, Supplier Trends, Reports (9 report types), "
        "Event History, Weather Monitor, Config (tune severity/cascade/dissent thresholds), "
        "Account Settings (profile, password, sessions, notifications, feedback, data export, delete).\n"
        "• Trigger a disruption with the 'Report Disruption' button; results stream in ~60-90s.\n"
        "• Global search is Ctrl+K; the notification bell and a '?' support button sit in the header.\n\n"
        "Do NOT mention internal agent names or implementation details. Focus on the user's business "
        "and on getting them to the right answer or the right place in the product."
    )

    user_prompt = (
        f"USER QUESTION: {question}\n\n"
        f"CONTEXT — current disruption analysis:\n{full_context or '(No analysis data available yet.)'}\n\n"
        f"Answer the user's question directly and helpfully. If it's about using the platform, give "
        f"clear step-by-step navigation. If it's about the disruption, ground every claim in the "
        f"context numbers above."
    )

    response = await llm.chat_text(
        system=system_prompt,
        user=user_prompt,
        max_tokens=600,
        fallback=smart_fallback,
    )

    # Pass the response through the Content Safety filter (NFR-08)
    safety = await llm.content_safety_check(response)
    if not safety["safe"]:
        response = "We can't show this answer — it didn't pass our safety check. Please rephrase your question."

    # Log the query for audit trail (general-mode queries use "general" as the key)
    storage.log_nl_query(event_id or "general", question, target, response, {"context": full_context})

    return {
        "question": question,
        "agent_context_used": target,
        "answered_by": answered_by,
        "response": response,
        "content_safety_passed": safety["safe"],
        "timestamp_utc": _now_utc(),
    }


# ════════════════════════════════════════════════════════════════════════════
# FEATURE 5c — ANOMALY DETECTION AGENT
# Flag suppliers with critical conditions: zero/low buffer, low reliability, concentration risk
# ════════════════════════════════════════════════════════════════════════════

def anomaly_detection_agent(suppliers: list) -> dict:
    """Detect supplier anomalies: buffer stock issues, reliability risks, concentration risks."""
    anomalies = []

    for sup in suppliers:
        sid = sup.get("id", "")
        sname = sup.get("name", "")
        buf = sup.get("buffer_stock_days", 0)
        rel = sup.get("reliability", 100)
        sites = sup.get("sites", 1)

        if buf == 0:
            anomalies.append({
                "supplier_id": sid,
                "supplier_name": sname,
                "anomaly_type": "zero_buffer_stock",
                "severity": "critical",
                "description": "Zero buffer stock — any disruption causes immediate stockout.",
                "recommended_action": "Emergency replenishment order required."
            })
        elif buf < 3:
            anomalies.append({
                "supplier_id": sid,
                "supplier_name": sname,
                "anomaly_type": "critical_low_buffer",
                "severity": "critical",
                "description": f"Buffer stock at {buf} days — critically below 3-day threshold.",
                "recommended_action": "Expedite replenishment order immediately."
            })

        if rel < 70:
            anomalies.append({
                "supplier_id": sid,
                "supplier_name": sname,
                "anomaly_type": "reliability_risk",
                "severity": "warning",
                "description": f"Reliability {rel}% is below 70% acceptable threshold.",
                "recommended_action": "Schedule reliability audit and identify backup options."
            })

        if sites == 1 and buf < 7:
            anomalies.append({
                "supplier_id": sid,
                "supplier_name": sname,
                "anomaly_type": "single_site_critical",
                "severity": "warning",
                "description": f"Single-site supplier with only {buf} days buffer — high concentration risk.",
                "recommended_action": "Dual-source or increase buffer to minimum 7 days."
            })

    return {
        "anomalies": anomalies,
        "total_anomalies": len(anomalies),
        "timestamp_utc": _now_utc()
    }


# ════════════════════════════════════════════════════════════════════════════
# FEATURE 2 — RESILIENCE SCORE AGENT
# Proactive 0-100 preparedness score, computed BEFORE any disruption.
# Deterministic — reuses SUPPLIERS data + two-stage Swarm Memory. No LLM.
# ════════════════════════════════════════════════════════════════════════════

def resilience_score_agent(client_id: str = None, suppliers: list = None) -> dict:
    """Compute a 0-100 supply-chain resilience score for a specific client.

    `suppliers` should be passed by the caller (resolved from clients_db). It is
    only resolved from seed data when not supplied, to avoid leaking demo data
    into real authenticated clients.
    """
    if not client_id:
        client_id = config.ACTIVE_CLIENT_ID
    if suppliers is None:
        from seed_data import get_suppliers_for_client
        suppliers = get_suppliers_for_client(client_id)

    # A client with no imported suppliers gets an explicit empty-state result
    # rather than misleading numbers derived from a divide-by-one fallback.
    if not suppliers:
        return {
            "agent": "Resilience Scorekeeper",
            "client_id": client_id,
            "resilience_score": 0,
            "rating": "NO DATA",
            "trend": "stable",
            "components": {
                "supplier_diversification": 0.0,
                "buffer_stock": 0.0,
                "route_diversity": 0.0,
                "recovery_capability": 0.0,
            },
            "weakest_area": "supplier_diversification",
            "metrics": {
                "supplier_count": 0,
                "distinct_categories": 0,
                "distinct_zones": 0,
                "avg_buffer_days": 0.0,
                "avg_sites": 0.0,
                "avg_reliability": 0.0,
                "counterfactual_records": 0,
            },
            "recommendations": ["Import your suppliers to generate a resilience score."],
            "timestamp_utc": _now_utc(),
        }

    n = len(suppliers) or 1

    # 1. Supplier diversification (0-25) — category redundancy
    category_coverage: dict[str, int] = {}
    for s in suppliers:
        for cat in s.get("categories", []):
            category_coverage[cat] = category_coverage.get(cat, 0) + 1
    distinct_categories = len(category_coverage) or 1
    avg_suppliers_per_category = sum(category_coverage.values()) / distinct_categories
    diversification = min(25.0, round(avg_suppliers_per_category * 7, 1))

    # 2. Buffer stock levels (0-25) — 14+ days average = full marks
    avg_buffer = sum(s["buffer_stock_days"] for s in suppliers) / n
    buffer_score = min(25.0, round(avg_buffer / 14 * 25, 1))

    # 3. Geographic / route diversity (0-25)
    distinct_zones = len({s["zone"] for s in suppliers})
    avg_sites = sum(s["sites"] for s in suppliers) / n
    route_diversity = min(25.0, round(distinct_zones * 2.5 + avg_sites * 3, 1))

    # 4. Recovery capability (0-25) — supplier reliability + memory learning
    avg_reliability = sum(s["reliability"] for s in suppliers) / n
    reliability_component = round(avg_reliability / 100 * 15, 1)
    counterfactuals = storage.get_counterfactuals()
    memory_component = min(10.0, len(counterfactuals) * 3.0) if counterfactuals else 4.0
    recovery_capability = round(reliability_component + memory_component, 1)

    total = round(diversification + buffer_score + route_diversity + recovery_capability)

    components = {
        "supplier_diversification": diversification,
        "buffer_stock": buffer_score,
        "route_diversity": route_diversity,
        "recovery_capability": recovery_capability,
    }
    weakest = min(components, key=components.get)

    stage2 = [m for m in storage.get_memory_store(5000) if m.get("stage") == 2]
    trend = "improving" if len(stage2) >= 3 else "stable"

    # Data-driven recommendations derived from the actual supplier dataset
    recommendations = []

    # 1. Supplier diversification — name single-sourced or sparse categories
    if diversification < 15:
        single_cats = [cat for cat, cnt in category_coverage.items() if cnt == 1]
        sparse_cats = [cat for cat, cnt in category_coverage.items() if cnt < 3]
        if single_cats:
            cat_list = ", ".join(single_cats[:4]) + ("…" if len(single_cats) > 4 else "")
            recommendations.append(
                f"{len(single_cats)} categor{'y' if len(single_cats)==1 else 'ies'} "
                f"({cat_list}) {'has' if len(single_cats)==1 else 'have'} only 1 supplier — "
                f"add at least 1 backup per category in a different zone to remove these single points of failure."
            )
        elif sparse_cats:
            cat_list = ", ".join(sparse_cats[:3])
            recommendations.append(
                f"Categories {cat_list} each have fewer than 3 suppliers — "
                f"qualify alternatives now before a disruption forces a reactive scramble."
            )

    # 2. Buffer stock — name worst offenders with actual day counts
    if buffer_score < 15:
        low_buf = sorted(
            [s for s in suppliers if s["buffer_stock_days"] < 7],
            key=lambda x: x["buffer_stock_days"]
        )
        if low_buf:
            names = ", ".join(s["name"] for s in low_buf[:3])
            worst = low_buf[0]["buffer_stock_days"]
            recommendations.append(
                f"{len(low_buf)} supplier{'s' if len(low_buf)>1 else ''} ({names}) "
                f"carry fewer than 7 days of buffer stock (lowest: {worst} days). "
                f"Negotiate pre-positioned stock of 14+ days for these nodes to survive a standard 2-week disruption window."
            )
        else:
            recommendations.append(
                f"Average buffer is {round(avg_buffer, 1)} days — push all suppliers toward 14+ days "
                f"to absorb disruptions without resorting to costly emergency air-freight."
            )

    # 3. Geographic concentration — name the over-represented zone
    if route_diversity < 15:
        zone_counts: dict[str, int] = {}
        for s in suppliers:
            zone_counts[s["zone"]] = zone_counts.get(s["zone"], 0) + 1
        top_zone, top_cnt = max(zone_counts.items(), key=lambda x: x[1])
        pct = round(top_cnt / n * 100)
        if distinct_zones < 3:
            recommendations.append(
                f"Suppliers span only {distinct_zones} zone(s) — {top_zone} holds {pct}% of the base. "
                f"Qualify suppliers in at least {max(1, 3 - distinct_zones)} additional zone(s) "
                f"so a single regional event cannot cut off supply entirely."
            )
        else:
            recommendations.append(
                f"{top_zone} concentrates {top_cnt}/{n} suppliers ({pct}%). "
                f"Rebalance toward under-represented zones; target no single zone above 40% of supplier count."
            )

    # 4. Recovery capability — name low-reliability suppliers
    if recovery_capability < 15:
        poor = sorted(
            [s for s in suppliers if s["reliability"] < 75],
            key=lambda x: x["reliability"]
        )
        if poor:
            details = ", ".join(f"{s['name']} ({s['reliability']}%)" for s in poor[:3])
            recommendations.append(
                f"{len(poor)} supplier{'s' if len(poor)>1 else ''} below 75% reliability: {details}. "
                f"Issue performance-improvement notices with 90-day review milestones "
                f"and pre-qualify alternates before the next disruption event."
            )
        else:
            recommendations.append(
                "Resolve at least 3 live disruption scenarios to build counterfactual memory — "
                "each resolved event boosts the recovery-capability score by up to 3 points."
            )

    if not recommendations:
        borderline = [s for s in suppliers if s["reliability"] < 90]
        if borderline:
            names = ", ".join(s["name"] for s in borderline[:3])
            recommendations.append(
                f"All areas are strong. Monitor {len(borderline)} supplier(s) with reliability below 90% "
                f"({names}) — schedule quarterly reviews to keep the score trending upward."
            )
        else:
            recommendations.append(
                "All resilience areas are strong. Run at least one simulated disruption scenario per month "
                "and review counterfactual outcomes to maintain the score above 75."
            )

    rating = "STRONG" if total >= 75 else "MODERATE" if total >= 50 else "WEAK"

    return {
        "agent": "Resilience Scorekeeper",
        "client_id": client_id,
        "resilience_score": total,
        "rating": rating,
        "trend": trend,
        "components": components,
        "weakest_area": weakest,
        "metrics": {
            "supplier_count": n,
            "distinct_categories": distinct_categories,
            "distinct_zones": distinct_zones,
            "avg_buffer_days": round(avg_buffer, 1),
            "avg_sites": round(avg_sites, 1),
            "avg_reliability": round(avg_reliability, 1),
            "counterfactual_records": len(counterfactuals),
        },
        "recommendations": recommendations,
        "timestamp_utc": _now_utc(),
    }


# ════════════════════════════════════════════════════════════════════════════
# FEATURE 3 — DATA QUALITY & CONFIDENCE MONITOR
# Transparent assessment of every data source feeding the swarm.
# News/weather counts are passed in from main.py (it owns the poll buffers).
# ════════════════════════════════════════════════════════════════════════════

def data_quality_agent(news_alerts: Optional[list] = None,
                       weather_cities: Optional[list] = None,
                       suppliers: Optional[list] = None) -> dict:
    """Assess data quality across all sources for the authenticated client's dataset."""
    news_alerts = news_alerts or []
    weather_cities = weather_cities or []
    client_suppliers = suppliers or []
    sources: dict[str, dict] = {}

    # 1. News feed (NewsAPI)
    newsapi_configured = bool(config.NEWSAPI_KEY) and not config.NEWSAPI_KEY.startswith("PLACEHOLDER")
    news_count = len(news_alerts)
    news_q = 90 if (newsapi_configured and news_count > 0) else 60 if newsapi_configured else 35
    sources["news_feed"] = {
        "label": "News Feed (NewsAPI)",
        "quality_score": news_q,
        "status": "available" if news_q >= 70 else "degraded" if news_q >= 40 else "unavailable",
        "detail": f"{news_count} alerts cached · API {'configured' if newsapi_configured else 'not configured'}",
    }

    # 2. Weather feed (Open-Meteo) — cities derived from the client's supplier zones
    weather_count = len(weather_cities)
    weather_q = 92 if weather_count >= 5 else 70 if weather_count > 0 else 40
    sources["weather_feed"] = {
        "label": "Weather Feed (Open-Meteo)",
        "quality_score": weather_q,
        "status": "available" if weather_q >= 70 else "degraded",
        "detail": f"{weather_count} supplier zone{'s' if weather_count != 1 else ''} monitored",
    }

    # 3. Supplier master data completeness — uses the caller's resolved supplier list
    required = ["buffer_stock_days", "sites", "reliability", "categories", "proximity_score", "zone"]
    complete = sum(1 for s in client_suppliers
                   if all(s.get(f) not in (None, "", []) for f in required))
    total_sup = len(client_suppliers)
    supplier_q = round((complete / total_sup) * 100) if total_sup else 0
    missing_fields: list[str] = []
    if client_suppliers:
        for field in required:
            missing_cnt = sum(1 for s in client_suppliers if s.get(field) in (None, "", []))
            if missing_cnt:
                missing_fields.append(f"{field} ({missing_cnt} missing)")
    sources["supplier_data"] = {
        "label": "Supplier Master Data",
        "quality_score": supplier_q,
        "status": "available" if supplier_q >= 70 else "incomplete" if total_sup else "no_data",
        "detail": (
            f"{complete}/{total_sup} suppliers fully populated"
            if total_sup else "No suppliers imported yet"
        ),
        "missing_data_types": missing_fields[:3] if missing_fields else [],
    }

    # 4. Historical memory depth
    memory = storage.get_memory_store(5000)
    stage2 = [m for m in memory if m.get("stage") == 2]
    memory_q = min(90, len(stage2) * 25 + 15) if memory else 20
    sources["historical_memory"] = {
        "label": "Swarm Memory (history)",
        "quality_score": memory_q,
        "status": "available" if memory_q >= 60 else "limited",
        "detail": f"{len(memory)} records · {len(stage2)} resolved outcomes",
    }

    # 5. LLM inference
    llm_live = config.is_real_llm()
    llm_q = 88 if llm_live else 55
    sources["llm_inference"] = {
        "label": "LLM Inference (GitHub Models)",
        "quality_score": llm_q,
        "status": "available" if llm_live else "degraded",
        "detail": "live model" if llm_live else "demo-mode synthetic responses",
    }

    overall = round(sum(s["quality_score"] for s in sources.values()) / len(sources))
    if overall >= 75:
        level, desc = "HIGH", "Recommendations are well-supported by available data."
    elif overall >= 55:
        level, desc = "MEDIUM", "Recommendations should be verified; some sources are limited."
    else:
        level, desc = "LOW", "Critical data sources are missing; use recommendations with caution."

    warnings = [f"{s['label']} is {s['status']} — {s['detail']}."
                for s in sources.values() if s["quality_score"] < 55]
    if not warnings:
        warnings = ["All critical data sources are available."]

    return {
        "agent": "Data Quality Monitor",
        "overall_quality_score": overall,
        "confidence_level": level,
        "confidence_description": desc,
        "sources": sources,
        "warnings": warnings,
        "timestamp_utc": _now_utc(),
    }


# ════════════════════════════════════════════════════════════════════════════
# FEATURE 4 — SUPPLIER COMMUNICATION DRAFTER
# Generates a professional supplier message for a chosen action option.
# Human reviews + sends manually — nothing is dispatched automatically.
# ════════════════════════════════════════════════════════════════════════════

async def supplier_communication_agent(event: dict, option: dict) -> dict:
    """Draft a professional supplier email for a selected action option."""
    action_type = (option.get("action_type") or "").lower()
    supplier_name = option.get("supplier_name") or "Supplier Partner"
    geography = event.get("geography", "the affected region")
    description = event.get("description", "a supply chain disruption")
    severity = event.get("severity_score", "N/A")

    if "air" in action_type or "freight" in action_type:
        msg_type = "Expedited Shipment Request"
        subject = f"Urgent — expedited shipment request ({geography} disruption)"
    elif "defer" in action_type or "delay" in action_type:
        msg_type = "Delivery Deferral Request"
        subject = f"Request to adjust delivery schedule ({geography})"
    elif "buffer" in action_type or "stock" in action_type:
        msg_type = "Buffer Stock Activation"
        subject = f"Buffer stock activation notice ({geography})"
    else:
        msg_type = "Alternate Sourcing Request"
        subject = f"Order adjustment request ({geography} disruption)"

    # Deterministic professional template — always available as fallback
    template_body = (
        f"Dear {supplier_name} Team,\n\n"
        f"We are writing regarding {description} affecting {geography} "
        f"(assessed severity {severity}/10). Our supply chain response team has "
        f"identified the following action involving your organisation:\n\n"
        f"  - {option.get('action_type')}\n"
        f"  - Indicative quantity: {option.get('quantity', 'to be confirmed')}\n"
        f"  - Urgency: {option.get('urgency_tier', 'Standard')}\n\n"
        f"Please confirm the following so we can finalise planning:\n"
        f"  1. Your ability to support this adjustment.\n"
        f"  2. Realistic timelines and any revised delivery dates.\n"
        f"  3. Any additional cost, handling or capacity considerations.\n\n"
        f"This is a temporary measure to manage the current disruption. We value "
        f"our partnership and will coordinate logistics on our side. Kindly respond "
        f"by end of business today.\n\n"
        f"Best regards,\n"
        f"DisruptIQ Supply Chain Response Team"
    )

    body = await llm.chat_text(
        system=("You are drafting a professional, concise B2B supplier email for a "
                "procurement team. Courteous, specific, under 180 words. "
                "Return only the email body text — no subject line."),
        user=(f"Disruption: {description} in {geography} (severity {severity}/10).\n"
              f"Action involving supplier {supplier_name}: {option.get('action_type')}.\n"
              f"Urgency: {option.get('urgency_tier')}. Quantity: {option.get('quantity')}.\n"
              f"Draft the supplier email body."),
        max_tokens=400,
        fallback=template_body,
    )

    return {
        "agent": "Supplier Communication Drafter",
        "message_type": msg_type,
        "recipient": supplier_name,
        "subject": subject,
        "body": body,
        "option_rank": option.get("rank"),
        "channel_suggestions": ["Email", "Supplier portal", "Phone follow-up"],
        "disclaimer": "Draft only — review and send manually. DisruptIQ never contacts suppliers automatically.",
        "generated_at_utc": _now_utc(),
    }


# ════════════════════════════════════════════════════════════════════════════
# FEATURE 6 — SUPPLIER DEPENDENCY MAPPER
# Category x Zone concentration heatmap — exposes single points of failure.
# Deterministic — reuses SUPPLIERS data. No LLM.
# ════════════════════════════════════════════════════════════════════════════

def supplier_dependency_agent(client_id: str = None, suppliers: list = None) -> dict:
    """Build a category x zone dependency heatmap for a specific client.

    `suppliers` should be passed by the caller (resolved from clients_db). It is
    only resolved from seed data when not supplied, to avoid leaking demo data
    into real authenticated clients.
    """
    if not client_id:
        client_id = config.ACTIVE_CLIENT_ID
    if suppliers is None:
        from seed_data import get_suppliers_for_client
        suppliers = get_suppliers_for_client(client_id)

    categories = sorted({c for s in suppliers for c in s.get("categories", [])})
    zones = sorted({s["zone"] for s in suppliers})

    def capacity_weight(s: dict) -> float:
        """Capacity proxy — more sites / reliability / buffer = higher weight."""
        return round(s["sites"] * (s["reliability"] / 100) * (1 + s["buffer_stock_days"] / 30), 2)

    # Aggregate (category, zone) cells
    cat_zone: dict = {}
    for s in suppliers:
        w = capacity_weight(s)
        for cat in s.get("categories", []):
            entry = cat_zone.setdefault((cat, s["zone"]),
                                        {"count": 0, "score": 0.0, "suppliers": []})
            entry["count"] += 1
            entry["score"] = round(entry["score"] + w, 2)
            entry["suppliers"].append(s["name"])
    cells = [
        {"category": cat, "zone": zone, "supplier_count": e["count"],
         "dependency_score": e["score"], "suppliers": e["suppliers"]}
        for (cat, zone), e in cat_zone.items()
    ]

    # Concentration risk per category
    concentration_risks = []
    single_source = []
    for cat in categories:
        cat_cells = [c for c in cells if c["category"] == cat]
        if not cat_cells:
            continue
        total = sum(c["supplier_count"] for c in cat_cells)
        dominant = max(cat_cells, key=lambda c: c["supplier_count"])
        share = round(dominant["supplier_count"] / total * 100, 1) if total else 0.0
        if total == 1:
            single_source.append(cat)
        risk_level = ("critical" if total == 1 or share >= 75
                      else "high" if share >= 50
                      else "moderate" if share >= 35
                      else "low")
        concentration_risks.append({
            "category": cat,
            "dominant_zone": dominant["zone"],
            "share_pct": share,
            "total_suppliers": total,
            "zones_covered": len({c["zone"] for c in cat_cells}),
            "risk_level": risk_level,
        })
    concentration_risks.sort(key=lambda r: r["share_pct"], reverse=True)

    return {
        "agent": "Dependency Mapper",
        "client_id": client_id,
        "categories": categories,
        "zones": zones,
        "cells": cells,
        "max_dependency_score": max((c["dependency_score"] for c in cells), default=1),
        "concentration_risks": concentration_risks,
        "single_source_categories": single_source,
        "summary": {
            "total_suppliers": len(suppliers),
            "total_categories": len(categories),
            "total_zones": len(zones),
            "single_source_count": len(single_source),
            "high_concentration_count": sum(
                1 for r in concentration_risks if r["risk_level"] in ("critical", "high")),
        },
        "timestamp_utc": _now_utc(),
    }


# ════════════════════════════════════════════════════════════════════════════
# DISRUPTION PREDICTION AGENT — proactive daily risk briefing (D1 innovation)
# Dynamic per client: scores 0–100 from real news + weather + supplier health.
# Returns empty / score=0 for clients with no suppliers (no demo leak).
# ════════════════════════════════════════════════════════════════════════════

def _fetch_zone_news_count(zone: str) -> int:
    """Count recent in-memory news alerts for a zone (already polled by main.py).

    Avoids a fresh NewsAPI call per zone — main.py's poll loops keep a 24h
    rolling buffer in ``_recent_alerts``. This walks that list using the
    callback wired by ``set_news_emit_callback``.
    """
    items = get_latest_news_articles()
    if not items or not zone:
        return 0
    zone_low = zone.lower()
    return sum(1 for a in items
               if zone_low in (a.get("location", "") or "").lower()
               or zone_low in (a.get("title", "") or "").lower())


def _fetch_zone_weather_severity(zone: str) -> int:
    """Return the latest known severity (0–10) for ``zone`` from the weather snapshot."""
    snapshot = get_current_weather_snapshot()
    if not snapshot:
        return 0
    # snapshot is keyed by city name.
    rec = snapshot.get(zone)
    if not rec and zone:
        for city_name, city_rec in snapshot.items():
            if city_name.lower() == zone.lower():
                rec = city_rec
                break
    return int(rec.get("severity_score", 0)) if rec else 0


async def predict_disruption_risk(client_id: str, client_suppliers: list[dict]) -> dict:
    """Compute a 0–100 disruption-risk briefing for one client.

    Inputs:
      - client_id  — used for audit only; isolation is enforced by the caller
                     passing only this client's suppliers.
      - client_suppliers — THIS client's uploaded suppliers. Empty list ⇒ no risk
        signal; we return ``score=0`` and a "no suppliers" message.

    The score weights:
      - 40 % news volume (rolling 24h, only zones the client occupies)
      - 35 % worst weather severity across client zones
      - 25 % supplier reliability (lower reliability → higher residual risk)

    Per-zone breakdown is included so the UI can render a daily briefing card.
    """
    if not client_suppliers:
        return {
            "score": 0,
            "tier": "none",
            "message": "No suppliers uploaded yet. Upload your supplier list to receive a daily risk briefing.",
            "zones": [],
            "timestamp_utc": _now_utc(),
        }

    zones = sorted({s.get("zone", "") for s in client_suppliers if s.get("zone")})
    zone_breakdowns = []
    for zone in zones:
        zone_suppliers = [s for s in client_suppliers if s.get("zone") == zone]
        news_count = _fetch_zone_news_count(zone)
        weather_sev = _fetch_zone_weather_severity(zone)
        avg_reliability = (
            sum(s.get("reliability", 100) for s in zone_suppliers) / len(zone_suppliers)
            if zone_suppliers else 100.0
        )
        z_score = min(100, int(
            news_count * 3
            + weather_sev * 4
            + max(0, 100 - avg_reliability) * 0.5
        ))
        zone_breakdowns.append({
            "zone": zone,
            "score": z_score,
            "tier": ("high" if z_score >= 60 else "medium" if z_score >= 30 else "low"),
            "suppliers_at_risk": len(zone_suppliers),
            "news_mentions_24h": news_count,
            "weather_severity": weather_sev,
            "avg_reliability_pct": round(avg_reliability, 1),
        })

    if zone_breakdowns:
        total_news = sum(z["news_mentions_24h"] for z in zone_breakdowns)
        max_weather = max((z["weather_severity"] for z in zone_breakdowns), default=0)
        weakest_reliability = min(
            (s.get("reliability", 100) for s in client_suppliers),
            default=100,
        )
        overall = min(100, int(
            (total_news * 2) * 0.4
            + (max_weather * 10) * 0.35
            + max(0, 100 - weakest_reliability) * 0.25
        ))
    else:
        overall = 0

    tier = "high" if overall >= 60 else "medium" if overall >= 30 else "low"

    return {
        "score": overall,
        "tier": tier,
        "message": (
            f"Daily disruption risk: {overall}/100 ({tier.upper()}). "
            f"{len(zones)} zone(s) monitored across {len(client_suppliers)} supplier(s)."
        ),
        "zones": zone_breakdowns,
        "timestamp_utc": _now_utc(),
    }
