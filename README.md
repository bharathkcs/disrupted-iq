# DisruptIQ — AI-Powered Supply Chain Disruption Response

[![CI](https://github.com/bharathkcs/disrupted-iq/actions/workflows/ci.yml/badge.svg)](https://github.com/bharathkcs/disrupted-iq/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-171%20passing-brightgreen)](https://github.com/bharathkcs/disrupted-iq/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.12-blue)](https://www.python.org/)

> When a disruption hits — cyclone, port strike, supplier failure — DisruptIQ deploys nine coordinated AI agents, forecasts your exposure, and surfaces ranked recovery actions in **under 90 seconds**, with mandatory human approval before anything executes.

**Demo:** [Watch on YouTube](https://youtu.be/pOIz-eP0CGQ?si=0c_v2Vnh9BrSOZrb)

---

## What It Does

Nine specialist AI agents run in sequence the moment a disruption is triggered:

| # | Agent | What it does |
|---|---|---|
| 1 | **Monitor** | Scores severity; decides whether to engage the swarm |
| 2 | **Swarm Memory** | Recalls similar past incidents for calibration |
| 3 | **Cascade Detect** | Identifies compound events within 48 h |
| 4 | **Forecast** | Predicts demand impact, adjusted by memory |
| 5 | **Risk** | Scores every supplier on 5 weighted factors |
| 6 | **Action** | Proposes three ranked recovery options with RTO |
| 7 | **Validator** | Flags agent disagreement — triggers human checkpoint |
| 8 | **Simulation** | Monte Carlo scenarios (P10 / P50 / P90) |
| 9 | **Counterfactual** | Records actual outcome — feeds Stage-2 memory |

After each run the system is smarter — actual outcomes calibrate the next forecast. This is **MCAS (Memory-Calibrated Agent Swarm)**, the core architectural idea that separates DisruptIQ from stateless swarm frameworks like LangGraph or CrewAI.

---

## Run It Locally — 3 Steps

**Prerequisites:** Python 3.12+ and Node.js 18+. No cloud accounts needed — everything runs in-memory by default.

### 1. Clone

```bash
git clone https://github.com/bharathkcs/disrupted-iq.git
cd disrupted-iq
```

### 2. Start the backend

```bash
cd "Swarm Agent/backend"
pip install -r requirements.txt
python main.py
# Running at http://localhost:8000
```

### 3. Start the frontend (new terminal)

```bash
cd "Swarm Agent/frontend"
npm install
npm run dev
# Open http://localhost:3000
```

Open the browser, click **Try Demo** — no sign-up needed. The app runs fully offline in demo mode; all AI responses use deterministic fallbacks so you never need API keys to explore the platform.

---

## Enable Live AI (Optional)

Create `Swarm Agent/backend/.env`:

```env
DEMO_MODE=false
GITHUB_TOKEN=ghp_...            # LLM via GitHub Models (free, 150 req/day)
JWT_SECRET=<32-char-random>     # Required for auth in live mode
AZURE_COSMOS_ENDPOINT=https://... # Persistent storage (optional)
AZURE_COSMOS_KEY=...
SENDGRID_API_KEY=SG....         # Email (optional)
NEWSAPI_KEY=...                 # Live news alerts (optional)
```

Full option reference: [CONFIGURATION.md](CONFIGURATION.md)

---

## Upload Your Own Suppliers

10 sample datasets ship with the repo (`dataset/` folder) covering Automotive, Electronics, Pharma, FMCG, Logistics, and more — 176 supplier rows total. After signing up, upload any of them to see the full platform with real data.

**Upload format** (Excel or CSV — download the blank template from inside the app):

| Supplier Name | Zone | Categories | Buffer Stock Days | Sites | Reliability % | Proximity (1–10) |
|---|---|---|---|---|---|---|
| Your Supplier | Mumbai | Automotive | 14 | 3 | 91 | 7 |

---

## Project Layout

```
disrupted-iq/
├── Swarm Agent/
│   ├── backend/
│   │   ├── main.py          # FastAPI app + Socket.IO + swarm orchestrator
│   │   ├── agents.py        # All 9 pipeline agents + 4 enhancement agents
│   │   ├── storage.py       # Cosmos DB / in-memory abstraction
│   │   ├── auth.py          # JWT, PBKDF2 hashing, rate-limiting
│   │   ├── llm.py           # LLM client + deterministic fallbacks
│   │   ├── algorithms.py    # MCF, CCS, MSDS algorithm implementations
│   │   └── requirements.txt
│   └── frontend/
│       └── src/
│           ├── pages/       # 17 pages (Dashboard, Admin, Reports, Map ...)
│           └── components/  # 19 components (SwarmFeed, RiskTable, HIL ...)
├── dataset/                 # 10 industry-specific sample supplier files
└── docs/
    ├── ARCHITECTURE.md      # System design and MCAS deep-dive
    ├── DATABASE_SCHEMA.md   # Data model and Cosmos schema
    ├── DEPLOYMENT.md        # Azure production deploy guide
    ├── CONFIGURATION.md     # All env vars, thresholds, feature flags
    ├── WEBSOCKET_EVENTS.md  # Socket.IO event reference
    └── CLAUDE.md            # Complete API reference (86 endpoints)
```

---

## Deeper Reading

| Document | What's inside |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Multi-tenant design, MCAS architecture, full agent pipeline, scalability |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Every data collection, field reference, Cosmos container schema |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Step-by-step Azure Container Apps production deploy |
| [CONFIGURATION.md](CONFIGURATION.md) | Every env var, threshold, and feature flag with defaults |
| [CLAUDE.md](CLAUDE.md) | Complete API spec — all 86 endpoints with request/response detail |

---

## AI Tools & Research Disclosure

DisruptIQ was built with the help of multiple AI tools across research, design, and development:

- **Claude (Anthropic)** — primary coding assistant; used for implementation, refactoring, code review, and documentation
- **ChatGPT (OpenAI)** — architecture brainstorming, BRD drafting, and agent prompt design
- **Gemini (Google)** — research and cross-checking technical decisions
- **Perplexity** — literature search and competitive landscape research

All architecture decisions, agent design, and product direction were human-directed and human-reviewed. AI tools accelerated implementation — they did not replace judgment.

**Runtime AI (inside the product itself):** GitHub Models API (GPT-4o class) handles ~9 LLM calls per swarm run. When quota is exhausted the platform degrades to dataset-aware deterministic fallbacks — it never crashes or invents supplier data.

---

## Team

**Bharath Kumar KCS** — Solo build. Full-stack development, agent architecture, backend API, Azure deployment, product design, frontend, UI/UX, demo, and documentation.

---

## License

[MIT](LICENSE)
