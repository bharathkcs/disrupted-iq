"""Unit tests for monitor_daemon.py - Section 1 of the Market Differentiation Sprint.

Covers:
  - score_news_article: zone-match, industry-match, keyword-match, source credibility, severity mapping
  - score_weather_alert: zone gate, severity floor, payload shape
  - should_auto_trigger + record_auto_trigger: threshold gate, cooldown window
  - classify_event_type: keyword bucket mapping for both signal types

Run with:
    cd "Swarm Agent/backend"
    pytest tests/test_monitor_daemon.py -v
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import monitor_daemon


@pytest.fixture(autouse=True)
def _reset_cooldowns():
    """Each test starts with no cooldown state."""
    monitor_daemon.reset_cooldowns()
    yield
    monitor_daemon.reset_cooldowns()


# --- score_news_article ----------------------------------------------------

class TestScoreNewsArticle:
    def test_returns_none_when_no_zone_match(self):
        article = {
            "title": "Generic news about something unrelated",
            "description": "No supplier zones mentioned here",
            "source": {"name": "Reuters"},
        }
        assert monitor_daemon.score_news_article(article, ["Mumbai", "Chennai"], "") is None

    def test_zone_only_meets_floor(self):
        # A zone-only mention scores exactly the relevance floor (4.0).
        # Confirms the gate is inclusive at the boundary.
        article = {
            "title": "Mumbai weather is pleasant today",
            "description": "",
            "source": {"name": "LocalBlog"},
        }
        signal = monitor_daemon.score_news_article(article, ["Mumbai"], "")
        assert signal is not None
        assert signal["zone"] == "Mumbai"

    def test_zone_match_returns_signal(self):
        article = {
            "title": "Port strike disrupts Mumbai container handling",
            "description": "Dock workers shutdown began this morning",
            "source": {"name": "Reuters"},
        }
        signal = monitor_daemon.score_news_article(article, ["Mumbai", "Chennai"], "Logistics")
        assert signal is not None
        assert signal["zone"] == "Mumbai"
        assert signal["severity"] > 0
        assert signal["signal_type"] == "news"
        assert "strike" in signal["matched_keywords"]

    def test_industry_match_boosts_severity(self):
        # Same article, one client matches industry, one does not
        article = {
            "title": "Strike halts electronics shipments from Chennai",
            "description": "Major industrial action begins",
            "source": {"name": "Reuters"},
        }
        with_industry = monitor_daemon.score_news_article(article, ["Chennai"], "electronics")
        without_industry = monitor_daemon.score_news_article(article, ["Chennai"], "agriculture")
        assert with_industry is not None and without_industry is not None
        assert with_industry["severity"] > without_industry["severity"]

    def test_credible_source_boosts_severity(self):
        base = {
            "title": "Cyclone forecast for Chennai",
            "description": "Coast may experience disruption",
        }
        reuters = monitor_daemon.score_news_article(
            {**base, "source": {"name": "Reuters"}}, ["Chennai"], "",
        )
        unknown = monitor_daemon.score_news_article(
            {**base, "source": {"name": "Random Blog"}}, ["Chennai"], "",
        )
        assert reuters is not None and unknown is not None
        assert reuters["severity"] >= unknown["severity"]

    def test_severity_capped_at_ten(self):
        article = {
            "title": "Strike shutdown closure fire flood cyclone earthquake bankruptcy Mumbai",
            "description": "Insolvency tariff sanctions geopolitical explosion accident",
            "source": {"name": "Bloomberg"},
        }
        signal = monitor_daemon.score_news_article(article, ["Mumbai"], "Logistics")
        assert signal is not None
        assert signal["severity"] <= 10.0

    def test_handles_missing_fields_gracefully(self):
        # Realistic NewsAPI responses sometimes omit fields
        article = {"title": "Mumbai port closure"}
        signal = monitor_daemon.score_news_article(article, ["Mumbai"], "")
        assert signal is not None
        assert signal["url"] == ""

    def test_empty_zone_list_returns_none(self):
        article = {"title": "Mumbai port closure", "source": {"name": "Reuters"}}
        assert monitor_daemon.score_news_article(article, [], "") is None


# --- score_weather_alert ---------------------------------------------------

class TestScoreWeatherAlert:
    def test_returns_none_when_zone_not_monitored(self):
        alert = {"name": "Tokyo", "severity_score": 8, "weather_description": "Typhoon"}
        assert monitor_daemon.score_weather_alert(alert, ["Mumbai", "Chennai"]) is None

    def test_returns_none_below_severity_floor(self):
        alert = {"name": "Mumbai", "severity_score": 3, "weather_description": "Light Rain"}
        assert monitor_daemon.score_weather_alert(alert, ["Mumbai"]) is None

    def test_zone_match_returns_signal(self):
        alert = {
            "name": "Chennai",
            "severity_score": 7,
            "weather_description": "Heavy Rain",
            "last_updated_utc": "2026-06-02T12:00:00Z",
        }
        signal = monitor_daemon.score_weather_alert(alert, ["Chennai", "Mumbai"])
        assert signal is not None
        assert signal["zone"] == "Chennai"
        assert signal["severity"] == 7
        assert signal["signal_type"] == "weather"
        assert signal["source"] == "Open-Meteo"

    def test_accepts_legacy_zone_field(self):
        # If the caller passes a dict using "zone" instead of "name"
        alert = {"zone": "Mumbai", "severity_score": 6, "description": "Storm"}
        signal = monitor_daemon.score_weather_alert(alert, ["Mumbai"])
        assert signal is not None
        assert signal["zone"] == "Mumbai"


# --- should_auto_trigger / record_auto_trigger / cooldown ------------------

class TestAutoTriggerCooldown:
    def test_below_threshold_blocks(self):
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Mumbai", severity=5.0, client_threshold=7.0,
        ) is False

    def test_above_threshold_passes(self):
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Mumbai", severity=8.0, client_threshold=7.0,
        ) is True

    def test_at_threshold_passes(self):
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Mumbai", severity=7.0, client_threshold=7.0,
        ) is True

    def test_cooldown_blocks_repeat_trigger(self):
        now = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
        # First trigger fires
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Mumbai", 8.0, 7.0, cooldown_hours=6, now=now,
        ) is True
        monitor_daemon.record_auto_trigger("client_a", "Mumbai", now=now)
        # Same zone, 1 hour later - still in cooldown
        later = now + timedelta(hours=1)
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Mumbai", 9.0, 7.0, cooldown_hours=6, now=later,
        ) is False

    def test_cooldown_expires_after_window(self):
        now = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
        monitor_daemon.record_auto_trigger("client_a", "Mumbai", now=now)
        # 7 hours later - past 6-hour cooldown
        later = now + timedelta(hours=7)
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Mumbai", 8.0, 7.0, cooldown_hours=6, now=later,
        ) is True

    def test_cooldown_is_per_client_per_zone(self):
        now = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
        monitor_daemon.record_auto_trigger("client_a", "Mumbai", now=now)
        # Different client, same zone - should not share cooldown
        assert monitor_daemon.should_auto_trigger(
            "client_b", "Mumbai", 8.0, 7.0, cooldown_hours=6, now=now,
        ) is True
        # Same client, different zone - should not share cooldown
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Chennai", 8.0, 7.0, cooldown_hours=6, now=now,
        ) is True

    def test_reset_cooldowns_for_one_client(self):
        now = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
        monitor_daemon.record_auto_trigger("client_a", "Mumbai", now=now)
        monitor_daemon.record_auto_trigger("client_b", "Mumbai", now=now)
        monitor_daemon.reset_cooldowns("client_a")
        # client_a's cooldown cleared, client_b's still active
        assert monitor_daemon.should_auto_trigger(
            "client_a", "Mumbai", 8.0, 7.0, cooldown_hours=6, now=now,
        ) is True
        assert monitor_daemon.should_auto_trigger(
            "client_b", "Mumbai", 8.0, 7.0, cooldown_hours=6, now=now,
        ) is False


# --- classify_event_type ---------------------------------------------------

class TestClassifyEventType:
    def test_weather_signal_always_weather_event(self):
        assert monitor_daemon.classify_event_type([], signal_type="weather") == "Weather Event"

    def test_cyclone_keyword(self):
        assert monitor_daemon.classify_event_type(["cyclone"], "news") == "Weather Event"

    def test_strike_keyword(self):
        assert monitor_daemon.classify_event_type(["strike"], "news") == "Port Strike"

    def test_insolvency_keyword(self):
        assert monitor_daemon.classify_event_type(["bankruptcy"], "news") == "Supplier Insolvency"

    def test_geopolitical_keyword(self):
        assert monitor_daemon.classify_event_type(["sanctions"], "news") == "Geopolitical"

    def test_fire_keyword(self):
        assert monitor_daemon.classify_event_type(["fire", "explosion"], "news") == "Industrial Incident"

    def test_unknown_falls_back_to_disruption(self):
        assert monitor_daemon.classify_event_type([], "news") == "Disruption"
        assert monitor_daemon.classify_event_type(["something_else"], "news") == "Disruption"
