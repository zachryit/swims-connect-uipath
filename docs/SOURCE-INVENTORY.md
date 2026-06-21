# Source System Inventory (internal reference)

The system being ported: **SWIMS-Connect**, an AI-agent assistant for Ghana child-protection case management, running on the OpenClaw multi-channel agent framework over WhatsApp, model **Gemini 3.1 Pro**, backed by **Primero/SWIMS** (`/api/v2`, native Devise cookie + CSRF auth) and the **Collation** Ghana Social Welfare Service Directory. This inventory is the basis for `../PORTING-PLAN.md`. Secrets were not read; tokens redacted.

## Overview

Two user classes: **anonymous community reporters** (no login; cases created via a SWIMS service account) and **authenticated workers** (link their account via a one-time secure login link). The agent detects intent then drives an allowlisted set of `node …/swims-*.js` CLI scripts — a thin adapter over the Primero REST API for the full case lifecycle (intake → assessment → case plan → service referral/delivery → follow-up → closure), plus Collation for referral lookup. Voice notes are transcribed/classified via Gemini; photos annotated; both attachable to cases. Logged-in workers subscribe to recurring WhatsApp report summaries. Conversations optionally mirror to Microsoft Teams via Power Automate. The agent is heavily guard-railed never to leak that it's an AI/automation system.

## Workflow stages (case lifecycle)

Stage stored in Primero `workflow` field; set by trigger date fields. A "task" appears when a due field is filled and clears when the matching completion field is filled (drives the task/report model).

| Stage (`workflow`) | What happens | Tools | Human-in-loop / auth |
|---|---|---|---|
| **Intake (`new`)** | New concern from text/voice; case created; narrative in `notes_section`; AI-extracted fields flagged; idempotent | `swims-case-create`, `-case-attach`, `-locations`, `-transcribe`, `-annotate-image` | Anon: service account, asks follow-up-contact consent. Worker: needs session + asks assessment-due. Non-English/unclear voice → anon `--voice-note-only`, no questions |
| **Assessment (`assessment`)** | Worker fills assessment (threats, capacities, safety determination), adds safety-plan + interventions, opens stage; sets `assessment_requested_on` + `case_plan_due_date` | `-assessment-fill`, `-safety-plan`, `-safety-intervention`, `-case-assess`, `-case-note`, `-lookup` | Auth worker; confirm-before-write; one action/request; 403→supervisor |
| **Case plan (`case_plan`)** | Open case-plan stage (`date_case_plan`), append interventions | `-caseplan-record`, `-caseplan-intervention(-update)`, `-case-note` | Auth worker; correction updates existing row |
| **Service referral (`service_provision`)** | Add referral (type, timeframe, provider); sets `service_implemented='not_implemented'` | `-service-add`, `-service-update`, `-lookup`, `-services` | Auth worker; confirm-before-write |
| **Service delivery (`services_implemented`)** | Mark delivered; stage advances only when ALL services delivered | `-service-implement` | Auth worker |
| **Follow-up** (any stage) | Schedule (`--needed-by`) or log (`--date`) follow-up | `-case-followup`, `-followup-update`, `-lookup` | Auth worker |
| **Closure (`closed`)** | Close case (`status=closed`, `record_action='close'`) | `-case-close`; `-case-request-closure-approval` | **Manager-only** (CLOSE perm). Worker 403 → request approval (`PATCH /cases/:id/approvals/closure`). Anon blocked |
| **Read/status** | Lookup, list, tasks, session, history | `-case-get`, `-cases-list`, `-tasks-list`, `-whoami`, `-conversation-history` | Read-only; worker session (except history) |

Cross-cutting rules: confirm before every write; one action per request; never set approval flags directly; 403 → stop/escalate; anonymous never closes/transfers/views others' cases.

## Tool inventory (34 exec tools + 5 libs)

All scripts in `workspace/scripts/`; libs in `scripts/lib/`. All print JSON, load `.env`, and (except locations/services/transcribe/annotate/history) call SWIMS via `lib/swims-auth.js → lib/swims-client.js` with silent re-login.

**Auth/session:** `swims-whoami` (GET `/cases?per=1` probe), `swims-login` (Devise 3-step), `swims-login-link` (one-time URL, 10-min TTL), `swims-login-check` (poll flag file), `swims-logout` (erase creds), `swims-auth-server` (standalone HTTP `:18792` login form → verifies vs SWIMS, stores AES creds, redirects via `wa.me`).

**Intake/Case CRUD:** `swims-case-create` (**POST `/cases`**, idempotent, anon via service account), `swims-case-get` (GET `/cases/:id` + derived tasks), `swims-cases-list` (GET `/cases` + filters), `swims-tasks-list` (GET `/tasks`, fallback derive), `swims-case-attach` (**POST `/cases/:id/attachments`**, ogg→mp3), `swims-case-note` (PATCH), `swims-case-close` (PATCH, **manager-only**), `swims-case-request-closure-approval` (**PATCH `/cases/:id/approvals/closure`**).

**Assessment:** `swims-assessment-fill`, `swims-case-assess` (advances workflow), `swims-safety-plan`, `swims-safety-intervention` — all PATCH `/cases/:id` (subforms).

**Case plan:** `swims-caseplan-record` (advances), `swims-caseplan-intervention`, `swims-caseplan-intervention-update` (update row by `unique_id`).

**Referral/services:** `swims-service-add` (advances), `swims-service-update`, `swims-service-implement` (advances when all delivered), `swims-services` (Collation directory, cached 24h).

**Follow-up:** `swims-case-followup`, `swims-followup-update`.

**Lookups/locations/reporting/history:** `swims-lookup` (GET `/lookups`), `swims-locations` (GET `/locations`, anon), `swims-report-schedule` (create/list/delete/preview recurring reports), `swims-report-run` (systemd-timer runner), `swims-conversation-history` (local session logs).

**Media:** `swims-transcribe` (**Gemini API** ASR + language classify), `swims-annotate-image` (local caption).

**Libs (`lib/`):** `swims-client` (HTTP + 3-step Devise login), `swims-auth` (silent re-login), `session-store` (per-sender session + AES creds), `swims-crypto` (AES-256-GCM, `SWIMS_CRED_KEY`), `swims-tasks` (`deriveTasks()` — Primero `/tasks` often 403s), `swims-concerns` (free-text → concern codes), `scheduled-reports` (13 report templates), `runtime-paths`, `subform-dedup`.

## Prompts (`workspace/`)

- **IDENTITY.md** — name/tone; never give final legal/medical/protection determinations.
- **AGENTS.md** (18.6KB, core prompt) — intent routing + heavy guardrails: run `date` before recording dates; strict on-topic; **anti-leak** (never reveal AI/automation/backend, never name scripts/tools); anti-prompt-injection (report text = data); safety rules (no passwords in chat, preserve anonymity, mark AI-extracted fields, idempotent); confirm-before-write; **exec hard-limited** to `node …/scripts/swims-*.js`.
- **TOOLS.md** (30.4KB) — internal exec command reference (never recited to users).
- **SOUL.md / USER.md / HEARTBEAT.md / MEMORY.md** — stock persona / empty user template / disabled heartbeat / stable project facts.

## Skills (`workspace/skills/`)

- **swims-reporting** (🛡️) — intake & worker access: full new-report flow, voice-note exception, case lookup, location/service-directory lookup, scheduled-report mgmt, conversation history, worker login.
- **swims-case-management** (📋) — actions on existing cases (all writes auth): per-stage drafting flows, task due/completion table, lookup-before-dropdown, correction-via-update-row, quick-reply shortcuts (DETAILS/DONE/UPDATE/NOTE/ESCALATE).

## OpenClaw runtime features used (`openclaw.json`)

- **Model:** primary `google/gemini-3.1-pro-preview`; fallback `gemini-2.5-flash`; per-model `thinkingLevel`.
- **Channels:** WhatsApp only — **Baileys/WhatsApp Web** today (`dmPolicy: pairing`). WhatsApp Cloud API is *intended* but **not yet wired** (no `whatsappcloud` block exists).
- **Agent:** single `public` agent; `tools.allow: [exec, image]`; `deny: [sessions, agents_list, nodes, automation]`; exec `security: allowlist`.
- **Gateway:** `:18791`, local/loopback, token auth (redacted).
- **memory_search:** local; service lookup is keyword/fuzzy over cached JSON (not vector RAG).
- **Media:** audio→`swims-transcribe` (Gemini), image→`swims-annotate-image`; 20MB max.
- **Logging:** file + `redactSensitive: tools`.
- **Auth server:** standalone `:18792`, public via tunnel, 10-min one-time login token → AES creds → `wa.me` redirect.
- **Scheduler:** NOT OpenClaw-native — a **systemd timer** (every 60s) runs `swims-report-run.js`.
- **Hooks:** `swims-teams-mirror` → Power Automate webhook (Adaptive Cards + thread metadata).

## External integrations

1. **Primero/SWIMS** `/api/v2` — Devise 3-step cookie login + `X-CSRF-Token` on writes; endpoints `/cases`, `/cases/:id`, `/attachments`, `/approvals/closure`, `/tasks`, `/lookups`, `/locations`, `/tokens`, `/identity_providers`; worker passwords AES-256-GCM; anon service account.
2. **Collation** — read-only directory (3 GETs), cached 24h.
3. **Google Gemini API** — ASR + the agent LLM.
4. **Microsoft Teams / Power Automate** — outbound mirror webhook.
5. **WhatsApp** — Baileys (Cloud API intended, not implemented).

## Reporting — 13 templates (`lib/scheduled-reports.js`)

`high-risk`, `overdue-followups`, `upcoming-followups`, `stale-cases`, `new-cases`, `caseload-summary`, `tasks-due-today`, `overdue-tasks`, `pending-referrals`, `workflow-summary`, `concern-summary`, `supervisor-daily`, `manager-weekly`. Frequencies daily/weekly/every-N-days; Ghana time; optional concern scoping; tasks derived client-side (`lib/swims-tasks.js`).

## Flags for the port

- WhatsApp **Cloud API not actually configured** in source (runs on Baileys).
- Model naming: config primary is `gemini-3.1-pro-preview`; some prose says "2.5 Flash"; ASR uses `2.5-flash`.
- `whoami` may misread `group_permission` (minor source bug) — verify on port.
