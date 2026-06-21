# SWIMS-Connect → UiPath — Porting Plan

**Target:** UiPath AgentHack · **Track 1 — UiPath Maestro Case** · Deadline **2026-06-29 23:45 EDT**
**Architecture:** Hybrid — UiPath **Maestro Case** (lifecycle + human-in-the-loop) · **Python coded agent** (LangGraph + Google **Gemini 3.1 Pro**) for conversational intake/extraction · **API Workflows / Integration Service connector** wrapping the Primero REST backend · **AI Trust Layer** + Orchestrator as the governance layer.

This document maps **every component of the source system onto a concrete UiPath artifact**. The source is the existing SWIMS-Connect child-protection assistant (an OpenClaw agent runtime over WhatsApp, model = Gemini 3.1 Pro, backed by Primero/SWIMS + the Collation service directory). The UiPath solution is a **new build** that re-expresses that system on UiPath primitives — keeping the live Primero backend and the Gemini model.

> Legend for the "Effort/Risk" column: 🟢 mechanical · 🟡 real work · 🔴 risk / verify in tenant.

---

## 0. The one-line mental model

| Source layer | Did the thinking about… | UiPath layer that now owns it |
|---|---|---|
| OpenClaw agent loop + prompts | *What to do next, what to say* | **Python coded agent** (LangGraph, Gemini) — conversational intake & extraction only |
| The implicit case lifecycle in the prompts/tools | *Stages, handoffs, who's allowed to do what* | **Maestro Case** (stages, entry/exit, SLAs, case/stage-manager agents) |
| Confirm-before-write, manager-only close, worker login | *Human checkpoints* | **Action Center** tasks + Maestro **User tasks** |
| 34 `swims-*.js` CLI tools over Primero REST | *How to actually read/write Primero* | **Integration Service connector** (from Primero OpenAPI) + **API Workflows** |
| Scheduled reports (systemd timer) | *Recurring nudges to workers* | **Orchestrator time triggers** → report process/agent |
| Teams mirror, WhatsApp channel | *Where humans interact* | **Action Apps / Action Center** (primary) + optional channel connectors |
| AES creds, redaction, anti-leak prompt | *Security/governance* | **AI Trust Layer** (PII masking, guardrails, audit) + **Orchestrator assets** |

The key architectural shift: **orchestration moves out of the prompt and into Maestro.** In the source, the LLM decides the whole workflow. On UiPath, Maestro owns the lifecycle/handoffs/SLAs and the LLM agent is just one actor it calls for the language-heavy steps. This is exactly what Track 1 rewards ("keep humans in charge at key decision points; agents can be built on UiPath or an external framework").

---

## 1. Runtime & model

| Source | UiPath target | Notes | Effort/Risk |
|---|---|---|---|
| OpenClaw runtime (`openclaw` npm), gateway `:18791` | **UiPath Automation Cloud** (Maestro + Orchestrator) + **Automation Cloud Robots – Serverless** runs the coded agent | No long-running gateway to host; UiPath runs everything | 🟡 |
| Model `google/gemini-3.1-pro-preview` (fallback `gemini-2.5-flash`), thinking=low | **Gemini 3.1 Pro via BYO-key** in the coded agent: `ChatGoogleGenerativeAI` (`langchain-google-genai`) + `GOOGLE_API_KEY` from an **Orchestrator Credential/Secret asset** | BYO-key is the de-risked path. UiPath LLM Gateway *lists* `gemini-3.1-pro-preview`, but programmatic gateway selection of Gemini is **unverified** — test, else use BYO-key. Keep `gemini-2.5-flash` as a LangGraph fallback. | 🔴 verify |
| `thinkingConfig.thinkingLevel` per model | LangGraph model kwargs on `ChatGoogleGenerativeAI` | Map thinking budget to Gemini params | 🟢 |
| Agent identity (SWIMS-Connect 🛡️, tone) | Coded-agent **system prompt** (ported from `IDENTITY.md` + `AGENTS.md`) | See §4 | 🟢 |
| OpenClaw `memory_search` (local) + `swims-conversation-history.js` | Maestro **case entity / data store** holds conversation + case context across stages; per-turn history passed into the agent | The case *is* the memory now | 🟡 |

---

## 2. The case lifecycle → Maestro Case stages

The source encodes the lifecycle in prompts + the `workflow` field on each Primero case. In Maestro it becomes **explicit stages** with entry/exit criteria, SLAs, and per-stage actors.

| Source stage (`workflow` value) | Maestro Case **stage** | Tasks in the stage (actor) | Human checkpoint |
|---|---|---|---|
| Intake (`new`) | **Intake** | *Start & wait for agent* → coded agent extracts fields from text/voice; *API workflow* → `create case`; *agent* → attach media | Anonymous path: consent-to-contact gate. Worker path: confirm before create. |
| `assessment` | **Assessment** | *agent* drafts assessment; *API workflows* → fill assessment / safety plan / safety intervention / open assessment stage | Worker-authenticated; confirm-before-write |
| `case_plan` | **Case Plan** | *API workflows* → open case-plan stage, add/update interventions | Worker-authenticated |
| `service_provision` | **Service Referral** | *agent* → find provider (Collation); *API workflows* → add/update service | Worker-authenticated |
| `services_implemented` | **Service Delivery** | *API workflow* → mark service implemented (stage advances only when all delivered) | Worker-authenticated |
| (cross-stage) | **Follow-up** (secondary stage / loopable) | *API workflows* → schedule/log follow-up | Worker-authenticated |
| `closed` | **Closure** | *User task* → manager approval; *API workflow* → close case **or** request closure approval | **Manager-only** (CLOSE permission). Worker → 403 → routes to closure-approval User task. Anonymous → blocked. |

**Exception handling (Track 1's core ask):** model the source's "403 → escalate", "one action per request", and "missing required field → ask" as Maestro **rework loops + exit criteria + SLA escalations**, with the case/stage-manager agents choosing the next task at runtime rather than a fixed BPMN sequence.

---

## 3. Tool inventory → UiPath integration layer

All 34 source tools call Primero REST (`/api/v2`, native Devise cookie + `X-CSRF-Token` auth) or the Collation directory. **Strategy:** build **one Integration Service connector for Primero** (generated from its OpenAPI/Swagger spec — auth configured once for all endpoints), then expose **meaningful operations** as **API Workflows** (validation/transform/chaining) consumable as agent tools *and* Maestro Service Tasks. Don't mechanically create one API Workflow per script — group by operation.

> Auth note: the source uses Primero's 3-step Devise session login (`GET /identity_providers` → `POST /tokens` → cookie + CSRF). Replicate this in the connector's auth config (custom/session auth) or in a dedicated "login" API Workflow that the others depend on. **Verify Primero's OpenAPI import fidelity early** (🔴).

### 3.1 Intake / Case CRUD
| Source tool(s) | Primero endpoint | UiPath artifact |
|---|---|---|
| `swims-case-create.js` | POST `/cases` | **API Workflow `case_create`** (input: extracted fields; idempotency key). Invoked by Intake stage. |
| `swims-case-get.js` | GET `/cases/:id` (+ derived tasks) | API Workflow `case_get` |
| `swims-cases-list.js` | GET `/cases` (filters) | API Workflow `cases_list` |
| `swims-tasks-list.js` | GET `/tasks` (fallback derive) | API Workflow `tasks_list` (+ port `lib/swims-tasks.js` derive logic, see §6) |
| `swims-case-attach.js` | POST `/cases/:id/attachments` | API Workflow `case_attach` (handles media; see §5) |
| `swims-case-note.js` | PATCH `/cases/:id` | API Workflow `case_note` |
| `swims-case-close.js` | PATCH `/cases/:id` (status=closed) | API Workflow `case_close` — gated behind manager **User task** |
| `swims-case-request-closure-approval.js` | PATCH `/cases/:id/approvals/closure` | API Workflow `case_request_closure_approval` |

### 3.2 Assessment / Case Plan / Referral / Follow-up (all PATCH `/cases/:id` subforms)
| Source tools | UiPath artifact |
|---|---|
| `swims-assessment-fill.js`, `swims-case-assess.js`, `swims-safety-plan.js`, `swims-safety-intervention.js` | API Workflows `assessment_fill`, `assessment_open`, `safety_plan_add`, `safety_intervention_add` |
| `swims-caseplan-record.js`, `swims-caseplan-intervention.js`, `swims-caseplan-intervention-update.js` | API Workflows `caseplan_open`, `caseplan_intervention_add`, `caseplan_intervention_update` |
| `swims-service-add.js`, `swims-service-update.js`, `swims-service-implement.js` | API Workflows `service_add`, `service_update`, `service_implement` |
| `swims-case-followup.js`, `swims-followup-update.js` | API Workflows `followup_add`, `followup_update` |

> The subform **update-by-`unique_id`** logic (don't append duplicates) must be preserved inside each `*_update` workflow — this is real correctness logic, not boilerplate (🟡).

### 3.3 Lookups / Locations / Service directory
| Source tools | Backend | UiPath artifact |
|---|---|---|
| `swims-lookup.js` | GET `/lookups` | API Workflow `lookups_get` (cache as Orchestrator asset/bucket) |
| `swims-locations.js` | GET `/locations` (anon) | API Workflow `locations_search` |
| `swims-services.js` | Collation directory (3 GETs) | **Second connector or API Workflow `services_find`** (external REST, no auth) — exposed as an agent tool for provider lookup |

### 3.4 Auth / Session (the biggest behavioral re-design)
| Source mechanism | UiPath target | Notes |
|---|---|---|
| One-time login link + `swims-auth-server.js` (`:18792`) → worker logs into Primero, AES-creds stored for silent re-login | **Re-modeled.** On UiPath there is no per-chat worker browser-login. Two options: **(A, recommended for demo)** the solution operates under a **service identity** stored as an Orchestrator **Credential asset**, and "worker" vs "manager" authority is modeled as **Maestro stage permissions + Action Center assignees** (the human approving in Action Center *is* the authenticated worker/manager). **(B)** keep a thin login API Workflow that exchanges worker creds for a Primero session per case. | 🔴 design decision — **A** is far less work and maps cleanly to "humans in charge at decision points." Manager-only close = a manager-assigned Action Center approval task. |
| `swims-whoami.js`, `swims-login*.js`, `swims-logout.js` | Mostly **dropped** under option A; whoami → connector identity check | The chat-login UX doesn't exist in a Maestro/Action Center world |
| `lib/swims-crypto.js` (AES-256-GCM creds) | **Orchestrator Credential/Secret assets** (encrypted at rest by the platform) | Platform replaces hand-rolled crypto |

### 3.5 Reporting
| Source | UiPath target |
|---|---|
| `swims-report-schedule.js` + `swims-report-run.js` + `lib/scheduled-reports.js` (13 report templates) + systemd timer | **Orchestrator time trigger** → a **report process** (coded agent or API Workflow) that runs the same query/filter/format logic and delivers via Action Center / Action App / channel connector. Port the 13 templates' query+format logic into the report process. |
| `lib/swims-tasks.js` `deriveTasks()` (client-side task derivation; Primero `/tasks` 403s) | Port verbatim into `tasks_list` API Workflow / a shared helper — **keep this; it's load-bearing** | 🟡 |

---

## 4. Prompts & skills → coded-agent prompt + LangGraph tools

| Source | UiPath target | Effort/Risk |
|---|---|---|
| `IDENTITY.md` (name, tone, "no final determinations") | Coded-agent **system prompt** header | 🟢 |
| `AGENTS.md` (18.6KB core prompt: intent routing, anti-leak, anti-injection, confirm-before-write, date-before-write, 403→escalate, one-action-per-request) | Split: **behavioral guardrails** → system prompt + **AI Trust Layer guardrails** (PII, prompt-injection, harmful content); **workflow routing** → now largely **Maestro's** job, not the prompt's | 🟡 — deliberately *shrink* the prompt; Maestro owns routing |
| `TOOLS.md` (exec command reference) | Replaced by **LangGraph tool definitions** (`@tool`) that call the API Workflows / connector | 🟢 |
| `SOUL.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md` | Folded into system prompt / dropped (`HEARTBEAT` N/A; `MEMORY` facts → system prompt) | 🟢 |
| Skill `swims-reporting` (intake + worker access flows) | Intake-stage agent behavior + the report process | 🟡 |
| Skill `swims-case-management` (per-stage write flows, lookup-before-dropdown, correction-via-update) | Encoded as **per-stage tools + Maestro stage logic**; lookup-before-dropdown becomes a tool-calling rule | 🟡 |

**Anti-fabrication ("never claim a Case ID without a real write"):** in the source this is a prompt+gateway guard. On UiPath it becomes **deterministic**: the case is only created by the `case_create` **API Workflow**, and the real `case_id_display` flows back as a Maestro variable — the LLM never invents it because it doesn't perform the write.

---

## 5. Media / voice → UiPath

| Source | UiPath target | Effort/Risk |
|---|---|---|
| `swims-transcribe.js` (Gemini ASR + language gating on WhatsApp voice notes) | Coded-agent tool calling **Gemini multimodal** (same model family, BYO-key) for transcription + language classification; or Document Understanding for docs | 🟡 |
| `swims-annotate-image.js` (image → caption) | Gemini multimodal vision in the agent | 🟢 |
| ffmpeg ogg→mp3 in `case-attach` | Inside `case_attach` API Workflow or agent pre-step | 🟡 |
| OpenClaw media preprocessor pipeline | Maestro Intake stage step before the extraction agent | 🟡 |

---

## 6. Shared libraries → ported helpers

| Source `lib/*` | Disposition |
|---|---|
| `swims-client.js`, `swims-auth.js` (Devise login + silent re-login) | Re-implemented as the **connector auth config** / a `login` API Workflow |
| `session-store.js`, `swims-crypto.js` | Replaced by **Orchestrator assets** + Maestro case entity |
| `swims-tasks.js` (`deriveTasks`) | **Ported** into the task API Workflow — keep logic |
| `swims-concerns.js` (free-text → concern codes) | **Ported** into the extraction agent / a small mapping tool |
| `scheduled-reports.js` (13 templates) | **Ported** into the report process |
| `subform-dedup.js` | **Ported** into each `*_update` API Workflow |
| `runtime-paths.js` | Dropped (platform handles paths) |

---

## 7. Channels, hooks, ops

| Source | UiPath target | Effort/Risk |
|---|---|---|
| WhatsApp (Baileys today; Cloud API intended) | **Primary demo surface = Action Center / Action App** (where the human worker/manager acts). Optional: a channel connector or a thin webhook → Orchestrator API trigger for the conversational front-end. **Decide demo surface early** (🔴). | 🔴 |
| Teams mirror hook (Power Automate webhook) | Optional **Integration Service Microsoft Teams connector** notification, or drop for MVP | 🟢 (drop) |
| File logging + `redactSensitive` | **Agent traces** (full input/output, tokens, latency — audit-ready) + AI Trust Layer audit logs | 🟢 |
| Gateway token / loopback bind | N/A (platform-managed) | 🟢 |

---

## 8. What gets dropped, kept, or newly added

**Kept (ported logic):** case lifecycle semantics, all Primero field mappings, `deriveTasks`, concern mapping, subform dedup/update-by-id, the 13 report templates, anti-fabrication (now deterministic), Gemini model + ASR.

**Dropped (platform replaces):** OpenClaw gateway, hand-rolled AES crypto, the per-chat worker login link + auth server, systemd timer, file logger, exec-allowlist sandbox (replaced by typed tools + governance), HEARTBEAT.

**Newly added for UiPath (and for the rubric):** Maestro Case model + case/stage-manager agents, Action Center HITL tasks + an Action App, Integration Service Primero connector, API Workflows, AI Trust Layer governance, Orchestrator triggers/assets, agent traces.

---

## 9. Risk register (verify in the Labs tenant)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Labs tenant lead time 3–5 business days** vs 8-day deadline | Request access **today**; build everything tenant-independent in parallel (coded agent, connector spec, docs, demo script) |
| 2 | Maestro **Case** GA only 2026-06-16 (5 days old); Process Apps/"Case App" + business-rule task still **Preview** | Have a fallback: drive HITL through **Action Center directly**; keep the case model simple |
| 3 | **Gemini via LLM Gateway SDK class unverified** | Use **BYO-key** (`ChatGoogleGenerativeAI` + `GOOGLE_API_KEY` asset) — officially documented path |
| 4 | **Primero OpenAPI → Connector Builder** import fidelity | Test import day 1; fall back to manual HTTP-activity API Workflows if needed |
| 5 | Worker/manager auth model change (no chat login) | Adopt **option A** (service identity + Action Center assignees as the human authority) |
| 6 | Agent Builder "**No license detected**" on Labs | Self-allocate license **day 1** (Admin → Licenses) |
| 7 | Python **3.11–3.13 only** for coded agents | Pin venv |
| 8 | Solution must be **newly built in the submission period, in Studio Web** | All Maestro/agent artifacts authored fresh in this repo + tenant during the window |

See `IMPLEMENTATION-GUIDE.md` for the day-by-day build, exact CLI commands, and code skeletons; `ARCHITECTURE.md` for the target diagram; `SUBMISSION.md` for the rubric/bonus mapping and deliverables checklist.
