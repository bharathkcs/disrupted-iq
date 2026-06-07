"""DisruptIQ V2 - Main FastAPI server + Socket.IO live swarm feed."""

import asyncio
from contextlib import asynccontextmanager
import csv
import io
import json
import math
import statistics
import time
import hashlib
import secrets
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
import logging

from fastapi import FastAPI, HTTPException, Query, Depends, Header, UploadFile, File, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
import socketio
from pydantic import BaseModel, EmailStr
from models import (
    EventTrigger, HILDecision, NLQuery, Resolution, Acknowledgement,
    ConfigUpdate, SupplierUpdate, SupplierMessageRequest,
    SignupRequest, LoginRequest, ImportSuppliersRequest,
    UpdateProfileRequest, UpdateCompanyRequest, VerifyResetTokenRequest,
    ChangePasswordRequest, ForgotPasswordRequest, ResetPasswordRequest,
    AccountResetRequest, DeleteAccountRequest, NotificationReadRequest,
    NotificationSettingsRequest, SupplierInput, BulkDeleteRequest,
    ScenarioCreate, FeedbackRequest, SupportRequest, SupportResponseRequest,
)
import jwt
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

try:
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Mail, Email
    SENDGRID_AVAILABLE = True
except ImportError:
    SENDGRID_AVAILABLE = False

import agents
import auth
import benchmarks
import briefing_history
import config
import email_service
import llm
import monitor_daemon
import storage
from seed_data import (
    DEMO_SCENARIOS, SUPPLIERS, CASCADE_ZONE_MAP, ZONE_COORDINATES,
    LOGISTICS_HUBS, zone_coordinates, get_suppliers_for_client,
)

logger = logging.getLogger("disruptiq.main")

# Telemetry logger (Application Insights integration removed; kept for backward compatibility)
_telemetry_logger = None
_tracer = None


class _TTLStore:
    """Dependency-free TTL key->value store with lazy eviction and a hard size cap.

    Keeps in-memory collections bounded (no external cache library required).
    Values must be non-None (None is reserved for "absent").
    """

    def __init__(self, ttl_seconds: int, max_size: int = 50_000):
        self._ttl = ttl_seconds
        self._max = max_size
        self._data: dict = {}

    def _evict(self) -> None:
        now = time.time()
        for k in [key for key, (_, exp) in self._data.items() if exp <= now]:
            self._data.pop(k, None)
        if len(self._data) > self._max:
            overflow = sorted(self._data.items(), key=lambda kv: kv[1][1])[: len(self._data) - self._max]
            for k, _ in overflow:
                self._data.pop(k, None)

    def get(self, key, default=None):
        item = self._data.get(key)
        if item is None:
            return default
        value, exp = item
        if exp <= time.time():
            self._data.pop(key, None)
            return default
        return value

    def set(self, key, value) -> None:
        self._data[key] = (value, time.time() + self._ttl)
        self._evict()

    def __contains__(self, key) -> bool:
        return self.get(key, None) is not None

    def __len__(self) -> int:
        return len(self._data)


def _log_telemetry(event: str, properties: dict = None, metrics: dict = None):
    """Log event telemetry to Application Insights (non-blocking)."""
    if not _telemetry_logger:
        return
    try:
        props_str = f" | {' | '.join(f'{k}={v}' for k, v in (properties or {}).items())}" if properties else ""
        metrics_str = f" | {' | '.join(f'{k}={v}' for k, v in (metrics or {}).items())}" if metrics else ""
        _telemetry_logger.info(f"{event}{props_str}{metrics_str}")
    except Exception:
        pass


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_utc(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def _mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 2) if values else 0.0


def _percent(part: int, whole: int) -> float:
    return round((part / whole) * 100, 2) if whole else 0.0


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    index = (len(ordered) - 1) * percentile
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return round(ordered[int(index)], 2)
    weight = index - lower
    value = ordered[lower] * (1 - weight) + ordered[upper] * weight
    return round(value, 2)


def _iso_after(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")


import os as _os

_LOCAL_STATE_FILE = _os.path.join(_os.path.dirname(__file__), "local_state.json")


def _save_local_state() -> None:
    """Persist users_db and clients_db to disk so data survives backend restarts.

    users_db and clients_db are never written to Cosmos — they live only in
    this process's memory. Always write to disk regardless of Cosmos health so
    that accounts survive backend restarts.
    """
    try:
        payload = {
            "users_db": {k: {f: v for f, v in u.items() if f != "password_hash"} for k, u in users_db.items()},
            "users_db_full": users_db,
            "clients_db": clients_db,
            "custom_scenarios_db": custom_scenarios_db,
            "sessions_db": sessions_db,
            "self_deletions_db": self_deletions_db,
            "premium_requests_db": premium_requests_db,
        }
        tmp = _LOCAL_STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, default=str)
        _os.replace(tmp, _LOCAL_STATE_FILE)
    except Exception as exc:
        logger.warning("_save_local_state failed: %s", exc)


def _load_local_state() -> None:
    """Load persisted state from disk into the in-memory dicts on startup."""
    if not _os.path.exists(_LOCAL_STATE_FILE):
        return
    try:
        with open(_LOCAL_STATE_FILE, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        users_db.update(payload.get("users_db_full", {}))
        clients_db.update(payload.get("clients_db", {}))
        custom_scenarios_db.update(payload.get("custom_scenarios_db", {}))
        sessions_db.update(payload.get("sessions_db", {}))
        # self_deletions_db and premium_requests_db loaded in _startup_load_admin_stores
        logger.info("Loaded local state: %d users, %d clients", len(users_db), len(clients_db))
    except Exception as exc:
        logger.warning("_load_local_state failed (starting fresh): %s", exc)


def _token_payload_from_header(authorization: Optional[str]) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.replace("Bearer ", "", 1).strip()
    if not token:
        return None
    try:
        return auth.verify_jwt_token(token, expected_type="access")
    except HTTPException:
        return None


api_rate_limiter: dict[str, list[float]] = {}
_api_rate_limiter_lock = asyncio.Lock()


async def _check_client_api_rate_limit(client_id: str) -> tuple[bool, int]:
    async with _api_rate_limiter_lock:
        now = time.time()
        window_seconds = 60
        attempts = [ts for ts in api_rate_limiter.get(client_id, []) if now - ts < window_seconds]
        if len(attempts) >= config.API_RATE_LIMIT_PER_MINUTE:
            api_rate_limiter[client_id] = attempts
            retry_after = max(1, int(window_seconds - (now - attempts[0])))
            return False, retry_after
        attempts.append(now)
        api_rate_limiter[client_id] = attempts
        if len(api_rate_limiter) > 50_000:
            for cid in [c for c, ts in list(api_rate_limiter.items()) if not ts]:
                api_rate_limiter.pop(cid, None)
        return True, 0


def _event_timestamp(event: dict) -> str:
    return (
        event.get("last_updated_utc")
        or event.get("monitor", {}).get("timestamp_utc")
        or event.get("simulation", {}).get("simulation_run_timestamp_utc")
        or _now_utc()
    )


def _filter_events(
    events: list[dict],
    source: Optional[str] = None,
    geography: Optional[str] = None,
    severity_min: Optional[int] = None,
    severity_max: Optional[int] = None,
    date_from: Optional[str] = None,
) -> list[dict]:
    filtered = []
    for event in events:
        monitor = event.get("monitor", {})
        if source and (monitor.get("source") or "").lower() != source.lower():
            continue
        if geography and geography.lower() not in (monitor.get("geography", "") or "").lower():
            continue
        severity = monitor.get("severity_score", 0)
        if severity_min is not None and severity < severity_min:
            continue
        if severity_max is not None and severity > severity_max:
            continue
        if date_from:
            ts = _parse_utc(_event_timestamp(event))
            date_floor = datetime.fromisoformat(f"{date_from}T00:00:00+00:00")
            if not ts or ts < date_floor:
                continue
        filtered.append(event)
    return sorted(filtered, key=lambda item: _event_timestamp(item), reverse=True)


# ════════════════════════════════════════════════════════════════════════════
# SECTION 2: REAL-TIME NEWS & WEATHER POLLING (Infrastructure)
# ════════════════════════════════════════════════════════════════════════════

# Global state for alerts and polling. TTL stores keep dedup sets bounded so the
# process can run for weeks without leaking memory on every URL/alert ever seen.
_processed_news_urls = _TTLStore(ttl_seconds=86_400, max_size=10_000)      # 24h
_processed_weather_alerts = _TTLStore(ttl_seconds=3_600, max_size=2_000)   # 1h
_recent_alerts: list = []  # max 50 items, newest first
_city_weather: dict = {}  # keyed by city name

# Idempotency for event triggers (24h) and per-client daily swarm quota (rolls at UTC midnight).
_idempotency_cache = _TTLStore(ttl_seconds=86_400, max_size=10_000)
_daily_swarm_counts = _TTLStore(ttl_seconds=172_800, max_size=10_000)
FREE_TIER_DAILY_SWARM_LIMIT = int(config.__dict__.get("FREE_TIER_DAILY_SWARM_LIMIT", 25))

# Monitored cities for Open-Meteo polling — India + key global supply-chain hubs
MONITORED_CITIES = [
    # India
    {"name": "Chennai",       "lat": 13.08,  "lon":  80.27},
    {"name": "Mumbai",        "lat": 19.07,  "lon":  72.87},
    {"name": "Kolkata",       "lat": 22.57,  "lon":  88.36},
    {"name": "Bengaluru",     "lat": 12.97,  "lon":  77.59},
    {"name": "Pune",          "lat": 18.52,  "lon":  73.85},
    {"name": "Delhi",         "lat": 28.61,  "lon":  77.20},
    {"name": "Ahmedabad",     "lat": 23.03,  "lon":  72.58},
    {"name": "Kochi",         "lat":  9.93,  "lon":  76.26},
    {"name": "Hyderabad",     "lat": 17.38,  "lon":  78.49},
    # Europe
    {"name": "Rotterdam",     "lat": 51.92,  "lon":   4.48},
    {"name": "London",        "lat": 51.51,  "lon":  -0.13},
    {"name": "Frankfurt",     "lat": 50.11,  "lon":   8.68},
    {"name": "Hamburg",       "lat": 53.55,  "lon":   9.99},
    {"name": "Amsterdam",     "lat": 52.37,  "lon":   4.90},
    # Asia-Pacific
    {"name": "Singapore",     "lat":  1.35,  "lon": 103.82},
    {"name": "Shanghai",      "lat": 31.23,  "lon": 121.47},
    {"name": "Tokyo",         "lat": 35.68,  "lon": 139.69},
    {"name": "Taipei",        "lat": 25.03,  "lon": 121.56},
    {"name": "Seoul",         "lat": 37.57,  "lon": 126.98},
    {"name": "Bangkok",       "lat": 13.75,  "lon": 100.52},
    {"name": "Hong Kong",     "lat": 22.32,  "lon": 114.17},
    {"name": "Shenzhen",      "lat": 22.54,  "lon": 114.06},
    {"name": "Guangzhou",     "lat": 23.13,  "lon": 113.27},
    # Middle East
    {"name": "Dubai",         "lat": 25.20,  "lon":  55.27},
    {"name": "Jeddah",        "lat": 21.49,  "lon":  39.19},
    # Americas
    {"name": "Mexico City",   "lat": 19.43,  "lon": -99.13},
    {"name": "Los Angeles",   "lat": 34.05,  "lon":-118.24},
    {"name": "New York",      "lat": 40.71,  "lon": -74.01},
    {"name": "Chicago",       "lat": 41.88,  "lon": -87.63},
    {"name": "Sao Paulo",      "lat": -23.55, "lon": -46.63},
    # Additional key hubs
    {"name": "Beijing",        "lat":  39.91, "lon": 116.39},
    {"name": "Kuala Lumpur",   "lat":   3.14, "lon": 101.69},
    {"name": "Jakarta",        "lat":  -6.21, "lon": 106.85},
    {"name": "Mumbai",         "lat":  19.07, "lon":  72.87},
    {"name": "Colombo",        "lat":   6.93, "lon":  79.85},
    {"name": "Busan",          "lat":  35.18, "lon": 129.08},
]

# All known zones — kept in sync with ZONE_COORDINATES in seed_data.py
VALID_ZONES = list(ZONE_COORDINATES.keys())

# Geocoding cache: raw zone string → {"lat": float, "lon": float}
# Populated at runtime by Nominatim for zones not in ZONE_COORDINATES.
_geocode_cache: dict = {}

INDIAN_CITIES_MAP = {
    "Chennai": "Chennai", "Mumbai": "Mumbai", "Pune": "Pune",
    "Bengaluru": "Bengaluru", "Delhi": "Delhi", "Tamil Nadu": "Tamil Nadu",
    "Maharashtra": "Maharashtra", "Gujarat": "Gujarat", "Kolkata": "Kolkata",
    "Hyderabad": "Hyderabad", "Kochi": "Kochi", "Ahmedabad": "Ahmedabad",
    "Karnataka": "Bengaluru", "Kerala": "Kochi", "West Bengal": "Kolkata",
}

def _wmo_code_to_description(code: int) -> str:
    """Convert WMO weather code to human description."""
    if code >= 95: return "Thunderstorm"
    if code >= 80: return "Heavy Rain Showers"
    if code >= 71: return "Snow / Sleet"
    if code >= 61: return "Heavy Rain"
    if code >= 51: return "Drizzle / Light Rain"
    if code >= 45: return "Fog"
    if code >= 1:  return "Clear / Partly Cloudy"
    return "Clear Sky"

def _compute_weather_severity(code: int, wind_kmh: float, precip_mm: float) -> int:
    """Compute severity from WMO code, wind, and precipitation."""
    base = 0
    if code >= 95:   base = 7
    elif code >= 80: base = 6
    elif code >= 71: base = 5
    elif code >= 61: base = 5
    elif code >= 51: base = 3
    else:            base = 1

    if wind_kmh > 80:    base += 2
    elif wind_kmh > 50:  base += 1
    if precip_mm > 100:  base += 2
    elif precip_mm > 50: base += 1

    return min(base, 10)

def _detect_location(text: str) -> Optional[str]:
    """Detect Indian location from text."""
    text_lower = text.lower()
    for city, canonical in INDIAN_CITIES_MAP.items():
        if city.lower() in text_lower:
            return canonical
    return None

async def _dispatch_auto_monitor_signal(article_or_alert: dict, signal_type: str) -> None:
    """Section 1: Proactive auto-monitor dispatcher.

    Called from inside the news / weather polling loops once per new item.
    For every client whose supplier zones intersect the signal, this:
      1. Re-scores the signal against that client's zones + industry
      2. Checks the per-client threshold and cooldown
      3. If the gate opens, fires ``run_swarm`` as a background task and
         posts an in-app notification + Socket.IO push to that client only.

    Critically tenant-isolated: each iteration only touches one client's
    suppliers and rooms. A real client never sees a signal triggered by
    another client's data, and the demo client never auto-fires off real
    client traffic.

    Soft-fails on every per-client error so one broken tenant cannot stall
    the polling loop for everyone.
    """
    if not clients_db:
        return

    for client_id, client_data in list(clients_db.items()):
        try:
            if client_data.get("suspended") or client_data.get("deleted_at"):
                continue
            client_suppliers = _resolve_suppliers(client_id)
            if not client_suppliers:
                continue
            client_zones = sorted({
                (s.get("zone") or "").strip()
                for s in client_suppliers if s.get("zone")
            })
            if not client_zones:
                continue
            if not client_data.get("auto_trigger_enabled", True):
                continue

            client_industry = client_data.get("industry", "")
            threshold = float(client_data.get("auto_trigger_threshold", 7.0))
            cooldown_h = int(client_data.get("auto_trigger_cooldown_hours", 6))

            if signal_type == "news":
                signal = monitor_daemon.score_news_article(
                    article_or_alert, client_zones, client_industry,
                )
            else:
                signal = monitor_daemon.score_weather_alert(
                    article_or_alert, client_zones,
                )
            if signal is None:
                continue

            if not monitor_daemon.should_auto_trigger(
                client_id, signal["zone"], signal["severity"],
                client_threshold=threshold, cooldown_hours=cooldown_h,
            ):
                continue

            monitor_daemon.record_auto_trigger(client_id, signal["zone"])
            event_type = monitor_daemon.classify_event_type(
                signal.get("matched_keywords") or [], signal_type=signal_type,
            )
            trigger = EventTrigger(
                description=signal["headline"][:280] or "Auto-detected disruption",
                location=signal["zone"],
                source=f"auto_monitor:{signal_type}",
                type=event_type,
                geography=signal["zone"],
                event_type=event_type,
                severity_score=signal["severity"],
                demo_mode=(client_id in SEED_CLIENT_IDS),
            )

            logger.info(
                "Auto-trigger: client=%s zone=%s severity=%s type=%s source=%s",
                client_id, signal["zone"], signal["severity"], event_type, signal["source"],
            )
            storage.write_audit(
                "SYSTEM", "AutoMonitor", "auto_swarm_triggered",
                f"client={client_id} zone={signal['zone']}",
                f"severity={signal['severity']} type={event_type} src={signal['source']}",
                client_id=client_id,
            )

            asyncio.create_task(_run_auto_triggered_swarm(trigger, client_id, signal))
        except Exception as exc:
            logger.warning("Auto-monitor dispatch failed for client=%s: %s", client_id, exc)


async def _run_auto_triggered_swarm(trigger, client_id: str, signal: dict) -> None:
    """Background task that runs the swarm for an auto-triggered event and
    pushes a one-time in-app notification + Socket.IO event to the owning
    client. Errors are logged, not raised, so a failure doesn't kill the
    polling task that scheduled this coroutine."""
    try:
        result = await run_swarm(trigger, client_id=client_id)
        event_id = (result or {}).get("event_id") or ""
        # Per-client Socket.IO push so the dashboard can surface a banner
        await sio.emit(
            "auto_disruption_detected",
            {
                "event_id": event_id,
                "zone": signal["zone"],
                "severity": signal["severity"],
                "headline": signal["headline"],
                "source": signal["source"],
                "signal_type": signal["signal_type"],
                "url": signal.get("url", ""),
                "message": (
                    f"DisruptIQ auto-detected a potential disruption in {signal['zone']}. "
                    f"Swarm analysis started automatically."
                ),
                "timestamp_utc": _now_utc(),
            },
            room=f"client_{client_id}",
        )
        _create_notification(
            client_id,
            "auto_disruption",
            f"Auto-detected: {signal['zone']}",
            signal["headline"][:280],
            f"/dashboard/{client_id}",
        )
    except Exception as exc:
        logger.warning(
            "Auto-triggered swarm failed for client=%s zone=%s: %s",
            client_id, signal.get("zone"), exc,
        )


async def poll_newsapi():
    """Poll NewsAPI for supply chain disruption news (BR-001)."""
    import httpx

    newsapi_key = config.NEWSAPI_KEY
    if not newsapi_key or newsapi_key.startswith("PLACEHOLDER"):
        return

    url = "https://newsapi.org/v2/everything"
    params = {
        "q": "supply chain disruption OR port closure OR cyclone OR strike OR factory shutdown India",
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 20,
        "apiKey": newsapi_key,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, params=params)
            data = r.json()
            articles = data.get("articles", [])
    except Exception as e:
        logger.warning("[NewsAPI] Poll error: %s", e)
        return

    for article in articles:
        url_key = article.get("url", "")
        if url_key in _processed_news_urls:
            continue
        _processed_news_urls.set(url_key, True)

        title = article.get("title", "")
        description = article.get("description", "")
        text = (title + " " + description).lower()

        detected_location = _detect_location(text)
        severity = agents.compute_severity(title + " " + description, detected_location or "")

        alert = {
            "title": title,
            "description": description[:200],
            "source": article.get("source", {}).get("name", "NewsAPI"),
            "published_at": article.get("publishedAt", ""),
            "url": url_key,
            "location": detected_location,
            "severity": severity,
            "alert_type": "NewsAPI",
            "timestamp_utc": _now_utc(),
        }

        _recent_alerts.insert(0, alert)
        if len(_recent_alerts) > 50:
            _recent_alerts.pop()

        if severity >= 6 and detected_location:
            logger.info("[NewsAPI] Alert: %s... (sev %s) — %s", title[:60], severity, detected_location)

        # Section 1: Proactive auto-monitor — fan this article out per-client
        # and let each tenant's configured threshold decide whether to fire.
        # Cheap pre-filter: only attempt dispatch if the article carries any
        # disruption keyword at all (cuts ~70% of news noise before per-client work).
        if any(kw in text for kw in monitor_daemon.DISRUPTION_KEYWORDS):
            try:
                await _dispatch_auto_monitor_signal(article, "news")
            except Exception as exc:
                logger.warning("[NewsAPI] auto-monitor dispatch error: %s", exc)

async def poll_open_meteo():
    """Poll Open-Meteo for weather data (BR-001)."""
    import httpx

    for city in MONITORED_CITIES:
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": city["lat"],
                "longitude": city["lon"],
                "daily": "weathercode,precipitation_sum,windspeed_10m_max",
                "timezone": "Asia/Kolkata",
                "forecast_days": 3,
            }

            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                try:
                    data = r.json()
                except Exception as json_err:
                    logger.warning("[Open-Meteo] JSON parse error for %s: %s", city['name'], json_err)
                    continue

            daily = data.get("daily", {})
            if not daily:
                continue

            codes = daily.get("weathercode", [0])
            precips = daily.get("precipitation_sum", [0])
            winds = daily.get("windspeed_10m_max", [0])
            dates = daily.get("time", [""])

            # Use worst day in next 3 days
            worst_idx = 0
            worst_sev = 0
            for i, code in enumerate(codes[:3]):
                sev = _compute_weather_severity(
                    code,
                    winds[i] if i < len(winds) else 0,
                    precips[i] if i < len(precips) else 0,
                )
                if sev > worst_sev:
                    worst_sev = sev
                    worst_idx = i

            code = codes[worst_idx]
            wind = winds[worst_idx] if worst_idx < len(winds) else 0
            precip = precips[worst_idx] if worst_idx < len(precips) else 0
            date_str = dates[worst_idx] if worst_idx < len(dates) else ""

            severity = _compute_weather_severity(code, wind, precip)
            alert_status = "warning" if severity >= 7 else "watch" if severity >= 5 else "clear"

            weather_record = {
                "name": city["name"],
                "lat": city["lat"],
                "lon": city["lon"],
                "weathercode": code,
                "weather_description": _wmo_code_to_description(code),
                "wind_kmh": round(wind, 1),
                "precip_mm_24h": round(precip, 1),
                "severity_score": severity,
                "alert_status": alert_status,
                "forecast_date": date_str,
                "last_updated_utc": _now_utc(),
            }
            _city_weather[city["name"]] = weather_record

            # Alert if severity >= 5 and we haven't alerted for this city+date
            alert_key = f"{city['name']}-{date_str}"
            if severity >= 5 and alert_key not in _processed_weather_alerts:
                _processed_weather_alerts.set(alert_key, True)
                alert = {
                    "title": f"Weather Alert: {_wmo_code_to_description(code)} forecast for {city['name']}",
                    "description": f"Wind {round(wind, 1)} km/h, precipitation {round(precip, 1)}mm expected on {date_str}.",
                    "source": "Open-Meteo",
                    "published_at": _now_utc(),
                    "location": city["name"],
                    "severity": severity,
                    "alert_type": "Open-Meteo",
                    "timestamp_utc": _now_utc(),
                }
                _recent_alerts.insert(0, alert)
                if len(_recent_alerts) > 50:
                    _recent_alerts.pop()

                if severity >= 6:
                    logger.info("[Weather] Alert: %s — %s (sev %s)", city['name'], _wmo_code_to_description(code), severity)

                # Section 1: Proactive auto-monitor — only dispatch when the
                # weather signal is genuinely meaningful (sev >= 5). The
                # per-client threshold check inside the dispatcher will still
                # gate downstream swarm fires; this is just a cheap pre-filter.
                if severity >= 5:
                    try:
                        await _dispatch_auto_monitor_signal(weather_record, "weather")
                    except Exception as exc:
                        logger.warning("[Weather] auto-monitor dispatch error: %s", exc)

        except Exception as e:
            logger.warning("[Open-Meteo] Error for %s: %s: %s", city['name'], type(e).__name__, e)

async def news_polling_loop():
    """Background task: poll NewsAPI every 5 minutes."""
    while True:
        try:
            await poll_newsapi()
        except Exception as e:
            logger.warning("[NewsAPI] Loop error: %s", e)
        await asyncio.sleep(300)  # 5 minutes

async def weather_polling_loop():
    """Background task: poll Open-Meteo every 10 minutes."""
    while True:
        try:
            await poll_open_meteo()
        except Exception as e:
            logger.warning("[Weather] Loop error: %s", e)
        await asyncio.sleep(600)  # 10 minutes


_weekly_digest_last_sent: dict[str, str] = {}
_daily_briefing_last_run: dict[str, str] = {}  # per-client date string


async def daily_briefing_loop():
    """Section 7 Sprint: persist a daily disruption-risk snapshot per client.

    Runs once per hour but only persists once per UTC day per client. Skipping
    the demo seed client - they don't need history.
    """
    while True:
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for client_id, client in list(clients_db.items()):
                if client_id in SEED_CLIENT_IDS:
                    continue
                if _daily_briefing_last_run.get(client_id) == today:
                    continue
                if client.get("suspended") or client.get("deleted_at"):
                    continue
                suppliers = _resolve_suppliers(client_id)
                if not suppliers:
                    continue
                try:
                    briefing = await agents.predict_disruption_risk(client_id, suppliers)
                    briefing["supplier_count"] = len(suppliers)
                    briefing_history.append_briefing(client_id, briefing)
                    _daily_briefing_last_run[client_id] = today
                except Exception as inner:
                    logger.warning(
                        "daily_briefing_loop failed for client=%s: %s", client_id, inner,
                    )
        except Exception as exc:
            logger.error("daily_briefing_loop top-level error: %s", exc, exc_info=True)
        await asyncio.sleep(3600)  # check every hour, persist at most once/day


async def weekly_digest_loop():
    """Send a lightweight weekly digest every Monday morning IST for opted-in clients."""
    while True:
        try:
            now_ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
            if now_ist.weekday() == 0 and now_ist.hour >= 9 and clients_db:
                today_key = now_ist.strftime("%Y-%m-%d")
                for client_id, client in list(clients_db.items()):
                    # One bad client must not abort the whole batch.
                    try:
                        if client_id in SEED_CLIENT_IDS:
                            continue
                        settings = client.get("settings", {}).get("notifications", {})
                        if not settings.get("weekly_digest"):
                            continue
                        owner_email = client.get("owner_email")
                        if not owner_email or _weekly_digest_last_sent.get(client_id) == today_key:
                            continue
                        summary = {
                            "period": "last 7 days",
                            "total_events": _event_count_for_client(client_id),
                        }
                        if email_service.send_weekly_digest_email(owner_email, client.get("company_name", "DisruptIQ Client"), summary):
                            _weekly_digest_last_sent[client_id] = today_key
                    except Exception as inner:
                        logger.error("Weekly digest failed for client %s: %s", client_id, inner)
        except Exception as e:
            logger.error("Weekly digest loop error: %s", e, exc_info=True)
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    global news_polling_task, openmeteo_polling_task, weekly_digest_task, daily_briefing_task, _tracer, _telemetry_logger, premium_requests_db
    # Wire the live sessions_db into auth so require_auth can do JTI revocation
    # checks without a circular import.  Must run before any request is served.
    auth.set_sessions_store(sessions_db)
    _load_local_state()
    agents.set_news_emit_callback(_emit_news_alert)
    # Section 8 Sprint - load cross-industry benchmark dataset into memory.
    # Soft-fails on missing/bad files; never blocks startup.
    try:
        benchmarks.load_benchmarks()
    except Exception as exc:
        logger.warning("[Benchmarks] startup load failed: %s", exc)

    # Initialize Application Insights
    if news_polling_task is None or news_polling_task.done():
        news_polling_task = asyncio.create_task(news_polling_loop())

    if openmeteo_polling_task is None or openmeteo_polling_task.done():
        openmeteo_polling_task = asyncio.create_task(weather_polling_loop())

    if weekly_digest_task is None or weekly_digest_task.done():
        weekly_digest_task = asyncio.create_task(weekly_digest_loop())

    # Section 7 Sprint - daily disruption-risk briefing snapshot per client
    if daily_briefing_task is None or daily_briefing_task.done():
        daily_briefing_task = asyncio.create_task(daily_briefing_loop())

    await poll_open_meteo()

    # Reload persisted admin stores (premium requests, support tickets, feedback)
    try:
        loaded = storage.get_premium_requests()
        if loaded:
            premium_requests_db.clear()
            premium_requests_db.extend(loaded)
        for t in storage.get_support_tickets():
            cid = t.get("client_id")
            if cid and t not in support_db[cid]:
                support_db[cid].append(t)
        for r in storage.get_feedback_records():
            cid = r.get("client_id")
            if cid and r not in feedback_db[cid]:
                feedback_db[cid].append(r)
    except Exception as e:
        logger.warning("Admin store reload failed: %s", e)

    try:
        yield
    finally:
        for task in [news_polling_task, openmeteo_polling_task, weekly_digest_task, daily_briefing_task]:
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        news_polling_task = None
        openmeteo_polling_task = None
        weekly_digest_task = None
        daily_briefing_task = None


# Email service
def send_registration_email(email: str, company_name: str, client_id: str,
                            registration_time: str, industry: str = "",
                            contact_name: str = "") -> bool:
    """Send the welcome email to a new registrant. Delegates to email_service.

    Returns True if sent (or console-logged), False on failure.
    """
    return email_service.send_welcome_email(
        email=email,
        company_name=company_name,
        client_id=client_id,
        industry=industry,
        contact_name=contact_name,
        created_at=registration_time,
    )


fastapi_app = FastAPI(
    title="DisruptIQ",
    version="2.0.0",
    description="Multi-agent supply chain disruption response system",
    lifespan=lifespan,
)
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=config.CORS_ORIGINS)
app = socketio.ASGIApp(sio, fastapi_app)

# Register domain routers (Phase 4 — route splitting; see routes/*.py).
# Each router currently exposes /health for mount verification; production
# handlers are being incrementally migrated from main.py.
from routes.report_routes import report_router
from routes.admin_routes import admin_router, account_router
from routes.supplier_routes import supplier_router
from routes.events_routes import events_router, chaos_router
from routes.auth_routes import auth_router
from routes.dashboard_routes import dashboard_router
from routes.account_routes import (
    notifications_router, account_settings_router, feedback_router,
)
from routes.misc_routes import misc_router
from routes.monitor_routes import monitor_router
fastapi_app.include_router(report_router)
fastapi_app.include_router(admin_router)
fastapi_app.include_router(account_router)
fastapi_app.include_router(supplier_router)
fastapi_app.include_router(events_router)
fastapi_app.include_router(chaos_router)
fastapi_app.include_router(auth_router)
fastapi_app.include_router(dashboard_router)
fastapi_app.include_router(notifications_router)
fastapi_app.include_router(account_settings_router)
fastapi_app.include_router(feedback_router)
fastapi_app.include_router(misc_router)
fastapi_app.include_router(monitor_router)


swarm_states: dict[str, dict[str, dict]] = {}
news_polling_task: asyncio.Task | None = None
openmeteo_polling_task: asyncio.Task | None = None
weekly_digest_task: asyncio.Task | None = None
daily_briefing_task: asyncio.Task | None = None


@fastapi_app.middleware("http")
async def api_gateway_auth_middleware(request, call_next):
    """
    API Gateway Pattern: Extract JWT from Authorization header or httpOnly cookie.
    Verify JWT once, attach authenticated user to request.state for all downstream handlers.
    """
    from http.cookies import SimpleCookie

    request.state.current_user = None
    token = None

    # 1. Try Authorization header first (for API clients)
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()

    # 2. Fall back to httpOnly cookie (for web clients)
    if not token:
        cookie_header = request.headers.get("cookie", "")
        if cookie_header:
            try:
                cookies = SimpleCookie()
                cookies.load(cookie_header)
                if "auth_token" in cookies:
                    token = cookies["auth_token"].value
            except Exception:
                pass

    # 3. Verify token if found
    if token:
        try:
            payload = auth.verify_jwt_token(token, expected_type="access")
            if payload:
                # Check if session is revoked
                jti = payload.get("jti")
                if jti and hasattr(fastapi_app.state, 'sessions_db'):
                    sessions_db = fastapi_app.state.sessions_db
                    if jti not in sessions_db:
                        payload = None
                if payload:
                    request.state.current_user = payload
                    # Enforce account suspension — block all API calls except logout/me/health
                    cid = payload.get("client_id", "")
                    path = request.url.path
                    _exempt = {"/health", "/api/auth/logout", "/api/auth/logout-all", "/api/auth/me"}
                    if path not in _exempt and clients_db.get(cid, {}).get("suspended"):
                        return JSONResponse(
                            status_code=403,
                            content={
                                "detail": "ACCOUNT_SUSPENDED",
                                "message": "Your account has been suspended. Please contact kcsbadp@gmail.com to reactivate your account.",
                            }
                        )
        except Exception:
            pass

    # 4. Fall back to X-Demo-Session header so /demo (unauthenticated) can hit
    # endpoints that use require_auth (reports, supply-chain-map, chaos-mode).
    # Only accepts the known seed client IDs; arbitrary values map to "demo".
    if request.state.current_user is None:
        demo_session = request.headers.get("x-demo-session", "").strip()
        if demo_session:
            if demo_session != "demo":
                demo_session = "demo"
            request.state.current_user = {
                "client_id": demo_session,
                "email": f"{demo_session}@disruptiq.dev",
                "company_name": "Demo",
            }

    response = await call_next(request)
    return response


@fastapi_app.middleware("http")
async def add_security_headers(request, call_next):
    """Add security headers: CSP, HSTS, X-Frame-Options, etc."""
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "font-src 'self'; "
        "connect-src 'self' https://models.inference.ai.azure.com https://api.newsapi.org api.open-meteo.com; "
        "base-uri 'self'; "
        "frame-ancestors 'none';"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if config.APP_BASE_URL.startswith("https://"):
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    return response


@fastapi_app.middleware("http")
async def client_api_rate_limit(request, call_next):
    if request.url.path.startswith("/api/auth/"):
        return await call_next(request)
    payload = _token_payload_from_header(request.headers.get("authorization"))
    client_id = payload.get("client_id") if payload else None
    if client_id:
        allowed, retry_after = await _check_client_api_rate_limit(client_id)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please retry shortly."},
                headers={"Retry-After": str(retry_after)},
            )
    return await call_next(request)



@sio.event
async def connect(sid, environ, auth_data=None):
    """Place each socket in a per-client room so swarm updates never cross tenants.

    A real tenant's room can only be joined with a valid JWT. The X-Demo-Session
    header is honoured ONLY for the known seed clients — it can never be used to
    join an arbitrary real tenant's room (that was a cross-tenant data leak).
    """
    client_id = None
    token = (auth_data or {}).get("token") if isinstance(auth_data, dict) else None

    if token:
        try:
            payload = auth.verify_jwt_token(token, expected_type="access")
            client_id = payload.get("client_id")
        except Exception as exc:
            logger.warning("[socketio] JWT verification failed sid=%s: %s", sid, exc)
            client_id = None

    if not client_id:
        headers = dict(environ.get("asgi.scope", {}).get("headers", []))
        demo_session = headers.get(b"x-demo-session", b"").decode("utf-8")
        if demo_session in SEED_CLIENT_IDS:
            client_id = demo_session
        elif demo_session:
            # A non-seed id here means someone is trying to snoop a real tenant
            # without a JWT. Refuse the requested room; fall back to public demo.
            logger.warning(
                "[socketio] Rejected non-seed X-Demo-Session '%s' sid=%s", demo_session, sid
            )
            client_id = "demo"
        else:
            client_id = "demo"

    await sio.enter_room(sid, f"client_{client_id}")
    await sio.save_session(sid, {"client_id": client_id})
    await sio.emit("connected", {"sid": sid, "ts": time.time(), "client_id": client_id}, to=sid)
    logger.info("[socketio] Connected sid=%s -> room=client_%s", sid, client_id)


def _client_for_event(event_id: str) -> str | None:
    """Find which client owns an event_id by scanning the partitioned swarm_states."""
    for cid, events in swarm_states.items():
        if event_id in events:
            return cid
    return None


async def emit_update(event_id: str, agent: str, status: str,
                      payload: dict | None = None, client_id: str | None = None):
    """Emit a swarm update to the owning client's Socket.IO room only.

    `client_id` may be passed explicitly; otherwise it is resolved from
    swarm_states. If the owner cannot be determined the update is DROPPED — never
    broadcast globally — so swarm payloads can never leak across tenants.
    """
    message = {
        "event_id": event_id,
        "agent": agent,
        "status": status,
        "payload": payload or {},
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "client_id": client_id,
    }
    target_client = client_id or _client_for_event(event_id)
    if target_client:
        message["client_id"] = target_client
        await sio.emit("swarm_update", message, room=f"client_{target_client}")
    else:
        logger.warning(
            "emit_update dropped: no client_id for event_id=%s agent=%s status=%s",
            event_id, agent, status,
        )


async def _emit_news_alert(article: dict, monitor: dict):
    # Do not broadcast news alerts globally to avoid cross-tenant data leakage.
    # News alerts are available via GET /api/news/latest endpoint for authenticated clients.
    # Future: implement per-client news filtering or authenticated news room.
    pass

async def run_swarm(trigger: EventTrigger, client_id: str = "demo") -> dict:
    swarm_start_time = time.time()
    monitor_duration = 0.0
    memory_duration = 0.0
    forecast_duration = 0.0
    risk_duration = 0.0
    action_duration = 0.0
    validator_duration = 0.0
    simulation_duration = 0.0

    # Resolve this client's own suppliers so the swarm scores the client's
    # network, never the demo seed data.
    client_suppliers = _resolve_suppliers(client_id)

    await emit_update("pending", "MonitorAgent", "activating", client_id=client_id)
    monitor_start = time.time()
    monitor = await agents.monitor_agent(trigger.dict())
    monitor_duration = round(time.time() - monitor_start, 2)
    eid = monitor["event_id"]

    state = {
        "event_id": eid,
        "client_id": client_id,
        "monitor": monitor,
        "acknowledgements": {},
        "status": "monitor_complete",
    }
    if client_id not in swarm_states:
        swarm_states[client_id] = {}
    swarm_states[client_id][eid] = state
    storage.save_event(eid, state)
    await emit_update(eid, "MonitorAgent", "complete", {
        "severity_score": monitor["severity_score"],
        "escalate": monitor["escalate"],
        "cascade_flag": monitor["cascade_flag"],
        "geography": monitor["geography"],
    })
    client_profile = _ensure_client_defaults(client_id)
    owner_email = client_profile.get("owner_email")
    _no_email = client_id in SEED_CLIENT_IDS or trigger.demo_mode
    # Get notification settings for this client
    client_settings = clients_db.get(client_id, {})
    notifications_enabled = client_settings.get("settings", {}).get("notifications", {}).get("severe_disruption_email", True)
    # Send email if severity >= 6, notifications enabled, and not a seed/demo client
    if owner_email and monitor.get("severity_score", 0) >= 6 and not _no_email and notifications_enabled:
        email_service.send_disruption_alert_email(
            owner_email,
            client_profile.get("company_name", "DisruptIQ Client"),
            {
                "client_id": client_id,
                "event_type": monitor.get("event_type"),
                "geography": monitor.get("geography"),
                "severity_score": monitor.get("severity_score"),
                "timestamp_utc": monitor.get("timestamp_utc"),
                "source": monitor.get("source"),
                "at_risk_suppliers": [],
            },
        )
    _create_notification(
        client_id,
        "disruption_alert",
        f"{monitor.get('event_type', 'Disruption')} detected",
        f"{monitor.get('geography', 'Unknown location')} severity {monitor.get('severity_score', 0)}/10.",
        f"/dashboard/{client_id}",
    )

    if not monitor["escalate"]:
        total_duration = round(time.time() - swarm_start_time, 2)
        state["status"] = "below_threshold"
        storage.record_pipeline_metric(eid, {
            "total_duration_seconds": total_duration,
            "sla_met": total_duration <= 90,
            "monitor_duration": monitor_duration,
            "memory_duration": memory_duration,
            "forecast_duration": forecast_duration,
            "risk_duration": risk_duration,
            "action_duration": action_duration,
            "validator_duration": validator_duration,
            "simulation_duration": simulation_duration,
            "validator_reruns": 0,
            "memory_recalls": 0,
            "dissent_detected": False,
            "cascade_detected": False,
            "severity": monitor.get("severity_score"),
            "geography": monitor.get("geography"),
            "escalated": monitor.get("escalate", False),
            "news_source": monitor.get("source", "Manual"),
        })
        _log_telemetry(
            "event_below_threshold",
            properties={
                "event_id": eid,
                "severity": monitor.get("severity_score"),
                "geography": monitor.get("geography"),
            },
            metrics={"total_duration_seconds": total_duration}
        )
        await emit_update(eid, "Orchestrator", "below_threshold", {"severity": monitor["severity_score"]})
        storage.save_event(eid, state)
        return state

    storage.add_active_event(monitor)

    memory_start = time.time()
    await emit_update(eid, "SwarmMemory", "recalling")
    memory_context = storage.recall_memory(monitor["geography"], [s["id"] for s in client_suppliers], client_id=client_id)
    memory_duration = round(time.time() - memory_start, 2)
    state["memory_recalls"] = memory_context
    state["memory_context"] = memory_context
    storage.save_event(eid, state)
    await emit_update(eid, "SwarmMemory", "complete", {
        "recalls_found": len(memory_context),
        "memories": [{
            "memory_id": m.get("memory_id"),
            "event_type": m.get("event_type"),
            "geography": m.get("geography"),
            "actual_outcome": m.get("actual_outcome"),
        } for m in memory_context[:3]],
    })

    cascade_task = None
    if monitor["cascade_flag"] and monitor.get("cascade_partner_event"):
        await emit_update(eid, "CascadeDetectionAgent", "activating")
        cascade_task = asyncio.create_task(agents.cascade_detection_agent(monitor, monitor["cascade_partner_event"], client_suppliers))

    await emit_update(eid, "ForecastAgent", "activating")
    await emit_update(eid, "RiskAgent", "activating")
    forecast_start = time.time()
    risk_start = forecast_start
    forecast_out, risk_out = await asyncio.gather(
        agents.forecast_agent(monitor, memory_context, client_suppliers),
        agents.risk_agent(monitor, memory_context, client_suppliers),
    )
    parallel_duration = round(time.time() - forecast_start, 2)
    forecast_duration = parallel_duration
    risk_duration = parallel_duration
    state["forecast"] = forecast_out
    state["risk"] = risk_out
    storage.save_event(eid, state)
    await emit_update(eid, "ForecastAgent", "complete", {
        "categories": len(forecast_out.get("affected_categories", [])),
        "memory_calibration": forecast_out.get("memory_calibration_applied"),
        "top_shift": (forecast_out.get("affected_categories", [{}])[0].get("demand_shift_pct", 0)
                      if forecast_out.get("affected_categories") else 0),
    })
    await emit_update(eid, "RiskAgent", "complete", {
        "scored": risk_out.get("total_scored"),
        "critical": risk_out.get("critical_count"),
        "content_safety_passed": risk_out.get("content_safety_passed"),
    })

    if cascade_task:
        cascade_out = await cascade_task
        state["cascade_alert"] = cascade_out
        storage.save_event(eid, state)
        await emit_update(eid, "CascadeDetectionAgent", "complete", {
            "combined_severity": cascade_out["combined_severity_score"],
            "cascade_type": cascade_out["cascade_type"],
        })

    divergence = agents.compute_divergence(forecast_out, risk_out)
    state["divergence"] = divergence
    storage.save_event(eid, state)
    if divergence["dissent_detected"]:
        await emit_update(eid, "Orchestrator", "dissent_detected", {
            "divergence_score": divergence["divergence_score"],
            "description": divergence["dissent_description"],
        })

    await emit_update(eid, "ActionAgent", "activating")
    action_start = time.time()
    action_out = await agents.action_agent(monitor, forecast_out, risk_out)
    action_duration = round(time.time() - action_start, 2)
    state["action"] = action_out
    storage.save_event(eid, state)
    await emit_update(eid, "ActionAgent", "complete", {"options": len(action_out.get("options", []))})

    await emit_update(eid, "ValidatorAgent", "activating")
    validator_start = time.time()
    validator_out = await agents.validator_agent(monitor, forecast_out, risk_out, action_out, divergence)
    validator_duration = round(time.time() - validator_start, 2)
    state["validator"] = validator_out
    storage.save_event(eid, state)
    await emit_update(eid, "ValidatorAgent", "complete", {
        "status": validator_out["status"],
        "pass": validator_out["pass"],
        "dissent_noted": validator_out.get("dissent_detected"),
    })

    rerun_count = 0
    max_reruns = config.MAX_VALIDATOR_RERUNS
    while not validator_out["pass"] and rerun_count < max_reruns:
        rerun_count += 1
        await emit_update(eid, "Orchestrator", "rerun_initiated", {
            "attempt": rerun_count,
            "contradictions": validator_out["contradictions"],
        })
        storage.write_audit(
            eid,
            "Orchestrator",
            f"validator_rerun_{rerun_count}",
            str(validator_out["contradictions"]),
            f"attempt {rerun_count} of {max_reruns}",
        )
        if "Critical-tier supplier" in str(validator_out["contradictions"]) or "3 options" in str(validator_out["contradictions"]):
            action_start = time.time()
            action_out = await agents.action_agent(monitor, forecast_out, risk_out)
            action_duration += round(time.time() - action_start, 2)
            state["action"] = action_out
        validator_start = time.time()
        validator_out = await agents.validator_agent(monitor, forecast_out, risk_out, action_out, divergence)
        validator_duration += round(time.time() - validator_start, 2)
        state["validator"] = validator_out
        storage.save_event(eid, state)

    if not validator_out["pass"] and rerun_count >= max_reruns:
        total_duration = round(time.time() - swarm_start_time, 2)
        state["status"] = "escalated_to_human"
        state["rerun_exhausted"] = True
        state["rerun_count"] = rerun_count
        storage.record_pipeline_metric(eid, {
            "total_duration_seconds": total_duration,
            "sla_met": total_duration <= 90,
            "monitor_duration": monitor_duration,
            "memory_duration": memory_duration,
            "forecast_duration": forecast_duration,
            "risk_duration": risk_duration,
            "action_duration": round(action_duration, 2),
            "validator_duration": round(validator_duration, 2),
            "simulation_duration": 0,
            "validator_reruns": rerun_count,
            "memory_recalls": len(memory_context),
            "dissent_detected": divergence.get("dissent_detected", False),
            "cascade_detected": bool(state.get("cascade_alert")),
            "severity": monitor.get("severity_score"),
            "geography": monitor.get("geography"),
            "escalated": monitor.get("escalate", False),
            "news_source": monitor.get("source", "Manual"),
        })
        await emit_update(eid, "Orchestrator", "max_reruns_exhausted", {
            "reruns": rerun_count,
            "final_status": "escalated",
        })
        storage.save_event(eid, state)
        return state

    state["rerun_count"] = rerun_count

    await emit_update(eid, "SimulationAgent", "activating")
    sim_start = time.time()
    try:
        sim_out = await asyncio.wait_for(
            agents.simulation_agent(monitor, action_out, memory_context),
            timeout=config.SIMULATION_SLA_SECONDS,
        )
        sim_out["sla_breached"] = False
        sim_out["duration_seconds"] = round(time.time() - sim_start, 2)
        sim_out["sla_met"] = True
    except asyncio.TimeoutError:
        sim_out = {
            "simulations": [],
            "sla_breached": True,
            "sla_breach_requires_ack": True,
            "duration_seconds": config.SIMULATION_SLA_SECONDS,
            "sla_met": False,
            "simulation_run_timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        await emit_update(eid, "SimulationAgent", "sla_breached", {"timeout": config.SIMULATION_SLA_SECONDS})
        storage.write_audit(
            eid,
            "SimulationAgent",
            "sla_breach",
            f"timeout after {config.SIMULATION_SLA_SECONDS}s",
            "HIL can proceed with explicit acknowledgement",
        )
    simulation_duration = sim_out.get("duration_seconds", 0)
    state["simulation"] = sim_out
    if sim_out.get("sla_breached"):
        state["sla_breach_ack_required"] = True
    storage.save_event(eid, state)
    await emit_update(eid, "SimulationAgent", "complete", {
        "simulations": len(sim_out.get("simulations", [])),
        "duration_seconds": sim_out.get("duration_seconds", 0),
        "sla_met": sim_out.get("sla_met", False),
        "sla_breached": sim_out.get("sla_breached", False),
    })

    supplier_scores_summary = [
        {"supplier_id": s["supplier_id"], "score": s["composite_score"], "tier": s["risk_tier"]}
        for s in risk_out.get("suppliers", [])[:5]
    ]
    top_shift = (
        forecast_out.get("affected_categories", [{}])[0].get("demand_shift_pct", 0)
        if forecast_out.get("affected_categories") else 0
    )
    storage.write_memory_stage1(
        eid,
        monitor["geography"],
        supplier_scores_summary,
        top_shift,
        monitor["event_type"],
        "pending",
        supplier_ids=[s["supplier_id"] for s in risk_out.get("suppliers", [])],
        action_options=action_out.get("options", []),
        monitor=monitor,
        client_id=client_id,
    )

    total_duration = round(time.time() - swarm_start_time, 2)
    storage.record_pipeline_metric(eid, {
        "total_duration_seconds": total_duration,
        "sla_met": total_duration <= 90,
        "monitor_duration": monitor_duration,
        "memory_duration": memory_duration,
        "forecast_duration": forecast_duration,
        "risk_duration": risk_duration,
        "action_duration": round(action_duration, 2),
        "validator_duration": round(validator_duration, 2),
        "simulation_duration": sim_out.get("duration_seconds", 0),
        "validator_reruns": state.get("rerun_count", 0),
        "memory_recalls": len(memory_context),
        "dissent_detected": divergence.get("dissent_detected", False),
        "cascade_detected": bool(state.get("cascade_alert")),
        "severity": monitor.get("severity_score"),
        "geography": monitor.get("geography"),
        "escalated": monitor.get("escalate", False),
        "news_source": monitor.get("source", "Manual"),
    })

    state["status"] = "awaiting_hil"
    storage.save_event(eid, state)
    await emit_update(eid, "Orchestrator", "hil_ready", {"simulation_complete": True})
    _mark_onboarding_step(client_id, "first_scenario", True)
    _create_notification(
        client_id,
        "analysis_complete",
        "Analysis complete",
        f"Swarm analysis is ready for event {eid}. Review options and confirm an action.",
        f"/dashboard/{client_id}",
    )
    if owner_email and not _no_email:
        email_service.send_analysis_complete_email(
            owner_email,
            client_profile.get("company_name", "DisruptIQ Client"),
            {
                "client_id": client_id,
                "event_type": monitor.get("event_type"),
                "geography": monitor.get("geography"),
                "severity": monitor.get("severity_score"),
                "supplier_count": len(risk_out.get("suppliers", [])),
                "duration_seconds": total_duration,
                "status": "Action Required",
                "top_recommendation": (action_out.get("options") or [{}])[0],
            },
        )

    # Log telemetry to Application Insights
    _log_telemetry(
        "swarm_complete",
        properties={
            "event_id": eid,
            "geography": monitor.get("geography"),
            "severity": monitor.get("severity_score"),
            "dissent_detected": divergence.get("dissent_detected", False),
            "cascade_detected": bool(state.get("cascade_alert")),
        },
        metrics={
            "total_duration_seconds": total_duration,
            "sla_met": 1 if total_duration <= 90 else 0,
            "monitor": monitor_duration,
            "memory": memory_duration,
            "forecast": forecast_duration,
            "risk": risk_duration,
            "action": action_duration,
            "validator": validator_duration,
            "simulation": simulation_duration,
            "memories": len(memory_context),
            "reruns": state.get("rerun_count", 0),
        }
    )

    return state


def _config_payload() -> dict:
    return {
        "demo_mode": config.DEMO_MODE,
        "thresholds": {
            "severity": config.SEVERITY_THRESHOLD,
            "dissent_divergence": config.DISSENT_DIVERGENCE_THRESHOLD,
            "cascade_window_hours": config.CASCADE_WINDOW_HOURS,
            "cascade_overlap_multiplier": config.CASCADE_OVERLAP_MULTIPLIER,
            "simulation_sla_seconds": config.SIMULATION_SLA_SECONDS,
            "max_validator_reruns": config.MAX_VALIDATOR_RERUNS,
            "minimum_severity_to_alert": config.MINIMUM_SEVERITY_TO_ALERT,
        },
        "polling": {
            "newsapi_poll_interval_minutes": config.NEWSAPI_POLL_INTERVAL_MINUTES,
            "openmeteo_poll_interval_minutes": config.OPENMETEO_POLL_INTERVAL_MINUTES,
        },
        "services": config.status_summary(),
        "runtime": config.runtime_config_snapshot(),
    }




# /health + /api/config* moved to routes/misc_routes.py (Gap 4 split).


# /api/events/* + /api/demo/chaos-mode moved to routes/events_routes.py (Gap 4 split).


# /api/audit-log* + /api/registrations moved to routes/misc_routes.py (Gap 4 split).


# ════════════════════════════════════════════════════════════════════════════
# ADMIN CONSOLE (owner-only). Every route is gated by auth.require_admin, which
# returns 404 for non-owners so the console's existence stays hidden from users.
# ════════════════════════════════════════════════════════════════════════════

def _admin_company_name(client_id: str | None) -> str:
    if not client_id:
        return "—"
    return (clients_db.get(client_id) or {}).get("company_name") or client_id


def _admin_owner_email(client_id: str) -> str | None:
    return next((em for em, u in users_db.items() if u.get("client_id") == client_id), None)


# /api/admin/overview..reactivate moved to routes/admin_routes.py (Gap 4 split).


# /api/account/request-premium moved to routes/admin_routes.py (Gap 4 split).


# /api/admin/premium-requests..feedback moved to routes/admin_routes.py (Gap 4 split).


# /api/admin/users/.../revoke-premium..grant-premium..support/respond moved to routes/admin_routes.py (Gap 4 split).


DELETE_GRACE_HOURS = 48


def _hard_delete_client(client_id: str) -> None:
    """Permanently remove an account and its data. Used after the 48h grace window."""
    global premium_requests_db
    clients_db.pop(client_id, None)
    for em in [e for e, u in users_db.items() if u.get("client_id") == client_id]:
        users_db.pop(em, None)
    notifications_db.pop(client_id, None)
    custom_scenarios_db.pop(client_id, None)
    feedback_db.pop(client_id, None)
    support_db.pop(client_id, None)
    storage.delete_feedback_for_client(client_id)
    storage.delete_support_tickets_for_client(client_id)
    storage.delete_premium_requests_for_client(client_id)
    for jti in [j for j, s in list(sessions_db.items()) if s.get("client_id") == client_id]:
        sessions_db.pop(jti, None)
    premium_requests_db = [r for r in premium_requests_db if r.get("client_id") != client_id]
    _save_local_state()


def _purge_expired_deletions() -> None:
    """Lazily hard-delete soft-deleted accounts whose 48h grace window has lapsed."""
    now = datetime.now(timezone.utc)
    for cid in [c for c, v in clients_db.items() if v.get("deleted_at")]:
        exp = _parse_utc(clients_db[cid].get("deleted_expires_at"))
        if exp and now >= exp:
            _hard_delete_client(cid)


# /api/admin/users/.../delete..deleted-accounts..self-deletions moved to routes/admin_routes.py (Gap 4 split).


# /api/memory + /api/counterfactuals + /api/config/history + /api/nl-queries + /api/clients* moved to routes/misc_routes.py (Gap 4 split).


# ============ AUTHENTICATION HELPERS ============
users_db = {}  # { email: { password_hash, salt, client_id, company_name, industry, created_at } }
clients_db = {}  # { client_id: { company_name, industry, suppliers: [...], created_at } }
password_reset_tokens = {}  # { token: { email, created_at, expires_at } } — 1 hour expiry
notifications_db = defaultdict(list)  # { client_id: [notification] }
account_deletion_tokens = {}  # { token: { email, client_id, expires_at } }
sessions_db = {}  # { jti: { jti, email, client_id, browser, device, ip, issued_at, remember_me } }
custom_scenarios_db = {}  # { client_id: [scenario] } (Feature 3)
feedback_db = defaultdict(list)  # { client_id: [{ rating, comment, created_at }] }
support_db = defaultdict(list)  # { client_id: [{ ticket_id, category, priority, description, created_at }] }
premium_requests_db = []  # [{ id, client_id, company_name, email, status, requested_at, decided_at, decided_by }]
self_deletions_db = []  # [{ client_id, company_name, email, reason, reason_label, deleted_at, supplier_count, event_count, was_premium }]


def _supplier_limit(client_id: str | None) -> int:
    """Per-account supplier cap. Premium (owner-granted) lifts the free limit."""
    if client_id and (clients_db.get(client_id) or {}).get("premium"):
        return config.PREMIUM_SUPPLIER_LIMIT
    return config.FREE_SUPPLIER_LIMIT



# Seed clients are the only client_ids allowed to read from seed supplier data.
# Any other client_id is a real registered client and must NOT see demo data.
SEED_CLIENT_IDS = {"demo"}

INDUSTRY_NEWS_KEYWORDS = {
    "Automotive": ["automotive", "semiconductor", "ev", "vehicle", "steel", "car", "manufacturing"],
    "Electronics": ["semiconductor", "chip", "electronics", "pcb", "display", "ics"],
    "Manufacturing": ["manufacturing", "factory", "raw material", "steel", "energy", "supply chain"],
    "Pharmaceutical": ["pharma", "drug", "api", "medicine", "fda", "chemical", "healthcare"],
    "FMCG": ["fmcg", "food", "beverage", "consumer goods", "retail", "packaging"],
    "Logistics": ["logistics", "freight", "shipping", "port", "trucking", "cargo", "transport"],
}

DEFAULT_NOTIFICATION_SETTINGS = {
    "disruption_detected": True,
    "analysis_complete": True,
    "weekly_digest": False,
    "security_alerts": True,
    "account_updates": True,
    "severe_disruption_email": True,
}
ONBOARDING_STEPS = [
    {"id": "account_created", "label": "Account created", "action_url": "/signup-register"},
    {"id": "suppliers_imported", "label": "Suppliers imported", "action_url": "/signup-register"},
    {"id": "first_scenario", "label": "Run your first scenario", "action_url": "/dashboard"},
    {"id": "map_viewed", "label": "View supply chain map", "action_url": "/map"},
    {"id": "score_checked", "label": "Check resilience score", "action_url": "/dashboard"},
    {"id": "first_resolved", "label": "Resolve a disruption", "action_url": "/history"},
]
CITY_TO_ZONE = {
    "Chennai": "Chennai",
    "Mumbai": "Mumbai",
    "Kolkata": "Kolkata",
    "Bengaluru": "Bengaluru",
    "Pune": "Pune",
    "Delhi": "Delhi",
    "Ahmedabad": "Ahmedabad",
    "Kochi": "Kochi",
}

SCENARIO_TEMPLATES = [
    {"id": "tpl_earthquake_supplier", "name": "Earthquake — Supplier Zone", "description": "Seismic event disrupts supplier production facilities", "location": "Bengaluru", "type": "Geopolitical", "severity": 9, "tags": ["earthquake", "structural"], "is_template": True},
    {"id": "tpl_monsoon_flooding", "name": "Monsoon Flooding", "description": "Heavy monsoon rains cause road blockages and logistics delays", "location": "Chennai", "type": "Cyclone", "severity": 7, "tags": ["monsoon", "flood"], "is_template": True},
    {"id": "tpl_port_strike", "name": "Port Worker Strike", "description": "Dock workers strike halts container movement at ports", "location": "Mumbai", "type": "Strike", "severity": 7, "tags": ["port", "strike"], "is_template": True},
    {"id": "tpl_regulatory_ban", "name": "Regulatory Import Ban", "description": "Sudden government import restriction on key components", "location": "Delhi", "type": "Geopolitical", "severity": 8, "tags": ["regulatory"], "is_template": True},
    {"id": "tpl_semiconductor_shortage", "name": "Semiconductor Shortage", "description": "Global chip shortage impacts electronics supply chain", "location": "Bengaluru", "type": "Port", "severity": 6, "tags": ["semiconductor", "electronics"], "is_template": True},
    {"id": "tpl_power_grid_failure", "name": "Power Grid Failure", "description": "Statewide power outage halts manufacturing", "location": "Tamil Nadu", "type": "Power", "severity": 7, "tags": ["power", "outage"], "is_template": True},
    {"id": "tpl_eu_port_strike", "name": "EU Port Strike — Rotterdam shutdown", "description": "Coordinated port-worker strike halts container handling across Rotterdam.", "location": "Rotterdam", "type": "Strike", "severity": 8, "tags": ["port", "strike", "europe"], "is_template": True},
    {"id": "tpl_taiwan_strait", "name": "Taiwan Strait — semiconductor supply shock", "description": "Shipping disruption in the Taiwan Strait chokes semiconductor exports from Taipei and Shanghai.", "location": "Taipei", "type": "Geopolitical", "severity": 9, "tags": ["semiconductor", "geopolitical", "asia"], "is_template": True},
    {"id": "tpl_shanghai_lockdown", "name": "Shanghai Industrial Lockdown", "description": "Regulatory lockdown across Shanghai industrial districts freezes EV battery and PCB suppliers.", "location": "Shanghai", "type": "Regulatory Shutdown", "severity": 8, "tags": ["regulatory", "china"], "is_template": True},
]

INDUSTRY_SCENARIO_MAP = {
    "Automotive": [
        {"name": "Semiconductor Chip Shortage", "description": "Global chip shortage halts vehicle production lines", "location": "Bengaluru", "type": "Port", "severity": 8, "tags": ["semiconductor", "automotive"]},
        {"name": "Steel Price Surge", "description": "Steel price spike increases manufacturing cost 30%", "location": "Mumbai", "type": "Geopolitical", "severity": 6, "tags": ["steel", "cost"]},
        {"name": "EV Battery Supplier Delay", "description": "Key EV battery supplier faces 6-week production delay", "location": "Pune", "type": "Strike", "severity": 7, "tags": ["ev", "battery"]},
        {"name": "Logistics Route Disruption", "description": "NH44 highway blocked — critical parts delayed 2 weeks", "location": "Chennai", "type": "Cyclone", "severity": 7, "tags": ["logistics", "route"]},
        {"name": "Tier-2 Supplier Insolvency", "description": "Tier-2 supplier faces sudden insolvency during peak season", "location": "Delhi", "type": "Custom", "severity": 9, "tags": ["insolvency", "supplier"]},
    ],
    "Electronics": [
        {"name": "Taiwan Fab Lockdown", "description": "Major semiconductor fab temporarily closes due to contamination", "location": "Bengaluru", "type": "Port", "severity": 9, "tags": ["semiconductor", "fab"]},
        {"name": "PCB Supply Shortage", "description": "PCB manufacturers report 40% capacity reduction", "location": "Pune", "type": "Strike", "severity": 7, "tags": ["pcb", "electronics"]},
        {"name": "Display Panel Price Spike", "description": "LCD display panel costs jump 25% due to supply constraints", "location": "Chennai", "type": "Geopolitical", "severity": 6, "tags": ["display", "cost"]},
        {"name": "Logistics Port Congestion", "description": "Port congestion delays component shipments by 3 weeks", "location": "Mumbai", "type": "Port", "severity": 8, "tags": ["logistics", "port"]},
        {"name": "Component Counterfeiting Ring", "description": "Counterfeit components discovered in supply chain", "location": "Delhi", "type": "Custom", "severity": 9, "tags": ["quality", "counterfeiting"]},
    ],
    "Manufacturing": [
        {"name": "Raw Material Supply Cut", "description": "Key raw material supplier reduces exports by 50%", "location": "Mumbai", "type": "Geopolitical", "severity": 8, "tags": ["raw material", "supply"]},
        {"name": "Factory Power Outage", "description": "Regional power grid failure affects factory operations", "location": "Ahmedabad", "type": "Power", "severity": 7, "tags": ["power", "outage"]},
        {"name": "Logistics Fuel Crisis", "description": "Fuel shortage disrupts transportation logistics", "location": "Delhi", "type": "Cyclone", "severity": 6, "tags": ["fuel", "logistics"]},
        {"name": "Worker Strike Action", "description": "Major factory worker strike halts production", "location": "Pune", "type": "Strike", "severity": 8, "tags": ["strike", "labor"]},
        {"name": "Equipment Supplier Bankruptcy", "description": "Critical equipment supplier declares bankruptcy", "location": "Kolkata", "type": "Custom", "severity": 9, "tags": ["equipment", "supplier"]},
    ],
    "Pharmaceutical": [
        {"name": "API Production Halt", "description": "Active Pharmaceutical Ingredient (API) supplier halts production", "location": "Bengaluru", "type": "Geopolitical", "severity": 9, "tags": ["api", "pharma"]},
        {"name": "FDA Compliance Issue", "description": "FDA enforcement action affects supplier certifications", "location": "Delhi", "type": "Custom", "severity": 8, "tags": ["fda", "compliance"]},
        {"name": "Cold Chain Disruption", "description": "Cold chain logistics breakdown during distribution", "location": "Mumbai", "type": "Port", "severity": 8, "tags": ["logistics", "cold-chain"]},
        {"name": "Raw Chemical Price Surge", "description": "Crude oil spike increases raw chemical costs 40%", "location": "Chennai", "type": "Geopolitical", "severity": 6, "tags": ["chemicals", "cost"]},
        {"name": "Quality Assurance Audit Failure", "description": "Supplier fails critical quality audit, loses certification", "location": "Pune", "type": "Custom", "severity": 9, "tags": ["quality", "audit"]},
    ],
    "FMCG": [
        {"name": "Agricultural Commodity Shortage", "description": "Poor harvest reduces agricultural commodity availability 35%", "location": "Punjab", "type": "Cyclone", "severity": 7, "tags": ["agricultural", "commodity"]},
        {"name": "Packaging Material Shortage", "description": "Packaging material supplier hits production limits", "location": "Mumbai", "type": "Strike", "severity": 7, "tags": ["packaging", "materials"]},
        {"name": "Port Container Shortage", "description": "Global container shortage delays exports by 2 weeks", "location": "Chennai", "type": "Port", "severity": 6, "tags": ["port", "containers"]},
        {"name": "Retailer Demand Spike", "description": "Unexpected retailer demand surge strains inventory", "location": "Delhi", "type": "Custom", "severity": 5, "tags": ["demand", "retail"]},
        {"name": "Quality Recall Incident", "description": "Product quality issue triggers recall, reputational damage", "location": "Bengaluru", "type": "Custom", "severity": 9, "tags": ["quality", "recall"]},
    ],
    "Logistics": [
        {"name": "Port Strike and Closure", "description": "Port workers strike halts all cargo movement", "location": "Mumbai", "type": "Strike", "severity": 9, "tags": ["port", "strike"]},
        {"name": "Fuel Price Spike", "description": "Oil price surge increases fuel costs 45%", "location": "Delhi", "type": "Geopolitical", "severity": 7, "tags": ["fuel", "cost"]},
        {"name": "Border Closure", "description": "Unexpected border closure disrupts cross-border logistics", "location": "Delhi", "type": "Geopolitical", "severity": 8, "tags": ["border", "customs"]},
        {"name": "Driver Shortage", "description": "Truck driver shortage reduces capacity 30%", "location": "Mumbai", "type": "Custom", "severity": 6, "tags": ["labor", "drivers"]},
        {"name": "Fleet Breakdown Cluster", "description": "Fleet-wide mechanical failures paralyze operations", "location": "Chennai", "type": "Custom", "severity": 8, "tags": ["fleet", "mechanical"]},
    ],
    "Other": [
        {"name": "Supplier Production Halt", "description": "Critical supplier halts all production temporarily", "location": "Bengaluru", "type": "Custom", "severity": 8, "tags": ["production", "supplier"]},
        {"name": "Logistics Delay Cascade", "description": "Unexpected logistics delay cascades across distribution", "location": "Mumbai", "type": "Custom", "severity": 7, "tags": ["logistics", "cascade"]},
        {"name": "Quality Control Issue", "description": "Quality control failures detected in shipment", "location": "Delhi", "type": "Custom", "severity": 7, "tags": ["quality", "control"]},
        {"name": "Demand Forecast Miss", "description": "Unexpected demand surge outpaces inventory", "location": "Chennai", "type": "Custom", "severity": 6, "tags": ["demand", "forecast"]},
        {"name": "Supply Chain Bottleneck", "description": "Bottleneck at critical supply chain node", "location": "Pune", "type": "Custom", "severity": 6, "tags": ["bottleneck", "supply"]},
    ],
}


def _ensure_client_defaults(client_id: str) -> dict:
    client = clients_db.setdefault(client_id, {})
    client.setdefault("suppliers", [])
    client.setdefault("settings", {})
    client["settings"].setdefault("notifications", dict(DEFAULT_NOTIFICATION_SETTINGS))
    client.setdefault("onboarding_checklist", {step["id"]: False for step in ONBOARDING_STEPS})
    notifications_db.setdefault(client_id, [])
    return client


def _seed_client_scenarios(client_id: str, industry: str) -> None:
    if custom_scenarios_db.get(client_id):
        return
    templates = INDUSTRY_SCENARIO_MAP.get(industry, INDUSTRY_SCENARIO_MAP["Other"])
    custom_scenarios_db[client_id] = [
        {**t, "id": f"scen_{secrets.token_hex(6)}", "is_seeded": True, "created_at": _now_utc()}
        for t in templates
    ]


def _mark_onboarding_step(client_id: str, step_id: str, complete: bool = True) -> None:
    client = _ensure_client_defaults(client_id)
    if step_id in client["onboarding_checklist"]:
        client["onboarding_checklist"][step_id] = complete


def _create_notification(client_id: str, notif_type: str, title: str, message: str, action_url: str = "") -> dict:
    notification = {
        "id": f"notif_{secrets.token_hex(8)}",
        "client_id": client_id,
        "type": notif_type,
        "title": title[:120],
        "message": message[:300],
        "read": False,
        "dismissed": False,
        "action_url": action_url,
        "created_at": _now_utc(),
    }
    notifications_db[client_id].insert(0, notification)
    notifications_db[client_id] = notifications_db[client_id][:100]
    return notification


def _event_count_for_client(client_id: str) -> int:
    return sum(1 for event in storage.list_events() if event.get("client_id") == client_id)


def _resolve_suppliers(client_id: str) -> list:
    """Resolve the supplier list for a client.

    Seed clients (demo) ALWAYS return the
    fixed seed data — their clients_db entry is never consulted for suppliers.
    This guarantees the public demo can never show a real client's uploaded data
    regardless of how clients_db was populated.

    Real clients get only their own uploaded suppliers; they never see seed data.
    """
    if client_id in SEED_CLIENT_IDS:
        return get_suppliers_for_client(client_id)
    client = clients_db.get(client_id)
    if client and client.get("suppliers"):
        return client["suppliers"]
    return []


def _extract_device_info(request) -> dict:
    """Extract browser and device type from User-Agent header."""
    ua = request.headers.get("user-agent", "Unknown")
    browser = next((b for b in ["Edge", "Firefox", "Chrome", "Safari"] if b in ua), "Unknown")
    device = "Mobile" if any(k in ua for k in ["Mobile", "Android", "iPhone"]) else "Desktop"
    return {"browser": browser, "device": device, "user_agent": ua[:200]}


def _client_zones(client_id: str) -> set[str]:
    """Return the set of zone names used by a client's suppliers."""
    suppliers = _resolve_suppliers(client_id)
    return {s.get("zone", "") for s in suppliers if s.get("zone")}


# GET /api/suppliers moved to routes/supplier_routes.py (Gap 4 split).


# /api/demo-scenarios + /api/news/latest + /api/weather/current + /api/supply-chain-map + /api/resilience-score + /api/data-quality + /api/dependency-heatmap moved to routes/dashboard_routes.py (Gap 4 split).


# R-01..R-09 + /api/reports/summary moved to routes/report_routes.py (Gap 4 split).


# /api/auth/{signup,login,me,update-company,update-profile} moved to routes/auth_routes.py (Gap 4 split).


def _normalize_zone(raw: str) -> str:
    """Map any raw zone string to the nearest canonical zone name.

    Uses four passes: exact → case-insensitive → substring → difflib fuzzy.
    Returns None only when no reasonable match exists (caller should then try geocoding).
    """
    import difflib
    raw_stripped = (raw or "").strip()
    if not raw_stripped:
        return None
    raw_lower = raw_stripped.lower()
    for z in VALID_ZONES:
        if z.lower() == raw_lower:
            return z
    for z in VALID_ZONES:
        zl = z.lower()
        if raw_lower in zl or zl in raw_lower:
            return z
    matches = difflib.get_close_matches(raw_stripped, VALID_ZONES, n=1, cutoff=0.55)
    if not matches:
        matches = difflib.get_close_matches(raw_lower, [z.lower() for z in VALID_ZONES], n=1, cutoff=0.55)
        if matches:
            matches = [z for z in VALID_ZONES if z.lower() == matches[0]]
    return matches[0] if matches else None


def _active_disruption_events(client_id: str) -> list:
    """Get list of active disruption events for a client."""
    from storage import list_events
    try:
        all_events = list_events()
        return [e for e in all_events if e.get("client_id") == client_id and e.get("status") != "resolved"]
    except:
        return []


def _zone_overlap(geography: str) -> set:
    """Map a geography string to the set of zones it affects.

    Used for cascade detection and disruption tracking.
    Returns a set of zone names that are affected by this geography.
    """
    if not geography:
        return set()

    geography_lower = geography.lower()
    affected_zones = set()

    for zone in VALID_ZONES:
        if zone.lower() in geography_lower or geography_lower in zone.lower():
            affected_zones.add(zone)

    return affected_zones if affected_zones else {geography}


async def _geocode_zone(zone: str) -> dict:
    """Geocode an unrecognised zone name via Nominatim (OpenStreetMap).

    Returns {"lat": float, "lon": float}. Result is cached in _geocode_cache
    so the same zone is never fetched twice per server session.
    Falls back to central India (22, 79) on network failure.
    """
    import httpx
    cached = _geocode_cache.get(zone)
    if cached:
        return cached
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            # Try global search first; fall back to India-scoped search
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": zone, "format": "json", "limit": 1},
                headers={"User-Agent": "DisruptIQ-SupplyChain/2.0 (supply-chain-risk-platform)"},
            )
            results = resp.json()
            if not results:
                resp2 = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": f"{zone}, India", "format": "json", "limit": 1},
                    headers={"User-Agent": "DisruptIQ-SupplyChain/2.0 (supply-chain-risk-platform)"},
                )
                results = resp2.json()
            if results:
                coords = {"lat": round(float(results[0]["lat"]), 4), "lon": round(float(results[0]["lon"]), 4)}
                _geocode_cache[zone] = coords
                return coords
    except Exception:
        pass
    fallback = {"lat": 22.0, "lon": 79.0}
    _geocode_cache[zone] = fallback
    return fallback


# /api/auth/import-suppliers moved to routes/auth_routes.py (Gap 4 split).


# GET /api/suppliers/template moved to routes/supplier_routes.py (Gap 4 split).


# POST /api/suppliers/upload-excel moved to routes/supplier_routes.py (Gap 4 split).


# POST /api/suppliers/upload-csv moved to routes/supplier_routes.py (Gap 4 split).


# /api/auth/{logout,logout-all,sessions,change-password,forgot-password,verify-reset-token,reset-password} moved to routes/auth_routes.py (Gap 4 split).


def _client_user(current_user: dict) -> tuple[dict, dict]:
    user = users_db.get(current_user["email"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    client = _ensure_client_defaults(user["client_id"])
    return user, client


def _make_suppliers_workbook(client: dict):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Suppliers"
    headers = ["ID", "Name", "Zone", "Categories", "Buffer Stock Days", "Sites", "Reliability", "Proximity Score"]
    ws.append(headers)
    for supplier in client.get("suppliers", []):
        ws.append([
            supplier.get("id"),
            supplier.get("name"),
            supplier.get("zone"),
            ", ".join(supplier.get("categories", [])),
            supplier.get("buffer_stock_days", 7),
            supplier.get("sites", 1),
            supplier.get("reliability", 85),
            supplier.get("proximity_score", 5),
        ])
    return wb


# POST/PUT/DELETE/GET /api/suppliers/{add-single,bulk-delete,export,health-scores,compare,trends,anomalies,id} moved to routes/supplier_routes.py (Gap 4 split).


# /api/scenarios* + /api/search moved to routes/dashboard_routes.py (Gap 4 split).


# /api/notifications* + /api/onboarding* + /api/account/notifications + /api/account/test-email moved to routes/account_routes.py (Gap 4 split).


# /api/account/{delete,confirm-delete,reset-data,export-data} moved to routes/account_routes.py (Gap 4 split).


# /api/feedback + /api/support moved to routes/account_routes.py (Gap 4 split).


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=False)
