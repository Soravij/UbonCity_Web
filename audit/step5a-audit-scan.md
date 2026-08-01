# Step 5A audit — Layer 1 scan

Branch: `codex/impl-step5a-remove-assignment-mirror` @ 48057c1, base `main` @ e05eb90.
Method: static grep/diff only, no DB access. Gathered directly (the audit-scanner subagent has no
Write tool and could not persist this file itself, so this was compiled by hand from the same
grep/Read calls it ran).

## 1. Remaining `assignment_state` / `skip_assignment_transition_validation` references

Full-repo grep for `assignment_state` (excluding node_modules), classified:

### (a) Still writes the physical mirror column
None found. `collector/database/schema.sql` no longer declares the column (diff below, §4).
`collector/scripts/migrate-remove-assignment-state.mjs` writes the column name only inside its own
forward/reverse rebuild SQL (expected — that's the migration itself).

### (b) Still reads/derives from real assignment data, using the field name `assignment_state` as a
property label on a *derived* object (not the removed DB column)
- `collector/db/repository.mjs:9947,10017,10065,10085,10094,10109` — `buildPublishableSourceByItem`
  populates `assignment_state`/`candidate_assignment_state` on its returned candidate object from
  `assignment?.state` (a real `content_assignments` row). Pre-existing pattern, unchanged in kind by
  this branch — survey document already noted this function read real assignment rows before Step 5A.
- `collector/server/public/article-workspace-page.js:708` — displays `source.assignment_state`, where
  `source` is the object built by `buildPublishableSourceByItem` above. Not a stale reference.
- `collector/server/index.mjs:8340`, `collector/server/public/workflow-state-catalog.js:12`,
  `collector/tests/in-flight-items.test.mjs:211`, `collector/tests/workflow-readers-loud.test.mjs:204,206`
  — all reference the `ASSIGNMENT_STATES`/`assignment_states` *catalog* (the enum of valid
  `content_assignments.state` values used to validate real assignment rows), not the workflow-head
  mirror column. Implementation report explicitly calls this out (row "workflow unknown-state
  validators") as intentionally retained.
- `collector/db/repository.mjs:6778` — `source: "field_assignment_state"` is an unrelated diagnostic
  tag string on a `console.error` call (production-ladder sync skip logging), coincidental name overlap
  only.
- `collector/scripts/seed-mock-work-stage-jobs.mjs:752` — `assignment_state: String(finalAssignment?.state || "")`
  is a key in a JSON summary object the seed script prints to stdout at the end of a run; reads the real
  assignment row returned by `ensureRevisionRequested`, does not touch any DB column. Confusingly named
  given the mirror removal, but not a functional reference to the removed column.

### (c) Intentional / expected mentions
- `collector/db/workflow-head-schema.mjs:28-30` — `assertAssignmentStateMigrationApplied` boot guard,
  throws if the column still exists. By design (see §5 below).
- `collector/scripts/migrate-remove-assignment-state.mjs` (whole file) — the migration itself.
- `collector/tests/assignment-state-migration.test.mjs`, `collector/tests/assignment-state-reader.test.mjs`
  — new tests targeting the removal.

### (d) Stale documentation (NOT touched by this branch's diff — confirmed via `git diff main..HEAD -- docs/`
returning nothing)
- `docs/place-workflow-target-design.md:128,177` — roadmap doc still lists "เอา `assignment_state`
  mirror ... ออก" (remove the assignment_state mirror) as a pending to-do item (#5 in its action plan).
  This is now done; the doc was not updated to mark it complete.
- `docs/place-workflow-policy.md:241,276,277` — same roadmap doc family, section "9.4 ของที่ต้องลบหรือยุบ"
  (things to delete/consolidate) still lists `assignment_state` and `skip_assignment_transition_validation`
  as outstanding removals.
- Older files under `audit/` (`workflow-gap-to-map.md`, `core-state-verification.md`,
  `handoff-tracks-audit.md`) also describe the pre-removal mirror, but these are dated historical audit
  snapshots (not live contracts), so they are expected to describe past state and are not flagged as stale.

`collector/PROJECT_STATE.md` **was** updated correctly (diff confirmed): the rework-round bullet was
rewritten from "reconciles `content_workflow_models.assignment_state`" to "records `accepted -> closed`
... directly in `content_workflow_transitions`; workflow head no longer stores an assignment mirror."

### `skip_assignment_transition_validation`
Zero hits anywhere in `collector/` on this branch (grep confirmed). Matches the implementation report's
claim. Two other, unrelated flags (`skip_production_transition_validation`,
`skip_publication_transition_validation`) remain and are explicitly out of scope per the report.

## 2. Assignment transition history call sites

| Call site | Writes assignment row | Reads from-state | Reads to-state | Order |
|---|---|---|---|---|
| `createAssignment` (`collector/db/repository.mjs:6409-6488`) | `insertAssignmentStmt.run(...)` at :6455 | literal `null` (new assignment) | `created?.state \|\| state`, where `created` = `normalizeAssignmentRow(getAssignmentByUidStmt.get(assignmentUid))` re-read from DB **after** the insert (:6471) | insert → re-read → `recordWorkflowTransition` (:6476-6486), all inside `runInTransaction` |
| `updateAssignmentStateInternal` (`collector/db/repository.mjs:6710-6784`) | `updateAssignmentStateStmt.run(...)` at :6734 | `existingAssignmentState` captured at :6723, **before** the update statement runs (from `existing = getAssignmentByIdStmt.get(id)` fetched at :6715, pre-mutation) | `normalizedState`, the input parameter that was just applied | before-value captured → update → `recordWorkflowTransition` (:6743-6753), inside caller's transaction (`updateAssignmentState` wraps in `runInTransaction` at :6706-6708) |
| `returnFieldAssignmentForRework` (`collector/db/repository.mjs:10304-~10360`, exact range per branch) | Two real operations: `updateAssignmentStateInternal(id, "closed", ...)` (closes old round) then `createAssignmentFromReadiness(...)` (opens new round) | Each op independently captures its own real from/to state per the two rows above | same | Both calls route through the two functions above, each already transactional; no separate head-reconcile step remains (the old `upsertWorkflowModel({assignment_state: ..., skip_assignment_transition_validation:true})` call visible on `main` at this location is deleted on this branch) |

Order check the survey specifically warned about ("ถ้าสลับลำดับ history จะหยุดถูกบันทึก" — if the
write/read order is swapped, history stops recording real values): confirmed correct in both remaining
writers — the assignment row mutation always happens before the transition-recording read, and both
happen inside the same transaction.

## 3. Reader path query comparison

- `collector/services/assignment-state.mjs` (new file, 9 lines): `isAcceptedOrClosedAssignmentState(value)`
  is a pure string predicate (`state === "accepted" || state === "closed"`, case/whitespace-normalized).
  `hasAcceptedOrClosedAssignment(assignments = [])` is `.some()` over an **already-in-memory array** —
  issues no query itself.
- `collector/server/index.mjs` — `resolveItemScopeContext` (~:4241-4266) calls
  `repo.listAssignmentsByItem(itemId)` **once**, then both the visibility/primary-assignment logic and
  `hasAcceptedOrClosedAssignment(...)` (~:4256) run against that same returned array. No additional
  query. `attachWorkflowHeadFields` (~:1380-1400) reuses the scope context if the caller already built
  one; falls back to a fresh `listAssignmentsByItem` call only on single-item paths that didn't already
  load one — one query max per response, as claimed.
- `collector/db/repository.mjs` `buildPublishableSourceByItem` (~:9950-10110) — separate, pre-existing
  function; also calls `listAssignmentsByItem`-equivalent loading and ranks/derives from real rows. It
  is **not** the same call as `resolveItemScopeContext`'s — it is its own independent query path that
  already existed before this branch (per the survey, section E, this function already read real
  assignment state pre-removal). This branch did not merge the two into one shared reader; they are two
  separate call sites that each independently derive "accepted" from real assignment rows, using two
  different helper functions (`isAcceptedOrClosedAssignmentState`/`hasAcceptedOrClosedAssignment` in the
  new service file, vs. inline ranking logic in `buildPublishableSourceByItem`). This is a duplication of
  the "what counts as accepted" rule across two code paths rather than a single shared source of truth —
  flagged for Layer 2 to assess whether the two definitions can diverge.

## 4. Migration DDL — forward/reverse, before/after

Old `content_workflow_models` (`git show main:collector/database/schema.sql`, lines ~950-974):
```sql
CREATE TABLE IF NOT EXISTS content_workflow_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL UNIQUE,
  production_state TEXT NOT NULL DEFAULT 'collected',
  publication_state TEXT NOT NULL DEFAULT 'draft',
  assignment_state TEXT,
  place_review_flag TEXT NOT NULL DEFAULT 'none'
    CHECK (place_review_flag IN ('none', 'revision_requested', 'rejected')),
  current_draft_id INTEGER,
  current_review_report_id INTEGER,
  current_field_pack_id INTEGER,
  ...
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_production ON content_workflow_models(production_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_publication ON content_workflow_models(publication_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_assignment ON content_workflow_models(assignment_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_workflow_models_current_draft ...
```

New (this branch) — net diff is exactly two line removals, nothing else touched:
```diff
-  assignment_state TEXT,
   place_review_flag TEXT NOT NULL DEFAULT 'none'
...
-CREATE INDEX IF NOT EXISTS idx_content_workflow_models_assignment ON content_workflow_models(assignment_state, updated_at DESC);
```
FK (`content_item_id ... ON DELETE CASCADE`) and the `UNIQUE` on `content_item_id` are untouched in the
static schema — no `CHECK`/`UNIQUE`/FK was ever attached to `assignment_state` itself (confirmed: no such
constraint existed on `main` either).

`collector/scripts/migrate-remove-assignment-state.mjs` — the actual runtime table-rebuild (SQLite
requires full rebuild to drop a column):

Forward (`migrateUp`, :74-77): only runs `rebuildWorkflowModels(db, false)` if the column is currently
present (idempotent guard at :75). Rebuild sequence (:29-72): rename live table to
`content_workflow_models__assignment_state_legacy` → `CREATE TABLE` without `assignment_state` → `INSERT
INTO ... SELECT` every other column verbatim (assignment_state and its data are dropped, not carried) →
`DROP TABLE` legacy → recreate all indexes except `idx_content_workflow_models_assignment` (:16-27).

Reverse (`migrateDown`, :79-82): only runs if the column is currently absent (:80). Same rebuild
function, `withAssignmentState=true`. Because the column no longer exists on the source table at this
point, `sourceHasAssignmentState` (:31) evaluates `false`, so the generated `SELECT` list (:64) becomes
literal `NULL,` for every row — **every row's `assignment_state` is set to `NULL` on rollback,
unconditionally, for all pre-existing rows**, not backfilled from `content_assignments.state` or any
other source. This matches the implementation report's own description ("ค่าเดิมที่ถูกลบกู้คืนไม่ได้และ
ตั้งเป็น `NULL` โดยตั้งใจ") — it is a deliberate `NULL`, not a guessed/fabricated value, and the report is
explicit that this is a one-way, lossy rollback. Recreates `idx_content_workflow_models_assignment` on
rollback (:16-22).

`assignment-state-migration.test.mjs` (:22-111) round-trips `up → assertions → down → up` against a real
SQLite file and checks: `assignment_state` column presence, FK `ON DELETE CASCADE` survives, `UNIQUE` on
`content_item_id` survives, the five other named indexes survive, and the assignment index only exists in
the `withAssignmentState` state — all assertions passed when run directly (see test-run section).

## Test run (direct invocation, not via `npm run test:all`)

Both new files must be invoked with cwd = repo root (`D:\uboncity_web`), not `collector/` — they resolve
`collector/database/schema.sql` via `path.resolve("collector/database/schema.sql")`, which is relative to
`process.cwd()`. Running from inside `collector/` (as one might reflexively do) produces a doubled path
(`collector/collector/database/schema.sql`, ENOENT) and looks like a broken test; it is a cwd mistake, not
a bug in the test or the code under test — `scripts/testAll.mjs` enforces the correct cwd for exactly this
reason (comment at :6-10 names this exact class of test as cwd-fragile).

Run from repo root:
```
node --test collector/tests/assignment-state-migration.test.mjs collector/tests/assignment-state-reader.test.mjs
```
Result: **4 tests, 4 pass, 0 fail, 0 skipped, 0 todo** (1 test in the migration file, 3 in the reader file).

This resolves the count-mismatch question in the audit brief: two new files contribute exactly 4 new
`test()` cases, no skip/todo hidden among them. The reported full-suite deltas (base 813/746/66 →
branch 817/756/60, i.e. +4 total) are consistent with these 4 new tests and nothing else changing test
count. The separate oddity that `pass + fail` (756+60=816) is one short of `total` (817) is **not** new to
this branch: the same one-short gap exists on the reported baseline too (746+66=812 vs total 813).
`scripts/testAll.mjs` is unchanged by this diff and only shells out to `node --test`, inheriting stdio —
the gap is Node's own test-runner summary counting a suite/root-level entry in `tests` that isn't
separately classified pass/fail, present before and after this branch, not something introduced by Step
5A.
