# SWIMS-Connect coded agent (LangGraph + Gemini)

The UiPath **conversational coded agent** for SWIMS-Connect. A LangGraph ReAct agent on
**Google Gemini** (model from the `SWIMS_GEMINI_MODEL` asset — currently `gemini-2.5-pro`,
bring-your-own key) turns a natural-language / transcribed-voice / image-described
child-protection report into a structured **SWIMS/Primero** case (returning the **real Case ID**),
and lets a signed-in worker query/manage cases **as themselves** (Primero enforces their role).

Deployed as `swims-connect-agent`; `uipath.json` sets `isConversational: true`. The WhatsApp
gateway drives it via the UiPath TypeScript conversational SDK.

## Files
| File | Role |
|---|---|
| `graph.py` | Entry `graph.py:graph` — Gemini + ReAct; **auth node** resolves the `[SWIMS_CTX]` bridge token → worker session, puts it in graph state, strips it before the LLM |
| `tools.py` | LangChain tools: `create_case`, `get_case`, `list_cases`, `find_services`, and lifecycle (`record_assessment`/`record_case_plan`/`add_service_referral`/`mark_service_delivered`/`record_followup`/`close_case`). Worker tools read the session from state via `InjectedState` |
| `primero.py` | Primero REST client (Devise 3-step auth, response-order CSRF, short-id→UUID resolution, case-create field mapping) |
| `prompts.py` | System prompt (intake/extraction + scope/safety; ignores `[SWIMS_CTX]` markers) |
| `concerns.py` | SWIMS protection-concern vocabulary + free-text → code mapping |
| `collation.py` | Ghana social-welfare service directory lookup (`find_services`) |
| `run_local.py` | Local test harness (no UiPath runtime needed) |
| `langgraph.json`, `pyproject.toml`, `uipath.json` | UiPath coded-agent project files |

## Auth model
- **Anonymous reporting** needs no session (uses the `primero_cp` service account).
- **Worker** actions: the gateway prepends an opaque, sender-bound, short-TTL `[SWIMS_CTX <token>]`
  to the message; the auth node exchanges it (at `SWIMS_BRIDGE_URL`, secret `SWIMS_BRIDGE_SECRET`)
  for the worker's Primero `{cookie, csrf}` and carries it in **graph state** so tools act as that
  worker. Conversational agents only receive message text — this is the only reliable channel.

## Run locally (no tenant)
```bash
# from repo root, after creating .venv and a repo-root .env (GOOGLE_API_KEY, GEMINI_MODEL, PRIMERO_*)
./.venv/bin/python agent/run_local.py "A 12-year-old boy is working in a mine in Tarkwa."
```
Locally the tools call Primero directly; in the tenant the agent loads `SWIMS_*` Orchestrator
assets (incl. `SWIMS_BRIDGE_URL`/`SWIMS_BRIDGE_SECRET`).

## Deploy
```bash
# bump version in pyproject.toml, then:
set -a && . ../.env.uipath && set +a
../.venv/bin/uipath pack
../.venv/bin/uipath publish --tenant
# point the process/release at the new package version (Orchestrator → Processes)
```

## Status
✅ Verified end-to-end against the live Primero backend **and the deployed agent**: anonymous
NL/voice/image report → real `case_id_display`; signed-in worker → role-scoped `list_cases` /
`get_case` acting as the real worker (auth-context bridge). See the cloud E2E harnesses in
`../whatsapp-gateway/scripts/`.

## Next (in-tenant)
Wire the created case into the **Maestro Case** (`../SWIMSChildProtectionCase/`) for the
assessment → case-plan → service → closure lifecycle, with Action Center approval for closure.
