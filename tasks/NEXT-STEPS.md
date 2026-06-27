# SWIMS-Connect → UiPath — resume handoff

_Updated 2026-06-24. Deadline: AgentHack **2026-06-29 23:45 EDT**. Track: **UiPath Maestro Case**._

## DONE & PROVEN (the core works end-to-end)

The coded agent is **live on UiPath Automation Cloud** and files real SWIMS cases. Every link proven:
`WhatsApp → gateway (Baileys) → cloud agent job → real SWIMS case → agent reply w/ case ID`.

- **Agent** (`agent/`, Python LangGraph, Gemini): 10 tools — `create_case`, `get_case`, `list_cases`,
  `find_services` (Collation directory, live + bundled snapshot `agent/data/collation_snapshot.json`),
  and the 6 lifecycle ops. Acting-user auth (`swims_session` input → auth node → tools; Primero owns roles).
  Anonymous reports route ownership to `PRIMERO_DEFAULT_OWNER` so an authorised worker can act.
- **Deployed**: `swims-connect-agent 0.1.3` published + released into `Shared`.
  Release key `62d451f2-7ccb-4302-8841-826083aedf87`; Shared folder Id `3141212`.
- **Primero exposed**: `https://swims.ownaradio.com` (nginx vhost clone of brokergh.com + certbot;
  Rails host allowlist in `/opt/primero/config/initializers/swims_staging_hosts.rb`; svc `primero-staging.service`).
- **Orchestrator assets** (Shared): `SWIMS_PRIMERO_API_BASE_URL=https://swims.ownaradio.com/api/v2`,
  `SWIMS_GEMINI_MODEL=gemini-3.1-pro-preview`, `SWIMS_PRIMERO_DEFAULT_OWNER=swims_dsw_western`,
  secrets `SWIMS_GOOGLE_API_KEY` / `SWIMS_PRIMERO_ANON_USERNAME` (primero_cp) / `SWIMS_PRIMERO_ANON_PASSWORD` (primer0!).
  **Asset WRITES need the PAT via REST** (External App is read-only). Secret value field = `SecretValue` (credential store 969362).
- **Seeded Primero accounts** (all `primer0!`, from `/opt/primero/db/.../default_users.rb` + `swims_connect.rb`):
  anon `primero_cp`, worker `swims_dsw_western` (CP Case Worker), manager `swims_supervisor` (CP Manager) — same "Primero CP" group.

## AGENT INVOCATION CONTRACT (the gateway uses this)
StartJobs `{startInfo:{ReleaseKey, Strategy:"ModernJobsCount", JobsCount:1, InputArguments: json({messages:[...], swims_session:{cookie,csrf}|null})}}`
→ poll `Jobs?$filter=Key eq <key>` until `Successful` (~45s) → reply via `sdk.jobs.extract_output(job)` (output is a job **attachment**),
parse `{messages}`, take the **last message's text**. Verified: reply included the real case ID.

## NEXT (recommended order)
1. **WhatsApp gateway → agent** (`whatsapp-gateway/`): rewrite `src/uipath-client.js` `turn()` to (a) keep per-sender
   conversation history, (b) resolve the sender's SWIMS session through the login link at
   `swims.ownaradio.com/login`, (c) invoke the agent per the contract above, and (d) return the reply.
   `src/index.js` (Baileys loop) already calls `client.turn()` → sends reply. **Recommended:** a thin Python invoke-relay
   (uses the proven SDK extract_output) that the Node gateway POSTs to — keeps SWIMS logic in the UiPath agent. Pair the
   number `+233256590242` via Linked-Devices QR (`config.qrPath`).
2. **Maestro Case** (`SWIMSChildProtectionCase/.../caseplan.json`): stages → **agent tasks** invoking the deployed agent
   (NO Action Center — Primero's role gate IS the approval; do not force it). Blocker: resolving the agent's Maestro
   registry node needs user-scoped Resource Catalog read — may require a PAT re-mint WITH that scope (current PAT lacks it;
   node CLI can't use the PAT anyway since it needs a JWT, not the opaque `rt_` token).
3. **Solution** pack + publish; end-to-end smoke test.
4. **Submission**: ≤5-min demo video (solution running), public GitHub README (UiPath components + "uses coding agents"), deck.

## DON'T
- Don't force hackathon features that don't fit (Action Center here). Don't drop integral things without reading `.swimsbot`.
- Don't reimplement SWIMS logic outside UiPath — the agent is the system; gateway/relay are transport only.
