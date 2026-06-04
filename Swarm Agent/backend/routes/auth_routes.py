"""
routes/auth_routes.py - /api/auth/* router.

Authentication endpoints: signup, login, profile, sessions, password
management. Shared state and helpers remain in main.py and are imported
lazily inside each handler to avoid a circular import.
"""

import asyncio
import csv
import hashlib
import io
import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

import auth
import config
import email_service
import storage
from models import (
    SignupRequest, LoginRequest, UpdateCompanyRequest, UpdateProfileRequest,
    ImportSuppliersRequest, ChangePasswordRequest, ForgotPasswordRequest,
    VerifyResetTokenRequest, ResetPasswordRequest,
)

logger = logging.getLogger("disruptiq.routes.auth")

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/signup")
async def signup(req: SignupRequest, request: Request):
    """Register new user and create client."""
    from main import (users_db, clients_db, sessions_db,
                      _now_utc, _parse_utc, _normalize_zone, _ensure_client_defaults,
                      _seed_client_scenarios, _mark_onboarding_step, _save_local_state,
                      _create_notification, _extract_device_info, send_registration_email)
    email = req.email.lower().strip()

    if email in users_db:
        raise HTTPException(status_code=400, detail="Email already registered")
    if not auth.validate_email_format(email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    strength = auth.validate_password_strength(req.password)
    if not strength["valid"]:
        raise HTTPException(status_code=400, detail=f"Password requirements: {'; '.join(strength['errors'])}")

    client_id = f"client_{secrets.token_hex(8)}"
    registration_time = _now_utc()
    hq_zone_raw = (req.headquarters_zone or "").strip()
    hq_zone_resolved = _normalize_zone(hq_zone_raw) if hq_zone_raw else ""
    clients_db[client_id] = {
        "company_name": req.company_name,
        "industry": req.industry,
        "suppliers": [],
        "headquarters_zone": hq_zone_resolved,
        "headquarters_zone_raw": hq_zone_raw,
        "created_at": registration_time,
        "updated_at": registration_time,
        "status": "active",
        "subscription_tier": "Explorer",
        "supplier_count": 0,
        "owner_email": email,
    }
    _ensure_client_defaults(client_id)
    _seed_client_scenarios(client_id, req.industry)

    password_hash, salt = auth.hash_password(req.password)
    users_db[email] = {
        "password_hash": password_hash,
        "salt": salt,
        "client_id": client_id,
        "company_name": req.company_name,
        "industry": req.industry,
        "contact_name": req.contact_name,
        "created_at": registration_time,
        "last_login": registration_time,
        "is_active": True,
        "session_generation": 0,
    }
    _mark_onboarding_step(client_id, "account_created", True)
    _save_local_state()

    storage.write_audit(
        event_id=f"registration_{client_id}",
        agent="OnboardingSystem",
        action="new_user_signup",
        input_summary=f"email={email}",
        output_summary=f"client_id={client_id} | company={req.company_name} | industry={req.industry}",
        client_id=client_id,
    )
    _create_notification(client_id, "account", "Welcome to DisruptIQ",
                         "Your account is ready. Import suppliers to finish onboarding.",
                         f"/dashboard/{client_id}")

    asyncio.create_task(asyncio.to_thread(
        send_registration_email,
        email, req.company_name, client_id, registration_time,
        req.industry, req.contact_name,
    ))

    token = auth.create_jwt_token(
        email, client_id,
        remember_me=req.remember_me,
        extra_claims={"company_name": req.company_name, "session_generation": 0},
    )

    decoded = auth.verify_jwt_token(token)
    jti = decoded.get("jti", "")
    now_dt = datetime.now(timezone.utc)
    expired_jtis = [
        j for j, s in list(sessions_db.items())
        if s.get("email") == email and _parse_utc(s.get("issued_at")) and
        (now_dt - _parse_utc(s["issued_at"])).total_seconds() > config.JWT_EXPIRY_HOURS * 3600
    ]
    for j in expired_jtis:
        sessions_db.pop(j, None)

    device_info = _extract_device_info(request)
    sessions_db[jti] = {
        "jti": jti,
        "email": email,
        "client_id": client_id,
        "browser": device_info["browser"],
        "device": device_info["device"],
        "ip": request.client.host if request.client else "unknown",
        "issued_at": _now_utc(),
        "remember_me": req.remember_me,
    }

    return {
        "success": True,
        "client_id": client_id,
        "token": token,
        "email": email,
        "company_name": req.company_name,
        "registration_time": registration_time,
        "message": "Account created successfully",
    }


@auth_router.post("/login")
async def login(req: LoginRequest, request: Request):
    """Login user and return JWT token."""
    from main import (users_db, clients_db, sessions_db,
                      _now_utc, _extract_device_info)
    email = req.email.lower().strip()

    if email not in users_db:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user = users_db[email]
    if not auth.verify_password(req.password, user["password_hash"], user["salt"]):
        storage.write_audit(
            event_id=f"login_{user.get('client_id', 'unknown')}",
            agent="AuthenticationSystem",
            action="login_failed",
            input_summary=f"email={email}",
            output_summary="Invalid credentials",
            status="DENIED",
            client_id=user.get("client_id"),
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if clients_db.get(user.get("client_id"), {}).get("suspended"):
        storage.write_audit(
            event_id=f"login_{user.get('client_id', 'unknown')}",
            agent="AuthenticationSystem",
            action="login_blocked_suspended",
            input_summary=f"email={email}",
            output_summary="Account suspended",
            status="DENIED",
            client_id=user.get("client_id"),
        )
        raise HTTPException(status_code=403, detail="This account has been suspended. Contact support.")

    if clients_db.get(user.get("client_id"), {}).get("deleted_at"):
        raise HTTPException(status_code=403, detail="This account has been deleted.")

    auth.reset_rate_limit(email, "login_attempts")
    user["last_login"] = _now_utc()

    if auth.needs_rehash(user["salt"]):
        new_hash, new_salt = auth.hash_password(req.password)
        user["password_hash"] = new_hash
        user["salt"] = new_salt

    token = auth.create_jwt_token(
        email, user["client_id"],
        remember_me=req.remember_me,
        extra_claims={
            "company_name": user["company_name"],
            "session_generation": user.get("session_generation", 0),
        },
    )

    decoded = auth.verify_jwt_token(token)
    jti = decoded.get("jti", "")
    device_info = _extract_device_info(request)
    sessions_db[jti] = {
        "jti": jti,
        "email": email,
        "client_id": user["client_id"],
        "browser": device_info["browser"],
        "device": device_info["device"],
        "ip": request.client.host if request.client else "unknown",
        "issued_at": _now_utc(),
        "remember_me": req.remember_me,
    }

    storage.write_audit(
        event_id=f"login_{user['client_id']}",
        agent="AuthenticationSystem",
        action="login_success",
        input_summary=f"email={email}",
        output_summary="Authenticated",
        client_id=user["client_id"],
    )
    max_age = 86400 * 30 if req.remember_me else 86400

    response = JSONResponse(
        content={
            "success": True,
            "token": token,
            "client_id": user["client_id"],
            "company_name": user["company_name"],
            "email": email,
        },
        status_code=200,
    )
    response.set_cookie(
        key="auth_token", value=token, max_age=max_age,
        httponly=True,
        secure=config.APP_BASE_URL.startswith("https://"),
        samesite="Strict", path="/",
    )
    return response


@auth_router.get("/me")
async def get_current_user_info(current_user: dict = Depends(auth.require_auth)):
    """Get current logged-in user info."""
    from main import users_db, _ensure_client_defaults, _supplier_limit
    email = current_user["email"]
    user = users_db.get(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    client = _ensure_client_defaults(user["client_id"])
    session_generation = user.get("session_generation", 0)
    if current_user.get("session_generation", session_generation) != session_generation:
        raise HTTPException(status_code=401, detail="Session expired")
    return {
        "email": email,
        "company_name": user["company_name"],
        "industry": user["industry"],
        "contact_name": user.get("contact_name", ""),
        "client_id": user["client_id"],
        "supplier_count": len(client.get("suppliers", [])),
        "created_at": user["created_at"],
        "last_login": user.get("last_login", user["created_at"]),
        "plan": user.get("plan", "Explorer"),
        "premium": bool(client.get("premium")),
        "plan_label": "Pro" if client.get("premium") else "Free",
        "supplier_limit": _supplier_limit(user["client_id"]),
    }


@auth_router.post("/update-company")
async def update_company(req: UpdateCompanyRequest, current_user: dict = Depends(auth.require_auth)):
    """Update company details for user's client during signup."""
    from main import (users_db, clients_db, _now_utc, _normalize_zone,
                      _ensure_client_defaults)
    if req.client_id != current_user["client_id"]:
        raise HTTPException(status_code=403, detail="Cannot update another client's details")

    email = current_user["email"]
    if email not in users_db:
        raise HTTPException(status_code=404, detail="User not found")

    users_db[email]["company_name"] = req.company_name
    users_db[email]["industry"] = req.industry
    users_db[email]["contact_name"] = req.contact_name

    if req.client_id in clients_db:
        clients_db[req.client_id]["company_name"] = req.company_name
        clients_db[req.client_id]["industry"] = req.industry
        clients_db[req.client_id]["updated_at"] = _now_utc()
        hq_raw = (req.headquarters_zone or "").strip()
        if hq_raw:
            clients_db[req.client_id]["headquarters_zone"] = _normalize_zone(hq_raw) or hq_raw
            clients_db[req.client_id]["headquarters_zone_raw"] = hq_raw
        _ensure_client_defaults(req.client_id)
    storage.write_audit(
        event_id=f"profile_{req.client_id}",
        agent="AuthenticationSystem",
        action="profile_updated",
        input_summary=f"email={email}",
        output_summary=f"company={req.company_name} | industry={req.industry}",
        client_id=req.client_id,
    )

    return {
        "success": True,
        "message": "Company details updated",
        "company_name": req.company_name,
        "industry": req.industry,
        "contact_name": req.contact_name,
    }


@auth_router.put("/update-profile")
async def update_profile(req: UpdateProfileRequest, current_user: dict = Depends(auth.require_auth)):
    from main import users_db, _ensure_client_defaults, _now_utc
    email = current_user["email"]
    user = users_db.get(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    client_id = user["client_id"]
    user["company_name"] = req.company_name
    user["industry"] = req.industry
    user["contact_name"] = req.contact_name
    client = _ensure_client_defaults(client_id)
    client["company_name"] = req.company_name
    client["industry"] = req.industry
    client["updated_at"] = _now_utc()
    storage.write_audit(
        event_id=f"profile_{client_id}",
        agent="AuthenticationSystem",
        action="profile_updated",
        input_summary=f"email={email}",
        output_summary=f"company={req.company_name} | industry={req.industry}",
        client_id=client_id,
    )
    return {"success": True, "updated_fields": req.model_dump() if hasattr(req, "model_dump") else req.dict()}


@auth_router.post("/import-suppliers")
async def import_suppliers(req: ImportSuppliersRequest, current_user: dict = Depends(auth.require_auth)):
    """Import suppliers from CSV for user's client."""
    from main import (clients_db, SEED_CLIENT_IDS, ZONE_COORDINATES,
                      _supplier_limit, _now_utc, _save_local_state,
                      _mark_onboarding_step, _create_notification)
    client_id = current_user["client_id"]
    if client_id in SEED_CLIENT_IDS:
        raise HTTPException(status_code=403, detail="Seed/demo accounts cannot import suppliers.")
    client = clients_db.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    try:
        reader = csv.DictReader(io.StringIO(req.csv_content))
        suppliers = []
        warnings = []

        for idx, row in enumerate(reader, 1):
            name = row.get("supplier_name", "").strip()
            location = row.get("location", "").strip()
            category = row.get("category", "").strip()

            if not name or not location or not category:
                warnings.append(f"Row {idx}: Missing required fields, skipping")
                continue

            zone = location
            if location not in ZONE_COORDINATES:
                for known_zone in ZONE_COORDINATES.keys():
                    if location.lower() in known_zone.lower() or known_zone.lower() in location.lower():
                        zone = known_zone
                        break

            if zone not in ZONE_COORDINATES:
                warnings.append(f"Row {idx}: Unknown location '{location}', using default coordinates")
                zone = "Bengaluru"

            suppliers.append({
                "name": name, "zone": zone, "category": category,
                "reliability": 0.85, "buffer_stock_days": 7,
                "lead_time_days": 14, "criticality_score": 0.5,
            })

        if not suppliers:
            raise HTTPException(status_code=400, detail="No valid suppliers in CSV")

        limit_reached = False
        _limit = _supplier_limit(client_id)
        if len(suppliers) > _limit:
            warnings.append(
                f"Free plan is limited to {_limit} suppliers. Only the first {_limit} were imported. "
                "To add more, request Premium access in your account settings."
            )
            suppliers = suppliers[:_limit]
            limit_reached = True

        client["suppliers"] = suppliers
        client["supplier_count"] = len(suppliers)
        client["updated_at"] = _now_utc()
        _mark_onboarding_step(client_id, "suppliers_imported", True)
        _save_local_state()
        _create_notification(client_id, "import_success", "Suppliers imported",
                             f"{len(suppliers)} suppliers are now mapped to your account.", "/map")
        storage.write_audit(
            event_id=f"suppliers_{client_id}",
            agent="OnboardingSystem",
            action="supplier_csv_imported",
            input_summary=f"count={len(suppliers)}",
            output_summary=f"warnings={len(warnings)}",
            client_id=client_id,
        )

        return {
            "success": True,
            "supplier_count": len(suppliers),
            "limit_reached": limit_reached,
            "warnings": warnings,
            "message": f"Imported {len(suppliers)} suppliers successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.warning("CSV import error for client %s: %s", client_id, e)
        raise HTTPException(status_code=400, detail="Could not parse CSV. Check format and required fields.")


@auth_router.post("/logout")
async def logout(current_user: dict = Depends(auth.require_auth)):
    from main import sessions_db
    jti = current_user.get("jti", "")
    sessions_db.pop(jti, None)
    storage.write_audit(
        event_id=f"logout_{current_user['client_id']}",
        agent="AuthenticationSystem",
        action="logout",
        input_summary=f"email={current_user['email']}",
        output_summary="Session ended",
        client_id=current_user["client_id"],
    )
    return {"success": True, "message": "Logged out successfully"}


@auth_router.post("/logout-all")
async def logout_all(current_user: dict = Depends(auth.require_auth)):
    from main import users_db, sessions_db
    user = users_db.get(current_user["email"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user["session_generation"] = int(user.get("session_generation", 0)) + 1
    email = current_user["email"]
    for jti in [k for k, v in list(sessions_db.items()) if v.get("email") == email]:
        sessions_db.pop(jti, None)
    storage.write_audit(
        event_id=f"logout_all_{user['client_id']}",
        agent="AuthenticationSystem",
        action="logout_all",
        input_summary=f"email={current_user['email']}",
        output_summary="All sessions invalidated",
        client_id=user["client_id"],
    )
    return {"success": True}


@auth_router.get("/sessions")
async def list_sessions(current_user: dict = Depends(auth.require_auth)):
    from main import sessions_db
    email = current_user["email"]
    current_jti = current_user.get("jti", "")
    active = [
        {**s, "current": s["jti"] == current_jti}
        for s in sessions_db.values() if s.get("email") == email
    ]
    return {"sessions": sorted(active, key=lambda x: x["issued_at"], reverse=True)}


@auth_router.delete("/sessions/{jti}")
async def revoke_session(jti: str, current_user: dict = Depends(auth.require_auth)):
    from main import sessions_db
    s = sessions_db.get(jti)
    if not s or s.get("email") != current_user["email"]:
        raise HTTPException(status_code=404, detail="Session not found")
    if jti == current_user.get("jti"):
        raise HTTPException(status_code=400, detail="Use /logout to end current session")
    sessions_db.pop(jti)
    storage.write_audit(current_user["email"], "Auth", "session_revoked", jti, "remote", client_id=current_user["client_id"])
    return {"success": True}


@auth_router.post("/change-password")
async def change_password(req: ChangePasswordRequest, current_user: dict = Depends(auth.require_auth)):
    """Change password for logged-in user."""
    from main import users_db, _create_notification
    email = current_user["email"]
    user = users_db.get(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not auth.verify_password(req.current_password, user["password_hash"], user["salt"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    strength = auth.validate_password_strength(req.new_password)
    if not strength["valid"]:
        raise HTTPException(status_code=400, detail=f"Password requirements: {'; '.join(strength['errors'])}")

    password_hash, salt = auth.hash_password(req.new_password)
    user["password_hash"] = password_hash
    user["salt"] = salt

    storage.write_audit(
        event_id=f"password_change_{user['client_id']}",
        agent="AuthenticationSystem",
        action="password_changed_by_user",
        input_summary=f"email={email}",
        output_summary="Password successfully updated",
        client_id=user["client_id"],
    )
    _create_notification(user["client_id"], "security", "Password changed",
                         "Your DisruptIQ password was updated successfully.", "/settings")

    company_name = user.get("company_name", "DisruptIQ User")
    email_service.send_password_changed_confirmation(email=email, company_name=company_name)

    return {"success": True, "message": "Password has been changed successfully"}


@auth_router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, request: Request):
    """Initiate password reset flow. No auth required."""
    from main import users_db, password_reset_tokens, _now_utc, _parse_utc, _iso_after
    email = req.email.lower().strip()
    client_ip = request.client.host if request.client else "unknown"

    if not auth.check_rate_limit(email, "reset_attempts") or not auth.check_rate_limit(client_ip, "reset_attempts"):
        retry_after = auth.get_rate_limit_retry_after(email, "reset_attempts")
        raise HTTPException(status_code=429, detail=f"Reset email already sent. Retry in {retry_after} seconds.")

    if email not in users_db:
        return {"success": True, "message": "If an account with that email exists, a reset link will be sent."}

    user = users_db[email]
    now_dt = datetime.now(timezone.utc)
    for stale in [
        t for t, d in list(password_reset_tokens.items())
        if (_parse_utc(d.get("expires_at")) or now_dt) < now_dt
    ]:
        password_reset_tokens.pop(stale, None)

    token = auth.generate_reset_token()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    password_reset_tokens[token_hash] = {
        "email": email,
        "client_id": user["client_id"],
        "created_at": _now_utc(),
        "expires_at": _iso_after(1),
    }

    company_name = user.get("company_name", "DisruptIQ User")
    email_sent = email_service.send_password_reset_email(
        email=email, company_name=company_name, reset_token=token,
    )

    return {
        "success": True,
        "message": "If an account with that email exists, a reset link will be sent.",
        "email_sent": email_sent,
    }


@auth_router.post("/verify-reset-token")
async def verify_reset_token(req: VerifyResetTokenRequest):
    from main import password_reset_tokens, _parse_utc
    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    token_data = password_reset_tokens.get(token_hash)
    if not token_data:
        return {"valid": False}
    expires_at = _parse_utc(token_data["expires_at"])
    if not expires_at or datetime.now(timezone.utc) > expires_at:
        password_reset_tokens.pop(token_hash, None)
        return {"valid": False}
    return {"valid": True, "email": token_data["email"]}


@auth_router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    """Reset password using a valid token. No auth required."""
    from main import users_db, password_reset_tokens, _parse_utc, _create_notification
    if req.new_password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    strength = auth.validate_password_strength(req.new_password)
    if not strength["valid"]:
        raise HTTPException(status_code=400, detail=f"Password requirements: {'; '.join(strength['errors'])}")

    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    if token_hash not in password_reset_tokens:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    token_data = password_reset_tokens[token_hash]
    expires_at = _parse_utc(token_data["expires_at"])

    if expires_at and datetime.now(timezone.utc) > expires_at:
        del password_reset_tokens[token_hash]
        raise HTTPException(status_code=400, detail="Reset link has expired (1 hour max)")

    email = token_data["email"]
    if email not in users_db:
        raise HTTPException(status_code=404, detail="User not found")

    password_hash, salt = auth.hash_password(req.new_password)
    users_db[email]["password_hash"] = password_hash
    users_db[email]["salt"] = salt

    del password_reset_tokens[token_hash]

    user = users_db[email]
    storage.write_audit(
        event_id=f"password_reset_{user['client_id']}",
        agent="AuthenticationSystem",
        action="password_changed",
        input_summary=f"email={email}",
        output_summary="Password successfully updated",
        client_id=user["client_id"],
    )
    _create_notification(user["client_id"], "security", "Password reset complete",
                         "Your password has been reset successfully.", "/login")

    company_name = user.get("company_name", "DisruptIQ User")
    email_service.send_password_changed_confirmation(email=email, company_name=company_name)

    return {
        "success": True,
        "message": "Password has been reset successfully. You can now log in with your new password.",
    }
