# SWIMS-Connect on UiPath — Submission and Demo Script

**Hackathon:** UiPath AgentHack — *Build the AI agents of tomorrow*
**Recommended track:** **Track 1 — UiPath Maestro Case**
**Deck:** `docs/SWIMS-Connect-AgentHack-2026.pptx`

This submission script is based on the current code, not planned features. In particular, the current
runtime does **not** implement UiPath Action Center, Action Apps, or a full Maestro-driven case-stage
handoff UI. The honest Track 1 story is: a UiPath-hosted coded conversational agent manages intake and
casework against Primero/SWIMS, while a deployed UiPath Maestro Case provides persistent per-case
deadline monitoring for assessment, case plan, referral, follow-up, and closure-review work.

---

## What is actually implemented

- WhatsApp channel gateway using Baileys and the UiPath TypeScript conversational-agent SDK.
- Python LangGraph coded agent deployed as a UiPath conversational agent.
- Gemini-powered text, voice-note, and image understanding.
- Anonymous community reporting with a mandatory follow-up-consent gate.
- Real Primero/SWIMS case creation using the `/api/v2` backend.
- Secure worker sign-in over a one-time link.
- Sender-bound worker context bridge so the agent acts within the logged-in worker's Primero role.
- Worker case lookup, recent case listing, and role-scoped report generation.
- Assessment, case-plan, service-referral, service-delivery, follow-up, and closure tools.
- Draft-before-save behaviour for assessment, case plan, and referral updates.
- Thirteen on-demand/scheduled report types delivered through WhatsApp.
- UiPath Maestro Case monitor instances for worker-filed cases.
- Maestro monitor cancellation when Primero confirms case closure.
- Orchestrator-managed agent package/release, assets, jobs, and traces.



---

## Demo video script — target length 4:30 to 4:55

### 0:00–0:20 — Title and one-line product story

**Screen:** Start on slide 1 of the deck, or a title card with WhatsApp and Primero/SWIMS visible.

**Voiceover:**

> This is SWIMS-Connect: a WhatsApp-based child-protection reporting and casework assistant built on
> the UiPath stack and connected to Primero. It helps community members report concerns in familiar
> language, and helps authorised social workers manage cases without moving sensitive information into
> general-purpose AI tools.

### 0:20–0:55 — Problem and impact

**Screen:** Show slide 2 or README problem section.

**Voiceover:**

> Child-protection concerns are often first noticed by relatives, teachers, neighbours, community
> leaders, and frontline workers. But reporting can be delayed by unfamiliar channels, incomplete
> information, repeated data entry, and fragmented follow-up. Ghana already uses SWIMS, the Social
> Welfare Information Management System, built on the open-source Primero platform. SWIMS-Connect keeps
> Primero as the system of record while making the front door easier to reach through WhatsApp.

### 0:55–1:45 — Anonymous community report through WhatsApp

**Screen:** Open WhatsApp chat with `+233 54 159 9802`. Send or replay:

```text
Hi
```

Then:

```text
I want to report a case. A 12-year-old child in Tarkwa is missing school and working at a mining site.
```

If showing the full flow, answer the consent question with:

```text
yes
```

**Voiceover:**

> A community reporter does not need a SWIMS account. They can start with a simple WhatsApp message.
> The gateway receives the message, sends it into the UiPath-hosted coded agent, and the agent asks a
> safeguarding question before filing: may the reporter be contacted for follow-up? If the reporter says
> no, the report can remain anonymous. If they say yes, the contact path can be preserved. The important
> part is that the agent does not invent a case number. It writes to Primero and returns the  SWIMS
> Case ID from the backend.

**Optional screen if voice-note is stable:** Send a short English voice note describing the same case.

**Optional voiceover add-on:**

> The same intake path can handle voice notes and images. 

### 1:45–2:20 — Show the case in Primero/SWIMS

**Screen:** Open Primero/SWIMS and search the Case ID returned in WhatsApp. Show the case record,
status, risk, narrative/note, and any relevant attached media if present.

**Voiceover:**

> Here is the same case inside SWIMS. Primero remains authoritative for the case record, workflow state,
> role-based access, and audit trail. SWIMS-Connect is not replacing professional case management; it is
> reducing the friction of getting structured information into the approved system.

### 2:20–3:10 — Social worker sign-in and role-scoped casework

**Screen:** In WhatsApp, ask:

```text
login
```

Open the returned secure link. Use the trial worker:

```text
Username: swims_dsw_western
Password: primer0!
```

Then ask:

```text
Show my cases.
```

or:

```text
Run my daily report.
```

**Voiceover:**

> For case data, the assistant requires a signed-in SWIMS worker. The gateway creates a one-time login
> link, stores the worker session securely, and passes only a short-lived sender-bound token to the
> agent. The language model never sees the worker password or raw session cookie. Once signed in, the
> worker can list only the cases their Primero role permits and can request reports from the same
> approved data source.

### 3:10–3:45 — Draft-before-save casework assistance

**Screen:** Ask a worker casework request using a Case ID:

```text
Show case <CASE_ID> and draft an assessment for my review.
```

or:

```text
Draft a case plan for case <CASE_ID>.
```

Show the assistant producing a labelled draft and asking for approval before saving.

**Voiceover:**

> For sensitive casework, the agent is intentionally conservative. It reads the case, drafts an
> assessment or case plan for review, and does not write it to SWIMS until the worker explicitly
> approves or edits it. This keeps the human professional in charge and avoids silent AI updates to a
> protection record.

### 3:45–4:20 — UiPath Maestro monitoring

**Screen:** Show UiPath Maestro Case app / case instances page and, if available, `case-monitors.json`
or logs showing monitor startup. Show the lifecycle labels: Assessment, Case Plan, Service Referral,
Follow-up, Closure Review.

**Voiceover:**

> UiPath Maestro is used for the long-running part of the process: persistent deadline monitoring.
> When a signed-in worker files a case, the gateway can start one Maestro Case monitor instance for that
> SWIMS case. The monitor tracks the assessment, case-plan, referral, follow-up, and closure-review
> clocks. Before sending a reminder, it checks live Primero data through the agent, so reminders are
> based on the current case state rather than a stale timer. If Primero later confirms that the case is
> closed, SWIMS-Connect cancels and removes the matching Maestro monitor.

### 4:20–4:45 — Architecture and UiPath stack

**Screen:** Show slide 4 architecture.

**Voiceover:**

> The architecture has four main parts. WhatsApp is the channel. The Node.js gateway handles consent,
> media, login links, scheduling, and secure worker context. UiPath hosts the coded conversational agent
> and manages packages, releases, assets, jobs, and traces through Orchestrator. The agent uses typed
> tools to read and write Primero. Maestro provides persistent case deadline monitoring and overdue
> reminders.

### 4:45–4:55 — Close

**Screen:** Final slide with WhatsApp number and GitHub repo.

**Voiceover:**

> SWIMS-Connect has already won the UNICEF StartUp Lab challenge for reducing child labour and
> trafficking through systems innovation. The next step is a Ghana pilot, and because Primero is used
> across many country deployments, the same pattern can be adapted to other national child-protection
> workflows.

---

## Shorter 3-minute cut

If the final video must be tighter, use this sequence:

1. **Problem and solution (25s):** WhatsApp front door for Primero/SWIMS.
2. **Anonymous report (55s):** WhatsApp report → consent → real SWIMS Case ID.
3. **Worker mode (55s):** secure login → show cases/report → draft assessment for review.
4. **Maestro (30s):** deadline monitor and verified overdue reminders.
5. **Architecture and closing (35s):** UiPath coded agent, Orchestrator, Maestro, Primero, scale.

---

## Recommended recording checklist

- [ ] Start the WhatsApp gateway and confirm health: `curl http://127.0.0.1:18794/health`.
- [ ] Confirm WhatsApp is linked to `+233 54 159 9802`.
- [ ] Prepare one clean sample case message and one real Case ID to show in Primero.
- [ ] Log in as `swims_dsw_western` before recording the worker section, or show the login flow.
- [ ] Have the Maestro Case app open with the two existing case instances or fresh monitor evidence.
- [ ] Keep the video under 5 minutes.
- [ ] Avoid showing secrets, `.env`, cookies, CSRF tokens, bridge tokens, or full child identifiers.
- [ ] If voice-note transcription is slow during recording, skip the live voice note and mention text,
  voice, and image support while showing the documented screenshots.

---

## Devpost “About the project” text

Use the polished text in the attached draft, but keep these implementation details aligned:

- Say “UiPath Maestro Case provides persistent deadline monitoring,” not “Action Center approval.”
- Say “typed tools call Primero REST,” not “API Workflows,” unless that path is actually deployed.
- Say “human review is enforced conversationally and by Primero permissions,” not “Action App.”
- Say “closure approval remains governed by Primero roles/permissions.”
