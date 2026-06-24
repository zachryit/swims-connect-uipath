# SWIMSChildProtectionCase — Implementation Tasks

Source of truth: `sdd.md`. Registry resolution evidence: `tasks/registry-resolved.json`.

## Inventory

- Case roots: 1
- Case triggers: 1
- Channel ingress integrations: 1
- Variables: 21
- Stages: 7
- Tasks: 14
- Conditions: 29 (7 stage-entry, 7 stage-exit, 14 task-entry, 1 case-exit)
- SLA operations: 24 (8 defaults, 16 escalations)
- Total implementation entries: 98
- Unresolved integrations are retained as structural placeholders; IDs are never fabricated.

## Case and triggers

## T01: Create case file "SWIMSChildProtectionCase"
- file: `SWIMSChildProtectionCase/SWIMSChildProtectionCase/caseplan.json`
- case-identifier: `SWM`
- identifier-type: constant
- case-app-enabled: true
- directly-pass-task-outputs: true
- description: Manage a Ghana SWIMS child-protection case from intake through manager-approved closure.
- order: first
- verify: Case scaffold parses; case ID matches schema; empty nodes and edges before later entries.

## T02: Configure manual trigger "Start SWIMS case"
- display-name: Start SWIMS case
- description: A worker or reporter starts a case from the Case App.
- order: after T01
- verify: Trigger node and entry point exist; capture TriggerId.

## T03: Configure WhatsApp conversation API ingress
- integration-type: Orchestrator API trigger
- channel-adapter: repository-owned Baileys gateway
- linked-number: `+233256590242`
- target: UiPath `WhatsAppConversation` Maestro Flow
- request-contract: sender, messageId, text, optional media metadata, conversation history
- response-contract: reply, optional swimsCaseId, riskLevel, caseStarted
- case-start-rule: Start T02 only after the agent successfully creates a real SWIMS record.
- order: after T02
- verify: An inbound WhatsApp message reaches a UiPath cloud job, receives the UiPath agent reply, and does not open a Maestro case until `swimsCaseId` exists.

## Variables

## T04: Declare In-argument "reportNarrative"
- category: In
- type: string
- triggerRef: T02
- default: ""
- verify: Formal input, companion, and manual-trigger bridge exist.

## T05: Declare In-argument "sourceChannel"
- category: In
- type: string
- triggerRef: T02
- default: manual
- verify: Formal input, companion, and manual-trigger bridge exist.

## T06: Declare In-argument "reporterContact"
- category: In
- type: string
- triggerRef: T02
- default: ""
- verify: Formal input, companion, and manual-trigger bridge exist.

## T07: Declare In-argument "followUpAllowed"
- category: In
- type: boolean
- triggerRef: T02
- default: false
- verify: Formal input, companion, and manual-trigger bridge exist.

## T08: Declare Variable "agentResult"
- category: Variable
- type: jsonSchema
- default: ""
- verify: Root inputOutputs companion exists; no formal input.

## T09: Declare In-argument "swimsCaseId"
- category: In
- type: string
- triggerRef: T02
- default: ""
- verify: Formal input, companion, and case-start bridge exist.

## T10: Declare In-argument "riskLevel"
- category: In
- type: string
- triggerRef: T02
- default: medium
- verify: Formal input, companion, and case-start bridge exist with default.

## T11: Declare Out-argument "caseStatus"
- category: Out
- type: string
- default: open
- producedBy: T45.outputs.status
- verify: Formal output and companion exist; producer binding is validated.

## T12: Declare Variable "assessmentDecision"
- category: Variable
- type: string
- default: Pending
- verify: Root companion exists.

## T13: Declare Variable "assessmentData"
- category: Variable
- type: jsonSchema
- default: ""
- verify: Root companion exists.

## T14: Declare Variable "casePlanDecision"
- category: Variable
- type: string
- default: Pending
- verify: Root companion exists.

## T15: Declare Variable "casePlanData"
- category: Variable
- type: jsonSchema
- default: ""
- verify: Root companion exists.

## T16: Declare Variable "referralDecision"
- category: Variable
- type: string
- default: Pending
- verify: Root companion exists.

## T17: Declare Variable "referralData"
- category: Variable
- type: jsonSchema
- default: ""
- verify: Root companion exists.

## T18: Declare Variable "deliveryDecision"
- category: Variable
- type: string
- default: Pending
- verify: Root companion exists.

## T19: Declare Variable "deliveryData"
- category: Variable
- type: jsonSchema
- default: ""
- verify: Root companion exists.

## T20: Declare Variable "followupDecision"
- category: Variable
- type: string
- default: Pending
- verify: Root companion exists.

## T21: Declare Variable "followupData"
- category: Variable
- type: jsonSchema
- default: ""
- verify: Root companion exists.

## T22: Declare Variable "closureDecision"
- category: Variable
- type: string
- default: Pending
- verify: Root companion exists.

## T23: Declare Variable "closureReason"
- category: Variable
- type: string
- default: ""
- verify: Root companion exists.

## T24: Declare Variable "lastWriteError"
- category: Variable
- type: string
- default: ""
- verify: Root companion exists.

## Stages

## T25: Add stage "Intake"
- type: stage
- required: true
- description: Extract and file the protection report and retain the real SWIMS Case ID.
- order: after T24
- verify: Capture StageId; stage is required.

## T26: Add stage "Assessment"
- type: stage
- required: true
- description: Capture and record the worker-confirmed safety assessment.
- order: after T25
- verify: Capture StageId; stage is required.

## T27: Add stage "Case Plan"
- type: stage
- required: true
- description: Confirm and record goals, interventions, and tracking dates.
- order: after T26
- verify: Capture StageId; stage is required.

## T28: Add stage "Service Referral"
- type: stage
- required: true
- description: Confirm and record a trackable service referral.
- order: after T27
- verify: Capture StageId; stage is required.

## T29: Add stage "Service Delivery"
- type: stage
- required: true
- description: Confirm implementation and mark referred services delivered.
- order: after T28
- verify: Capture StageId; stage is required.

## T30: Add exception stage "Follow-up"
- type: exception
- required: false
- interrupting: false
- description: Record repeatable follow-up work without replacing the main lifecycle.
- order: after T29
- verify: Capture StageId; exception stage is non-required and non-interrupting.

## T31: Add stage "Closure"
- type: stage
- required: true
- description: Obtain manager approval and close the source SWIMS case.
- order: after T30
- verify: Capture StageId; stage is required.

## Stage tasks

## T32: Add agent task "Validate Intake Report" to "Intake"
- target-stage: Intake
- task-type: agent
- task-type-id: `<UNRESOLVED: agent entity key unavailable because registry pull returned 401>`
- verified-package: `swims-connect-agent:0.1.2` in Shared
- required: true
- run-only-once: true
- description: Validate the confirmed intake payload, real SWIMS Case ID, risk and protection concerns before governed case work begins.
- wiring-after-attachment: Send swimsCaseId plus reportNarrative to the agent; output messages to agentResult; retain the supplied swimsCaseId and update riskLevel only after schema validation.
- verify: Placeholder preserves task structure and verified package identity without inventing an entity key.

## T33: Add action task "Review Worker Intake" to "Intake"
- target-stage: Intake
- task-type: action
- action-app-id: `<UNRESOLVED: SWIMS Worker Review Action App not deployed>`
- action-type: IntakeReview
- folder: Shared
- recipient: Role:Case Worker
- priority: High
- task-sla: 4 h
- required: false
- run-only-once: true
- wiring-after-attachment: reportNarrative and agentResult inputs; Action output to assessmentDecision.
- verify: Placeholder exists; no fabricated action schema or resource ID.

## T34: Add action task "Review Assessment" to "Assessment"
- target-stage: Assessment
- task-type: action
- action-app-id: `<UNRESOLVED: SWIMS Worker Review Action App not deployed>`
- action-type: AssessmentReview
- folder: Shared
- recipient: Role:Case Worker
- priority: High
- task-sla: 2 d
- required: true
- run-only-once: false
- wiring-after-attachment: swimsCaseId and assessmentData inputs; Action to assessmentDecision; assessmentData to assessmentData.
- verify: Placeholder exists without fabricated action metadata.

## T35: Add API-workflow task "Record Assessment" to "Assessment"
- target-stage: Assessment
- task-type: api-workflow
- task-type-id: `<UNRESOLVED: SWIMSAssessment resource ID unavailable>`
- folder: Shared
- operation: assessment_fill + assessment_open
- required: true
- run-only-once: false
- wiring-after-attachment: caseId and assessment inputs; error to lastWriteError.
- verify: Placeholder exists without fabricated inputs, outputs, or resource ID.

## T36: Add action task "Review Case Plan" to "Case Plan"
- target-stage: Case Plan
- task-type: action
- action-app-id: `<UNRESOLVED: SWIMS Worker Review Action App not deployed>`
- action-type: CasePlanReview
- folder: Shared
- recipient: Role:Case Worker
- priority: High
- task-sla: 5 d
- required: true
- run-only-once: false
- wiring-after-attachment: swimsCaseId and casePlanData inputs; Action to casePlanDecision; casePlanData to casePlanData.
- verify: Placeholder exists without fabricated action metadata.

## T37: Add API-workflow task "Record Case Plan" to "Case Plan"
- target-stage: Case Plan
- task-type: api-workflow
- task-type-id: `<UNRESOLVED: SWIMSCasePlan resource ID unavailable>`
- folder: Shared
- operation: caseplan_open + caseplan_intervention_add
- required: true
- run-only-once: false
- wiring-after-attachment: caseId and casePlan inputs; error to lastWriteError.
- verify: Placeholder exists without fabricated contract data.

## T38: Add action task "Review Service Referral" to "Service Referral"
- target-stage: Service Referral
- task-type: action
- action-app-id: `<UNRESOLVED: SWIMS Worker Review Action App not deployed>`
- action-type: ReferralReview
- folder: Shared
- recipient: Role:Case Worker
- priority: High
- task-sla: 2 d
- required: true
- run-only-once: false
- wiring-after-attachment: swimsCaseId and referralData inputs; Action to referralDecision; referralData to referralData.
- verify: Placeholder exists without fabricated action metadata.

## T39: Add API-workflow task "Add Service Referral" to "Service Referral"
- target-stage: Service Referral
- task-type: api-workflow
- task-type-id: `<UNRESOLVED: SWIMSServiceReferral resource ID unavailable>`
- folder: Shared
- operation: service_add
- required: true
- run-only-once: false
- wiring-after-attachment: caseId and referral inputs; error to lastWriteError.
- verify: Placeholder exists without fabricated contract data.

## T40: Add action task "Confirm Service Delivery" to "Service Delivery"
- target-stage: Service Delivery
- task-type: action
- action-app-id: `<UNRESOLVED: SWIMS Worker Review Action App not deployed>`
- action-type: DeliveryConfirmation
- folder: Shared
- recipient: Role:Case Worker
- priority: High
- task-sla: 5 d
- required: true
- run-only-once: false
- wiring-after-attachment: swimsCaseId and deliveryData inputs; Action to deliveryDecision; deliveryData to deliveryData.
- verify: Placeholder exists without fabricated action metadata.

## T41: Add API-workflow task "Mark Service Delivered" to "Service Delivery"
- target-stage: Service Delivery
- task-type: api-workflow
- task-type-id: `<UNRESOLVED: SWIMSServiceDelivery resource ID unavailable>`
- folder: Shared
- operation: service_implement
- required: true
- run-only-once: false
- wiring-after-attachment: caseId and delivery inputs; error to lastWriteError.
- verify: Placeholder exists without fabricated contract data.

## T42: Add action task "Review Follow-up" to "Follow-up"
- target-stage: Follow-up
- task-type: action
- action-app-id: `<UNRESOLVED: SWIMS Worker Review Action App not deployed>`
- action-type: FollowupReview
- folder: Shared
- recipient: Role:Case Worker
- priority: Medium
- task-sla: 2 d
- required: true
- run-only-once: false
- wiring-after-attachment: swimsCaseId and followupData inputs; Action to followupDecision; followupData to followupData.
- verify: Placeholder exists without fabricated action metadata.

## T43: Add API-workflow task "Record Follow-up" to "Follow-up"
- target-stage: Follow-up
- task-type: api-workflow
- task-type-id: `<UNRESOLVED: SWIMSFollowup resource ID unavailable>`
- folder: Shared
- operation: followup_add + followup_update
- required: true
- run-only-once: false
- wiring-after-attachment: caseId and followup inputs; error to lastWriteError.
- verify: Placeholder exists without fabricated contract data.

## T44: Add action task "Manager Closure Approval" to "Closure"
- target-stage: Closure
- task-type: action
- action-app-id: `<UNRESOLVED: SWIMS Manager Approval Action App not deployed>`
- action-type: ClosureApproval
- folder: Shared
- recipient: Role:CP Manager
- priority: Critical
- task-sla: 2 d
- required: true
- run-only-once: false
- wiring-after-attachment: swimsCaseId, closureReason, and deliveryData inputs; Action to closureDecision; closureReason to closureReason.
- verify: Placeholder exists without fabricated action metadata.

## T45: Add API-workflow task "Close SWIMS Case" to "Closure"
- target-stage: Closure
- task-type: api-workflow
- task-type-id: `<UNRESOLVED: SWIMSClosure resource ID unavailable>`
- folder: Shared
- operation: case_close; on 403 use case_request_closure_approval and do not retry silently
- required: true
- run-only-once: false
- wiring-after-attachment: caseId and reason inputs; status to caseStatus; error to lastWriteError.
- verify: Placeholder exists without fabricated contract data.

## Conditions

## T46: Add stage-entry condition for "Intake"
- target-stage: Intake
- display-name: Start intake
- rule-type: case-entered
- interrupting: false
- order: after T45
- verify: Capture ConditionId.

## T47: Add stage-entry condition for "Assessment"
- target-stage: Assessment
- display-name: Intake completed
- rule-type: selected-stage-completed
- selected-stage: Intake
- interrupting: false
- order: after T46
- verify: Capture ConditionId.

## T48: Add stage-entry condition for "Case Plan"
- target-stage: Case Plan
- display-name: Assessment completed
- rule-type: selected-stage-completed
- selected-stage: Assessment
- interrupting: false
- order: after T47
- verify: Capture ConditionId.

## T49: Add stage-entry condition for "Service Referral"
- target-stage: Service Referral
- display-name: Plan completed
- rule-type: selected-stage-completed
- selected-stage: Case Plan
- interrupting: false
- order: after T48
- verify: Capture ConditionId.

## T50: Add stage-entry condition for "Service Delivery"
- target-stage: Service Delivery
- display-name: Referral created
- rule-type: selected-stage-completed
- selected-stage: Service Referral
- interrupting: false
- order: after T49
- verify: Capture ConditionId.

## T51: Add stage-entry condition for "Follow-up"
- target-stage: Follow-up
- display-name: Add follow-up
- rule-type: user-selected-stage
- interrupting: false
- order: after T50
- verify: Capture ConditionId.

## T52: Add stage-entry condition for "Closure"
- target-stage: Closure
- display-name: Services completed
- rule-type: selected-stage-completed
- selected-stage: Service Delivery
- interrupting: false
- order: after T51
- verify: Capture ConditionId.

## T53: Add stage-exit condition for "Intake"
- target-stage: Intake
- display-name: Intake filed
- rule-type: required-tasks-completed
- marks-stage-complete: true
- exit-type: exit-only
- condition-expression: `=js:(vars.swimsCaseId != null && vars.swimsCaseId !== "")`
- order: after T52
- verify: Capture ConditionId.

## T54: Add stage-exit condition for "Assessment"
- target-stage: Assessment
- display-name: Assessment recorded
- rule-type: required-tasks-completed
- marks-stage-complete: true
- exit-type: exit-only
- condition-expression: `=js:(vars.assessmentDecision === "Approved")`
- order: after T53
- verify: Capture ConditionId.

## T55: Add stage-exit condition for "Case Plan"
- target-stage: Case Plan
- display-name: Case plan recorded
- rule-type: required-tasks-completed
- marks-stage-complete: true
- exit-type: exit-only
- condition-expression: `=js:(vars.casePlanDecision === "Approved")`
- order: after T54
- verify: Capture ConditionId.

## T56: Add stage-exit condition for "Service Referral"
- target-stage: Service Referral
- display-name: Referral recorded
- rule-type: required-tasks-completed
- marks-stage-complete: true
- exit-type: exit-only
- condition-expression: `=js:(vars.referralDecision === "Approved")`
- order: after T55
- verify: Capture ConditionId.

## T57: Add stage-exit condition for "Service Delivery"
- target-stage: Service Delivery
- display-name: All services delivered
- rule-type: required-tasks-completed
- marks-stage-complete: true
- exit-type: exit-only
- condition-expression: `=js:(vars.deliveryDecision === "Confirmed")`
- order: after T56
- verify: Capture ConditionId.

## T58: Add stage-exit condition for "Follow-up"
- target-stage: Follow-up
- display-name: Follow-up recorded
- rule-type: required-tasks-completed
- marks-stage-complete: true
- exit-type: return-to-origin
- condition-expression: `=js:(vars.followupDecision === "Approved")`
- order: after T57
- verify: Capture ConditionId.

## T59: Add stage-exit condition for "Closure"
- target-stage: Closure
- display-name: Manager-approved closure
- rule-type: required-tasks-completed
- marks-stage-complete: true
- exit-type: exit-only
- condition-expression: `=js:(vars.closureDecision === "Approved" && vars.caseStatus === "closed")`
- order: after T58
- verify: Capture ConditionId.

## T60: Add task-entry condition for "Validate Intake Report"
- target-stage: Intake
- target-task: Validate Intake Report
- display-name: Validate confirmed intake
- rule-type: current-stage-entered
- order: after T59
- verify: Capture ConditionId.

## T61: Add task-entry condition for "Review Worker Intake"
- target-stage: Intake
- target-task: Review Worker Intake
- display-name: Review worker report
- rule-type: selected-tasks-completed
- selected-tasks: Validate Intake Report
- condition-expression: `=js:(vars.sourceChannel === "worker")`
- order: after T60
- verify: Capture ConditionId.

## T62: Add task-entry condition for "Review Assessment"
- target-stage: Assessment
- target-task: Review Assessment
- display-name: Draft assessment
- rule-type: current-stage-entered
- order: after T61
- verify: Capture ConditionId.

## T63: Add task-entry condition for "Record Assessment"
- target-stage: Assessment
- target-task: Record Assessment
- display-name: Save assessment
- rule-type: selected-tasks-completed
- selected-tasks: Review Assessment
- condition-expression: `=js:(vars.assessmentDecision === "Approved")`
- order: after T62
- verify: Capture ConditionId.

## T64: Add task-entry condition for "Review Case Plan"
- target-stage: Case Plan
- target-task: Review Case Plan
- display-name: Review plan
- rule-type: current-stage-entered
- order: after T63
- verify: Capture ConditionId.

## T65: Add task-entry condition for "Record Case Plan"
- target-stage: Case Plan
- target-task: Record Case Plan
- display-name: Save case plan
- rule-type: selected-tasks-completed
- selected-tasks: Review Case Plan
- condition-expression: `=js:(vars.casePlanDecision === "Approved")`
- order: after T64
- verify: Capture ConditionId.

## T66: Add task-entry condition for "Review Service Referral"
- target-stage: Service Referral
- target-task: Review Service Referral
- display-name: Review referral
- rule-type: current-stage-entered
- order: after T65
- verify: Capture ConditionId.

## T67: Add task-entry condition for "Add Service Referral"
- target-stage: Service Referral
- target-task: Add Service Referral
- display-name: Save referral
- rule-type: selected-tasks-completed
- selected-tasks: Review Service Referral
- condition-expression: `=js:(vars.referralDecision === "Approved")`
- order: after T66
- verify: Capture ConditionId.

## T68: Add task-entry condition for "Confirm Service Delivery"
- target-stage: Service Delivery
- target-task: Confirm Service Delivery
- display-name: Confirm delivery
- rule-type: current-stage-entered
- order: after T67
- verify: Capture ConditionId.

## T69: Add task-entry condition for "Mark Service Delivered"
- target-stage: Service Delivery
- target-task: Mark Service Delivered
- display-name: Record delivery
- rule-type: selected-tasks-completed
- selected-tasks: Confirm Service Delivery
- condition-expression: `=js:(vars.deliveryDecision === "Confirmed")`
- order: after T68
- verify: Capture ConditionId.

## T70: Add task-entry condition for "Review Follow-up"
- target-stage: Follow-up
- target-task: Review Follow-up
- display-name: Review follow-up
- rule-type: current-stage-entered
- order: after T69
- verify: Capture ConditionId.

## T71: Add task-entry condition for "Record Follow-up"
- target-stage: Follow-up
- target-task: Record Follow-up
- display-name: Save follow-up
- rule-type: selected-tasks-completed
- selected-tasks: Review Follow-up
- condition-expression: `=js:(vars.followupDecision === "Approved")`
- order: after T70
- verify: Capture ConditionId.

## T72: Add task-entry condition for "Manager Closure Approval"
- target-stage: Closure
- target-task: Manager Closure Approval
- display-name: Review closure
- rule-type: current-stage-entered
- order: after T71
- verify: Capture ConditionId.

## T73: Add task-entry condition for "Close SWIMS Case"
- target-stage: Closure
- target-task: Close SWIMS Case
- display-name: Close case
- rule-type: selected-tasks-completed
- selected-tasks: Manager Closure Approval
- condition-expression: `=js:(vars.closureDecision === "Approved")`
- order: after T72
- verify: Capture ConditionId.

## T74: Add case-exit condition "Case safely closed"
- display-name: Case safely closed
- marks-case-complete: true
- rule-type: required-stages-completed
- condition-expression: `=js:(vars.closureDecision === "Approved" && vars.caseStatus === "closed")`
- order: after T73
- verify: Capture ConditionId; completion requires all required stages.

## SLA and escalations

> Directory identity lookup could not be completed with the External App (401). Recipient groups therefore remain explicit placeholders approved for this skeleton build.

## T75: Set default SLA for root to 30 d
- target: root
- count: 30
- unit: d
- order: after T74
- verify: Root default SLA expression is `=js:true`.

## T76: Add root at-risk escalation
- target: root
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 80
- recipients: UserGroup: `<UNRESOLVED: group UUID for Case Worker>` / Case Worker
- order: after T75
- verify: Escalation exists without fabricated UUID.

## T77: Add root breach escalation
- target: root
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T76
- verify: Escalation exists without fabricated UUID.

## T78: Set default SLA for "Intake" to 4 h
- target: Intake
- count: 4
- unit: h
- order: after T77
- verify: Stage default SLA exists.

## T79: Add "Intake" at-risk escalation
- target: Intake
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 75
- recipients: UserGroup: `<UNRESOLVED: group UUID for Case Worker>` / Case Worker
- order: after T78
- verify: Escalation exists without fabricated UUID.

## T80: Add "Intake" breach escalation
- target: Intake
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T79
- verify: Escalation exists without fabricated UUID.

## T81: Set default SLA for "Assessment" to 3 d
- target: Assessment
- count: 3
- unit: d
- order: after T80
- verify: Stage default SLA exists.

## T82: Add "Assessment" at-risk escalation
- target: Assessment
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 75
- recipients: UserGroup: `<UNRESOLVED: group UUID for Case Worker>` / Case Worker
- order: after T81
- verify: Escalation exists without fabricated UUID.

## T83: Add "Assessment" breach escalation
- target: Assessment
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T82
- verify: Escalation exists without fabricated UUID.

## T84: Set default SLA for "Case Plan" to 7 d
- target: Case Plan
- count: 7
- unit: d
- order: after T83
- verify: Stage default SLA exists.

## T85: Add "Case Plan" at-risk escalation
- target: Case Plan
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 75
- recipients: UserGroup: `<UNRESOLVED: group UUID for Case Worker>` / Case Worker
- order: after T84
- verify: Escalation exists without fabricated UUID.

## T86: Add "Case Plan" breach escalation
- target: Case Plan
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T85
- verify: Escalation exists without fabricated UUID.

## T87: Set default SLA for "Service Referral" to 3 d
- target: Service Referral
- count: 3
- unit: d
- order: after T86
- verify: Stage default SLA exists.

## T88: Add "Service Referral" at-risk escalation
- target: Service Referral
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 75
- recipients: UserGroup: `<UNRESOLVED: group UUID for Case Worker>` / Case Worker
- order: after T87
- verify: Escalation exists without fabricated UUID.

## T89: Add "Service Referral" breach escalation
- target: Service Referral
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T88
- verify: Escalation exists without fabricated UUID.

## T90: Set default SLA for "Service Delivery" to 7 d
- target: Service Delivery
- count: 7
- unit: d
- order: after T89
- verify: Stage default SLA exists.

## T91: Add "Service Delivery" at-risk escalation
- target: Service Delivery
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 75
- recipients: UserGroup: `<UNRESOLVED: group UUID for Case Worker>` / Case Worker
- order: after T90
- verify: Escalation exists without fabricated UUID.

## T92: Add "Service Delivery" breach escalation
- target: Service Delivery
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T91
- verify: Escalation exists without fabricated UUID.

## T93: Set default SLA for "Follow-up" to 3 d
- target: Follow-up
- count: 3
- unit: d
- order: after T92
- verify: Exception-stage default SLA exists.

## T94: Add "Follow-up" at-risk escalation
- target: Follow-up
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 75
- recipients: UserGroup: `<UNRESOLVED: group UUID for Case Worker>` / Case Worker
- order: after T93
- verify: Escalation exists without fabricated UUID.

## T95: Add "Follow-up" breach escalation
- target: Follow-up
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T94
- verify: Escalation exists without fabricated UUID.

## T96: Set default SLA for "Closure" to 3 d
- target: Closure
- count: 3
- unit: d
- order: after T95
- verify: Stage default SLA exists.

## T97: Add "Closure" at-risk escalation
- target: Closure
- attach-to: default
- trigger-type: at-risk
- at-risk-percentage: 75
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Manager>` / CP Manager
- order: after T96
- verify: Escalation exists without fabricated UUID.

## T98: Add "Closure" breach escalation
- target: Closure
- attach-to: default
- trigger-type: sla-breached
- recipients: UserGroup: `<UNRESOLVED: group UUID for CP Administrator>` / CP Administrator
- order: after T97
- verify: Escalation exists without fabricated UUID.

## Completion cross-check

- Expected T-number range: T01–T98, contiguous.
- Every SDD case, trigger, variable, stage, task, condition, and SLA row maps to exactly one entry.
- Build may proceed with placeholders only after this checklist is explicitly approved.
