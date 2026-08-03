# Step 5B round 2 — external audit findings

Scope: branch `codex/step5b-round2-drop-workflow-status` @ `ecdec01` vs `main` @ `5a0de7b`.
Implementer's self-report (`audit/step5b-round2-implementation.md`) treated as claims, not evidence.
All conclusions below come from commands actually run against real worktrees during this audit
(see method note in Section A for why three separate scratch worktrees plus the primary worktree
were used). Nothing was committed, pushed, or merged. No production files were left modified —
every temporary revert done during this audit was restored and verified clean (`git status --short`
/ `git diff --stat` empty) before moving on.

**Overall verdict: NOT mergeable as-is.** Section A's core "no regression" claim holds up once
measured correctly, and E is clean, but C found a real live UI regression (deleted-item cleanup
panel) and D found that the report's "no broader than main" claim is not literally true — it's a
provable strict superset, defensible in intent but not accurately described. Both need to go back
to the implementer.

---

## A. GATE — test regression count — **FAIL on the implementer's own numbers, PASS on the real gate**

The report's baseline/branch/new/missing figures (171 / 60 / 0 / 111) do not match anything
reproducible and are **false claims**. The actual regression question — "does this branch introduce
new test failures relative to main?" — resolves cleanly to **no**, once measured correctly.

### What went wrong with the report's numbers, and with this audit's own first attempt

This audit first tried the standard approach: `git worktree add` a fresh copy of `main` at
`C:\t\step5b-round2-main-baseline` (`5a0de7b`), copy `node_modules` in (no dependency changes exist
between `main` and the branch — confirmed via `git diff main...HEAD -- '**/package.json'
'**/package-lock.json'`, empty), and run `npm run test:all` there.

That run produced **170 failures**, not 59. Root cause, found by inspection: **8 test files hardcode
an absolute path back to the primary checkout**, e.g.:

```
collector/tests/workflow-readers-loud.test.mjs:21:  const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
collector/tests/schema-foundation.repository.test.mjs:13:  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
collector/tests/assignment-ui-scope.test.mjs:10:  const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
```
(full list: `article-process-field-return-evidence.behavior.test.mjs`,
`assignment-accept-confirmed-metadata.repository.test.mjs`, `assignment-ui-scope.test.mjs`,
`endpoint-schema-mapping-surface.test.mjs`, `field-pack.repository.test.mjs`,
`schema-foundation.repository.test.mjs`, `translation-recheck.repository.test.mjs`,
`workflow-readers-loud.test.mjs`.)

**This is pre-existing on `main` itself** — confirmed by grepping the baseline worktree's own copies
of these files (checked out at `5a0de7b`), not the branch's. It is not something this branch
introduced. But it means `git worktree add` does **not** actually isolate these 8 files: no matter
which worktree runs them, they always read `schema.sql`/source files from whatever is physically
checked out at `D:\UbonCity_Web` at that moment. Since `D:\UbonCity_Web` was checked out to the
branch (`ecdec01`, column already dropped) while I was running "baseline" tests in a separate
worktree, those 8 files silently read the branch's schema instead of main's, and every test that
touched `content_items.workflow_status` through them failed with
`Error: table content_items has no column named workflow_status` (105 of the 170 failures were
exactly this one message, across those 8 files' subtests). This is almost certainly what happened
to the implementer's reported baseline of 171 too — a contaminated isolated-worktree run, not a real
measurement of `main`. It also explains the report's "111 missing" figure: 170 (contaminated) − 59
(real) = 111, suspiciously exact.

**This is a reportable defect in its own right, independent of this branch's merge status**: the
project's own `docs/TEST_SUITE_BASELINE.md` explicitly recommends `git worktree add` in a scratch
location for baseline comparisons ("keeps this read-only and doesn't disturb your checkout"), but
that recommendation is unsafe for at least 8 files as long as they hardcode `D:\UbonCity_Web`. Any
future round-N audit that reaches for `git worktree add` will hit the same trap.

### The corrected method, and the real result

Since the hardcode always resolves to `D:\UbonCity_Web`, the only way to get an uncontaminated
measurement for these 8 files is for `D:\UbonCity_Web` itself to actually be the ref under test.
So: checked out `main` directly in the primary worktree, ran `npm run test:all`, checked out the
branch back, ran it again. Both runs used `node scripts/testAll.mjs` from the repo root per
`docs/TEST_SUITE_BASELINE.md`, one run each (as instructed — no repeat runs to "shop" a result).

```
$ git checkout main && node scripts/testAll.mjs
ℹ tests 814 / pass 754 / fail 59 / skipped 1

$ git checkout codex/step5b-round2-drop-workflow-status && node scripts/testAll.mjs
ℹ tests 815 / pass 755 / fail 59 / skipped 1
```

Extracted sorted unique failing-test-name sets from each run
(`grep "^✖ " | sed 's/ ([0-9.]*ms)$//' | grep -v "^✖ failing tests:$" | sort -u`) and diffed:

```
$ comm -13 main-names.txt branch-names.txt   # names only in branch (new failures)
(empty)
$ comm -23 main-names.txt branch-names.txt   # names only in main (fixed/missing in branch)
(empty)
$ comm -12 main-names.txt branch-names.txt | wc -l
59
```

**59 failures on main, 59 on the branch, identical name sets, 0 new, 0 missing.** This exactly
matches the user's own long-standing memory of "main always measures 59" — confirming that number
was correct all along and both the implementer's report and this audit's own first attempt were
victims of the same worktree-isolation trap.

**Verdict: PASS on the actual regression question** (no new failures, nothing silently fixed
either — the sets are identical). **FAIL on report accuracy** — the specific numbers in the
report's "Test gate" table (171/60/0/111) are false and should not be trusted or reused.

---

## B. Actual diff scope — **CONDITIONAL**

```
git diff main...ecdec01 --stat   (run from a branch worktree)
```
→ **29 files changed, 233 insertions(+), 247 deletions(-)**.

- File count (29) matches the report. **Insertion/deletion counts do not**: report claims
  "+280/-294"; actual is **+233/-247**. False claim on the exact numbers (not large enough to
  suggest a different file set, just an inaccurate self-report).
- No new `.sql` migration file added; `grep -iE "ALTER TABLE|DROP COLUMN|DROP TABLE"` across the
  full diff text → 0 hits. **PASS.**
- `schema.sql` diff is a single-line removal:
  ```diff
     tags TEXT,
  -  workflow_status TEXT NOT NULL DEFAULT 'raw',
     claimed_by_user_id INTEGER,
  ```
  Confirmed `transport_routes_v2`'s own unrelated `workflow_status TEXT NOT NULL DEFAULT 'draft'`
  column (schema.sql, both its column definition and its composite index) is byte-identical between
  main and branch, and `collector/server/transport-v2-router.mjs` does not appear anywhere in the
  29-file diff. **Confirmed fully intact.**
- Scope note (not a false claim, but worth flagging): `collector/scripts/migrate-place-review-flags.mjs`
  and its test are bundled into this branch despite never referencing `content_items.workflow_status`
  on main (`grep -n workflow_status` on main's copy → 0 hits). The report discloses this itself
  ("Place-review migration writer" section), so it's disclosed scope breadth, not a hidden false
  claim — but a branch titled "remove content item workflow status mirror" doing an unrelated
  raw-SQL-to-repository-method refactor in the same commit is scope creep worth a reviewer's eyes.
- Minor overclaim: the report says "existing databases must be recreated from schema.sql" — the
  dropped column was `NOT NULL DEFAULT 'raw'`, so an un-migrated existing DB would keep functioning
  with a now-unused vestigial column rather than breaking outright. Not scored as a defect, just an
  overstatement of what's technically required.

---

## C. Write-site completeness — **FAIL** (one real regression found)

Repo-wide grep (branch worktree) for `workflow_status` / `legacy_workflow_status` across
`collector/`, `backend/`, `admin/`, `frontend/`, `ops/`, `scripts/`, `shared/`, `docs/`:

- `admin/`, `backend/`, `frontend/`, `ops/`, top-level `scripts/`, `shared/` — **zero hits**.
- Remaining `workflow_status` hits, all explained as legitimate:
  - `transport_routes_v2` column + its index in `schema.sql`, and its two consumers
    (`transport-v2-router.mjs`, `smoke-transport-workflow-live.mjs`) — different domain object,
    confirmed untouched by the diff (Section B).
  - `repository.mjs` / `server/index.mjs` — the retained legacy request-boundary compat mapper
    (`mapWorkflowStatusToModelStates(payload.workflow_status...)`), intentionally kept per the
    report's stated scope; verified it strips the field before `saveItem`/`toItemUpdateParams`.
  - `workflow-readers-loud.test.mjs`, `raw-delete.test.mjs`, `assignment-ui-scope.test.mjs` — in-diff
    tests asserting the column is actually gone.
  - `item-editor-packaging-requirements.test.mjs:108` — string literal inside an assertion message,
    not a field access.
  - Docs/audit markdown — not code.
- Minor, not scored as a defect: dead/stale `workflow_status` fixture fields left behind in
  `collector/tests/manual-import-merge-backfill.behavior.test.mjs:148`,
  `collector/tests/backend-ai-proxy.test.mjs:13`, `collector/tests/agent-generation-external.test.mjs:19`
  — harmless (nothing reads them in assertions) but not cleaned up.
- `legacy_workflow_status` — 0 remaining code references anywhere (only 3 hits, all in
  `audit/*.md` history docs). Consistent with the report's claim of full removal from API responses.

### The real defect: Data Cleanup panel now always shows a blank state column

On `main`, `legacy_workflow_status` was consumed in exactly one UI spot:
`collector/server/public/app.js:3142` inside `renderDataCleanupPanel()`. The report says this was
updated ("app.js changed +4/-3 to account for it"). The line count is right; the replacement code is
not:

```js
// branch: collector/server/public/app.js:3142-3143
const productionState = String(row?.workflow_model?.production_state || "").trim();
const publicationState = String(row?.workflow_model?.publication_state || "").trim();
```

This panel renders `state.cleanup.rows`, populated from `GET /api/admin/deleted-items`
(`collector/server/index.mjs:13695-13699` → `listDeletedItemCleanupReports` →
`buildDeletedItemCleanupReport`, lines 1855–1901). That response shape is
`{id, item_uid, type, category, title, slug, claimed_by_user_id, is_deleted, created_at, updated_at,
blockers, blocker_count, can_purge, ...}` — **it has never had a `workflow_model` key, before or
after this branch.** (`/api/items?in_flight=1` does return flat `production_state`/`publication_state`
via `attachItemMatchFields`, feeding a *different* panel, `renderInFlightPanel()` — that one is fine
and untouched; it's not the code path this diff edited.)

**Result: `row?.workflow_model` is always `undefined`, so `productionState`/`publicationState` are
always the empty string, and the Data Cleanup / purge-review table's state column now renders blank
for every row** — a real regression from the previously-working `legacy:${legacyWorkflowStatus}`
display. This is exactly the site the report's accounting claim refers to, and the accounting is
wrong. **Defect, not just a false claim** — the report's phrasing implies this was safely handled;
it wasn't.

### Second, unrelated defect found during the same pass

`collector/scripts/smoke-article-workspace-browser.mjs`: the branch renames a function
`waitForItemWorkflowStatus` → `waitForItemProductionState` and its parameter `expectedStatus` →
`expectedState`, but the function body still references the old parameter name:

```
collector/scripts/smoke-article-workspace-browser.mjs:226   param declared as expectedState
collector/scripts/smoke-article-workspace-browser.mjs:227   const expected = String(expectedStatus || ...)
```

`expectedStatus` no longer exists in that scope → `ReferenceError` the moment
`waitForItemProductionState` runs (it's called at line 773). This is a smoke-test script, not
production runtime code, but it's a real break, not covered by any specific claim in the report
(the report doesn't mention this file), and should be fixed before whoever runs the smoke suite next
hits it cold.

---

## D. Hard-delete gate — **CONDITIONAL** (code is correct; "no broader than main" claim is not literally true)

`collector/services/raw-delete.mjs` is byte-identical between branch and main. The actual gate
function is `getRawOnlyHardDeleteEligibility` in `collector/db/repository.mjs`. Diff vs main: only
the `workflow_status` column read and its `if (workflow_status !== 'raw') addBlocker(...)` check
were removed (plus its appearance in the returned snapshot/audit log). Every other blocker — active
item, no claimant, workflow head present, `production_state==='collected'` AND
`publication_state==='draft'`, no current draft/review/field-pack pointers, and all ~27
downstream/reference checks — is unchanged character-for-character.

**Formally:** old eligibility = `(all other blockers clear) AND workflow_status==='raw' AND
production_state==='collected' AND publication_state==='draft'`. The branch drops the middle
conjunct. Dropping a conjunct from an AND can only add matching rows, never remove them — so the
new eligible set is **provably ⊇ the old one**, and it is a *strict* superset whenever
`workflow_status` can differ from `'raw'` while the canonical read is `collected`/`draft`.

That gap is not hypothetical. Tracing `deriveWorkflowStatusFromModel` (repository.mjs:677-696) on
main: it falls back to `'raw'` for any production/publication pair not matching one of ~10 named
cases — but that fallback only fires when `reconcileLegacyWorkflowStatusMirror` runs, which is only
called from `upsertWorkflowModel`/`createWorkflowHead`. **Main's own
`collector/scripts/migrate-place-review-flags.mjs` bypasses this**: it wrote `production_state` via
raw `UPDATE content_workflow_models SET production_state=?, place_review_flag=? ...`
(main, lines 154/188) without ever calling `upsertWorkflowModel`. So a place item whose
`needs_revision`/`rejected` state traces back to a `collected` source ends up with
`production_state='collected'`, `publication_state='draft'` while `content_items.workflow_status`
stays stuck at `'needs_revision'`/`'rejected'`. Concretely: such an item (unclaimed, not deleted, no
draft/review/field-pack pointers, zero downstream references) is **blocked under main**
(`workflow_status_not_raw`) but **eligible under the branch**. This is not purely constructed — the
report's own "Runtime evidence for removal" section independently documents a live case (item 9)
where the canonical model progressed while `workflow_status` stayed `'raw'` the whole time, which is
the mirror-staleness problem from the opposite direction — further corroborating that the mirror is
unreliable on live data, not just in this one script.

Judgment call for the merge decision, not something this audit can resolve unilaterally: this
broadening doesn't touch any content-safety blocker (draft/review/field-pack/reference/downstream
checks are all intact), it only removes reliance on a mirror independently shown to be stale — and
round E of this same branch closes the specific bypass used to construct the example above. That
makes the change defensible as *correcting false negatives* rather than *weakening the gate*. But
the report's framing ("This preserves the old safe raw-intake case... while preventing hard deletion
once the canonical head progresses") reads as a claim of equivalence, and it isn't one — it's a
proven, explainable broadening. Recommend this go back to Codex (who has live-DB access per the
project's own division of labor) to check whether any pre-existing row in the live database
actually sits in this gap today, since that's the one part of this claim that can't be verified
from static code alone.

**Revert-test:** `raw-delete.test.mjs` diff vs main is **+44/-3** (report claims +48/-7 — a minor
inaccuracy, not substantive). Reverted `raw-delete.mjs` + `repository.mjs` + `schema.sql` to main,
kept the branch's new test, ran `node --test collector/tests/raw-delete.test.mjs`:
```
✖ raw hard-delete eligibility is defined only by canonical collected/draft state
  AssertionError: fresh schema must not restore the removed legacy mirror
    actual: true, expected: false
```
1 of 20 failed as expected — the new test genuinely exercises new behavior. Restored; `git diff
--stat` / `git status --short` both empty afterward.

---

## E. migrate-place-review-flags.mjs — **PASS**

Diffed the script main vs branch. Main's `migrateUp`/`migrateDown` used raw
`db.prepare("UPDATE content_workflow_models SET production_state=?, place_review_flag=? WHERE
content_item_id=?").run(...)`. Branch replaces both call sites with:
```js
repo.upsertWorkflowModel(itemId, {
  production_state: target, place_review_flag: flag,
  last_transition_note: "place review flag schema migration",
}, "system@local", { actor_role: "system", reason_code: "place_review_flag_migration_up",
  skip_production_transition_validation: true });
```
Grep confirms **no raw SQL `UPDATE`/`INSERT` touching `content_workflow_models.production_state`
remains** — only `upsertWorkflowModel` calls. This is also the fix that closes the exact bypass
exploited to construct the Section D broadening example, going forward.

**Revert-test:** `place-review-flag-migration.test.mjs` diff is **+8/-2**, matching the report
exactly. Reverted only `migrate-place-review-flags.mjs` to main, ran the branch's test:
```
✖ place review flag migration converts a traceable legacy revision and reverses it
  actual:   { ..., last_transition_note: null, ... }
  expected: { ..., last_transition_note: 'place review flag schema migration', ... }
```
1 of 4 failed as expected — old raw-SQL writer never populated actor/note metadata, new assertions
catch it. Restored; verified clean.

---

## F. Test quality — per file, fail-on-revert or not

| File | Diff size (actual) | Report's claim | Fail on revert? |
|---|---|---|---|
| `raw-delete.test.mjs` | +44/-3 | +48/-7 (false, minor) | **Yes** — see Section D revert-test |
| `place-review-flag-migration.test.mjs` | +8/-2 | +8/-2 (matches) | **Yes** — see Section E revert-test |
| `assignment-ui-scope.test.mjs` | +6/-2 | not stated by report; audit brief said +8/-4 (does not match either measurement) | **Yes** — see below |

`assignment-ui-scope.test.mjs` detail: the diff adds one real assertion to the
"claim-pool readers preserve all canonical workflow state categories on an empty schema DB" test —
```diff
+    assert.equal(
+      db.prepare("PRAGMA table_info(content_items)").all().some((column) => column.name === "workflow_status"),
+      false,
+      "fresh schema must not retain the legacy workflow mirror"
+    );
```
— and removes one now-impossible assertion (`assert.equal(row?.workflow_status, "raw", ...)`, which
can't run once the column is gone; a deletion, not evidence either way on its own).

This file is one of the 8 with the hardcoded `D:\UbonCity_Web` path (Section A), so it can only be
meaningfully revert-tested with that exact absolute path pointing at main's `schema.sql`. Did this
directly in the primary worktree (with the user's explicit permission after a sandbox classifier
blocked the first attempt at a partial `git checkout main -- <file>`): reverted `schema.sql` +
`repository.mjs` to main, kept the branch's test file, ran
`node --test collector/tests/assignment-ui-scope.test.mjs`:
```
✖ claim-pool readers preserve all canonical workflow state categories on an empty schema DB
  AssertionError [ERR_ASSERTION]: fresh schema must not retain the legacy workflow mirror
```
Confirmed the specific new assertion fails on revert — real coverage, not a fixture-only change.
(32 other tests in that file also failed in this revert configuration — expected collateral from
reverting `repository.mjs` while the rest of the app code stays on the branch; not itself evidence
about this specific assertion.) Restored both files; `git status --short` clean afterward, `HEAD`
confirmed back at `ecdec01`.

---

## G. Report vs. real tree — false claims found

| # | Claim | Reality | Classification |
|---|---|---|---|
| 1 | Test gate: baseline 171 / branch 60 / new 0 / missing 111 | Correct method gives 59 / 59, identical name sets, 0/0 (Section A) | **False claim** (numbers), correct on substance (no regression) |
| 2 | Diff stat "29 files, +280/-294" | 29 files, +233/-247 (Section B) | **False claim** |
| 3 | "app.js changed +4/-3 to account for [legacy_workflow_status removal]" | Line counts right; resulting code reads a field (`row.workflow_model...`) the API response never provides — Data Cleanup panel state column now always blank (Section C) | **Defect**, report's accounting is wrong |
| 4 | `raw-delete.test.mjs` "+48/-7" | +44/-3 (Section D) | **False claim** (minor) |
| 5 | "This preserves the old safe raw-intake case... while preventing hard deletion once the canonical head progresses" | Provably a strict superset of main's eligible set, not an equivalent re-expression (Section D) | **Overclaim** — defensible in intent, not accurate as stated |
| 6 | "Existing databases must be recreated from schema.sql" | Column was `NOT NULL DEFAULT 'raw'`; an un-migrated DB keeps working with a vestigial column | **Minor overclaim**, not scored |

Defects found with no corresponding report claim at all (report is silent on these, so not "false
claims," just gaps): `smoke-article-workspace-browser.mjs` `ReferenceError` (Section C), and the
pre-existing hardcoded-`D:\UbonCity_Web`-path defect across 8 test files (Section A) — the latter
predates this branch and isn't the implementer's fault, but blocks the audit methodology the
project's own docs recommend and should be fixed separately.

---

## Merge decision

**Not ready to merge as-is.** Two things need to go back to the implementer before this can land:

1. **Fix the Data Cleanup panel regression** (`app.js:3142-3143` reading a `workflow_model` field
   `/api/admin/deleted-items` never sends) — this is a live, user-visible break, not a style nit.
2. **Correct or substantiate the hard-delete "no broader" claim** — either reword it to acknowledge
   the provable broadening and its rationale, or have Codex check the live DB (per this project's
   Claude/Codex division of labor) for any row currently sitting in the gap this audit constructed,
   since that's the one part of the claim static analysis can't settle.

Everything else (B, E, most of F) is solid. A's actual regression question resolves clean — do not
let the report's wrong numbers block the merge on their own, but do not reuse those numbers either;
cite the 59/59 figures from this audit instead. The `smoke-article-workspace-browser.mjs`
`ReferenceError` and the pre-existing hardcoded-path test defect are worth their own follow-up
tickets but aren't blockers for this specific branch.

## Evidence artifacts (not committed, left for inspection)

- Full test logs and sorted failure-name diffs for the corrected gate run:
  `C:\Users\Sorav\AppData\Local\Temp\claude\D--uboncity-web\845d5b70-2202-4e16-92e0-e3939e7a77e5\scratchpad\step5b-round2-gate-evidence\`
  (`gate-main-output.log`, `gate-branch-output.log`, `gate-F-revert-output.log`,
  `gate-main-failnames.txt`, `gate-branch-failnames.txt`)
- Scratch worktrees still present on disk, left as-is per this project's own convention of leaving
  prior audit-round worktrees in place: `C:\t\step5b-round2-main-baseline` (main @ 5a0de7b),
  `C:\t\step5b-round2-branch-test` (branch @ ecdec01), `C:\t\step5b-round2-def-revert` (branch @
  ecdec01, confirmed clean/unmodified after use). Safe to delete with `git worktree remove` if no
  longer needed.
