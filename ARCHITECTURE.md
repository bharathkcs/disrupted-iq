# DisruptIQ — Detailed Architecture Guide

> Comprehensive system design, data flow, and architectural patterns.


---

## Table of Contents

1. [System Overview](#system-overview)
2. [Multi-Tenant Architecture](#multi-tenant-architecture)
3. [Data Flow Diagrams](#data-flow-diagrams)
4. [Service Components](#service-components)
5. [Communication Patterns](#communication-patterns)
6. [Scalability & Performance](#scalability--performance)
7. [Fault Tolerance](#fault-tolerance)
8. [Design Patterns](#design-patterns)

---

## System Overview

### Technology Stack

**Backend:**
- Python 3.12 + FastAPI + Uvicorn (async ASGI)
- Socket.IO for WebSocket communication
- Pydantic for validation
- Azure Cosmos DB (persistent) / in-memory dict (demo)
- Azure Content Safety API for filtering
- GitHub Models API for LLM calls
- SendGrid for email

**Frontend:**
- React 18 + Vite 5 + Socket.IO client
- React Router v6 + Recharts for visualization
- TailwindCSS for styling

### High-Level Flow

```
User Reports Disruption
    ↓
POST /api/events/trigger
    ↓
Swarm executes (9 agents, ≤90s)
    ├─ Monitor → Severity check
    ├─ SwarmMemory → Recall past incidents
    ├─ Forecast & Risk (parallel)
    ├─ CascadeDetect → Sister events?
    ├─ Action → 3 ranked options
    ├─ Validator → Dissent score
    ├─ Simulation → Monte Carlo
    └─ HIL Gates → Human approval
    ↓
Human reviews & confirms
    ↓
POST /api/events/hil-confirm
    ↓
Counterfactual agent calibrates memory
    ↓
Event resolved
```

---

## Multi-Tenant Architecture

### The Universal Key: client_id

Every database record, API endpoint, and WebSocket channel is partitioned by `client_id`:

```
JWT (decoded) → { email, client_id, company_name, jti, ... }
                    ↓
            Depends(require_auth)
                    ↓
        current_user["client_id"]
                    ↓
        Filter ALL reads/writes by this
                    ↓
    clients_db[client_id], events (WHERE client_id = ?),
    swarm_states[client_id][event_id], audit_log (WHERE client_id = ?), etc.
```

### Storage Partitioning

| Data Store | Isolation Key | Example Query |
|------------|---------------|---|
| `clients_db` | Direct key | `clients_db[client_id]` |
| `events` | WHERE clause | `SELECT * FROM events WHERE client_id = 'acme-co'` |
| `suppliers` | WHERE clause | `SELECT * FROM suppliers WHERE client_id = 'acme-co'` |
| `swarm_states` | Nested key | `swarm_states[client_id][event_id]` |
| `audit_log` | WHERE clause | `SELECT * FROM audit WHERE client_id = 'acme-co'` |
| `memory` | WHERE clause + stage | `SELECT * FROM memory WHERE client_id = 'acme-co' AND stage = 'STAGE-1'` |
| WebSocket | Room name | `socket.join(f"client_{client_id}")` |

### Seed Clients

Three demo clients bypass isolation for testing:
- `demo`, `ifb`, `tata_motors`

They can:
- See all demo scenarios + templates
- Switch between demo clients
- See all seed cities in weather/news
- Cannot accidentally leak real client data (no real clients, only seed data)

Real clients:
- See ONLY their uploaded suppliers (empty list until upload)
- See ONLY their own events/memory/audit
- News/weather filtered to their zones + industry keywords
- Cannot switch clients

---

## Data Flow Diagrams

### 1. Event Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ Client reports disruption via UI                            │
│ → Click "Report Disruption" button                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ POST /api/events/trigger                                    │
│ Headers: Authorization: Bearer <JWT>                        │
│ Body: { source, geography, location, event_type,           │
│         severity_score, description }                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend: validate JWT → extract current_user               │
│ → create Event record (status="processing")                │
│ → client_id from JWT token                                 │
│ → event_id = UUID4()                                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Async Task: run_swarm(event, client_id)                     │
│                                                             │
│ Stage 1: Monitor (≤5s)                                      │
│   - Compute severity via keyword detection                  │
│   - If severity < threshold: exit, status="below_threshold" │
│   - Emit: swarm_update(Monitor, "complete", ...)           │
│                                                             │
│ Stage 2: SwarmMemory (≤5s)                                  │
│   - Recall memory: geography × supplier_ids → similar       │
│   - Emit: swarm_update(SwarmMemory, "complete", ...)       │
│                                                             │
│ Stage 3: Forecast & Risk (parallel, ≤20s)                  │
│   - Forecast: demand shift using heuristic + memory delta  │
│   - Risk: per-supplier score (5 weighted factors)          │
│   - Emit: swarm_update(Forecast, "complete", ...)          │
│   - Emit: swarm_update(Risk, "complete", ...)              │
│                                                             │
│ Stage 4: CascadeDetect (≤5s)                               │
│   - Check for sister event in last 48h                     │
│   - Shared suppliers? → Cascade flag                       │
│   - Emit: swarm_update(CascadeDetect, "complete", ...)    │
│                                                             │
│ Stage 5: Action (≤10s)                                      │
│   - Generate 3 ranked supplier options                     │
│   - Each: WHY / HOW / RISK (3-sentence rationale)          │
│   - RTO tag (fast/moderate/slow)                           │
│   - Emit: swarm_update(Action, "complete", ...)            │
│                                                             │
│ Stage 6: Validator (≤5s)                                    │
│   - Divergence check on 3 options                          │
│   - If divergence > 15pt: flag for HIL dissent gate        │
│   - Emit: swarm_update(Validator, "complete", ...)        │
│                                                             │
│ Stage 7: Simulation (≤30s SLA with timeout)                │
│   - 3 Monte Carlo scenarios per option (P10/P50/P90)       │
│   - Fallback on timeout                                    │
│   - Emit: swarm_update(Simulation, "complete", ...)       │
│                                                             │
│ Stage 8: HIL Gates (server-side validation)                │
│   - Check if required acks present                         │
│   - Severity ≥9: requires co-reviewer approval             │
│   - Store ack status in event record                       │
│                                                             │
│ Total SLA: ≤90 seconds                                      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ WebSocket Events Broadcasted to Client                      │
│ (every emit_update → socketio.emit)                         │
│                                                             │
│ Frontend receives swarm_update:                             │
│ { event_id, agent, status, payload, timestamp_utc }        │
│                                                             │
│ SwarmFeed: appends to live feed                             │
│ Event panels: populate as data arrives                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Dashboard displays:                                         │
│ - Live SwarmFeed (agent progress)                           │
│ - Event Summary (severity, type, geography)                │
│ - What We've Learned (memory recalled)                     │
│ - Expert Disagreement (if dissent flagged)                 │
│ - Chain Reaction Alert (if cascade flagged)                │
│ - Supplier Risk (table, sortable, "Why?" drill-down)       │
│ - Demand Impact (bar chart with confidence interval)       │
│ - Recommended Actions (3 options, expandable)              │
│ - Simulation Results (P10/P50/P90)                         │
│ - HIL Checkpoints (dissent, cascade, simulation acks)      │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Human Review & Confirmation                                │
│ - Reviews event data                                        │
│ - Acknowledges dissent (if needed)                         │
│ - Acknowledges cascade (if needed)                         │
│ - Selects preferred action option (1-3)                    │
│ - Reviews simulation scenarios                             │
│ - If severity ≥9: co-reviewer also approves                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ POST /api/events/hil-confirm                                │
│ Body: {                                                     │
│   event_id, selected_option,                                │
│   acks: { dissent: true, cascade: false, ... }             │
│ }                                                           │
│                                                             │
│ Server validates: all required acks present?                │
│ If missing: 400 Bad Request                                │
│ If valid: update event → status="approved"                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Post-Approval Actions                                       │
│ - Send notifications to stakeholders                        │
│ - Emit "action_approved" WebSocket                         │
│ - Log to audit trail                                        │
│ - Option selected becomes implementation plan               │
└─────────────────────┬───────────────────────────────────────┘
                      │
          (later, human resolves outcome)
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ POST /api/events/resolve                                    │
│ Body: {                                                     │
│   event_id, actual_outcome,                                │
│   actual_demand_shift, actual_cost_impact,                 │
│   actual_recovery_time                                      │
│ }                                                           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Counterfactual Agent (BR-010)                              │
│ - Compare predicted vs actual                               │
│ - Write Stage-2 memory record                               │
│ - Compute variance delta                                    │
│ - Update forecast calibration for next time                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Event finalized                                             │
│ - status = "resolved"                                       │
│ - stored in counterfactuals_db                              │
│ - feeds next forecast's memory calibration                  │
└─────────────────────────────────────────────────────────────┘
```

### 2. WebSocket Real-Time Connection

```
┌──────────────────────────────────┐
│ Frontend: socket.io({...})       │
│ Connects to ws://localhost:8000/ │
│ socket.io                        │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ Handshake: auth: { token }       │
│ Sends JWT as auth parameter      │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ Backend: on_connect(auth_data)   │
│ - Decode auth_data.token         │
│ - Extract client_id              │
│ - socket.join(f"client_{client_  │
│   id}")                          │
│ - All future emits go to this    │
│   room                           │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ During Swarm Execution           │
│ emit_update() called by agents    │
│ →                                │
│ socketio.emit(                   │
│   'swarm_update',                │
│   {...payload...},               │
│   room=f"client_{client_id}"     │
│ )                                │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ Frontend: on('swarm_update',      │
│   (data) => {...})               │
│                                  │
│ data = {                         │
│   event_id,                      │
│   agent,                         │
│   status,                        │
│   payload,                       │
│   timestamp_utc                  │
│ }                                │
│                                  │
│ Update state → re-render         │
└──────────────────────────────────┘
```

---

## Service Components

### 1. Authentication Service (`auth.py`)

**Responsibilities:**
- JWT generation and verification
- Password hashing (PBKDF2-HMAC-SHA256)
- Session management (per-device revocation via `jti`)
- Rate limiting on sensitive endpoints

**Key Functions:**
```python
hash_password(password: str) → str
verify_password(password: str, hash: str) → bool
create_jwt(email: str, client_id: str, company_name: str, ...) → str
verify_jwt(token: str) → dict  # { email, client_id, jti, exp, ... }
require_auth() → FastAPI dependency that extracts current_user
```

**Security Details:**
- **Algorithm:** HS256 (symmetric; backend signs and verifies)
- **Duration:** 24 hours
- **Revocation:** `jti` (JWT ID) claim enables per-session logout
- **Password:** PBKDF2 with 600,000 iterations + 32-byte random salt
- **Rate Limiting:** 5 attempts/5 min on signup, login, forgot-password

### 2. Storage Layer (`storage.py`)

**Responsibilities:**
- Abstract database operations
- Support both Cosmos DB (live) and in-memory (demo)
- Enforce client_id isolation at query level
- Provide audit trail

**Storage Containers (Cosmos) / Dicts (Memory):**

| Name | Content | Isolation Key |
|------|---------|---|
| `users_db` | { email: { password_hash, client_id, company_name, ... } } | email |
| `clients_db` | { client_id: { company_name, industry, contact_name, suppliers, settings, ... } } | client_id |
| `events` | { event_id: { client_id, severity, geography, agent_outputs, ... } } | client_id (WHERE) |
| `suppliers` | { supplier_id: { client_id, name, zone, categories, buffer_stock, ... } } | client_id (WHERE) |
| `swarm_states` | { client_id: { event_id: { monitor, forecast, risk, ... } } } | client_id (key) + event_id |
| `swarm_memory` | { mem_id: { client_id, stage, geography, suppliers, event_type, ... } } | client_id (WHERE) + stage |
| `audit_log` | { audit_id: { client_id, timestamp, user_email, action, details } } | client_id (WHERE) |
| `notifications_db` | { client_id: [Notification] } | client_id (key) |
| `custom_scenarios_db` | { client_id: [Scenario] } | client_id (key) |
| `feedback_db` | { client_id: [CSATFeedback] } | client_id (key) |
| `support_db` | { ticket_id: { client_id, category, ... } } | client_id (WHERE) |
| `counterfactuals_db` | { mem_id: { client_id, stage="STAGE-2", actual_*, predicted_*, delta } } | client_id (WHERE) |

**Example Query (isolation enforced):**
```python
async def read_suppliers(client_id: str) -> [Supplier]:
  # Cosmos
  query = "SELECT * FROM c WHERE c.client_id = @client_id"
  params = [{ "name": "@client_id", "value": client_id }]
  return await container.query_items(query, parameters=params)
  
  # OR In-Memory
  return suppliers_db.get(client_id, [])
```

### 3. LLM Service (`llm.py`)

**Responsibilities:**
- GitHub Models API interface
- Prompt engineering
- Content Safety filtering
- Retry logic + fallback generation

**Key Function:**
```python
async def chat_json(
  system: str,          # System prompt (role definition)
  user: str,            # User prompt (event + context)
  max_tokens: int = 2000,
  fallback: dict = None  # Deterministic output on API failure
) → dict:
  try:
    response = await github_api.post("/messages", ...)
    return json.parse(response.content)
  except (Timeout, RateLimitError, ServerError):
    return fallback  # Deterministic, dataset-aware
```

**Fallback Strategy:**
- Never returns `None` or empty
- Always returns a valid dict matching the expected schema
- Uses event data + client suppliers to build fallback
- Example: Forecast fallback uses `_xgb_predict(severity, geo, suppliers, ...)`

**Content Safety:**
- Risk agent narratives filtered before storage
- Supplier message filtered before user sees it
- Rejection → fallback text used instead

### 4. Email Service (`email_service.py`)

**Responsibilities:**
- SendGrid integration
- HTML email rendering
- Non-blocking send

**Emails Sent:**

| Trigger | Email | Fields |
|---------|-------|--------|
| Signup | Welcome | email, company_name, industry, first_name |
| Forgot password | Reset link | email, reset_url (1h expiry), company_name |
| Delete account | Goodbye | email, company_name |
| Support ticket | Acknowledgment | email, ticket_id, support_contact |
| Test email | Health check | email, timestamp, is_demo_mode |

**Template Pattern:**
```
To: user.email
From: noreply@disruptiq.app
Reply-To: support@disruptiq.app
Subject: <Subject>
HTML: <styled email with branded header/footer>
```

### 5. Agent Orchestration (`agents.py` + `main.py`)

**Responsibilities:**
- Agent lifecycle
- State propagation
- Real-time progress emission
- Error handling + fallback

**Pipeline Stages:**

```
1. Monitor
   Input: event trigger
   Output: severity_score, proceed (bool)
   Time: ≤5s

2. SwarmMemory
   Input: event (geography, supplier_ids)
   Output: [Stage-1 memory records]
   Time: ≤5s

3. Forecast & Risk (parallel)
   Input: event, memory, client_suppliers
   Output: demand_shift (%), confidence, risk_scores
   Time: ≤20s

4. CascadeDetect
   Input: primary event, all recent events
   Output: sister_events, cascade_multiplier
   Time: ≤5s

5. Action
   Input: forecast, risk, client_suppliers
   Output: [3 ranked options with rationales]
   Time: ≤10s

6. Validator
   Input: all 3 actions
   Output: divergence_score, dissent_flag
   Time: ≤5s

7. Simulation
   Input: event, 3 action options
   Output: [P10, P50, P90 scenarios per option]
   Time: ≤30s (with timeout fallback)

8. HIL Gates (not an agent; server-side)
   Input: event.hil_acks
   Validation: all required acks present?
   Error: 400 if missing

9. Counterfactual (triggered after resolve)
   Input: actual outcome
   Output: Stage-2 memory, variance delta
   Time: ≤5s
```

---

## Communication Patterns

### 1. HTTP Request-Response

**Pattern:** Traditional REST

**Usage:**
- API queries that don't need live updates
- Authentication (login, signup, reset password)
- Account management
- Configuration changes

**Flow:**
```
Client → POST /api/events/trigger
        Headers: Authorization: Bearer <JWT>
        Body: { event_data }
        ↓
Server → Validate JWT
       → Create event record
       → Spawn async swarm task
       → 202 Accepted { event_id }
       ↓
Client → (WebSocket watches live updates)
       → GET /api/events/{event_id} (polling fallback)
```

**Advantages:**
- Standard HTTP semantics
- Cacheability (if applicable)
- Works behind any firewall

**Disadvantages:**
- Polling required for live updates
- Bandwidth overhead

### 2. WebSocket Bidirectional

**Pattern:** Real-time streaming

**Usage:**
- Live swarm progress (agent transitions)
- Notifications
- Live event updates

**Flow:**
```
Frontend connects:
  socket.io({ auth: { token } })
  ↓
Backend on_connect:
  Verify token
  socket.join(f"client_{client_id}")
  ↓
During swarm:
  emit_update(...) → socketio.emit('swarm_update', ..., room=...)
  ↓
Frontend on('swarm_update', (data) => { setSwarmFeed(...) })
```

**Advantages:**
- Zero latency
- Low bandwidth (push only changes)
- Natural for progress indicators

**Disadvantages:**
- Requires connection state
- Reconnection logic needed

### 3. Async Task Execution

**Pattern:** `asyncio.gather()` for parallelism (no external queue)

**Usage:**
- Forecast & Risk run simultaneously
- Monte Carlo simulations
- Email sends (fire-and-forget)

**Example:**
```python
results = await asyncio.gather(
  forecast_agent(event, memory, client_suppliers),
  risk_agent(event, memory, client_suppliers),
  return_exceptions=True
)
if isinstance(results[0], Exception):
  forecast_result = fallback_forecast
else:
  forecast_result = results[0]
```

**Advantages:**
- Simple (no queue infrastructure)
- Low latency

**Disadvantages:**
- Limited to single instance
- No persistent queue for crashes

---

## Scalability & Performance

### Current Single-Instance Architecture

```
┌─────────────┐
│ React App   │
│ (Vite dev   │
│  or CDN)    │
└─────────────┘
       │
       ▼
┌────────────────────────┐
│ FastAPI + Uvicorn      │
│ Single instance        │
│ :8000                  │
│ Max ~100-500 concurrent│
│ WebSocket connections  │
└────────────────────────┘
       │
       ├─▶ Cosmos DB (or in-memory dict)
       ├─▶ Azure Storage (for exports)
       ├─▶ SendGrid
       ├─▶ GitHub Models API (150 req/day free)
       ├─▶ NewsAPI
       └─▶ OpenWeatherMap
```

### Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Event trigger to dashboard | <100 ms | ~50 ms (local) |
| Full swarm execution | ≤90 s | ~60 s (deterministic) |
| API endpoint (p99) | <500 ms | ~50 ms |
| WebSocket latency | <100 ms | ~10 ms (local) |
| Page load (dashboard) | <2 s | ~1 s (Vite dev) |

### Scaling Path

**When to scale:**
- \>100 concurrent users
- \>50 daily active clients
- \>10 swarms/minute

**Multi-Instance Setup:**
```
┌──────────────────────────┐
│ Load Balancer (sticky    │
│ sessions for WebSocket)  │
└───────┬────────┬─────────┘
        │        │
        ▼        ▼
    ┌────────────────┐  ┌────────────────┐
    │ Backend-1      │  │ Backend-2      │
    │ uvicorn :8001  │  │ uvicorn :8001  │
    └────────────────┘  └────────────────┘
           │                   │
           └─────────┬─────────┘
                     ▼
          ┌─────────────────────┐
          │ Shared Cosmos DB    │
          │ All instances       │
          │ read/write same DB  │
          └─────────────────────┘
                     │
                     ├─▶ Redis (optional cache)
                     └─▶ RabbitMQ (optional queue)
```

**Required changes:**
1. Session affinity (sticky sessions) for WebSocket
2. Distributed cache (Redis) for frequently accessed data
3. Message queue (optional) for agent offloading
4. Connection pooling to Cosmos

### Known Bottlenecks

| Bottleneck | Current Limit | Mitigation |
|------------|---------------|---|
| LLM quota | 150 req/day (free) | Fallback deterministic agents |
| Concurrent swarms | 1-3 per second | Async, no external queue |
| WebSocket connections | 100-500 (uvicorn) | Upgrade to `gunicorn` + multiple workers |
| Database throughput | Cosmos RUs | Increase provisioned throughput |
| Email throughput | SendGrid plan | Upgrade tier as needed |

---

## Fault Tolerance

### Failure Detection & Recovery

| Failure | Detection | Recovery | User Impact |
|---------|-----------|----------|---|
| LLM API down (401/429) | Exception caught | Use fallback deterministic agent | Slower narrative, no error shown |
| Cosmos unreachable | Connection error | Switch to in-memory dict | Works in demo; production requires Cosmos |
| Email send fails | SendGrid error | Log + continue (non-blocking) | Emails may not send; flow continues |
| Agent timeout (30s) | asyncio.wait_for timeout | Fallback output | Less detailed response |
| WebSocket disconnect | Socket.io disconnect event | Frontend auto-reconnect (3 attempts) | Temporary loss of live updates |
| JWT expired | jwt.decode fails | 401 response | User redirected to login |
| Missing field in JWT | KeyError on current_user["x"] | 500 (should be prevented by auth) | Error page |

### Graceful Degradation

**LLM API down:**
- Agents continue with fallback generation
- Output quality reduced but usable
- No error modal shown to user; just slower narrative

**Database down (in demo mode):**
- In-memory `dict` used instead
- Server restart wipes all data (expected for demo)
- Production: alerts and manual failover to backup

**Email service down:**
- Transactional emails queued in-process
- Retry on backend restart
- Non-blocking (doesn't halt event processing)

---

## Design Patterns

### 1. Repository Pattern

**Intent:** Decouple storage details from business logic.

```python
class StorageInterface:
  async read_suppliers(client_id: str) -> [Supplier]
  async write_supplier(client_id: str, supplier: Supplier) -> None

# Two implementations: CosmosStorage, MemoryStorage
# Code calls StorageInterface; doesn't know which implementation
```

**Benefit:** Easy to swap (testing, demo vs. live).

### 2. Dependency Injection (FastAPI)

**Intent:** Cleanly separate auth from endpoint logic.

```python
@app.post("/api/events/trigger")
async def trigger_event(
  event_req: EventRequest,
  current_user: dict = Depends(require_auth)
) -> dict:
  # current_user already extracted; no auth logic in handler
  client_id = current_user["client_id"]
  return ...
```

**Benefit:** Testable; secure; easy to mock.

### 3. Strategy Pattern (LLM)

**Intent:** Swap real LLM with fallback transparently.

```python
class LLMStrategy:
  async def chat_json(self, system: str, user: str, fallback: dict) → dict

class GitHubModelsStrategy(LLMStrategy):
  async def chat_json(self, ...):
    return await github_api.chat(...)

class FallbackStrategy(LLMStrategy):
  async def chat_json(self, system, user, fallback):
    return fallback
```

**Benefit:** Agents don't know if real or fallback; clean error handling.

### 4. Observer Pattern (WebSocket)

**Intent:** Decouple agent execution from UI updates.

```python
# In agent
emit_update(event_id, "Forecast", "complete", payload, client_id)

# Broadcast to all clients in room
socketio.emit("swarm_update", {...}, room=f"client_{client_id}")

# Frontend listens
socket.on("swarm_update", (data) => {
  setSwarmFeed(prev => [...prev, data]);
});
```

**Benefit:** Multiple listeners possible; easy to add new ones.

### 5. Template Method Pattern (Agents)

**Intent:** Common agent skeleton; specifics differ.

```python
async def execute_agent(event, memory, suppliers, agent_fn, fallback):
  try:
    system = build_system_prompt(...)
    user = build_user_prompt(...)
    result = await agent_fn(system, user, fallback)
    emit_update(event.id, agent_name, "complete", result, client_id)
    write_audit(client_id, f"{agent_name} executed", result)
    return result
  except Exception as e:
    emit_update(event.id, agent_name, "error", str(e), client_id)
    return fallback
```

**Benefit:** Consistent logging, monitoring, error handling.

---

## Summary

This architecture ensures:

✓ **Strict multi-tenant isolation** — Every layer filters by `client_id`  
✓ **Real-time feedback** — WebSocket streaming of live progress  
✓ **Graceful degradation** — Fallback agents when external services fail  
✓ **Clear scalability path** — Single instance → multi-instance with load balancer  
✓ **Clean separation of concerns** — Storage, auth, LLM, agents, transport all independent  

For configuration, deployment, and troubleshooting, see companion guides.

---

*End of ARCHITECTURE.md*
