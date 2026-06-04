"""DisruptIQ V2 - Configuration loader."""

import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


def _bool(v: str, default: bool = False) -> bool:
    return str(v).lower() in ("1", "true", "yes", "y") if v else default


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_config_overrides: dict[str, object] = {}

# LLM
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_MODELS_ENDPOINT = os.getenv("GITHUB_MODELS_ENDPOINT", "https://models.inference.ai.azure.com")
GITHUB_MODEL = os.getenv("GITHUB_MODEL", "gpt-4o")

# Azure Cosmos DB
COSMOS_ENDPOINT = os.getenv("AZURE_COSMOS_ENDPOINT", "")
COSMOS_KEY = os.getenv("AZURE_COSMOS_KEY", "")
COSMOS_DATABASE = os.getenv("AZURE_COSMOS_DATABASE", "disruptiq")
COSMOS_CONTAINER_MEMORY = os.getenv("AZURE_COSMOS_CONTAINER_MEMORY", "swarm_memory")
COSMOS_CONTAINER_AUDIT = os.getenv("AZURE_COSMOS_CONTAINER_AUDIT", "audit_log")
COSMOS_CONTAINER_EVENTS = os.getenv("AZURE_COSMOS_CONTAINER_EVENTS", "events")
COSMOS_CONTAINER_PREMIUM = os.getenv("AZURE_COSMOS_CONTAINER_PREMIUM", "premium_requests")
COSMOS_CONTAINER_SUPPORT = os.getenv("AZURE_COSMOS_CONTAINER_SUPPORT", "support_tickets")
COSMOS_CONTAINER_FEEDBACK = os.getenv("AZURE_COSMOS_CONTAINER_FEEDBACK", "feedback")

# Content Safety
CONTENT_SAFETY_ENDPOINT = os.getenv("AZURE_CONTENT_SAFETY_ENDPOINT", "")
CONTENT_SAFETY_KEY = os.getenv("AZURE_CONTENT_SAFETY_KEY", "")

# Application Insights
APPLICATIONINSIGHTS_CONNECTION_STRING = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "")

# External feeds
NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")
OPENMETEO_BASE = os.getenv("OPENMETEO_BASE", "https://api.open-meteo.com/v1")
OPENMETEO_AIR_QUALITY_BASE = os.getenv("OPENMETEO_AIR_QUALITY_BASE", "https://air-quality-api.open-meteo.com/v1")

# Email service
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL", "noreply@disruptiq.dev")
SENDGRID_FROM_NAME = os.getenv("SENDGRID_FROM_NAME", "DisruptIQ Platform")

# Email service — Gmail SMTP (alternative to SendGrid)
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "DisruptIQ Platform")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "")

# Master email switch — when false, emails are logged to console instead of sent.
EMAIL_ENABLED = _bool(os.getenv("EMAIL_ENABLED", "false"), False)

# App URLs (used to build links inside emails)
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000")
FRONTEND_URL = os.getenv("FRONTEND_URL", APP_BASE_URL)
SUPPORT_EMAIL = os.getenv("SUPPORT_EMAIL", "kcsbadp@gmail.com")

# Admin Console — owner-only access. Comma-separated allowlist of owner emails.
# The console and its API are hidden (404) from anyone whose JWT email is not here.
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "kcsbadp@gmail.com,bharathkumarkcs99@gmail.com").split(",")
    if e.strip()
}

# Supplier caps. Free accounts are limited; premium (granted by an owner in the
# Admin Console) lifts the cap. PREMIUM is effectively unlimited.
FREE_SUPPLIER_LIMIT = int(os.getenv("FREE_SUPPLIER_LIMIT", "30"))
PREMIUM_SUPPLIER_LIMIT = int(os.getenv("PREMIUM_SUPPLIER_LIMIT", "100000"))

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Demo mode — defaults to FALSE so a misconfigured production deploy never
# silently runs on ephemeral in-memory storage with synthetic LLM output.
DEMO_MODE = _bool(os.getenv("DEMO_MODE", "false"), False)

_cors_env = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
CORS_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]
# Flexible localhost ports (3000-3010) are only allowed in demo/dev mode.
# In production the allow-list stays strict because allow_credentials=True is set.
if DEMO_MODE:
    CORS_ORIGINS.extend([f"http://localhost:{p}" for p in range(3000, 3011)])
    CORS_ORIGINS.extend([f"http://127.0.0.1:{p}" for p in range(3000, 3011)])

# Operational tuning
SEVERITY_THRESHOLD = int(os.getenv("SEVERITY_THRESHOLD", "6"))
DISSENT_DIVERGENCE_THRESHOLD = int(os.getenv("DISSENT_DIVERGENCE_THRESHOLD", "30"))
CASCADE_WINDOW_HOURS = int(os.getenv("CASCADE_WINDOW_HOURS", "48"))
CASCADE_OVERLAP_MULTIPLIER = float(os.getenv("CASCADE_OVERLAP_MULTIPLIER", "1.2"))
SIMULATION_SLA_SECONDS = int(os.getenv("SIMULATION_SLA_SECONDS", "30"))
MAX_VALIDATOR_RERUNS = int(os.getenv("MAX_VALIDATOR_RERUNS", "2"))
MEMORY_CONTEXT_LIMIT = int(os.getenv("MEMORY_CONTEXT_LIMIT", "10"))
NEWSAPI_POLL_INTERVAL_MINUTES = int(os.getenv("NEWSAPI_POLL_INTERVAL_MINUTES", "5"))
OPENMETEO_POLL_INTERVAL_MINUTES = int(os.getenv("OPENMETEO_POLL_INTERVAL_MINUTES", "10"))
MINIMUM_SEVERITY_TO_ALERT = int(os.getenv("MINIMUM_SEVERITY_TO_ALERT", "6"))

# Multi-tenant (SECTION 4)
ACTIVE_CLIENT_ID = os.getenv("ACTIVE_CLIENT_ID", "demo")

# Authentication
_JWT_SECRET_DEFAULT = "change-me-disruptiq-jwt-secret-please-rotate-before-production-use"
JWT_SECRET = os.getenv("JWT_SECRET", _JWT_SECRET_DEFAULT)
if JWT_SECRET == _JWT_SECRET_DEFAULT:
    if not DEMO_MODE:
        raise RuntimeError(
            "STARTUP BLOCKED: JWT_SECRET is still the default value while "
            "DEMO_MODE=false. Anyone who can read the source could forge JWTs "
            "for any tenant. Set JWT_SECRET in .env to a random 32+ byte string:\n"
            '    python -c "import secrets; print(secrets.token_hex(32))"'
        )
    logger.warning(
        "JWT_SECRET is the default value. Acceptable in DEMO_MODE but MUST be "
        "changed before any production deployment."
    )
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRY_HOURS = int(os.getenv("JWT_EXPIRY_HOURS", "24"))
JWT_REMEMBER_ME_DAYS = int(os.getenv("JWT_REMEMBER_ME_DAYS", "30"))

# Rate limiting
LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
LOGIN_WINDOW_MINUTES = int(os.getenv("LOGIN_WINDOW_MINUTES", "15"))
SIGNUP_MAX_ATTEMPTS = int(os.getenv("SIGNUP_MAX_ATTEMPTS", "3"))
SIGNUP_WINDOW_HOURS = int(os.getenv("SIGNUP_WINDOW_HOURS", "1"))
RESET_MAX_ATTEMPTS = int(os.getenv("RESET_MAX_ATTEMPTS", "3"))
RESET_WINDOW_HOURS = int(os.getenv("RESET_WINDOW_HOURS", "1"))
API_RATE_LIMIT_PER_MINUTE = int(os.getenv("API_RATE_LIMIT_PER_MINUTE", "100"))

def get_active_suppliers():
    """Get suppliers for the currently active client."""
    from seed_data import get_suppliers_for_client
    return get_suppliers_for_client(ACTIVE_CLIENT_ID)


def apply_runtime_overrides(values: dict) -> dict:
    applied = {}
    for key, value in values.items():
        if key not in globals():
            continue
        globals()[key] = value
        _config_overrides[key] = value
        applied[key] = value
    return applied


def get_runtime_overrides() -> dict:
    return dict(_config_overrides)


def runtime_config_snapshot() -> dict:
    return {
        "thresholds": {
            "SEVERITY_THRESHOLD": SEVERITY_THRESHOLD,
            "DISSENT_DIVERGENCE_THRESHOLD": DISSENT_DIVERGENCE_THRESHOLD,
            "CASCADE_WINDOW_HOURS": CASCADE_WINDOW_HOURS,
            "CASCADE_OVERLAP_MULTIPLIER": CASCADE_OVERLAP_MULTIPLIER,
            "SIMULATION_SLA_SECONDS": SIMULATION_SLA_SECONDS,
            "MAX_VALIDATOR_RERUNS": MAX_VALIDATOR_RERUNS,
            "MINIMUM_SEVERITY_TO_ALERT": MINIMUM_SEVERITY_TO_ALERT,
        },
        "polling": {
            "NEWSAPI_POLL_INTERVAL_MINUTES": NEWSAPI_POLL_INTERVAL_MINUTES,
            "OPENMETEO_POLL_INTERVAL_MINUTES": OPENMETEO_POLL_INTERVAL_MINUTES,
        },
        "overrides": get_runtime_overrides(),
        "timestamp_utc": _now_utc(),
    }


def is_real_llm() -> bool:
    return bool(GITHUB_TOKEN) and not GITHUB_TOKEN.startswith("PLACEHOLDER")


def is_real_cosmos() -> bool:
    return (
        bool(COSMOS_ENDPOINT)
        and bool(COSMOS_KEY)
        and not COSMOS_ENDPOINT.startswith("PLACEHOLDER")
        and not COSMOS_KEY.startswith("PLACEHOLDER")
    )


def is_real_content_safety() -> bool:
    return (
        bool(CONTENT_SAFETY_ENDPOINT)
        and bool(CONTENT_SAFETY_KEY)
        and not CONTENT_SAFETY_ENDPOINT.startswith("PLACEHOLDER")
    )


def is_real_appinsights() -> bool:
    return (
        bool(APPLICATIONINSIGHTS_CONNECTION_STRING)
        and not APPLICATIONINSIGHTS_CONNECTION_STRING.startswith("PLACEHOLDER")
    )


def is_real_email() -> bool:
    """True when email is enabled AND a real transport (SendGrid or SMTP) is configured."""
    if not EMAIL_ENABLED:
        return False
    sendgrid_ok = bool(SENDGRID_API_KEY) and not SENDGRID_API_KEY.startswith("PLACEHOLDER")
    smtp_ok = bool(SMTP_USER) and bool(SMTP_PASSWORD)
    return sendgrid_ok or smtp_ok


if DEMO_MODE:
    logger.warning(
        "DEMO_MODE=true — ephemeral in-memory storage and synthetic LLM "
        "responses. Not suitable for production."
    )
else:
    logger.info("DEMO_MODE=false — using configured Cosmos DB + LLM.")
    if not APP_BASE_URL.startswith("https://"):
        logger.warning(
            "SECURITY: DisruptIQ running in production but APP_BASE_URL uses HTTP. "
            "Cookies vulnerable to MITM attacks. Ensure HTTPS is enforced in load balancer."
        )


def status_summary() -> dict:
    return {
        "demo_mode": DEMO_MODE,
        "llm_live": is_real_llm(),
        "cosmos_live": is_real_cosmos(),
        "content_safety_live": is_real_content_safety(),
        "appinsights_live": is_real_appinsights(),
        "email_live": is_real_email(),
        "newsapi_live": bool(NEWSAPI_KEY) and not NEWSAPI_KEY.startswith("PLACEHOLDER"),
        "openmeteo_live": True,
    }
