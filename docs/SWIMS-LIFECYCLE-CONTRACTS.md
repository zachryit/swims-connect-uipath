# SWIMS lifecycle write contracts (build spec for the 6 API workflows)

Authoritative source: `.swimsbot/workspace/scripts/swims-*.js` (the original working bot),
cross-checked against live Primero `/forms` metadata (94 form sections, CP module).
These are the exact REST contracts the 6 UiPath API workflows must reproduce.

## Auth (all calls) — native Devise cookie, 3 steps
Ref: `.swimsbot/.../lib/swims-client.js`. Base = `PRIMERO_API_BASE_URL` (`…/api/v2`).
1. `GET /identity_providers` → capture `CSRF-TOKEN` + `_app_session` from `set-cookie`.
2. `POST /tokens` with header `X-CSRF-Token: <decoded csrf>` + `Cookie: CSRF-TOKEN=…; _app_session=…`, body `{"user":{"user_name","password"}}` → new authed `_app_session`.
3. `GET /identity_providers` with the authed cookie → refresh CSRF (Devise resets session on login).
Then every write sends `Cookie: <authed _app_session>` + `X-CSRF-Token: <decoded refreshed csrf>`.
- **Worker actions** (assessment, case plan, services, follow-up, closure) use the **logged-in worker's** session.
- **Anonymous create** uses the `primero_cp` service account. Anonymous accounts must NOT close/approve.

## Shape
All writes are `PATCH /cases/{id}` with body `{ "data": { … } }` **except** closure-approval.
Subform arrays (`services_section`, `followup_subform_section`, case-plan interventions) **merge by `unique_id`**:
omit `unique_id` ⇒ **append** (non-idempotent — GET + dedup first); include `unique_id` ⇒ **update that row**.
Workflow stage is advanced by writing specific trigger fields (noted per op).

---

### 1. Record Assessment — T35 (`assessment_open` + `assessment_fill`)
`assessment_open` (advances stage → `assessment`): `PATCH /cases/{id}`
```json
{ "data": { "assessment_requested_on": "YYYY-MM-DD", "workflow": "assessment",
            "case_plan_due_date": "YYYY-MM-DD", "assessment_requested_by": "<name?>",
            "protection_concerns": ["<lookup-id>", "..."] } }
```
`assessment_fill` (form content, no stage change): `PATCH /cases/{id}`
```json
{ "data": { "assessment_requested_by": "<name?>", "assessment_safety_threats_present": "<text?>",
            "assessment_safety_protective_capacities": "<text?>",
            "assessment_safety_category": "safe|safety_plan|unsafe",
            "assessment_safety_category_decision": "<rationale?>", "case_plan_due_date": "YYYY-MM-DD" } }
```
`case_plan_due_date` is required (it creates the native Case Plan task).

### 2. Record Case Plan — T37 (`caseplan_open` + `caseplan_intervention_add`)
`caseplan_open` (advances stage → `case_plan`; `date_case_plan` is the trigger): `PATCH /cases/{id}`
```json
{ "data": { "date_case_plan": "YYYY-MM-DD", "workflow": "case_plan",
            "case_plan_goal": "<select?>", "case_plan_goal_due_date": "YYYY-MM-DD?",
            "case_plan_target_review_date": "YYYY-MM-DD?" } }
```
`caseplan_intervention_add` (append to `cp_case_plan_subform_case_plan_interventions`; GET+dedup by service name):
```json
{ "data": { "cp_case_plan_subform_case_plan_interventions": [
  { "intervention_service_to_be_provided": "<name>", "intervention_service_goal": "<goal?>",
    "case_plan_provider_and_contact_details": "<provider?>", "case_plan_timeframe": "YYYY-MM-DD?" } ] } }
```

### 3. Add Service Referral — T39 (`service_add`)
Append to `services_section` (GET+dedup); a new not-implemented service sets stage → `service_provision`:
```json
{ "data": { "workflow": "service_provision", "services_section": [
  { "service_type": "<e.g. health_medical_service>", "service_implemented": "not_implemented",
    "service_response_type": "service_provision", "service_response_day_time": "<ISO now>",
    "service_response_timeframe": "1_hour|3_hours|1_day|3_days",
    "service_appointment_date": "YYYY-MM-DD", "service_referral_notes": "<notes?>",
    "service_provider": "<provider?>" } ] } }
```

### 4. Mark Service Delivered — T41 (`service_implement`)
GET case → find target in `services_section` by `unique_id` (or first not-implemented of a `service_type`) →
echo it back **with its `unique_id`**, setting:
```json
{ "data": { "services_section": [
  { "unique_id": "<existing>", "...existing fields...": "...",
    "service_implemented": "implemented", "service_implemented_day_time": "YYYY-MM-DDT12:00:00.000Z" } ] } }
```
Both the flag AND the day-time are required to advance. If this is the **last** unimplemented service, also send `"workflow": "services_implemented"`.

### 5. Record Follow-up — T43 (`followup_add` + `followup_update`)
`followup_add` (append to `followup_subform_section`; GET+dedup): `PATCH /cases/{id}`
```json
{ "data": { "followup_subform_section": [
  { "followup_type": "<select?>", "followup_service_type": "<select?>",
    "followup_needed_by_date": "YYYY-MM-DD?", "followup_date": "YYYY-MM-DD?",
    "followup_comments": "<text?>" } ] } }
```
At least one of `followup_needed_by_date` (planned) or `followup_date` (completed) required.
`followup_update` (GET → find by `unique_id`/type → echo back with `unique_id` + changed fields).

### 6. Close SWIMS Case — T45 (`case_close`; on 403 → `case_request_closure_approval`)
`case_close` — **note `record_action` is a sibling of `data`, not inside it**: `PATCH /cases/{id}`
```json
{ "data": { "status": "closed", "closure_reason": "<lookup?>" }, "record_action": "close" }
```
Requires CLOSE permission (CP Manager / CP Administrator). A CP Case Worker gets **403** →
fall back to `case_request_closure_approval`: `PATCH /cases/{id}/approvals/closure`
```json
{ "data": { "approval_status": "requested", "notes": "<reason?>" } }
```
This does not close the case; it sets `approval_status_closure` pending and alerts the manager.

---

## Maestro mapping notes
- These 6 become the API-workflow tasks T35/37/39/41/43/45; each takes `caseId` + its fields,
  returns the updated record / status, and writes errors to `lastWriteError`.
- The worker session ↔ Maestro: the human approval (Action App) identifies the acting worker;
  the API workflow uses that worker's SWIMS credentials/session (not the anon account).
- Workflow-stage strings (`assessment`/`case_plan`/`service_provision`/`services_implemented`/closed)
  align with the case plan's stage-exit conditions in `caseplan.json`.
