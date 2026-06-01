# Assignment Scope V2

## Goal
Lock `assignment` to execution-only responsibility.

`assignment` is not a content-quality gate, not a field-pack readiness gate, and not a handoff-governance gate.

## Product decision lock
- content preparation must finish in `step 4` before assignment
- `step 4` ends when the package is `พร้อมมอบหมาย`
- `step 5` owns assignment execution only
- `step 5` must not edit the brief
- `step 5` may request revision of submitted work only
- if the brief/package is wrong at a level that invalidates the assignment, the current assignment should be closed or replaced and a new round should start from `step 4`
- no workflow rewind from `step 5` back to `step 4` is allowed

## Assignment page purpose
The assignment page answers:
- who is doing this work
- when it is due
- what the current execution state is
- what has been submitted
- whether revision of submitted work is needed

The assignment page must not answer:
- whether the brief is still correct
- whether content is ready for handoff
- whether field-pack content is complete
- whether references / media hints / checklists are sufficient
- whether readiness snapshots or execution-channel metadata are complete

## Scope in
### Execution setup
- assignee selection
- due date
- short assignment note

### Execution tracking
- assignment state
- submission state
- deliverable state
- overdue / still waiting / revision requested summary
- UX grouping for execution progress:
  - `กำลังลงหน้างาน`
  - `ลงหน้างานแล้ว`

### Work return
- submission payloads
- deliverable uploads
- review / request revision / accept completion

## Scope out
- all brief editing
- `ready_for_handoff`
- `not ready_for_handoff`
- force override handoff
- force reason
- handoff governance
- readiness snapshot blockers
- execution-controls snapshot blockers
- execution-channel blockers
- field-pack completeness checks
- brief completeness checks
- source/reference completeness checks
- media-hint completeness checks
- workflow rewind from `step 5` back to `step 4`

## New hard-block policy
Assignment creation should hard-block only when:
- `content_item_id` is missing or invalid
- assignee is missing
- actor permission is insufficient
- assignment ownership/scope is invalid
- required execution payload for assignment creation is structurally missing

Assignment creation should not hard-block because:
- field pack is still `draft`
- readiness snapshot is missing
- execution controls snapshot is missing
- execution channel is missing
- brief warnings remain
- source/reference warnings remain

## Warning policy
Warnings may remain on assignment for execution management only:
- due date is empty
- note is empty
- no submission yet
- deliverables still incomplete
- assignment is overdue
- revision is still pending

Warnings about content preparation must stay in `step 4`.

## Brief mutation policy
- The brief/package shown in assignment must be read-only
- Revision in assignment means revision of returned work only
- If someone decides the brief itself must change, the current assignment round must stop and a new round must begin from `step 4`

## Source of truth
- content/brief readiness source of truth: `step 4` / field-pack preparation flow
- assignment execution source of truth: assignment/submission/deliverable tables and APIs

## UI policy
Assignment UI must use execution language only:
- `มอบหมายงาน`
- `ผู้รับงาน`
- `กำหนดส่ง`
- `สถานะงาน`
- `ส่งงานกลับ`
- `ขอแก้ไข`
- `ปิดงาน`

Assignment UI must avoid readiness language:
- handoff
- ready for handoff
- force override
- governance
- snapshot missing
- brief rewind

## Migration targets
### Remove from assignment UI
- force override controls
- force reason controls
- handoff-readiness error block
- content-preparation warning copy
- any summary that repeats step-4 readiness checks
- any editable brief controls

### Move to previous step
- all field-pack readiness warnings
- all brief completeness warnings
- all source/reference/media-hint completeness warnings
- all handoff gating copy

### Keep in assignment
- assignee controls
- due date controls
- assignment note
- execution status widgets
- submission / deliverable review widgets

## Backend migration target
Assignment creation must stop depending on readiness-gated create flows.

Preferred end state:
- assignment creation uses an execution-only path
- readiness checks remain in `step 4` only
- assignment keeps the brief read-only

## Audit guardrails
Reviewers should verify:
- no assignment create flow still depends on `ready_for_handoff`
- no UI in assignment still exposes `force_override` or `force_reason`
- no assignment screen repeats content-readiness warnings from `step 4`
- assignment errors are execution-related, not content-preparation-related
- assignment does not mutate the brief
- step 5 does not implement a backward transition to step 4

## Round boundary
This round is documentation/spec only.

No runtime behavior changes in this round:
- no backend route change
- no UI removal yet
- no repository change yet
- no test rewrite yet
