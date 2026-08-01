# Step 5 mirror scope audit

Audit date: 2026-08-01.  Scope is the current `main` fetched from `origin/main`, before branching.  This is source inspection only: no application code, schema, database, or test was changed/run.  `transport_routes_v2.workflow_status` is a separate transport-route column and is excluded.

The target design says the workflow-head `assignment_state` is a copy of `content_assignments.state`, and says to query assignments instead ([docs/place-workflow-target-design.md:128](../docs/place-workflow-target-design.md#L128)).  It also calls for removing both mirrors and validation-skip flags in step 5 ([docs/place-workflow-target-design.md:177](../docs/place-workflow-target-design.md#L177)).

## A. `content_workflow_models.assignment_state`

### Writes to the workflow-head mirror

| File:line | Current writer | Notes |
|---|---|---|
| `collector/db/repository.mjs:6053-6058` | `createWorkflowHead` inserts `assignmentState` into the head | Seed is `null` unless supplied; it also seeds from legacy `workflow_status` at `:6033-6039`. |
| `collector/db/repository.mjs:6164-6169` | `upsertWorkflowModel` writes the supplied/preserved value | Generic writer reached by the API and repository workflows. |
| `collector/db/repository.mjs:6425-6436` | `syncWorkflowAssignmentStateOnCreate` writes an assignment's initial state to the head | Sync occurs only when the current head state is empty (`:6410-6418`). |
| `collector/db/repository.mjs:6858-6880` | `updateAssignmentStateInternal` mirrors each changed `content_assignments.state` | It writes the assignment first at `:6818-6826`, then writes the workflow head. |
| `collector/db/repository.mjs:10429-10442` | field-rework opening explicitly writes new assignment state (`assigned`) to head | Reconciles after it closes the prior assignment and creates a new one. |
| `collector/server/index.mjs:8827-8834`, `:14312-14319` | create/import routes pass client `workflow_patch.assignment_state` to `createItemWithWorkflowHead` | This permits creation with a head state without an assignment row; whether any caller does so is not established by static inspection. |
| `collector/server/index.mjs:10021-10070` | `/api/items/:id/workflow-model` accepts and passes `assignment_state` directly | Direct independent writer; it is not coupled to `content_assignments.state`. |

Migration/fixture-only writers still reference the column: `collector/scripts/migrate-place-review-flags.mjs:46,62,80,87`; mock seed data sends a value at `collector/scripts/seed-mock-work-stage-jobs.mjs:752`.  They are not request-path runtime writers.

### Readers, and replacement source

| File:line | Reader | Reads head or real assignment? | If mirror is removed |
|---|---|---|---|
| `collector/db/repository.mjs:6109-6190` | validation, change detection and transition history inside `upsertWorkflowModel` | **head** | No longer an assignment-state transition.  Remove this branch; assignment history must be recorded when `content_assignments.state` changes. |
| `collector/db/repository.mjs:6231-6256` | `listItemsByWorkflowHead({ assignment_states })` filter and unknown-state check | **head** | Query/join `content_assignments` using an explicitly defined active-assignment selection. Current code does not define a single-item rule; **ไม่แน่ใจ** whether latest `created_at`, latest active row, or kind-specific row is correct for all callers. |
| `collector/db/repository.mjs:6401-6445` | creation sync checks/preserves head state | **head** | No longer needed: create the assignment with its own `state`; do not sync. |
| `collector/db/repository.mjs:6807-6812,6858-6880` | compares assignment row to head to decide reconciliation | **both** (`content_assignments.state` is source at `:6802`, head is mirror) | Query/use the assignment row already loaded. Keep only real assignment transition validation and the place-production side effect. |
| `collector/db/repository.mjs:8720-8724` | readiness-brief diagnostic payload | **head** | Query the chosen assignment row, or omit it if the brief does not need assignment state. Selection rule is **ไม่แน่ใจ**. |
| `collector/server/index.mjs:1303-1339`, `:1379-1396` | attaches `assignment_state` to item API responses | **head** | Return a derived field from a repository query of the selected assignment, or stop returning it and move consumers to assignment API data. Selection rule is **ไม่แน่ใจ**. |
| `collector/server/index.mjs:2839-2847` | known-state assertion for workflow model | **head** | Remove assignment candidate from workflow-head validation. |
| `collector/server/index.mjs:6901-6912`, `:8760-8764`, `:8801-8805`, `:8827-8834`, `:14314-14318` | create-patch plumbing | **head writer/input** | Remove assignment field from workflow patch; creation of assignment remains the only source. |
| `collector/server/index.mjs:10037-10060` | workflow-model endpoint input/role gate | **head writer/input** | Remove `assignment_state` from endpoint contract. |
| `collector/server/public/app.js:702-728` | dashboard snapshot carries state | API-projected **head** | Use derived API field backed by the selected `content_assignments` row; it is currently not used in the compatibility-status branching. |
| `collector/server/public/article-intake.js:407-470` | queue candidate, prefetch, stage label, group | API-projected **head** | Query real assignment state. This is a functional UI dependency: `accepted` changes queue behavior. |
| `collector/server/public/workflow-state-catalog.js:21-34` | client unknown-state validator | API-projected **head** | Remove assignment from generic workflow-head candidates, or validate the separately returned assignment object. |
| `collector/server/public/article-workspace-page.js:705-712` | displays publishable-source assignment state | **real assignment**, via repository source built at `collector/db/repository.mjs:10082-10106` | No change required. |
| `collector/db/repository.mjs:10023-10033`, `:10082-10106`, `:10143-10172` | publishable-source and readiness checks | **real `content_assignments.state`** | No change required; this is already the desired source. |

The smoke scripts `collector/scripts/smoke-*-*.mjs` at `smoke-ai-input-cleanup-post-assignment.mjs:44`, `smoke-field-pack-return-to-clean.mjs:53`, `smoke-reference-cleanup.mjs:81`, and `smoke-handoff-boundary.mjs:37,48,66,78,92,98-100` read the head mirror directly. They must be rewritten to query assignment rows or removed with their asserted mirror behavior.

### Sync paths between the two sources

1. Assignment creation -> head: `syncWorkflowAssignmentStateOnCreate`, `collector/db/repository.mjs:6401-6445`.
2. Assignment state update -> head: `updateAssignmentStateInternal`, `collector/db/repository.mjs:6802-6880`.
3. Field rework (closed prior row -> newly created assigned row) -> head explicit reconcile: `collector/db/repository.mjs:10426-10442`.
4. Direct workflow-model API and item create/import can write the head without synchronizing an assignment: `collector/server/index.mjs:8827-8834`, `:10021-10070`, `:14312-14319`.

## B. `content_items.workflow_status`

### Writes

| File:line | Current writer |
|---|---|
| `collector/db/repository.mjs:3983-4020`, parameter construction at `:2762-2816` | generic `content_items` INSERT/UPDATE includes the column. `normalizeInput` supplies input/default at `:5354`; `saveItem` preserves prior legacy value on ordinary updates at `:5395-5403`. |
| `collector/db/repository.mjs:5815-5819` | `setWorkflowStatus` executes the dedicated update. |
| `collector/db/repository.mjs:6007-6023`, called by `:6083-6085` and `:6195-6197` | `reconcileLegacyWorkflowStatusMirror` derives status from head then calls `setWorkflowStatus`; this is the active head -> legacy sync. |
| `collector/db/repository.mjs:5822-5832`, used by `:5427-5448` and `:11378-11382` | seeds an item write from a workflow patch, so a normal item save can update the legacy column to a derived status. |

`collector/server/index.mjs:8817-8825`, `:9259-9264`, `:9364-9370`, and `:14303-14310` explicitly delete incoming `workflow_status`, so these routes do not write a client-supplied value.  The server's create mapper still **reads** it before deletion at `:6896-6912`.

### Readers and mappers

| File:line | Reader/mapper | Replacement if removed |
|---|---|---|
| `collector/db/repository.mjs:656-699` | inbound legacy -> canonical mapper and reverse head -> legacy mapper | Remove both after historical migration is separately handled; derive UI compatibility labels directly from head if still needed. |
| `collector/db/repository.mjs:5940`, `:6033` | creates a missing head from legacy status | No fallback source exists after column removal. This must become an explicit migration/backfill decision, not runtime derivation; **ไม่แน่ใจ** what source is authoritative for rows that still lack a head. |
| `collector/db/repository.mjs:5455-5469` | `listItemsByStatus` already derives legacy-shaped status from head | No change required except rename/contract cleanup; it does not read the column. |
| `collector/db/repository.mjs:5557-5571`, `:5649`, `:5681`, `:5747` | AI-draft eligibility and diagnostics read raw legacy value | Derive from workflow head. The current raw-only rule must be restated in canonical `production_state`/`publication_state` terms. |
| `collector/db/repository.mjs:6261-6291` | drift report compares legacy column with head-derived value | No longer needed; remove endpoint/audit drift fields. |
| `collector/server/index.mjs:1810-1819`, `:1830-1938` | deleted-item audit/cleanup snapshots expose legacy value | Not needed for cleanup logic; omit it or replace with a head-derived snapshot if audit display needs a status. |
| `collector/server/index.mjs:4027-4051`, `:4123-4140` | raw-pool/visibility fallback reads legacy as an extra gate/fallback | Derive from canonical fields only. `:4130` is a real fallback, so remove it deliberately rather than assuming it is unused. |
| `collector/server/index.mjs:6863-6912` | request `workflow_status` -> canonical create mapper | Remove legacy input; require canonical workflow patch/default. |
| `collector/server/index.mjs:10364-10387` | execution-readiness audit includes drift | Remove legacy drift fields. |
| `collector/server/public/app.js:5055-5093` | object input uses canonical states; string-input branch maps legacy status | UI must retain only object/canonical branch; string legacy branch is removable once callers are checked. |
| `collector/services/workflow.mjs:2326-2332`, `collector/services/agent-generation.mjs:730-735,763-768` | trace/request diagnostic metadata | Derive the diagnostic label from head, or omit it; not a control-flow dependency. |
| `collector/scripts/audit-workflow-head-missing.mjs:24`; `cleanup-smoke-items.mjs:30`; `find-smoke-item.mjs:14-49`; `lib/smoke-helpers.mjs:35,97`; all `smoke-*.mjs` matches from `rg` | scripts/smoke assertions, selection, or logging | Rewrite to canonical head/query. They are real maintenance dependencies, but not production request readers. |

There is no production UI shown by this scan that reads `item.workflow_status` as its normal state source: dashboard object paths derive from canonical fields.  However, the server fallback at `collector/server/index.mjs:4040,4130`, repository AI eligibility, missing-head seeding, drift reporting, and smoke tooling do read it.  Therefore it is **not** an unread copy today.

## C. Skip flags

Definition/read point for all three flags: `collector/db/repository.mjs:6126-6137`.  They are metadata accepted only by `upsertWorkflowModel`; there is no schema column.

| Flag | Current true setter(s) | Finding |
|---|---|---|
| `skip_assignment_transition_validation` | `collector/db/repository.mjs:6878` sets `!canSyncViaTransition`; `:10440` sets literal `true` | Both exist solely while forcing head mirror to match an assignment state that cannot legally follow the head mirror's previous state. |
| `skip_production_transition_validation` | `backend/scripts/smoke-collector-admin-final-review.mjs:135,147`; `backend/scripts/runtime-smoke-review-translation-promotion.mjs:50,66` | No setter in Collector runtime files was found. These are test/smoke harnesses, not request-path callers. |
| `skip_publication_transition_validation` | same four backend-script lines as production | Same finding. |

## D. Schema

* `content_items.workflow_status`: `collector/database/schema.sql:37`, `TEXT NOT NULL DEFAULT 'raw'`. No index or CHECK/foreign-key constraint references this content-item column in `schema.sql`.
* `content_workflow_models.assignment_state`: `collector/database/schema.sql:955`, nullable `TEXT`. It has no CHECK/foreign-key constraint, but does have `idx_content_workflow_models_assignment` at `:973` on `(assignment_state, updated_at DESC)`.
* The source of truth proposed by design is `content_assignments.state`: `collector/database/schema.sql:1006`; supporting indexes are `idx_content_assignments_assignee` (`:1022`) and `idx_content_assignments_state` (`:1023`).

## E. Analysis / decision answers

1. **Replacement per reader.**  A readers that describe an assignment must query `content_assignments.state`; the repository already demonstrates the correct direct read at `collector/db/repository.mjs:10082-10106`.  Readers that only validate/filter a workflow-head field must be deleted or converted to an assignment query.  Because an item can have multiple assignment rows (the rework path closes one and creates another at `collector/db/repository.mjs:10401-10428`), define the selection contract before implementation; static code does not establish one universal answer, so that part is **ไม่แน่ใจ**.  B readers should derive legacy-shaped labels from head where a compatibility display is still required, and be deleted where they exist only for drift/legacy seeding.  Rows missing a head require an explicit migration policy before dropping `workflow_status`.

2. **Can both be removed in one round?**  Yes for their direct code dependency: no reader of `assignment_state` derives from `workflow_status`, and assignment sync does not depend on it.  They share `upsertWorkflowModel`, but can be removed in one Step-5 change set once the two independent prerequisites are done: (a) define active-assignment selection for A readers, and (b) resolve/migrate all missing-head rows for B's legacy seeding.  Without those, do **not** combine the schema drop itself; the safe execution order is remove readers/writers and fallback code first, then schema/index removal after data validation.

3. **Does `skip_assignment_transition_validation` truly become unnecessary?**  Yes for the two current setters: both bypass a transition only to reconcile `content_workflow_models.assignment_state` with `content_assignments.state` (`collector/db/repository.mjs:6807-6812,6878` and `:10426-10440`).  After no workflow-head assignment state is written, neither bypass has a target operation.  This conclusion does **not** justify deleting validation of actual `content_assignments.state` transitions at `collector/db/repository.mjs:6802-6806`; keep that validation on the real table.
