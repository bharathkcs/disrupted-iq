# DisruptIQ — Deployment & Setup Guide

## Local Development Setup

### Prerequisites

- Python 3.12 (python.org)
- Node.js 18+ (nodejs.org)
- Git
- Azure account (for Cosmos DB credentials)
- GitHub account (for Models API token)

### Step 1: Clone and Install Backend

```powershell
cd "e:\Swarm\Swarm Agent\backend"
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Step 2: Configure Backend Environment

Create `.env` file in `backend/`:

```env
# Mode
DEMO_MODE=true

# Database (Cosmos DB) - required if DEMO_MODE=false
AZURE_COSMOS_ENDPOINT=https://your-cosmos.documents.azure.com:443/
AZURE_COSMOS_KEY=your_key_here
AZURE_COSMOS_DATABASE=disruptiq

# LLM (GitHub Models) - required for real LLM calls
GITHUB_TOKEN=ghp_your_token

# Email (SendGrid) - required for sending emails
SENDGRID_API_KEY=your_sendgrid_key
SENDGRID_FROM_EMAIL=noreply@disruptiq.app

# Auth
JWT_SECRET=your_secure_secret_at_least_32_bytes_1234567890ab

# Server
HOST=127.0.0.1
PORT=8000
DEBUG=true
```

### Step 3: Start Backend

```powershell
cd "e:\Swarm\Swarm Agent\backend"
.\venv\Scripts\Activate.ps1
python main.py
```

### Step 4: Install and Start Frontend

```powershell
# New terminal
cd "e:\Swarm\Swarm Agent\frontend"
npm install
npm run dev
```

### Step 5: Verify

1. Open `http://localhost:5173`
2. Click "Try Demo →" or sign up
3. Trigger a test event

---

## Configuration Modes

### Demo Mode (`DEMO_MODE=true`)

- In-memory storage (no Cosmos needed)
- Deterministic LLM fallback (no GitHub token needed)
- 3 demo clients: `demo`, `ifb`, `tata_motors`
- Resets on server restart

**Use:** Development, demos without credentials

### Live Mode (`DEMO_MODE=false`)

- Cosmos DB persistence
- Real GitHub Models API
- Real SendGrid emails
- Multiple real clients
- Persists across restarts

**Use:** Production, staging, UAT

---

## Environment Variables Reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `DEMO_MODE` | Yes | Use in-memory (true) vs. Cosmos DB (false) |
| `AZURE_COSMOS_ENDPOINT` | If DEMO=false | Cosmos DB endpoint |
| `AZURE_COSMOS_KEY` | If DEMO=false | Cosmos DB key |
| `GITHUB_TOKEN` | For real LLM | GitHub Models API token |
| `SENDGRID_API_KEY` | For emails | SendGrid API key |
| `JWT_SECRET` | Yes | JWT signing secret (≥32 bytes) |
| `HOST` | No | Server host (default: 127.0.0.1) |
| `PORT` | No | Server port (default: 8000) |
| `DEBUG` | No | Debug mode (default: false) |

---

## Azure Production Deployment

### Step 1: Create Azure Resources

```powershell
# Resource group
az group create --name disruptiq-rg --location eastus

# Cosmos DB
az cosmosdb create \
  --name disruptiq-cosmos \
  --resource-group disruptiq-rg \
  --kind GlobalDocumentDB \
  --default-consistency-level Strong

# App Service Plan
az appservice plan create \
  --name disruptiq-plan \
  --resource-group disruptiq-rg \
  --sku B2

# Web App
az webapp create \
  --resource-group disruptiq-rg \
  --plan disruptiq-plan \
  --name disruptiq-app \
  --runtime "PYTHON:3.12"
```

### Step 2: Set Environment Variables

```powershell
az webapp config appsettings set \
  --resource-group disruptiq-rg \
  --name disruptiq-app \
  --settings \
    DEMO_MODE=false \
    AZURE_COSMOS_ENDPOINT=$ENDPOINT \
    AZURE_COSMOS_KEY=$KEY \
    GITHUB_TOKEN=$TOKEN \
    SENDGRID_API_KEY=$SENDGRID \
    JWT_SECRET=$SECRET \
    WEBSITES_PORT=8000
```

### Step 3: Deploy Backend

```powershell
cd "e:\Swarm\Swarm Agent\backend"
git init
git add .
git commit -m "Initial deploy"
git remote add azure <app service git url>
git push azure master
```

### Step 4: Deploy Frontend

```powershell
cd "e:\Swarm\Swarm Agent\frontend"
npm run build

# Deploy to Azure Static Web Apps or CDN
az staticwebapp create \
  --name disruptiq-frontend \
  --resource-group disruptiq-rg
```

### Step 5: Verify Deployment

1. Open `https://disruptiq-app.azurewebsites.net`
2. Test signup and login
3. Trigger test event
4. Verify WebSocket in browser console

---

## Scaling Strategy

### Single Instance (Current)

- Max ~100-500 concurrent WebSocket connections
- Suitable for <50 active clients

### Multi-Instance

```
Load Balancer (sticky sessions for WebSocket)
    ↓
  ┌─────────────┬─────────────┐
  ↓             ↓
Backend-1    Backend-2  (port 8000 on both)
  └─────────────┬─────────────┘
        ↓
   Shared Cosmos DB
```

**Enable sticky sessions:**
```powershell
az webapp config set \
  --resource-group disruptiq-rg \
  --name disruptiq-app \
  --generic-configurations '{"sessionAffinity":"ARRAffinity"}'
```

---

## Monitoring

### Enable Application Insights

```powershell
az webapp config appsettings set \
  --name disruptiq-app \
  --resource-group disruptiq-rg \
  --settings APPINSIGHTS_INSTRUMENTATIONKEY=$KEY
```

### Key Metrics

- Event latency (end-to-end)
- Agent execution time
- LLM API response times
- WebSocket connections
- Error rates

---

## Backup & Recovery

### Enable Cosmos DB Backup

```powershell
az cosmosdb backup policy update \
  --resource-group disruptiq-rg \
  --name disruptiq-cosmos \
  --type Continuous \
  --tier Continuous30Days
```

### Rollback Procedure

```powershell
# View deployment history
az webapp deployment list \
  --resource-group disruptiq-rg \
  --name disruptiq-app

# Rollback to previous
az webapp deployment slot swap \
  --resource-group disruptiq-rg \
  --name disruptiq-app \
  --slot staging
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "502 Bad Gateway" | Check logs: `az webapp log tail...` |
| Connection refused | Ensure backend running on port 8000 |
| Cosmos error | Verify `AZURE_COSMOS_ENDPOINT` + `KEY` |
| WebSocket fails | Check CORS origins; verify socket.io working |
| LLM timeout | Check `GITHUB_TOKEN` quota; fall back to deterministic |

---

## Summary Checklist

- [ ] Install Python 3.12 + Node.js
- [ ] Create `.env` with credentials
- [ ] Install dependencies
- [ ] Start backend + frontend
- [ ] Verify at http://localhost:5173
- [ ] (Production) Create Azure resources
- [ ] (Production) Deploy to App Service
- [ ] (Production) Test signup/login/event
- [ ] (Production) Enable monitoring
- [ ] (Production) Configure backup

---

*End of DEPLOYMENT.md*
