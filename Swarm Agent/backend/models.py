"""Pydantic request/response models for DisruptIQ V2.

Centralising models here keeps main.py focused on route handlers and
business logic, and makes the API contract easy to audit.
"""

from typing import Optional
from pydantic import BaseModel, EmailStr


# ─── Event Pipeline ───────────────────────────────────────────────────────────

class EventTrigger(BaseModel):
    description: str
    location: str
    source: str = "Manual"
    type: str = "Disruption Event"
    geography: str = ""
    event_type: str = ""
    severity_score: Optional[float] = None
    demo_mode: bool = False
    idempotency_key: Optional[str] = None


class HILDecision(BaseModel):
    event_id: str
    selected_option_rank: int
    reviewer_id: str = "SC-Lead-001"
    co_reviewer_id: Optional[str] = None
    acknowledged_dissent: bool = False
    acknowledged_cascade: bool = False
    simulation_reviewed: bool = False


class NLQuery(BaseModel):
    event_id: Optional[str] = None
    question: str


class Resolution(BaseModel):
    event_id: str
    actual_outcome: str
    actual_demand_shift: Optional[float] = None
    confirmed_by: str = "SC-Lead-001"


class Acknowledgement(BaseModel):
    event_id: str
    ack_type: str
    reviewer_id: str = "SC-Lead-001"


class SupplierMessageRequest(BaseModel):
    event_id: str
    option_rank: int


# ─── Config ───────────────────────────────────────────────────────────────────

class ConfigUpdate(BaseModel):
    section: str
    values: dict


class SupplierUpdate(BaseModel):
    supplier_id: str
    updates: dict


# ─── Auth ─────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    company_name: str
    industry: str
    contact_name: str = ""
    headquarters_zone: str = ""
    remember_me: bool = False


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class ImportSuppliersRequest(BaseModel):
    csv_content: str


class UpdateProfileRequest(BaseModel):
    company_name: str
    industry: str
    contact_name: str = ""


class UpdateCompanyRequest(BaseModel):
    client_id: str = ""
    company_name: str
    industry: str
    contact_name: str = ""
    headquarters_zone: str = ""


class VerifyResetTokenRequest(BaseModel):
    token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
    confirm_password: str = ""


# ─── Account ──────────────────────────────────────────────────────────────────

class AccountResetRequest(BaseModel):
    confirm: str


class DeleteAccountRequest(BaseModel):
    reason: str = ""
    reason_label: str = ""


class NotificationReadRequest(BaseModel):
    complete: bool = True


class NotificationSettingsRequest(BaseModel):
    disruption_detected: bool = True
    analysis_complete: bool = True
    weekly_digest: bool = False
    security_alerts: bool = True
    account_updates: bool = True
    severe_disruption_email: bool = True


# ─── Suppliers ────────────────────────────────────────────────────────────────

class SupplierInput(BaseModel):
    name: str
    zone: str
    categories: list[str] = []
    buffer_stock_days: int = 7
    sites: int = 1
    reliability: int = 85
    proximity_score: int = 5


class BulkDeleteRequest(BaseModel):
    supplier_ids: list[str]


# ─── Scenarios ────────────────────────────────────────────────────────────────

class ScenarioCreate(BaseModel):
    name: str
    description: str = ""
    location: str
    type: str
    severity: int
    tags: list[str] = []


# ─── Feedback & Support ───────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    rating: int
    comment: str = ""


class SupportRequest(BaseModel):
    category: str
    priority: str = "Normal"
    description: str


class SupportResponseRequest(BaseModel):
    message: str
    resolved: bool = False


class SurveyRequest(BaseModel):
    """Public landing-page product survey (no auth)."""
    role: str = ""
    challenge: str = ""
    feature: str = ""
    comment: str = ""
    email: str = ""


# ─── Auto-Monitoring (Section 1 Sprint) ───────────────────────────────────────

class MonitorConfigRequest(BaseModel):
    auto_trigger_enabled: bool = True
    threshold: float = 7.0
    cooldown_hours: int = 6
