# WhatsApp ↔ UiPath architecture

## Purpose

The WhatsApp number (currently `+233541599802`, set via `WHATSAPP_BOT_NUMBER`) is the public
conversation channel for SWIMS-Connect. A small Baileys adapter (`whatsapp-gateway`) links the number
via WhatsApp Linked Devices — by default a **pairing code** printed to `state/gateway.log`
(number-driven: change the env var + restart to link a different number; QR fallback via
`WHATSAPP_USE_PAIRING_CODE=false`) — and is **transport only**. All reasoning, SWIMS reads/writes, and
the **deployed Maestro Case** overdue monitor run in UiPath Automation Cloud. The gateway drives the
deployed **conversational coded agent** (`swims-connect-agent`) with the **UiPath TypeScript
conversational SDK** (`@uipath/uipath-typescript`).

> There is no per-turn `StartJobs` and no API-trigger/Maestro-Flow hop in the live path — those
> were removed in the conversational-SDK cutover.

## Runtime flow

1. A person messages the gateway number (`+233541599802`).
2. `whatsapp-gateway` normalizes the sender to E.164. Greetings, login/logout, anonymous attempts
   to view cases/reports, and the follow-up-consent reply are handled **deterministically** before
   any LLM call.
2a. If the message has media, the gateway downloads the original bytes to its private state dir.
   Images are described with Gemini vision, voice notes transcribed/classified with Gemini audio;
   the resulting text is what the agent receives. Case-relevant media is held pending until a case
   is created, then attached to the Primero case (as the case-owning worker).
3. If the sender is a **signed-in worker**, the gateway prepends an opaque, sender-bound,
   short-TTL `[SWIMS_CTX <token>]` marker to the message (and strips any the user typed).
4. The gateway sends the turn to the agent over the conversational SDK (one live session per sender).
5. The agent's **auth node** exchanges the token for the worker's Primero session via the gateway's
   `POST /login/session-context` resolver (secret-protected), puts the session in **graph state**,
   and strips the marker so the LLM never sees it. No token → anonymous.
6. The ReAct agent answers / asks intake questions / files a case / lists or reads cases. Worker
   tools act **as that worker** (`InjectedState` carries the session) → Primero enforces the role.
7. The gateway sends the reply to WhatsApp. If a case was created (`swimsCaseId`), it attaches any
   pending media.

## Why the case starts after conversation intake

Not every WhatsApp message is a case. Greetings, incomplete reports, queries, auth, and worker
commands stay conversational. A real Primero case is created only once the agent has enough (and,
for anonymous reports, after the consent gate) — preventing false/duplicate child-protection cases.

## Worker auth-context bridge

A conversational agent only ever receives the **message text** — the SDK does not pass arbitrary
input to the graph, and a session set via a module global does not survive to tool execution in
the hosted runtime. So the worker's session is carried as:

- **Token** (`whatsapp-gateway/src/bridge.js`): `base64url(sender|exp).HMAC(secret)` — opaque,
  sender-bound, short-TTL. Minted per worker turn in `uipath-client.js`; user-typed `[SWIMS_CTX]`
  markers are stripped first (anti-spoof).
- **Resolver** (`auth-server.js`, `POST /login/session-context`): requires `X-Bridge-Auth`
  == `SWIMS_BRIDGE_SECRET` **and** a valid token; returns the freshest worker `{cookie, csrf}`
  (silently re-logging-in if the SWIMS session expired).
- **Agent** (`graph.py` auth node): resolves the token, sets `swims_session` in graph state;
  `tools.py` reads it via `InjectedState` (the ReAct agent uses a custom `state_schema`). Token
  stripped before the LLM.

## Authentication boundaries

- WhatsApp pairing creds: `whatsapp-gateway/state/` (gitignored).
- UiPath SDK bearer + the bridge secret: `.env` / `.env.uipath` (gitignored); the agent reads the
  bridge secret/URL and Primero/Gemini settings from **Orchestrator assets** in the tenant.
- A worker's SWIMS password never reaches the LLM. The gateway returns a one-time HTTPS login link;
  the login handler verifies against SWIMS, stores the encrypted session in
  `whatsapp-gateway/state/sessions`, and renews it silently. Explicit logout removes it.
- Anonymous reporting uses the restricted `primero_cp` service account (create-only, cannot close).
- Anonymous users can report only; case reads/lists/reports require a signed-in worker — gated
  deterministically before the agent and, defensively, by the agent's tools.

## Hackathon alignment

The WhatsApp adapter is an allowed external-SDK transport integration. The agent, tools, SWIMS
writes, and (next) Maestro Case orchestration + Action Center HITL execute through UiPath
Automation Cloud, keeping UiPath as the governance/orchestration layer for the Maestro Case track.
