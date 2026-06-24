# SDD — SWIMSChildProtectionCase

Case Definition Blueprint for a child-protection case that moves from community or worker intake through assessment, planning, service delivery, follow-up, and manager-approved closure.

## Table of Contents

1. [Case Definition](#section-1-case-definition)
2. [Stages & Tasks](#section-2-stages--tasks)
   - [Stage 1: Intake](#stage-1-intake)
   - [Stage 2: Assessment](#stage-2-assessment)
   - [Stage 3: Case Plan](#stage-3-case-plan)
   - [Stage 4: Service Referral](#stage-4-service-referral)
   - [Stage 5: Service Delivery](#stage-5-service-delivery)
   - [Stage 6: Follow-up](#stage-6-follow-up)
   - [Stage 7: Closure](#stage-7-closure)
3. [Personas & App Views](#section-3-personas--app-views)
4. [Integrations](#section-4-integrations)

## Section 1: Case Definition

### Case Metadata

| Property | Value |
|----------|-------|
| Case Name | SWIMSChildProtectionCase |
| Case Description | Manages a Ghana SWIMS child-protection case from an anonymous or authenticated report through assessment, case planning, service referral, delivery, follow-up, and closure. Human confirmation gates worker writes and a manager controls closure. |
| Case Identifier | Type: external. Value: `=vars.swimsCaseId` |
| Priority | Choiceset: Critical, High, Medium, Low — Default: Medium |
| Case-Level SLA | 30 d |
| SLA Type | time-based |
| Case App | Enabled |
| Task-output passing | Direct |
| Case Identifier source | Real SWIMS `case_id_display` supplied by the WhatsApp/API intake workflow. |

### Case-Level SLA Escalation Rules

| SLA Status | Threshold | Action |
|------------|-----------|--------|
| At-Risk | 80% | Notify: Case Worker |
| Breached | 100% | Notify: CP Manager |

### Case Triggers and Channel Ingress

| T# | Trigger Type | Source | Configuration |
|----|-------------|--------|---------------|
| T02 | Manual/API case start | Studio Web, Case App, or UiPath WhatsApp Conversation workflow | Starts only after a real SWIMS Case ID exists. |
| T03 | Orchestrator API trigger for Maestro Flow (integration, not a caseplan event node) | Baileys gateway for `+233256590242` | Starts `WhatsAppConversation`, which accepts one WhatsApp turn, invokes the UiPath coded agent with sender-scoped history, returns the agent reply, and starts T02 when a report creates a SWIMS case. |

### Case Exit Conditions

| WHEN | IF | THEN | Marks Case Complete | Display Name |
|------|-----|------|---------------------|--------------|
| required-stages-completed | `=js:(vars.closureDecision === "Approved" && vars.caseStatus === "closed")` | Case exited | Yes | Case safely closed |

### Case Variables

| Name | Category | Type | sourceTriggers | sourceFields | Default | Description |
|------|----------|------|----------------|--------------|---------|-------------|
| reportNarrative | In | string | | | | Natural-language or transcribed child-protection report. |
| sourceChannel | In | string | | | "manual" | Intake channel: manual, WhatsApp text, or WhatsApp voice. |
| reporterContact | In | string | | | | Optional reporter callback contact. |
| followUpAllowed | In | boolean | | | false | Whether the reporter consents to follow-up contact. |
| agentResult | Variable | jsonSchema | | | | Complete output returned by the intake agent. |
| swimsCaseId | In | string | | | | Real SWIMS Case ID created by the conversational intake agent before this Maestro case starts. |
| riskLevel | In | string | | | "medium" | Protection risk classification supplied by the conversational intake agent. |
| caseStatus | Out | string | | | "open" | Final SWIMS case status returned to the caller. |
| assessmentDecision | Variable | string | | | "Pending" | Worker assessment decision. |
| assessmentData | Variable | jsonSchema | | | | Confirmed structured assessment content and dates. |
| casePlanDecision | Variable | string | | | "Pending" | Worker decision on the drafted case plan. |
| casePlanData | Variable | jsonSchema | | | | Confirmed case-plan goals and interventions. |
| referralDecision | Variable | string | | | "Pending" | Worker decision on a service referral. |
| referralData | Variable | jsonSchema | | | | Selected service, provider, timeframe, appointment, and notes. |
| deliveryDecision | Variable | string | | | "Pending" | Worker confirmation that a service was delivered. |
| deliveryData | Variable | jsonSchema | | | | Delivered service identifier and implementation date. |
| followupDecision | Variable | string | | | "Pending" | Worker decision on follow-up work. |
| followupData | Variable | jsonSchema | | | | Follow-up type, due/completion date, and comments. |
| closureDecision | Variable | string | | | "Pending" | CP Manager closure approval outcome. |
| closureReason | Variable | string | | | | Reason for closing or requesting closure approval. |
| lastWriteError | Variable | string | | | | Permission or integration error returned by a write task. |

## Section 2: Stages & Tasks

### Stage 1: Intake

**Type:** Stage  
**Description:** Receives a confirmed report from the UiPath WhatsApp conversation workflow, verifies the structured protection information and real SWIMS Case ID, and opens governed case work.  
**Required for Case Completion:** Yes

#### Stage Entry Conditions

| WHEN | IF | Interrupting | Display Name |
|------|-----|-------------|--------------|
| case-entered | — | No | Start intake |

#### Stage Exit Conditions

| WHEN | IF | Exit Type | Marks Stage Complete | Display Name |
|------|-----|-----------|---------------------|--------------|
| required-tasks-completed | `=js:(vars.swimsCaseId != null && vars.swimsCaseId !== "")` | exit-only | Yes | Intake filed |

#### Stage SLA

| SLA | Unit | At-Risk | At-Risk Action | Breach Action |
|-----|------|---------|----------------|---------------|
| 4 | h | 75% | Notify: Case Worker | Notify: CP Manager |

#### Tasks

| # | Task Name | Type | Required | Run Only Once | Persona | SLA |
|---|-----------|------|----------|---------------|---------|-----|
| 1 | Validate Intake Report | agent | Yes | Yes | Reporter | — |
| 2 | Review Worker Intake | action | No | Yes | Case Worker | 4 h |

##### Task 1.1: Validate Intake Report

**Type:** agent  
**Description:** Uses the deployed LangGraph and Gemini agent to validate the confirmed intake payload, risk classification, and protection concerns before governed case work begins. The WhatsApp conversation workflow—not this task—creates the initial SWIMS record.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| current-stage-entered | — | Run intake agent |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | Yes | — |

**Resolved Resource:** swims-connect-agent  
**Folder Path:** Shared  
**Resource Identity:** swims-connect-agent:0.1.2  
**Binding Sub-Type:** Agent  
**Dispatch / Operation:** agent

**Inputs:**

| Field | Type | Binding |
|-------|------|---------|
| messages | jsonSchema | `=js:[{type:"human",content:"Validate confirmed SWIMS intake " + vars.swimsCaseId + ": " + vars.reportNarrative}]` |

**Outputs:**

| Field | Binding / Value |
|-------|------------------|
| messages | -> agentResult |
| — | riskLevel = `=js:vars.agentResult.risk_level || vars.riskLevel` |

##### Task 1.2: Review Worker Intake

**Type:** action  
**Description:** Allows an authenticated worker to verify extracted details when the report originated from a worker channel; anonymous reports continue without this review.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| selected-tasks-completed("Validate Intake Report") | `=js:(vars.sourceChannel === "worker")` | Review worker report |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| No | Yes | `=js:(vars.sourceChannel !== "worker")` |

**HITL Implementation:** Action App: SWIMS Worker Review  
**Action App ID:** `<UNRESOLVED>`  
**Deployment Folder:** Shared  
**actionType:** IntakeReview  
**Recipient:** Role:Case Worker  
**Priority:** High · **Task Title:** Review extracted SWIMS intake · **Labels:** intake, child-protection

**Input Schema:**

| Field | Type | Binding | Required |
|-------|------|---------|----------|
| reportNarrative | String | `=vars.reportNarrative` | Yes |
| agentResult | Object | `=vars.agentResult` | Yes |

**Output Schema:**

| Field | Binding / Value |
|-------|------------------|
| Action | -> assessmentDecision |

**Actions:**

| Button | Maps To | Behavior |
|--------|---------|----------|
| Confirm | assessmentDecision = "Confirmed" | Complete task and retain extracted data |
| Needs Correction | assessmentDecision = "CorrectionRequired" | Complete task and flag rework |

### Stage 2: Assessment

**Type:** Stage  
**Description:** Captures safety threats, protective capacities, safety determination, rationale, assessment start date, and the next case-plan due date under worker control.  
**Required for Case Completion:** Yes

#### Stage Entry Conditions

| WHEN | IF | Interrupting | Display Name |
|------|-----|-------------|--------------|
| selected-stage-completed("Intake") | — | No | Intake completed |

#### Stage Exit Conditions

| WHEN | IF | Exit Type | Marks Stage Complete | Display Name |
|------|-----|-----------|---------------------|--------------|
| required-tasks-completed | `=js:(vars.assessmentDecision === "Approved")` | exit-only | Yes | Assessment recorded |

#### Stage SLA

| SLA | Unit | At-Risk | At-Risk Action | Breach Action |
|-----|------|---------|----------------|---------------|
| 3 | d | 75% | Notify: Case Worker | Notify: CP Manager |

#### Tasks

| # | Task Name | Type | Required | Run Only Once | Persona | SLA |
|---|-----------|------|----------|---------------|---------|-----|
| 1 | Review Assessment | action | Yes | No | Case Worker | 2 d |
| 2 | Record Assessment | api-workflow | Yes | No | — | — |

##### Task 2.1: Review Assessment

**Type:** action  
**Description:** The worker reviews and confirms structured assessment content and mandatory task-tracking dates before any SWIMS write.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| current-stage-entered | — | Draft assessment |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**HITL Implementation:** Action App: SWIMS Worker Review  
**Action App ID:** `<UNRESOLVED>`  
**Deployment Folder:** Shared  
**actionType:** AssessmentReview  
**Recipient:** Role:Case Worker  
**Priority:** High · **Task Title:** Review and confirm safety assessment · **Labels:** assessment

**Input Schema:**

| Field | Type | Binding | Required |
|-------|------|---------|----------|
| swimsCaseId | String | `=vars.swimsCaseId` | Yes |
| assessmentData | Object | `=vars.assessmentData` | Yes |

**Output Schema:**

| Field | Binding / Value |
|-------|------------------|
| Action | -> assessmentDecision |
| assessmentData | -> assessmentData |

**Actions:**

| Button | Maps To | Behavior |
|--------|---------|----------|
| Approve | assessmentDecision = "Approved" | Complete task and allow write |
| Revise | assessmentDecision = "RevisionRequired" | Complete task and return for correction |

##### Task 2.2: Record Assessment

**Type:** api-workflow  
**Description:** Writes the confirmed assessment fields and assessment start date, creating the next Case Plan task without directly changing read-only workflow fields.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| selected-tasks-completed("Review Assessment") | `=js:(vars.assessmentDecision === "Approved")` | Save assessment |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**Resolved Resource:** SWIMSAssessment  
**Folder Path:** Shared  
**Resource Identity:** `<UNRESOLVED>`  
**Binding Sub-Type:** Api  
**Dispatch / Operation:** assessment_fill + assessment_open

**Inputs:**

| Field | Type | Binding |
|-------|------|---------|
| caseId | String | `=vars.swimsCaseId` |
| assessment | Object | `=vars.assessmentData` |

**Outputs:**

| Field | Binding / Value |
|-------|------------------|
| error | -> lastWriteError |

### Stage 3: Case Plan

**Type:** Stage  
**Description:** Converts the assessment into confirmed goals and interventions, then records the plan and its task-tracking dates in SWIMS.  
**Required for Case Completion:** Yes

#### Stage Entry Conditions

| WHEN | IF | Interrupting | Display Name |
|------|-----|-------------|--------------|
| selected-stage-completed("Assessment") | — | No | Assessment completed |

#### Stage Exit Conditions

| WHEN | IF | Exit Type | Marks Stage Complete | Display Name |
|------|-----|-----------|---------------------|--------------|
| required-tasks-completed | `=js:(vars.casePlanDecision === "Approved")` | exit-only | Yes | Case plan recorded |

#### Stage SLA

| SLA | Unit | At-Risk | At-Risk Action | Breach Action |
|-----|------|---------|----------------|---------------|
| 7 | d | 75% | Notify: Case Worker | Notify: CP Manager |

#### Tasks

| # | Task Name | Type | Required | Run Only Once | Persona | SLA |
|---|-----------|------|----------|---------------|---------|-----|
| 1 | Review Case Plan | action | Yes | No | Case Worker | 5 d |
| 2 | Record Case Plan | api-workflow | Yes | No | — | — |

##### Task 3.1: Review Case Plan

**Type:** action  
**Description:** The worker confirms goals, providers, intervention dates, and review dates before the plan is written.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| current-stage-entered | — | Review plan |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**HITL Implementation:** Action App: SWIMS Worker Review  
**Action App ID:** `<UNRESOLVED>` · **Deployment Folder:** Shared · **actionType:** CasePlanReview  
**Recipient:** Role:Case Worker  
**Priority:** High · **Task Title:** Review and confirm case plan · **Labels:** case-plan

**Input Schema:**

| Field | Type | Binding | Required |
|-------|------|---------|----------|
| swimsCaseId | String | `=vars.swimsCaseId` | Yes |
| casePlanData | Object | `=vars.casePlanData` | Yes |

**Output Schema:**

| Field | Binding / Value |
|-------|------------------|
| Action | -> casePlanDecision |
| casePlanData | -> casePlanData |

**Actions:**

| Button | Maps To | Behavior |
|--------|---------|----------|
| Approve | casePlanDecision = "Approved" | Complete task and allow write |
| Revise | casePlanDecision = "RevisionRequired" | Complete task and return for correction |

##### Task 3.2: Record Case Plan

**Type:** api-workflow  
**Description:** Writes the confirmed case-plan date, goals, review date, and interventions as distinct SWIMS updates.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| selected-tasks-completed("Review Case Plan") | `=js:(vars.casePlanDecision === "Approved")` | Save case plan |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**Resolved Resource:** SWIMSCasePlan · **Folder Path:** Shared · **Resource Identity:** `<UNRESOLVED>` · **Binding Sub-Type:** Api  
**Dispatch / Operation:** caseplan_open + caseplan_intervention_add

**Inputs:**

| Field | Type | Binding |
|-------|------|---------|
| caseId | String | `=vars.swimsCaseId` |
| casePlan | Object | `=vars.casePlanData` |

**Outputs:**

| Field | Binding / Value |
|-------|------------------|
| error | -> lastWriteError |

### Stage 4: Service Referral

**Type:** Stage  
**Description:** Selects a live service type, provider, response timeframe, appointment, and notes, then records a trackable referral.  
**Required for Case Completion:** Yes

#### Stage Entry Conditions

| WHEN | IF | Interrupting | Display Name |
|------|-----|-------------|--------------|
| selected-stage-completed("Case Plan") | — | No | Plan completed |

#### Stage Exit Conditions

| WHEN | IF | Exit Type | Marks Stage Complete | Display Name |
|------|-----|-----------|---------------------|--------------|
| required-tasks-completed | `=js:(vars.referralDecision === "Approved")` | exit-only | Yes | Referral recorded |

#### Stage SLA

| SLA | Unit | At-Risk | At-Risk Action | Breach Action |
|-----|------|---------|----------------|---------------|
| 3 | d | 75% | Notify: Case Worker | Notify: CP Manager |

#### Tasks

| # | Task Name | Type | Required | Run Only Once | Persona | SLA |
|---|-----------|------|----------|---------------|---------|-----|
| 1 | Review Service Referral | action | Yes | No | Case Worker | 2 d |
| 2 | Add Service Referral | api-workflow | Yes | No | — | — |

##### Task 4.1: Review Service Referral

**Type:** action  
**Description:** The worker confirms the lookup-backed service choice, provider, mandatory timeframe, appointment, and notes.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| current-stage-entered | — | Review referral |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**HITL Implementation:** Action App: SWIMS Worker Review  
**Action App ID:** `<UNRESOLVED>` · **Deployment Folder:** Shared · **actionType:** ReferralReview  
**Recipient:** Role:Case Worker  
**Priority:** High · **Task Title:** Review service referral · **Labels:** referral

**Input Schema:**

| Field | Type | Binding | Required |
|-------|------|---------|----------|
| swimsCaseId | String | `=vars.swimsCaseId` | Yes |
| referralData | Object | `=vars.referralData` | Yes |

**Output Schema:**

| Field | Binding / Value |
|-------|------------------|
| Action | -> referralDecision |
| referralData | -> referralData |

**Actions:**

| Button | Maps To | Behavior |
|--------|---------|----------|
| Approve | referralDecision = "Approved" | Complete task and allow write |
| Revise | referralDecision = "RevisionRequired" | Complete task and return for correction |

##### Task 4.2: Add Service Referral

**Type:** api-workflow  
**Description:** Adds one not-yet-implemented service row and advances the source workflow through the service response type.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| selected-tasks-completed("Review Service Referral") | `=js:(vars.referralDecision === "Approved")` | Save referral |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**Resolved Resource:** SWIMSServiceReferral · **Folder Path:** Shared · **Resource Identity:** `<UNRESOLVED>` · **Binding Sub-Type:** Api  
**Dispatch / Operation:** service_add

**Inputs:**

| Field | Type | Binding |
|-------|------|---------|
| caseId | String | `=vars.swimsCaseId` |
| referral | Object | `=vars.referralData` |

**Outputs:**

| Field | Binding / Value |
|-------|------------------|
| error | -> lastWriteError |

### Stage 5: Service Delivery

**Type:** Stage  
**Description:** Confirms delivery dates and marks referrals implemented; the source workflow advances only when every service is delivered.  
**Required for Case Completion:** Yes

#### Stage Entry Conditions

| WHEN | IF | Interrupting | Display Name |
|------|-----|-------------|--------------|
| selected-stage-completed("Service Referral") | — | No | Referral created |

#### Stage Exit Conditions

| WHEN | IF | Exit Type | Marks Stage Complete | Display Name |
|------|-----|-----------|---------------------|--------------|
| required-tasks-completed | `=js:(vars.deliveryDecision === "Confirmed")` | exit-only | Yes | All services delivered |

#### Stage SLA

| SLA | Unit | At-Risk | At-Risk Action | Breach Action |
|-----|------|---------|----------------|---------------|
| 7 | d | 75% | Notify: Case Worker | Notify: CP Manager |

#### Tasks

| # | Task Name | Type | Required | Run Only Once | Persona | SLA |
|---|-----------|------|----------|---------------|---------|-----|
| 1 | Confirm Service Delivery | action | Yes | No | Case Worker | 5 d |
| 2 | Mark Service Delivered | api-workflow | Yes | No | — | — |

##### Task 5.1: Confirm Service Delivery

**Type:** action  
**Description:** The worker selects the pending service and confirms the implementation date before recording delivery.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| current-stage-entered | — | Confirm delivery |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**HITL Implementation:** Action App: SWIMS Worker Review  
**Action App ID:** `<UNRESOLVED>` · **Deployment Folder:** Shared · **actionType:** DeliveryConfirmation  
**Recipient:** Role:Case Worker  
**Priority:** High · **Task Title:** Confirm service delivery · **Labels:** service-delivery

**Input Schema:**

| Field | Type | Binding | Required |
|-------|------|---------|----------|
| swimsCaseId | String | `=vars.swimsCaseId` | Yes |
| deliveryData | Object | `=vars.deliveryData` | Yes |

**Output Schema:**

| Field | Binding / Value |
|-------|------------------|
| Action | -> deliveryDecision |
| deliveryData | -> deliveryData |

**Actions:**

| Button | Maps To | Behavior |
|--------|---------|----------|
| Confirm | deliveryDecision = "Confirmed" | Complete task and allow write |
| Revise | deliveryDecision = "RevisionRequired" | Complete task and return for correction |

##### Task 5.2: Mark Service Delivered

**Type:** api-workflow  
**Description:** Updates the selected service row by unique identifier, sets both implementation fields, and reports whether all services are delivered.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| selected-tasks-completed("Confirm Service Delivery") | `=js:(vars.deliveryDecision === "Confirmed")` | Record delivery |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**Resolved Resource:** SWIMSServiceDelivery · **Folder Path:** Shared · **Resource Identity:** `<UNRESOLVED>` · **Binding Sub-Type:** Api  
**Dispatch / Operation:** service_implement

**Inputs:**

| Field | Type | Binding |
|-------|------|---------|
| caseId | String | `=vars.swimsCaseId` |
| delivery | Object | `=vars.deliveryData` |

**Outputs:**

| Field | Binding / Value |
|-------|------------------|
| error | -> lastWriteError |

### Stage 6: Follow-up

**Type:** ExceptionStage  
**Description:** Supports repeatable planned or completed follow-up work from any active case stage without replacing the primary lifecycle.  
**Required for Case Completion:** No  
**Interrupting:** No

#### Stage Entry Conditions

| WHEN | IF | Interrupting | Display Name |
|------|-----|-------------|--------------|
| user-selected-stage | — | No | Add follow-up |

#### Stage Exit Conditions

| WHEN | IF | Exit Type | Marks Stage Complete | Display Name |
|------|-----|-----------|---------------------|--------------|
| required-tasks-completed | `=js:(vars.followupDecision === "Approved")` | return-to-origin | Yes | Follow-up recorded |

#### Stage SLA

| SLA | Unit | At-Risk | At-Risk Action | Breach Action |
|-----|------|---------|----------------|---------------|
| 3 | d | 75% | Notify: Case Worker | Notify: CP Manager |

#### Tasks

| # | Task Name | Type | Required | Run Only Once | Persona | SLA |
|---|-----------|------|----------|---------------|---------|-----|
| 1 | Review Follow-up | action | Yes | No | Case Worker | 2 d |
| 2 | Record Follow-up | api-workflow | Yes | No | — | — |

##### Task 6.1: Review Follow-up

**Type:** action  
**Description:** The worker confirms lookup-backed follow-up type, due or completion date, and comments.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| current-stage-entered | — | Review follow-up |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**HITL Implementation:** Action App: SWIMS Worker Review  
**Action App ID:** `<UNRESOLVED>` · **Deployment Folder:** Shared · **actionType:** FollowupReview  
**Recipient:** Role:Case Worker  
**Priority:** Medium · **Task Title:** Review follow-up · **Labels:** follow-up

**Input Schema:**

| Field | Type | Binding | Required |
|-------|------|---------|----------|
| swimsCaseId | String | `=vars.swimsCaseId` | Yes |
| followupData | Object | `=vars.followupData` | Yes |

**Output Schema:**

| Field | Binding / Value |
|-------|------------------|
| Action | -> followupDecision |
| followupData | -> followupData |

**Actions:**

| Button | Maps To | Behavior |
|--------|---------|----------|
| Approve | followupDecision = "Approved" | Complete task and allow write |
| Revise | followupDecision = "RevisionRequired" | Complete task and return for correction |

##### Task 6.2: Record Follow-up

**Type:** api-workflow  
**Description:** Adds or updates one follow-up row with the worker-confirmed tracking dates and comments.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| selected-tasks-completed("Review Follow-up") | `=js:(vars.followupDecision === "Approved")` | Save follow-up |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**Resolved Resource:** SWIMSFollowup · **Folder Path:** Shared · **Resource Identity:** `<UNRESOLVED>` · **Binding Sub-Type:** Api  
**Dispatch / Operation:** followup_add + followup_update

**Inputs:**

| Field | Type | Binding |
|-------|------|---------|
| caseId | String | `=vars.swimsCaseId` |
| followup | Object | `=vars.followupData` |

**Outputs:**

| Field | Binding / Value |
|-------|------------------|
| error | -> lastWriteError |

### Stage 7: Closure

**Type:** Stage  
**Description:** Requires a CP Manager to approve closure after all services are delivered, then closes the SWIMS case or records an approval request when direct close is unauthorized.  
**Required for Case Completion:** Yes

#### Stage Entry Conditions

| WHEN | IF | Interrupting | Display Name |
|------|-----|-------------|--------------|
| selected-stage-completed("Service Delivery") | — | No | Services completed |

#### Stage Exit Conditions

| WHEN | IF | Exit Type | Marks Stage Complete | Display Name |
|------|-----|-----------|---------------------|--------------|
| required-tasks-completed | `=js:(vars.closureDecision === "Approved" && vars.caseStatus === "closed")` | exit-only | Yes | Manager-approved closure |

#### Stage SLA

| SLA | Unit | At-Risk | At-Risk Action | Breach Action |
|-----|------|---------|----------------|---------------|
| 3 | d | 75% | Notify: CP Manager | Notify: CP Administrator |

#### Tasks

| # | Task Name | Type | Required | Run Only Once | Persona | SLA |
|---|-----------|------|----------|---------------|---------|-----|
| 1 | Manager Closure Approval | action | Yes | No | CP Manager | 2 d |
| 2 | Close SWIMS Case | api-workflow | Yes | No | — | — |

##### Task 7.1: Manager Closure Approval

**Type:** action  
**Description:** A CP Manager reviews service completion and safety outcomes and makes the final closure decision.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| current-stage-entered | — | Review closure |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**HITL Implementation:** Action App: SWIMS Manager Approval  
**Action App ID:** `<UNRESOLVED>`  
**Deployment Folder:** Shared  
**actionType:** ClosureApproval  
**Recipient:** Role:CP Manager  
**Priority:** Critical · **Task Title:** Approve SWIMS case closure · **Labels:** closure, manager-approval

**Input Schema:**

| Field | Type | Binding | Required |
|-------|------|---------|----------|
| swimsCaseId | String | `=vars.swimsCaseId` | Yes |
| closureReason | String | `=vars.closureReason` | Yes |
| deliveryData | Object | `=vars.deliveryData` | Yes |

**Output Schema:**

| Field | Binding / Value |
|-------|------------------|
| Action | -> closureDecision |
| closureReason | -> closureReason |

**Actions:**

| Button | Maps To | Behavior |
|--------|---------|----------|
| Approve | closureDecision = "Approved" | Complete task and allow close |
| Reject | closureDecision = "Rejected" | Complete task and keep case open |

##### Task 7.2: Close SWIMS Case

**Type:** api-workflow  
**Description:** Closes the case using the manager-authorized service identity; a permission failure is returned for supervisor handling and is never silently retried.

**Entry Condition:**

| WHEN | IF | Display Name |
|------|-----|--------------|
| selected-tasks-completed("Manager Closure Approval") | `=js:(vars.closureDecision === "Approved")` | Close case |

| Required | Run Only Once | Skip Condition |
|----------|---------------|----------------|
| Yes | No | — |

**Resolved Resource:** SWIMSClosure · **Folder Path:** Shared · **Resource Identity:** `<UNRESOLVED>` · **Binding Sub-Type:** Api  
**Dispatch / Operation:** case_close; on authorization failure use case_request_closure_approval

**Inputs:**

| Field | Type | Binding |
|-------|------|---------|
| caseId | String | `=vars.swimsCaseId` |
| reason | String | `=vars.closureReason` |

**Outputs:**

| Field | Binding / Value |
|-------|------------------|
| status | -> caseStatus |
| error | -> lastWriteError |

## Section 3: Personas & App Views

### Personas

| Persona | Stage Scope | Permissions | Description |
|---------|-------------|-------------|-------------|
| Reporter | Intake | Start, View reference | Community reporter or authenticated partner submitting a concern. |
| Case Worker | Intake, Assessment, Case Plan, Service Referral, Service Delivery, Follow-up | View, Act, Reassign | Frontline worker who reviews and confirms every case-management write. |
| CP Manager | All | View, Act, Reassign, Approve Closure | Supervisor with authority to approve and close cases. |

### Process App Views

| App | View | Persona | Purpose | Key Components |
|-----|------|---------|---------|----------------|
| SWIMS Case App | Case List | Case Worker, CP Manager | Prioritize active and overdue work. | Case ID, stage, risk, task status, owner, SLA |
| SWIMS Case App | Case Detail | Case Worker, CP Manager | Review case data, tasks, decisions, and timeline. | Stage timeline, task forms, decision history, integration status |
| SWIMS Case App | Closure Queue | CP Manager | Review cases ready for closure. | Case ID, delivered services, follow-up status, closure reason, approval action |

## Section 4: Integrations

### Integration Service Connectors

> None required for WhatsApp. The channel uses a repository-owned Baileys adapter and an authenticated UiPath Orchestrator API trigger. Integration Service may be added later for a supported WhatsApp Cloud connector, but it is not a hackathon dependency.

### WhatsApp Conversation Channel

| Component | Runtime | Responsibility |
|-----------|---------|----------------|
| Baileys Gateway | Node.js adapter from this repository | Links WhatsApp number `+233256590242`, receives/sends messages and media, and contains no case-management or agent reasoning. |
| `WhatsAppConversation` Maestro Flow + Orchestrator API Trigger | UiPath Automation Cloud | Authenticates the gateway request, loads sender-scoped conversation state, invokes `swims-connect-agent`, stores the updated state, and returns the reply. |
| `swims-connect-agent` | UiPath Agent Service | Conducts multi-turn intake, supports anonymous reporting and authenticated worker operations, calls SWIMS tools, and returns only real case identifiers. |
| Maestro Case Starter | UiPath Automation Cloud | Starts `SWIMSChildProtectionCase` only after the agent returns a successful SWIMS case creation result. |

**Turn contract:** `sender`, `messageId`, `text`, optional media metadata, and recent conversation history enter UiPath. The response contains `reply`, optional `swimsCaseId`, `riskLevel`, and `caseStarted`.

**Conversation rule:** greetings, questions, login exchanges, and incomplete reports remain in the conversational workflow. They do not create Maestro cases. A Maestro case begins only when the agent has created a real SWIMS record.

**Worker authentication:** the agent sends a short-lived HTTPS login link. SWIMS credentials are submitted to the login endpoint, never echoed into WhatsApp, and the resulting encrypted session is associated with the WhatsApp sender.

### API Workflows

| Workflow | Folder | Resource ID (+version) | Inputs → Outputs | Used By Tasks |
|----------|--------|------------------------|------------------|---------------|
| SWIMSAssessment | Shared | `<UNRESOLVED>` | caseId, assessment → error | Record Assessment |
| SWIMSCasePlan | Shared | `<UNRESOLVED>` | caseId, casePlan → error | Record Case Plan |
| SWIMSServiceReferral | Shared | `<UNRESOLVED>` | caseId, referral → error | Add Service Referral |
| SWIMSServiceDelivery | Shared | `<UNRESOLVED>` | caseId, delivery → error | Mark Service Delivered |
| SWIMSFollowup | Shared | `<UNRESOLVED>` | caseId, followup → error | Record Follow-up |
| SWIMSClosure | Shared | `<UNRESOLVED>` | caseId, reason → status, error | Close SWIMS Case |

### Agents

| Agent | Folder | Resource ID (+version) | Inputs → Outputs | Used By Tasks |
|-------|--------|------------------------|------------------|---------------|
| swims-connect-agent | Shared | swims-connect-agent:0.1.2 | messages → messages | WhatsApp Conversation workflow; Validate Intake Report |

### Processes & RPA

> None.

### Child Cases

> None.

### External Agents

> None.
