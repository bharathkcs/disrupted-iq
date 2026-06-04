# DisruptIQ V2 — Complete Database Schema

> Detailed schema, field definitions, relationships, and usage examples.

**Last Updated:** 2026-05-22

---

## Overview

The database uses **Azure Cosmos DB (SQL API)** for live environments or **in-memory Python dicts** for demo mode. Both support the same logical schema.

**Key Principle:** Every record includes `client_id` for strict multi-tenant isolation.

---

## Core Collections

### 1. Users (`users_db`)

**Primary Key:** `email`

```python
{
  "id": "user@example.com",
  "email": "user@example.com",
  "password_hash": "pbkdf2$...",  # PBKDF2-HMAC-SHA256
  "client_id": "acme-co",
  "first_name": "John",
  "last_name": "Doe",
  "company_name": "ACME Corp",
  "industry": "Automotive",
  "contact_phone": "+1-555-0123",
  "timezone": "America/New_York",
  "created_at": "2026-05-22T10:30:00Z",
  "updated_at": "2026-05-22T10:30:00Z",
  "is_active": True,
  "last_login": "2026-05-22T14:00:00Z",
  "failed_login_attempts": 0,
  "is_locked": False
}
```

---

### 2. Clients (`clients_db`)

**Primary Key:** `client_id`

```python
{
  "id": "acme-co",
  "client_id": "acme-co",
  "company_name": "ACME Corp",
  "industry": "Automotive",
  "logo_url": "https://cdn.example.com/logo.png",
  "contact_name": "John Doe",
  "supplier_count": 15,
  "free_tier_supplier_limit": 50,
  "created_at": "2026-05-22T10:30:00Z",
  "notification_settings": {
    "email_on_disruption": True,
    "sms_on_critical": False,
    "weekly_summary": True
  },
  "onboarding_completed": {
    "profile": True,
    "suppliers_uploaded": True,
    "first_event_triggered": True
  }
}
```

---

### 3. Suppliers

**Primary Key:** `supplier_id`

```python
{
  "id": "supplier-uuid-1",
  "supplier_id": "supplier-uuid-1",
  "client_id": "acme-co",
  "name": "FastTrack Logistics",
  "category": "Logistics",
  "zone": "Mumbai",
  "location": {
    "latitude": 19.0760,
    "longitude": 72.8777,
    "address": "123 Trade Street, Mumbai, India"
  },
  "buffer_stock_days": 30,
  "sites": 3,
  "reliability_percentage": 95.5,
  "proximity_score": 8,
  "lead_time_days": 14,
  "annual_spend": 1500000,
  "critical_parts_supplied": ["Engine Block", "Transmission"],
  "health_score": 82,
  "created_at": "2026-05-22T10:30:00Z",
  "is_active": True
}
```

---

### 4. Events

**Primary Key:** `event_id`

```python
{
  "id": "event-uuid-abc",
  "event_id": "event-uuid-abc",
  "client_id": "acme-co",
  "source": "manual",
  "event_type": "Port Strike",
  "geography": "Mumbai",
  "severity_score": 8,
  "description": "Port workers strike affecting container handling",
  "status": "processing",
  "created_by": "john@acme.com",
  "created_at": "2026-05-22T14:00:00Z",
  "monitor_output": { "severity_computed": 8 },
  "forecast_output": { "demand_shift_percentage": -15 },
  "risk_output": { "supplier_scores": [...] },
  "action_output": { "options": [...] },
  "simulation_output": { "options": [...] },
  "hil_acks": { "dissent": { "required": True, "acknowledged": False } },
  "approval": { "selected_option": None, "approved_at": None },
  "updated_at": "2026-05-22T14:02:00Z"
}
```

---

### 5. Swarm Memory

```python
# Stage-1: Predicted outcomes
{
  "id": "mem-uuid-1",
  "mem_id": "mem-uuid-1",
  "client_id": "acme-co",
  "stage": "STAGE-1",
  "event_type": "Port Strike",
  "geography": "Mumbai",
  "predicted_demand_shift": -15,
  "predicted_recovery_time_days": 3,
  "predicted_cost_impact": 22,
  "affected_suppliers": ["supplier-uuid-1"],
  "created_at": "2026-05-22T14:00:00Z"
}

# Stage-2: Actual outcomes (after resolution)
{
  "id": "mem-uuid-1-stage2",
  "mem_id": "mem-uuid-1",
  "client_id": "acme-co",
  "stage": "STAGE-2",
  "actual_demand_shift": -12,
  "actual_recovery_time_days": 2,
  "actual_cost_impact": 20,
  "variance_demand": -3,
  "calibration_delta": { "demand": 0.03, "recovery_time": -1 }
}
```

---

### 6. Audit Log

```python
{
  "id": "audit-uuid-1",
  "audit_id": "audit-uuid-1",
  "client_id": "acme-co",
  "user_email": "john@acme.com",
  "action": "event_triggered",
  "resource_type": "Event",
  "resource_id": "event-uuid-abc",
  "details": { "event_type": "Port Strike", "geography": "Mumbai" },
  "timestamp_utc": "2026-05-22T14:00:00Z",
  "status": "success"
}
```

---

### 7. Notifications

```python
{
  "id": "notif-uuid-1",
  "notification_id": "notif-uuid-1",
  "client_id": "acme-co",
  "type": "event_alert",
  "title": "Port Strike Detected",
  "message": "A port strike has been detected and requires review",
  "severity": "critical",
  "related_event_id": "event-uuid-abc",
  "created_at": "2026-05-22T14:00:00Z",
  "read": False
}
```

---

### 8. Custom Scenarios

```python
{
  "id": "scenario-uuid-1",
  "scenario_id": "scenario-uuid-1",
  "client_id": "acme-co",
  "title": "Peak monsoon disruption",
  "description": "Heavy monsoon in Western India region",
  "type": "custom",
  "event_type": "Weather Event",
  "geographies": ["Mumbai", "Delhi"],
  "assumed_severity": 8,
  "created_by": "john@acme.com",
  "created_at": "2026-05-22T10:30:00Z"
}
```

---

### 9. CSAT Feedback

```python
{
  "id": "feedback-uuid-1",
  "feedback_id": "feedback-uuid-1",
  "client_id": "acme-co",
  "user_email": "john@acme.com",
  "rating": 4,
  "comment": "Recommendations were helpful",
  "related_event_id": "event-uuid-abc",
  "created_at": "2026-05-22T15:00:00Z"
}
```

---

### 10. Support Tickets

```python
{
  "id": "tkt-20260522-001",
  "ticket_id": "tkt-20260522-001",
  "client_id": "acme-co",
  "user_email": "john@acme.com",
  "category": "Feature Request",
  "priority": "High",
  "title": "API access for programmatic event trigger",
  "status": "open",
  "created_at": "2026-05-22T14:30:00Z"
}
```

---

### 11. Sessions

```python
{
  "id": "jti-abc123def456",
  "jti": "jti-abc123def456",
  "email": "john@acme.com",
  "client_id": "acme-co",
  "ip_address": "203.0.113.42",
  "browser": "Chrome",
  "created_at": "2026-05-22T14:00:00Z",
  "expires_at": "2026-05-23T14:00:00Z"
}
```

---

## Cosmos DB Configuration

**Partition Key:** `/client_id` for all collections (ensures isolation)

**Indexes:**
```
Collection: events
  - /client_id (required)
  - /event_id
  - /status
  - /created_at

Collection: suppliers
  - /client_id (required)
  - /zone
  - /category

Collection: swarm_memory
  - /client_id (required)
  - /stage
  - /event_type
  - /geography
```

**Query Examples:**

Get all events for a client:
```sql
SELECT * FROM c WHERE c.client_id = 'acme-co' ORDER BY c.created_at DESC
```

Get unresolved events:
```sql
SELECT * FROM c 
WHERE c.client_id = 'acme-co' AND c.status IN ('processing', 'approved')
```

Get memory records for a geography:
```sql
SELECT * FROM c 
WHERE c.client_id = 'acme-co' AND c.geography = 'Mumbai' AND c.stage = 'STAGE-1'
```

---

## Relationship Diagram

```
User (email) → Client (client_id) → {
  Suppliers,
  Events → SwarmMemory (Stage-1 & Stage-2),
  Scenarios,
  Notifications,
  AuditLog,
  Feedback,
  SupportTickets,
  Sessions
}
```

---

## Data Retention

| Data | Retention |
|------|-----------|
| User accounts | Indefinite (active) |
| Events | 2 years |
| Audit log | 1 year (compliance) |
| Memory records | Indefinite (learning) |
| Sessions | 24 hours |
| Notifications | 30 days |

---

*End of DATABASE_SCHEMA.md*
