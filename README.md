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

**🚧 Scaffolded / next (project present, not yet wired into the live flow):**
- **UiPath Maestro Case** orchestration of the full lifecycle (intake → assessment → case plan →
  service referral → delivery → closure) — the project is in `SWIMSChildProtectionCase/`.
- **Action Center** human-in-the-loop approval (e.g. manager-only case closure).
- Scheduled caseload reports via Orchestrator triggers.

---

## Architecture (live path)

```
WhatsApp (+233256590242)
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

---

## UiPath components used

| Component | Role |
|---|---|
| **Coded conversational agent** (Python, LangGraph) | Intake + extraction + voice/image understanding + SWIMS reads/writes; model from the `SWIMS_GEMINI_MODEL` asset (currently **gemini-2.5-pro**, bring-your-own Google key) |
| **UiPath TypeScript conversational SDK** | The gateway's only runtime path to the agent (`@uipath/uipath-typescript`) |
| **UiPath Orchestrator** | Process/release for `swims-connect-agent`; **Text/Secret assets** for Gemini key, Primero creds, default owner, and the bridge secret/URL; jobs & agent traces |
| **UiPath Maestro Case** (`SWIMSChildProtectionCase/`) | Case-lifecycle orchestration — scaffolded; next to wire in |
| **Baileys channel adapter** | Transport-only WhatsApp link for +233256590242 |

**Agent type:** combination (coded LangGraph/Gemini agent + planned low-code Maestro Case) — **built with Claude Code**.

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

# foreground (first run prints a QR — scan it from WhatsApp on +233256590242):
node src/index.js

# detached (survives the shell), logging to state/gateway.log:
setsid bash -c 'exec node src/index.js >> state/gateway.log 2>&1' < /dev/null &
pgrep -f "node src/index.js" > state/gateway.pid
```

- Pairing creds persist in `state/auth/` (no re-scan on restart). QR (if needed) → `state/wa-qr.png`.
- Worker-login + bridge server listens on `127.0.0.1:18794`; health: `https://swims.ownaradio.com/health`.
- Restart = stop the PID in `state/gateway.pid`, then run the detached command again.

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
  scripts/*.mjs            end-to-end test harnesses
SWIMSChildProtectionCase/  UiPath Maestro Case project (caseplan + WhatsAppConversation flow) — scaffolded
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
