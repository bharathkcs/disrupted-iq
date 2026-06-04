"""DisruptIQ V2 — Email service.

All transactional email lives here. Three transports, picked in this order:
  1. Console mode  — when EMAIL_ENABLED=false (default). Emails are logged, not sent.
  2. SendGrid      — when EMAIL_ENABLED=true and SENDGRID_API_KEY is set.
  3. Gmail SMTP    — when EMAIL_ENABLED=true and SMTP_USER/SMTP_PASSWORD are set.

Every send is logged to the audit log. Failures never raise — they return False so
callers can surface "email pending" without breaking the request.

All timestamps shown to users are in IST (UTC+5:30).
"""

import html as _html
import logging
import re
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import config

logger = logging.getLogger("disruptiq.email")

IST = timezone(timedelta(hours=5, minutes=30))

# Brand palette
_HEADER_BG = "#1E1B4B"
_ACCENT = "#7c6bff"
_TEXT = "#1f2937"
_MUTED = "#6b7280"
_BG = "#f4f4f7"
_BG_LIGHT = "#f9f9f9"
_BORDER = "#e5e7eb"


# ── time helpers ────────────────────────────────────────────────────────────

def _ist_now() -> str:
    return datetime.now(IST).strftime("%d %b %Y, %I:%M %p IST")


def _to_ist(ts: str | None) -> str:
    """Convert an ISO/UTC timestamp string to a human IST string."""
    if not ts:
        return _ist_now()
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).strftime("%d %b %Y, %I:%M %p IST")
    except Exception:
        return str(ts)


# ── html / text helpers ─────────────────────────────────────────────────────

def _html_to_text(html: str) -> str:
    """Crude HTML-to-text fallback for the plain-text email part."""
    text = re.sub(r"<\s*br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</\s*(p|div|tr|h[1-6]|li)\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _button(label: str, url: str, color: str = _ACCENT) -> str:
    return (
        f'<a href="{url}" style="display:inline-block;background:{color};color:#ffffff;'
        f'text-decoration:none;font-weight:600;padding:12px 28px;border-radius:8px;'
        f'font-size:14px;margin:8px 0;">{label}</a>'
    )


def _wrap_html(title: str, body_html: str, header_color: str = _HEADER_BG) -> str:
    """Wrap inner content in the branded DisruptIQ email shell."""
    unsubscribe = f"{config.APP_BASE_URL}/account/notifications"
    return f"""\
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:{_BG};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_BG};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:{header_color};padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">DisruptIQ</span>
            <span style="color:{_ACCENT};font-size:20px;font-weight:700;"> ▴</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:{_TEXT};font-size:14px;line-height:1.6;">
            <h1 style="margin:0 0 16px;font-size:22px;color:{_TEXT};">{title}</h1>
            {body_html}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#fafafa;border-top:1px solid #eee;
                     color:{_MUTED};font-size:12px;line-height:1.6;">
            DisruptIQ — Supply Chain Disruption Intelligence<br/>
            Need help? <a href="mailto:{config.SUPPORT_EMAIL}" style="color:{_ACCENT};">{config.SUPPORT_EMAIL}</a>
            &nbsp;|&nbsp;
            <a href="{unsubscribe}" style="color:{_MUTED};">Manage email preferences</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _detail_row(label: str, value: str) -> str:
    return (
        f'<tr><td style="padding:6px 12px 6px 0;color:{_MUTED};font-size:13px;">{label}</td>'
        f'<td style="padding:6px 0;color:{_TEXT};font-size:13px;font-weight:600;">{value}</td></tr>'
    )


# ── transports ──────────────────────────────────────────────────────────────

def _audit_email(to_email: str, subject: str, transport: str, success: bool, error: str = "") -> None:
    """Record an email send attempt in the audit log. Never raises."""
    try:
        import storage
        storage.write_audit(
            event_id="email",
            agent="EmailService",
            action="email_sent" if success else "email_failed",
            input_summary=f"to={to_email} | transport={transport} | subject={subject}",
            output_summary="delivered" if success else f"failed: {error}",
        )
    except Exception:
        pass


def _send_via_sendgrid(to_email: str, subject: str, html: str, text: str) -> bool:
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Content, Email, Mail, To

    message = Mail(
        from_email=Email(config.SENDGRID_FROM_EMAIL, config.SENDGRID_FROM_NAME),
        to_emails=To(to_email),
        subject=subject,
        plain_text_content=Content("text/plain", text),
        html_content=Content("text/html", html),
    )
    client = SendGridAPIClient(config.SENDGRID_API_KEY)
    resp = client.send(message)
    return 200 <= resp.status_code < 300


def _send_via_smtp(to_email: str, subject: str, html: str, text: str) -> bool:
    from_email = config.SMTP_FROM_EMAIL or config.SMTP_USER
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{config.SMTP_FROM_NAME} <{from_email}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        server.sendmail(from_email, [to_email], msg.as_string())
    return True


def _send_email(to_email: str, subject: str, html_body: str, text_body: str | None = None) -> bool:
    """Core dispatcher. Returns True on success/console-log, False on failure."""
    text_body = text_body or _html_to_text(html_body)

    if not config.is_real_email():
        logger.debug("[email:skipped] EMAIL not configured — to=%s | subject=%s", to_email, subject)
        return True

    if not config.EMAIL_ENABLED:
        logger.info("[email:console] to=%s | subject=%s", to_email, subject)
        block = (
            f"\n{'='*64}\n[EMAIL - CONSOLE MODE]  EMAIL_ENABLED=false\n"
            f"  To      : {to_email}\n  Subject : {subject}\n"
            f"{'-'*64}\n{text_body}\n{'='*64}\n"
        )
        # Windows consoles are often cp1252 — strip characters the active
        # encoding cannot represent so the print never raises.
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        print(block.encode(enc, errors="replace").decode(enc, errors="replace"))
        _audit_email(to_email, subject, "console", True)
        return True

    transport = "none"
    try:
        if config.SENDGRID_API_KEY and not config.SENDGRID_API_KEY.startswith("PLACEHOLDER"):
            transport = "sendgrid"
            ok = _send_via_sendgrid(to_email, subject, html_body, text_body)
        elif config.SMTP_USER and config.SMTP_PASSWORD:
            transport = "smtp"
            ok = _send_via_smtp(to_email, subject, html_body, text_body)
        else:
            logger.warning("[email] EMAIL_ENABLED=true but no transport configured")
            _audit_email(to_email, subject, "unconfigured", False, "no transport configured")
            return False
        _audit_email(to_email, subject, transport, ok)
        if not ok:
            logger.error("[email] %s send returned non-success for %s", transport, to_email)
        return ok
    except Exception as e:  # noqa: BLE001 — email failure must never break the request
        logger.error("[email] %s send failed for %s: %s", transport, to_email, e)
        _audit_email(to_email, subject, transport, False, str(e))
        return False


# ════════════════════════════════════════════════════════════════════════════
# 1. Welcome email — after account creation
# ════════════════════════════════════════════════════════════════════════════

def send_welcome_email(email: str, company_name: str, client_id: str,
                       industry: str = "", contact_name: str = "",
                       created_at: str | None = None) -> bool:
    subject = "Welcome to DisruptIQ — Your Account is Ready 🚀"
    dashboard_url = f"{config.APP_BASE_URL}/dashboard/{client_id}"
    account_url = f"{config.APP_BASE_URL}/account"
    map_url = f"{config.APP_BASE_URL}/map"
    reports_url = f"{config.APP_BASE_URL}/reports"

    greeting = f"Hi {contact_name}," if contact_name else f"Welcome, {company_name}!"
    details = "".join([
        _detail_row("Email", email),
        _detail_row("Company", company_name),
        _detail_row("Industry", industry or "—"),
        _detail_row("Account ID", client_id[:12] + "…"),
        _detail_row("Plan", "Explorer (Free)"),
        _detail_row("Created", _to_ist(created_at)),
    ])

    step_cards = "".join([
        f"""<div style="margin:12px 0;padding:12px;background:rgba(124,107,255,0.08);border-radius:6px;border-left:3px solid #7C6BFF;">
          <span style="display:inline-block;width:28px;height:28px;background:#7C6BFF;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:10px;">1</span>
          <strong style="color:{_TEXT};font-size:13px;">Complete your company profile</strong>
          <a href="{account_url}" style="color:#7C6BFF;text-decoration:none;margin-left:8px;">→</a>
        </div>""",
        f"""<div style="margin:12px 0;padding:12px;background:rgba(124,107,255,0.08);border-radius:6px;border-left:3px solid #7C6BFF;">
          <span style="display:inline-block;width:28px;height:28px;background:#7C6BFF;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:10px;">2</span>
          <strong style="color:{_TEXT};font-size:13px;">Import your suppliers (Excel)</strong>
          <a href="{account_url}" style="color:#7C6BFF;text-decoration:none;margin-left:8px;">→</a>
        </div>""",
        f"""<div style="margin:12px 0;padding:12px;background:rgba(124,107,255,0.08);border-radius:6px;border-left:3px solid #7C6BFF;">
          <span style="display:inline-block;width:28px;height:28px;background:#7C6BFF;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:10px;">3</span>
          <strong style="color:{_TEXT};font-size:13px;">Run your first scenario</strong>
          <a href="{dashboard_url}" style="color:#7C6BFF;text-decoration:none;margin-left:8px;">→</a>
        </div>""",
        f"""<div style="margin:12px 0;padding:12px;background:rgba(124,107,255,0.08);border-radius:6px;border-left:3px solid #7C6BFF;">
          <span style="display:inline-block;width:28px;height:28px;background:#7C6BFF;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:10px;">4</span>
          <strong style="color:{_TEXT};font-size:13px;">Explore your supply chain map</strong>
          <a href="{map_url}" style="color:#7C6BFF;text-decoration:none;margin-left:8px;">→</a>
        </div>""",
        f"""<div style="margin:12px 0;padding:12px;background:rgba(124,107,255,0.08);border-radius:6px;border-left:3px solid #7C6BFF;">
          <span style="display:inline-block;width:28px;height:28px;background:#7C6BFF;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:10px;">5</span>
          <strong style="color:{_TEXT};font-size:13px;">Review AI-generated insights</strong>
          <a href="{reports_url}" style="color:#7C6BFF;text-decoration:none;margin-left:8px;">→</a>
        </div>""",
    ])

    features_table = f"""<table role="presentation" style="width:100%;margin:16px 0;">
      <tr>
        <td style="width:33%;text-align:center;padding:16px;border-right:1px solid {_BORDER};">
          <div style="font-size:28px;margin-bottom:6px;">🛡️</div>
          <strong style="color:{_TEXT};font-size:13px;display:block;margin-bottom:4px;">Always Watching</strong>
          <span style="font-size:11px;color:{_MUTED};">Real-time monitoring of global supply chain events</span>
        </td>
        <td style="width:33%;text-align:center;padding:16px;border-right:1px solid {_BORDER};">
          <div style="font-size:28px;margin-bottom:6px;">🤖</div>
          <strong style="color:{_TEXT};font-size:13px;display:block;margin-bottom:4px;">9 AI Agents</strong>
          <span style="font-size:11px;color:{_MUTED};">Orchestrated intelligence for supply chain resilience</span>
        </td>
        <td style="width:33%;text-align:center;padding:16px;">
          <div style="font-size:28px;margin-bottom:6px;">⚡</div>
          <strong style="color:{_TEXT};font-size:13px;display:block;margin-bottom:4px;">90-Second SLA</strong>
          <span style="font-size:11px;color:{_MUTED};">Automated disruption response with human approval</span>
        </td>
      </tr>
    </table>"""

    body = f"""
      <div style="margin:0 0 20px;padding:18px 20px;background:linear-gradient(135deg,rgba(124,107,255,0.12),rgba(22,163,74,0.10));border-radius:10px;text-align:center;">
        <div style="font-size:30px;margin-bottom:6px;">🎉</div>
        <div style="font-size:17px;font-weight:700;color:{_TEXT};">Congratulations — you're all set!</div>
        <div style="font-size:12.5px;color:{_MUTED};margin-top:4px;">Welcome to DisruptIQ. Your account has been created successfully.</div>
      </div>
      <p style="font-size:15px;font-weight:600;margin:0 0 4px;color:{_TEXT};">{greeting}</p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 18px;">Your supply chain intelligence platform is live and ready. Here's everything you need to get started and explore.</p>
      <table role="presentation" style="margin:0 0 20px;">{details}</table>
      <p>{_button("Open Your Dashboard →", dashboard_url, "#16a34a")}</p>
      <h3 style="font-size:14px;color:{_TEXT};margin:24px 0 12px;">Here's what to do first</h3>
      {step_cards}
      <h3 style="font-size:14px;color:{_TEXT};margin:24px 0 12px;">What DisruptIQ does for you</h3>
      {features_table}
      <p style="font-size:11px;color:{_MUTED};margin:20px 0 0;">Need help? Reply to this email or contact <a href="mailto:{config.SUPPORT_EMAIL}" style="color:#7C6BFF;text-decoration:none;">{config.SUPPORT_EMAIL}</a></p>
    """
    return _send_email(email, subject, _wrap_html(greeting, body))


# ════════════════════════════════════════════════════════════════════════════
# 1.5 Support ticket notification
# ════════════════════════════════════════════════════════════════════════════

def send_support_ticket_notification(ticket_id: str, client_email: str, company_name: str,
                                     category: str, priority: str, description: str) -> bool:
    # Escape all user-supplied fields before embedding in HTML to prevent injection.
    safe_company = _html.escape(company_name)
    safe_category = _html.escape(category)
    safe_priority = _html.escape(priority)
    safe_description = _html.escape(description)
    safe_client_email = _html.escape(client_email)

    # Client confirmation
    client_subject = f"Support Ticket {ticket_id} Created — We're Here to Help"
    client_body = f"""
      <p>Thank you for reaching out, <strong>{safe_company}</strong>!</p>
      <table role="presentation" style="margin:16px 0;">{_detail_row("Ticket ID", ticket_id)}{_detail_row("Category", safe_category)}{_detail_row("Priority", safe_priority)}</table>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 8px;">Your message:</p>
      <div style="padding:12px;background:{_BG_LIGHT};border-left:3px solid #7C6BFF;border-radius:4px;font-size:12px;color:{_TEXT};line-height:1.5;">{safe_description}</div>
      <p style="margin:16px 0 0;font-size:12px;color:{_MUTED};">Our support team will review your request and respond within 24 hours.</p>
    """
    _send_email(client_email, client_subject, _wrap_html(f"Ticket {ticket_id}", client_body))

    # Admin notification
    admin_subject = f"[{safe_priority.upper()}] New Support Ticket {ticket_id} — {safe_company}"
    admin_body = f"""
      <p>A new support request was submitted.</p>
      <table role="presentation" style="margin:16px 0;">{_detail_row("Ticket", ticket_id)}{_detail_row("From", f"{safe_company} ({safe_client_email})")}{_detail_row("Category", safe_category)}{_detail_row("Priority", safe_priority)}</table>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 8px;">Description:</p>
      <div style="padding:12px;background:{_BG_LIGHT};border-left:3px solid #ef4444;border-radius:4px;font-size:12px;color:{_TEXT};line-height:1.5;">{safe_description}</div>
    """
    return _send_email(config.SUPPORT_EMAIL, admin_subject, _wrap_html(f"New Ticket {ticket_id}", admin_body))


# ════════════════════════════════════════════════════════════════════════════
# 2. Supplier import confirmation
# ════════════════════════════════════════════════════════════════════════════

def send_supplier_import_confirmation(email: str, company_name: str,
                                      suppliers: list, warnings: list | None = None) -> bool:
    # Anti-spam email policy: operational emails (supplier import) are no longer
    # sent. Only registration + admin-action (premium/support) emails go out.
    return False
    warnings = warnings or []
    count = len(suppliers)
    subject = f"{count} Suppliers Imported Successfully ✅"
    zones = sorted({s.get("zone", "—") for s in suppliers})
    categories = sorted({c for s in suppliers for c in s.get("categories", [])})
    map_url = f"{config.APP_BASE_URL}/map"

    preview_rows = "".join(
        f'<tr><td style="padding:6px 12px 6px 0;font-size:13px;">{s.get("name","—")}</td>'
        f'<td style="padding:6px 12px 6px 0;font-size:13px;color:{_MUTED};">{s.get("zone","—")}</td>'
        f'<td style="padding:6px 0;font-size:13px;color:{_MUTED};">'
        f'{", ".join(s.get("categories", [])) or "—"}</td></tr>'
        for s in suppliers[:5]
    )
    more = f'<p style="color:{_MUTED};font-size:12px;">…and {count - 5} more.</p>' if count > 5 else ""

    warning_block = ""
    if warnings:
        items = "".join(f"<li>{w}</li>" for w in warnings[:10])
        warning_block = f"""
          <div style="margin:16px 0;padding:12px 16px;background:#fffbeb;
                      border-left:4px solid #f59e0b;border-radius:6px;">
            <strong style="font-size:13px;">We auto-corrected {len(warnings)} item(s):</strong>
            <ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:{_MUTED};">{items}</ul>
          </div>"""

    details = "".join([
        _detail_row("Suppliers imported", str(count)),
        _detail_row("Zones covered", ", ".join(zones) or "—"),
        _detail_row("Categories", ", ".join(categories) or "—"),
        _detail_row("Imported at", _ist_now()),
    ])
    body = f"""
      <p>Your supply chain network is ready, <strong>{company_name}</strong>!</p>
      <table role="presentation" style="margin:16px 0;">{details}</table>
      {warning_block}
      <h3 style="margin:20px 0 8px;font-size:15px;">First {min(count,5)} suppliers</h3>
      <table role="presentation" style="width:100%;">{preview_rows}</table>
      {more}
      <p style="margin-top:16px;">Your supply chain map is now populated with these suppliers.</p>
      <p>{_button("View Supply Chain Map", map_url)}</p>
      <p style="color:{_MUTED};font-size:13px;">Next: run your first disruption scenario to test the system.</p>
    """
    return _send_email(email, subject, _wrap_html("Suppliers Imported", body))


# ════════════════════════════════════════════════════════════════════════════
# 3. Password reset request
# ════════════════════════════════════════════════════════════════════════════

def send_password_reset_email(email: str, company_name: str, reset_token: str) -> bool:
    subject = "Reset Your DisruptIQ Password"
    reset_url = f"{config.APP_BASE_URL}/reset-password?token={reset_token}"
    body = f"""
      <p>You requested a password reset for your DisruptIQ account.</p>
      <table role="presentation" style="margin:16px 0;">
        {_detail_row("Company", company_name)}
        {_detail_row("Email", email)}
      </table>
      <p>{_button("Reset My Password", reset_url, "#dc2626")}</p>
      <p style="color:{_MUTED};font-size:13px;">This link expires in <strong>1 hour</strong>.</p>
      <p style="color:{_MUTED};font-size:13px;">If you didn't request this, ignore this email —
      your password will not change. For your security, we never share your password.</p>
    """
    return _send_email(email, subject, _wrap_html("Password Reset Request", body, "#92400e"))


# ════════════════════════════════════════════════════════════════════════════
# 4. Password changed confirmation
# ════════════════════════════════════════════════════════════════════════════

def send_password_changed_confirmation(email: str, company_name: str) -> bool:
    subject = "Your DisruptIQ Password Was Changed ✅"
    forgot_url = f"{config.APP_BASE_URL}/forgot-password"
    body = f"""
      <p>Your DisruptIQ password was changed on <strong>{_ist_now()}</strong>.</p>
      <p>If you made this change, no action is needed.</p>
      <div style="margin:16px 0;padding:12px 16px;background:#fef2f2;
                  border-left:4px solid #dc2626;border-radius:6px;">
        <strong style="font-size:13px;">If you did NOT make this change:</strong>
        <p style="margin:8px 0 0;font-size:13px;">
          {_button("Secure My Account", forgot_url, "#dc2626")}<br/>
          Or contact <a href="mailto:{config.SUPPORT_EMAIL}" style="color:{_ACCENT};">{config.SUPPORT_EMAIL}</a>.
        </p>
      </div>
      <p style="color:{_MUTED};font-size:12px;">Tip: use a unique password and never reuse it across services.</p>
    """
    return _send_email(email, subject, _wrap_html("Password Changed", body))


# ════════════════════════════════════════════════════════════════════════════
# 5. Disruption alert (severity >= 7)
# ════════════════════════════════════════════════════════════════════════════

def send_disruption_alert_email(email: str, company_name: str, event: dict) -> bool:
    return False  # anti-spam policy: event-triggered emails are no longer sent
    event_type = event.get("event_type", "Disruption")
    geography = event.get("geography", "—")
    severity = event.get("severity_score", event.get("severity", 0))
    subject = f"⚠️ Supply Chain Alert: {event_type} in {geography} (Severity {severity}/10)"
    event_url = f"{config.APP_BASE_URL}/dashboard/{event.get('client_id','')}"

    at_risk = event.get("at_risk_suppliers", []) or []
    risk_list = "".join(f"<li>{s}</li>" for s in at_risk[:3]) or "<li>Assessment in progress…</li>"
    details = "".join([
        _detail_row("Event type", event_type),
        _detail_row("Location", geography),
        _detail_row("Severity", f"{severity}/10"),
        _detail_row("Detected", _to_ist(event.get("timestamp_utc"))),
        _detail_row("Source", event.get("source", "Manual")),
    ])
    body = f"""
      <p><strong>{company_name}</strong>, a new disruption affecting your supply chain
      has been detected.</p>
      <table role="presentation" style="margin:16px 0;">{details}</table>
      <p style="font-size:13px;">9 AI agents are now analysing this disruption.</p>
      <h3 style="margin:20px 0 8px;font-size:15px;">Suppliers at risk</h3>
      <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:{_MUTED};">{risk_list}</ul>
      <p>{_button("View Analysis in Dashboard", event_url, "#16a34a")}</p>
      <p style="color:{_MUTED};font-size:12px;">You'll receive another email when the analysis is complete.
      Manage notifications in Account Settings.</p>
    """
    return _send_email(email, subject, _wrap_html("Supply Chain Alert", body, "#b91c1c"))


# ════════════════════════════════════════════════════════════════════════════
# 6. Analysis complete
# ════════════════════════════════════════════════════════════════════════════

def send_analysis_complete_email(email: str, company_name: str, summary: dict) -> bool:
    return False  # anti-spam policy: analysis/event emails are no longer sent
    supplier_count = summary.get("supplier_count", 0)
    subject = f"✅ Analysis Complete: {supplier_count} Suppliers Assessed — Action Required"
    event_url = f"{config.APP_BASE_URL}/dashboard/{summary.get('client_id','')}"
    top = summary.get("top_recommendation", {}) or {}

    details = "".join([
        _detail_row("Event", f"{summary.get('event_type','—')} in {summary.get('geography','—')}"),
        _detail_row("Severity", f"{summary.get('severity','—')}/10"),
        _detail_row("Suppliers assessed", str(supplier_count)),
        _detail_row("Time taken", f"{summary.get('duration_seconds','—')}s"),
        _detail_row("Status", summary.get("status", "Action Required")),
    ])
    rec = "".join([
        _detail_row("Recommended option", top.get("title", "Option 1")),
        _detail_row("Cost impact", f"{top.get('cost_delta','—')}%"),
        _detail_row("Recovery time", top.get("rto_human", "—")),
        _detail_row("Effectiveness", f"{top.get('effectiveness','—')}%"),
    ])
    body = f"""
      <p>The swarm has finished analysing the disruption for <strong>{company_name}</strong>.</p>
      <table role="presentation" style="margin:16px 0;">{details}</table>
      <h3 style="margin:20px 0 8px;font-size:15px;">Top recommendation</h3>
      <table role="presentation" style="margin:0 0 16px;">{rec}</table>
      <p style="font-size:13px;">3 options are available for your review. Human approval is
      required before any action is executed.</p>
      <p>{_button("Review Options & Approve Action", event_url, "#ea580c")}</p>
      <p style="color:{_MUTED};font-size:12px;">This event expires in 24 hours without action.</p>
    """
    return _send_email(email, subject, _wrap_html("Analysis Complete", body, "#15803d"))


# ════════════════════════════════════════════════════════════════════════════
# 7. Account deletion confirmation
# ════════════════════════════════════════════════════════════════════════════

def send_account_deletion_confirmation(email: str, company_name: str, client_id: str,
                                        deletion_token: str, supplier_count: int = 0,
                                        event_count: int = 0) -> bool:
    subject = "Account Deletion Requested — DisruptIQ"
    confirm_url = f"{config.APP_BASE_URL}/confirm-delete?token={deletion_token}"
    cancel_url = f"{config.APP_BASE_URL}/account"
    details = "".join([
        _detail_row("Email", email),
        _detail_row("Company", company_name),
        _detail_row("Account ID", client_id[:12] + "…"),
    ])
    body = f"""
      <p>We received a request to delete your DisruptIQ account.</p>
      <table role="presentation" style="margin:16px 0;">{details}</table>
      <h3 style="margin:20px 0 8px;font-size:15px;">What will be deleted</h3>
      <ul style="margin:0 0 12px;padding-left:18px;font-size:13px;color:{_MUTED};">
        <li>Your company profile and settings</li>
        <li>All imported supplier data ({supplier_count} suppliers)</li>
        <li>All disruption events and history ({event_count} events)</li>
        <li>All reports and analytics</li>
        <li>Swarm memory and learning data</li>
      </ul>
      <h3 style="margin:16px 0 8px;font-size:15px;">What is preserved</h3>
      <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:{_MUTED};">
        <li>Anonymised audit logs (required by policy)</li>
      </ul>
      <p>{_button("Confirm Delete My Account", confirm_url, "#dc2626")}
         &nbsp;&nbsp;
         {_button("Cancel — Keep My Account", cancel_url, "#16a34a")}</p>
      <p style="color:{_MUTED};font-size:12px;">This link expires in 24 hours.
      After deletion, data cannot be recovered.</p>
    """
    return _send_email(email, subject, _wrap_html("Account Deletion Requested", body, "#b91c1c"))


# ════════════════════════════════════════════════════════════════════════════
# 8. Weekly digest
# ════════════════════════════════════════════════════════════════════════════

def send_weekly_digest_email(email: str, company_name: str, digest: dict) -> bool:
    return False  # anti-spam policy: recurring digest emails are no longer sent
    subject = "📊 Your Weekly Supply Chain Intelligence Report — DisruptIQ"
    reports_url = f"{config.APP_BASE_URL}/reports"
    period = digest.get("period", "the last 7 days")
    total_events = digest.get("total_events", 0)

    if total_events == 0:
        body = f"""
          <p>Weekly summary for <strong>{company_name}</strong> — {period}.</p>
          <div style="margin:16px 0;padding:16px;background:#f0fdf4;
                      border-left:4px solid #16a34a;border-radius:6px;font-size:14px;">
            Your supply chain had no disruptions this week ✅
          </div>
          <p>{_button("View Full Report", reports_url)}</p>
        """
        return _send_email(email, subject, _wrap_html("Weekly Summary", body, "#15803d"))

    stats = "".join([
        _detail_row("Total events", str(total_events)),
        _detail_row("Avg response speed", f"{digest.get('avg_response_seconds','—')}s"),
        _detail_row("Actions taken", str(digest.get("actions_taken", 0))),
        _detail_row("Resilience score", f"{digest.get('resilience_score','—')}/100"),
    ])
    top_events = digest.get("top_events", []) or []
    events_list = "".join(
        f'<li>{e.get("event_type","—")} in {e.get("geography","—")} '
        f'(severity {e.get("severity","—")}) — {e.get("outcome","pending")}</li>'
        for e in top_events[:3]
    ) or "<li>—</li>"
    body = f"""
      <p>Weekly summary for <strong>{company_name}</strong> — {period}.</p>
      <table role="presentation" style="margin:16px 0;">{stats}</table>
      <h3 style="margin:20px 0 8px;font-size:15px;">Top events this week</h3>
      <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:{_MUTED};">{events_list}</ul>
      <h3 style="margin:16px 0 8px;font-size:15px;">Supply chain health</h3>
      <p style="font-size:13px;color:{_MUTED};">
        Trend: {digest.get('trend','stable')} &nbsp;|&nbsp;
        Top risk: {digest.get('top_risk','—')}<br/>
        Recommendation: {digest.get('recommendation','Maintain current sourcing strategy.')}
      </p>
      <p>{_button("View Full Report", reports_url)}</p>
    """
    return _send_email(email, subject, _wrap_html("Weekly Summary", body, "#15803d"))


# ════════════════════════════════════════════════════════════════════════════
# 9. Premium access approved (admin action)
# ════════════════════════════════════════════════════════════════════════════

def send_premium_approved_email(email: str, company_name: str) -> bool:
    subject = "🎉 You've Unlocked DisruptIQ Pro — Welcome to Premium"
    dashboard_url = f"{config.APP_BASE_URL}/account/suppliers"
    safe_company = _html.escape(company_name or "there")
    benefits = "".join([
        f'<tr><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:18px;">⚡</td><td style="padding:10px 0;"><strong style="color:{_TEXT};font-size:13px;">Unlimited Supplier Imports</strong><br/><span style="font-size:12px;color:{_MUTED};">No cap on supplier count — import your entire supply network at once.</span></td></tr>',
        f'<tr><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:18px;">🤖</td><td style="padding:10px 0;"><strong style="color:{_TEXT};font-size:13px;">Full 9-Agent Swarm Pipeline</strong><br/><span style="font-size:12px;color:{_MUTED};">All AI agents active: Monitor, Memory, Cascade, Forecast, Risk, Action, Validator, Simulation, Counterfactual.</span></td></tr>',
        f'<tr><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:18px;">📊</td><td style="padding:10px 0;"><strong style="color:{_TEXT};font-size:13px;">Advanced Analytics Suite</strong><br/><span style="font-size:12px;color:{_MUTED};">All 9 reports, dependency heatmap, resilience scoring, supplier trends and anomaly detection.</span></td></tr>',
        f'<tr><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:18px;">🗺️</td><td style="padding:10px 0;"><strong style="color:{_TEXT};font-size:13px;">Real-Time Supply Chain Twin Map</strong><br/><span style="font-size:12px;color:{_MUTED};">Live SVG map with supplier nodes, port hubs, and animated disruption pulses.</span></td></tr>',
        f'<tr><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:18px;">🧠</td><td style="padding:10px 0;"><strong style="color:{_TEXT};font-size:13px;">Swarm Memory & Learning</strong><br/><span style="font-size:12px;color:{_MUTED};">Two-stage memory: predictions stored at event time, actuals recorded at resolution so every future response is smarter.</span></td></tr>',
        f'<tr><td style="padding:10px 14px 10px 0;vertical-align:top;font-size:18px;">🛡️</td><td style="padding:10px 0;"><strong style="color:{_TEXT};font-size:13px;">Priority Support</strong><br/><span style="font-size:12px;color:{_MUTED};">Your tickets jump the queue. Dedicated response within 12 hours.</span></td></tr>',
    ])
    body = f"""
      <div style="margin:0 0 24px;padding:22px 24px;background:linear-gradient(135deg,#1a1050,#0d3d2a);border-radius:12px;text-align:center;">
        <div style="font-size:38px;margin-bottom:8px;">⭐</div>
        <div style="font-size:20px;font-weight:800;color:#fcd34d;letter-spacing:0.04em;">PRO ACCESS UNLOCKED</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px;">{safe_company} · DisruptIQ Pro Plan</div>
      </div>
      <p style="font-size:15px;font-weight:600;color:{_TEXT};margin:0 0 6px;">Congratulations, {safe_company}! 🎉</p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 20px;">Your Premium access request has been approved. Your account is now on the <strong>Pro plan</strong> — here's everything that's unlocked for you:</p>
      <table role="presentation" style="width:100%;margin:0 0 24px;border-top:1px solid {_BORDER};">{benefits}</table>
      <div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:6px;padding:14px 16px;margin:0 0 20px;font-size:13px;color:{_TEXT};">
        ✅ Your <strong>★ PRO</strong> badge is now visible in your dashboard header — a mark of your Pro status on every page.
      </div>
      <p style="text-align:center;">{_button("Start Importing Suppliers →", dashboard_url, "#16a34a")}</p>
      <p style="font-size:11px;color:{_MUTED};margin:16px 0 0;text-align:center;">Questions? Reply to this email or reach us at <a href="mailto:{config.SUPPORT_EMAIL}" style="color:#7C6BFF;">{config.SUPPORT_EMAIL}</a></p>
    """
    return _send_email(email, subject, _wrap_html("Pro Access Approved 🎉", body, "#15803d"))


# ════════════════════════════════════════════════════════════════════════════
# 10. Support response / resolution (admin action)
# ════════════════════════════════════════════════════════════════════════════

def send_support_response_email(email: str, company_name: str, ticket_id: str,
                                category: str, message: str, resolved: bool = False) -> bool:
    safe_company = _html.escape(company_name or "there")
    safe_category = _html.escape(category or "—")
    safe_msg = _html.escape(message or "").replace("\n", "<br/>")
    account_url = f"{config.APP_BASE_URL}/account"
    status_line = ("Your ticket has been marked <strong>resolved</strong>."
                   if resolved else "Our support team has responded to your ticket.")
    header = "#15803d" if resolved else _HEADER_BG
    subject = f"Re: Support Ticket {ticket_id} — {'Resolved ✅' if resolved else 'Update'}"
    body = f"""
      <p>Hi <strong>{safe_company}</strong>,</p>
      <p>{status_line}</p>
      <table role="presentation" style="margin:12px 0;">{_detail_row("Ticket", ticket_id)}{_detail_row("Category", safe_category)}{_detail_row("Status", "Resolved" if resolved else "In progress")}</table>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 6px;">Our response:</p>
      <div style="padding:12px;background:{_BG_LIGHT};border-left:3px solid #7C6BFF;border-radius:4px;font-size:13px;color:{_TEXT};line-height:1.6;">{safe_msg}</div>
      <p style="margin-top:14px;">{_button("Open DisruptIQ", account_url)}</p>
      <p style="color:{_MUTED};font-size:12px;">If this didn't fully resolve your issue, reply to this email or raise a new ticket from your account.</p>
    """
    return _send_email(email, subject, _wrap_html(f"Support Update — {ticket_id}", body, header))
