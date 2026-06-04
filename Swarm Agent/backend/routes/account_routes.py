"""
routes/account_routes.py - account/notifications/feedback/support endpoints.

Shared state and helpers remain in main.py and are imported lazily inside
each handler to avoid a circular import.
"""

import asyncio
import io
import json
import logging
import secrets
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse

import auth
import email_service
import storage
from models import (
    AccountResetRequest, DeleteAccountRequest, FeedbackRequest,
    NotificationReadRequest, NotificationSettingsRequest,
    SupportRequest, SurveyRequest, VerifyResetTokenRequest,
)

logger = logging.getLogger("disruptiq.routes.account")

notifications_router = APIRouter(tags=["account"])
account_settings_router = APIRouter(prefix="/api/account", tags=["account"])
feedback_router = APIRouter(tags=["account"])


@notifications_router.get("/api/notifications")
async def list_notifications(current_user: dict = Depends(auth.require_auth)):
    from main import notifications_db
    items = [item for item in notifications_db[current_user["client_id"]] if not item.get("dismissed")]
    return {
        "notifications": items[:100],
        "unread_count": sum(1 for item in items if not item.get("read")),
    }


@notifications_router.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, current_user: dict = Depends(auth.require_auth)):
    from main import notifications_db
    for item in notifications_db[current_user["client_id"]]:
        if item["id"] == notification_id:
            item["read"] = True
            return {"success": True}
    raise HTTPException(status_code=404, detail="Notification not found")


@notifications_router.post("/api/notifications/read-all")
async def mark_all_notifications_read(current_user: dict = Depends(auth.require_auth)):
    from main import notifications_db
    count = 0
    for item in notifications_db[current_user["client_id"]]:
        if not item.get("read"):
            item["read"] = True
            count += 1
    return {"success": True, "marked_count": count}


@notifications_router.delete("/api/notifications/{notification_id}")
async def delete_notification(notification_id: str, current_user: dict = Depends(auth.require_auth)):
    from main import notifications_db
    notifications = notifications_db[current_user["client_id"]]
    new_notifications = [item for item in notifications if item["id"] != notification_id]
    if len(new_notifications) == len(notifications):
        raise HTTPException(status_code=404, detail="Notification not found")
    notifications_db[current_user["client_id"]] = new_notifications
    return {"success": True}


@notifications_router.get("/api/onboarding/checklist")
async def get_onboarding_checklist(current_user: dict = Depends(auth.require_auth)):
    from main import ONBOARDING_STEPS, _client_user, _percent
    _, client = _client_user(current_user)
    steps = []
    checklist = client.get("onboarding_checklist", {})
    for step in ONBOARDING_STEPS:
        steps.append({**step, "complete": bool(checklist.get(step["id"]))})
    progress = _percent(sum(1 for step in steps if step["complete"]), len(steps))
    return {"steps": steps, "progress_pct": progress}


@notifications_router.put("/api/onboarding/checklist/{step_id}")
async def update_onboarding_step(step_id: str, req: NotificationReadRequest,
                                 current_user: dict = Depends(auth.require_auth)):
    from main import _mark_onboarding_step
    _mark_onboarding_step(current_user["client_id"], step_id, req.complete)
    return await get_onboarding_checklist(current_user)


@account_settings_router.get("/notifications")
async def get_notification_settings(current_user: dict = Depends(auth.require_auth)):
    from main import clients_db, DEFAULT_NOTIFICATION_SETTINGS, _ensure_client_defaults
    client_id = current_user["client_id"]
    _ensure_client_defaults(client_id)
    settings = clients_db.get(client_id, {}).get("settings", {}).get("notifications", {})
    return {"settings": {**DEFAULT_NOTIFICATION_SETTINGS, **settings}}


@account_settings_router.put("/notifications")
async def update_notification_settings(req: NotificationSettingsRequest,
                                       current_user: dict = Depends(auth.require_auth)):
    from main import _client_user, _now_utc
    _, client = _client_user(current_user)
    client["settings"]["notifications"] = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    client["updated_at"] = _now_utc()
    return {"success": True, "settings": client["settings"]["notifications"]}


@account_settings_router.post("/test-email")
async def send_test_email(current_user: dict = Depends(auth.require_auth)):
    from main import _client_user
    user, client = _client_user(current_user)
    sent = email_service.send_welcome_email(
        email=user.get("email") or current_user["email"],
        company_name=client.get("company_name", user.get("company_name", "DisruptIQ Client")),
        client_id=user["client_id"],
        industry=user.get("industry", ""),
        contact_name=user.get("contact_name", ""),
        created_at=user.get("created_at"),
    )
    return {"success": sent}


@account_settings_router.post("/delete")
async def request_account_delete(req: DeleteAccountRequest = Body(default=None),
                                 current_user: dict = Depends(auth.require_auth)):
    """Delete account immediately."""
    from main import (clients_db, users_db, sessions_db, notifications_db,
                      custom_scenarios_db, feedback_db, support_db,
                      self_deletions_db, _now_utc, _save_local_state,
                      _event_count_for_client)
    if req is None:
        req = DeleteAccountRequest()
    email = current_user["email"]
    client_id = current_user["client_id"]
    user = users_db.get(email, {})
    client = clients_db.get(client_id, {})
    event_count = _event_count_for_client(client_id)
    supplier_count = len(client.get("suppliers", []))

    _REASON_LABELS = {
        "too_expensive": "Too expensive",
        "found_alternative": "Found an alternative",
        "not_useful": "Not useful for my needs",
        "privacy_concerns": "Privacy concerns",
        "missing_features": "Missing features I need",
        "poor_experience": "Poor experience",
        "other": "Other",
    }
    reason_key = (req.reason or "").strip()
    reason_label = req.reason_label.strip() if req.reason_label else _REASON_LABELS.get(reason_key, reason_key or "Not specified")
    self_deletions_db.append({
        "client_id": client_id,
        "company_name": client.get("company_name") or user.get("company_name") or client_id,
        "email": email,
        "reason": reason_key,
        "reason_label": reason_label,
        "deleted_at": _now_utc(),
        "supplier_count": supplier_count,
        "event_count": event_count,
        "was_premium": bool(client.get("premium")),
    })

    try:
        email_service.send_account_deletion_confirmation(
            email=email,
            company_name=client.get("company_name", user.get("company_name", "DisruptIQ Client")),
            client_id=client_id,
            deletion_token="",
            supplier_count=supplier_count,
            event_count=event_count,
        )
    except Exception as e:
        logger.warning("[account_delete] Goodbye email failed (continuing): %s", e)

    notifications_db.pop(client_id, None)
    clients_db.pop(client_id, None)
    users_db.pop(email, None)
    custom_scenarios_db.pop(client_id, None)
    feedback_db.pop(client_id, None)
    support_db.pop(client_id, None)
    sessions_to_remove = [jti for jti, s in sessions_db.items() if s.get("email") == email]
    for jti in sessions_to_remove:
        sessions_db.pop(jti, None)
    storage._mem_events = {eid: ev for eid, ev in storage._mem_events.items() if ev.get("client_id") != client_id}
    storage._mem_swarm_memory = [r for r in storage._mem_swarm_memory if r.get("client_id") != client_id]
    storage._mem_audit_log = [r for r in storage._mem_audit_log if r.get("client_id") != client_id]
    storage._mem_counterfactuals = [r for r in storage._mem_counterfactuals if r.get("client_id") != client_id]
    await asyncio.to_thread(_save_local_state)

    storage.write_audit(
        event_id=f"account_delete_{client_id}",
        agent="AccountSystem",
        action="account_deleted",
        input_summary=email,
        output_summary=f"events={event_count} suppliers={supplier_count}",
        client_id=client_id,
    )
    return {"success": True, "message": "Your account has been permanently deleted."}


@account_settings_router.post("/confirm-delete")
async def confirm_account_delete(req: VerifyResetTokenRequest,
                                 current_user: dict = Depends(auth.require_auth)):
    from main import (clients_db, users_db, sessions_db, notifications_db,
                      custom_scenarios_db, feedback_db, support_db,
                      account_deletion_tokens, _parse_utc)
    token_data = account_deletion_tokens.get(req.token)
    if not token_data:
        raise HTTPException(status_code=400, detail="Invalid or expired deletion token")
    expires_at = _parse_utc(token_data["expires_at"])
    if not expires_at or datetime.now(timezone.utc) > expires_at:
        account_deletion_tokens.pop(req.token, None)
        raise HTTPException(status_code=400, detail="Deletion token expired")
    client_id = token_data["client_id"]
    email = token_data["email"]
    notifications_db.pop(client_id, None)
    clients_db.pop(client_id, None)
    users_db.pop(email, None)
    custom_scenarios_db.pop(client_id, None)
    feedback_db.pop(client_id, None)
    support_db.pop(client_id, None)
    sessions_to_remove = [jti for jti, s in sessions_db.items() if s.get("email") == email]
    for jti in sessions_to_remove:
        sessions_db.pop(jti, None)
    storage._mem_events = {eid: ev for eid, ev in storage._mem_events.items() if ev.get("client_id") != client_id}
    storage._mem_swarm_memory = [r for r in storage._mem_swarm_memory if r.get("client_id") != client_id]
    storage._mem_audit_log = [r for r in storage._mem_audit_log if r.get("client_id") != client_id]
    storage._mem_counterfactuals = [r for r in storage._mem_counterfactuals if r.get("client_id") != client_id]
    storage.write_audit(
        event_id=f"account_delete_{client_id}",
        agent="AccountSystem",
        action="account_deleted",
        input_summary=email,
        output_summary="Client account deleted (token-confirmed)",
        client_id=client_id,
    )
    account_deletion_tokens.pop(req.token, None)
    return {"success": True, "message": "Account deleted"}


@account_settings_router.post("/reset-data")
async def reset_account_data(req: AccountResetRequest,
                             current_user: dict = Depends(auth.require_auth)):
    from main import _client_user
    user, client = _client_user(current_user)
    expected = f"DELETE {client.get('company_name', user.get('company_name', ''))}"
    if req.confirm != expected:
        raise HTTPException(status_code=400, detail="Confirmation text does not match")
    client_id = user["client_id"]
    events_deleted = len([event for event in storage.list_events() if event.get("client_id") == client_id])
    storage._mem_events = {eid: event for eid, event in storage._mem_events.items() if event.get("client_id") != client_id}
    storage._mem_swarm_memory = [record for record in storage._mem_swarm_memory if record.get("client_id") != client_id]
    storage._mem_audit_log = [record for record in storage._mem_audit_log if record.get("client_id") != client_id]
    storage._mem_counterfactuals = [record for record in storage._mem_counterfactuals if record.get("client_id") != client_id]
    storage._mem_config_events = [record for record in storage._mem_config_events if record.get("client_id") != client_id]
    storage.write_audit(
        event_id=f"account_reset_{client_id}",
        agent="AccountSystem",
        action="account_data_reset",
        input_summary=user.get("email") or current_user["email"],
        output_summary=f"events_deleted={events_deleted}",
        client_id=client_id,
    )
    return {"success": True, "deleted_counts": {"events": events_deleted}}


@account_settings_router.get("/export-data")
async def export_account_data(current_user: dict = Depends(auth.require_auth)):
    from main import _client_user, _make_suppliers_workbook
    user, client = _client_user(current_user)
    memory_records = [record for record in storage.get_memory_store(5000)
                      if record.get("client_id") == user["client_id"]]
    audit_rows = [record for record in storage.get_audit_log(5000)
                  if record.get("client_id") == user["client_id"]]
    events = [event for event in storage.list_events()
              if event.get("client_id") == user["client_id"]]

    suppliers_wb = _make_suppliers_workbook(client)
    supplier_bytes = io.BytesIO()
    suppliers_wb.save(supplier_bytes)
    supplier_bytes.seek(0)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("account_info.json", json.dumps({
            "email": user.get("email") or current_user["email"],
            "company_name": client.get("company_name"),
            "industry": client.get("industry"),
            "created_at": user.get("created_at"),
        }, indent=2))
        archive.writestr("suppliers.xlsx", supplier_bytes.read())
        archive.writestr("events.json", json.dumps(events, indent=2))
        archive.writestr("audit_log.json", json.dumps(audit_rows, indent=2))
        archive.writestr("memory_records.json", json.dumps(memory_records, indent=2))
    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=disruptiq_account_export.zip"},
    )


@feedback_router.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest, current_user: dict = Depends(auth.require_auth)):
    """Submit CSAT feedback."""
    from main import feedback_db, _now_utc
    client_id = current_user["client_id"]
    rating = req.rating
    comment = req.comment.strip()

    if not 1 <= rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be 1-5")

    feedback_record = {
        "rating": rating,
        "comment": comment,
        "created_at": _now_utc(),
    }
    feedback_db[client_id].append(feedback_record)
    storage.write_feedback_record({**feedback_record, "client_id": client_id})
    storage.write_audit(
        event_id=f"feedback_{secrets.token_hex(4)}",
        agent="FeedbackSystem",
        action="csat_submitted",
        input_summary=f"rating={rating}",
        output_summary=f"comment_length={len(comment)}",
        client_id=client_id,
    )
    return {"success": True, "message": "Thank you for your feedback!"}


@feedback_router.post("/api/support")
async def submit_support_request(req: SupportRequest, current_user: dict = Depends(auth.require_auth)):
    """Submit a support ticket."""
    from main import support_db, _now_utc
    client_id = current_user["client_id"]
    category = req.category.strip()
    priority = req.priority.strip() if req.priority in {"Low", "Normal", "Urgent"} else "Normal"
    description = req.description.strip()

    if not category:
        raise HTTPException(status_code=400, detail="Category is required")
    if len(description) < 20:
        raise HTTPException(status_code=400, detail="Description must be at least 20 characters")

    client_email = current_user.get("email", "")
    company_name = current_user.get("company_name", "")
    ticket_id = f"TKT-{secrets.token_hex(4).upper()}"
    support_record = {
        "ticket_id": ticket_id,
        "category": category,
        "priority": priority,
        "description": description,
        "created_at": _now_utc(),
        "email": client_email,
        "company_name": company_name,
    }
    support_db[client_id].append(support_record)
    storage.write_support_ticket({**support_record, "client_id": client_id})

    email_service.send_support_ticket_notification(
        ticket_id=ticket_id,
        client_email=client_email,
        company_name=company_name,
        category=category,
        priority=priority,
        description=description,
    )

    storage.write_audit(
        event_id=f"support_{ticket_id}",
        agent="SupportSystem",
        action="support_ticket_created",
        input_summary=f"category={category} | priority={priority}",
        output_summary=f"ticket_id={ticket_id}",
        client_id=client_id,
    )
    return {
        "success": True,
        "ticket_id": ticket_id,
        "message": f"Support ticket {ticket_id} created! We'll respond within 24 hours.",
    }


@feedback_router.post("/api/survey")
async def submit_survey(req: SurveyRequest):
    """Public landing-page product survey — NO AUTH. Saved for the Admin Console."""
    from main import _now_utc
    record = {
        "role": (req.role or "").strip()[:120],
        "challenge": (req.challenge or "").strip()[:160],
        "feature": (req.feature or "").strip()[:160],
        "comment": (req.comment or "").strip()[:2000],
        "email": (req.email or "").strip()[:160],
        "created_at": _now_utc(),
        "source": "landing",
    }
    storage.write_survey_response(record)
    storage.write_audit(
        event_id=f"survey_{secrets.token_hex(4)}",
        agent="SurveySystem",
        action="landing_survey_submitted",
        input_summary=f"role={record['role']} | challenge={record['challenge']}",
        output_summary=f"feature={record['feature']} | email={'yes' if record['email'] else 'no'}",
        client_id="public",
    )
    return {"success": True, "message": "Thank you! Your feedback helps us build a better platform."}
