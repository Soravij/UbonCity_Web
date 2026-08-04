# External audit round 2 — Raw Intake / Clean Prep split (defect-closure verification)

Branch `codex/raw-intake-clean-prep-split`, follow-up commit `28141d9` (parent `53db178`), vs `main`
@ `e59a1da`. This is a re-audit scoped to the single FAIL from round 1
(`audit/raw-intake-split-audit.md`, item C — items rendering in more than one table). Items B/D/E/F/H
are not re-checked per the round-2 instructions. Every number below was re-measured independently on
this machine: gate re-run by switching checkout in place (no worktree), the revert-gate claim
reproduced by hand with hash verification, and defect closure proven empirically (real, unstubbed
bucket logic against synthetic data), not just by reading the diff. Two parallel read-only sub-agents
were used for the full-scope diff check and an independent empirical proof, cross-checked against my
own direct measurements below. No file was committed, pushed, or merged; the repo was left clean on
`codex/raw-intake-clean-prep-split` @ `28141d9`.

## Verdict: **Ready to merge**, pending the two pre-existing cosmetic doc notes from round 1

The round-1 defect is genuinely closed, not just reworded around. The fix is a 2-line, tightly-scoped
change; the test that used to hide the bug via a stub now exercises the real bucket-splitting function;
and reverting only the fix reproduces the exact failure the implementer claims. All three round-1 false
claims are now factually correct, and no new false claim was introduced.

---

## 1. Defect closure (main item) — PASS

**The fix**, confirmed via `git diff 53db178..28141d9 -- collector/server/public/app.js` (this is the
entire code diff between the two commits):

```diff
   const list = sortRawItems(getPreparationQueueItems(items));
-  const split = splitRawIntakeAndCleanPrep(list);
   const workflowSplit = splitRawQueueByFieldPack(list);
+  const split = splitRawIntakeAndCleanPrep(workflowSplit.intake);
```

`splitRawIntakeAndCleanPrep` (the Raw Intake/Clean Prep splitter) is now fed only
`workflowSplit.intake` — the `raw_prep`-bucket subset produced by the pre-existing, untouched
`splitRawQueueByFieldPack`. Field Pack Review (`workflowSplit.review`) and the Workflow-warning table
(`workflowSplit.unknown`) still come from that same bucket-based splitter, unchanged.

**Proved empirically, not just by reading the diff** — two independent runs:

*My own hash-verified revert test* (§2 below) reproduces the pre-fix bug on demand: with only this
2-line change reverted, the shipped test's own assertion fails with `actual: [1,2,4,5]` vs
`expected: [1,2]` — i.e. `field_pack_review` item 4 and `unknown_workflow` item 5 leak into Raw Intake
under the old code, and do not under the new code.

*Independent sub-agent proof*, built without touching the shipped test's stub: it extracted the real
`getItemWorkflowSnapshot`, `getUnknownWorkflowState`, `isAssignmentContextReady`, `resolveQueueBucket`,
`getPreparationQueueItems`, `splitRawQueueByFieldPack`, and `splitRawIntakeAndCleanPrep` function bodies
live from `app.js` (no reimplementation, no stub) and ran them against an 11-item synthetic set spanning
all three in-scope buckets plus three excluded buckets (`published`, `assignment`, `handoff`), with both
claimed/unclaimed and active/inactive-context items in every bucket:

```
rawIntake        : [ 1, 2 ]      (raw_prep, unclaimed / claimed-without-context)
cleanPrep        : [ 3, 4 ]      (raw_prep, claimed + active context)
review (FieldPk) : [ 5, 6 ]      (field_pack_review — claim status irrelevant here, confirmed)
unknown (warning): [ 7, 8 ]      (unknown_workflow — real getUnknownWorkflowState fired for both)
```

- **No duplicates**: no id appears in more than one of the four arrays.
- **No drops**: all 8 in-scope ids land in exactly one array.
- **`unknown_workflow` items land only in the Workflow-warning array** — never Raw Intake/Clean
  Prep/Field Pack Review. This directly answers the round-2 question about where `unknown_workflow`
  items go: correctly isolated, matching pre-existing (`main`) behavior.
- **`field_pack_review` items land only in the Field Pack Review array**, regardless of claim/context
  status — confirmed with one claimed+active-context item (id 6) specifically to prove claim flags don't
  leak it into Clean Prep.
- **Reverse check**: the three excluded-bucket items (`published`/`assignment`/`handoff`) correctly
  appear in none of the four arrays — expected, since `getPreparationQueueItems` already filters to only
  `raw_prep`/`field_pack_review`/`unknown_workflow` upstream; this was never part of the "must render
  somewhere" requirement and its absence is not a regression.

---

## 2. Test no longer self-blinding — PASS

- **Stub removed, confirmed**: the old `() => ({ intake: [], review: [], unknown: [] })` stub for
  `splitRawQueueByFieldPack` is gone. The test now does `extractFunction("splitRawQueueByFieldPack")`
  and calls the real function; `grep -i "stub"` across the whole test file returns zero matches.
- **Revert-only-the-bucket-filter gate, reproduced by hand**:
  1. Recorded branch `app.js` hash: `875b9c66...`.
  2. Overlaid `53db178`'s `app.js` (`git checkout 53db178 -- collector/server/public/app.js`) — hash
     became `e1f9aa00...`, confirmed identical to `53db178`'s blob. `git diff HEAD -- app.js` showed
     **exactly** the 2-line swap reverted, nothing else.
  3. Ran the *current* (28141d9) test file against this reverted `app.js`:
     `node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs`.
     Result: **1 of 2 tests failed for real**, with
     `AssertionError [ERR_ASSERTION] ... actual: [ 1, 2, 4, 5 ], expected: [ 1, 2 ]` — an exact match
     to the implementer's claimed `[1, 2, 4, 5]` instead of `[1, 2]`. This is a genuine
     `assert.deepEqual` failure on real extracted-and-executed function output, not a regex/text match.
  4. Restored: `git checkout HEAD -- app.js` — hash back to `875b9c66...`, exact match. Re-ran the test
     suite: 2/2 pass on the restored state.
- **Behavioral, not regex — confirmed**: the harness still uses the brace-balancing `extractFunction()` +
  `new Function(...)` technique from round 1 to pull real source out of `app.js` and execute it; the
  failure above is a real assertion on real function output.
- Independently, the scope sub-agent confirmed no other stub or fake reimplementation of
  `splitRawQueueByFieldPack` exists anywhere else in the test file.

---

## 3. Out-of-scope check — PASS

`git diff 53db178..28141d9 --stat` touches exactly three files:

```
audit/raw-intake-split-implementation.md              | 22 +++++++++----------
collector/server/public/app.js                        |  2 +-
collector/tests/raw-intake-clean-prep.behavior.test.mjs| 25 +++++++++++++++-------
```

- `app.js`: the entire change is the 2-line swap shown in §1 — nothing else in the file changed
  (confirmed both by my own read and independently by a sub-agent).
- The four protected shared helpers — `resolveQueueBucket`, `isRawPreparationItem`,
  `normalizeDashboardWorkflowStage`, and the real badge-mapping function `workflowBadge()` (not
  `formatWorkflowBadge`, which round 1 found doesn't exist) — have **zero** `+`/`-` lines inside their
  bodies anywhere in this commit's diff. The only hits when grepping the diff for these names are: (a)
  documentation prose in the implementation doc correcting the `formatWorkflowBadge` → `workflowBadge`
  citation, and (b) one string literal `"resolveQueueBucket"` added to the test harness's placeholder
  argument list (an unused sandbox parameter name, not a call to or modification of the real function).
- `node --check` on both touched JS files and `git diff --check 53db178..28141d9`: all pass.

---

## 4. Gate — PASS

Re-ran `npm run test:all` myself, once per tree, switching checkout in place in this same working
directory (no worktree), same as round 1's method.

| Tree | tests | pass | fail |
|---|---|---|---|
| `main` @ e59a1da | 821 | 761 | **59** |
| branch @ 28141d9 | 823 | 763 | **59** |

- `tests`/`pass` are +2 on the branch — the same 2 tests as round 1 (the test file gained more
  assertions and item coverage but is still 2 top-level `test()` blocks).
- Extracted and sorted the 59 failing `test at <file>:<line>` identifiers from each run; `diff` between
  the two sorted lists: **empty, exit 0** — byte-identical failure sets, zero new, zero missing.

Matches the claimed 59/59/new 0/missing 0 exactly, and matches round 1's `main` baseline exactly (main
has not moved).

---

## 5. Implementation doc — round-1 false claims re-checked

All three:

1. **Diff total count** — round 1 found the doc claimed 382/72 against an actual 407/72. The doc now
   claims **"416 insertions(+), 72 deletions(-)"**. Independently measured:
   `git diff main...28141d9 --numstat` / `--shortstat` → **416 insertions(+), 72 deletions(-)** — exact
   match. **Genuinely fixed**, not just re-asserted with a different wrong number.
2. **Nonexistent function name** — round 1 found `formatWorkflowBadge()` cited at a wrong line range
   that doesn't contain badge logic. The doc now says `normalizeDashboardWorkflowStage()` and
   `workflowBadge()` are shared helpers "This hotfix does not change either one" — `workflowBadge()` is
   confirmed the real function name (grepped app.js), and it's confirmed untouched by this commit
   (§3). **Genuinely fixed.**
3. **"Remain separate ... surfaces" claim** — round 1 found this false because item populations
   overlapped despite being separate rendering targets. The doc now says: "Raw Intake/Clean Prep consume
   only `workflowSplit.intake`, so an item cannot be rendered by both a new table and either of those
   existing tables." This is now a factually accurate description of the actual fixed code (§1/§3) —
   **genuinely fixed**, not reworded around the problem.

**No new false claim found** in this round's re-check. The "Bucket-filter revert gate" claim
(`[1,2,4,5]` vs `[1,2]`) and the "Final two-tree gate" numbers (59/59, new 0, missing 0) in the doc both
match independent re-measurement exactly (§2, §4).

---

## Summary table

| Item | Verdict |
|---|---|
| 1. Defect closure | PASS — closed, proven with real unstubbed logic across all 3 buckets + 3 excluded buckets |
| 2. Test no longer self-blinding | PASS — stub gone, revert-gate reproduced by hand with hash proof, genuinely behavioral |
| 3. Out-of-scope check | PASS — only the claimed 2-line app.js swap + test file + doc; 4 protected helpers untouched |
| 4. Gate | PASS — 59/59, identical failure-name sets, re-measured myself |
| 5. False claims re-check | All 3 round-1 false claims genuinely fixed; 0 new false claims found |

## Merge readiness

**Ready to merge**, from this audit's perspective. The round-1 blocking defect (duplicate-listing
across tables) is closed and independently proven, not merely asserted. No new defect or false claim
was introduced by this follow-up commit. This report does not re-verify items B/D/E/F/H (already PASS
in round 1, per the round-2 instructions) — merge readiness should be read as conditional on those still
holding, which round 1 already confirmed and this commit's diff does not touch.
