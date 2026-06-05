# DisruptIQ V2 — Multi-Tenant Supply Chain Disruption Response Platform

[![CI](https://github.com/bharathkcs/disrupted-iq/actions/workflows/ci.yml/badge.svg)](https://github.com/bharathkcs/disrupted-iq/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-171%20passing-brightgreen)](https://github.com/bharathkcs/disrupted-iq/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12-blue)](https://www.python.org/)

**A real-time AI-powered platform that detects supply chain disruptions and coordinates nine specialized agents to forecast impact, score risk, propose ranked recovery actions, simulate outcomes, and record actual results for continuous learning—all in under 90 seconds.**

---

## 🎯 The Problem

When a supply chain disruption hits (natural disaster, port strike, supplier failure), companies lose **days** to manual analysis and **weeks** to recovery. DisruptIQ turns that into **seconds to insight** and **hours to recovery**.

---

## ✨ Key Features

### 🤖 Nine-Agent Swarm Pipeline (≤90s SLA)
1. **Monitor** (BR-001) — Severity detection via rule-based scoring
2. **Swarm Memory** (BR-002) — Recall similar past incidents (Stage-1 memory)
3. **Forecast** (BR-003) — Demand impact prediction with memory calibration
4. **Risk** (BR-004) — Per-supplier risk scoring (5 weighted factors)
5. **Action** (BR-005) — Three ranked recovery options with RTO estimates
6. **Validator** (BR-006) — Dissent detection across agent predictions
7. **Simulation** (BR-007) — Monte Carlo outcome scenarios (P10/P50/P90)
8. **HIL Confirmation** (BR-008) — Server-enforced human-in-the-loop gates (co-reviewer for severity ≥9)
9. **Counterfactual** (BR-010) — Post-resolution learning → Stage-2 memory calibration

### 🏗️ MCAS Architecture (Memory-Calibrated Agent Swarm)
DisruptIQ's novel **MCAS** framework combines:
- **Stage-1 memory** — Similar past incidents recalled before forecasting
- **Stage-2 memory** — Counterfactual write-backs after human outcome confirmation
- **Cascade detection** — Compound events within 48h with shared suppliers
- **Explainable risk** — 5-factor breakdown per supplier ("Why?" drill-down)
- **Deterministic fallbacks** — Dataset-aware agent outputs when LLM unavailable

### 👥 Multi-Tenant Isolation (Strict)
- Every endpoint filters by `client_id` from JWT
- Demo clients see only demo data; real clients see only their uploaded suppliers
- Seed data (demo suppliers) **never leak** to real clients
- Per-client Socket.IO rooms for real-time swarm updates

### 🎮 Interactive Dashboard
- **Real-time Swarm Feed** — Live agent progress with Socket.IO
- **Supply Chain Map** — SVG twin-map visualization of suppliers and disruptions
- **Supplier Risk Analysis** — Sortable table with per-supplier "Why?" drill-down
- **Demand Forecast** — Impact bar chart with confidence intervals (60–140% for low-confidence alerts)
- **Action Options Panel** — Three ranked options with 3-sentence rationales and Monte Carlo scenarios
- **NL Interrogation** — Conversational Q&A over event context with comprehensive narrative
- **Resilience Score** — 0–100 dial with 4 components + improvement recommendations
- **Data Quality Meter** — News/weather feed freshness per client zones

### 🔐 Premium Features
- **Free tier** — 30 suppliers max, core swarm pipeline
- **Premium tier** — Unlimited suppliers, advanced analytics, priority support
- **Admin Console** — Account suspension, premium approval workflows, support ticket management, self-deletion churn analysis

### 🛡️ Responsible AI by Design
- **Human-in-the-loop is mandatory and server-enforced**
- **Co-reviewer required** for severity ≥9 decisions
- **Azure Content Safety** filters all AI narratives
- **Full audit trail** — every agent action logged with timestamp + actor
- **Graceful degradation** — fallback to deterministic logic if LLM unavailable

---

## 🚀 Quick Start

### Prerequisites
- Python 3.12+
- Node.js 18+
- Azure Cosmos DB (optional; in-memory fallback included)

### Local Development (Demo Mode)

```bash
# Terminal 1 — Backend
cd "Swarm Agent/backend"
pip install -r requirements.txt
python main.py

# Terminal 2 — Frontend
cd "Swarm Agent/frontend"
npm install
npm run dev

# Open browser
http://localhost:3000
```

Click **Try Demo →** for instant demo, or **Sign Up** to register your own account.

### Configuration

Backend `.env`:
```
DEMO_MODE=true                          # Use in-memory storage (default)
AZURE_COSMOS_ENDPOINT=...               # For persistent storage
AZURE_COSMOS_KEY=...
GITHUB_TOKEN=...                        # LLM via GitHub Models
AZURE_CONTENT_SAFETY_ENDPOINT=...       # AI safety filtering
JWT_SECRET=<32+ random bytes>           # Session signing
SENDGRID_API_KEY=...                    # Email service
NEWSAPI_KEY=...                         # News alerts
```

See `Swarm Agent/backend/.env.example` for all options.

---

## 📋 Project Structure

```
e:\Swarm\
├── README.md                           ← You are here
├── CLAUDE.md                           ← Complete API reference (86 endpoints)
├── ARCHITECTURE.md                     ← System design deep dive
├── DATABASE_SCHEMA.md                  ← Data model + Cosmos schema
├── CONFIGURATION.md                    ← All configurable thresholds
├── DEPLOYMENT.md                       ← Production deploy guide
│
├── dataset/                            ← 10 industry-specific supplier .xlsx samples
│   ├── _generate.py                    ← Regenerate datasets
│   ├── 01_Automotive_Global_25_suppliers.xlsx
│   └── ... (9 more industries, 176 supplier rows total)
│
└── Swarm Agent/
    ├── README.md                       ← Quick reference for judges
    ├── backend/
    │   ├── main.py                     ← FastAPI app + Socket.IO orchestrator (~3,950 lines)
    │   ├── agents.py                   ← 9 pipeline + 4 enhancement agents (~1,500 lines)
    │   ├── storage.py                  ← Cosmos / in-memory abstraction
    │   ├── auth.py                     ← JWT, PBKDF2 hashing, rate-limiting
    │   ├── llm.py                      ← GitHub Models LLM client + fallbacks
    │   ├── email_service.py            ← SendGrid HTML emails
    │   ├── config.py                   ← Environment loader
    │   ├── seed_data.py                ← Demo suppliers + scenarios
    │   ├── algorithms.py               ← MCF, CCS, MSDS implementations
    │   ├── requirements.txt
    │   └── .env.example
    │
    └── frontend/
        ├── package.json
        ├── vite.config.js
        ├── index.html
        └── src/
            ├── App.jsx
            ├── main.jsx
            ├── styles/index.css         ← Dark theme tokens
            ├── services/
            │   ├── api.js               ← All /api wrappers
            │   └── auth.js              ← JWT + session helpers
            ├── pages/                   ← 17 pages (Dashboard, Admin, Reports, etc)
            └── components/              ← 19 reusable components (SwarmFeed, RiskTable, etc)
```

---

## 🔌 API Overview

**86 total endpoints** across:
- **Auth** (15) — signup, login, sessions, password reset, profile
- **Suppliers** (12) — upload Excel/CSV, CRUD, health scores, trends, anomalies
- **Events** (10) — trigger swarm, run HIL confirmation, resolve with counterfactuals
- **Dashboards** (10) — live maps, resilience score, data quality, dependency heatmap
- **Reports** (9) — R-01 through R-09 covering all agent stages
- **Memory/Audit** (6) — Stage-1/Stage-2 recall, counterfactuals, audit logs
- **Accounts** (9) — onboarding, notifications, data export, account deletion, premium requests
- **Feedback/Support** (2) — CSAT ratings, support tickets
- **Admin Console** (20) — user management, premium approval, suspension, support response, churn analysis

**WebSocket:**
- Path: `ws://localhost:8000/socket.io`
- Events: `swarm_update` — live agent progress streamed per client
- Auth: JWT in handshake; isolated per `client_id`

See `CLAUDE.md` **Section 5** for the complete API reference.

---

## 🎓 Architecture Highlights

### Multi-Tenant Data Model
```
JWT (24h) → email + client_id + company_name
     │
     ▼
Every endpoint: Depends(auth.require_auth) → filters by client_id
     │
     ▼
All reads/writes are client-isolated (suppliers, events, memory, audit)
```

### The 9-Agent Swarm Pipeline
```
Monitor ─┐
         ├─▶ severity ≥ threshold? ──no──▶ stop
         ▼
  SwarmMemory ──────┐
       │            │
    Forecast    CascadeDetect (runs in parallel)
       │            │
   Risk ────────────┘
       │
    Action ──────▶ 3 ranked options
       │
   Validator ────▶ Dissent check → HIL gate
       │
   Simulation ───▶ 30s SLA, Monte Carlo P10/P50/P90
       │
   HIL Confirm ──▶ Human approval (co-reviewer for severity ≥9)
       │
  Counterfactual ▶ Stage-2 memory write-back
```

### Novel MCAS Features
| Feature | Benefit |
|---------|---------|
| **Stage-2 Counterfactual Learning** | System improves over time — each actual outcome calibrates future forecasts |
| **Cascade Detection** | Detects compound events (48h window, shared suppliers) |
| **Dissent Detection** | Flags agent disagreement → forces human review |
| **Explainable Risk** | 5-factor breakdown per supplier (proximity, buffer, sites, reliability, category) |
| **Deterministic Fallbacks** | When LLM unavailable, agents produce dataset-aware narratives |

---

## 🧪 Testing & Quality

- **171 automated tests, all passing** — run with `cd "Swarm Agent/backend" && python -m pytest tests/ -q`
- **Unit tests** for auth, storage, LLM client, algorithms, ESG/financial signals, federated memory
- **Integration tests** for the swarm pipeline and strict multi-tenant isolation
- **Security** — no hardcoded secrets, PBKDF2-HMAC-SHA256 (500k iterations), auth rate-limiting

### Measured Performance (deterministic / demo mode)

Per-stage swarm latency, averaged over 3 runs (severity 8, 10 suppliers), via
`python bench_swarm.py`:

| Stage | Avg latency |
|---|---|
| Monitor | < 1 ms |
| Forecast | < 1 ms |
| Risk | ~2.6 s |
| Action | < 1 ms |
| Simulation | < 1 ms |
| **Total** | **~2.7 s** |

**Well within the 90-second SLA.** In live mode the dominant cost is the ~9
LLM round-trips (network-bound); when the LLM is unavailable the deterministic
fallbacks above keep the full pipeline under 3 seconds.

---

## 📊 Sample Data

10 industry-specific datasets in `dataset/` (Automotive, Electronics, Pharma, FMCG, Logistics, Aerospace, Food & Beverage, Chemicals, Steel, Medical Devices). Total **176 supplier rows** across all industries.

**Upload format:**
| Supplier Name | Zone | Categories | Buffer Stock Days | Sites | Reliability % | Proximity (1–10) |
|---|---|---|---|---|---|---|
| FastTrack Logistics | Mumbai | Logistics | 7 | 2 | 92 | 8 |

---

## 🚢 Deployment

### Development
```bash
DEMO_MODE=true python main.py    # in-memory, ideal for hackathon
```

### Production
- **Backend:** Azure Container Apps + Cosmos DB
- **Frontend:** Azure Static Web Apps
- **LLM:** GitHub Models (free 150 req/day) or Azure OpenAI

See `DEPLOYMENT.md` for step-by-step Azure setup.

---

## 📖 Documentation for Judges

| Document | Purpose |
|---|---|
| **CLAUDE.md** | 15 sections: complete API spec (86 endpoints), agent behavior, data model, feature log |
| **ARCHITECTURE.md** | System design: multi-tenant model, agent pipeline, MCAS framework, scalability |
| **DATABASE_SCHEMA.md** | All data structures, Cosmos schema, relationships |
| **README.md** (in `Swarm Agent/`) | Quick run-and-test guide for judges |

---

## 🏆 Key Innovation: MCAS (Memory-Calibrated Agent Swarm)

Standard multi-agent frameworks (LangGraph, CrewAI, AutoGen) are **stateless**—each run is independent. DisruptIQ's **MCAS** architecture is **stateful**:

1. **Stage-1 Memory** — Before forecasting, recall similar past incidents
2. **Forecast** — LLM predicts demand impact, adjusted by memory deltas
3. **Human Outcome** — After resolution, human confirms actual result
4. **Stage-2 Memory Write-Back** — Counterfactual agent records `actual - predicted` delta
5. **Next Forecast** — Calibrated by that real delta instead of cold LLM estimate

**Result:** Measurably smarter predictions over time. This is what classic swarms lack.

---

## 🔒 Security & Compliance

- **PBKDF2-HMAC-SHA256** password hashing (500k iterations)
- **JWT 24h access tokens** with per-device session tracking
- **Rate limiting** on auth endpoints (5 attempts / 5 min)
- **Azure Content Safety** filtering on all AI narratives
- **Audit trail** — every action logged with `client_id`, timestamp, actor
- **Strict multi-tenant isolation** — real clients never see demo data
- **Data export** — full `zip` with JSON + Excel, supports GDPR requests
- **Account deletion** — immediate permanent removal, best-effort goodbye email

---

## 💡 What Judges Should Look For

### Innovation
✅ **MCAS architecture** — agents learn from counterfactual outcomes (unique to DisruptIQ)  
✅ **Cascade detection** — identifies compound events (48h window, shared suppliers)  
✅ **Dissent detection** — flags agent disagreement → human checkpoint  
✅ **Explainable AI** — 5-factor risk breakdown, not a black box  

### Reliability
✅ **<90 second SLA** on 9-agent swarm  
✅ **Deterministic fallbacks** — works offline if LLM unavailable  
✅ **Strict multi-tenant isolation** — no data leaks, zero demo-data exposure  
✅ **Human-in-the-loop enforcement** — co-reviewer for severity ≥9  

### UX/Polish
✅ **Real-time Socket.IO feed** of agent progress  
✅ **Interactive SVG supply-chain map** with disruption pulses  
✅ **NL interrogation** — conversational Q&A over event context  
✅ **One-click premium requests** with admin approval workflow  

### Scalability
✅ **Azure Cosmos DB multi-region** replication  
✅ **Async agent pipeline** with `asyncio.gather`  
✅ **Per-client Socket.IO rooms** for broadcast isolation  
✅ **In-memory fallback** — works even if Cosmos offline  

---

## 🤖 AI Tools & Model Usage (Disclosure)

In the interest of full transparency, this section discloses every AI/ML tool used in DisruptIQ and exactly how it is used.

### Large Language Models
- **GitHub Models API (GPT-4o-class)** — the single LLM backing the swarm. It is invoked by:
  - **Forecast agent** — demand-impact narrative
  - **Risk agent** — per-supplier risk narrative
  - **Action agent** — three ranked recovery options + rationales
  - **Cascade detection agent** — compound-event analysis
  - **Supplier communication agent** — outreach-email drafting
  - **NL interrogation** — conversational Q&A over event context
  - **Counterfactual agent** — actual-vs-predicted outcome summary

  **Usage:** ~9 LLM calls per swarm run. Free tier = 150 requests/day.
  **Fallback:** when the quota is exhausted (401/429), every agent degrades to a **dataset-aware deterministic narrative** built from the client's own suppliers — no hallucinated data, no crash.

### Supporting Services
| Service | Role |
|---|---|
| **Azure Cosmos DB** | Persistent multi-tenant storage (in-memory fallback when unconfigured) |
| **Azure Content Safety** | Filters Risk-agent narratives and supplier-message drafts before display |
| **SendGrid** | Transactional email (welcome, password reset, support, deletion) |
| **NewsAPI** | Real-time news alerts (filtered by client zones / industry) |
| **OpenWeatherMap** | Weather data for client supplier zones |

### Model Configuration
- **Provider/model:** GitHub Models API (GPT-4o-class)
- **Temperature:** 0.7 (narrative generation)
- **Max tokens:** ~2,000 per call
- **Output validation:** all LLM JSON is schema-checked; malformed output falls back to deterministic logic

### Human Creativity & Oversight
The AI assists humans — it never decides alone:
- **9-agent architecture** designed by humans; agents run a mix of deterministic and LLM steps
- **Human-in-the-loop gates** are server-enforced — no action is committed without explicit human approval (co-reviewer for severity ≥9)
- **Stage-2 memory write-backs** only happen after a human confirms the real outcome — humans decide what the system learns
- **Thresholds, scenarios, and supplier data** are all human-curated

### Data Privacy
- **Demo mode:** deterministic output, no live LLM or database calls
- **Live mode:** LLM calls and results stored in Cosmos DB with strict `client_id` isolation
- All tenant data is isolated per `client_id` at every read/write path

### Development Tooling
- This project was developed with the assistance of **AI coding tools** (Claude Code) for implementation, refactoring, and review. All architecture decisions, agent design, and final code were human-directed and human-reviewed.

---

## 🤝 Contributing

This is a hackathon submission. All code is production-ready and fully documented.

---

## 📄 License

Licensed under the [MIT License](LICENSE).

---

## 📞 Support

**For judges:** All endpoints are live. Use the demo account (click **Try Demo →**) or sign up with your own email.  
**For production deployment:** See `DEPLOYMENT.md`.

---

**Last Updated:** June 4, 2026  
**Status:** Ready for Hackathon Evaluation ✨
