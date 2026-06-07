# DisruptIQ — Platform Documentation

DisruptIQ is a multi-tenant supply chain disruption-response platform. When a real-world disruption occurs — a port strike, a cyclone, a supplier insolvency — a coordinated set of specialised AI agents detects the event, assesses its impact on the organisation's specific suppliers, forecasts demand consequences, proposes ranked recovery actions, simulates outcomes, and requires human approval before any decision is recorded. Every recovery is completed within a 90-second service window. After resolution, the platform records what actually happened and uses that outcome to calibrate future responses.

This document describes the complete platform: its architecture, every functional module, all user journeys, permission boundaries, and the workflows that connect them.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Core Concepts](#2-core-concepts)
3. [User Roles and Permissions](#3-user-roles-and-permissions)
4. [Getting Started](#4-getting-started)
5. [The Agent Pipeline](#5-the-agent-pipeline)
6. [Memory-Calibrated Agent Swarm (MCAS)](#6-memory-calibrated-agent-swarm-mcas)
7. [Dashboard and Analysis Modules](#7-dashboard-and-analysis-modules)
8. [Supplier Intelligence Modules](#8-supplier-intelligence-modules)
9. [Supplier Management](#9-supplier-management)
10. [Reporting and History](#10-reporting-and-history)
11. [Configuration](#11-configuration)
12. [Account Management](#12-account-management)
13. [Premium Access](#13-premium-access)
14. [Administration Console](#14-administration-console)
15. [Multi-Tenant Data Isolation](#15-multi-tenant-data-isolation)
16. [Email Notifications](#16-email-notifications)
17. [Security](#17-security)
18. [Responsible AI Framework](#18-responsible-ai-framework)
19. [Technology Stack](#19-technology-stack)

---

## 1. Platform Overview

DisruptIQ helps organisations respond to supply chain disruptions in near real time. The platform continuously monitors external signals — news feeds and weather data — and cross-references them against an organisation's own supplier network. When a relevant disruption is detected, it can be analysed automatically by a pipeline of nine AI agents that produce a ranked set of recovery actions, each backed by quantitative reasoning and probabilistic simulation.

The defining principle of the platform is that **AI assists, but humans decide**. No recovery action is committed without explicit human confirmation, and the most severe events require a second approver. After an event is resolved, the platform records the real outcome and feeds it back into its memory, so each subsequent forecast for a similar event is calibrated by what actually happened before.

The platform is multi-tenant. Every record — suppliers, events, memory, reports, and audit entries — is strictly partitioned by organisation. A client only ever sees its own data.

### What the platform delivers

| Capability | Description |
| --- | --- |
| Continuous monitoring | Watches global news and weather signals against the client's supplier zones and industry. |
| Automated analysis | A nine-agent pipeline detects, forecasts, scores, recommends, and simulates within a 90-second window. |
| Human-gated decisions | Recovery actions require human confirmation; severe events require a co-reviewer. |
| Outcome-driven learning | Resolved events calibrate future forecasts through a two-stage memory model. |
| Supplier intelligence | Risk, financial health, ESG, dependency, and tier-2 visibility analysis on the client's own data. |
| Full auditability | Every agent action and human decision is logged, attributable, and exportable. |

---

## 2. Core Concepts

| Term | Meaning |
| --- | --- |
| Client | A registered organisation (tenant). All data is partitioned by client. |
| Supplier | A vendor in the client's supply network, with attributes such as zone, categories, reliability, buffer stock, and site count. |
| Event | A disruption — manually reported or detected from a monitored feed — that the agent pipeline analyses. |
| Severity | A 1–10 score that determines whether the full pipeline engages and how many approvals are required. |
| Tier-1 supplier | A direct supplier the client purchases from. |
| Tier-2 dependency | A supplier of the client's suppliers, inferred probabilistically from an industry knowledge graph. |
| Swarm | The coordinated set of AI agents that analyse an event. |
| Stage-1 memory | Predictions and recalled context recorded at the time an event is analysed. |
| Stage-2 memory | Actual outcomes recorded after an event is resolved, used to calibrate future forecasts. |
| Human-in-the-loop | The mandatory approval gates a human must clear before an action is confirmed. |
| Cascade | Two or more disruptions within a defined time window that share suppliers and therefore compound. |
| Dissent | A flagged disagreement between the forecast and risk assessments that requires human review. |

---

## 3. User Roles and Permissions

The platform recognises three categories of user. Access to data and features is enforced on the server for every request.

| Role | Description | Access |
| --- | --- | --- |
| Demo user | An unauthenticated visitor exploring the platform without registering. | Pre-loaded demonstration data in an isolated session. Cannot upload data or affect any real client. |
| Client user | A registered organisation account. | Full access to its own data and analysis features. Subject to free-tier limits unless on a premium plan. |
| Administrator | The platform owner account. | The administration console and all cross-tenant operational views, in addition to standard client access. |

Permission boundaries are enforced as follows:

- Every authenticated request is scoped to the requesting client. Reads and writes are filtered by the client identity carried in the session token.
- Administrative routes are visible only to the owner account. Any other user requesting an administrative route receives a "not found" response, so the console is invisible rather than merely forbidden.
- Demo sessions are isolated per browser session. Two concurrent demo users never see each other's activity.

---

## 4. Getting Started

A new visitor has two entry paths from the public landing page.

### 4.1 Demo Mode

Demo Mode provides immediate access with no registration. The visitor enters a fully populated environment built on demonstration data and can explore every feature. Demo sessions are isolated — each browser session receives its own workspace, and no demo activity is ever visible to any real client account.

Demo Mode is intended for evaluation. Data cannot be uploaded, and demo activity does not persist beyond the session.

### 4.2 Registration and Onboarding

Registration is the recommended path for organisations that want to analyse their own supply network.

**Registration workflow:**

1. The visitor provides company name, industry, contact name, email, and a password.
2. The password is validated against minimum strength rules before the account is created.
3. On successful registration, the platform:
   - Creates the client account and a 24-hour session.
   - Seeds a set of industry-relevant scenarios so the account has meaningful starting content.
   - Records the registration in the audit log.
   - Sends a registration confirmation email (see [Email Notifications](#16-email-notifications)).
4. The user is taken to the dashboard, where a short guided tour introduces the supply network view, the agent pipeline, and recommended first steps.

**Onboarding with supplier data:**

The registration experience provides ready-made industry datasets covering sectors such as automotive, electronics, pharmaceutical, FMCG, logistics, and others. A user can select a dataset that matches their industry and upload it directly, or upload their own supplier file.

- Supplier files are accepted as Excel (`.xlsx`, `.xls`) or CSV, up to 10 MB.
- The required columns are supplier name and zone; additional attributes (categories, buffer stock days, sites, reliability, proximity) are parsed when present.
- Free-tier accounts may hold up to 30 suppliers. Files exceeding this import the first 30 and surface a clear message about the limit, with the option to request premium access.
- When the first supplier upload completes successfully, the platform sends a single onboarding confirmation email. This email is sent once per account and is suppressed on subsequent uploads to prevent duplicates.

Once suppliers are loaded, the platform's monitoring and analysis features are fully active for that account.

---

## 5. The Agent Pipeline

When an event is triggered — either reported manually or detected from a monitored feed — a pipeline of nine specialised agents analyses it. Progress streams to the dashboard in real time, so the user watches each agent activate and complete. The full pipeline is designed to finish within 90 seconds.

### 5.1 Triggering an event

A user reports a disruption through a form that captures the source, geography, location, event type, severity score, and a free-text description. On submission, the pipeline begins immediately and the live feed displays each agent's status.

### 5.2 The nine agents

| Stage | Agent | Function |
| --- | --- | --- |
| 1 | Monitor | Computes a deterministic severity score from the event details and decides whether the event meets the threshold to engage the full pipeline. |
| 2 | Swarm Memory | Recalls past incidents from the same geography and supplier zones, providing historical context that calibrates the forecast before it runs. |
| 3 | Cascade Detection | Checks for a second related event within the configured time window. When found, it escalates severity in proportion to how many suppliers the events share. |
| 4 | Forecast | Predicts the demand impact, expressed with confidence intervals, using the client's actual supplier attributes and any relevant memory calibration. |
| 5 | Risk | Scores each supplier across five weighted factors and assigns each supplier a risk tier. |
| 6 | Action | Produces three ranked recovery options. Each states why the supplier was selected, how the action works, and the risk to watch. |
| 7 | Validator | Compares the forecast and risk assessments. If they diverge beyond the configured threshold, the result is flagged for mandatory human review. |
| 8 | Simulation | Runs probabilistic scenarios for each recovery option, producing pessimistic, expected, and optimistic outcomes within a defined time budget. |
| 9 | Human Confirmation | Presents the approval gates. No action is committed until every required gate is acknowledged; the most severe events require a second approver. |

After the human resolves the event and submits the actual outcome, a final counterfactual step records the difference between predicted and actual results into long-term memory, completing the learning loop.

Forecast and Risk run concurrently, as do memory recall and cascade detection, to keep the pipeline within its time budget.

### 5.3 Human-in-the-loop gates

Confirmation is enforced on the server. The approval request is rejected if any required acknowledgment is missing — the interface cannot bypass this. Gates include:

- **Dissent** — required when the forecast and risk assessments diverge beyond threshold.
- **Cascade** — required when a compounding event was detected.
- **Simulation** — required acknowledgment that simulated outcomes were reviewed.

For events of the highest severity, a second reviewer must also approve before the action is committed.

### 5.4 Graceful degradation

If the language model is unavailable or its quota is exhausted, agents fall back to deterministic, dataset-aware logic. Fallback responses still use the client's actual suppliers and categories, so the pipeline never fails silently and never invents supplier names.

---

## 6. Memory-Calibrated Agent Swarm (MCAS)

MCAS is the platform's defining architecture. It transforms a stateless multi-agent system into one that measurably improves with use.

Conventional multi-agent frameworks operate without persistent memory — each run begins from scratch, with no recollection of prior outcomes. MCAS differs in three ways:

1. **Stage-1 memory recall.** Before forecasting, the Swarm Memory agent recalls relevant past incidents and uses them to calibrate the forecast.
2. **Stage-2 outcome write-back.** After a human confirms the actual outcome of a resolved event, the counterfactual step records the difference between predicted and actual values into long-term memory.
3. **Calibrated future forecasts.** The next forecast for a comparable event type and geography is automatically adjusted by the recorded real-world difference, rather than relying on uncalibrated estimates.

The result is a system that learns from real outcomes without retraining any underlying model, while keeping a human in control of what it learns — memory is only written after a person confirms the outcome.

### Supporting algorithms

| Algorithm | Purpose |
| --- | --- |
| Memory-Calibrated Forecast | Adjusts the next forecast by the average difference between past predicted and actual outcomes. |
| Compound Cascade Severity | Escalates combined severity in proportion to the supplier overlap between simultaneous events. |
| Multi-Signal Dissent Score | Detects meaningful disagreement between the forecast and risk assessments and gates a human checkpoint. |

---

## 7. Dashboard and Analysis Modules

The dashboard is the operational centre of the platform. Each panel includes an in-context help explanation describing what it shows and how to interpret it.

| Panel | Purpose |
| --- | --- |
| Live Agent Feed | Streams each agent's activation and completion in real time as an event is analysed. |
| Event Overview | Summarises the disruption — location, severity, type — and the Monitor agent's decision to engage the pipeline. |
| Memory Recall | Shows the past incidents the Swarm Memory agent recalled and how they calibrate the current forecast. |
| Expert Disagreement | Surfaces a flagged divergence between forecast and risk, with the acknowledgment required to proceed. |
| Cascade Alert | Displays compounding-event detection and the resulting severity adjustment. |
| Supplier Risk Table | Ranks every supplier by risk tier, with a per-supplier explanation of the score. |
| Demand Impact Forecast | Charts the predicted demand shift with confidence intervals; low-confidence forecasts are visually distinguished. |
| Recommended Actions | Presents three ranked recovery options, each with a rationale, recovery-time tag, simulation results, and a one-click supplier outreach draft. |
| Assistant | A conversational interface answering questions about the current event using the client's own data and figures. |
| Confirmation Gates | The human approval checklist that must be cleared before an action is committed. |

### Supplier risk scoring

Each supplier's risk score combines five weighted factors and resolves to a tier.

| Factor | Weight |
| --- | --- |
| Proximity to disruption | 30 |
| Buffer stock | 25 |
| Site count | 20 |
| Reliability | 15 |
| Category criticality | 10 |

| Tier | Score range |
| --- | --- |
| Critical | Above 75 |
| High | 60 to 75 |
| Medium | 40 to 60 |
| Low | Below 40 |

Every score exposes its factor breakdown, so users can see exactly why a supplier was rated as it was.

---

## 8. Supplier Intelligence Modules

Beyond event analysis, the platform provides standing intelligence derived from the client's own supplier data. These modules do not require a live disruption.

### 8.1 Supply Chain Map

A visual representation of the client's supply network. Supplier nodes, port hubs, and active disruption zones are rendered together, so users can see at a glance which suppliers fall within an affected area.

Accompanying the map is an insights view that derives warnings algorithmically from the client's own suppliers — no external data or model calls are involved. It highlights single-source category risk, geographic concentration, low-buffer zones, and reliability outliers.

### 8.2 Tier-2 Visibility

Most organisations have visibility only into their direct suppliers. A failure one level deeper — among the suppliers of those suppliers — can disable several direct suppliers at once without warning.

This module infers probable tier-2 dependencies automatically from each tier-1 supplier's categories, using an industry knowledge graph. No manual survey is required; the user uploads tier-1 suppliers and the inference engine maps the layer beneath them.

For each inferred dependency, the module shows the category, the dependent tier-1 suppliers, an inference confidence score, and the probable zones. Inferences are estimates, and the confidence score communicates their reliability.

Critically, the module flags **single points of failure** — tier-2 categories that, if disrupted, would affect many tier-1 suppliers simultaneously. These represent hidden structural risks that direct-supplier views cannot reveal.

### 8.3 Supplier Financial Health

This module estimates each supplier's financial resilience by combining industry sector stress signals with operational proxies — reliability and buffer stock — and distress indicators. Each supplier receives a score from 0 to 100 and a corresponding tier.

| Tier | Score range | Interpretation |
| --- | --- | --- |
| Stable | 75 and above | Healthy profile; low short-term risk. |
| Watch | 60 to 74 | Some caution warranted; manageable with periodic review. |
| At Risk | 40 to 59 | Elevated stress; monitor closely and qualify alternatives. |
| Critical | Below 40 | Immediate financial risk; treat as a potential supply failure. |

Each supplier offers an explanation of its rating and a recommended action plan appropriate to its tier — from maintaining the current review cadence for stable suppliers to escalating to procurement leadership and activating backups for critical ones.

### 8.4 ESG and Compliance Risk

This module scores each supplier on environmental, social, and governance risk by combining three signals: the carbon intensity of the supplier's industry, the climate exposure of its geographic zone, and the labour and governance profile of its sector. The three combine into a composite score and grade.

| Grade | Score range | Interpretation |
| --- | --- | --- |
| A | 80 and above | Best-in-class profile. |
| B | 65 to 79 | Good, with room to improve. |
| C | 45 to 64 | Elevated risk; action recommended. |
| D | Below 45 | High risk; urgent review required. |

Each supplier offers a grade explanation across all three pillars and a recommended action plan — from annual monitoring for top-graded suppliers to commissioning independent audits and issuing time-bound improvement plans for high-risk ones.

### 8.5 Dependency Heatmap

A concentration matrix that maps product categories against supplier zones. A dense cell indicates heavy dependence on a single region for a single category — a structural fragility that can be addressed before any disruption occurs. The module also presents concentration-risk indicators to prioritise diversification.

---

## 9. Supplier Management

The platform provides complete control over the client's supplier records.

| Operation | Description |
| --- | --- |
| Add supplier | Create a single supplier record. |
| Update supplier | Edit an existing supplier's attributes. |
| Delete supplier | Remove one supplier, or remove several at once. |
| Upload file | Import suppliers in bulk from Excel or CSV, subject to the free-tier limit. |
| Download template | Obtain a blank import template with generic example rows. |
| Export | Download the current supplier list as a formatted Excel file. |
| Health scores | View a composite health score per supplier. |
| Compare | View selected suppliers side by side. |
| Trends | View a 30-day health trend per supplier. |
| Anomalies | Identify statistical outliers within the supplier set. |

A **resilience score** summarises the overall health of the supply network on a 0–100 scale, broken into four components — supplier diversity, geographic spread, financial buffer, and lead time — with specific recommendations for improvement.

Free-tier accounts are limited to 30 suppliers. When an upload or addition would exceed this limit, the platform surfaces the current usage and offers a one-click path to request premium access.

---

## 10. Reporting and History

### 10.1 Event History

Event History records every disruption the organisation has analysed. For each event it presents what was triggered, what the agents predicted, the action taken, and — once resolved — the actual outcome alongside the predicted values. Users update the actual outcome here after an event plays out, which is the action that feeds the learning loop.

### 10.2 Reports

The reporting suite provides analytical views across all of the client's activity. All reports are scoped to the client and can be exported.

| Report | Content |
| --- | --- |
| Event Log | Complete record of disruptions, with filtering. |
| Swarm Performance | Agent timing and service-level adherence per pipeline run. |
| Memory Accuracy | How closely recalled memory matched actual outcomes. |
| Dissent Detection | Frequency and nature of forecast–risk disagreements. |
| Simulation Accuracy | How simulated outcomes compared with reality. |
| Cascade Detection | Compounding events identified and severity adjustments applied. |
| Counterfactual Summary | Aggregate predicted-versus-actual differences across resolved events. |
| Human Decisions | Every human confirmation, including approver and timing. |
| Forecast and Risk Accuracy | Combined forecast and risk performance over time. |

### 10.3 Audit Log

Every agent action and human decision is recorded with a timestamp and the responsible actor, scoped to the client. The audit log is viewable in the platform and exportable for compliance.

---

## 11. Configuration

The configuration module lets a client tune how the platform behaves. All changes are recorded with a full history.

### 11.1 Analysis thresholds

| Setting | Effect |
| --- | --- |
| Alert Sensitivity | Minimum severity before the full pipeline engages. Lower values catch smaller disruptions; higher values focus on major events. |
| Cascade Detection Window | The time window within which two disruptions affecting shared suppliers are treated as one compounding event. |
| Expert Agreement Gap | The divergence between forecast and recommendation scores that triggers a mandatory review. |
| Cascade Severity Boost | How much more serious a compounding event is rated relative to a single disruption. |
| Simulation Time Limit | The maximum time allowed for outcome simulations before pre-built estimates are used, preserving the overall time budget. |

### 11.2 Monitoring frequency

| Setting | Effect |
| --- | --- |
| News Check Frequency | How often the platform polls global news sources for disruptions. |
| Weather Check Frequency | How often weather data refreshes for the client's supplier zones. |
| Minimum Severity to Notify | Disruptions below this level are monitored silently; only those at or above it generate a notification. |

### 11.3 Supplier and memory controls

From the configuration module a user can also edit individual supplier details, upload new supplier data, and review the complete history of configuration changes. The platform's learning memory — both predictions and recorded outcomes — can be exported in full for transparency.

---

## 12. Account Management

Account settings are organised into focused areas.

| Area | Function |
| --- | --- |
| Profile | Edit the contact name on the account. |
| Company | Edit company name and industry. |
| Password | Change the password after verifying the current one. |
| Notifications | Set per-channel notification preferences. |
| Security | View active sessions across devices; revoke any single session or sign out everywhere. |
| Feedback | Submit a satisfaction rating with an optional comment. |
| Onboarding | Track progress through a guided setup checklist. |
| Account Information | Export all account data, reset analysis data while keeping the account, or delete the account. |

### 12.1 Sessions and security

Each sign-in creates a tracked session recording the device, browser, and network origin. A user can revoke an individual session or invalidate all sessions at once.

### 12.2 Data export and reset

A user can export a complete archive of their account data. They can also reset analysis data — clearing events, memory, and audit history while preserving the account — which requires an explicit confirmation phrase.

### 12.3 Account deletion

Account deletion is immediate and permanent. The interface guides the user through three phases: an initial state, a confirmation step that captures an optional reason, and a final state that signs the user out. On deletion, all associated data — profile, suppliers, events, memory, audit entries, sessions, scenarios, feedback, and support records — is removed. A churn reason and summary metadata are retained for the administrator's analytics, and a best-effort confirmation email is sent.

---

## 13. Premium Access

The platform operates a two-tier model.

| Plan | Supplier limit | Access |
| --- | --- | --- |
| Free | 30 suppliers | Full analysis features within the supplier limit. |
| Premium | Unlimited suppliers | No supplier cap; full feature access. |

When a free-tier account reaches its supplier limit, the platform presents the current usage and offers a one-click request for premium access. The request is recorded for administrator review. When an administrator approves the request — or grants premium directly — the account is upgraded immediately, an in-application notification is delivered, a premium badge appears in the account header, and a premium-access confirmation email is sent to the account owner.

---

## 14. Administration Console

The administration console is available only to the platform owner. To any other account, its routes are invisible. The console is organised into operational areas.

| Area | Function |
| --- | --- |
| Overview | Headline metrics: total accounts, premium count, active events, pipeline runs, support volume, and average satisfaction. |
| Accounts | Every registered account with company, industry, plan, suspension state, and supplier and event counts. Supports suspending, reactivating, granting or revoking premium, and deleting accounts. |
| Deleted Accounts | Accounts removed by administrative action, with the option to restore. |
| Churned Accounts | Self-initiated deletions, including reasons and summary metadata, for retention analysis. |
| Premium Requests | All premium-access requests, with approve and deny actions. |
| Support | All support tickets across accounts, with the ability to respond directly. |
| Feedback | All satisfaction ratings and comments across accounts. |
| Activity Log | Recent audit activity across accounts. |
| Assistant Interactions | Recent conversational questions and answers across accounts. |
| System Health | Operational status of platform services, uptime, and resource usage. |

### Account suspension

When an administrator suspends an account, the next request from that account is refused, and the account holder is shown a clear, full-screen notice with a support contact. Suspension is lifted by reactivating the account.

---

## 15. Multi-Tenant Data Isolation

Strict data isolation is a foundational guarantee. A newly onboarded client sees only the suppliers it uploaded — never demonstration data and never another client's data. Isolation is enforced on the server at every read path.

| Surface | What a client sees |
| --- | --- |
| Suppliers | Only its own uploaded suppliers. |
| Scenarios | Its seeded industry scenarios and any it created. |
| News | Alerts matching its supplier zones and industry keywords only. |
| Weather | Only the cities where its suppliers operate. |
| Supply chain map and analysis | Only its own nodes, scores, and concentrations. |
| Events, memory, audit, reports | Only records belonging to the client. |
| Real-time updates | Delivered only to the client's own session channel. |

Agent-level isolation reinforces this: forecasting, risk scoring, action proposals, and cascade detection all operate exclusively on the client's supplier list, and recovery proposals are validated so that no supplier outside the client's own set can be recommended.

Demonstration sessions are likewise isolated — each receives a distinct workspace and real-time channel, so no demo activity crosses between sessions.

---

## 16. Email Notifications

The platform sends transactional email at defined moments in the user journey. Email is delivered through a configured provider — an email service or authenticated SMTP. When email delivery is not configured, messages are logged rather than sent, so development environments are unaffected. Every send attempt is recorded in the audit log, and a delivery failure never interrupts the originating request.

The platform sends email only when an action genuinely warrants it, and each notification is guarded against duplicate delivery.

| Notification | Trigger | Delivery guarantee |
| --- | --- | --- |
| Registration confirmation | A new account is successfully created. | Sent once at registration. |
| Onboarding confirmation | A client's first supplier upload completes successfully. | Sent once per account; suppressed on later uploads. |
| Premium access granted | An administrator approves a premium request or grants premium directly. | Sent to the account owner on approval. |
| Password reset request | A user requests a password reset. | Sent on request, with a time-limited link. |
| Password changed | A user's password is changed. | Sent as a security confirmation. |
| Support ticket created | A support ticket is submitted. | Confirmation to the client; notice to the support inbox. |
| Support response | An administrator responds to or resolves a ticket. | Sent to the client. |
| Account deletion | An account is deleted. | Best-effort confirmation. |

### Delivery behaviour

- **Registration.** On successful sign-up the platform dispatches the registration confirmation asynchronously, so account creation is never delayed by email delivery.
- **Onboarding.** The onboarding confirmation is sent after the first successful supplier import. A one-time flag on the account ensures it is sent exactly once; subsequent imports do not re-trigger it.
- **Premium approval.** Both approving a pending request and granting premium directly dispatch the premium-access confirmation to the account owner.

Transient email failures are logged with context and do not raise errors to the user; the originating operation always completes regardless of email outcome.

---

## 17. Security

| Mechanism | Detail |
| --- | --- |
| Password storage | Passwords are hashed with a salted, high-iteration key-derivation function. Older hashes are verified transparently and upgraded. |
| Session tokens | Time-limited tokens carry the user identity and a per-session identifier, enabling per-device revocation. |
| Session revocation | Individual sessions can be revoked; a single action can invalidate all sessions for a user. |
| Rate limiting | Sign-up, sign-in, and password-reset requests are rate-limited per identifier. |
| Input validation | All user input is validated at the system boundary; uploads enforce type and size limits. |
| Content safety | AI-generated narratives pass through a safety filter before display. |
| Access control | Every request is scoped to the requesting client; administrative routes are hidden from non-owners. |
| Auditability | Every state-changing action is recorded with actor and timestamp. |

---

## 18. Responsible AI Framework

The platform is designed so that AI supports human judgment rather than replacing it.

- **Mandatory human approval.** Recovery actions cannot be committed without human confirmation, enforced on the server and not bypassable by the interface.
- **Second approver for severe events.** The most critical decisions require two human approvers.
- **Human-gated learning.** The platform records outcomes into memory only after a human confirms what actually happened, so people decide what the system learns.
- **Content safety.** AI narratives are filtered before they are shown.
- **Explainability.** Every supplier risk score, financial-health rating, and ESG grade exposes the factors behind it.
- **Complete audit trail.** Every agent action and human decision is logged and attributable.
- **Graceful degradation.** When AI services are unavailable, the platform falls back to deterministic, data-aware logic rather than failing or inventing information.

---

## 19. Technology Stack

| Layer | Technology |
| --- | --- |
| Backend | Python with an asynchronous web framework and real-time messaging. |
| Frontend | A modern component-based web application with interactive charting. |
| Persistence | A managed cloud database, with an in-memory fallback for demonstration use. |
| Real-time updates | A bi-directional channel that streams pipeline progress to the client session. |
| External data | News and weather feeds, polled at configurable intervals and filtered to each client. |
| Email | A configured email provider or authenticated SMTP for transactional messages. |
| Safety | A content-safety service applied to AI-generated narratives. |

---

## Appendix: End-to-End User Journey

The platform's value is best understood as a continuous loop.

1. **Onboard.** The organisation registers and uploads its supplier network.
2. **Monitor.** The platform watches external signals against that network.
3. **Surface.** A relevant disruption is flagged as a scenario to examine.
4. **Analyse.** The agent pipeline assesses impact, risk, and recovery options.
5. **Decide.** A human reviews the options and confirms an action through the required gates.
6. **Act.** The chosen recovery is executed, supported by a generated supplier outreach draft.
7. **Record.** Once the event resolves, the actual outcome is entered.
8. **Learn.** The recorded outcome calibrates the next forecast for similar events.

Each cycle leaves the platform better calibrated than the last, while a human remains in control of every decision and of everything the system learns.
