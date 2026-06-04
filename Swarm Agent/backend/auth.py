"""Authentication and authorization utilities for DisruptIQ."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException, Request
import jwt

import config

DEMO_USER = {"client_id": "demo", "email": "demo@disruptiq.dev", "company_name": "Demo"}
# Current PBKDF2-HMAC-SHA256 work factor (NIST SP 800-132 floor is 310k; 500k
# gives headroom). Hashes created before the upgrade used 100k — see _parse_salt.
PASSWORD_ITERATIONS = 500_000
_LEGACY_PASSWORD_ITERATIONS = 100_000
# Cap on tracked rate-limit identifiers to prevent unbounded memory growth.
_RATE_LIMITER_MAX_KEYS = 50_000
TOKEN_TTL_HOURS = {
    "access": config.JWT_EXPIRY_HOURS,
    "reset": 1,
    "verify": 24,
    "delete": 24,
}
_EMAIL_RE = re.compile(r"^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$", re.IGNORECASE)

# Per-identifier auth rate limiting. Guarded by a lock because uvicorn may run
# the event loop alongside worker threads. NOTE: this is per-process — for
# multi-worker / multi-host deployments back this with Redis so limits are shared.
auth_rate_limiter: dict[str, dict[str, list[float]]] = {}
_rate_limiter_lock = threading.Lock()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _touch_bucket(identifier: str) -> dict[str, list[float]]:
    # Caller must hold _rate_limiter_lock.
    return auth_rate_limiter.setdefault(
        identifier,
        {
            "login_attempts": [],
            "signup_attempts": [],
            "reset_attempts": [],
        },
    )


def _prune(attempts: list[float], window_seconds: int) -> list[float]:
    now = time.time()
    return [ts for ts in attempts if now - ts < window_seconds]


def _evict_stale_identifiers() -> None:
    # Caller must hold _rate_limiter_lock. Drop identifiers whose every bucket is
    # empty so the dict cannot grow without bound across many distinct emails/IPs.
    if len(auth_rate_limiter) <= _RATE_LIMITER_MAX_KEYS:
        return
    empty = [
        ident for ident, buckets in auth_rate_limiter.items()
        if not any(buckets.values())
    ]
    for ident in empty:
        auth_rate_limiter.pop(ident, None)


def check_rate_limit(identifier: str, bucket: str = "login_attempts") -> bool:
    if bucket == "signup_attempts":
        max_attempts = config.SIGNUP_MAX_ATTEMPTS
        window_seconds = config.SIGNUP_WINDOW_HOURS * 3600
    elif bucket == "reset_attempts":
        max_attempts = config.RESET_MAX_ATTEMPTS
        window_seconds = config.RESET_WINDOW_HOURS * 3600
    else:
        max_attempts = config.LOGIN_MAX_ATTEMPTS
        window_seconds = config.LOGIN_WINDOW_MINUTES * 60

    with _rate_limiter_lock:
        state = _touch_bucket(identifier)
        state[bucket] = _prune(state[bucket], window_seconds)
        if len(state[bucket]) >= max_attempts:
            return False
        state[bucket].append(time.time())
        _evict_stale_identifiers()
        return True


def get_rate_limit_retry_after(identifier: str, bucket: str = "login_attempts") -> int:
    if bucket == "signup_attempts":
        window_seconds = config.SIGNUP_WINDOW_HOURS * 3600
    elif bucket == "reset_attempts":
        window_seconds = config.RESET_WINDOW_HOURS * 3600
    else:
        window_seconds = config.LOGIN_WINDOW_MINUTES * 60
    with _rate_limiter_lock:
        state = _touch_bucket(identifier)
        attempts = _prune(state[bucket], window_seconds)
        if not attempts:
            return 0
        return max(0, int(window_seconds - (time.time() - attempts[0])))


def reset_rate_limit(identifier: str, bucket: str = "login_attempts") -> None:
    with _rate_limiter_lock:
        state = _touch_bucket(identifier)
        state[bucket] = []


def _parse_salt(stored_salt: str) -> tuple[int, str]:
    """Return (iterations, salt_hex) from a stored salt.

    New hashes store ``v2:{iterations}:{salt_hex}`` so the work factor can be
    raised without a data migration. Legacy salts are a bare hex string that was
    always hashed at the old iteration count.
    """
    if stored_salt.startswith("v2:"):
        _, iters, salt_hex = stored_salt.split(":", 2)
        return int(iters), salt_hex
    return _LEGACY_PASSWORD_ITERATIONS, stored_salt


def hash_password(password: str) -> tuple[str, str]:
    salt = secrets.token_hex(32)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_ITERATIONS,
    )
    # Embed the iteration count in the salt field; storage schema is unchanged.
    return digest.hex(), f"v2:{PASSWORD_ITERATIONS}:{salt}"


def verify_password(password: str, hash_val: str, salt: str) -> bool:
    iterations, salt_hex = _parse_salt(salt)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_hex.encode("utf-8"),
        iterations,
    )
    return hmac.compare_digest(digest.hex(), hash_val)


def needs_rehash(salt: str) -> bool:
    """True if a stored credential uses fewer iterations than the current target.

    Call after a successful login and, if True, re-hash the password and persist
    the new (hash, salt) so credentials transparently upgrade over time.
    """
    iterations, _ = _parse_salt(salt)
    return iterations < PASSWORD_ITERATIONS


def validate_password_strength(password: str) -> dict:
    errors = []
    if len(password) < 8:
        errors.append("Password must be at least 8 characters")
    if not any(c.isupper() for c in password):
        errors.append("Password must contain at least one uppercase letter")
    if not any(c.islower() for c in password):
        errors.append("Password must contain at least one lowercase letter")
    if not any(c.isdigit() for c in password):
        errors.append("Password must contain at least one number")
    if not any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?/" for c in password):
        errors.append("Password must contain at least one special character")
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "strength": max(0, 5 - len(errors)),
    }


def validate_email_format(email: str) -> bool:
    return bool(_EMAIL_RE.match((email or "").strip()))


def _token_ttl_hours(token_type: str, remember_me: bool = False) -> int:
    if token_type == "access" and remember_me:
        return config.JWT_REMEMBER_ME_DAYS * 24
    return TOKEN_TTL_HOURS.get(token_type, config.JWT_EXPIRY_HOURS)


def create_jwt_token(
    email: str,
    client_id: str,
    token_type: str = "access",
    remember_me: bool = False,
    extra_claims: dict | None = None,
) -> str:
    issued_at = _utc_now()
    expires_at = issued_at + timedelta(hours=_token_ttl_hours(token_type, remember_me))
    jti = secrets.token_urlsafe(16)
    payload = {
        "jti": jti,
        "email": email,
        "client_id": client_id,
        "token_type": token_type,
        "type": token_type,
        "issued_at": issued_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def verify_jwt_token(token: str, expected_type: str = "access") -> dict:
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    token_type = payload.get("token_type", "access")
    if expected_type and token_type != expected_type:
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.replace("Bearer ", "", 1).strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return token


# Injected by main.py at startup so require_auth can check revoked sessions
# without creating a circular import. Keys are JTI strings.
_active_sessions: dict = {}


def set_sessions_store(store: dict) -> None:
    """Called once at startup with the live sessions_db dict."""
    global _active_sessions
    _active_sessions = store


async def get_current_user(authorization: str = Header(None)) -> dict:
    token = _extract_bearer_token(authorization)
    payload = verify_jwt_token(token, expected_type="access")
    # Revocation check: if the session was explicitly logged out, reject it
    # even if the JWT signature is still valid.
    jti = payload.get("jti")
    if jti and _active_sessions and jti not in _active_sessions:
        raise HTTPException(status_code=401, detail="Session has been revoked")
    return payload


async def require_auth(request: Request) -> dict:
    """Return authenticated user from API Gateway middleware, or 401 if not authenticated."""
    current_user = getattr(request.state, "current_user", None)
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return current_user


def is_admin_email(email: str | None) -> bool:
    """True if the email belongs to a platform owner/administrator allowlist."""
    return bool(email) and email.strip().lower() in config.ADMIN_EMAILS


async def require_admin(request: Request) -> dict:
    """Owner-only gate for the Admin Console.

    Returns 404 (not 401/403) for non-owners and unauthenticated callers so the
    console's very existence stays hidden from regular users.
    """
    current_user = getattr(request.state, "current_user", None)
    if not current_user or not is_admin_email(current_user.get("email")):
        raise HTTPException(status_code=404, detail="Not Found")
    return current_user


_SEED_CLIENT_IDS = {"demo", "ifb", "tata_motors", "global_demo"}

_logger = logging.getLogger("disruptiq.auth")


async def get_optional_user(
    authorization: str = Header(None),
    x_demo_session: str = Header(None),
) -> dict:
    if authorization:
        token = _extract_bearer_token(authorization)
        return verify_jwt_token(token, expected_type="access")
    if x_demo_session:
        # Only accept known seed IDs; arbitrary values would allow cross-tenant access.
        if x_demo_session not in _SEED_CLIENT_IDS:
            _logger.warning("Rejected non-seed X-Demo-Session header value: %r", x_demo_session[:40])
            x_demo_session = "demo"
        return {
            "client_id": x_demo_session,
            "email": f"{x_demo_session}@disruptiq.dev",
            "company_name": "Demo",
        }
    return dict(DEMO_USER)


def generate_reset_token() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
