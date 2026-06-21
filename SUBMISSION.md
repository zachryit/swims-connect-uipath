# SWIMS-Connect on UiPath — Submission Plan

**Hackathon:** UiPath AgentHack — *Build the AI agents of tomorrow* (Devpost)
**Track:** **Track 1 — UiPath Maestro Case**
**Deadline:** 2026-06-29 23:45 EDT · **Team size:** 1–4 · **Pool:** $50,000

This file maps the build to the judging rubric and bonuses, and tracks the required deliverables. Build details are in `IMPLEMENTATION-GUIDE.md`.

---

## Why Track 1 (Maestro Case)

Track 1 asks for *"dynamic, exception-heavy business processes … work moving through stages, with handoffs between agents, robots, and people, keeping humans in charge at key decision points; agents can be built on UiPath or an external framework."*

SWIMS-Connect **is** that: a child-protection case moving through intake → assessment → case plan → service referral → service delivery → closure, with confirm-before-write, manager-only closure, and ad-hoc exceptions that can't be fully pre-defined. The external-framework allowance directly validates our **LangGraph + Gemini** coded agent. (Track 2 BPMN is too rigid for this work; Track 3 Test Cloud is unrelated.)

---

## Judging criteria → how we target each

Phase 1 criteria, scored 1–5 each (no public weightings; treat as equal). Tactics below are the concrete evidence we'll show.

| Criterion | Our play | Demo/README evidence |
|---|---|---|
| **Business Impact & Adoption** | Real humanitarian workflow (Ghana child protection) on a real backend (Primero/UNICEF); SLAs + escalation = production credibility | Impact framing + a real Case ID created live; scale story |
| **Platform Usage (depth)** ← highest leverage | Hit **all four named pieces**: Maestro **Case** + coded agent (external **LangGraph** framework) + **API Workflows** + **AI Trust Layer** governance | README "UiPath components used" list; show each in the demo |
| **Technical Execution & Versatility** | Clean separation (Maestro=lifecycle, agent=intake/extraction, API Workflows=Primero); real exception handling (rework loops, guardrail Escalate→Action Center); deterministic case-ID writes | Architecture segment + an exception path in the demo |
| **Completeness of Delivery** (Phase 1) | Functional end-to-end prototype + public MIT repo + README w/ setup + <5-min video — don't drop easy points | Checklist below fully ticked |
| **Creativity & Innovation** | Multi-channel conversational/voice intake feeding a Maestro case; Gemini extraction + case/stage-manager agents routing exceptions dynamically | Voice-note → case moment in the demo |
| **Presentation** (Phase 2, top ≤10) | Tight narrative, confident demo, polished deck | Rehearsed <5-min video + provided deck template |

---

## Bonuses → how to capture

| Bonus | Action |
|---|---|
| **Coding-Agent Bonus** (+2 to Platform Usage) | Build via **Claude Code** + `uip skills install --agent claude`. Include a **"Built with Claude Code"** README section + **prompt log / session screenshots**. Nearly free points. |
| **Best Cross-Platform Integration ($1,500)** | Emphasize external **Gemini 3.1 Pro + LangGraph + Primero REST** spanning platforms, unified by UiPath; connector-from-OpenAPI + BYO-LLM is the evidence |
| **Best Demo / Presentation ($3,000)** | Invest in a crisp <5-min video: a case moving through stages with a human approval in Action Center |
| **Most Creative ($3,000)** | Highlight voice/NL intake → dynamic case routing |
| **People's Choice ($500 ×3)** | Polished public video + social push during the public voting window (Jul 3–30) |
| **Best First-Time Builder ($1,500)** | If a teammate is a newcomer, note it on Devpost |
| **Best Product Feedback ($1,500)** | Submit the optional feedback form with specific findings (e.g. Gemini-via-gateway SDK ambiguity, Labs license-allocation gotcha) |

> Prize-stacking cap: a project can win **at most two** prizes (one Overall/Track + one Special Award). One track only.

---

## Required deliverables — checklist

- [ ] **Devpost project page** — title, **Track 1** selected, description (problem, how it works), screenshots
- [ ] **Working solution on UiPath Automation Cloud** — built in **Studio Web during the submission window**, orchestration through Maestro
- [ ] **Demo video < 5 min** — public on YouTube/Vimeo/Youku; shows it running + architecture + agent orchestration + human involvement
- [ ] **Public GitHub repo** — license **MIT or Apache-2.0**; README must include:
  - [ ] project description / purpose
  - [ ] **list of UiPath components used** (Maestro Case, coded agent, API Workflows, Action Center, AI Trust Layer, Integration Service connector, Orchestrator)
  - [ ] setup instructions + prerequisites
  - [ ] **agent-type statement** → *combination* (low-code Maestro orchestration + low-code Action Apps + **coded** LangGraph/Gemini agent), **built with the Claude Code coding agent**
- [ ] **Presentation deck** — provided template; shareable public link (Google Drive/OneDrive/Dropbox)
- [ ] *(Optional)* **Product-feedback form** — for Best Product Feedback
- [ ] *(Finalists)* publish the solution as a use case on the **UiPath Community Forum**

---

## Demo video script (~4:30)

1. **Problem & impact (30s)** — child-protection case gaps in Ghana; SWIMS-Connect over a real Primero backend.
2. **Intake, incl. voice (60s)** — an anonymous report (text + a voice note) → Gemini coded agent extracts fields → **real Primero Case ID** returned. Show the case in Primero.
3. **Case moves through Maestro (60s)** — show the Maestro **Case** instance advancing Intake → Assessment → Service Referral, with the case/stage-manager agents routing and an **API Workflow** writing to Primero.
4. **Human in charge (45s)** — a worker confirms/edits in the **Action App**; a **manager approves closure in Action Center** (manager-only) — case closes.
5. **Architecture & governance (45s)** — the diagram: Maestro Case + LangGraph/Gemini coded agent + API Workflows + AI Trust Layer; show an **agent trace** (tokens/latency/decisions) for the audit story.
6. **Built with Claude Code (20s)** — `uip skills install --agent claude` and the coding-agent workflow.

---

## Open verification items before submission (from research)

These are flagged in `docs/UIPATH-REFERENCE.md` and must be confirmed in the Labs tenant:
1. Gemini 3.1 Pro callable via the **programmatic** LLM Gateway class (else BYO-key — already our default).
2. Maestro **Case** authoring + Case App stability (GA 2026-06-16; Process Apps still Preview).
3. Primero **OpenAPI → Connector Builder** import fidelity.
4. Exact Maestro task label for invoking an **API workflow**.
5. **Self-allocate the Agent Builder license** on the Labs tenant day 1 (known blocker).
