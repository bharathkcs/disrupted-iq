"""monitor_daemon.py — Proactive disruption monitoring helper module.

This module powers Section 1 of the Market Differentiation Sprint:
"DisruptIQ no longer requires manual event triggering."

It contributes three responsibilities to the polling loops in ``main.py``:

  1. ``score_news_article(article, client_zones, client_industry)``
       Score one NewsAPI article for disruption potential, given a specific
       client's zones and industry. Returns a structured signal dict or None.

  2. ``score_weather_alert(alert, client_zones)``
       Score one weather record against a client's zones. Returns signal or None.

  3. ``should_auto_trigger`` / ``record_auto_trigger`` / ``classify_event_type``
       Per-client + per-zone cooldown bookkeeping and event-type classification.
       Cooldowns prevent duplicate swarm runs when the same news clip continues
       to surface or weather alerts repeat over consecutive polls.

The module is intentionally state-only (no FastAPI, no Socket.IO). The polling
loops in ``main.py`` decide *when* to call into it and what to do with the
resulting signals, which keeps tenant isolation and audit logging at one site.

Works identically for the demo seed client and for real onboarded clients —
zones and industry are always derived from the caller's uploaded data.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger("disruptiq.monitor_daemon")

# Per-client cooldown tracking: {client_id: {zone: last_trigger_utc}}
# In-memory only — restarted cleanly with the backend. That's correct: after a
# restart the operator usually wants the next real signal to fire promptly.
_zone_cooldowns: dict[str, dict[str, datetime]] = {}

DEFAULT_COOLDOWN_HOURS = 6
DEFAULT_TRIGGER_THRESHOLD = 7.0
MIN_RELEVANCE_SCORE = 4.0  # below this an article is considered too weak to count

DISRUPTION_KEYWORDS = (
    "strike", "shutdown", "closure", "fire", "flood", "cyclone",
    "hurricane", "earthquake", "insolvency", "bankruptcy",
    "port congestion", "delay", "shortage", "disruption", "halt",
    "explosion", "accident", "geopolitical", "sanctions", "tariff",
    "protest", "lockdown", "outage", "blockade",
)

CREDIBLE_SOURCES = (
    "reuters", "bloomberg", "financial times", "the hindu business line",
    "economic times", "wall street journal", "the wall street journal",
    "associated press", "ap news",
)


def _ensure_utc(value: datetime) -> datetime:
    """Coerce a datetime to timezone-aware UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def should_auto_trigger(
    client_id: str,
    zone: str,
    severity: float,
    client_threshold: float = DEFAULT_TRIGGER_THRESHOLD,
    cooldown_hours: int = DEFAULT_COOLDOWN_HOURS,
    now: Optional[datetime] = None,
) -> bool:
    """Return True if an auto-trigger should fire for this client/zone.

    Two gates:
      1. severity >= client_threshold
      2. no prior trigger for this client+zone within cooldown_hours

    Pure function (apart from reading the cooldown registry). Tests can inject
    ``now`` to make time deterministic.
    """
    if severity < client_threshold:
        return False

    current = _ensure_utc(now) if now else datetime.now(timezone.utc)
    client_cooldowns = _zone_cooldowns.get(client_id, {})
    last_trigger = client_cooldowns.get(zone)
    if last_trigger and (current - _ensure_utc(last_trigger)) < timedelta(hours=cooldown_hours):
        return False
    return True


def record_auto_trigger(client_id: str, zone: str, now: Optional[datetime] = None) -> None:
    """Stamp the cooldown clock for this client+zone."""
    current = _ensure_utc(now) if now else datetime.now(timezone.utc)
    _zone_cooldowns.setdefault(client_id, {})[zone] = current


def reset_cooldowns(client_id: Optional[str] = None) -> None:
    """Clear cooldowns — used by tests and admin tooling."""
    if client_id is None:
        _zone_cooldowns.clear()
    else:
        _zone_cooldowns.pop(client_id, None)


def score_news_article(
    article: dict,
    client_zones: list[str],
    client_industry: str = "",
) -> Optional[dict]:
    """Score a NewsAPI article against one client's zones and industry.

    Scoring components (all additive):
        +4   headline mentions one of the client's supplier zones
        +3   article mentions the client's industry name
        +1   per disruption keyword (capped, see below)
        +2   source is on the credible-publisher list

    Returns ``None`` if the article is not zone-matched or scores too low.
    Otherwise returns a signal payload with severity already mapped to 0-10.
    """
    headline = str(article.get("title") or "")
    description = str(article.get("description") or "")
    content = (headline + " " + description).lower()

    score = 0.0
    matched_zone: Optional[str] = None
    matched_keywords: list[str] = []

    for zone in client_zones or []:
        if zone and zone.lower() in content:
            score += 4.0
            matched_zone = zone
            break

    industry_lower = (client_industry or "").lower()
    if industry_lower and industry_lower in content:
        score += 3.0

    for kw in DISRUPTION_KEYWORDS:
        if kw in content:
            score += 1.0
            matched_keywords.append(kw)
        if score >= 12.0:
            break

    source_name = str((article.get("source") or {}).get("name") or "").lower()
    if any(cs in source_name for cs in CREDIBLE_SOURCES):
        score += 2.0

    if matched_zone is None or score < MIN_RELEVANCE_SCORE:
        return None

    severity = min(10.0, round(score * 0.9, 1))

    return {
        "zone": matched_zone,
        "severity": severity,
        "headline": headline,
        "description": description[:200],
        "source": str((article.get("source") or {}).get("name") or ""),
        "url": str(article.get("url") or ""),
        "published_at": str(article.get("publishedAt") or ""),
        "matched_keywords": matched_keywords[:5],
        "signal_type": "news",
    }


def score_weather_alert(alert: dict, client_zones: list[str]) -> Optional[dict]:
    """Score a weather record. The shape mirrors ``_city_weather`` entries used
    by the existing Open-Meteo polling loop.

    A weather alert qualifies if:
      - the zone is one of the client's supplier zones
      - severity (already 0-10) is >= 4
    """
    alert_zone = alert.get("name") or alert.get("zone") or alert.get("city")
    if not alert_zone or alert_zone not in (client_zones or []):
        return None

    severity = float(alert.get("severity_score") or alert.get("severity") or 0)
    if severity < 4.0:
        return None

    description = (
        alert.get("weather_description")
        or alert.get("description")
        or "Severe weather conditions"
    )
    return {
        "zone": alert_zone,
        "severity": severity,
        "headline": f"Weather alert: {description} in {alert_zone}",
        "description": description,
        "source": "Open-Meteo",
        "url": "",
        "published_at": alert.get("last_updated_utc") or datetime.now(timezone.utc).isoformat(),
        "matched_keywords": [str(alert.get("weather_description") or "weather")],
        "signal_type": "weather",
    }


_EVENT_TYPE_BUCKETS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Weather Event",       ("cyclone", "hurricane", "flood", "earthquake", "weather", "monsoon")),
    ("Port Strike",         ("strike", "shutdown", "protest", "blockade", "port congestion")),
    ("Supplier Insolvency", ("insolvency", "bankruptcy", "liquidation")),
    ("Geopolitical",        ("sanctions", "tariff", "geopolitical", "border")),
    ("Industrial Incident", ("fire", "explosion", "accident", "outage")),
)


def classify_event_type(matched_keywords: list[str], signal_type: str = "news") -> str:
    """Map a list of matched keywords to a coarse event_type label.

    Used to populate the EventTrigger when auto-firing the swarm so downstream
    forecast / risk / cascade agents see a meaningful event_type instead of a
    generic "Disruption".
    """
    kws = {k.lower() for k in (matched_keywords or [])}
    if signal_type == "weather":
        return "Weather Event"
    for label, candidates in _EVENT_TYPE_BUCKETS:
        if kws & set(candidates):
            return label
    return "Disruption"
