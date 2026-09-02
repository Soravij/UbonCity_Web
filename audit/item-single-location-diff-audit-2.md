# Audit round 2 — diff `5eeba64..f1320ba` (branch `fix/item-single-location`)

- Machine: Runtime `D:\UbonRuntime\repos\UbonCity_Web` — HEAD = `f1320ba90d5ca5705798991f672aef48446209d4`, working tree clean (tracked files)
- Mode: READ-ONLY. No commit / merge. Two temporary single-line reverts for A3 applied then restored; HEAD + tree verified clean afterwards.
- Did NOT run `npm run gate` / `npm run test:all`. Ran only `item-single-location.test.mjs`, `drop-closed-assignments.test.mjs`, `assignment-ui-scope.test.mjs`.
- Sub-agents: `audit-scanner` (Layer 1) + `audit-deep-reasoner` (Layer 2, item-1 render trace + 33-item sweep on live DB).
- Prior round (`5eeba64`) HIGH finding: **"item 1 disappears from every non-diagnostic surface."** This round must confirm it is fixed.

## Verdict on the prior HIGH: **NOT FIXED**

`f1320ba` does **not** restore item 1. It still renders on **0 non-diagnostic surfaces** for the owner (user 2). See DB section.

---

## A1 — files touched / `/api/assignments/mine` revert

`git diff --name-status 5eeba64..f1320ba` = **3 files**: `PROJECT_POLICY.md`, `collector/server/index.mjs`, `collector/tests/item-single-location.test.mjs`.
**`collector/server/public/app.js` is NOT in the diff** (`git diff 5eeba64..f1320ba -- collector/server/public/app.js` empty) → `resolveQueueBucket` / `ADVANCED_PRODUCTION_STATES` unchanged since `5eeba64`. Matches "index.mjs + test + PROJECT_POLICY.md".

**Both `/api/assignments/mine` no-assignee filters removed and back to `main` verbatim.** `git diff main..f1320ba -- collector/server/index.mjs` shows **only** the `dropDuplicateManagedAssignments` addition (`:3621-3634`) + the two `buildManagedAssignmentsForActor` wrap-calls (`:3703`, `:3713`). The endpoint handler blocks are absent from the diff:

| | freelance/editor path (`index.mjs:10933`) | owner path (`index.mjs:10938`) |
|---|---|---|
| `main` & `f1320ba` | `const assignments = dropClosedAssignments(repo.listAssignmentsByAssignee(req.authUser?.id, limit));` | `const assignments = dropClosedAssignments(repo.listAssignments(limit));` |
| `5eeba64` (removed) | `…)).filter((a) => !(String(a?.assignment_kind\|\|"") === "field" && …=== "accepted"));` | same `.filter` chain |

→ f1320ba's net effect on `index.mjs` vs `main` = add `dropDuplicateManagedAssignments` + wrap the 2 managed return paths. Nothing else.

## A2 — `dropDuplicateManagedAssignments` current logic (`index.mjs:3621-3634`)

```
const ACTOR_OWNED_ELSEWHERE_STATES = new Set(["assigned","in_progress","revision_requested","submitted","resubmitted"]);   // :3622-3624
if (!Array.isArray(assignments)) return [];                                                                                // :3625
const state = String(assignment.state || assignment.assignment_state || "").trim().toLowerCase();                           // :3627
const kind  = String(assignment.assignment_kind || "").trim().toLowerCase();                                                // :3628
if (kind === "field" && state === "accepted") return false;                                                                 // :3630  (RULE 1)
if (Number(assignment.assignee_user_id) === Number(actorId) && ACTOR_OWNED_ELSEWHERE_STATES.has(state)) return false;       // :3631  (RULE 2)
return true;
```

`state` **and** `kind` both normalized `String(...).trim().toLowerCase()` (`:3627`, `:3628`) — was raw `|| ""` in `5eeba64`. **Prior finding F3 resolved.**

### Truth table — kind × state × (assignee===actor?) → drop / keep

| state | field, assignee≠actor | field, assignee===actor | editorial, assignee≠actor | editorial, assignee===actor |
|---|---|---|---|---|
| `assigned` | keep | **drop** (R2) | keep | **drop** (R2) |
| `in_progress` | keep | **drop** (R2) | keep | **drop** (R2) |
| `revision_requested` | keep | **drop** (R2) | keep | **drop** (R2) |
| `submitted` | keep | **drop** (R2) | keep | **drop** (R2) |
| `resubmitted` | keep | **drop** (R2) | keep | **drop** (R2) |
| `accepted` | **drop** (R1) | **drop** (R1) | keep | keep |

Key points:
- `field` + `accepted` → **always dropped**, regardless of assignee (R1). ← *this is the line that still hides item 1.*
- `editorial` + `accepted` → **always kept** (`accepted` ∉ `ACTOR_OWNED_ELSEWHERE_STATES`, and R1 is field-only). Changed from `5eeba64` where `assignee===actor` dropped it unconditionally. New test `item-single-location.test.mjs:83-90` covers this.
- `submitted`/`resubmitted` of **another** user → **now kept** (was unconditionally dropped in `5eeba64`). New test `item-single-location.test.mjs:48-56` covers this. See DB "latent duplication".

## A3 — revert proof (temporary, restored)

| # | revert | test | result | verdict |
|---|--------|------|--------|---------|
| a | `index.mjs:3631` — delete the `assignee_user_id === actorId && …` line | `node --test tests/item-single-location.test.mjs` | **9/10**, fails `dropDuplicateManagedAssignments removes assignee===actor with owned-elsewhere state` | **PASS — test covers this line.** |
| b | `index.mjs:3703` — `return dropClosedAssignments(repo.listAssignments(limit));` (unwrap owner) | same file | **9/10**, fails `buildManagedAssignmentsForActor owner path wraps dropDuplicateManagedAssignments(dropClosedAssignments(...))` | **PASS — the new snippet test (`item-single-location.test.mjs:88-93`) now covers the owner call site.** (Round 1 this was a FAILURE — no test exercised it. **Prior A4(ก) resolved.**) |

Restore verified: `git rev-parse HEAD` = `f1320ba90d5ca5705798991f672aef48446209d4`; `git status --porcelain` tracked files = clean; `node --test tests/item-single-location.test.mjs` = **10/10 pass**; `node --check server/index.mjs` OK; `git diff --check` clean.

## A4 — targeted regression (no gate)

Both test files unchanged between `main`, `5eeba64`, `f1320ba`. Ran `f1320ba` in place; ran `main` via `git worktree add` (no `git checkout` in the Runtime repo), worktree removed after.

| test file | main | f1320ba | delta |
|-----------|------|---------|-------|
| `drop-closed-assignments.test.mjs` | 3 pass / 0 fail | 3 pass / 0 fail | none |
| `assignment-ui-scope.test.mjs` | 35 pass / 33 fail | 35 pass / 33 fail | **identical failing-test set** (sorted `not ok` name diff = empty) |

Matches the prior-round baseline (35/33 both sides). No regression in these files.

---

## DB simulation (`collector/data/collector.db`, readOnly, owner = user 2) — static, not runtime-verified

DB re-verified — essentially identical to round 1. Item 1: `production_state=field_review`, `publication_state=draft`, `current_field_pack_id=35` (`field_packs.status=ready_for_field`, `is_current=1`). Item 1's only non-closed assignment = `a#27` (`kind=field`, `state=accepted`, `assignee_user_id=2`). 14 non-closed assignments; **no** non-closed `submitted`/`resubmitted` with `assignee_user_id ≠ 2`.

### item 1 — where does it appear now? → **0 non-diagnostic surfaces** (target was 1) — audit-deep-reasoner: CONFIRMED

| surface | result |
|---|---|
| managed table (`scope=managed` → `buildManagedAssignmentsForActor(2,"owner")`) | `a#27` dropped by **rule 1** (`field && accepted`, `index.mjs:3630`) — unchanged from `5eeba64` |
| actionable (`scope=actionable`) | state `accepted` ∉ `{assigned,in_progress,revision_requested}` |
| submitted / review (`scope=submitted` / `scope=review`) | state `accepted` ∉ `{submitted,resubmitted}` |
| `/api/assignments/mine` owner no-scope (`index.mjs:10938`, now unfiltered) | `a#27` **is in the JSON body**, but that response is **never rendered as a table for the owner**: `buildAssignmentsMinePath` (`app.js:6296-6326`) returns the no-scope URL only for `pageMode` `handoff`/`home`; `renderAssignmentsTable`'s handoff branch renders `getAssignmentHandoffQueueItems()` and `return`s (`app.js:9131`) **without reading `rows`**; `work`/`review` use scoped endpoints; owner's landing tab is `home` (dashboard, not the assignment panel — `app.js:490-496`, `510-514`) |
| dashboard queues | `resolveQueueBucket(item1)` → `"assignment"` at `app.js:771` (`accepted ∈ OPEN_ASSIGNMENT_STATES`, `publishable-assignment-candidate.mjs:64-66`), **before** the `handoff` branch it would otherwise match. Bucket `"assignment"` is in no dashboard render allow-list (`getPreparationQueueItems` `app.js:5100-5101`; `isHandoffEligibleItem` `app.js:967-969`) |
| in-flight diagnostic (`repo.listInFlightItems`) | present — the **sanctioned exception**, excluded from the count |

**Root cause:** two independent gates hide item 1 and `f1320ba` touched neither:
1. `dropDuplicateManagedAssignments` rule 1 (`index.mjs:3630`) still drops `a#27` from the one owner table that showed it on `main`.
2. `resolveQueueBucket` (`app.js:771`, not in the diff) still buckets item 1 as unrendered `"assignment"`.

`f1320ba` restored `a#27` only into the `/api/assignments/mine?limit=` **response body**, which has no owner-facing render path — a dead restoration. The fix targeted the wrong layer.

**Baseline:** `main` → item 1 in **1** surface (managed table, work mode); `5eeba64` → **0**; `f1320ba` → **0**. Regression vs `main` still open.

### Full 33-item sweep

- **Items in 0 non-diagnostic surfaces:** only **item 1** (cause above).
- **Items in >1 non-diagnostic surface** (excluding the already-known pre-existing submitted-list↔review-table overlap of items 28 & 39): **none**.
- **New managed↔review duplication from f1320ba's rule-2 change?** **No** on this DB — there are zero non-closed `submitted`/`resubmitted` assignments with `assignee ≠ 2`. But `f1320ba` **opens a latent path**: a `submitted`/`resubmitted` assignment held by any non-owner contributor would now show in both the owner managed table (work mode, `index.mjs:3703`) and the review table (review mode, `buildReviewAssignmentsForActor` `index.mjs:3676` returns all `submitted`/`resubmitted` for owner).

### Row counts — main / 5eeba64 / f1320ba (owner = user 2)

| table | main | 5eeba64 | f1320ba |
|-------|------|---------|---------|
| `raw_intake` (bucket `raw_prep` minus `claimed && cleaned`) | 12 | 8 | 8 |
| `raw_workflow_unknown` (bucket `unknown_workflow`) | 0 | 4 | 4 |
| `assignments_managed` (`scope=managed`) | 14 | 4 | 4 |
| `assignments_work` (`scope=actionable`) | 4 | 4 | 4 |

- `app.js` is byte-identical `5eeba64`↔`f1320ba` → both raw tables identical between them (main lower because items 19,20,21,22 fell through to `raw_prep` before the `app.js:806` line existed).
- `assignments_managed` ids: `main` = `a#{1,2,4,5,6,8,9,12,21,25,27,29,30,39}` (14); `5eeba64` = `a#{1,4,6,9}` (4); `f1320ba` = `a#{1,4,6,9}` (4). f1320ba's normalization + rule merge changes **nothing** on this DB (all state/kind already lowercase; merged rule 2 ⊂ 5eeba64's drops).
- `assignments_work` ids: `a#{5,12,25,30}` (items 14,17,31,40) — all three commits identical (`buildActionableAssignmentsForActor` byte-identical `main..f1320ba`).

---

## Findings (ranked)

1. **[HIGH — prior finding NOT resolved] item 1 still renders on 0 non-diagnostic surfaces** (`index.mjs:3630` rule 1 + `app.js:771` bucket, neither touched). `f1320ba`'s edits restored `a#27` only to an unrendered JSON body. Regression vs `main` (1 surface → 0) is still open. audit-deep-reasoner: CONFIRMED, high confidence.
2. **[LOW — new, latent] managed↔review duplication path opened.** `f1320ba` rule 2 now keeps a non-owner's `submitted`/`resubmitted` assignment in the owner managed table (`index.mjs:3631`), which also appears in the review table (`index.mjs:3676`). Zero occurrences on current DB; activates when any non-owner contributor has an outstanding submitted assignment.
3. **[INFO — new] `/api/assignments/mine` owner no-scope path (`index.mjs:10938-10941`) now has no dedup or management-line filter** — inconsistent with the admin/user branch 4 lines below (`:10944`, which routes through `buildManagedAssignmentsForActor`). Reverting to `main` reduces branch divergence but keeps this pre-existing asymmetry. Not user-visible (response not rendered for owner).
4. **[INFO — adjacent, pre-existing, not introduced here]** `resolveQueueBucket` `app.js:771` pre-empts the `handoff` bucket for every item with an `accepted` field assignment (items 1, 9, 25, 27, 28, 31, 39, 40). This is the structural reason finding 1 has no fallback surface.
5. **[INFO — adjacent]** `buildManagedAssignmentsForActor` owner branch (`index.mjs:3703`) has no `.slice(limit)` re-cap, unlike the admin/user branch (`:3713-3720`).

### Prior-round findings — status

| prior finding | status in f1320ba |
|---|---|
| **HIGH — item 1 → 0 surfaces** | ❌ **NOT resolved** (still 0; see finding 1) |
| A4(ก) — `item-single-location.test.mjs` did not cover the owner call site | ✅ resolved — new snippet test `item-single-location.test.mjs:88-93` (revert proof A3b) |
| F1 — `PROJECT_POLICY.md:569` English-only | ✅ resolved — Thai counterpart added at `PROJECT_POLICY.md:587`, semantically parallel |
| F3 — `dropDuplicateManagedAssignments` case-sensitive compares | ✅ resolved — `String(...).trim().toLowerCase()` at `index.mjs:3627-3628` |
| INFO — C2 owner filter asymmetry | ~ partially — the `5eeba64` `/api/assignments/mine` filters removed (back to main); the older main-era asymmetry (finding 3) remains |
| adjacent — `generated`/`brief_generated` shown as anomaly | unchanged (`app.js` not touched) |
