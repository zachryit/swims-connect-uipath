# SWIMS-Connect coded agent (LangGraph + Gemini)

The UiPath **coded agent** for the intake/extraction half of the solution. A LangGraph ReAct
agent on **Google Gemini 3.1 Pro** turns a natural-language (or transcribed voice) child-protection
report into a structured **SWIMS/Primero** case and returns the **real Case ID**.

## Files
| File | Role |
|---|---|
| `graph.py` | LangGraph entrypoint (`graph.py:graph`) — Gemini + ReAct + tools |
| `prompts.py` | System prompt (intake/extraction; lifecycle/HITL owned by Maestro) |
| `tools.py` | LangChain tools: `create_case`, `get_case`, `list_cases` |
| `primero.py` | Primero REST client (Devise 3-step auth + case-create field mapping) |
| `concerns.py` | SWIMS protection-concern vocabulary + free-text → code mapping |
| `run_local.py` | Local test harness (no UiPath runtime needed) |
| `langgraph.json`, `pyproject.toml` | UiPath coded-agent project files |

## Run locally
```bash
# from repo root
. .venv/bin/activate
cd agent
python run_local.py "A 12-year-old boy is working in a mine in Tarkwa."
```
Requires `GOOGLE_API_KEY`, `GEMINI_MODEL`, and `PRIMERO_*` in the repo-root `.env`.
Locally the tools call Primero directly; in the UiPath tenant the same tools invoke
**API Workflows** (swap the bodies for `sdk.processes.invoke(...)`), keeping the agent
contract identical. The Gemini key in the tenant comes from an Orchestrator Secret asset.

## Status
✅ Verified end-to-end against the live Primero backend: NL report → Gemini extraction →
concern mapping → **real `case_id_display`** created. `gemini-3.1-pro-preview` confirmed
working via BYO-key.

## Next (in-tenant)
`uipath init` → `uipath run agent '{...}'` → `uipath pack` → `uipath publish`, then add as a
**Start-and-wait-for-agent** task in the Maestro Case (see `../IMPLEMENTATION-GUIDE.md §4`).
