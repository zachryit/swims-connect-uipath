# SWIMS-Connect on UiPath — Architecture

> **Status:** this is the **target** architecture (north star). For **what is actually built and
> verified today** — and how to deploy/start/run it — see **[README.md](README.md)** §"Status" and
> **[docs/WHATSAPP-UIPATH-ARCHITECTURE.md](docs/WHATSAPP-UIPATH-ARCHITECTURE.md)**.
> Live deltas vs. this diagram: the coded agent is **conversational** and calls Primero **directly**
> (API Workflows/connector are the planned next step, not yet wired); the **Maestro Case + Action
> Center** lifecycle is **scaffolded** (`SWIMSChildProtectionCase/`), not yet driving the live flow;
> the model is configurable via the `SWIMS_GEMINI_MODEL` asset (**currently `gemini-2.5-pro`**); and
> per-worker Primero auth **is** used (via the auth-context bridge) — see decision #3 below.

A UiPath-native re-architecture of **SWIMS-Connect**, an AI assistant for Ghana child-protection case management. **UiPath Maestro** orchestrates the case lifecycle across AI agents, API integrations, and people; a **Python LangGraph coded agent** running **Google Gemini** handles conversational intake and field extraction; **API Workflows** (over an Integration Service connector) drive the **Primero/SWIMS** REST backend; **Action Center** keeps humans in charge at decision points; and the **AI Trust Layer** + Orchestrator provide governance.

```
        Community reporter (anonymous)        Field worker / Manager
                  │  text / voice                     │ acts on tasks
                  ▼                                    ▼
        ┌──────────────────────┐            ┌──────────────────────────┐
        │ Intake front-end      │            │  UiPath ACTION CENTER     │
        │ (Action App / webhook │            │  Action App (HITL):       │
        │  → Orchestrator API   │            │  • confirm-before-write   │
        │  trigger)             │            │  • manager closure approve│
        └──────────┬───────────┘            └─────────────▲────────────┘
                   │                                       │ hitlTask
                   ▼                                       │
    ┌───────────────────────────────────────────────────────────────────────┐
    │                       UiPath MAESTRO — CASE                              │
    │  Stages:  Intake → Assessment → Case Plan → Service Referral →           │
    │           Service Delivery → Closure        (+ Follow-up loop)           │
    │  Case entity carries data · participants · timeline across stages        │
    │  Case-manager & stage-manager agents pick the next task at runtime       │
    │  Entry/exit criteria · SLAs · rework loops  (exception-heavy ≠ BPMN)     │
    └───────┬───────────────────────────┬───────────────────────┬────────────┘
            │ Start & wait for agent     │ Start & wait for       │ User task
            ▼                            │ API workflow           ▼ (Action Center)
   ┌─────────────────────────┐          ▼                ┌──────────────────┐
   │ CODED AGENT (Python)     │  ┌────────────────────┐  │ Human approval /  │
   │ LangGraph ReAct          │  │ API WORKFLOWS       │  │ correction        │
   │ • Gemini 3.1 Pro (BYO key│  │ case_create/get/list│  └──────────────────┘
   │   → Orchestrator Secret) │  │ assessment_* /      │
   │ • intake + extraction    │  │ caseplan_* /        │
   │ • voice ASR + vision      │ │ service_* /         │
   │ • ported helpers:        │  │ followup_* / close /│
   │   deriveTasks, concerns, │  │ request_closure …   │
   │   subform dedup          │  └─────────┬──────────┘
   └──────────┬──────────────┘            │ HTTP (Devise session + CSRF)
              │ tool calls (invoke         ▼
              │ API Workflows)   ┌───────────────────────────────────────┐
              └─────────────────►│ Integration Service CONNECTOR (Primero)│
                                 │  generated from Primero OpenAPI spec   │
                                 └─────────────────┬─────────────────────┘
                                                   ▼
                       ┌────────────────────────────────────────────┐
                       │  PRIMERO / SWIMS REST API  (/api/v2)         │
                       │  + Collation service directory (read-only)   │
                       └────────────────────────────────────────────┘

   GOVERNANCE & OPS (cross-cutting)
    • AI Trust Layer: PII masking · prompt-injection/harmful-content guardrails · audit · token usage
    • Orchestrator: folders · Credential/Secret assets (Gemini key, Primero creds) · jobs
    • Agent traces: full input/output, tokens, latency  (audit-ready)
    • Orchestrator time trigger → Report process (13 report templates) → Action Center
```

## Component map

| Layer | UiPath artifact | Responsibility | Source it replaces |
|---|---|---|---|
| Orchestration | **Maestro Case** (Agentic Process, model=Case) | Stages, handoffs, SLAs, exit criteria, rework loops; case/stage-manager agents route at runtime | The implicit lifecycle in the OpenClaw prompts + `workflow` field |
| Reasoning | **Python LangGraph coded agent** (Gemini 3.1 Pro, BYO-key) | Conversational intake, field extraction, voice ASR + image captioning, provider lookup | OpenClaw agent loop + `IDENTITY.md`/`AGENTS.md` |
| Integration | **API Workflows** + **Integration Service connector** | All Primero reads/writes; subform update-by-id; task derivation | 34 `swims-*.js` tools + `lib/` clients |
| Human-in-the-loop | **Action Center** + **Action App** | Confirm-before-write; manager-only closure approval | WhatsApp confirm prompts + worker login link + auth server |
| Governance | **AI Trust Layer** + **Orchestrator** | LLM guardrails, PII masking, audit, secrets, job control | `redactSensitive`, anti-leak prompt, AES creds |
| Scheduling | **Orchestrator time trigger** → report process | 13 recurring report templates → workers | `swims-report-*` + systemd timer |
| Backend | **Primero/SWIMS** `/api/v2` + **Collation** | Case system of record + service directory | (unchanged — reused live) |

## Key design decisions

1. **Orchestration leaves the prompt.** In the source, the LLM drives the whole workflow. Here, **Maestro owns the lifecycle/handoffs/SLAs** and the agent is one actor it invokes — the pattern Track 1 rewards.
2. **Writes are deterministic.** A real `case_id_display` only ever comes from the `case_create` **API Workflow** and flows back as a Maestro variable, so the LLM cannot fabricate one (the source enforced this with a prompt+gateway guard; UiPath makes it structural).
3. **Auth keeps Primero as the authority (as built).** Each worker signs in to **their own Primero
   account** via a one-time HTTPS link; their session is carried into the conversational agent by the
   **auth-context bridge** (opaque token → resolver → graph state), so every action runs as that user
   and **Primero enforces their real role** (anonymous reports use the restricted `primero_cp` service
   account). *(Original target: model worker/manager authority purely as Action Center assignees +
   Maestro stage permissions — still the plan for the lifecycle/closure-approval steps.)*
4. **Gemini via BYO-key** (`ChatGoogleGenerativeAI` + `GOOGLE_API_KEY` secret) — the documented, de-risked path (UiPath LLM-Gateway selection of Gemini from the SDK is unverified).
5. **Built by a coding agent (Claude Code)** via `uip skills install --agent claude` — both an efficiency choice and a scored bonus.

See `PORTING-PLAN.md` for the full component-by-component mapping and `docs/UIPATH-REFERENCE.md` for cited platform details (including which features are still Preview / unverified).
