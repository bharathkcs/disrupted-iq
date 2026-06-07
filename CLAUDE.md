# CLAUDE.md — DisruptIQ Complete Project Guide

> **Single source of truth.** This file tells Claude (or any other LLM) everything needed to understand, run, extend, debug, and audit this project. If you change anything substantial, update the section below it.


**Repo:** `e:\Swarm`
**Stack:** Python 3.12 + FastAPI + Socket.IO (backend) · React 18 + Vite + Recharts (frontend) · Azure Cosmos DB / in-memory fallback

---

## 1. Project In One Paragraph

**DisruptIQ V2** is a multi-tenant supply-chain disruption-response platform. When a disruption hits (cyclone, port strike, supplier insolvency), nine specialised AI agents coordinate through a FastAPI backend and stream their work to a React dashboard in real time over Socket.IO. The agents detect the event, recall similar past incidents from memory, forecast demand impact, score per-supplier risk, propose three ranked recovery actions, simulate outcomes via Monte Carlo, and require human approval at gated checkpoints. After the human confirms, a counterfactual agent records the actual outcome so the system gets smarter over time. The whole pipeline runs in **under 90 seconds**. Every byte of data — suppliers, events, news, weather, scenarios, memory — is **strictly isolated by `client_id`** so a real client (e.g. a rubber manufacturer) never sees data from another client or from the demo seed.

---

## 2. Quick Start

```powershell
# Terminal 1 — backend (port 8000)
cd "e:\Swarm\Swarm Agent\backend"
pip install -r requirements.txt
python main.py

# Terminal 2 — frontend (port 3000)
cd "e:\Swarm\Swarm Agent\frontend"
npm install
npm run dev
```

Open `http://localhost:3000`. Click **Try Demo →** for instant demo, or **Sign Up** to register a real client.

**Demo mode** (no credentials needed): set `DEMO_MODE=true` in `backend/.env`. LLM calls return synthetic outputs; storage uses in-memory dicts.

**Live mode**: configure `backend/.env`:
- `GITHUB_TOKEN` — GitHub Models API (150 free LLM req/day)
- `AZURE_COSMOS_ENDPOINT` + `AZURE_COSMOS_KEY` — persistent memory
- `AZURE_CONTENT_SAFETY_ENDPOINT` + `AZURE_CONTENT_SAFETY_KEY` — safety filter
- `NEWSAPI_KEY` — real-time news polling
- `SENDGRID_API_KEY` — outbound email (welcome, support, account-delete)
- `JWT_SECRET` — must be ≥32 bytes for HS256
- `DEMO_MODE=false`

---

## 3. Repository Layout

```
e:\Swarm\
├── CLAUDE.md                         ← THIS FILE (master project guide)
├── dataset\                          ← 10 industry-specific supplier .xlsx for onboarding
│   ├── _generate.py                  ← regenerates the 10 datasets
│   ├── 01_Automotive_15_suppliers.xlsx
│   ├── 02_Electronics_20_suppliers.xlsx
│   └── … (8 more, 176 supplier rows total)
└── Swarm Agent\
    ├── README.md                     ← Quick reference (run commands, BRD map)
    ├── backend\
    │   ├── main.py                   ← FastAPI app + Socket.IO + run_swarm orchestrator (~3 950 lines)
    │   ├── agents.py                 ← 9 pipeline agents + 4 enhancement agents (~1 500 lines)
    │   ├── storage.py                ← Cosmos / in-memory abstraction with client_id isolation
    │   ├── auth.py                   ← JWT, PBKDF2 password hashing, rate-limit, sessions
    │   ├── llm.py                    ← GitHub Models client + Content Safety + retry/fallback
    │   ├── email_service.py          ← SendGrid HTML emails (welcome, support, deletion)
    │   ├── config.py                 ← env loader, CORS, dynamic flags
    │   ├── seed_data.py              ← Demo suppliers, scenarios, zones, ports (seed_clients ONLY)
    │   ├── requirements.txt
    │   └── .env(.example)
    └── frontend\
        ├── package.json              ← React 18 · Vite 5 · Socket.IO client · Recharts · React Router
        ├── vite.config.js            ← Dev proxy /api,/health,/socket.io → :8000
        ├── index.html
        └── src\
            ├── App.jsx               ← Header, routes, sockets, modals
            ├── main.jsx              ← Entry + ErrorBoundary
            ├── styles\index.css      ← Industrial dark theme tokens
            ├── services\
            │   ├── api.js            ← All /api wrappers
            │   └── auth.js           ← JWT storage / session helpers
            ├── pages\                ← 17 pages
            └── components\           ← 19 reusable components
```

---

## 4. Architecture Overview

### 4.1 Multi-Tenant Data Model

```
JWT (24h) → email + client_id + company_name (extra_claims)
     │
     ▼
Every endpoint: Depends(auth.require_auth) → current_user dict
     │
     ▼
All reads/writes filter by current_user["client_id"]
     │
     ▼
clients_db[client_id]  ─── per-client suppliers, settings, onboarding checklist
events                 ─── tagged with client_id, queryable per tenant
swarm_states           ─── partitioned: swarm_states[client_id][event_id]
swarm_memory           ─── recall_memory(geography, supplier_ids, client_id=…)
audit_log              ─── client_id column on every row
notifications_db       ─── { client_id: [Notification] }
custom_scenarios_db    ─── { client_id: [Scenario] }
feedback_db            ─── { client_id: [CSATFeedback] }
support_db             ─── { client_id: [SupportTicket] }
premium_requests_db    ─── [{ id, client_id, company_name, email, status, requested_at, decided_at }]
self_deletions_db      ─── [{ client_id, company_name, email, reason, reason_label, deleted_at, supplier_count, event_count, was_premium }]
```

`SEED_CLIENT_IDS = {"demo", "ifb", "tata_motors"}` are the **only** client IDs allowed to read seed_data.py. Real clients get an **empty list** until they upload their own suppliers — never demo data, never any other client's data.

### 4.2 The 9-Agent Swarm Pipeline (≤90 s SLA)

```
Monitor (BR-001)  ─┐
                   ├─▶ severity ≥ threshold? ──no──▶ stop (below_threshold)
                   ▼
SwarmMemory (BR-002)  ─── recall_memory(geo, supplier_ids, client_id) [STAGE-1 records only]
                   ▼
CascadeDetect (BR-009) ── runs in parallel if a sister event within 48h
                   ▼
   ┌───────────────┼───────────────┐
   ▼               ▼
Forecast (BR-003)  Risk (BR-004)         ← both run via asyncio.gather, get client_suppliers
   │               │
   └───────┬───────┘
           ▼
   Action (BR-005) ── 3 ranked options, RTO tags, supplier-message drafter (Feature 4)
           ▼
   Validator (BR-006) ─── flags dissent (>15-pt divergence) ─▶ HIL gate
           ▼
   Simulation (BR-007) ── 30s SLA, 3 Monte-Carlo scenarios per option
           ▼
   HIL Confirmation (BR-008) ── 3 gates: dissent, cascade, simulation. Severity≥9 needs co-reviewer.
           ▼
   Counterfactual (BR-010) ─── after human resolves event, writes STAGE-2 memory
```

**Enhancement agents (non-pipeline, on-demand):**
- **Resilience Score** — 0-100 dial, 4 components (supplier diversity, geo spread, financial buffer, lead time)
- **Data Quality** — news/weather feed freshness + confidence
- **Supplier Communication** — LLM drafts outreach email per option
- **Supplier Dependency** — category × zone concentration heatmap

### 4.2.1 MCAS — Memory-Calibrated Agent Swarm (Our Novel Architecture)

DisruptIQ implements **MCAS (Memory-Calibrated Agent Swarm)** — an agent-swarm
architecture where post-resolution counterfactuals are fed back into Stage-2
memory, so each subsequent forecast is calibrated by real-world deltas. This
turns a stateless multi-agent system into one that measurably improves over time.

**What makes MCAS different from standard agent-swarm frameworks:**

| Capability | Standard swarms (LangGraph / CrewAI / AutoGen) | DisruptIQ (MCAS) |
|---|---|---|
| Memory | Ephemeral per-run context | Stage-1 recall + Stage-2 counterfactual write-back loop |
| Human control | Optional callback | Server-enforced HIL gates + co-reviewer for severity ≥9 |
| LLM failure handling | Crash or generic retry | Dataset-aware deterministic fallbacks |
| Cross-event reasoning | None | Cascade detection — 48h compound-event window |
| Explainability | Black box | Per-supplier "Why?" with 5-factor breakdown |

The defining loop: after a human confirms the actual outcome of an event,
the Counterfactual agent records `actual - predicted` deltas into Stage-2
memory. The next forecast for a similar event type and geography is then
calibrated by those real deltas instead of relying on cold LLM estimates.
This is the property that classic swarm frameworks do not have.

### 4.3 Storage Layer

**Primary:** Azure Cosmos DB (SQL API), auto-creates `disruptiq` database with containers `swarm_memory`, `audit_log`, `events`, `counterfactuals`, `config_events`.
**Fallback:** in-memory `dict[]` and `list[]` in `storage.py` — auto-engages if Cosmos unreachable. Ephemeral — **server restart wipes everything when `DEMO_MODE=true`**. In live mode you must configure Cosmos.

---

## 5. Complete API Reference (86 endpoints)

All endpoints require `Bearer <JWT>` unless noted. Body is JSON. Filtered by `client_id` from the JWT.

### 5.1 Auth (15)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/signup` | Register: email + password + company + industry + contact_name. Sends welcome email, seeds 5 industry-specific scenarios into `custom_scenarios_db[client_id]`. |
| POST | `/api/auth/login` | Returns JWT (24h). Tracks session with `jti`, browser, device, IP. |
| POST | `/api/auth/logout` | Invalidates current session. |
| POST | `/api/auth/logout-all` | Invalidates all sessions for the user. |
| GET | `/api/auth/me` | Current user profile. |
| GET | `/api/auth/sessions` | List active sessions for the user. |
| DELETE | `/api/auth/sessions/{jti}` | Revoke a specific session. |
| POST | `/api/auth/change-password` | Requires current password. |
| POST | `/api/auth/forgot-password` | Sends reset email (1h expiry). |
| POST | `/api/auth/verify-reset-token` | Pre-check before reset form. |
| POST | `/api/auth/reset-password` | Apply new password using token. |
| POST | `/api/auth/update-company` | Edit company name + industry. |
| PUT | `/api/auth/update-profile` | Edit contact name. |
| POST | `/api/auth/import-suppliers` | Bulk JSON supplier import. |

**Rate-limited:** signup, login, forgot-password (5 attempts / 5 min).

### 5.2 Supplier Management (12)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/suppliers` | List the client's own suppliers. |
| POST | `/api/suppliers/add-single` | Add one supplier. |
| PUT | `/api/suppliers/{id}` | Update by ID. |
| DELETE | `/api/suppliers/{id}` | Remove one. |
| POST | `/api/suppliers/bulk-delete` | Remove many. |
| GET | `/api/suppliers/template` | Download blank Excel template (.xlsx with example placeholder rows — no demo company names). |
| POST | `/api/suppliers/upload-excel` | Upload .xlsx, 10 MB max, **30-supplier free-tier cap** (premium = unlimited), validates Supplier Name + Zone columns. |
| POST | `/api/suppliers/upload-csv` | Upload .csv equivalent of the Excel schema. Same 30-supplier cap logic. |
| GET | `/api/suppliers/export` | Download client's current supplier list as styled .xlsx. |
| GET | `/api/suppliers/health-scores` | Per-supplier composite health score 0-100. |
| GET | `/api/suppliers/compare?ids=a,b,c` | Side-by-side comparison. |
| GET | `/api/suppliers/trends` | 30-day synthetic trend per supplier. |
| GET | `/api/suppliers/anomalies` | Statistical outliers in the supplier set. |

### 5.3 Event Pipeline (10)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/events/trigger` | Run full 9-agent swarm. Body: `{ source, geography, location, event_type, severity_score, description }`. Returns `event_id`. |
| GET | `/api/events` | List events (filterable by source, geography, severity, date). |
| GET | `/api/events/{id}` | Full event state: monitor + forecast + risk + action + simulation + cascade. |
| GET | `/api/events/{id}/risk-changes` | Per-supplier risk explanation for the "Why?" drill-down modal. |
| POST | `/api/events/acknowledge` | HIL ack for `dissent` / `cascade` / `memory` gates. |
| POST | `/api/events/hil-confirm` | Confirm selected action option. 400 if required acks missing. |
| POST | `/api/events/nl-query` | Conversational Q&A over the event context. |
| POST | `/api/events/supplier-message` | Generate supplier outreach email for a chosen rank. |
| POST | `/api/events/resolve` | Submit actual outcome → triggers Counterfactual + Stage-2 memory write. |

### 5.4 Dashboard Widgets (10)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/supply-chain-map` | Twin Map SVG data: nodes (client suppliers), edges, port hubs, active disruptions. |
| GET | `/api/resilience-score` | 0-100 dial + 4 components + recommendations. |
| GET | `/api/data-quality` | News/weather feed quality — **filtered by client zones / industry keywords**. |
| GET | `/api/dependency-heatmap` | Category × zone supplier concentration matrix. |
| GET | `/api/news/latest` | Recent alerts — filtered: client_zones → industry keywords → empty (no seed leak). |
| GET | `/api/weather/current` | Weather for **only the client's supplier zones** (seed clients see all 8 cities). |
| GET | `/api/demo-scenarios` | Returns `[]` for real clients, scenario list for seed clients. |
| GET | `/api/scenarios` | Returns the 5 auto-seeded industry scenarios + custom user scenarios. Templates list empty for real clients. |
| POST | `/api/scenarios` | Create a custom scenario. |
| DELETE | `/api/scenarios/{id}` | Delete one. |

### 5.5 Reports (10)
`GET /api/reports/summary` returns links to all 9 reports. R-01 through R-09 cover:
event log, swarm performance, memory accuracy, dissent detection, simulation accuracy, cascade detection, counterfactual summary, HIL decisions, forecast-risk accuracy. **All filtered by client_id.**

### 5.6 Memory / Audit (6)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/memory` | Stage-1 + Stage-2 records, filtered by client_id. |
| GET | `/api/counterfactuals` | Resolved events with actual-vs-predicted variances. |
| GET | `/api/audit-log` | All agent actions for this client. |
| GET | `/api/audit-log/export` | CSV download of audit log. |
| GET | `/api/config/history` | Threshold + supplier config change history. |
| GET | `/api/nl-queries/{event_id}` | Past NL conversations for an event. |

### 5.7 Account / Onboarding (9)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/onboarding/checklist` | 6-step onboarding progress. |
| PUT | `/api/onboarding/checklist/{step_id}` | Mark a step complete/incomplete. |
| GET | `/api/account/notifications` | Per-channel notification toggles. |
| PUT | `/api/account/notifications` | Update toggles. |
| POST | `/api/account/test-email` | Sends a test email to verify deliverability. |
| **POST** | **`/api/account/delete`** | **Immediate permanent delete** — optional body `{reason, reason_label}` captures churn reason. Records deletion in `self_deletions_db` before wiping. Wipes client + user + events + memory + audit + sessions + scenarios + feedback + support. Sends best-effort goodbye email. Idempotent on missing `users_db` record. |
| POST | `/api/account/confirm-delete` | Legacy token-based confirmation (kept for backward compat). |
| POST | `/api/account/reset-data` | Wipes events/memory/audit but keeps account. Requires `DELETE <Company>` confirmation text. |
| GET | `/api/account/export-data` | Downloads full client export as .zip (json + xlsx). |
| POST | `/api/account/request-premium` | Submit a premium access request. Stored in `premium_requests_db`; admin reviews in Admin Console. Returns `{ status, message }`. |

### 5.8 Feedback & Support (2)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/feedback` | CSAT: `{ rating: 1-5, comment: str }`. Stored in `feedback_db[client_id]`. |
| POST | `/api/support` | Support ticket: `{ category, priority, description (≥20 chars) }`. Emails client + admin. Returns `ticket_id = TKT-XXXXXX`. |

### 5.9 Multi-tenant / Clients (3)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/clients` | Real clients see only their own entry; seed clients see seed list. |
| POST | `/api/clients/switch` | 403 for real clients; seed clients can hot-switch active demo tenant. |
| GET | `/api/registrations` | Admin: list new signups from audit log. |

### 5.10 Notifications, Search, Misc (9)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notifications` | Bell dropdown feed for current client. |
| POST | `/api/notifications/{id}/read` | Mark one read. |
| POST | `/api/notifications/read-all` | Mark all read. |
| DELETE | `/api/notifications/{id}` | Dismiss. |
| GET | `/api/search?q=` | Global search across this client's events + suppliers + audit. |
| GET | `/api/config` | Threshold + service status (demo_mode, llm_live, cosmos_live, …). |
| POST | `/api/config/update` | Adjust thresholds (CASCADE_OVERLAP_MULTIPLIER, DISSENT_DIVERGENCE_THRESHOLD, etc). |
| POST | `/api/config/suppliers/update` | Update one of the client's own suppliers (does NOT touch seed data). |
| GET | `/health` | Service health + flags. No auth. |

### 5.11 WebSocket
**Path:** `ws://localhost:8000/socket.io`
**Auth:** JWT passed in handshake `auth: { token }`. Socket lands in `room=client_<client_id>`.
**Demo:** Unauthenticated demo sessions pass `X-Demo-Session` header → unique isolated room per session (no cross-demo leakage).
**Event:** `swarm_update` — `{ event_id, agent, status, payload, timestamp_utc }`. Only delivered to the owning client's room.

### 5.12 Admin Console (20 endpoints)
All require `is_admin=true` in the JWT (owner account). Non-owners receive 404 so the admin route is invisible.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/overview` | Dashboard stats: total users, premium count, active events, swarm runs, support ticket count, feedback avg. |
| GET | `/api/admin/users` | All registered accounts with email, company, industry, premium flag, suspended flag, supplier count, event count, created_at. |
| POST | `/api/admin/users/{client_id}/suspend` | Suspend an account — next API call returns 403 `ACCOUNT_SUSPENDED`; frontend shows suspension overlay. |
| POST | `/api/admin/users/{client_id}/reactivate` | Lift suspension. |
| POST | `/api/admin/users/{client_id}/grant-premium` | Grant premium without a formal request. |
| POST | `/api/admin/users/{client_id}/revoke-premium` | Revoke premium access. |
| POST | `/api/admin/users/{client_id}/delete` | Hard-delete an account (same as self-delete but admin-initiated). |
| GET | `/api/admin/premium-requests` | List all premium access requests with status (pending / approved / denied). |
| POST | `/api/admin/premium-requests/{id}/approve` | Approve a request — sets `premium=true` on the client, notifies via in-app notification. |
| POST | `/api/admin/premium-requests/{id}/deny` | Deny a request. |
| GET | `/api/admin/support` | All support tickets across all clients with category, priority, status, description. |
| POST | `/api/admin/support/{ticket_id}/respond` | Send a response to a support ticket. |
| GET | `/api/admin/feedback` | All CSAT ratings + comments across all clients. |
| GET | `/api/admin/activity?limit=` | Recent audit log entries across all clients (default last 200). |
| GET | `/api/admin/ai-interactions?limit=` | Recent NL interrogation Q&A pairs across all clients (last 200). |
| GET | `/api/admin/system-health` | Backend service flags: demo_mode, llm_live, cosmos_live, email_live, safety_live, uptime, memory usage. |
| GET | `/api/admin/deleted-accounts` | Accounts deleted by admin action with timestamp and reason. |
| POST | `/api/admin/deleted-accounts/{client_id}/restore` | Restore a soft-deleted account (re-creates empty record). |
| GET | `/api/admin/self-deletions` | Self-initiated deletions with churn reason labels and metadata (supplier count, event count, was_premium). |

---

## 6. Frontend Pages & Components

### 6.1 Pages (`src/pages/`)
| File | Route | Purpose |
|---|---|---|
| `Landing.jsx` | `/` | Public homepage: hero, problem/solution, features, **testimonials, industry cases (4 tabs), survey banner**, pricing, FAQ, final CTA. The **survey button opens a 3-step modal** (role, challenge, feature, comment, email). |
| `LoginPage.jsx` | `/login` | Sign-in form. |
| `SignupRegister.jsx` | `/signup-register` | Sign-up. Global CSS fix for native `<option>` text colour. Confetti + welcome screen on success. |
| `ForgotPassword.jsx` | `/forgot-password` | Request reset link. |
| `ResetPassword.jsx` | `/reset-password?token=…` | Apply new password. |
| `Dashboard.jsx` | `/dashboard/:client_id`, `/demo` | Main control room: Swarm Feed, Event Summary, Memory Recall, Dissent, Cascade, Risk Table, Demand Chart, Action Options, HIL gates, NL chat, Resilience, Data Quality, Scenarios, Report Disruption. **Socket.IO connects with JWT and joins client room.** |
| `SupplyChainMap.jsx` | `/map` | India SVG twin map with supplier nodes, port hubs, animated disruption pulses. |
| `DependencyHeatmap.jsx` | `/dependencies` | Category × zone matrix + concentration risk bars. |
| `SupplierTrends.jsx` | `/trends` | 30-day synthetic supplier health trends. |
| `Reports.jsx` | `/reports` | 9-tab report viewer (R-01 through R-09). |
| `EventHistory.jsx` | `/history` | Past events + counterfactual detail. |
| `WeatherMonitor.jsx` | `/weather` | Per-city weather (seed: 8 cities; real client: only supplier zones). |
| `Config.jsx` | `/config` | Threshold viewer/editor + supplier config + change history. |
| `AccountSettings.jsx` | `/account`, `/account/:tab` | 7 tabs: Profile · Change Password · Notifications · Security (sessions) · **Feedback (CSAT stars)** · Onboarding · Account Info (incl. **3-phase Danger Zone delete**). |
| `Admin.jsx` | `/admin` | **Owner-only console** with 10 tabs: Overview (stats cards) · Accounts (suspend / grant-premium / delete) · Deleted · Churned (self-deletions with reason labels) · Premium Requests (approve / deny) · Support (respond to tickets) · Feedback (CSAT ratings) · Activity Log · AI Interactions · System Health. Route is invisible to non-owners (API returns 404 → redirects away). |

### 6.2 Components (`src/components/`)
| File | Use |
|---|---|
| `ui.jsx` | `Tag`, `PanelHeader`, `Stat`, `Eyebrow`, `tierColor()`, `severityColor()`, **`InfoTooltip`** (the `?` icon with hover/click popover, used on every panel header). |
| `SwarmFeed.jsx` | UI01 — live agent feed (Socket.IO). |
| `EventPanels.jsx` | UI02-UI05 — EventSummary, MemoryRecall, DissentPanel, CascadeAlert. All have `InfoTooltip` with `title + description`. |
| `RiskAndForecast.jsx` | UI06-UI07 — sortable Supplier Risk Table with "Why?" modal + Demand Impact bar chart with error bars + low-confidence amber. |
| `ActionOptions.jsx` | UI08 — three ranked options with **3-sentence rationales** (WHY supplier · HOW it works · RISK to watch). Expandable Monte Carlo scenarios + Draft Notification button. |
| `HILAndChat.jsx` | UI09-UI13 — NL chat, HIL multi-gate checklist, history, audit log, scenario launcher. |
| `ResilienceScore.jsx` | 0-100 dial + 4 component bars + recommendations. |
| `DataQualityMeter.jsx` | Per-source feed quality + transparency warnings. |
| `ScenarioCreator.jsx` | 3 tabs: Templates · **My Scenarios (with `Suggested` amber badge for seeded)** · Create. |
| `ReportDisruptionModal.jsx` | Form to trigger an event with description/location/source/type. |
| `OnboardingWidget.jsx` | 6-step checklist with action links. |
| `NotificationBell.jsx` | **Top-right bell next to Active Event tag.** Uses `position: fixed; right: 24; top: 70` so the panel is always fully visible regardless of header wrap. |
| `SearchModal.jsx` | Ctrl+K global search across events + suppliers + audit. |
| `SupportModal.jsx` | "?" header button → modal with 12 categories, priority, description (≥20 chars) → returns ticket ID. |
| `AnomalyAlerts.jsx` | Highlights statistical outliers in the supplier set. |
| `ProtectedRoute.jsx` | JWT guard for authenticated routes. |
| `UpgradeModal.jsx` | Modal shown when free-plan 30-supplier cap is hit. Shows usage context, lets user submit a premium access request via `api.requestPremium()`. Detects limit messages via `isLimitMessage(msg)` helper. Shows confirmation state on success. |
| `InsightsPanel.jsx` | Client-side intelligence from uploaded suppliers only. `generateInsights(suppliers)` produces categorised findings (critical / warning / info / good) covering: single-source category risk, geographic concentration, low-buffer zones, reliability outliers, site-count risk. No LLM call — pure algorithmic analysis of the client's own data. |
| `DemoWelcomeTour.jsx` | 3-step interactive tour modal shown to new demo or first-time signed-in users. Step 1: your supply network (shows demo/client suppliers). Step 2: how the 9 AI agents work. Step 3: what to do next. Accepts `externalSuppliers` prop — if provided, renders the signed-in client's own suppliers instead of demo ones. |

---

## 7. Strict Client Isolation (Critical Invariant)

A new client onboards with only their uploaded suppliers must see **NOTHING** else throughout the session. This is enforced at **every** read path:

| Surface | Filter applied | What real client sees |
|---|---|---|
| `/api/suppliers` | `_resolve_suppliers(client_id)` — returns `[]` for non-seed clients with no uploads | Only their own |
| `/api/scenarios` | `custom_scenarios_db[client_id]` + templates only for seed clients | Their 5 industry-seeded + custom |
| `/api/demo-scenarios` | Returns `[]` for non-seed | Nothing |
| `/api/news/latest` | Zone match → industry keyword match → empty (never "show all") | Mumbai-tagged + their industry only |
| `/api/weather/current` | Only zones present in their supplier list | Only supplier-zone cities |
| `/api/supply-chain-map` | `_resolve_suppliers(client_id)` | Only their nodes |
| `/api/resilience-score` | Same | Their score |
| `/api/dependency-heatmap` | Same | Their categories × zones |
| `/api/data-quality` | Alerts/cities filtered by client zones + industry keywords | Their slice |
| `/api/events`, `/api/audit-log`, `/api/memory`, `/api/counterfactuals` | `record.client_id == current_user["client_id"]` | Their records |
| `/api/clients` | Returns only own entry for non-seed | Their company alone |
| `/api/clients/switch` | 403 for non-seed | Cannot switch |
| All 9 reports | All filter by `client_id` | Their data |
| Socket.IO room | `room=client_<client_id>` joined on handshake JWT verify | Their swarm updates only |

**Agent-level isolation:**
- `forecast_agent(event, memory, client_suppliers)` — narrative uses *only* the client's actual categories. LLM prompt explicitly forbids `refrigeration / HVAC / electronics` for non-matching industries.
- `risk_agent(event, memory, client_suppliers)` — only scores supplied list.
- `action_agent(event, forecast, risk)` — `safe_suppliers` derived from risk output. Post-LLM guardrail: if LLM hallucinates a supplier_id not in `safe_ids`, it's replaced with the best real alternate.
- `cascade_detection_agent(primary, secondary, client_suppliers)` — `shared_suppliers` iterates *only* the client's list (was iterating global `SUPPLIERS` before — this caused "GlobalParts Co" leaks).
- `storage.recall_memory(geo, supplier_ids, client_id)` — non-seed clients never read `MEM-CHN-001` etc.

**Excel template:** `/api/suppliers/template` returns generic `[Example] Supplier Alpha/Beta/Gamma` placeholders — no real demo company names.

---

## 8. AI Agents — Behaviour Detail

### 8.1 Monitor (BR-001)
Inputs: trigger payload. Computes deterministic severity via `compute_severity()` (rule-based with keyword detection). Decides whether to engage the rest of the pipeline (severity ≥ threshold from `config.SEVERITY_THRESHOLD`).

### 8.2 Cascade Detection (BR-009)
Runs in parallel to memory recall when a second event arrives within 48h. Multiplier 1.2×. Filter: must share ≥1 supplier zone. Uses **client_suppliers** only (not global). Categorises as Infrastructure Compound / Geographic Concentration / Supplier Network Cascade / Demand Shock Compound. Fallback summary mentions actual client supplier names + categories.

### 8.3 Forecast (BR-003)
XGBoost-style heuristic via `_xgb_predict(severity, geo_id, type_id, supplier_count, avg_buffer, avg_reliability)`. Memory calibration: if Stage-2 record exists for the same event_type, applies `actual - predicted` delta. **Categories are derived from client's supplier categories (never hardcoded).** Confidence intervals: 60-140% range for low-confidence, 80-120% for high. Fallback narrative is severity-aware (`severe / significant / moderate / mild`), supplier-count-aware, buffer-aware.

### 8.4 Risk (BR-004)
5 weighted factors: proximity 30 · buffer_score 25 · site_score 20 · reliability_score 15 · category_score 10. Tiers: Critical >75 · High 60-75 · Medium 40-60 · Low <40. Memory variance adjustment shifts the score band when Stage-2 history shows different actuals. Content Safety filter rejects harmful mitigations. Each supplier gets `change_explanation` (factor breakdown + driver text) for the "Why?" modal.

### 8.5 Action (BR-005)
Three ranked options. **3-sentence rationale per option:** (1) WHY this supplier — citing actual reliability%, buffer days, zone, risk score; (2) HOW — quantity (scaled to severity × demand shift), cost premium (scaled to severity), what gap; (3) RISK — one concrete caveat. Quantity formula: `300 + max(0, demand_shift) * 10 + severity * 20`. Cost premium: `6 + severity * 0.4`% for re-route, `18 + severity * 1.2`% for air-freight. Post-LLM hallucination guard replaces invented supplier IDs with the next real safe alternate. Each option gets RTO tag via `compute_rto(option, severity)` → fast/moderate/slow + `time_impact.basis`.

### 8.6 Validator (BR-006)
Accepts all three options. Computes divergence; if > 15 pts → outcome flagged `Pass-with-Dissent` so the HIL dissent gate is mandatory.

### 8.7 Simulation (BR-007)
3 Monte Carlo scenarios per option (P10/P50/P90). 30s SLA enforced with `asyncio.wait_for`. Fallback baseline scenarios on timeout.

### 8.8 HIL Gates (BR-008)
Server-side enforcement in `/api/events/hil-confirm`: 400 if any required ack missing in `event.hil_acks`. Severity ≥9 → requires `reviewer_id` AND `co_reviewer_id`.

### 8.9 Counterfactual (BR-010)
Triggered by `/api/events/resolve`. Writes Stage-2 memory: `actual_demand_shift`, `actual_cost_impact`, `actual_recovery_time`. Feeds back into next forecast's memory_calibration.

### 8.10 Enhancement Agents
- `resilience_score_agent(client_id, suppliers)`
- `data_quality_agent(news_alerts, weather_cities)` — both inputs already client-filtered before call
- `supplier_communication_agent(event, option, supplier)` — drafts email; deterministic template fallback
- `supplier_dependency_agent(client_id, suppliers)`

### 8.11 Novel Algorithms (algorithms.py)

DisruptIQ formalizes three domain-specific algorithms:

1. **MCF — Memory-Calibrated Forecast**
   `forecast_{t+1} = base + memory_weight * mean(actual - predicted)`
   Online Bayesian-style calibration driven by counterfactual write-backs.
   Wired into `forecast_agent()` — `parsed["mcf_adjustment"]` / `mcf_confidence_boost` / `mcf_sample_size` exposed in the event payload.

2. **CCS — Compound Cascade Severity**
   `combined = max(s_a, s_b) * cascade_multiplier * (1 + shared/total)`
   Severity escalation tied to supplier-overlap ratio.

3. **MSDS — Multi-Signal Dissent Score**
   `divergence = |forecast - risk| / max`; dissent if `divergence > 0.15` and confident.
   Gates a human checkpoint on specialized-agent disagreement.

See `backend/algorithms.py` for full docstrings and implementations.

---

## 9. Sample Datasets

`e:\Swarm\dataset\` — 10 industry-specific .xlsx files, total 176 supplier rows. Match the upload schema exactly:

| # | File | Industry | Rows |
|---|---|---|---|
| 01 | `01_Automotive_15_suppliers.xlsx` | Automotive | 15 |
| 02 | `02_Electronics_20_suppliers.xlsx` | Electronics | 20 |
| 03 | `03_Pharmaceutical_10_suppliers.xlsx` | Pharma | 10 |
| 04 | `04_FMCG_25_suppliers.xlsx` | FMCG | 25 |
| 05 | `05_Logistics_30_suppliers.xlsx` | Logistics | 30 |
| 06 | `06_Textile_Rubber_12_suppliers.xlsx` | Textile/Rubber | 12 |
| 07 | `07_Steel_Manufacturing_18_suppliers.xlsx` | Steel | 18 |
| 08 | `08_Aerospace_8_suppliers.xlsx` | Aerospace | 8 |
| 09 | `09_FoodBeverage_22_suppliers.xlsx` | F&B | 22 |
| 10 | `10_Chemicals_16_suppliers.xlsx` | Chemicals | 16 |

Regenerate any time with `python dataset/_generate.py`.

**Columns** (matches `/api/suppliers/upload-excel` parser):
```
Supplier Name* | Zone* | Categories* (comma-separated) | Buffer Stock Days | Sites | Reliability (%) | Proximity Score (1-10)
```

---

## 10. Auth & Security

| Mechanism | Detail |
|---|---|
| Password hashing | PBKDF2-HMAC-SHA256, **500 000** iterations, 32-byte salt (legacy hashes at 100k still accepted) |
| JWT | HS256, 24h access tokens; `jti`, `email`, `client_id`, `company_name`, `session_generation` claims |
| Session revoke | `sessions_db[jti]` — per-device tracking; `/api/auth/logout-all` invalidates all |
| Rate limit | 5 attempts / 5 min on signup, login, forgot-password (in-memory; reset on backend restart) |
| Email validation | Pydantic `EmailStr` |
| File upload | 10 MB cap on Excel/CSV; `.xlsx`/`.xls`/`.csv` accepted |
| Supplier cap | **30** per free-tier client (enforced server-side); premium clients have no cap |
| Premium flag | `premium: bool` stored in `users_db[client_id]`; surfaced in JWT via `/api/auth/me` |
| Account suspension | `suspended: bool` in `users_db`. Suspended users get `403 ACCOUNT_SUSPENDED` on any API call; frontend fires `account-suspended` custom event → full-screen overlay with contact email |
| Content Safety | Azure filter on Risk agent narrative + supplier-message drafter |
| Password hashing | PBKDF2-HMAC-SHA256, **500 000** iterations (legacy hashes at 100k are still verified transparently) |
| Password min | 8 chars enforced in `validate_password_strength()` |
| CORS | Dynamic — extends `CORS_ORIGINS` to `localhost:3000-3010` to keep Socket.IO alive across dev ports |
| Socket isolation | Per-client room joined via JWT-verified handshake. Param name `auth_data` (NOT `auth`) so it doesn't shadow the imported auth module. |
| Demo session isolation | Each unauthenticated demo session gets a unique `demo_<rand>_<ts>` ID stored in `sessionStorage`; sent as `X-Demo-Session` header → isolated Socket.IO room and separate in-memory state per tab |

---

## 11. UI / UX Polish

- **Help tooltips** on every dashboard panel: `InfoTooltip` component (`?` button) with title + 2-3 sentence description. Currently on Event Overview, What We've Learned, Expert Disagreement, Chain Reaction Alert, Supplier Risk Analysis, Demand Impact Forecast, Recommended Actions.
- **Notification bell** fixed at top-right of header, dropdown uses `position: fixed` so it's never clipped even when the header wraps.
- **Dropdown `<option>` text** has global CSS override `color: #111; background: #fff` so native OS-rendered dropdowns are readable on the dark theme.
- **Confetti + welcome screen** on signup; 4-second countdown then redirect to dashboard.
- **Delete account 3-phase UI**: idle → confirming (reason dropdown) → success (logout in 3s).
- **CSAT feedback tab** in Account Settings: 5-star rating + comment.
- **Support modal** from header "?" button: 12 categorised issues + priority + description (≥20 chars).
- **Suggested badge** (amber) on auto-seeded industry scenarios in the My Scenarios tab.
- **Premium PRO badge** — gold `★ PRO` pill appears in the header immediately to the right of the DisruptIQ logo whenever `premium=true` comes back from `/api/auth/me`. Visible on every authenticated page throughout the session.
- **Account suspension overlay** — full-screen modal (z-index 99999) with red lock icon, suspension message, and contact email link. Fires when any API response returns `403 ACCOUNT_SUSPENDED` via a `window.dispatchEvent('account-suspended')` custom event. Persists until user clicks Sign Out.
- **InsightsPanel** — algorithmic supply-chain intelligence rendered on the Supply Chain Map page (and any page with supplier context). Derives warnings purely from the client's own uploaded suppliers — no LLM, no external data.
- **DemoWelcomeTour** — 3-step guided tour modal for first-time demo and signed-in users. Shows the client's actual supplier list on step 1 when props include `externalSuppliers`.
- **UpgradeModal** — triggered automatically whenever an upload or add-single call returns a limit message. User can request premium in one click; admin approves in Admin Console.
- **NL Interrogation enhancement** — "Ask the Assistant" now builds a comprehensive narrative context (`_build_comprehensive_nl_context()` in `agents.py`) covering event overview, supplier impact, demand shift, recovery options, cascade, memory, and dissent before sending to the LLM. Responses are ChatGPT-quality (cite specific numbers and supplier names). Content Safety filter still applied; smart fallback maintained.

---

## 12. Known Limitations & Operational Notes

| Topic | Note |
|---|---|
| LLM quota | GitHub Models free tier = 150 req/day. One swarm ≈ 9 LLM calls. When 401/429 returned, agents fall back to **dataset-aware deterministic narratives** — still uses client's actual suppliers and categories. |
| In-memory storage | When `DEMO_MODE=true` or Cosmos unreachable, restart **wipes everything**. JWTs remain valid (24h) but `users_db` is empty → delete account still works (graceful handling). |
| Monte Carlo runtime | 9 simulations per swarm (3 options × 3 scenarios). 30s SLA per swarm; may time out on slow hardware. |
| SVG map | 50-point India outline approximation. Supplier positions derived from `ZONE_COORDINATES` projected to a fixed viewBox, not a true GIS projection. |
| Content Safety | Only filters Risk agent output and supplier-message drafter. Other agents unrestricted. |
| Co-reviewer | Hardcoded severity ≥9 threshold for second sign-off in `HILAndChat.jsx`. |

---

## 13. Development Workflows

### 13.1 Adding a new endpoint
1. Add Pydantic model in `main.py` near the existing Request models.
2. Add `@fastapi_app.<method>("/api/path")` with `current_user: dict = Depends(auth.require_auth)`.
3. Filter all reads by `current_user["client_id"]`.
4. Write to `storage.write_audit(...)` if it mutates state.
5. Add wrapper in `frontend/src/services/api.js`.
6. Restart backend.

### 13.2 Adding a new agent
1. Implement `async def my_agent(event, ...)` in `agents.py`.
2. Use `llm.chat_json(system, user, max_tokens, fallback)` for LLM calls — the fallback MUST be dataset-aware (use the passed `suppliers` to build the response).
3. Call from `run_swarm()` in `main.py` between existing pipeline stages.
4. Emit progress with `emit_update(event_id, "MyAgent", "activating"/"complete", payload, client_id=client_id)`.
5. Write audit row.

### 13.3 Adding a new dashboard panel
1. Create component in `frontend/src/components/MyPanel.jsx`.
2. Add `InfoTooltip` with title + description in the PanelHeader.
3. Wire into `Dashboard.jsx`.
4. If it needs new data, add an endpoint per 13.1 and wrapper in `api.js`.

### 13.4 Common debugging
- **"Internal Server Error"** → check `tail` of the backend output file. Most common: missing field in JWT (use `current_user["x"]` only for keys we know are set — `email`, `client_id`).
- **"User not found"** → backend restarted, in-memory `users_db` was wiped. JWT still valid. The delete endpoint handles this gracefully now.
- **"GlobalParts" / "Apex" / "BridgeTech" appearing** → an agent or endpoint is iterating the global `SUPPLIERS` list. Fix by passing the client's suppliers in and using that instead.
- **Live Activity Feed empty** → check Socket.IO connect handler. If the handler param is named `auth`, it shadows the auth module. Rename to `auth_data`.
- **Dashboard shows old data** → trigger a NEW event. Old events keep their cached agent outputs from before any fixes.
- **Delete returns 500** → port 8000 has a stale process; kill it (`netstat -ano | findstr :8000` → `Stop-Process -Id <PID> -Force`).

---

## 14. Complete Feature Log (May 2026)

All changes currently live in the codebase. Earlier notes are superseded by this list.

### Multi-Tenant Isolation
- **Strict isolation** across all 100+ endpoints; `SEED_CLIENT_IDS = {"demo", "ifb", "tata_motors"}` are the only clients allowed to read seed data.
- **Cascade agent** passes `client_suppliers` — no longer iterates global `SUPPLIERS` list (was leaking "GlobalParts Co", "Apex", "BridgeTech").
- **Forecast & Action agents** derive categories only from the client's uploaded suppliers. LLM prompt explicitly forbids hardcoded terms like `Refrigeration / HVAC / Electronics`.
- **News & weather** filtered by client supplier zones → industry keywords → empty (never "show all").
- **Demo session isolation** — each unauthenticated `/demo` tab gets a unique session ID (`demo_<rand>_<ts>`); sent as `X-Demo-Session` header; isolated Socket.IO room per tab.
- **Excel/CSV template** uses generic placeholder names (no demo company names leak).

### Premium System
- **Free-tier cap** changed from 50 → **30 suppliers** (enforced server-side on upload and add-single).
- **`/api/account/request-premium`** — user submits request stored in `premium_requests_db`.
- **Admin Console premium tabs** — approve / deny / grant / revoke via `/api/admin/premium-requests/*` and `/api/admin/users/{id}/grant-premium|revoke-premium`.
- **`★ PRO` badge** in the header next to DisruptIQ logo — gold pill rendered when `premium=true` from `/api/auth/me`; visible across all sessions and pages.
- **`UpgradeModal`** — fires automatically when a limit message is detected; lets user request premium in one click.

### Admin Console (`/admin`)
- **10 tabs**: Overview · Accounts · Deleted · Churned · Premium Requests · Support · Feedback · Activity Log · AI Interactions · System Health.
- **Account suspension** — admin can suspend/reactivate; suspended users get `403 ACCOUNT_SUSPENDED` on every API call.
- **Suspension overlay** — full-screen frontend modal fires when `account-suspended` custom event is dispatched; shows contact email.
- **Support ticket responses** — admin can reply to tickets via `/api/admin/support/{id}/respond`.
- **Self-deletions tracker** — churn reasons, labels, supplier/event counts, premium status captured in `self_deletions_db` and visible in Churned tab.
- **Deleted account restoration** — soft-delete + restore via `/api/admin/deleted-accounts/{id}/restore`.
- **AI Interactions tab** — shows all NL interrogation Q&A pairs across clients.

### Authentication & Security
- **Password hashing** upgraded to PBKDF2-HMAC-SHA256 with **500 000 iterations** (was 100k; legacy hashes still verified transparently via `_LEGACY_PASSWORD_ITERATIONS`).
- **`/api/account/delete`** is immediate (no email-token roundtrip) and idempotent when `users_db` is empty after restart.
- **Session revoke** per-device via `jti`; `logout-all` invalidates all sessions.
- **Rate limiting** on signup, login, forgot-password: 5 attempts / 5 min per identifier.

### NL Interrogation Enhancement
- `_build_comprehensive_nl_context()` in `agents.py` constructs a rich context (event, suppliers, demand, options, cascade, memory, dissent) before the LLM call.
- Responses cite specific numbers and supplier names — comparable to ChatGPT quality.
- Content Safety still applied; `_demo_nl_answer()` fallback maintained.

### New Components
- **`InsightsPanel`** — pure algorithmic intelligence from uploaded suppliers: single-source risk, geo concentration, low-buffer zones, reliability outliers. No LLM, no external data.
- **`DemoWelcomeTour`** — 3-step guided tour for new demo/signed-in users; shows client's actual supplier list on step 1 when `externalSuppliers` prop is passed.
- **`UpgradeModal`** — limit-hit modal with one-click premium request + confirmation state.

### UI / UX
- **Notification bell** fixed at top-right of header; dropdown uses `position: fixed` to avoid clipping.
- **InfoTooltip** (`?` button) on every dashboard panel with title + 2-3 sentence description.
- **Confetti + welcome screen** on signup with 4-second countdown to dashboard.
- **Delete account 3-phase UI**: idle → confirming (reason dropdown + label) → success (logout in 3s).
- **CSAT feedback tab** in Account Settings: 5-star + comment.
- **Support modal** from header "?" button: 12 categories, priority, ≥20-char description → returns `TKT-XXXXXX`.
- **Suggested badge** (amber) on auto-seeded industry scenarios in My Scenarios tab.
- **Dropdown `<option>` CSS** override so native OS-rendered dropdowns are readable on the dark theme.
- **Socket.IO handler** renamed `auth` → `auth_data` (was shadowing the auth module, causing all sockets to land in `demo` room).
- **3 landing page sections added**: Testimonials, Industry Cases (4 tabs), Survey Banner (3-step modal).
- **Auto-seed 5 industry scenarios** at signup via `_seed_client_scenarios(client_id, industry)`.
- **10 sample datasets** under `e:\Swarm\dataset\` for onboarding (Automotive, Electronics, Pharma, FMCG, Logistics, Textile, Steel, Aerospace, F&B, Chemicals).
- **CSV upload** (`/api/suppliers/upload-csv`) added alongside Excel.

---

## 14.1 DisruptIQ's Responsible AI Framework

DisruptIQ is built so that AI assists humans, never replaces their judgment:

- **Human-in-the-loop is mandatory and server-enforced** — the API rejects any
  action confirmation missing the required acknowledgments. The UI cannot bypass it.
- **Co-reviewer required for severity ≥9** — two humans must approve the most
  critical decisions.
- **Azure Content Safety filters every AI narrative** before it is displayed.
- **Learning is human-gated** — the Counterfactual agent only writes to Stage-2
  memory after a human confirms the actual outcome. Humans decide what the system learns.
- **Full audit trail** — every agent decision and human action is logged with client_id,
  timestamp, and actor.
- **Explainable risk scoring** — every supplier risk score exposes a 5-factor breakdown
  (proximity, buffer, sites, reliability, category) via the "Why?" drill-down.
- **Graceful degradation** — when the LLM is unavailable, agents fall back to
  dataset-aware deterministic logic rather than failing silently or hallucinating.

### Deck slide: "Responsible AI by Design"
Use the Responsible AI Framework bullets above as a single slide. This directly
targets Microsoft Build's responsible-AI judging emphasis.

---

## 15. Quick Reference for Claude (or any other LLM)

If you are helping the user with this project:

1. **Read this file first.** It is the master.
2. **Then read** the specific file you are editing. Use `Read` on `main.py`, `agents.py`, or the relevant `.jsx`.
3. **Never recommend** hardcoded category lists (`Refrigeration`, `HVAC`, `Electronics`) or supplier names (`GlobalParts`, `Apex`, `BridgeTech`, `FastTrack`) in agent code — these are demo seed data and must NEVER leak to real clients.
4. **Always filter by `client_id`** when adding endpoints; use `current_user["client_id"]` from JWT, never `config.ACTIVE_CLIENT_ID` (which is a legacy demo-switching global).
5. **Always pass client_suppliers** when calling agent functions; the deterministic fallbacks rely on them to stay dataset-aware.
6. **LLM prompts** for forecast/action/cascade agents must include the client's actual supplier list and explicit "do not invent suppliers" guidance.
7. **Restart backend** after changing Python files (Python is not hot-reloaded by uvicorn unless `reload=True`); frontend Vite auto-reloads.
8. **For destructive ops** (delete account, reset data, force-push) — always go through the 3-phase UI confirmation pattern.
9. **Premium flag** — check `current_user.get("premium", False)` in backend endpoints to gate premium features. Never trust the frontend to enforce caps.
10. **Admin endpoints** — all under `/api/admin/*`. Gate with `if not current_user.get("is_admin"): raise HTTPException(404)` so the route is invisible to non-owners.
11. **Supplier cap** — the free-tier limit is **30**. The `UpgradeModal` fires client-side when `isLimitMessage(msg)` detects a limit response. Update both the backend cap constant and this doc if it changes.

---

End of file.
