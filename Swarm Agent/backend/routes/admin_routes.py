"""
routes/admin_routes.py — /api/admin/* + /api/account/request-premium router.

Owner-only Admin Console endpoints. Gated by ``auth.require_admin`` so
non-owners get 404 (keeping the surface invisible). Shared state
(``clients_db``, ``users_db``, ``sessions_db``, ``support_db``,
``feedback_db``, ``premium_requests_db``, ``self_deletions_db``,
``notifications_db``, ``custom_scenarios_db``) and helpers
(``_now_utc``, ``_parse_utc``, ``_save_local_state``,
``_admin_owner_email``, ``_admin_company_name``, ``_create_notification``,
``_purge_expired_deletions``, ``DELETE_GRACE_HOURS``, ``SEED_CLIENT_IDS``)
remain in main.py and are imported lazily inside each handler.
"""

import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

import auth
import config
import email_service
import storage
from models import SupportResponseRequest

logger = logging.getLogger("disruptiq.routes.admin")

admin_router = APIRouter(prefix="/api/admin", tags=["admin"])
account_router = APIRouter(prefix="/api/account", tags=["account"])


@admin_router.get("/health")
async def admin_health(current_user: dict = Depends(auth.require_admin)):
    """Light health check — confirms the admin router is mounted and the
    caller has admin privileges. Non-admins get 404 via require_admin."""
    return {"status": "ok", "router": "admin_routes",
            "admin_email": current_user.get("email")}


@admin_router.get("/overview")
async def admin_overview(current_user: dict = Depends(auth.require_admin)):
    """Platform usage metrics for the Admin Console."""
    from main import (clients_db, users_db, sessions_db, feedback_db, support_db,
                      custom_scenarios_db, premium_requests_db, self_deletions_db,
                      _now_utc, _parse_utc)
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    all_events = storage.list_events()
    nl_queries = storage.get_nl_queries()

    total_suppliers = sum(len(c.get("suppliers", [])) for c in clients_db.values())
    industries: dict[str, int] = {}
    signups_today = 0
    signups_7d = 0
    for u in users_db.values():
        ts = _parse_utc(u.get("created_at"))
        if ts:
            if ts.strftime("%Y-%m-%d") == today:
                signups_today += 1
            if (now - ts).days < 7:
                signups_7d += 1
        ind = u.get("industry") or "Unspecified"
        industries[ind] = industries.get(ind, 0) + 1

    def _event_day(e):
        ts = _parse_utc(e.get("created_at") or e.get("timestamp_utc") or e.get("triggered_at"))
        return ts.strftime("%Y-%m-%d") if ts else None

    return {
        "totals": {
            "clients": len(clients_db),
            "users": len(users_db),
            "suppliers": total_suppliers,
            "events": len(all_events),
            "active_sessions": len(sessions_db),
            "ai_interactions": len(nl_queries),
            "feedback": sum(len(v) for v in feedback_db.values()),
            "support_tickets": sum(len(v) for v in support_db.values()),
            "custom_scenarios": sum(len(v) for v in custom_scenarios_db.values()),
            "suspended_accounts": sum(1 for c in clients_db.values() if c.get("suspended")),
            "premium_accounts": sum(1 for c in clients_db.values() if c.get("premium")),
            "pending_premium_requests": sum(1 for r in premium_requests_db if r.get("status") == "pending"),
            "self_deletions": len(self_deletions_db),
            "survey_responses": len(storage.get_survey_responses()),
        },
        "signups": {"today": signups_today, "last_7_days": signups_7d},
        "avg_suppliers_per_client": round(total_suppliers / max(len(clients_db), 1), 1),
        "industries": [{"industry": k, "count": v} for k, v in sorted(industries.items(), key=lambda x: -x[1])],
        "ai_interactions_today": sum(1 for q in nl_queries if (_parse_utc(q.get("timestamp_utc")) or now).strftime("%Y-%m-%d") == today),
        "events_today": sum(1 for e in all_events if _event_day(e) == today),
        "generated_at": _now_utc(),
    }


@admin_router.get("/users")
async def admin_users(current_user: dict = Depends(auth.require_admin)):
    """Account management — every client/account with usage counts and status."""
    from main import (clients_db, SEED_CLIENT_IDS, _admin_owner_email,
                      _purge_expired_deletions)
    all_events = storage.list_events()
    nl_queries = storage.get_nl_queries()
    audit = storage.get_audit_log(5000)

    last_activity: dict[str, str] = {}
    for entry in audit:
        cid, ts = entry.get("client_id"), entry.get("timestamp_utc")
        if cid and ts and ts > last_activity.get(cid, ""):
            last_activity[cid] = ts

    events_by_client: dict[str, int] = {}
    for e in all_events:
        cid = e.get("client_id")
        events_by_client[cid] = events_by_client.get(cid, 0) + 1
    nlq_by_client: dict[str, int] = {}
    for q in nl_queries:
        cid = q.get("client_id")
        nlq_by_client[cid] = nlq_by_client.get(cid, 0) + 1

    _purge_expired_deletions()
    rows = []
    for cid, c in clients_db.items():
        if c.get("deleted_at"):
            continue
        owner_email = _admin_owner_email(cid) or ""
        rows.append({
            "client_id": cid,
            "company_name": c.get("company_name") or cid,
            "industry": c.get("industry") or "-",
            "email": owner_email,
            "created_at": c.get("created_at"),
            "supplier_count": len(c.get("suppliers", [])),
            "event_count": events_by_client.get(cid, 0),
            "ai_interaction_count": nlq_by_client.get(cid, 0),
            "last_active": last_activity.get(cid),
            "is_seed": cid in SEED_CLIENT_IDS,
            "is_admin": auth.is_admin_email(owner_email),
            "suspended": bool(c.get("suspended")),
            "premium": bool(c.get("premium")),
            "used_sample_dataset": bool(c.get("used_sample_dataset")),
        })
    rows.sort(key=lambda r: (r.get("created_at") or ""), reverse=True)
    return {"total": len(rows), "users": rows}


@admin_router.get("/activity")
async def admin_activity(limit: int = 200, current_user: dict = Depends(auth.require_admin)):
    """User activity logs / audit trail across all clients."""
    from main import _admin_company_name
    limit = max(1, min(limit, 2000))
    out = [{
        "id": e.get("id"),
        "client_id": e.get("client_id"),
        "company_name": _admin_company_name(e.get("client_id")),
        "event_id": e.get("event_id"),
        "agent": e.get("agent"),
        "action": e.get("action"),
        "input_summary": e.get("input_summary"),
        "output_summary": e.get("output_summary"),
        "status": e.get("status"),
        "timestamp_utc": e.get("timestamp_utc"),
    } for e in storage.get_audit_log(limit)]
    return {"total": len(out), "activity": out}


@admin_router.get("/ai-interactions")
async def admin_ai_interactions(limit: int = 200, current_user: dict = Depends(auth.require_admin)):
    """AI assistant (NL query) interactions across all clients."""
    from main import _admin_company_name
    limit = max(1, min(limit, 2000))
    queries = list(reversed(storage.get_nl_queries()))[:limit]
    out = []
    for q in queries:
        resp = q.get("response")
        resp_text = str(resp.get("answer") or resp.get("response") or resp) if isinstance(resp, dict) else str(resp or "")
        out.append({
            "id": q.get("id"),
            "client_id": q.get("client_id"),
            "company_name": _admin_company_name(q.get("client_id")),
            "event_id": q.get("event_id"),
            "question": q.get("question"),
            "response": resp_text[:500],
            "agent_context": q.get("agent_context"),
            "timestamp_utc": q.get("timestamp_utc"),
        })
    return {"total": len(out), "interactions": out}


@admin_router.get("/system-health")
async def admin_system_health(current_user: dict = Depends(auth.require_admin)):
    """System health and operational tracking."""
    from main import (clients_db, users_db, sessions_db, feedback_db, support_db,
                      custom_scenarios_db, notifications_db, _now_utc)
    return {
        "demo_mode": config.DEMO_MODE,
        "flags": {
            "llm_live": bool(getattr(config, "GITHUB_TOKEN", "")),
            "cosmos_live": bool(getattr(config, "COSMOS_ENDPOINT", "") and getattr(config, "COSMOS_KEY", "")),
            "email_live": bool(getattr(config, "EMAIL_ENABLED", False)),
            "newsapi_live": bool(getattr(config, "NEWSAPI_KEY", "")),
            "content_safety_live": bool(getattr(config, "CONTENT_SAFETY_ENDPOINT", "")),
        },
        "store_sizes": {
            "clients": len(clients_db),
            "users": len(users_db),
            "active_sessions": len(sessions_db),
            "events": len(storage.list_events()),
            "ai_interactions": len(storage.get_nl_queries()),
            "notifications": sum(len(v) for v in notifications_db.values()),
            "feedback": sum(len(v) for v in feedback_db.values()),
            "support_tickets": sum(len(v) for v in support_db.values()),
            "custom_scenarios": sum(len(v) for v in custom_scenarios_db.values()),
        },
        "generated_at": _now_utc(),
    }


@admin_router.post("/users/{client_id}/suspend")
async def admin_suspend_user(client_id: str, current_user: dict = Depends(auth.require_admin)):
    """Access control - suspend an account and force-logout its sessions (reversible)."""
    from main import (clients_db, sessions_db, SEED_CLIENT_IDS,
                      _admin_owner_email, _now_utc, _save_local_state)
    client = clients_db.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if client_id in SEED_CLIENT_IDS:
        raise HTTPException(status_code=400, detail="Seed/demo clients cannot be suspended")
    if auth.is_admin_email(_admin_owner_email(client_id)):
        raise HTTPException(status_code=400, detail="Cannot suspend an administrator account")

    client["suspended"] = True
    client["suspended_at"] = _now_utc()
    revoked = [jti for jti, s in list(sessions_db.items()) if s.get("client_id") == client_id]
    for jti in revoked:
        sessions_db.pop(jti, None)
    _save_local_state()
    storage.write_audit(
        event_id=f"admin_{client_id}", agent="AdminConsole", action="account_suspended",
        input_summary=f"by={current_user.get('email')}",
        output_summary=f"sessions_revoked={len(revoked)}", client_id=client_id,
    )
    return {"success": True, "client_id": client_id, "suspended": True, "sessions_revoked": len(revoked)}


@admin_router.post("/users/{client_id}/reactivate")
async def admin_reactivate_user(client_id: str, current_user: dict = Depends(auth.require_admin)):
    """Access control - lift a suspension."""
    from main import clients_db, _now_utc, _save_local_state
    client = clients_db.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client["suspended"] = False
    client.pop("suspended_at", None)
    _save_local_state()
    storage.write_audit(
        event_id=f"admin_{client_id}", agent="AdminConsole", action="account_reactivated",
        input_summary=f"by={current_user.get('email')}", output_summary="reactivated", client_id=client_id,
    )
    return {"success": True, "client_id": client_id, "suspended": False}


@account_router.post("/request-premium")
async def request_premium(current_user: dict = Depends(auth.require_auth)):
    """User-facing - submit a Premium upgrade request for owner approval."""
    from main import (clients_db, users_db, premium_requests_db,
                      _now_utc, _create_notification)
    client_id = current_user["client_id"]
    client = clients_db.get(client_id) or {}
    if client.get("premium"):
        return {"success": True, "status": "approved", "message": "Your account already has Premium access."}
    existing = next((r for r in premium_requests_db if r["client_id"] == client_id and r["status"] == "pending"), None)
    if existing:
        return {"success": True, "status": "pending", "request_id": existing["id"],
                "message": "Your Premium request is already pending review."}
    req = {
        "id": f"PR-{secrets.token_hex(4).upper()}",
        "client_id": client_id,
        "company_name": client.get("company_name") or current_user.get("company_name") or client_id,
        "email": current_user.get("email", ""),
        "status": "pending",
        "requested_at": _now_utc(),
        "decided_at": None,
        "decided_by": None,
    }
    storage.write_premium_request(req)
    premium_requests_db.append(req)
    storage.write_audit(event_id=f"premium_{client_id}", agent="PremiumRequest", action="requested",
                        input_summary=f"email={req['email']}", output_summary="pending", client_id=client_id)
    for em in config.ADMIN_EMAILS:
        admin_cid = next((u.get("client_id") for e2, u in users_db.items() if e2.lower() == em), None)
        if admin_cid:
            _create_notification(admin_cid, "premium_request", "New Premium request",
                                 f"{req['company_name']} ({req['email']}) requested Premium access.", "/admin")
    return {"success": True, "status": "pending", "request_id": req["id"],
            "message": "Request sent. An admin will review it shortly."}


@admin_router.get("/premium-requests")
async def admin_premium_requests(current_user: dict = Depends(auth.require_admin)):
    from main import clients_db, premium_requests_db
    rows = []
    for r in reversed(premium_requests_db):
        c = clients_db.get(r["client_id"]) or {}
        rows.append({**r, "current_premium": bool(c.get("premium")), "supplier_count": len(c.get("suppliers", []))})
    return {"total": len(rows), "pending": sum(1 for r in premium_requests_db if r["status"] == "pending"), "requests": rows}


@admin_router.post("/premium-requests/{request_id}/approve")
async def admin_approve_premium(request_id: str, current_user: dict = Depends(auth.require_admin)):
    from main import (clients_db, premium_requests_db, _now_utc,
                      _save_local_state, _create_notification, _admin_owner_email)
    req = next((r for r in premium_requests_db if r["id"] == request_id), None)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    client = clients_db.get(req["client_id"])
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client["premium"] = True
    client["premium_granted_at"] = _now_utc()
    req["status"] = "approved"
    req["decided_at"] = _now_utc()
    req["decided_by"] = current_user.get("email")
    storage.write_premium_request(req)
    _save_local_state()
    storage.write_audit(event_id=f"premium_{req['client_id']}", agent="AdminConsole", action="premium_approved",
                        input_summary=f"by={current_user.get('email')}", output_summary=req["id"], client_id=req["client_id"])
    _create_notification(req["client_id"], "premium_approved", "Premium access approved",
                         "Your account can now add unlimited suppliers. Thank you!", "/account/suppliers")
    owner_email = _admin_owner_email(req["client_id"]) or req.get("email", "")
    if owner_email:
        asyncio.create_task(asyncio.to_thread(email_service.send_premium_approved_email, owner_email, req.get("company_name") or ""))
    return {"success": True, "request_id": request_id, "status": "approved"}


@admin_router.post("/premium-requests/{request_id}/deny")
async def admin_deny_premium(request_id: str, current_user: dict = Depends(auth.require_admin)):
    from main import premium_requests_db, _now_utc, _create_notification
    req = next((r for r in premium_requests_db if r["id"] == request_id), None)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    req["status"] = "denied"
    req["decided_at"] = _now_utc()
    req["decided_by"] = current_user.get("email")
    storage.write_premium_request(req)
    storage.write_audit(event_id=f"premium_{req['client_id']}", agent="AdminConsole", action="premium_denied",
                        input_summary=f"by={current_user.get('email')}", output_summary=req["id"], client_id=req["client_id"])
    _create_notification(req["client_id"], "premium_denied", "Premium request update",
                         "Your Premium access request was not approved at this time. Contact support for details.", "/account")
    return {"success": True, "request_id": request_id, "status": "denied"}


@admin_router.get("/support")
async def admin_support(current_user: dict = Depends(auth.require_admin)):
    from main import support_db, _admin_company_name
    rows = []
    for cid, tickets in support_db.items():
        for t in tickets:
            rows.append({**t, "client_id": cid, "company_name": _admin_company_name(cid)})
    rows.sort(key=lambda r: (r.get("created_at") or ""), reverse=True)
    return {"total": len(rows), "tickets": rows}


@admin_router.get("/feedback")
async def admin_feedback(current_user: dict = Depends(auth.require_admin)):
    from main import feedback_db, _admin_company_name
    rows = []
    for cid, items in feedback_db.items():
        for f in items:
            rows.append({**f, "client_id": cid, "company_name": _admin_company_name(cid)})
    rows.sort(key=lambda r: (r.get("created_at") or ""), reverse=True)
    ratings = [r.get("rating") for r in rows if isinstance(r.get("rating"), (int, float))]
    return {"total": len(rows), "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else 0, "feedback": rows}


@admin_router.post("/users/{client_id}/revoke-premium")
async def admin_revoke_premium(client_id: str, current_user: dict = Depends(auth.require_admin)):
    """Access control - revoke previously granted Premium access (reversible)."""
    from main import (clients_db, premium_requests_db, _now_utc,
                      _save_local_state, _create_notification)
    client = clients_db.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client["premium"] = False
    client.pop("premium_granted_at", None)
    for r in premium_requests_db:
        if r["client_id"] == client_id and r["status"] == "approved":
            r["status"] = "revoked"
            r["decided_at"] = _now_utc()
            r["decided_by"] = current_user.get("email")
            storage.write_premium_request(r)
    _save_local_state()
    storage.write_audit(event_id=f"premium_{client_id}", agent="AdminConsole", action="premium_revoked",
                        input_summary=f"by={current_user.get('email')}", output_summary="revoked", client_id=client_id)
    _create_notification(client_id, "premium_revoked", "Premium access updated",
                         "Your Premium access has been removed. Your account is back on the free plan (30 suppliers).", "/account")
    return {"success": True, "client_id": client_id, "premium": False}


@admin_router.post("/users/{client_id}/grant-premium")
async def admin_grant_premium(client_id: str, current_user: dict = Depends(auth.require_admin)):
    """Access control - grant Premium directly (works regardless of request state)."""
    from main import (clients_db, premium_requests_db, _now_utc,
                      _save_local_state, _create_notification, _admin_owner_email)
    client = clients_db.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client["premium"] = True
    client["premium_granted_at"] = _now_utc()
    for r in premium_requests_db:
        if r["client_id"] == client_id and r["status"] in ("pending", "revoked", "denied"):
            r["status"] = "approved"
            r["decided_at"] = _now_utc()
            r["decided_by"] = current_user.get("email")
            storage.write_premium_request(r)
    _save_local_state()
    storage.write_audit(event_id=f"premium_{client_id}", agent="AdminConsole", action="premium_granted",
                        input_summary=f"by={current_user.get('email')}", output_summary="granted", client_id=client_id)
    owner_email = _admin_owner_email(client_id)
    if owner_email:
        asyncio.create_task(asyncio.to_thread(email_service.send_premium_approved_email, owner_email, client.get("company_name") or ""))
    _create_notification(client_id, "premium_approved", "Premium access approved",
                         "Your account can now add unlimited suppliers. Thank you!", "/account/suppliers")
    return {"success": True, "client_id": client_id, "premium": True}


@admin_router.post("/support/{ticket_id}/respond")
async def admin_respond_support(ticket_id: str, req: SupportResponseRequest,
                                current_user: dict = Depends(auth.require_admin)):
    """Reply to a support ticket (optionally mark resolved) and email the customer."""
    from main import (support_db, _now_utc, _save_local_state,
                      _create_notification, _admin_owner_email, _admin_company_name)
    found, found_cid = None, None
    for cid, tickets in support_db.items():
        for t in tickets:
            if t.get("ticket_id") == ticket_id:
                found, found_cid = t, cid
                break
        if found:
            break
    if not found:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msg = (req.message or "").strip()
    if not msg:
        raise HTTPException(status_code=422, detail="Response message is required")
    found["admin_response"] = msg
    found["responded_at"] = _now_utc()
    found["responded_by"] = current_user.get("email")
    found["status"] = "resolved" if req.resolved else "responded"
    storage.write_support_ticket({**found, "client_id": found_cid})
    _save_local_state()
    owner_email = _admin_owner_email(found_cid) or found.get("email", "")
    company = _admin_company_name(found_cid)
    if owner_email:
        email_service.send_support_response_email(owner_email, company, ticket_id,
                                                  found.get("category", ""), msg, req.resolved)
    _create_notification(found_cid, "support_response",
                         "Support replied to your ticket" + (" (resolved)" if req.resolved else ""),
                         msg[:140] + ("..." if len(msg) > 140 else ""), "/account")
    storage.write_audit(event_id=f"support_{found_cid}", agent="AdminConsole", action="support_responded",
                        input_summary=f"ticket={ticket_id} resolved={req.resolved}", output_summary="sent", client_id=found_cid)
    return {"success": True, "ticket_id": ticket_id, "status": found["status"]}


@admin_router.post("/users/{client_id}/delete")
async def admin_delete_account(client_id: str, current_user: dict = Depends(auth.require_admin)):
    """Soft-delete an account (48h restore window). Hidden from Accounts; force-logout."""
    from main import (clients_db, sessions_db, SEED_CLIENT_IDS, DELETE_GRACE_HOURS,
                      _admin_owner_email, _now_utc, _save_local_state)
    client = clients_db.get(client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if client_id in SEED_CLIENT_IDS:
        raise HTTPException(status_code=400, detail="Seed/demo accounts cannot be deleted")
    if auth.is_admin_email(_admin_owner_email(client_id)):
        raise HTTPException(status_code=400, detail="Administrator accounts cannot be deleted")
    now = datetime.now(timezone.utc)
    client["deleted_at"] = _now_utc()
    client["deleted_by"] = current_user.get("email")
    client["deleted_expires_at"] = (now + timedelta(hours=DELETE_GRACE_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    client["suspended"] = True
    for jti in [j for j, s in list(sessions_db.items()) if s.get("client_id") == client_id]:
        sessions_db.pop(jti, None)
    _save_local_state()
    storage.write_audit(event_id=f"admin_{client_id}", agent="AdminConsole", action="account_soft_deleted",
                        input_summary=f"by={current_user.get('email')}", output_summary=f"purge_at={client['deleted_expires_at']}", client_id=client_id)
    return {"success": True, "client_id": client_id, "deleted_at": client["deleted_at"], "expires_at": client["deleted_expires_at"]}


@admin_router.get("/deleted-accounts")
async def admin_deleted_accounts(current_user: dict = Depends(auth.require_admin)):
    from main import (clients_db, _purge_expired_deletions, _parse_utc,
                      _admin_owner_email)
    _purge_expired_deletions()
    now = datetime.now(timezone.utc)
    rows = []
    for cid, c in clients_db.items():
        if not c.get("deleted_at"):
            continue
        exp = _parse_utc(c.get("deleted_expires_at"))
        hours_left = max(0, round((exp - now).total_seconds() / 3600, 1)) if exp else None
        rows.append({
            "client_id": cid,
            "company_name": c.get("company_name") or cid,
            "email": _admin_owner_email(cid) or "",
            "deleted_at": c.get("deleted_at"),
            "deleted_by": c.get("deleted_by"),
            "expires_at": c.get("deleted_expires_at"),
            "hours_left": hours_left,
            "supplier_count": len(c.get("suppliers", [])),
        })
    rows.sort(key=lambda r: (r.get("deleted_at") or ""), reverse=True)
    return {"total": len(rows), "accounts": rows}


@admin_router.post("/deleted-accounts/{client_id}/restore")
async def admin_restore_account(client_id: str, current_user: dict = Depends(auth.require_admin)):
    from main import clients_db, _now_utc, _save_local_state
    client = clients_db.get(client_id)
    if not client or not client.get("deleted_at"):
        raise HTTPException(status_code=404, detail="Deleted account not found")
    client.pop("deleted_at", None)
    client.pop("deleted_by", None)
    client.pop("deleted_expires_at", None)
    client["suspended"] = False
    _save_local_state()
    storage.write_audit(event_id=f"admin_{client_id}", agent="AdminConsole", action="account_restored",
                        input_summary=f"by={current_user.get('email')}", output_summary="restored", client_id=client_id)
    return {"success": True, "client_id": client_id, "restored": True}


@admin_router.get("/self-deletions")
async def admin_self_deletions(current_user: dict = Depends(auth.require_admin)):
    """Self-initiated account deletions with reasons."""
    from main import self_deletions_db
    rows = sorted(self_deletions_db, key=lambda r: r.get("deleted_at") or "", reverse=True)
    return {"total": len(rows), "deletions": rows}


@admin_router.get("/surveys")
async def admin_surveys(current_user: dict = Depends(auth.require_admin)):
    """Landing-page product-survey responses (public submissions), newest first."""
    rows = sorted(storage.get_survey_responses(),
                  key=lambda r: r.get("created_at") or "", reverse=True)

    def _tally(field: str) -> list[dict]:
        counts: dict[str, int] = {}
        for r in rows:
            v = (r.get(field) or "").strip()
            if v:
                counts[v] = counts.get(v, 0) + 1
        return [{"label": k, "count": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]

    return {
        "total": len(rows),
        "with_email": sum(1 for r in rows if (r.get("email") or "").strip()),
        "by_role": _tally("role"),
        "by_challenge": _tally("challenge"),
        "by_feature": _tally("feature"),
        "responses": rows,
    }
