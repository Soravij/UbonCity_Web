# External audit: Clean Prep row-action hotfix

**Branch:** `codex/clean-prep-actions-hotfix` @ `8b38ef8`
**Baseline:** `main` @ `d2911fb`
**Machine/repo:** dev, `D:\UbonCity_Web` — read-only, no Runtime access, no commit/push/merge
**Method:** independent re-measurement only; implementer's numbers in `audit/clean-prep-actions-fix.md` treated as unverified claims until reproduced here

Full diff (3 files, confirmed via `git diff main...codex/clean-prep-actions-hotfix --stat`, nothing else touched):

```
audit/clean-prep-actions-fix.md                    | 38 ++++++++++++
collector/server/public/app.js                     |  2 +
collector/tests/raw-intake-clean-prep.behavior.test.mjs | 67 +++++++++++++++++++---
```

Overall verdict: **PASS.** The fix is correct, minimal, and matches its stated cause. The new test is genuinely behavioral and does prove the fix. One overstated claim and one real test-coverage gap are flagged below — neither blocks this hotfix, but the coverage gap is the kind of gap that let the original bug through three prior audits, so it should not be closed out silently.

---

## A. Cause and fix

Confirmed directly by reading `main`'s `collector/server/public/app.js` (via `git show main:...`, lines 5864–5937): `renderRawTable()` queries and binds `handleRowAction` to `#table-raw-intake tbody` and `#table-raw-review tbody` only. `#table-clean-prep tbody` (created two `<table>` blocks earlier at line 5732, populated by the same `renderRawQueueTable()` call at line 5772) is never queried and never receives the handler. **Claim confirmed true.**

The fix (`app.js` diff, both hunks, +2/-0 total):
```js
+  const cleanPrepTbody = document.querySelector("#table-clean-prep tbody");
...
+  if (cleanPrepTbody) cleanPrepTbody.onclick = handleRowAction;
```

This binds the *same* `handleRowAction` closure (declared once at line 5882, function-scoped inside `renderRawTable`, confirmed by repo-wide grep to have no other declaration or reference anywhere in the codebase) to the Clean Prep tbody. Since `handleRowAction` dispatches purely on `event.target.closest("button[data-action]")` and the button markup for all four queue tables is already produced by the one shared `renderRawQueueTable()` template (line 5210), all three Clean Prep actions (open-state-entry / release-item / delete) become live. **All Clean Prep buttons work after the fix — confirmed by direct code trace, and empirically below in section C.**

**Double-fire check on Raw Intake:** the new line assigns `.onclick` (property assignment, not `addEventListener`) to `document.querySelector("#table-clean-prep tbody")` — a distinct DOM node from `#table-raw-intake tbody`. `intakeTbody.onclick` is untouched by the diff (still exactly one assignment, same line as on `main`). No double-binding, no double-fire risk on Raw Intake. **Confirmed.**

## B. Button-by-button coverage

Verified twice — once directly by reading `renderRawQueueTable()` (app.js:5210–5300) and `canClaimPreparationItem`/`canReleasePreparationItem`/`canTakeOverPreparationItem` (app.js:4979–4998), and independently by a second sub-agent re-deriving the same matrix from `git show` on both refs.

| Table | Button | data-action/data-id | Container bound to `handleRowAction`? | Verdict |
|---|---|---|---|---|
| Raw Intake | คัดข้อมูล (open-state-entry) | app.js:5291 | `intakeTbody`, app.js:5935 (unchanged) | PASS |
| Raw Intake | รับงานนี้ (claim-item) | app.js:5292, gated by `canClaimPreparationItem` | same | PASS |
| Raw Intake | ปล่อยงาน (release-item) | app.js:5293 | same | PASS |
| Raw Intake | ลบ (delete) | app.js:5295, gated by `canManage` | same | PASS |
| Raw Intake | checkbox (data-action="select") | app.js:5274 | own `intakeTbody.onchange`, app.js:5868 (separate handler, unchanged) | PASS |
| Clean Prep | ทำ Clean ต่อ (open-state-entry) | app.js:5291 (label swapped via `primaryLabel`, line 5267–5269) | **`cleanPrepTbody`, app.js:5866+5936 — new, absent on main** | PASS (this is the fix) |
| Clean Prep | ปล่อยงาน (release-item) | app.js:5293 | same, new | PASS |
| Clean Prep | ลบ (delete) | app.js:5295 | same, new | PASS |
| Raw Intake bulk toolbar | category/merge/delete (`renderRawBulkToolbar`, app.js:5338–5359, `getSelectedRawItems`/`split.rawIntake`) | n/a | independent of the row-click handler entirely | PASS — byte-identical to `main` across the full function range, diff shows zero delta |

No button from the requested list is missing its attributes or its container binding. **Section B: PASS, no dropped buttons.**

One structural note, not a defect: Clean Prep items are, by construction, always claimed (`splitRawIntakeAndCleanPrep`, app.js:5115, buckets an item into `cleanPrep` only once `claimed_by_user_id > 0`), so `canClaimPreparationItem` (which requires `claimed_by_user_id === 0`) can never fire there — "claim" is structurally impossible on Clean Prep, matching the 3-button spec. `canTakeOverPreparationItem`, however, only checks claim ownership and role rank, not `queueType` — so an admin/owner outranking the current claimant could in principle see a 4th "Take over" button on a Clean Prep row. This logic is identical on `main` and the branch (byte-for-byte unchanged); the hotfix neither introduces nor changes it. Flagging it here only because it means "Clean Prep has exactly 3 actions" is true today by data shape, not by code guarantee — worth knowing, not worth blocking on.

## C. What the new test actually proves

**Is it behavioral or a string check?** Behavioral. `loadRawIntakeHooks()` (test file lines 39–138) uses `extractFunction()` to pull the *literal source text* of `splitRawIntakeAndCleanPrep`, `splitRawQueueByFieldPack`, and `renderRawTable` straight out of `app.js`, then `new Function(...)`-evaluates that real code against mocked `document`/`state`/`qs`. It is not asserting against a string dump of the source — it executes the actual production function and inspects the resulting mock DOM node's `.onclick` property.

**Revert test — I ran it myself, not the implementer's claim:**
```
git checkout main -- collector/server/public/app.js   # revert only this file, in place
node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs
```
Result: 3 pass, **1 fail** — exactly the new test, with a real assertion diff:
```
AssertionError: Clean Prep actions use the same delegated handler as Raw Intake
+ actual:   undefined
- expected: [AsyncFunction: handleRowAction]
```
Then restored: `git checkout codex/clean-prep-actions-hotfix -- collector/server/public/app.js`, and `git hash-object` before/after matched (`bf92dce...` both times) — no residual change left in the tree. **Claim "the test fails when app.js is reverted" is confirmed true, empirically, not just by reading the assertion.**

**Does it cover every button from Section B?** Partially — this is the one real gap.

Explicitly asserted (test file lines 258–264): Raw Intake's open-state-entry, claim-item, release-item, delete; Clean Prep's open-state-entry, release-item, delete. That's 7 of the 8 items in the Section B list.

Not asserted:
- The Raw Intake **checkbox** (`data-action="select"`) — never referenced in the new test at all. (It's rendered/tested only implicitly by the earlier, pre-existing splitter test, which checks item bucketing, not the checkbox's own attributes or its `onchange` binding.)
- **`takeover-item`** — the test passes `canTakeOver: true` into `renderQueueTableForTest` for the Raw Intake row (line 248) but never asserts a `data-action="takeover-item"` match against the result. The parameter is exercised but the output isn't checked, so a regression in the take-over button specifically would not be caught by this new test.

Neither gap is related to *this* bug (both were already working, unchanged by the diff), so they don't block the hotfix. But per the implementer's own doc, the claim is "assert required attributes for every Raw Intake and Clean Prep action" — see Section F, this is an overstatement.

**Would this test catch the same class of bug again — a new table added with a forgotten handler?** No. `loadRawIntakeHooks()`'s mock `querySelector` is backed by a hardcoded `Map` with exactly three keys (`#table-raw-intake tbody`, `#table-clean-prep tbody`, `#table-raw-review tbody`, lines 84–88). If a fifth table were added to `renderRawTable()` tomorrow and its tbody binding forgotten, the mock `querySelector` would simply return `null` for that new selector (fallback `|| null`), the real `if (containerTbody) containerTbody.onclick = handleRowAction` guard would silently no-op exactly like it does today for the untouched `#table-raw-workflow-unknown tbody` (confirmed: neither `main` nor the branch binds a handler to that table — pre-existing, not part of this diff), and nothing in this test asks about a table it doesn't already know the name of. The test would keep passing.

**Suggested for a future pass (not implemented here, per audit-skill boundaries):** replace the hardcoded 3-entry `actionBodies` map with something derived from the real template — e.g. regex-scan `tableWrap.innerHTML` (already captured by the test harness at line 89–94) for every `<table id="...">` that `renderRawQueueTable()` populates with action buttons, and assert each corresponding tbody's `.onclick === handleRowAction` (or is on an explicit, named exemption list, since `table-raw-workflow-unknown` currently isn't bound and that may be intentional). That would turn this into a self-updating regression guard instead of one tied to today's two known tables — and it would also surface the `table-raw-workflow-unknown` gap explicitly instead of leaving it as tribal knowledge.

## D. Regression check

- **`handleRowAction` is not shared elsewhere.** Repo-wide grep (all of `D:\uboncity_web`) found matches only in `collector/server/public/app.js` (declaration + 3 binding lines) and in the implementer's own `audit/clean-prep-actions-fix.md` prose. It is a `const` closure scoped inside `renderRawTable`, used nowhere else in `collector/`, `backend/`, `frontend/`, or `admin/`. **No other page shares this handler — Section D's "other pages" concern doesn't apply; there aren't any.**
- **Container count:** branch has exactly 3 `.onclick = handleRowAction` assignments (intake, cleanPrep — new, review); `main` has exactly 2 (intake, review). `#table-raw-workflow-unknown tbody` is bound on neither ref — pre-existing gap, not introduced or touched by this diff.
- **CSS:** zero `.css` files in the 3-file diff. No new class introduced.
- **Helpers named in the audit brief** — `resolveQueueBucket` (app.js:737), `isRawPreparationItem` (777), `normalizeDashboardWorkflowStage` (5058), `workflowBadge` (4929) — full-body diff against `main` is empty for all four; byte-identical. **Untouched, confirmed.**
- **`splitRawIntakeAndCleanPrep`** (app.js:5115, the claim+`cleaned_at` split criterion from the prior merge) — also byte-identical between refs. No item duplication/loss risk introduced by this diff (it never runs; the diff only touches DOM-binding code that executes after the split has already produced its lists).
- **No state machine / transition / route changes** — confirmed by the diff itself; the only production code touched is the two lines quoted in Section A.

**Section D: PASS, no out-of-scope changes, no shared-handler regression risk.**

## E. Gate (measured myself, in place, no worktree)

Per instruction, `docs/TEST_SUITE_BASELINE.md`'s working-tree content was **not** used as the baseline (it's stale/uncommitted — measured against an old `main @ 0c1824b`, 806 tests). Instead: stashed the dirty working tree (`git stash push -u`), checked out `main`, ran `npm run test:all`, recorded results; checked out the branch, ran it again; diffed the sorted failing-name lists; then checked back out to the branch and `git stash pop` to restore the exact original working-tree state (verified via `git status --short` before/after — identical).

| | `main` @ d2911fb | branch @ 8b38ef8 |
|---|---|---|
| tests | 824 | 825 |
| pass | 764 | 765 |
| fail | **59** | **59** |
| skipped | 1 | 1 |

`diff` of the two sorted `✖`-prefixed failing-test-name lists: **empty** (identical sets).

**Result: 59/59, new 0, missing 0 — exactly matches the expected gate.** The one extra test (825 vs 824) is the new passing test itself; it does not appear in either failure list.

## F. False claims vs. code defects (from `audit/clean-prep-actions-fix.md`)

| Implementer's claim | Verdict | Basis |
|---|---|---|
| `#table-clean-prep` tbody was outside the handler binding on `main` | **True** | Direct read of `main`'s app.js:5864–5867 |
| Clean Prep buttons already had `data-action`/`data-id`; `handleRowAction` already implements their actions | **True** | app.js:5210–5300 template shared across all queue tables |
| Raw Intake remains bound, retains its attributes | **True** | Zero diff to Raw Intake's binding lines or template |
| "Extend the test to assert required attributes for **every** Raw Intake and Clean Prep action" | **False claim (overstated), not a code defect** | The new test does not assert the Raw Intake checkbox's attributes, and renders but never asserts the `takeover-item` button despite passing `canTakeOver: true`. "Every action" is inaccurate; it covers 7 of the 8 items in the requested button list. |
| Test fails when `app.js` is reverted to pre-fix | **True — reproduced independently** | Own revert-and-run above; real `AssertionError`, not a trivially-true check |
| No state-machine/transition/route/`resolveQueueBucket`/`isRawPreparationItem`/`normalizeDashboardWorkflowStage`/`workflowBadge` code changed | **True** | Byte-identical diffs confirmed for all four named functions |
| `git diff --numstat`: `2 0 app.js` / `60 7` test file | **True** | Reproduced identical numstat output myself |

Only one claim overstates what was actually built (test coverage completeness); everything else in the implementer's write-up checks out against the diff.

## Summary

- Root cause and fix: correct, minimal, no double-fire risk. **PASS.**
- Button coverage: all 8 requested buttons present with correct attributes and live containers. **PASS.**
- Test quality: genuinely behavioral, genuinely fails on revert, but covers 7/8 buttons (not "every" as claimed) and — the more consequential gap — would **not** catch a future table added without its handler bound, which is the same class of bug this hotfix exists to fix. Recommend deriving the test's container list from the rendered template rather than a hardcoded map, in a follow-up.
- Regression: no shared-handler blast radius (nothing else references `handleRowAction`), no CSS/state-machine/helper drift, bulk toolbar untouched.
- Gate: measured independently, 59/59/new 0/missing 0 — matches expectation exactly.
- One overstated claim in the implementer's doc (test coverage "every action"); no other claim in that doc contradicts the diff.
