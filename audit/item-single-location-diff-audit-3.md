# Audit round 3 — diff `f1320ba..f87f04f` (branch `fix/item-single-location`)

- Machine: Runtime `D:\UbonRuntime\repos\UbonCity_Web` — HEAD = `f87f04f4d5dde54f756768831a87cbeb1219bd21`, working tree clean (tracked files)
- Mode: READ-ONLY. No commit / merge. Two temporary single-line reverts for A4 applied then restored; HEAD + tree verified clean afterwards.
- Did NOT run `npm run gate` / `npm run test:all`. Ran only `item-single-location.test.mjs`, `drop-closed-assignments.test.mjs`, `assignment-ui-scope.test.mjs`.
- Sub-agents: `audit-scanner` (Layer 1) + `audit-deep-reasoner` (Layer 2 — decisive item-1 trace + 33-item sweep + row counts on live DB).
- Prior 2 rounds: HIGH finding **"item 1 renders on 0 non-diagnostic surfaces"** stayed open. This round is decisive.

## Verdict on the prior HIGH: **RESOLVED**

On `f87f04f`, item 1 renders on **exactly 1** non-diagnostic surface — the assignments-page **handoff** queue — via `resolveQueueBucket(item1) === "handoff"`. audit-deep-reasoner confirmed the server flag is computed, survives the full payload pipeline to the JSON response, and is consumed by the client guard. No new regression.

---

## A1 — files touched

`git diff --name-status f1320ba..f87f04f` = **3 files**: `collector/server/index.mjs`, `collector/server/public/app.js`, `collector/tests/item-single-location.test.mjs`. Matches "index.mjs + app.js + test".

Confirmed **absent from every diff hunk** (purely additive change):
- `dropDuplicateManagedAssignments` (`index.mjs:3621`), `dropClosedAssignments` (`index.mjs:3614`)
- `buildActionableAssignmentsForActor`, `buildManagedAssignmentsForActor`, `buildSubmittedAssignmentsForActor`, `buildReviewAssignmentsForActor`
- `hasOpenAssignment: hasOpenAssignment(primaryAssignment)` in `resolveItemScopeContext` (`index.mjs:4038`) — unchanged
- `hasOpenAssignment()` in `collector/services/publishable-assignment-candidate.mjs:68` — unchanged

The diff adds a new field `only_field_accepted_open` / `onlyFieldAcceptedOpen` and one `&& !onlyFieldAcceptedOpen` clause. Nothing else.

## A2 — `only_field_accepted_open` payload completeness

`grep -n "has_open_assignment" collector/server/index.mjs` → 3 payload-construction sites; each now has a paired `only_field_accepted_open`:

| function | `has_open_assignment` | `only_field_accepted_open` (added) |
|---|---|---|
| `attachItemMatchFields` | `index.mjs:1344` | `index.mjs:1345` |
| `attachWorkflowHeadFields` | `index.mjs:1404` | `index.mjs:1405` |
| `attachItemScopeMetadata` | `index.mjs:4061` | `index.mjs:4062` |

**No unpaired site.** (Other `has_open_assignment`/`hasOpenAssignment` hits: `index.mjs:39` import, `:4029` the new filter, `:4038` the existing return key — none are payload sites.)

`index.mjs:1345` reads `item?.only_field_accepted_open === true` from the incoming `item` — the **same read-through pattern** as `has_open_assignment` at `:1344`. It is **not** `false`-always: all 3 callers of `attachItemMatchFields(` (`index.mjs:8044`, `8048`, `8057`) wrap `decorateVisibleItems(...)`, which runs `resolveItemScopeContext(item)` then `attachItemScopeMetadata(...)` (`index.mjs:8030-8034`) on every item first — `attachItemScopeMetadata` spreads `...item` and sets `only_field_accepted_open` (`index.mjs:4062`), `sanitizeItemForResponse` preserves it, `attachItemMatchFields` re-reads and re-sets it (`:1345`). audit-deep-reasoner traced item 1 end-to-end: `only_field_accepted_open=true` reaches `res.json` and the client `getItemWorkflowSnapshot` (`app.js:717`).

## A3 — `onlyFieldAcceptedOpen` definition (`index.mjs:4029-4033`)

```
const openAssignments = listAssignments.filter((assignment) => hasOpenAssignment(assignment));                  // :4029
const onlyFieldAcceptedOpen = openAssignments.length > 0                                                         // :4030
  && openAssignments.every((assignment) =>
    String(assignment?.assignment_kind || "").trim().toLowerCase() === "field"                                   // :4032
    && String(assignment?.state || assignment?.assignment_state || "").trim().toLowerCase() === "accepted");     // :4033
```

- Filter = `hasOpenAssignment` (`publishable-assignment-candidate.mjs:64-71`, `OPEN_ASSIGNMENT_STATES = {assigned,in_progress,submitted,resubmitted,revision_requested,accepted}` — `closed` excluded).
- `assignment_kind` normalized `String(...).trim().toLowerCase()` (`:4032`); `state` normalized `String(a?.state || a?.assignment_state || "").trim().toLowerCase()` (`:4033`) — dual-field fallback, same as `dropDuplicateManagedAssignments`.
- `openAssignments.length > 0` guard → no open assignment ⇒ `false`.

### Truth table (`listAssignments` open subset → result)

| open assignments | `onlyFieldAcceptedOpen` |
|---|---|
| `[field/accepted]` | **true** |
| `[field/accepted, editorial/assigned]` | false — `editorial/assigned` is open, kind ≠ field |
| `[field/accepted, editorial/accepted]` | false — `editorial/accepted` is open (`accepted` ∈ OPEN regardless of kind), kind ≠ field |
| `[editorial/accepted]` | false |
| `[]` (no open assignment) | false (`length > 0` guard) |
| `[field/in_progress]` | false — state ≠ accepted |
| `[field/accepted, field/accepted]` | true |
| `[field/accepted] + closed field round` | true — `closed` filtered out by `hasOpenAssignment` |

## A4 — revert proof (temporary, restored)

| # | revert | test | result | verdict |
|---|--------|------|--------|---------|
| a | `app.js:774` → `if (hasOpenAssignment) {` | `node --test tests/item-single-location.test.mjs` | **12/13**, fails `only_field_accepted_open=true + field pack ready_for_field + field_review → handoff` | **PASS — test covers the client guard.** |
| b | `index.mjs:4039` — delete `onlyFieldAcceptedOpen,` from the `resolveItemScopeContext` return object | same file | **13/13 still pass** | **FAILURE — no test exercises the server-side `resolveItemScopeContext` / `onlyFieldAcceptedOpen` computation.** All 3 new tests (`item-single-location.test.mjs:187-225`) are client `resolveQueueBucket` tests that hand-feed `only_field_accepted_open`. |

Restore verified: `git rev-parse HEAD` = `f87f04f4d5dde54f756768831a87cbeb1219bd21`; `git status --porcelain` tracked files = clean; `node --test tests/item-single-location.test.mjs` = **13/13 pass**; `node --check` OK on both files; `git diff --check` clean.

## A5 — targeted regression (no gate)

Only `item-single-location.test.mjs` changed this round; the other two test files are unchanged `main`↔`f87f04f`. Ran `f87f04f` in place; ran `main` via `git worktree add` (no `git checkout` in the Runtime repo), worktree removed after.

| test file | main | f87f04f | delta |
|-----------|------|---------|-------|
| `drop-closed-assignments.test.mjs` | 3 pass / 0 fail | 3 pass / 0 fail | none |
| `assignment-ui-scope.test.mjs` | 35 pass / 33 fail | 35 pass / 33 fail | **identical failing-test set** (sorted `not ok` name diff = empty) |

Matches the round-1/round-2 baseline (35/33 both sides). No regression.

---

## DB simulation (`collector/data/collector.db`, readOnly, owner = user 2) — the decisive check

DB facts re-verified. Item 1: `production_state=field_review`, `publication_state=draft`, `current_field_pack_id=35` (`field_packs` id 35 → `status=ready_for_field`, `is_current=1`). Item 1's only non-closed assignment = `a#27` (`field` / `accepted` / assignee 2). Full 33-item scan: **`onlyFieldAcceptedOpen=true` for item 1 only.**

### item 1 — surface count → **1** (handoff). HIGH RESOLVED. audit-deep-reasoner: CONFIRMED

`resolveQueueBucket(item1)` on `f87f04f`, step by step (`app.js:766-810`):
1. `getUnknownWorkflowState` → `field_review` is a valid catalog state → `null`, continue.
2. `published` / `completed` → no (`draft` / `field_review`).
3. `if (hasOpenAssignment && !onlyFieldAcceptedOpen)` (`app.js:774`): `true && !true` = **false → "assignment" bucket skipped** ← the fix.
4. published-states block (`app.js:777-787`) → no match.
5. handoff block (`app.js:788-805`): `hasFieldPack` (ptr 35) ✓ && `isAssignmentContextReady("ready_for_field")` ✓ && `production_state==="field_review"` ✓ → **returns `"handoff"`**.

| surface | present? | why |
|---|---|---|
| assignments-page handoff queue | **YES** | `isHandoffEligibleItem` (`app.js:970`) = `resolveQueueBucket==="handoff"`; rendered by `renderAssignmentsTable` pageMode `handoff` (`app.js:9048`) |
| dashboard raw / field-pack-review / unknown tables | no | `getPreparationQueueItems` allow-list = `{raw_prep, field_pack_review, unknown_workflow}` (`app.js:5100-5106`) — `handoff` excluded |
| managed table | no | `a#27` dropped by `dropDuplicateManagedAssignments` rule 1 (`field && accepted`, `index.mjs:3632`) |
| actionable / submitted / review | no | state `accepted` ∉ their state sets |
| in-flight diagnostic | yes | sanctioned exception — excluded from the count |

On `main`/`5eeba64`/`f1320ba` item 1 → `"assignment"` (guard was `if (hasOpenAssignment) return "assignment"`), which is rendered by no queue → 0 surfaces.

### Full 33-item sweep (`f87f04f`, owner = user 2)

Bucket per item (identical to `f1320ba` **except item 1**):

| bucket | items |
|---|---|
| raw_prep | 2, 4, 5, 6, 7, 15, 16, 24, 35 |
| field_pack_review | 8, 12, 13, 18 |
| unknown_workflow | 19, 20, 21, 22 |
| handoff | **1**, 26, 29, 30, 32 |
| assignment | 3, 9, 14, 17, 25, 27, 28, 31, 39, 40 |
| published | 23 |

- **Items on 0 non-diagnostic surfaces: NONE** (was: item 1). Every `assignment`-bucket item is carried by an assignment-panel table: 3→managed(a#1), 9→managed(a#4), 25→managed(a#6), 27→managed(a#9), 14→actionable(a#5), 17→actionable(a#12), 31→actionable(a#25), 40→actionable(a#30), 28→submitted+review(a#21), 39→submitted+review(a#39).
- **Items on >1 non-diagnostic surface (excl. known 28/39 submitted↔review overlap): NONE.**
- **New duplication from item 1 → handoff: NONE** — `a#27` stays suppressed in the managed table; handoff queue is item 1's sole appearance.

### The "field:accepted" items (task named 1, 9, 25, 27, 28, 31, 39, 40)

Actually in `field` / `accepted` state: **only 1, 9, 27, 39** (25 = field/in_progress, 28 = field/submitted, 31 = field/revision_requested, 40 = field/in_progress).

| item | non-closed assignments | onlyFieldAcceptedOpen | bucket f1320ba | bucket f87f04f |
|---|---|---|---|---|
| **1** | a#27 field/accepted/u2 | **true** | assignment | **handoff** |
| 9 | a#2 field/accepted/u14, a#4 editorial/revision_requested/u10 | false | assignment | assignment |
| 25 | a#6 field/in_progress/u12 | false | assignment | assignment |
| 27 | a#8 field/accepted/u12, a#9 editorial/assigned/u11 | false | assignment | assignment |
| 28 | a#21 field/submitted/u2 | false | assignment | assignment |
| 31 | a#25 field/revision_requested/u2 | false | assignment | assignment |
| 39 | a#29 field/accepted/u2, a#39 editorial/submitted/u2 | false | assignment | assignment |
| 40 | a#30 field/in_progress/u2 | false | assignment | assignment |

**Only item 1 changed bucket** (`assignment → handoff`). Items 9/27/39 have a field/accepted round *and* a second open editorial assignment → `onlyFieldAcceptedOpen=false` → unchanged.

### Row counts — main / 5eeba64 / f1320ba / f87f04f (owner = user 2)

| table | main | 5eeba64 | f1320ba | f87f04f |
|-------|------|---------|---------|---------|
| `raw_intake` (bucket `raw_prep` minus `claimed && cleaned` split) | 12 | 8 | 8 | **8** |
| `raw_workflow_unknown` (bucket `unknown_workflow`) | 0 | 4 | 4 | **4** |
| `handoff` (count of items, bucket `handoff`) | 4 | 4 | 4 | **5** |
| `assignments_managed` (`buildManagedAssignmentsForActor(2,"owner")`) | 14 | 4 | 4 | **4** — a#{1,4,6,9} |
| `assignments_work` (`buildActionableAssignmentsForActor(2)`) | 4 | 4 | 4 | **4** — a#{5,12,25,30} |

- `handoff`: `{26,29,30,32}` = 4 on main/5eeba64/f1320ba (item 1 → `assignment` there); `{1,26,29,30,32}` = 5 on `f87f04f`. `main`'s handoff block is byte-identical to `f87f04f`'s.
- `raw_intake` / `raw_workflow_unknown` / `assignments_managed` / `assignments_work` — `f87f04f` does not touch `app.js`'s ADVANCED line, `dropDuplicateManagedAssignments`, or the actionable builder → identical to `f1320ba`. (`main`/`5eeba64` values for `raw_intake`=12 and `assignments_managed`=14 carried from prior rounds; not independently re-derived this round.)

---

## Findings (ranked)

1. **[MED — new] No server-side test coverage for `onlyFieldAcceptedOpen`.** Reverting `index.mjs:4039` (removing the field from the `resolveItemScopeContext` return) leaves all 13 tests green (A4b). The client consumer (`resolveQueueBucket`) is tested with hand-fed values; the server computation (`index.mjs:4029-4033`) — the `hasOpenAssignment` filter, the `every(field && accepted)` predicate, the `length > 0` guard, the dual-field state normalization — is untested. A future change to `OPEN_ASSIGNMENT_STATES` or the predicate would not trip a test.
2. **[LOW — new, edge case] field/accepted-only item with NO field pack + advanced production_state now routes to `unknown_workflow`, not `assignment`.** After `app.js:774` skips the assignment bucket, such an item falls through the handoff branch (needs `hasFieldPack`), the `field_pack_review` branch (needs `hasFieldPack`), and hits `ADVANCED_PRODUCTION_STATES.has(productionState)` → `"unknown_workflow"` (`app.js:809`). No such item exists in the current DB (item 1 has field pack 35), so no live impact; it is a behavior change for a hypothetical state and is not covered by any test (the new handoff test assumes a field pack).
3. **[INFO — adjacent, pre-existing, not introduced here]** The handoff queue note (`app.js:9057`, "not yet sent out to work") is already inaccurate — the queue contains items whose field assignment is `closed` (26, 29, 30, 32) and now also item 1 (`accepted`). `getAssignmentHandoffQueueItems` (`app.js:3607-3617`) filters on bucket only, with no exclusion of already-dispatched items. Item 1 does not create a new category.
4. **[INFO] payload-shape change.** The fix adds `only_field_accepted_open` to the item payload — CLAUDE.md freeze rule "Do not modify payload structure/shape" — but this is additive-only and is the explicit mechanism of the sanctioned item-single-location fix effort. Noted, not flagged as a violation.

### Prior-round findings — status

| finding | status in f87f04f |
|---|---|
| **HIGH — item 1 → 0 non-diagnostic surfaces** | ✅ **RESOLVED** — item 1 → `handoff` bucket, exactly 1 surface (`resolveQueueBucket` `app.js:774` + `:788-805`; server flag `index.mjs:4030`) |
| round-2 [LOW latent] managed↔review dup (rule 2 keeps non-owner `submitted`/`resubmitted`) | unchanged — `dropDuplicateManagedAssignments` not touched; still 0 occurrences in DB |
| round-2 [INFO] `/api/assignments/mine` owner no-scope path has no dedup/management-line filter | unchanged — not touched |
| round-1 [LOW] `generated`/`brief_generated` no-fp items shown as anomaly | unchanged — `app.js` ADVANCED line not touched |
