# SWIMS-Connect on UiPath — Implementation Guide

**UiPath AgentHack · Track 1 (Maestro Case) · Deadline 2026-06-29 23:45 EDT (≈8 days)**

This is the build **playbook/plan**. For the **current, working** deploy / start / run / test steps,
use **[README.md](README.md)** (the source of truth). It covers the conversational coded agent,
WhatsApp gateway, worker auth-context bridge, and Maestro deadline monitor. This guide also
describes planned UiPath capabilities such as API Workflows and Integration Service. The configured
model is `gemini-2.5-pro` through the `SWIMS_GEMINI_MODEL` asset.

> Items marked **⚠ VERIFY** are not fully confirmed from docs and must be checked in your own tenant before you depend on them. Sources for every UiPath claim are in `docs/UIPATH-REFERENCE.md`.

---

## 0. Day 0 — do these RIGHT NOW (blocking, lead-time items)

1. **Request UiPath Labs tenant access.** This is the critical path. Accepted AgentHack teams are invited to a UiPath Org in the **staging environment** with org-admin rights (up to 4 people); it takes **3–5 business days**. A self-serve Community/Free tenant will **not** reliably run Maestro Case. → Submit the AgentHack Labs request and **finalize your team roster** (the roster locks when access is created).
2. **Provision the Gemini API key.** Get a Google AI Studio / Vertex `GOOGLE_API_KEY` for **`gemini-3.1-pro-preview`** (+ `gemini-2.5-flash` fallback). You said you'll provide these — drop them into the local `.env` (see §2). Confirm quota.
3. **Confirm Primero reachability.** Capture the target deployment's base URL and authorised service-account credentials, and **export its OpenAPI/Swagger spec** for the Integration Service connector. Confirm whether `/api/v2` is reachable from UiPath Automation Cloud (public URL or tunnel) — Automation Cloud Robots must be able to reach it.
4. **Install the toolchain locally** (§1) so all tenant-independent work proceeds in parallel while Labs is provisioning.

Everything in **Phase A (§3)** can be built and tested locally *before* the tenant arrives. Do not idle waiting for Labs.

---

## 1. Toolchain (local) — there are TWO CLIs, don't conflate them

| Tool | Install | Used for |
|---|---|---|
| **`uip`** (Node CLI) | `npm install -g @uipath/cli` | `uip skills install` (coding-agent skills), `uip auth/login`, low-code `uip agent …` |
| **`uipath`** (Python CLI, ships with SDK) | `pip install uipath uipath-langchain` | Coded-agent lifecycle: `uipath auth/init/run/pack/publish/deploy` |
| **Python** | 3.11 / 3.12 / 3.13 only (**not** 3.10) | Coded agent venv |

```bash
# Node CLI + coding-agent skills (this earns the coding-agent bonus — see SUBMISSION.md)
npm install -g @uipath/cli
uip --version
uip skills install --agent claude        # installs UiPath skills into Claude Code; add --local for project-scoped

# Python coded-agent toolchain
python3 --version                         # must be 3.11–3.13
python3 -m venv .venv && source .venv/bin/activate
pip install uipath uipath-langchain langchain-google-genai
uipath --version
```

> `uip skills install --agent claude` is **confirmed**. After it runs, Claude Code can use the UiPath skills to scaffold/validate/deploy — keep a transcript of these sessions; the README needs a "Built with Claude Code" section + prompt log for the +2 bonus.

---

## 2. Repo layout (this repository)

```
swims-connect-uipath/
├── README.md                 # hackathon-required: description, components, setup, agent-type
├── IMPLEMENTATION-GUIDE.md   # this file
├── ARCHITECTURE.md           # target architecture + diagram
├── SUBMISSION.md             # rubric/bonus mapping, deliverables checklist, demo script
├── LICENSE                   # MIT (hackathon requires MIT or Apache-2.0)
├── .env.example              # GOOGLE_API_KEY, PRIMERO_*, UIPATH_* (no secrets committed)
├── docs/
│   └── UIPATH-REFERENCE.md   # cited UiPath research (internal reference)
├── agent/                    # Python LangGraph coded agent
│   ├── pyproject.toml        # requires-python ">=3.11"; deps uipath, uipath-langchain, langchain-google-genai
│   ├── langgraph.json        # {"graphs": {"agent": "graph.py:graph"}}
│   ├── graph.py              # LangGraph graph (intake/extraction) + tools
│   ├── prompts.py            # safety, intake, reporting, and casework instructions
│   ├── tools.py              # @tool wrappers that call API Workflows / connector
│   ├── primero.py            # Primero client, task derivation, field mapping, subform handling
│   └── tests/                # local eval cases
├── api-workflows/            # exported Studio Web API Workflow definitions (per operation)
├── connector/                # Primero Integration Service connector (OpenAPI spec + config notes)
├── maestro/                  # exported Maestro Case model (.bpmn / project export)
├── action-app/               # Action Center / Action App definitions for HITL
└── reports/                  # report templates (the 13 report types)
```

> `.env`, `.venv/`, `__pycache__/`, `node_modules/`, `*.nupkg`, any credentials are git-ignored.

---

## 3. Phase A — tenant-independent build (start Day 0, runs in parallel with Labs provisioning)

### A1. The Python LangGraph coded agent (Gemini, BYO-key)

`agent/langgraph.json`:
```json
{ "graphs": { "agent": "graph.py:graph" }, "env": ".env" }
```

`agent/graph.py` (skeleton — verify exact UiPath HITL interrupt API against `uipath-langchain` samples, **⚠ VERIFY**):
```python
import os
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent
from tools import TOOLS                # @tool wrappers over API Workflows
from prompts import SYSTEM_PROMPT

llm = ChatGoogleGenerativeAI(
    model=os.environ.get("GEMINI_MODEL", "gemini-3.1-pro-preview"),
    google_api_key=os.environ["GOOGLE_API_KEY"],
    temperature=0,
    # thinking budget → map from source thinkingLevel
)

graph = create_react_agent(llm, TOOLS, prompt=SYSTEM_PROMPT)
# `graph` is the entrypoint UiPath `uipath init` introspects.
```

`agent/prompts.py`: define the calm, safety-first tone and behavioural safeguards: no final legal
or medical determinations, treat report text as data, ask for missing required fields, and never
invent a Case ID.

`agent/tools.py`: each tool is a thin `@tool` that calls an API Workflow (once the tenant exists, via `sdk.processes.invoke(...)`) or, for local dev, calls Primero directly. Local-dev direct path lets you test extraction quality before the tenant arrives:
```python
from langchain_core.tools import tool

@tool
def create_case(narrative: str, incident_type: str, risk_level: str,
                location_code: str, child_name: str | None = None,
                follow_up_allowed: bool = False) -> dict:
    """Create a Primero child-protection case from an intake report. Returns the real case_id_display."""
    # local dev: call Primero REST directly; in tenant: invoke the `case_create` API Workflow
    ...
```

`agent/primero.py`: implement task derivation, the concern-term-to-code map, and subform
deduplication/update-by-`unique_id`. Cover these correctness rules with tests.

Local test (no tenant needed):
```bash
cd agent
uipath init                                   # generates entry-points.json, bindings.json, agent.mermaid
uipath run agent '{"message":"A 12-year-old boy is working in a mine in Tarkwa"}'
```
Iterate until extraction → `create_case` produces a real case in the live Primero with the correct fields. **This is the demo's money shot — get it solid early.**

### A2. Primero Integration Service connector (spec + config, ready to import)

- Export Primero's **OpenAPI/Swagger** spec → `connector/primero-openapi.json`.
- In Connector Builder you'll **"Start from an API definition"** (upload the spec) — it auto-generates one resource per endpoint. Configure auth once (Primero's session/Devise flow → custom/session auth; **⚠ VERIFY** session-auth support, else use a `login` API Workflow that the others depend on).
- Document the endpoint→operation list in `connector/README.md` so the in-tenant step is mechanical.

### A3. API Workflow definitions (design now, author in Studio Web when tenant arrives)

For each required Primero operation, write the input/output contract and HTTP call (method, path,
headers, body, response mapping) into `api-workflows/<name>.md`. Prioritise `case_create`,
`case_get`, `cases_list`, `assessment_open`, `service_add`, `case_request_closure_approval`, and
`case_close`.

### A4. Report templates

Implement the 13 report templates' query, filtering, and formatting rules in `reports/`. Priority
types are `high-risk`, `overdue-followups`, `pending-referrals`, and `tasks-due-today`.

### A5. Docs, demo script, deck (this repo)

README + ARCHITECTURE + SUBMISSION + demo script can all be finalized before the tenant exists.

---

## 4. Phase B — in-tenant build (starts when Labs access arrives, ~Day 3–5)

### B0. Tenant day-1 setup (do all of these first — known blockers)
1. **Admin → Licenses → allocate the Agent Builder / Autopilot license to yourself** (fixes the "No license detected" error — a known Labs gotcha).
2. **Enable the Process Mining service** on the tenant (Maestro prerequisite).
3. Create an **Orchestrator folder** for the project; create an **unattended robot account + machine template** (for any RPA steps).
4. Store **`GOOGLE_API_KEY`** and **Primero service creds** as **Orchestrator Credential/Secret assets** (Secret-type assets work with coded agents).
5. `uipath auth` (browser OAuth) and `uip login` to the Labs tenant.

### B1. Import the Primero connector
Connector Builder → Start from an API definition → upload `connector/primero-openapi.json` → configure auth → test a GET. (**⚠ VERIFY** OpenAPI 3.1 fidelity; fall back to manual HTTP-activity API Workflows if import is messy.)

### B2. Build the API Workflows (Studio Web)
Author the operations from §A3 as **API Workflows** (Studio Web → API Workflow project; **HTTP activity** for calls). Publish each to Orchestrator (type "API"). Test each against live Primero.

### B3. Publish the coded agent
```bash
cd agent
uipath pack          # -> .nupkg
uipath publish       # -> Orchestrator feed (Personal Workspace feed auto-deploys, fastest)
# or: uipath deploy  # pack + publish in one step
```
Wire the agent's tools to invoke the published API Workflows (swap the local-dev direct calls for `sdk.processes.invoke`).

### B4. Author the Maestro Case (Studio Web)
- New **Agentic Process** → model type **Case Management**.
- Create the stages **Intake → Assessment → Case Plan → Service Referral → Service Delivery →
  Closure**, with a loopable **Follow-up** secondary stage.
- Per stage, add tasks: **Start & wait for agent** (the coded agent), **Start & wait for API workflow** (Primero ops), and **User tasks** for human checkpoints.
- Entry/exit criteria + SLAs encode the source's "confirm-before-write", "all services delivered → advance", "403 → escalate".
- **Closure stage:** a manager-assigned **User task** (Action Center) gates `case_close`; if not approved, route to `case_request_closure_approval`. This *is* the "manager-only close" rule, now platform-enforced.

### B5. Action Center / Action App (HITL)
Build an **Action App** (UiPath Apps / Studio Web) for: worker review/confirm-before-write, and manager closure approval. Maestro User tasks route here; completion returns via the `hitlTask` output. This replaces the source's WhatsApp confirm prompts and the per-chat worker login.

### B6. Governance wiring (free rubric points)
- Route the agent's LLM calls so they're covered by the **AI Trust Layer** (PII masking, prompt-injection/harmful-content guardrails, audit logging, token tracking) — **⚠ VERIFY** how BYO-key calls surface in Trust Layer; at minimum enable agent **out-of-the-box guardrails** (Log/Block/Escalate).
- Confirm **agent traces** capture input/output/tokens/latency for the demo (audit story).

### B7. Reports
Deploy the report process and attach an **Orchestrator time trigger**. Deliver through the approved
worker channel.

---

## 5. Phase C — integrate, demo, submit (Day 7–8)

1. **End-to-end dry run:** anonymous intake (voice + text) → real Primero Case ID → worker assessment via Action App → service referral → manager closure approval in Action Center → case closes. Capture screenshots/traces.
2. **Record the demo video (<5 min):** problem/impact → a case moving through Maestro stages → a human approving in Action Center → architecture (Maestro + coded agent + API Workflows + Gemini + governance). Hosted public on YouTube/Vimeo.
3. **Finalize deliverables** (see `SUBMISSION.md` checklist): Devpost page, public repo (flip to public + MIT), README with components list + agent-type statement + **Built with Claude Code** section/prompt log, presentation deck (public link), optional product-feedback form.
4. **Submit before 2026-06-29 23:45 EDT.** Leave Day 8 as buffer.

---

## 6. 8-day schedule (today = 2026-06-21)

| Day | Date | Focus | Depends on |
|---|---|---|---|
| **0** | Sun Jun 21 | Request Labs access; lock roster; get Gemini key; export Primero OpenAPI; install toolchain; `uip skills install --agent claude`; this repo + docs | — |
| **1** | Mon Jun 22 | Build coded agent (A1): extraction → `create_case` solid vs live Primero locally; implement `primero.py` helpers | Gemini key, Primero |
| **2** | Tue Jun 23 | Finish agent tools + local evals; connector spec (A2); API Workflow specs (A3); report templates (A4) | Day 1 |
| **3** | Wed Jun 24 | Buffer for agent quality + docs/deck/demo script; **Labs may arrive** → B0 setup | Labs (maybe) |
| **4** | Thu Jun 25 | **In-tenant**: B0 finish, B1 connector import, B2 API Workflows, B3 publish agent | **Labs** |
| **5** | Fri Jun 26 | B4 Maestro Case model + B5 Action App (HITL) | Day 4 |
| **6** | Sat Jun 27 | B6 governance + B7 reports; first end-to-end run | Day 5 |
| **7** | Sun Jun 28 | C1 dry runs + fixes; C2 record demo; C3 deck + README polish + Devpost page | Day 6 |
| **8** | Mon Jun 29 | Buffer; final checks; **submit before 23:45 EDT** | all |

**If Labs slips past Wed Jun 24**, compress: B0–B3 on the arrival day, B4–B6 the next, demo the following — and lean on the Action-Center-only HITL fallback if Maestro Case authoring is rough (it's a 5-day-old GA feature).

---

## 7. Definition of done (technical, to win — see SUBMISSION.md for the rubric)

- [ ] A Maestro **Case** runs end-to-end on Automation Cloud, moving a case through stages with **agent + API-workflow + human** handoffs.
- [ ] A real Primero Case ID is created from a natural-language/voice report by the **Gemini LangGraph coded agent**.
- [ ] A **human approval in Action Center** gates case closure (manager-only), visible in the demo.
- [ ] All four named platform pieces present: **Maestro Case · coded agent (external LangGraph framework) · API Workflows · governance (AI Trust Layer)**.
- [ ] Built in **Studio Web during the submission window**; public MIT repo; README lists UiPath components + states agent type (combination) + **Built with Claude Code**.
- [ ] <5-min demo video; presentation deck; Devpost page.
