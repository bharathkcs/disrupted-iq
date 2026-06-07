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
_HEADER_BG   = "#0f0e1a"
_ACCENT      = "#7c6bff"
_GREEN       = "#16a34a"
_RED         = "#dc2626"
_AMBER       = "#d97706"
_TEXT        = "#1f2937"
_MUTED       = "#6b7280"
_BG          = "#f0f0f5"
_CARD_BG     = "#ffffff"
_BORDER      = "#e5e7eb"


# ── time helpers ─────────────────────────────────────────────────────────────

def _ist_now() -> str:
    return datetime.now(IST).strftime("%d %b %Y, %I:%M %p IST")


def _to_ist(ts: str | None) -> str:
    if not ts:
        return _ist_now()
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).strftime("%d %b %Y, %I:%M %p IST")
    except Exception:
        return str(ts)


# ── html helpers ─────────────────────────────────────────────────────────────

def _html_to_text(html: str) -> str:
    text = re.sub(r"<\s*br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</\s*(p|div|tr|h[1-6]|li)\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _btn(label: str, url: str, color: str = _ACCENT) -> str:
    return (
        f'<a href="{url}" style="display:inline-block;background:{color};color:#ffffff;'
        f'text-decoration:none;font-weight:700;padding:13px 32px;border-radius:8px;'
        f'font-size:14px;letter-spacing:0.02em;">{label}</a>'
    )


def _pill(text: str, color: str = _ACCENT) -> str:
    return (
        f'<span style="display:inline-block;background:{color}1a;color:{color};'
        f'font-size:11px;font-weight:700;letter-spacing:0.06em;padding:3px 10px;'
        f'border-radius:20px;text-transform:uppercase;">{text}</span>'
    )


def _step_card(num: int, title: str, desc: str, url: str = "") -> str:
    link = (
        f'<a href="{url}" style="color:{_ACCENT};font-size:12px;'
        f'text-decoration:none;font-weight:600;">Get started &rarr;</a>'
        if url else ""
    )
    return f"""
    <tr>
      <td style="padding:0 0 10px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:#fafafe;border:1px solid {_BORDER};border-radius:10px;">
          <tr>
            <td style="padding:16px 18px;vertical-align:top;width:42px;">
              <div style="width:30px;height:30px;background:{_ACCENT};color:#fff;
                          border-radius:50%;text-align:center;line-height:30px;
                          font-weight:800;font-size:13px;">{num}</div>
            </td>
            <td style="padding:16px 18px 16px 0;vertical-align:top;">
              <div style="font-weight:700;font-size:13px;color:{_TEXT};margin-bottom:3px;">{title}</div>
              <div style="font-size:12px;color:{_MUTED};line-height:1.5;">{desc}</div>
              <div style="margin-top:8px;">{link}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>"""


def _feature_cell(icon: str, label: str, desc: str) -> str:
    return f"""
    <td style="width:33%;padding:0 5px 12px 5px;vertical-align:top;">
      <div style="background:#fafafe;border:1px solid {_BORDER};border-radius:10px;
                  padding:18px 14px;text-align:center;">
        <div style="font-size:24px;margin-bottom:8px;">{icon}</div>
        <div style="font-size:12px;font-weight:700;color:{_TEXT};margin-bottom:4px;">{label}</div>
        <div style="font-size:11px;color:{_MUTED};line-height:1.5;">{desc}</div>
      </div>
    </td>"""


def _stat_cell(value: str, label: str, color: str = _ACCENT) -> str:
    return f"""
    <td style="text-align:center;padding:16px 12px;">
      <div style="font-size:26px;font-weight:800;color:{color};">{value}</div>
      <div style="font-size:11px;color:{_MUTED};margin-top:3px;">{label}</div>
    </td>"""


def _wrap_html(title: str, body_html: str, accent: str = _ACCENT) -> str:
    unsubscribe = f"{config.APP_BASE_URL}/account/notifications"
    year = datetime.now().year
    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>{_html.escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:{_BG};
             font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
             -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:{_BG};padding:32px 16px;">
    <tr><td align="center">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="background:{_CARD_BG};border-radius:16px;overflow:hidden;
                    box-shadow:0 2px 16px rgba(0,0,0,0.08);max-width:560px;">

        <!-- Header -->
        <tr>
          <td style="background:{_HEADER_BG};padding:20px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:0.5px;">
                    DisruptIQ
                  </span>
                  <span style="color:{_ACCENT};font-size:18px;font-weight:800;"> &#9652;</span>
                </td>
                <td align="right">
                  <span style="color:rgba(255,255,255,0.35);font-size:10px;letter-spacing:0.06em;">
                    SUPPLY CHAIN INTELLIGENCE
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px;color:{_TEXT};font-size:14px;line-height:1.65;">
            {body_html}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:18px 32px 22px;background:#f8f8fc;
                     border-top:1px solid {_BORDER};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:{_MUTED};font-size:11px;line-height:1.7;">
                  <strong style="color:{_TEXT};">DisruptIQ</strong>
                  &nbsp;&mdash;&nbsp;Supply Chain Disruption Intelligence<br/>
                  <a href="mailto:{config.SUPPORT_EMAIL}"
                     style="color:{_ACCENT};text-decoration:none;">{config.SUPPORT_EMAIL}</a>
                  &nbsp;&middot;&nbsp;
                  <a href="{unsubscribe}"
                     style="color:{_MUTED};text-decoration:none;">Manage notifications</a>
                </td>
                <td align="right"
                    style="color:{_MUTED};font-size:11px;white-space:nowrap;
                           vertical-align:bottom;">
                  &copy; {year} DisruptIQ
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


# ── transports ───────────────────────────────────────────────────────────────

def _audit_email(to_email: str, subject: str, transport: str,
                 success: bool, error: str = "") -> None:
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


def _send_email(to_email: str, subject: str, html_body: str,
                text_body: str | None = None) -> bool:
    text_body = text_body or _html_to_text(html_body)

    if not config.is_real_email():
        logger.debug("[email:skipped] EMAIL not configured — to=%s | subject=%s",
                     to_email, subject)
        return True

    if not config.EMAIL_ENABLED:
        logger.info("[email:console] to=%s | subject=%s", to_email, subject)
        block = (
            f"\n{'='*64}\n[EMAIL - CONSOLE MODE]  EMAIL_ENABLED=false\n"
            f"  To      : {to_email}\n  Subject : {subject}\n"
            f"{'-'*64}\n{text_body}\n{'='*64}\n"
        )
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        logger.info(block.encode(enc, errors="replace").decode(enc, errors="replace"))
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
    except Exception as e:  # noqa: BLE001
        logger.error("[email] %s send failed for %s: %s", transport, to_email, e)
        _audit_email(to_email, subject, transport, False, str(e))
        return False


# ════════════════════════════════════════════════════════════════════════════
# 1. Welcome email
# ════════════════════════════════════════════════════════════════════════════

def send_welcome_email(email: str, company_name: str, client_id: str,
                       industry: str = "", contact_name: str = "",
                       created_at: str | None = None) -> bool:
    subject = f"Welcome to DisruptIQ, {company_name}"
    dashboard_url = f"{config.APP_BASE_URL}/dashboard/{client_id}"
    account_url   = f"{config.APP_BASE_URL}/account"
    map_url       = f"{config.APP_BASE_URL}/map"
    reports_url   = f"{config.APP_BASE_URL}/reports"

    greeting_name = contact_name or company_name
    safe_name     = _html.escape(greeting_name)
    safe_company  = _html.escape(company_name)
    safe_industry = _html.escape(industry) if industry else "your industry"

    features_html = f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:0 -5px;">
      <tr>
        {_feature_cell("&#128737;", "Always Monitoring",
            "Live news, weather, and port feeds — continuously scored against your supplier zones.")}
        {_feature_cell("&#129302;", "9 Specialist Agents",
            "Monitor · Memory · Cascade · Forecast · Risk · Action · Validator · Simulation · Counterfactual.")}
        {_feature_cell("&#9889;", "90-Second Response",
            "From disruption trigger to ranked, human-approved recovery options in under 90 s.")}
      </tr>
    </table>"""

    steps_html = f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      {_step_card(1, "Upload your supplier network",
          "Import suppliers via Excel or CSV. DisruptIQ maps them to zones, "
          "categories, and risk profiles automatically.",
          account_url)}
      {_step_card(2, "Run your first disruption scenario",
          "Simulate a port strike, cyclone, or supplier failure. The 9-agent swarm "
          "analyses your exposure and surfaces ranked recovery options in under 90 seconds.",
          dashboard_url)}
      {_step_card(3, "Explore your Supply Chain Twin Map",
          "See your suppliers plotted by zone with risk overlays, port hub connections, "
          "and live disruption pulses.",
          map_url)}
      {_step_card(4, "Approve an action and let the system learn",
          "Every Human-in-the-Loop approval is recorded. The Counterfactual agent feeds "
          "actual outcomes back into memory so each future forecast is smarter.",
          dashboard_url)}
    </table>"""

    body = f"""
      <div style="background:linear-gradient(135deg,{_HEADER_BG} 0%,#1a1560 100%);
                  border-radius:12px;padding:28px 24px;text-align:center;margin-bottom:28px;">
        <div style="font-size:36px;margin-bottom:10px;">&#128640;</div>
        <div style="font-size:20px;font-weight:800;color:#ffffff;margin-bottom:6px;">
          You're in, {safe_name}!
        </div>
        <div style="font-size:13px;color:rgba(255,255,255,0.60);line-height:1.6;">
          DisruptIQ is live for <strong style="color:#fff;">{safe_company}</strong>.<br/>
          Your AI-powered supply chain command centre is ready.
        </div>
      </div>

      <p style="margin:0 0 6px;">{_pill("PLATFORM OVERVIEW", _ACCENT)}</p>
      <p style="font-size:15px;font-weight:700;color:{_TEXT};margin:6px 0 8px;">
        Your supply chain, protected by AI
      </p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 20px;line-height:1.65;">
        DisruptIQ monitors global disruption signals 24/7, coordinates a swarm of 9 AI
        agents, and delivers ranked recovery options — with mandatory human approval before
        anything executes. Built for {safe_industry} teams who cannot afford to react too late.
      </p>

      {features_html}

      <div style="border-top:1px solid {_BORDER};margin:28px 0;"></div>

      <p style="margin:0 0 6px;">{_pill("GET STARTED", _GREEN)}</p>
      <p style="font-size:15px;font-weight:700;color:{_TEXT};margin:6px 0 16px;">
        Four steps to full situational awareness
      </p>
      {steps_html}

      <div style="text-align:center;margin:28px 0 8px;">
        {_btn("Open Your Dashboard &rarr;", dashboard_url, _GREEN)}
      </div>
      <p style="text-align:center;font-size:12px;color:{_MUTED};margin:10px 0 0;">
        Need help?
        <a href="mailto:{config.SUPPORT_EMAIL}"
           style="color:{_ACCENT};text-decoration:none;">Contact our team</a>
        &mdash; we respond within a few hours.
      </p>
    """
    return _send_email(email, subject, _wrap_html(f"Welcome, {greeting_name}", body))


# ════════════════════════════════════════════════════════════════════════════
# 1.5 Support ticket notification
# ════════════════════════════════════════════════════════════════════════════

def send_support_ticket_notification(ticket_id: str, client_email: str, company_name: str,
                                     category: str, priority: str, description: str) -> bool:
    safe_company  = _html.escape(company_name)
    safe_category = _html.escape(category)
    safe_priority = _html.escape(priority)
    safe_desc     = _html.escape(description)
    safe_cemail   = _html.escape(client_email)

    priority_color = {"high": _RED, "medium": _AMBER, "low": _GREEN}.get(
        priority.lower(), _ACCENT)

    # Client confirmation
    client_subject = f"We Got Your Message &mdash; Ticket {ticket_id}"
    client_body = f"""
      <div style="background:#f0fdf4;border-left:4px solid {_GREEN};border-radius:8px;
                  padding:14px 18px;margin-bottom:24px;">
        <div style="font-size:13px;font-weight:700;color:{_GREEN};">
          &#10003; Support request received
        </div>
        <div style="font-size:12px;color:{_MUTED};margin-top:2px;">
          Reference: <strong style="color:{_TEXT};">{ticket_id}</strong>
        </div>
      </div>

      <p style="font-size:14px;color:{_TEXT};margin:0 0 6px;">
        Hi <strong>{safe_company}</strong>,
      </p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 20px;line-height:1.65;">
        Thanks for reaching out. Our team has been notified and will review your
        request. You can expect a response within <strong>24 hours</strong>.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#fafafe;border:1px solid {_BORDER};border-radius:10px;
                    margin-bottom:20px;">
        <tr><td style="padding:16px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:5px 0;font-size:12px;color:{_MUTED};width:120px;">Ticket ID</td>
              <td style="padding:5px 0;font-size:12px;color:{_TEXT};font-weight:700;">{ticket_id}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:{_MUTED};">Category</td>
              <td style="padding:5px 0;font-size:12px;color:{_TEXT};">{safe_category}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:{_MUTED};">Priority</td>
              <td style="padding:5px 0;">{_pill(safe_priority, priority_color)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:{_MUTED};">Submitted</td>
              <td style="padding:5px 0;font-size:12px;color:{_TEXT};">{_ist_now()}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <p style="font-size:12px;color:{_MUTED};margin:0 0 6px;">Your message:</p>
      <div style="background:#f8f8fc;border-left:3px solid {_ACCENT};border-radius:6px;
                  padding:14px 16px;font-size:13px;color:{_TEXT};line-height:1.65;
                  font-style:italic;">
        &ldquo;{safe_desc}&rdquo;
      </div>
      <p style="font-size:12px;color:{_MUTED};margin:18px 0 0;">
        Didn't raise this ticket?
        <a href="mailto:{config.SUPPORT_EMAIL}"
           style="color:{_ACCENT};text-decoration:none;">Let us know</a>.
      </p>
    """
    _send_email(client_email, client_subject,
                _wrap_html(f"Ticket {ticket_id}", client_body))

    # Admin notification
    admin_subject = f"[{safe_priority.upper()}] Ticket {ticket_id} &mdash; {safe_company}"
    admin_body = f"""
      <div style="background:#fef2f2;border-left:4px solid {_RED};border-radius:8px;
                  padding:14px 18px;margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:{_RED};">NEW SUPPORT TICKET</div>
        <div style="font-size:11px;color:{_MUTED};margin-top:2px;">
          {safe_company} &middot; {safe_cemail}
        </div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#fafafe;border:1px solid {_BORDER};border-radius:10px;
                    margin-bottom:20px;">
        <tr><td style="padding:16px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:5px 0;font-size:12px;color:{_MUTED};width:100px;">Ticket</td>
              <td style="padding:5px 0;font-size:12px;color:{_TEXT};font-weight:700;">{ticket_id}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:{_MUTED};">Category</td>
              <td style="padding:5px 0;font-size:12px;color:{_TEXT};">{safe_category}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:12px;color:{_MUTED};">Priority</td>
              <td style="padding:5px 0;">{_pill(safe_priority, priority_color)}</td>
            </tr>
          </table>
        </td></tr>
      </table>
      <p style="font-size:12px;color:{_MUTED};margin:0 0 6px;">Description:</p>
      <div style="background:#f8f8fc;border-left:3px solid {_RED};border-radius:6px;
                  padding:14px 16px;font-size:13px;color:{_TEXT};line-height:1.65;">
        {safe_desc}
      </div>
    """
    return _send_email(config.SUPPORT_EMAIL, admin_subject,
                       _wrap_html(f"Ticket {ticket_id}", admin_body, _RED))


# ════════════════════════════════════════════════════════════════════════════
# 2. Supplier import confirmation
# ════════════════════════════════════════════════════════════════════════════

def send_supplier_import_confirmation(email: str, company_name: str,
                                      suppliers: list, warnings: list | None = None,
                                      client: dict | None = None) -> bool:
    """Sent once per client after their first successful supplier upload."""
    if not email:
        return False
    if client is not None and client.get("onboarding_email_sent"):
        logger.debug("[email:onboarding] already sent for %s — suppressing duplicate", email)
        return False

    warnings = warnings or []
    count = len(suppliers)
    if count == 0:
        return False

    subject = f"Your Supplier Network Is Live &mdash; {count} Suppliers Ready"
    map_url       = f"{config.APP_BASE_URL}/map"
    dashboard_url = f"{config.APP_BASE_URL}/dashboard"
    safe_company  = _html.escape(company_name)

    zones      = sorted({s.get("zone", "") for s in suppliers if s.get("zone")})
    categories = sorted({c for s in suppliers for c in s.get("categories", []) if c})
    zone_count = len(zones)
    cat_count  = len(categories)

    warning_block = ""
    if warnings:
        items = "".join(
            f'<li style="margin-bottom:4px;">{_html.escape(str(w))}</li>'
            for w in warnings[:10]
        )
        warning_block = f"""
        <div style="background:#fffbeb;border-left:4px solid {_AMBER};border-radius:8px;
                    padding:14px 18px;margin:20px 0;">
          <div style="font-size:12px;font-weight:700;color:{_AMBER};margin-bottom:6px;">
            &#9888; Auto-corrections applied ({len(warnings)})
          </div>
          <ul style="margin:0;padding-left:18px;font-size:12px;
                     color:{_MUTED};line-height:1.7;">
            {items}
          </ul>
        </div>"""

    body = f"""
      <div style="background:linear-gradient(135deg,{_HEADER_BG},#0d3d2a);
                  border-radius:12px;padding:26px 24px;text-align:center;margin-bottom:28px;">
        <div style="font-size:34px;margin-bottom:10px;">&#9989;</div>
        <div style="font-size:19px;font-weight:800;color:#ffffff;margin-bottom:5px;">
          Network imported successfully
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,0.55);">
          {safe_company} &middot; {_ist_now()}
        </div>
      </div>

      <p style="font-size:14px;color:{_TEXT};margin:0 0 20px;line-height:1.65;">
        Your supplier data is live inside DisruptIQ. The platform has mapped your network
        by zone and category &mdash; your Supply Chain Twin Map is now populated and ready
        for scenario analysis.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#fafafe;border:1px solid {_BORDER};border-radius:12px;
                    margin-bottom:24px;">
        <tr style="border-bottom:1px solid {_BORDER};">
          {_stat_cell(str(count), "Suppliers", _ACCENT)}
          {_stat_cell(str(zone_count), "Zones", _GREEN)}
          {_stat_cell(str(cat_count), "Categories", _AMBER)}
        </tr>
        <tr>
          <td colspan="3" style="padding:14px 20px;">
            <div style="font-size:11px;color:{_MUTED};line-height:1.7;">
              <strong style="color:{_TEXT};">Zones covered:</strong>&nbsp;
              {_html.escape(", ".join(zones)) if zones else "&mdash;"}
            </div>
          </td>
        </tr>
      </table>

      {warning_block}

      <p style="margin:0 0 6px;">{_pill("WHAT TO DO NEXT", _GREEN)}</p>
      <p style="font-size:14px;font-weight:700;color:{_TEXT};margin:6px 0 16px;">
        Your platform is ready &mdash; here's where to start
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 0 10px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#fafafe;border:1px solid {_BORDER};border-radius:10px;">
              <tr>
                <td style="padding:16px 18px;vertical-align:top;width:40px;font-size:22px;">
                  &#128506;
                </td>
                <td style="padding:16px 18px 16px 0;">
                  <div style="font-weight:700;font-size:13px;color:{_TEXT};margin-bottom:3px;">
                    Explore your Supply Chain Twin Map
                  </div>
                  <div style="font-size:12px;color:{_MUTED};line-height:1.5;margin-bottom:8px;">
                    See all your suppliers plotted by zone, with risk overlays and port hub
                    connections.
                  </div>
                  <a href="{map_url}"
                     style="color:{_ACCENT};font-size:12px;text-decoration:none;font-weight:600;">
                    View map &rarr;
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 10px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#fafafe;border:1px solid {_BORDER};border-radius:10px;">
              <tr>
                <td style="padding:16px 18px;vertical-align:top;width:40px;font-size:22px;">
                  &#9889;
                </td>
                <td style="padding:16px 18px 16px 0;">
                  <div style="font-weight:700;font-size:13px;color:{_TEXT};margin-bottom:3px;">
                    Run your first disruption scenario
                  </div>
                  <div style="font-size:12px;color:{_MUTED};line-height:1.5;margin-bottom:8px;">
                    Trigger a cyclone, port strike, or supplier failure. Nine AI agents analyse
                    your exposure and return ranked recovery options in under 90 seconds.
                  </div>
                  <a href="{dashboard_url}"
                     style="color:{_ACCENT};font-size:12px;text-decoration:none;font-weight:600;">
                    Go to dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="text-align:center;margin:28px 0 8px;">
        {_btn("Open Supply Chain Map &rarr;", map_url, _ACCENT)}
      </div>
    """

    sent = _send_email(email, subject, _wrap_html("Supplier Network Live", body))
    if sent and client is not None:
        client["onboarding_email_sent"] = True
    return sent


# ════════════════════════════════════════════════════════════════════════════
# 3. Password reset request
# ════════════════════════════════════════════════════════════════════════════

def send_password_reset_email(email: str, company_name: str, reset_token: str) -> bool:
    subject = "Reset Your DisruptIQ Password"
    reset_url    = f"{config.APP_BASE_URL}/reset-password?token={reset_token}"
    safe_company = _html.escape(company_name)

    body = f"""
      <div style="background:#fff7ed;border-left:4px solid {_AMBER};border-radius:8px;
                  padding:14px 18px;margin-bottom:24px;">
        <div style="font-size:13px;font-weight:700;color:{_AMBER};">
          Password reset requested
        </div>
        <div style="font-size:12px;color:{_MUTED};margin-top:2px;">
          This link expires in <strong>1 hour</strong>.
        </div>
      </div>

      <p style="font-size:14px;color:{_TEXT};margin:0 0 8px;">
        Hi <strong>{safe_company}</strong>,
      </p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 24px;line-height:1.65;">
        We received a request to reset the password on your DisruptIQ account. Use the
        button below to set a new password. If you didn't make this request, no action
        is needed &mdash; your account is safe.
      </p>

      <div style="text-align:center;margin:0 0 28px;">
        {_btn("Reset My Password", reset_url, _RED)}
      </div>

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;
                  padding:14px 18px;font-size:12px;color:{_MUTED};line-height:1.7;">
        <strong style="color:{_TEXT};">Security notice:</strong> This is a single-use link
        that expires in 1 hour. We will never ask for your password over email.
      </div>
    """
    return _send_email(email, subject, _wrap_html("Password Reset", body, _RED))


# ════════════════════════════════════════════════════════════════════════════
# 4. Password changed confirmation
# ════════════════════════════════════════════════════════════════════════════

def send_password_changed_confirmation(email: str, company_name: str) -> bool:
    subject      = "Your DisruptIQ Password Has Been Changed"
    forgot_url   = f"{config.APP_BASE_URL}/forgot-password"
    safe_company = _html.escape(company_name)

    body = f"""
      <div style="background:#f0fdf4;border-left:4px solid {_GREEN};border-radius:8px;
                  padding:14px 18px;margin-bottom:24px;">
        <div style="font-size:13px;font-weight:700;color:{_GREEN};">
          &#10003; Password updated successfully
        </div>
        <div style="font-size:12px;color:{_MUTED};margin-top:2px;">{_ist_now()}</div>
      </div>

      <p style="font-size:14px;color:{_TEXT};margin:0 0 8px;">
        Hi <strong>{safe_company}</strong>,
      </p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 24px;line-height:1.65;">
        Your DisruptIQ account password was successfully updated. If you made this
        change, no further action is needed.
      </p>

      <div style="background:#fef2f2;border-left:4px solid {_RED};border-radius:8px;
                  padding:16px 18px;">
        <div style="font-size:13px;font-weight:700;color:{_RED};margin-bottom:6px;">
          Didn't make this change?
        </div>
        <p style="font-size:12px;color:{_MUTED};margin:0 0 12px;line-height:1.65;">
          If you did not update your password, secure your account immediately.
        </p>
        {_btn("Secure My Account", forgot_url, _RED)}
      </div>

      <p style="font-size:11px;color:{_MUTED};margin:20px 0 0;">
        Further help:
        <a href="mailto:{config.SUPPORT_EMAIL}"
           style="color:{_ACCENT};text-decoration:none;">{config.SUPPORT_EMAIL}</a>
      </p>
    """
    return _send_email(email, subject, _wrap_html("Password Changed", body))


# ════════════════════════════════════════════════════════════════════════════
# 5. Disruption alert (disabled — anti-spam policy)
# ════════════════════════════════════════════════════════════════════════════

def send_disruption_alert_email(email: str, company_name: str, event: dict) -> bool:
    return False  # anti-spam: event-triggered alert emails are not sent


# ════════════════════════════════════════════════════════════════════════════
# 6. Analysis complete (disabled — anti-spam policy)
# ════════════════════════════════════════════════════════════════════════════

def send_analysis_complete_email(email: str, company_name: str, summary: dict) -> bool:
    return False  # anti-spam: analysis-complete emails are not sent


# ════════════════════════════════════════════════════════════════════════════
# 7. Account deletion confirmation
# ════════════════════════════════════════════════════════════════════════════

def send_account_deletion_confirmation(email: str, company_name: str, client_id: str,
                                        deletion_token: str, supplier_count: int = 0,
                                        event_count: int = 0) -> bool:
    subject     = "Confirm Your Account Deletion &mdash; DisruptIQ"
    confirm_url = f"{config.APP_BASE_URL}/confirm-delete?token={deletion_token}"
    cancel_url  = f"{config.APP_BASE_URL}/account"
    safe_company = _html.escape(company_name)

    delete_items = [
        f"Company profile and account settings",
        f"Supplier network ({supplier_count} supplier{'s' if supplier_count != 1 else ''})",
        f"Disruption history ({event_count} event{'s' if event_count != 1 else ''})",
        "AI swarm memory and learning data",
        "All reports, analytics, and scenarios",
    ]
    del_rows = "".join(
        f'<tr><td style="padding:6px 0;font-size:12px;color:{_MUTED};">'
        f'<span style="color:{_RED};margin-right:8px;">&#10005;</span>{item}</td></tr>'
        for item in delete_items
    )

    body = f"""
      <div style="background:#fef2f2;border-left:4px solid {_RED};border-radius:8px;
                  padding:14px 18px;margin-bottom:24px;">
        <div style="font-size:13px;font-weight:700;color:{_RED};">
          Account deletion requested
        </div>
        <div style="font-size:12px;color:{_MUTED};margin-top:2px;">
          This action is permanent and cannot be undone. Please review carefully.
        </div>
      </div>

      <p style="font-size:14px;color:{_TEXT};margin:0 0 8px;">
        Hi <strong>{safe_company}</strong>,
      </p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 20px;line-height:1.65;">
        We received a request to permanently delete your DisruptIQ account and all
        associated data. To proceed, confirm below. This link expires in
        <strong>24 hours</strong>.
      </p>

      <p style="font-size:13px;font-weight:700;color:{_TEXT};margin:0 0 10px;">
        The following will be permanently deleted:
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#fafafe;border:1px solid {_BORDER};border-radius:10px;
                    margin-bottom:18px;">
        <tr><td style="padding:14px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            {del_rows}
          </table>
        </td></tr>
      </table>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
                  padding:12px 18px;margin-bottom:24px;font-size:12px;color:{_MUTED};">
        <strong style="color:{_GREEN};">Retained:</strong>&nbsp;
        Anonymised audit logs only, as required by our data policy. No personal
        data is retained after deletion.
      </div>

      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-right:12px;">
            {_btn("Confirm Delete Account", confirm_url, _RED)}
          </td>
          <td>
            {_btn("Cancel &mdash; Keep My Account", cancel_url, _GREEN)}
          </td>
        </tr>
      </table>

      <p style="font-size:11px;color:{_MUTED};margin:20px 0 0;line-height:1.6;">
        Changed your mind? Click <em>Cancel</em> or let this link expire. Your
        account will remain active.
      </p>
    """
    return _send_email(email, subject, _wrap_html("Confirm Account Deletion", body, _RED))


# ════════════════════════════════════════════════════════════════════════════
# 8. Weekly digest (disabled — anti-spam policy)
# ════════════════════════════════════════════════════════════════════════════

def send_weekly_digest_email(email: str, company_name: str, digest: dict) -> bool:
    return False  # anti-spam: recurring digest emails are not sent


# ════════════════════════════════════════════════════════════════════════════
# 9. Premium access approved
# ════════════════════════════════════════════════════════════════════════════

def send_premium_approved_email(email: str, company_name: str) -> bool:
    subject       = "Your DisruptIQ Pro Access Is Approved"
    dashboard_url = f"{config.APP_BASE_URL}/account/suppliers"
    safe_company  = _html.escape(company_name or "there")

    benefits = [
        ("&#9889;", "Unlimited Supplier Imports",
         "Remove the free-tier cap entirely. Import your full supply network across any number of zones."),
        ("&#129302;", "Full 9-Agent Swarm Pipeline",
         "All specialist agents active: Monitor, Memory, Cascade, Forecast, Risk, Action, Validator, Simulation, and Counterfactual."),
        ("&#128202;", "Complete Analytics Suite",
         "All 9 intelligence reports, Dependency Heatmap, Resilience Score dial, Supplier Trends, and Anomaly Detection."),
        ("&#128506;", "Live Supply Chain Twin Map",
         "Real-time map with your supplier nodes, port hubs, zone overlays, and animated disruption pulses."),
        ("&#129504;", "Memory-Calibrated Forecasting",
         "Every resolved disruption feeds into the swarm's memory. Future forecasts are calibrated by real outcomes, not just cold LLM estimates."),
        ("&#128737;", "Priority Support",
         "Your tickets are prioritised. Dedicated response within 12 hours from our team."),
    ]

    benefit_rows = "".join(f"""
    <tr>
      <td style="padding:14px 14px 14px 0;vertical-align:top;width:36px;
                 font-size:20px;border-bottom:1px solid {_BORDER};">{icon}</td>
      <td style="padding:14px 0;border-bottom:1px solid {_BORDER};">
        <div style="font-weight:700;font-size:13px;color:{_TEXT};margin-bottom:3px;">{title}</div>
        <div style="font-size:12px;color:{_MUTED};line-height:1.5;">{desc}</div>
      </td>
    </tr>""" for icon, title, desc in benefits)

    body = f"""
      <div style="background:linear-gradient(135deg,#1a1050 0%,#0d3d2a 100%);
                  border-radius:12px;padding:28px 24px;text-align:center;margin-bottom:28px;">
        <div style="font-size:34px;margin-bottom:10px;">&#11088;</div>
        <div style="font-size:11px;font-weight:800;color:{_ACCENT};
                    letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">
          PRO ACCESS UNLOCKED
        </div>
        <div style="font-size:20px;font-weight:800;color:#ffffff;margin-bottom:6px;">
          Welcome to DisruptIQ Pro
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,0.50);">{safe_company}</div>
      </div>

      <p style="font-size:14px;color:{_TEXT};margin:0 0 8px;">
        Congratulations, <strong>{safe_company}</strong>!
      </p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 24px;line-height:1.65;">
        Your Pro access request has been approved. Your account is now on the
        <strong>Pro plan</strong> &mdash; the
        <strong style="color:#f59e0b;">&#9733; PRO</strong> badge is visible in your
        dashboard header. Here's everything unlocked for you:
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#fafafe;border:1px solid {_BORDER};border-radius:12px;
                    margin-bottom:24px;">
        <tr><td style="padding:4px 20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            {benefit_rows}
          </table>
        </td></tr>
      </table>

      <div style="text-align:center;margin:0 0 8px;">
        {_btn("Start Importing Suppliers &rarr;", dashboard_url, _GREEN)}
      </div>
      <p style="text-align:center;font-size:11px;color:{_MUTED};margin:12px 0 0;">
        Questions?
        <a href="mailto:{config.SUPPORT_EMAIL}"
           style="color:{_ACCENT};text-decoration:none;">{config.SUPPORT_EMAIL}</a>
      </p>
    """
    return _send_email(email, subject, _wrap_html("Pro Access Approved", body, _GREEN))


# ════════════════════════════════════════════════════════════════════════════
# 10. Support response / resolution
# ════════════════════════════════════════════════════════════════════════════

def send_support_response_email(email: str, company_name: str, ticket_id: str,
                                category: str, message: str, resolved: bool = False) -> bool:
    safe_company  = _html.escape(company_name or "there")
    safe_category = _html.escape(category or "&mdash;")
    safe_msg      = _html.escape(message or "").replace("\n", "<br/>")
    account_url   = f"{config.APP_BASE_URL}/account"
    accent        = _GREEN if resolved else _ACCENT
    subject       = (f"Re: {ticket_id} — Resolved ✅"
                     if resolved else
                     f"Re: {ticket_id} — Update from DisruptIQ Support")

    status_banner = (
        f"""<div style="background:#f0fdf4;border-left:4px solid {_GREEN};border-radius:8px;
                padding:14px 18px;margin-bottom:24px;">
          <div style="font-size:13px;font-weight:700;color:{_GREEN};">
            &#10003; Your ticket has been resolved
          </div>
          <div style="font-size:12px;color:{_MUTED};margin-top:2px;">
            {ticket_id} &middot; {safe_category}
          </div>
        </div>"""
        if resolved else
        f"""<div style="background:#eff6ff;border-left:4px solid {_ACCENT};border-radius:8px;
                padding:14px 18px;margin-bottom:24px;">
          <div style="font-size:13px;font-weight:700;color:{_ACCENT};">
            Update on your support request
          </div>
          <div style="font-size:12px;color:{_MUTED};margin-top:2px;">
            {ticket_id} &middot; {safe_category} &middot; In progress
          </div>
        </div>"""
    )

    body = f"""
      {status_banner}
      <p style="font-size:14px;color:{_TEXT};margin:0 0 8px;">
        Hi <strong>{safe_company}</strong>,
      </p>
      <p style="font-size:13px;color:{_MUTED};margin:0 0 20px;line-height:1.65;">
        {"Our team has reviewed your ticket and provided an update below."
         if not resolved else
         "We've resolved your support ticket. Here's what was addressed:"}
      </p>
      <p style="font-size:12px;color:{_MUTED};margin:0 0 8px;">
        Response from DisruptIQ Support:
      </p>
      <div style="background:#f8f8fc;border-left:3px solid {accent};border-radius:6px;
                  padding:16px 18px;font-size:13px;color:{_TEXT};line-height:1.7;
                  margin-bottom:24px;">
        {safe_msg}
      </div>
      <div style="margin-bottom:20px;">
        {_btn("Open DisruptIQ", account_url, accent)}
      </div>
      <p style="font-size:12px;color:{_MUTED};line-height:1.6;">
        If this didn't fully resolve your issue, reply to this email or open a new
        ticket from your
        <a href="{account_url}"
           style="color:{_ACCENT};text-decoration:none;">Account Settings</a>.
      </p>
    """
    return _send_email(email, subject, _wrap_html(f"Support &mdash; {ticket_id}", body, accent))
