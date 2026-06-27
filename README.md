# SWIMS-Connect on UiPath

**An agentic, human-in-the-loop child-protection intake & case-management solution built on UiPath.**
*UiPath AgentHack submission — **Track: UiPath Maestro Case**.*

SWIMS-Connect lets community members file (optionally anonymous) child-protection reports over
WhatsApp in natural language, voice, or images, and lets signed-in social-welfare workers query
and manage their caseload — backed by the **Primero/SWIMS (UNICEF)** case system. A **UiPath
coded conversational agent** (LangGraph + Gemini) does the reasoning and SWIMS writes; a
transport-only WhatsApp adapter carries the conversation.

> Built **with the Claude Code coding agent** + the UiPath skills catalog (`uip skills install --agent claude`).

---

## Status — what works today vs. what's next

**✅ Built & verified end-to-end (against the live SWIMS instance + deployed agent):**
- **Anonymous intake** over WhatsApp (text, **voice note** → transcribe, **image** → vision) →
  consent gate → **real Primero case** with a real Case ID (filed by the `primero_cp` anonymous
  service account).
- **Media attachment** — the original photo/voice note is attached to the created case (as the
  case-owning worker, so Primero authorization is satisfied).
- **Worker secure login** — a worker taps a one-time HTTPS link, signs in to **their own Primero
  account**; the session is stored encrypted and silently renewed.
- **Worker auth-context bridge** — signed-in workers can ask the agent about cases (list, status,
  details) and the agent acts **as that worker**, so **Primero enforces their real role** (a
  blocked action returns a clean "no"). See [Worker auth-context bridge](#worker-auth-context-bridge).

- **UiPath Maestro Case — overdue monitor** (`SWIMSChildProtectionCase/`), **deployed & live**.
  One instance per worker-filed SWIMS case runs five recipient-free SLA clocks (assessment, case
  plan, service referral, follow-up, closure review). The gateway starts an instance per case and,
  when a clock breaches, **confirms against live Primero and nudges the case owner over WhatsApp** —
  done *for* the worker, no subscription. See [Maestro Case overdue monitor](#maestro-case-overdue-monitor).
- **Scheduled & on-demand caseload reports** (13 types) driven through the agent.

**⛔ Deliberately out of scope** (informed by how Primero actually works):
- The case does **not** re-gate the workflow — Primero already blocks advancing an incomplete step,
  so the Maestro stages mirror it read-only rather than duplicating validation.
- **No Action Center / manager-approval routing** — there is no user directory to reach a specific
  manager, and the system serves whoever is signed in. Closure approval stays in the Primero portal;
  the agent simply records the request.

---

## Architecture (live path)

```
WhatsApp (+233541599802)
   │  Baileys adapter (transport only)
   ▼
whatsapp-gateway (Node)
   ├─ deterministic routing: greeting / login / logout / worker-only gating / consent
   ├─ media: Gemini vision (image) / transcription (voice) → text for the agent
   ├─ secure worker login server  (127.0.0.1:18794, public via nginx /login/)
   └─ UiPath TypeScript conversational SDK  ──────────────►  UiPath Automation Cloud
                                                              swims-connect-agent (coded, LangGraph + Gemini)
                                                                ├─ tools → Primero/SWIMS REST (/api/v2)
                                                                └─ auth-context bridge → acts as the signed-in worker
```

- The agent is a **conversational coded agent** (`agent/uipath.json` → `isConversational: true`).
  The gateway talks to it with `@uipath/uipath-typescript` — there is **no per-turn StartJobs**.
- A conversational agent only receives the **message text**, so the signed-in worker's session is
  carried by the [auth-context bridge](#worker-auth-context-bridge), not by agent input.
- Full notes: [docs/WHATSAPP-UIPATH-ARCHITECTURE.md](docs/WHATSAPP-UIPATH-ARCHITECTURE.md).

### Worker auth-context bridge

A conversational agent can't be handed a secret per turn, so worker auth flows like this:

1. Worker signs in via the login link → gateway stores their Primero session.
2. On each of that worker's messages the gateway prepends an **opaque, HMAC-signed, sender-bound,
   short-TTL token** `[SWIMS_CTX …]` (and strips any the user typed, anti-spoofing).
3. The agent's first node exchanges that token for the worker's session at a secret-protected
   gateway endpoint (`POST /login/session-context`), puts the session in **graph state** (so it
   reaches tools via `InjectedState`), and **strips the token before the LLM sees it**.
4. Every tool acts as that worker → **Primero enforces the role**. No SWIMS cookie ever touches
   the LLM context.

### Maestro Case overdue monitor

A UiPath Maestro Case (`SWIMSChildProtectionCase/`) is the per-case orchestration of record
for SWIMS workflow deadlines. It is deliberately catalog-free — only stages, `wait-for-timer` tasks,
and **recipient-free SLA clocks** (no connectors, agents, or Action Center).

- **The case is the clock; the gateway is the precise judge + messenger.** Maestro timers/SLAs can't
  bind to a per-instance variable date, so the case runs fixed SWIMS-policy clocks (assessment 3d,
  case plan 14d, referral 7d, follow-up 30d, closure review 90d). The gateway reads Primero's *exact*
  due dates and only nudges after confirming a step is genuinely outstanding.
- **Lifecycle (gateway, `src/case-monitor.js` + `src/maestro-client.js`):** when a signed-in worker
  files a case, the gateway starts one instance (Orchestrator `StartJobs`); a 30-min tick prunes
  terminal instances and, ≤ once per case per 24 h, asks the agent to check live Primero and — if a
  step is overdue and the owner is signed in — sends the owner a WhatsApp heads-up.
- **Deploy:** the `uip` CLI can't deploy here (App-token has no user → 401 on Maestro/Studio Web).
  Deployment is **PAT-REST** instead (user-context): upload package → create CaseManagement release
  in `Shared` → start instances via `StartJobs`; PIMS (`pims_/api/v1`) for reads/cancel using the
  `x-uipath-folderkey` header. Configure with `SWIMS_MAESTRO_MONITOR` / `SWIMS_MAESTRO_RELEASE_KEY` /
  `SWIMS_MAESTRO_FOLDER_KEY` in `whatsapp-gateway/.env`.

---

## UiPath components used

| Component | Role |
|---|---|
| **Coded conversational agent** (Python, LangGraph) | Intake + extraction + voice/image understanding + SWIMS reads/writes; model from the `SWIMS_GEMINI_MODEL` asset (currently **gemini-2.5-pro**, bring-your-own Google key) |
| **UiPath TypeScript conversational SDK** | The gateway's only runtime path to the agent (`@uipath/uipath-typescript`) |
| **UiPath Orchestrator** | Process/release for `swims-connect-agent`; **Text/Secret assets** for Gemini key, Primero creds, default owner, and the bridge secret/URL; jobs & agent traces |
| **UiPath Maestro Case** (`SWIMSChildProtectionCase/`) | **Deployed** overdue monitor — 5 recipient-free SLA clocks per case; gateway starts instances (Orchestrator `StartJobs`) + reads/cancels (PIMS), nudging the owner on overdue steps |
| **Baileys channel adapter** | Transport-only WhatsApp link for the configured number (`WHATSAPP_BOT_NUMBER`) |

**Agent type:** combination (coded LangGraph/Gemini agent + deployed Maestro Case overdue monitor) — **built with Claude Code**.

---

## Prerequisites

- **UiPath Automation Cloud** tenant (this build: org `hackathon26_895`, tenant `DefaultTenant`, folder `Shared`).
- **Python 3.11+** and **Node.js 22+** (`uipath` Python CLI ≥ 2.11, `uip` Node CLI for skills).
- A **Google API key** (Gemini).
- A reachable **Primero/SWIMS** backend at `/api/v2` + service-account credentials.
- **nginx** fronting the gateway's login/bridge server publicly (see [Operations](#operations)).

---

## Configuration

Config lives in **`.env`** (repo root — read by both the agent locally and the gateway) and
**`.env.uipath`** (UiPath PAT for the Python CLI / REST). Copy the templates and fill them in:

```bash
cp .env.example .env                  # GOOGLE_API_KEY, PRIMERO_*, UIPATH_*, SWIMS_BRIDGE_*
# .env.uipath holds the user-context PAT used by `uipath` CLI + admin REST (gitignored)
```

In the **tenant**, the agent reads its settings from **Orchestrator assets** in folder `Shared`
(not from `.env`). Create these once:

| Asset | Type | Example |
|---|---|---|
| `SWIMS_GOOGLE_API_KEY` | Secret | *(your Gemini key)* |
| `SWIMS_GEMINI_MODEL` | Text | `gemini-2.5-pro` |
| `SWIMS_PRIMERO_API_BASE_URL` | Text | `https://swims.ownaradio.com/api/v2` |
| `SWIMS_PRIMERO_ANON_USERNAME` / `_PASSWORD` | Secret | `primero_cp` / *(pwd)* |
| `SWIMS_PRIMERO_DEFAULT_OWNER` | Text | `swims_dsw_western` |
| `SWIMS_BRIDGE_URL` | Text | `https://swims.ownaradio.com/login/session-context` |
| `SWIMS_BRIDGE_SECRET` | Text/Secret | *(matches `SWIMS_BRIDGE_SECRET` in `.env`)* |

> Secrets never live in the repo (`.env*` are gitignored). The anonymous account `primero_cp` has
> a create-only role (it **cannot close** cases — closing requires a worker/manager).

---

## Deploy (coded agent → Orchestrator)

```bash
python3 -m venv .venv
./.venv/bin/pip install uipath uipath-langchain langchain-google-genai requests python-dotenv

cd agent
# bump the version in pyproject.toml first (e.g. 0.1.12 → 0.1.13)
set -a && . ../.env.uipath && set +a          # UiPath auth for the Python CLI
../.venv/bin/uipath pack                       # build the .nupkg (.uipath/)
../.venv/bin/uipath publish --tenant           # publish to the tenant feed
```

Publishing adds the package version; point the **process/release** at it
(Orchestrator → Processes → *swims-connect-agent* → update to the new version, or via the
`UpdateToLatestPackageVersion` OData action). The gateway re-resolves the release within ~60 s and
starts new conversations on the new version automatically.

---

## Start (WhatsApp gateway)

```bash
cd whatsapp-gateway
npm install

# detached (survives the shell), logging to state/gateway.log:
setsid bash -c 'exec node src/index.js >> state/gateway.log 2>&1' < /dev/null &
```

### Linking a WhatsApp number (env-driven)

The number to link is **`WHATSAPP_BOT_NUMBER`** in `whatsapp-gateway/.env`. On first run (no saved
session) the gateway requests a **pairing code** and prints it to `state/gateway.log`:

```
=== Link WhatsApp +<number> ===
On that phone: WhatsApp → Settings → Linked Devices → Link a device →
"Link with phone number instead" → enter this code:

    XXXX-XXXX
```

Enter that code on the target phone. To watch for it: `grep -a "pairing code issued" state/gateway.log`.

- **Switch numbers** — edit `WHATSAPP_BOT_NUMBER` and restart the gateway. A saved session bound to a
  *different* number is cleared automatically, and the new number is paired fresh.
- **QR instead of a code** — set `WHATSAPP_USE_PAIRING_CODE=false`; the QR prints to the log and
  `state/wa-qr.png` (scan via WhatsApp → Linked Devices → Link a device).
- **Unlinking auto-recovers** — a `device_removed`/logout clears the session and issues a fresh code
  on its own (no manual cleanup).
- Pairing creds persist in `state/auth/` (no re-link on normal restart).
- Worker-login + bridge server listens on `127.0.0.1:18794`; health: `https://swims.ownaradio.com/health`.
- Restart = `pkill -f "node src/index.js"`, then run the detached command again.

---

## Run & test

```bash
# Agent locally (no tenant; hits Primero directly) — anonymous intake:
./.venv/bin/python agent/run_local.py "A 12-year-old boy is working in a mine in Tarkwa."

# Gateway unit tests:
cd whatsapp-gateway && npm test

# Cloud end-to-end (drives the DEPLOYED agent through the conversational SDK):
node scripts/e2e_conversation.mjs    # anonymous report → real Case ID
node scripts/e2e_image_case.mjs      # image → vision → case + attached photo
node scripts/worker_bridge_e2e.mjs   # worker login → role-scoped case list + details (auth bridge)
```

---

## Operations

**nginx** (host `swims.ownaradio.com`, TLS via certbot) routes:

| Path | Upstream | Purpose |
|---|---|---|
| `/login/`, `/login`, `/login/session-context`, `/health` | `127.0.0.1:18794` | gateway login server + auth-context resolver |
| `/` (everything else) | `127.0.0.1:3000` | Primero/SWIMS API |

- Gateway logs: `whatsapp-gateway/state/gateway.log`. Live PID: `state/gateway.pid`.
- Inspect tenant jobs/assets/traces with the PAT (`.env.uipath`) against
  `https://staging.uipath.com/{org}/DefaultTenant/orchestrator_` (header `X-UIPATH-OrganizationUnitId: <folderId>`).

---

## Repository layout

```
agent/                     Python LangGraph conversational coded agent (Gemini)
  graph.py                 entrypoint + auth node (resolves the bridge token → worker session)
  tools.py                 create_case / get_case / list_cases / lifecycle tools (InjectedState)
  primero.py               Primero REST client (Devise auth, CSRF, case-id resolution)
  prompts.py concerns.py collation.py   prompt, concern vocabulary, service directory
  run_local.py             local harness (no UiPath runtime)
whatsapp-gateway/          Node Baileys adapter + login/bridge server
  src/index.js             message loop + routing + media + attachment
  src/uipath-client.js     conversational SDK driver + bridge-token minting
  src/auth-server.js       login link UI + POST /login/session-context resolver
  src/bridge.js            HMAC token mint/verify + anti-spoof strip
  src/primero-client.js    gateway-side Primero client + SessionManager (anon/worker/owner)
  src/maestro-client.js    Maestro runtime client (StartJobs + PIMS, via the user PAT)
  src/case-monitor.js      overdue monitor: start instance per case → poll → nudge owner
  scripts/*.mjs            end-to-end test harnesses
SWIMSChildProtectionCase/  UiPath Maestro Case — overdue monitor (caseplan.json), DEPLOYED via PAT-REST
docs/                      architecture, lifecycle contracts, source inventory, Claude Code evidence
sdd.md · ARCHITECTURE.md · IMPLEMENTATION-GUIDE.md · SUBMISSION.md
```

---

## Built with Claude Code

Designed and built with the **Claude Code** coding agent + the official **UiPath skills catalog**:

```bash
uip skills install --agent claude
```

Evidence trail: [docs/BUILT-WITH-CLAUDE-CODE.md](docs/BUILT-WITH-CLAUDE-CODE.md).

## Security & privacy

Handles child-protection data about minors. Secrets (Gemini key, Primero creds, bridge secret)
live only in Orchestrator assets / gitignored `.env*`. The worker's SWIMS password never reaches
the LLM — only an opaque, short-TTL, sender-bound token does, and it is stripped before the model
sees it. Reports can be anonymous; case actions run as the signed-in worker so **Primero enforces
least-privilege** (e.g. closure needs a manager).

## License

[MIT](LICENSE).
