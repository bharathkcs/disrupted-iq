# DisruptIQ

## Project Title

DisruptIQ: Real Time Supply Chain Disruption Response Platform Powered by AI Agent Swarms

---

## Project Description

DisruptIQ is a multi tenant cloud based platform that helps organizations respond to supply chain disruptions in real time. When a disruption occurs like a cyclone, port strike, or supplier failure, the platform automatically detects the event, analyzes its impact on your specific suppliers, forecasts demand consequences, recommends ranked recovery actions, and requires human approval before any decision is executed.

The platform uses a coordinated team of nine specialized AI agents that work together to deliver complete analysis and recommendations in under 90 seconds. After the disruption is resolved, the platform records what actually happened so it gets smarter and more accurate with every event.

The platform continuously monitors global news feeds and weather data against your supplier network. When relevant disruptions are detected, they are automatically analyzed. News monitoring is fully automatic. The platform watches news for disruptions matching your supplier zones and industry and automatically suggests them as potential scenarios to analyze. You can run these scenarios with one click or create custom disruption scenarios manually.

Human decision making is mandatory at every critical step. All recovery options require explicit human confirmation, and the most severe disruptions require a second approver.

After each disruption is resolved, the actual outcome is recorded and fed back into system memory. This means each subsequent forecast becomes more accurate because it is calibrated by what actually happened in similar past events.

The platform also includes supplier intelligence features like financial health scoring, ESG and compliance risk assessment, Tier 2 supplier visibility with single point of failure detection, and dependency concentration heatmaps.

---

## Instructions

1. Local Development: Run the backend on port 8000 and frontend on port 3000. Click Try Demo to explore the full platform with sample suppliers and scenarios without registering.

2. Create Account: Sign up with your email and industry to create a new account.

3. Upload Suppliers: Upload your supplier list as Excel or CSV file. The platform supports 30 suppliers on the free plan and unlimited on premium.

4. Report Disruption: When a disruption occurs, click Report Disruption, describe the event, and the nine agents activate automatically.

5. Review Analysis: The dashboard shows real time agent progress, supplier risk breakdown, demand forecast, and three ranked recovery options with Monte Carlo simulations.

6. Approve Action: Click the action option you want to execute. Events with high severity require a second approver to confirm.

7. Record Outcome: After the disruption is resolved, confirm the actual outcome. The platform records this and uses it to improve future forecasts.

8. Create Custom Scenarios: You can create custom disruption scenarios specific to your industry or let the platform suggest scenarios based on detected news.

9. Request Premium: Free tier has 30 supplier limit. Request premium access for unlimited suppliers and advanced analytics including financial health, ESG analysis, and Tier 2 visibility.

10. Admin Console: The platform owner can manage accounts, approve premium requests, suspend accounts, respond to support tickets, and monitor system health.

---

## Built With

Backend: Python 3.12, FastAPI, Socket.IO, Azure Cosmos DB, GitHub Models API, Azure Content Safety, Gmail SMTP

Frontend: React 18, Vite, Recharts, Socket.IO Client, CSS with dark theme

Infrastructure: Azure Container Apps, Azure Static Web Apps, Azure Front Door, Azure Cosmos DB

Development: Git, GitHub Actions for CI CD, pytest for testing, Playwright for E2E tests

AI: GitHub Models API providing GPT 4o class models

Security: PBKDF2 HMAC SHA256 password hashing, JWT authentication, parameterized SQL queries, audit logging, multi tenant data isolation
