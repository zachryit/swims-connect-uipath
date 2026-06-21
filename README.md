# SWIMS-Connect on UiPath

**An agentic, human-in-the-loop child-protection case-management solution built on UiPath.**
*UiPath AgentHack submission — **Track 1: UiPath Maestro Case**.*

SWIMS-Connect lets community members file (optionally anonymous) child-protection reports in natural language or voice, and lets social-welfare field workers run a full caseload — **intake → assessment → case plan → service referral → service delivery → closure** — backed by the **Primero/SWIMS (UNICEF)** case system. This repository re-architects that workflow as a UiPath-native solution where **UiPath Maestro orchestrates a dynamic, exception-heavy case** across an AI agent, API integrations, and people, keeping humans in charge at every decision point.

> Built **with the Claude Code coding agent** using the UiPath skills catalog (`uip skills install --agent claude`). See [Built with Claude Code](#built-with-claude-code).

---

## What it does

- **Conversational / voice intake** → a **Python LangGraph agent** running **Google Gemini 3.1 Pro** extracts structured case fields from a free-text or voice-note report and opens a real Primero case (with a real Case ID — never fabricated).
- **Orchestrated case lifecycle** → **UiPath Maestro Case** moves each case through its stages with handoffs between the AI agent, API workflows (robotic integration), and human workers, with SLAs, exit criteria, and rework loops for the exceptions that can't be pre-defined.
- **Humans in charge** → confirm-before-write and **manager-only case closure** are enforced as **UiPath Action Center** approval tasks, not prompt rules.
- **Governed** → all LLM traffic and agent actions run under the **UiPath AI Trust Layer** (PII masking, guardrails, audit) with full **agent traces** (tokens, latency, decisions) for compliance.
- **Recurring oversight** → scheduled caseload reports (high-risk, overdue follow-ups, pending referrals, …) via Orchestrator triggers.

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full diagram.

---

## UiPath components used

| Component | Role in the solution |
|---|---|
| **UiPath Maestro — Case Management** | Orchestrates the case lifecycle (stages, handoffs, SLAs, exit criteria, rework loops); case/stage-manager agents route work at runtime |
| **Coded agent (Python, LangGraph)** | Conversational intake + field extraction + voice ASR / image captioning; model = **Google Gemini 3.1 Pro** (bring-your-own-key) |
| **API Workflows** (Studio Web) | Deterministic, governed reads/writes to the Primero backend (case create/get/list, assessment, case plan, services, follow-up, closure) |
| **Integration Service connector** | Primero REST connector generated from its OpenAPI spec; centralizes auth |
| **UiPath Action Center + Action App** | Human-in-the-loop: worker confirm/edit, manager closure approval |
| **AI Trust Layer** | LLM guardrails, PII masking, prompt/response audit, token-usage tracking |
| **UiPath Orchestrator** | Folders, Credential/Secret assets (Gemini key, Primero creds), jobs, time triggers (scheduled reports), agent traces |

**Agent type:** **combination** — low-code orchestration (Maestro Case + Action Apps) **plus** a **coded** LangGraph/Gemini agent — **built with the Claude Code coding agent**.

**External frameworks / models:** LangGraph (LangChain) + Google Gemini 3.1 Pro, integrated via UiPath's `uipath-langchain` SDK and bring-your-own-key.

---

## Prerequisites

- A **UiPath Automation Cloud** tenant with Maestro, Agents, Action Center, and Integration Service (the AgentHack **UiPath Labs** tenant; request early — provisioning takes 3–5 business days).
- **Python 3.11–3.13** (coded agents do not support 3.10).
- **Node.js 18+** (for the `uip` CLI).
- A **Google API key** for `gemini-3.1-pro-preview` (+ `gemini-2.5-flash` fallback).
- A reachable **Primero/SWIMS** backend (`/api/v2`) + its service-account credentials and OpenAPI/Swagger spec. (We reuse the existing live instance.)

---

## Setup

```bash
# 1. CLIs (two of them — see IMPLEMENTATION-GUIDE.md §1)
npm install -g @uipath/cli            # Node `uip` CLI
uip skills install --agent claude     # install UiPath skills into Claude Code

python3 -m venv .venv && source .venv/bin/activate
pip install uipath uipath-langchain langchain-google-genai   # Python `uipath` CLI + SDK

# 2. Configure
cp .env.example .env                  # set GOOGLE_API_KEY, PRIMERO_*, UIPATH_*

# 3. Authenticate to your tenant
uipath auth                           # coded-agent path (browser OAuth)
uip login                             # uip CLI path

# 4. Build & test the coded agent locally (no tenant needed)
cd agent
uipath init
uipath run agent '{"message":"A 12-year-old boy is working in a mine in Tarkwa"}'

# 5. Deploy (when the tenant is ready)
uipath pack && uipath publish         # coded agent -> Orchestrator
# then author the Maestro Case + API Workflows in Studio Web (see IMPLEMENTATION-GUIDE.md §4)
```

Full step-by-step (tenant setup, connector import, Maestro Case authoring, Action App, governance): **[IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md)**.

---

## Repository layout

```
agent/          Python LangGraph coded agent (Gemini): graph, prompts, tools, ported Primero helpers
api-workflows/  API Workflow definitions (one per Primero operation)
connector/      Primero Integration Service connector (OpenAPI spec + config)
maestro/        Maestro Case model export (stages, tasks, criteria)
action-app/     Action Center / Action App definitions (HITL)
reports/        Ported scheduled-report templates
docs/           SOURCE-INVENTORY.md (source system) · UIPATH-REFERENCE.md (cited platform research)
PORTING-PLAN.md · IMPLEMENTATION-GUIDE.md · ARCHITECTURE.md · SUBMISSION.md
```

---

## Built with Claude Code

This solution was designed and built using the **Claude Code** coding agent together with the official **UiPath skills catalog**:

```bash
uip skills install --agent claude
```

The coding agent scaffolded the Python LangGraph agent, drafted the API Workflow contracts, and assisted with the Maestro Case model and deployment. A prompt log / session export is included for the AgentHack coding-agent bonus *(to be added)*.

---

## Security & privacy

Handles child-protection data and minors. Secrets (Gemini key, Primero creds) live only in **Orchestrator Credential/Secret assets**, never in the repo. LLM traffic runs under the **AI Trust Layer** (PII masking, guardrails). Reports can be anonymous; case closure is least-privilege (manager approval in Action Center). No secrets are committed (`.env` is git-ignored).

## License

[MIT](LICENSE).
