# SDD — SWIMSChildProtectionCase (Overdue-Work Monitor)

A Maestro Case whose only job is to be the durable, per-case orchestration that runs five SWIMS-workflow **SLA clocks** for one real SWIMS case. When a step's clock breaches, the WhatsApp gateway proactively warns the case **owner** that the **assessment**, **case plan**, **service referral**, **follow-up**, or **closure review** is overdue — without the owner ever subscribing to a report.

## Design Principles (read first — these constrain everything below)

1. **Mirror Primero, never re-gate it.** The five stages mirror the SWIMS workflow steps for visibility only. Primero already refuses to advance a worker who hasn't completed the current step — the case does **not** repeat that validation and has **no** human-in-the-loop approval tasks.
2. **No hardcoded people, no directory.** The case escalates to **nobody** — every stage SLA carries an **empty escalation list**, so the runtime tracks At-Risk/Breached status with no notification recipient. The only message that ever goes out is sent by the gateway to the **case owner** (the authenticated user who filed the case), passed in as `caseOwner` at instance start.
3. **Done *for* the user, not subscribed *by* the user.** One instance is started automatically per real SWIMS case. The owner does not opt in.
4. **Catalog-free.** Only `case-management:Stage`, `wait-for-timer` tasks, recipient-free SLA rules, and stage conditions. **No** connectors, Action Apps, agents, API workflows, or Integration Service — nothing requires the Maestro registry/catalog to resolve.
5. **The case is the clock; the gateway is the messenger and the precise judge.** Maestro timers and SLAs cannot bind to a per-instance variable date (a documented schema limit), so the case runs **fixed SWIMS-policy timeframes**. The gateway — which *can* read Primero's exact computed due date and current state — polls each instance's breach status, and only sends an "overdue …" nudge after confirming against **live Primero** that the step is genuinely still outstanding. Primero stays the single source of truth.

> **Out of scope (deliberately):** worker-review HITL, manager closure *approval*, and any SWIMS *writes*. Those live in the conversational `swims-connect-agent`, not here. The Closure Review stage only watches the clock and nudges the owner to review — it never approves or performs closure. Closure approval is unchanged: the agent still tells the user the request is recorded for a manager to action in the Primero portal.

## Section 1: Case Definition

### Case Metadata

| Property | Value |
|----------|-------|
| Case Name | SWIMSChildProtectionCase |
| Case Description | Overdue-work monitor: one instance per real SWIMS case; runs five recipient-free SLA clocks the gateway reads to warn the case owner over WhatsApp. |
| Case Identifier | Type: external. Value: `=vars.swimsCaseId` |
| Case App | Disabled (no in-product UI; delivery is WhatsApp via the gateway) |
| Catalog dependencies | None |

### Case Arguments (supplied by the gateway at instance start)

| Name | Category | Type | Default | Description |
|------|----------|------|---------|-------------|
| swimsCaseId | In | string | `""` | Real SWIMS Case ID this instance monitors. Set by the gateway only after the agent has created the case; also the case's external identifier. |
| caseOwner | In | string | `""` | The case owner to notify — the WhatsApp sender / Primero username who filed the case. The only escalation recipient, applied by the gateway (never inside the case). |

> The gateway reads each step's **real** due date from Primero at notification time; per-case due dates are deliberately **not** passed into the case, because Maestro timer/SLA values cannot bind to instance variables.

### Case Triggers

| T# | Trigger Type | Source | Configuration |
|----|-------------|--------|---------------|
| T01 | Manual / API case start (`trigger_1`) | WhatsApp gateway (Orchestrator runtime API) | The gateway starts exactly one instance once `swims-connect-agent` returns a real SWIMS case creation, passing `swimsCaseId` + `caseOwner`. |

### Case Exit

The case completes when all five monitoring stages complete (each stage's monitoring window elapses, or the gateway cancels the instance when Primero closes the case).

## Section 2: Stages & Tasks

Five **parallel** monitoring stages, all entered at `case-entered`, mirror the SWIMS workflow steps. Each holds exactly **one** `wait-for-timer` task whose fixed duration is the monitoring lifetime (`P365D` — long enough that the SLA breach is observable; the gateway cancels the instance when the SWIMS case closes). Each stage carries a **recipient-free SLA** whose `count`/`unit` is the standard SWIMS timeframe for that step — the clock the gateway reads. There are **no** approval, action, agent, or API tasks.

| Stage | SLA clock (policy timeframe, configurable) | wait-for-timer (monitoring lifetime) |
|-------|--------------------------------------------|--------------------------------------|
| Assessment | 3 days | P365D |
| Case Plan | 14 days | P365D |
| Service Referral | 7 days | P365D |
| Follow-up | 30 days | P365D |
| Closure Review | 90 days | P365D |

Each stage is structurally identical (only label / SLA `count` differ):

- **Entry condition:** `case-entered`, non-interrupting.
- **Task:** one `wait-for-timer`, required, run-once, `data: { timerType: "timeDuration", timeDuration: "P365D" }`.
- **SLA:** `{ expression: "=js:true", count: <policy>, unit: "d", escalationRule: [] }` — recipient-free; the runtime records At-Risk (80%)/Breached without notifying anyone.
- **Exit condition:** `required-tasks-completed`, `exit-only`, `marksStageComplete: true`.

> The policy timeframes above are standard child-protection casework defaults, not per-case data. They are the *coarse* backstop clock; the gateway applies Primero's *exact* per-case due date before it ever messages the owner.

## Section 3: Escalation Delivery (outside the case)

The case never sends a message itself. Delivery is the existing gateway's job:

1. The gateway starts one instance per real SWIMS case (`swimsCaseId` + `caseOwner`) and remembers `instanceId → { swimsCaseId, caseOwner }`.
2. A poller queries the Maestro runtime for each live instance's stage SLA status (At-Risk / Breached).
3. For any breached stage, the gateway re-checks **live Primero** through the existing agent tools: using Primero's real due date and state, is that step actually still outstanding for this case?
4. If yes, it sends the `caseOwner` a WhatsApp nudge — "Heads up: the **assessment** for case `<id>` is overdue." If Primero shows it done, it stays silent. The gateway suppresses repeats and cancels the instance once Primero closes the case.

This keeps Primero authoritative, needs no catalog, hardcodes no people, and requires no subscription from the user.

## Section 4: Integrations

> **None.** No Integration Service connectors, Action Apps, API workflows, or agents are referenced by this case. The only external touch points — starting instances, reading runtime SLA status, cancelling instances — are Orchestrator runtime calls made by the WhatsApp gateway, not nodes in the case.
