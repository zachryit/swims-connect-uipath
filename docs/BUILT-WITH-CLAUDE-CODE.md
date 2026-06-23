# Built with Claude Code — coding-agent evidence log

UiPath AgentHack awards **bonus evaluation points** to solutions built with a coding agent
(Claude Code, Codex, Cursor, Gemini CLI). This solution is built with **Claude Code** using
UiPath's official **skills catalog**, installed via the `uip` CLI. This file is the running
evidence trail (commands, what the agent produced, and pointers to prompt logs/screenshots) so
the bonus is *demonstrable*, not just asserted.

## How the coding agent is wired in

UiPath's skills catalog was installed into Claude Code with the UiPath CLI:

```console
$ uip skills install --agent claude
{
  "Result": "Success",
  "Code": "SkillsInstall",
  "Data": {
    "RootDir": "/home/azureuser",
    "Agents": ["claude"],
    "Skills": [ "uipath-admin", "uipath-agents", "uipath-api-workflow",
      "uipath-automation-discovery", "uipath-coded-apps", "uipath-data-fabric",
      "uipath-feedback", "uipath-governance", "uipath-human-in-the-loop", "uipath-ixp",
      "uipath-maestro-bpmn", "uipath-maestro-case", "uipath-maestro-flow",
      "uipath-mcp-servers", "uipath-planner", "uipath-platform", "uipath-review",
      "uipath-rpa", "uipath-solution", "uipath-tasks", "uipath-test", "uipath-troubleshoot" ],
    "Installed": 22
  }
}
```

Verification:

```console
$ claude plugin list
  ❯ uipath@uipath-marketplace
    Version: 0.0.36
    Scope: user
    Status: ✔ enabled
```

These 22 skills teach Claude Code how to build, validate, and deploy UiPath artifacts with the
`uip` / `uipath` CLIs. The ones directly used by this solution: **uipath-maestro-case**,
**uipath-agents**, **uipath-api-workflow**, **uipath-human-in-the-loop**, **uipath-tasks**,
**uipath-platform**, **uipath-solution**, **uipath-governance**.

## Session log (what Claude Code did)

| # | Date | What the coding agent did | Output / result |
|---|---|---|---|
| 1 | 2026-06-21 | Researched the hackathon + UiPath platform; inventoried the source system; chose Track 1 + the hybrid architecture | `PORTING-PLAN.md`, `ARCHITECTURE.md`, `docs/SOURCE-INVENTORY.md`, `docs/UIPATH-REFERENCE.md` |
| 2 | 2026-06-21 | Authored the phased build plan + submission/rubric mapping | `IMPLEMENTATION-GUIDE.md`, `SUBMISSION.md`, `README.md` |
| 3 | 2026-06-21 | Built the Python LangGraph + Gemini coded agent (Primero client, concern mapper, tools, prompt, graph) | `agent/*.py`, `langgraph.json`, `pyproject.toml` |
| 4 | 2026-06-21 | **Verified end-to-end**: NL report → Gemini 3.1 Pro extraction → real SWIMS `case_id_display` created against the live Primero backend | e.g. case `f220ca2` (child labour + educational neglect, Kumasi) |
| 5 | 2026-06-21 | Installed the UiPath skills catalog into Claude Code (this file) | `uipath@uipath-marketplace` v0.0.36, 22 skills |
| 6 | 2026-06-22 | Authenticated headlessly with the UiPath External App and published the packaged coded agent to the Orchestrator tenant processes feed | `swims-connect-agent` v0.1.0 — `Package published successfully!` |
| 7 | 2026-06-22 | Added secure Orchestrator asset hydration, published v0.1.1, and provisioned five `SWIMS_*` runtime assets in `Shared` | Package and assets succeeded; process binding is awaiting Agent runtime capacity |
| 8 | 2026-06-23 | Switched to the replacement UiPath account and repeated the tenant deployment | v0.1.1 and five `SWIMS_*` assets verified in `swims / DefaultTenant`; Agent runtime capacity is still unavailable |

*(append in-tenant build sessions here: connector import, API Workflows, agent publish, Maestro Case authoring)*

### Tenant publish proof

```console
$ uipath publish --tenant
Publishing most recent package: swims-connect-agent.0.1.0.nupkg ...
✓  Package published successfully!
```

Target: organization `testwvroiff`, tenant `DefaultTenant`, Orchestrator Tenant Processes Feed.
No credentials or access tokens are stored in this evidence log.

### Tenant runtime diagnostic

The CLI verified the package and assets, but process creation returned:

```text
Agent runtime capacity is not allocated to the folder
```

The Community tenant reports `AgentService: 0`, `CaseManagement: 0`, and `Flow: 0` in its
allowed license capacity. The packaged agent remains deployable; process binding and Maestro
Case deployment must continue in an AgentHack/Labs tenant with those services enabled.

## To finalize before submission (capture as you build)

- [ ] Screenshots of Claude Code building UiPath artifacts (the `uip skills install` run; the agent build; the publish/deploy)
- [ ] A short prompt log / session export (the user prompts that drove each milestone)
- [ ] Demo-video segment (~20s) showing `uip skills install --agent claude` + the coding-agent workflow
- [ ] This file linked from the README "Built with Claude Code" section ✅
- [ ] README states the agent type is a **combination** (low-code Maestro/Action Apps + coded LangGraph/Gemini agent), built with Claude Code

## Reproduce

```bash
npm install -g @uipath/cli
uip skills install --agent claude     # installs the 22 skills as the uipath Claude Code plugin
claude plugin list                    # → uipath@uipath-marketplace, enabled
```
