# Step 4-5 Workflow V2

## Goal
Lock the workflow so `step 4` is the backoffice prep step and `step 5` is the assignment/execution step.

## Product decision lock
- `step 4` owns backoffice prep only
- `step 4` is complete when the package is ready to assign
- `step 5` owns assignment execution only
- `step 5` must not allow brief editing
- `step 5` may allow revision of submitted work, but not revision of the underlying brief
- There is no backward transition from `step 5` to `step 4`
- If the brief/package is wrong at a level that invalidates the assignment, the current assignment flow should be closed or replaced and a new round should start from `step 4`

## Source of truth
- Step 4 prep source of truth: `field_pack.status`
- Step 4 UX labels:
  - `draft` -> `ยังจัด brief`
  - `ready_for_field` -> `พร้อมมอบหมาย`
- Step 5 execution source of truth: existing assignment/submission/deliverable state machine
- Step 5 UX labels:
  - `กำลังลงหน้างาน`
  - `ลงหน้างานแล้ว`
- Current backend assignment states may remain more granular than the 2 step-5 labels; that mapping is an implementation concern, not a reason to blur step ownership

## Step ownership
### Step 4: จัด brief และเตรียมมอบหมาย
Owns:
- brief for field work
- prep checklist/warnings
- field assets/files used for prep
- final backoffice decision that the package is ready to assign

Does not own:
- assignment execution tracking
- submission review as an assignment activity
- revision cycles of returned work
- editorial/publication work

### Step 5: มอบหมายและติดตามงาน
Owns:
- assignment creation
- assignment execution tracking
- submission / deliverable handling
- revision of submitted work
- waiting for field data to return

Does not own:
- brief editing
- source/reference package redesign
- changing assignment back into a prep/readiness gate

## Step 4 state-to-action map
### `ยังจัด brief` (`draft`)
- Primary action: `ตั้งเป็นพร้อมมอบหมาย`
- Secondary actions:
  - `บันทึก brief`
  - `ดูไฟล์จากงานนี้`

### `พร้อมมอบหมาย` (`ready_for_field`)
- Primary action: `ไปงานมอบหมาย`
- Secondary actions:
  - `บันทึก brief`
  - `ดูไฟล์จากงานนี้`

## Step 5 state model
### `กำลังลงหน้างาน`
- The assignment has started and is still awaiting returned work or revision completion
- This may cover multiple backend states internally; UX should still present a single execution-in-progress state

### `ลงหน้างานแล้ว`
- The assignee has returned the work for this round and the work is in the returned/completed side of the execution flow
- This may still include review/accept/close actions, but it must not reopen brief editing

## Step 5 actions
- Read-only brief/package from step 4
- Create/assign work
- Track execution state
- Receive submissions/deliverables
- Request revisions on returned work
- Close work when complete

## Transition rules
### Step 4 -> Step 5
Allowed when a human explicitly decides the package is ready to assign.

Expected signals:
- field brief is usable
- field assets/references are sufficient
- prep warnings are resolved enough to assign work

This remains an action gate, not a navigation gate.

### No Step 5 -> Step 4 backward transition
- `step 5` must not edit the brief
- `step 5` may request revision of submitted work only
- If the brief/package is wrong enough that the work can no longer continue on the same basis, the system should:
  - stop or close the current assignment round
  - start a new round from `step 4`
- This is a new round, not a workflow rewind

## Guarding rules
- Upstream readiness may block actions, not page entry
- Direct entry to step 4 and step 5 should remain possible
- Disabled actions must explain why
- Do not redirect users back to step 4 from step 5
- Do not allow step 5 to mutate the brief/package

## Permission matrix
### `owner`
- Step 4: full access
- Step 5: full access

### `admin`
- Step 4: full access
- Step 5: full access

### `editor`
- Step 4: can edit prep data only as backend allows
- Step 5: can use assignment execution actions only as backend allows

### `user`
- Can open step 4 and step 5 if item-level access allows
- Step 4 prep actions remain limited by existing backend permission rules until a later round changes them explicitly
- Step 5 execution actions remain limited by existing backend permission rules until a later round changes them explicitly

## Non-goals in this spec round
- no schema change
- no repository rewrite
- no new workflow model separate from `field_pack.status` / existing assignment states
- no backend permission expansion in this round
- no editorial/publication workspace design in this round

## Implementation boundaries for next rounds
### Round 2
- step 4 UX only
- reduce step 4 state UI to `ยังจัด brief / พร้อมมอบหมาย`
- keep writer-side prep secondary or move it out later

### Round 3
- step 5 UX only
- use assignment/execution language only
- represent step-5 execution with `กำลังลงหน้างาน / ลงหน้างานแล้ว`
- keep brief read-only

### Round 4
- integration pass
- regression audit for navigation, state guard, role permissions, and no-brief-edit policy

## Audit guardrails
Reviewers should verify:
- step 4 owns prep and ends at `พร้อมมอบหมาย`
- step 5 owns assignment execution and does not edit the brief
- no backward transition exists from step 5 to step 4
- if a brief is invalid, the system creates a new round instead of rewinding the old one
- role/permission behavior in UI does not drift from backend enforcement
