# UiPath Platform Reference (internal, cited)

Researched 2026-06-21 against UiPath official docs (docs.uipath.com), uipath.github.io/uipath-python, github.com/UiPath + github.com/uipath/skills, uipath.com, and the Devpost hackathon pages. Items marked **[UNVERIFIED]** could not be confirmed from a primary source — verify in the Labs tenant before depending on them.

> **Framing fact:** Track 1 (Maestro Case) is confirmed on Devpost, but **Maestro Case reached GA 2026-06-16** (days before the hackathon) and parts (Process Apps / "Case App", business-rule task) are still **Preview**. Build on the **UiPath Labs** tenant (pre-loaded with agentic + AI units); a self-serve Community/Free tenant will likely block Maestro.

## 1. Maestro — Case Management (Track 1)

- **Maestro** = cloud-native agentic orchestration above robots/agents/people. Two modeling approaches share the platform: **BPMN Process** (structured) and **Case Management** (long-running, exception-heavy, "goal defined, path not"). [overview](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/overview) · [Introducing Maestro Case](https://www.uipath.com/blog/product-and-updates/introducing-maestro-case-new-uipath-capability)
- A **Case** = a living business entity carrying its data, participants, timeline, execution context across stages/actors/systems. [IR press release](https://ir.uipath.com/news/detail/455/uipath-introduces-maestro-case-to-orchestrate-dynamic-exception-heavy-business-processes-across-the-enterprise)
- Modeling: BPMN 2.0 + DMN for decisions; Case Management is a **distinct approach** for ad-hoc work. Concepts (verify exact field names in-product): **primary/secondary stages**, persistent case entity on **Data Fabric/data stores**, **case keys**, **entry/exit criteria + rework loops**, **SLAs + escalation**, **stage-level personas/permissions**. **[UNVERIFIED] do NOT claim CMMN.** Ad-hoc routing is driven by **case-manager + stage-manager agents** at runtime.
- **Work assignment by task type** ([tasks](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/tasks)): humans → *Create action app task*; robots → *Start/Create … RPA workflow / queue item*; UiPath agents → *Start and wait for agent*; external agents → *Start and wait for external agent*; APIs → *Start and wait for API workflow* / *Execute connector activity*; decisions → *Execute business rule* (Preview); sub-processes → *Start agentic process*.
- **Authoring:** **UiPath Studio Web** (browser) — new **Agentic Process** → model type **Case Management**. Lifecycle Model → Implement → Debug → Publish → Manage. Autopilot for Maestro supports prompt-based modeling. [ecosystem integration](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/maestro-integration-with-the-uipath-ecosystem) · [prerequisites](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/prerequisites) · [how-to](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/how-to-simple-process)
- **HITL:** **User task** (authored as *Create action app task*) pauses the process until an assignee acts via **Action Center** / a deployed **Action app**; response exposed as **`hitlTask`** output; actionable notifications allow completion without opening Action Center. [user task](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/user-task)
- **Publish:** from Studio Web → Orchestrator; **Personal Workspace feed auto-deploys** (fastest). Deployable = the agentic process (one `.bpmn`/project today). File extension not stated on the Maestro page (`.nupkg` is platform norm — **inferred**). [publishing](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/publishing-deploying-and-upgrading-agentic-processes)
- **Licensing:** needs Platform (Standard/Enterprise, **not** Basic) + User + Consumption (**1 Platform Unit / process instance**, 0 for debugging). Maestro Case GA 2026-06-16. [licensing](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/licensing-unified-pricing)

## 2. Coded agents (Python) + LangGraph + bring-your-own-Gemini

- Python apps, deployed as an Orchestrator process, packaged `.nupkg`, run on **Automation Cloud Robots – Serverless**. **Python 3.11–3.13 only (not 3.10).** [about coded agents](https://docs.uipath.com/agents/automation-cloud/latest/user-guide/about-coded-agents)
- Layout: `main.py` (or `graph.py`), `pyproject.toml`, **`uipath.json`** (you author: entry points) for coded functions; **`langgraph.json`** for LangGraph (`{"graphs":{"agent":"graph.py:graph"}}`). `uipath init` runs your entrypoint to derive I/O schema → generates `entry-points.json`, `bindings.json`, `agent.mermaid`. (`agent.json` belongs to the *low-code* `uip agent` path — different.) [functions](https://uipath.github.io/uipath-python/core/functions/) · [LangChain quick start](https://uipath.github.io/uipath-python/langchain/quick_start/)
- **LangGraph officially supported** via **`uipath-langchain`** (repo `uipath-langchain-python`) — implements the UiPath Runtime Protocol + Action Center HITL. Also LlamaIndex, OpenAI Agents. [repo](https://github.com/UiPath/uipath-langchain-python) · [blog](https://www.uipath.com/blog/product-and-updates/langgraph-uipath-advancing-agentic-automation-together)
- SDK packages (PyPI): **`uipath`** (core + CLI), **`uipath-langchain`** (import `uipath_langchain`). No `uipath-sdk` package.
- **Invoked in Maestro** as a Service Task **"Start and wait for agent"**: input as JSON, outputs bound back via the task's Output > Response panel. [using agents in Maestro](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/using-agents-in-maestro)
- **Gemini — two paths:**
  - **A — LLM Gateway (no key):** admin model list includes `gemini-3.1-pro-preview` (Gemini via Vertex). **[UNVERIFIED]** that Gemini is selectable via the *programmatic* gateway classes (`UiPathChat`) — SDK page showed only OpenAI ids. [configuring LLMs](https://docs.uipath.com/automation-cloud/automation-cloud/latest/admin-guide/configuring-llms)
  - **B — BYO-key (recommended):** "connect directly to the LLM provider … by providing the API key as an environment variable." Use **`ChatGoogleGenerativeAI`** (`langchain-google-genai`) + `GOOGLE_API_KEY` from an **Orchestrator Credential/Secret asset**. [quick start](https://uipath.github.io/uipath-python/langchain/quick_start/)
- Tools: `UiPathChat` is a drop-in LangChain ChatModel → standard `.bind_tools()` / `@tool` / ReAct. Core SDK: `sdk.assets`, `sdk.queues`, `sdk.processes.invoke`, `sdk.tasks` (Action Center), `sdk.context_grounding`, etc. [getting started](https://uipath.github.io/uipath-python/core/getting_started/)

## 3. CLI lifecycle — TWO CLIs

| | **`uip` (Node)** | **`uipath` (Python)** |
|---|---|---|
| Install | `npm i -g @uipath/cli` | `pip install uipath` |
| Auth | `uip login` | `uipath auth` |
| `skills install` | **Yes** (Node-only) | No |
| Pack output | `.uis` (agent) / `.nupkg` (rpa) | **`.nupkg`** |

- `uip skills install --agent claude` — **confirmed** (Claude Code, global; `--local` for project). Catalog = github.com/uipath/skills (Claude Code, Gemini CLI, Codex, Cursor). [coding agents](https://docs.uipath.com/uipath-cli/standalone/latest/user-guide/coding-agents) · [skills repo](https://github.com/uipath/skills)
- Python CLI: `uipath auth` → `uipath init` → `uipath run <entry> '<json>'` → `uipath pack` (→`.nupkg`) → `uipath publish` (Orchestrator feed) / `uipath deploy` (pack+publish) → `uipath invoke`. **[UNVERIFIED]** `uipath new`; that init scaffolds `AGENTS.md`. [CLI ref](https://uipath.github.io/uipath-python/cli/)
- Node `uip agent <sub>`: `init/config/validate/tool/context/escalation/input/output/eval/pack/publish/deploy/run`. [uip agent](https://docs.uipath.com/uipath-cli/standalone/latest/user-guide/uip-agent)

## 4. API Workflows (wrapping Primero)

- Studio Web project type for headless system-to-system API integration; runs serverless; consumes Integration Service connectors. [about API workflows](https://docs.uipath.com/studio-web/automation-cloud/latest/user-guide/about-api-workflows)
- **HTTP activity**: auth Manual (inject bearer/API-key) or Connector-based; method/URL/headers/query/JSON body/parsed response. [HTTP activity](https://docs.uipath.com/studio-web/automation-cloud/latest/user-guide/http)
- Exposed: publish to Orchestrator as type "API"; consumable as (1) Start-a-job, (2) **agent tool** (Agent Definition > Tools > API workflow), (3) **Maestro Service Task**, (4) Orchestrator API trigger. [consuming](https://docs.uipath.com/studio-web/automation-cloud/latest/user-guide/consuming-api-workflows)
- **Recommended for ~30 Primero endpoints:** build a **custom Integration Service connector from Primero's OpenAPI/Swagger** ("Start from an API definition" — auto-generates one resource per endpoint; configure auth once). Supports OAuth2/Basic/API-Key/PAT/Custom. Then wrap meaningful operations as API Workflows. **[PARTIAL]** OpenAPI 3.1 import fidelity unconfirmed; **[UNVERIFIED]** per-connector resource cap. [from an API definition](https://docs.uipath.com/integration-service/automation-cloud/latest/user-guide/from-an-api-definition) · [auth config](https://docs.uipath.com/integration-service/automation-cloud/latest/user-guide/authentication-configuration)

## 5. Automation Cloud setup

- **Use UiPath Labs, not self-serve.** AgentHack teams invited to a UiPath Org (staging) with org-admin, up to 4 people, **~3–5 business days** lead. Labs come with agentic + AI units. [AgentHack FAQ](https://community.uipath.com/agenthack-faq/) · [Devpost rules](https://uipath-agenthack.devpost.com/rules)
- Self-serve Community/Free: ~250 LLM calls/day, design-time-only Agent builder, no preview features, **Maestro likely unavailable**. [Agents licensing](https://docs.uipath.com/agents/automation-cloud/latest/user-guide/licensing)
- Orchestrator primitives: **Folders**, **Assets** (Credential for keys; **Secret-type works with coded agents**), **Queues**, **Processes**. Coded agents run on **Serverless robots**; Personal Workspace feed auto-deploys. [assets](https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/about-assets)
- **Maestro prerequisites (day 1):** Orchestrator + **Process Mining service enabled** + Studio Web + folder perms + (for RPA) unattended robot + machine template. [prerequisites](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/prerequisites)
- **Known Labs gotcha:** "No license detected" in Agent Builder → Admin → Licenses → allocate Agent Builder/Autopilot license to yourself first. [forum](https://forum.uipath.com/t/agenthack-2026-missing-agent-builder-license-on-hackathon-tenant/5754186)

## 6. Governance layer (claimable)

- **Orchestration:** Maestro coordinates agents/robots/humans with live instance supervision (pause/resume/retry); Orchestrator = scheduling, queues, retries, monitoring. [overview](https://docs.uipath.com/maestro/automation-cloud/latest/user-guide/overview)
- **Automation Ops** governance policies at tenant/group/user level (permitted packages, feeds, activities, AI models). **[UNVERIFIED]** "deployment approval gates." [governance](https://docs.uipath.com/automation-ops/automation-cloud/latest/user-guide/governance-intro)
- **AI Trust Layer:** central entry point for all LLM traffic — model/region routing, in-flight **PII masking**, prompt/response **audit logging**, usage tracking, **guardrails** (prompt injection, harmful content, IP, PII). Agents also have OOTB guardrails with actions **Log/Block/Escalate**. [AI Trust Layer](https://docs.uipath.com/automation-cloud/automation-cloud/latest/admin-guide/about-ai-trust-layer) · [OOTB guardrails](https://docs.uipath.com/agents/automation-cloud/latest/user-guide/out-of-the-box-guardrails)
- **Observability:** every agent run → a **trace** (steps, decisions, tool calls, I/O, errors, latency, **token usage**) for compliance/audit. [agent traces](https://docs.uipath.com/agents/automation-cloud/latest/user-guide/agent-traces)
- **Human oversight:** Action Center approvals; guardrail **Escalate** routes to a human.

Pitch line: *"Every Gemini call routes through the UiPath AI Trust Layer (PII masking, guardrails, audit, usage); Maestro orchestrates the case across agents/robots/humans with live tracking; Action Center keeps a human in charge at decision points; every run leaves an audit-ready trace including token usage."*

## 7. Judging, deliverables, bonuses

From [Devpost overview](https://uipath-agenthack.devpost.com/) + [Rules](https://uipath-agenthack.devpost.com/rules). No published weightings; criteria scored 1–5.

- **Tracks:** 1 Maestro Case (ours), 2 Maestro BPMN, 3 Test Cloud. One track only; can't enter multiple.
- **Track 1 quote:** *"orchestrates dynamic, exception-heavy business processes using UiPath case management … move work through stages, handoffs between agents, robots, and people, keep humans in charge at key decision points. Agents can be built on UiPath or an external framework."* → validates the hybrid + external LangGraph/Gemini agent.
- **Phase-1 criteria (1–5):** Business Impact & Adoption · Platform Usage (depth across Agent Builder/Maestro/API Workflows/external frameworks) · Technical Execution/Feasibility/Versatility · Completeness of Delivery · Creativity & Innovation. **Phase-2** swaps Completeness for **Presentation**.
- **Deliverables:** Devpost page; **working solution on Automation Cloud, newly built in Studio Web during the window**; **demo video <5 min** (public; running + architecture + orchestration + human involvement); **public GitHub repo, MIT/Apache-2.0**, README with description + UiPath components list + setup/prereqs + **agent-type statement**; **presentation deck** (public link); optional product-feedback form; finalists publish a Community Forum use case.
- **Bonuses:** **Coding-Agent (+2 Platform Usage)** — build via Claude Code + `uip skills install --agent claude`; include prompt log + "Built with Claude Code" section. Best Cross-Platform Integration ($1.5k), Best Demo ($3k), Most Creative ($3k), People's Choice ($500×3, voting Jul 3–30), Best First-Time Builder ($1.5k), Best Product Feedback ($1.5k). **Max two prizes per project.**
- **Dates:** submit by **2026-06-29 23:45 EDT**; judging → Jul 14; finalists ~Jul 23; winners ~Aug 4. Team 1–4. External LLMs / own keys explicitly allowed. **Total pool $50,000** (Grand $8k; Best of Track $5k / runner-up $3k / honorable $2k).

## 8. Gotchas / risks (8-day build)

1. **Labs lead time 3–5 business days** — request today; build tenant-independent work in parallel.
2. Don't use Community/Free (Maestro excluded; ~250 LLM calls/day).
3. **Allocate Agent Builder license day 1** (known blocker).
4. **Enable Process Mining service** (Maestro prerequisite).
5. Maestro **Case is 5 days old**; Process Apps/"Case App" + business-rule task **Preview** — have Action-Center-only HITL fallback.
6. **Gemini via gateway SDK unconfirmed** → BYO-key (`ChatGoogleGenerativeAI` + `GOOGLE_API_KEY`).
7. `gemini-3.1-pro-preview` is a **preview** id; confirm quota with your key; ids differ between Google API and UiPath gateway.
8. **Python 3.11–3.13 only.**
9. Two CLIs, different commands; pack output `.nupkg` vs `.uis`.
10. OpenAPI 3.1 → Connector Builder import not explicitly confirmed; test early; fall back to manual HTTP API Workflows.
11. README must state agent type + list UiPath components (graded).
12. Max 2 prizes; one track.

## Sources

Maestro/Case, coded agents/SDK, CLI/skills, API Workflows/Integration Service, Automation Cloud/Orchestrator, Governance, Hackathon — see inline links above. Primary: docs.uipath.com, uipath.github.io/uipath-python, github.com/UiPath, github.com/uipath/skills, uipath-agenthack.devpost.com, community.uipath.com/agenthack-faq. Secondary (flagged inline): symprio.com blog on coded agents with Gemini.

**Verify first in your tenant:** (1) Gemini via programmatic gateway else BYO-key; (2) Maestro Case + Case App stability; (3) Primero OpenAPI import; (4) Maestro API-workflow task label; (5) self-allocate Agent Builder license.
