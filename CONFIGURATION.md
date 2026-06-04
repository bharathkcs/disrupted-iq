# DisruptIQ V2 — Configuration & Thresholds Guide

> Configurable parameters, thresholds, and feature flags.

**Last Updated:** 2026-05-22

---

## Severity Thresholds

| Threshold | Default | Purpose |
|-----------|---------|---------|
| `SEVERITY_THRESHOLD` | 4 | Min severity to trigger swarm |
| `CRITICAL_SEVERITY` | 9 | Triggers co-reviewer requirement |
| `HIGH_RISK_SCORE` | 75 | Risk tier: Critical |
| `MEDIUM_RISK_SCORE` | 60 | Risk tier: High |
| `LOW_RISK_SCORE` | 40 | Risk tier: Medium |

**Change via API:**
```bash
POST /api/config/update
{
  "SEVERITY_THRESHOLD": 5
}
```

---

## Cascade Detection

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `CASCADE_TIME_WINDOW_HOURS` | 48 | Sister event lookback |
| `CASCADE_MULTIPLIER` | 1.2 | Risk multiplier |
| `DISSENT_DIVERGENCE_THRESHOLD` | 15 | Option divergence (%) |

---

## Validation Gates

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `REQUIRE_DISSENT_ACK` | True | Gate: acknowledge dissent |
| `REQUIRE_CASCADE_ACK` | True | Gate: acknowledge cascade |
| `REQUIRE_CO_REVIEWER_AT_SEVERITY` | 9 | Co-reviewer needed at severity ≥9 |

---

## AI Agent Parameters

**Forecast:**
```python
CONFIDENCE_HIGH = 0.80    # 80-120% of predicted
CONFIDENCE_MEDIUM = 0.70  # 70-130% of predicted
CONFIDENCE_LOW = 0.60     # 60-140% of predicted
FORECAST_DELTA_MAX = 0.30  # Max +/- 30% adjustment from memory
```

**Risk:**
```python
PROXIMITY_WEIGHT = 30   # 30% of score
BUFFER_WEIGHT = 25      # 25% of score
SITE_WEIGHT = 20        # 20% of score
RELIABILITY_WEIGHT = 15 # 15% of score
CATEGORY_WEIGHT = 10    # 10% of score
```

**Action:**
```python
BASE_QUANTITY = 300
DEMAND_MULTIPLIER = 10
SEVERITY_MULTIPLIER = 20
BASE_COST_PREMIUM = 6  # 6% base
```

---

## Simulation

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `SIMULATION_SLA_SECONDS` | 30 | Monte Carlo timeout |
| `SIMULATION_SCENARIOS` | 3 | P10, P50, P90 |
| `SIMULATION_TIMEOUT_FALLBACK` | True | Use baseline if timeout |

---

## Feature Flags

```python
FEATURE_FLAGS = {
  "advanced_simulation": False,
  "api_access": False,
  "custom_scenarios": True,
  "cascade_detection": True,
  "memory_learning": True,
  "content_safety_filter": False,
  "news_monitoring": False,
  "weather_monitoring": False
}
```

---

## Free Tier Limits

| Quota | Limit | Period |
|-------|-------|--------|
| Suppliers per client | 50 | Cumulative |
| Events per month | 100 | Rolling month |
| Swarm execution time | 90 s | Per event |
| Data export | 5 | Per month |

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /api/auth/signup | 5 | 5 minutes |
| POST /api/auth/login | 5 | 5 minutes |
| POST /api/events/trigger | 10 | 1 minute |
| POST /api/feedback | 20 | 1 hour |

---

## Service Health

```bash
GET /health

Response:
{
  "status": "healthy",
  "demo_mode": true,
  "services": {
    "cosmos_db": "healthy",
    "github_models": "healthy",
    "sendgrid": "healthy"
  }
}
```

---

## Session & JWT

| Parameter | Default |
|-----------|---------|
| `JWT_ALGORITHM` | HS256 |
| `JWT_EXPIRY_HOURS` | 24 |
| `PASSWORD_MIN_LENGTH` | 8 |
| `PASSWORD_ITERATIONS` | 600000 |

---

## Pagination

| Parameter | Default |
|-----------|---------|
| `DEFAULT_PAGE_SIZE` | 20 |
| `MAX_PAGE_SIZE` | 100 |

---

## File Limits

| File Type | Max Size |
|-----------|----------|
| Excel (.xlsx) | 10 MB |
| CSV | 5 MB |
| Export (.zip) | 50 MB |

---

## View Current Configuration

```bash
GET /api/config

Response: All current thresholds and flags
```

---

## Summary

✓ Thresholds adjustable via `/api/config/update`  
✓ Feature flags enable/disable functionality  
✓ Rate limits protect against abuse  
✓ All configuration logged in audit trail  

---

*End of CONFIGURATION.md*
