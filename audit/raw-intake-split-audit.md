# External audit — Raw Intake / Clean Prep split

Branch `codex/raw-intake-clean-prep-split` @ `53db178` vs `main` @ `e59a1da`.
Method: every number below was re-measured independently on this machine (repo `D:\uboncity_web`) —
gate re-run by switching checkout in place (no worktree, per the hardcoded `D:\UbonCity_Web` path in
the test file), diffs re-pulled with `git diff main...HEAD`, and three parallel read-only sub-agents
used to cross-check scope, the new N+1 field, and every citation in the implementer's own handoff doc
(`audit/raw-intake-split-implementation.md`). No file was committed, pushed, or merged; the repo was
restored to a clean `codex/raw-intake-clean-prep-split` checkout at the end.

## Verdict: **NOT ready to merge**

The two-way split itself is implemented correctly and the regression-gate numbers the implementer
reported are real. But the change introduces a genuine, easily-reproducible **duplicate-listing
regression**: items that belong to the existing Field Pack Review or Workflow-warning tables now *also*
render in the new Raw Intake table, contradicting the implementer's own claim that those two tables
"remain separate downstream/special-purpose surfaces." See item **C** below — this is a real defect,
not a false alarm, and the new test suite cannot catch it because it stubs away the exact function that
would expose it.

---

## A. Gate — PASS

Re-run `npm run test:all` myself, once per tree, by checking out each branch in this same working
directory (no worktree used).

| Tree | tests | pass | fail | cancelled | skipped |
|---|---|---|---|---|---|
| `main` @ e59a1da | 821 | 761 | **59** | 0 | 1 |
| branch @ 53db178 | 823 | 763 | **59** | 0 | 1 |

- `tests`/`pass` are +2 on the branch, exactly matching the 2 new tests in
  `raw-intake-clean-prep.behavior.test.mjs` (both pass) — no other count moved.
- Extracted the 59 failing `test at <file>:<line>` identifiers from each run's recap section, sorted,
  and diffed them: **byte-identical**, zero new, zero missing.

Matches the implementer's claimed 59/59/new 0/missing 0 exactly. **Confirmed true**, not just claimed.

---

## B. Scope (`git diff main...HEAD --stat` and full diff) — PASS, with one false number

Six files changed, matching the claimed set:

| File | Actual +/- |
|---|---|
| `collector/db/repository.mjs` | +12/-0 |
| `collector/server/index.mjs` | +1/-0 |
| `collector/server/public/app.js` | +59/-71 |
| `collector/server/public/index.html` | +0/-1 |
| `collector/tests/raw-intake-clean-prep.behavior.test.mjs` | +206/-0 (new) |
| `audit/raw-intake-split-implementation.md` | +129/-0 |

Per-file counts all check out. **Total does not**: the doc (line 83) claims the diff is exactly
"382 insertions(+), 72 deletions(-)". Actual `git diff --shortstat` total is **407 insertions(+), 72
deletions(-)** — every individual file's count is right, only the sum is wrong, by exactly the amount
the doc itself grew (its own 129-line insertion count) after that line was apparently written. This is
a **false claim**, not a defect — the real diff footprint is 25 lines larger than reported, entirely
inside the implementer's own audit doc.

No file outside the collector subsystem is touched: nothing under `backend/`, `frontend/`, `admin/`, no
`.css` file, no `collector/data/` file, no `collector/services/` file (no state machine or transition
rule touched — confirmed by both my own reading of the app.js diff and independent agent search).

**Workflow-warning panel restoration**: confirmed byte-identical between `main` and branch — extracted
and diffed the `⚠ Workflow state ผิดปกติ` card markup directly from both trees, zero character
difference (only its line position shifted, 5760-5770 → 5749-5759). One line elsewhere in the same
function renamed a local variable (`split.unknown` → `workflowSplit.unknown`) as a mechanical
consequence of introducing a second splitter — functionally identical, not a content change.

The two pre-existing untracked files (`audit/interest-score-survey.md`,
`audit/interest-score-survey-round2.md`) are confirmed untouched by this diff and never committed —
exactly as the implementer's doc states.

---

## C. Table split — CONDITIONAL → the real defect is here

**The Raw Intake / Clean Prep two-way split itself is correct in isolation:**

```js
function splitRawIntakeAndCleanPrep(items = []) {
  for (const item of items) {
    const claimed = Number(item?.claimed_by_user_id || 0) > 0;
    const hasActiveApprovedContext = item?.has_active_approved_context === true;
    if (claimed && hasActiveApprovedContext) cleanPrep.push(item); else rawIntake.push(item);
  }
  return { rawIntake, cleanPrep };
}
```

- Criterion matches the approved spec exactly: `claimed_by_user_id` set **and**
  `has_active_approved_context === true`.
- Every item that reaches this function lands in exactly one of the two arrays — simple if/else, no
  drop, no duplicate *between rawIntake and cleanPrep specifically*. `sortRawItems` (the only thing
  between `getPreparationQueueItems` and the split) only sorts, confirmed by reading it — it does not
  filter.
- Claimed-without-active-context items correctly land in Raw Intake (verified in the shipped test and
  by direct reading).
- Raw Intake always renders `interestingness` — `showInterestingness: true` is hardcoded on that
  render call, not conditioned on `production_state`.
- Clean Prep never renders a score — `showInterestingness: false` hardcoded on that call.

**But the split's *input* is the problem, and it breaks page-wide exhaustiveness — the exact property
this item was supposed to verify:**

```js
function getPreparationQueueItems(items = state.items) {
  return items.filter((item) => {
    const bucket = resolveQueueBucket(item);
    return bucket === "raw_prep" || bucket === "field_pack_review" || bucket === "unknown_workflow";
  });
}
```

`getPreparationQueueItems` returns items from **three** workflow buckets combined, not just
`raw_prep`. `renderRawTable` then does:

```js
const list = sortRawItems(getPreparationQueueItems(items));   // all 3 buckets, combined
const split = splitRawIntakeAndCleanPrep(list);                // partitions ALL of `list` by claim+context — no bucket filter
const workflowSplit = splitRawQueueByFieldPack(list);           // separately partitions the SAME `list` by bucket
```

`splitRawQueueByFieldPack` is bucket-based and mutually exclusive (`field_pack_review` → its `review`
array feeds the Field Pack Review table; `unknown_workflow` → its `unknown` array feeds the
Workflow-warning table). But `splitRawIntakeAndCleanPrep` has **no bucket filter at all** — it runs over
the *same* three-bucket `list` and routes purely on claim/context.

**Consequence**: any item whose bucket is `field_pack_review` or `unknown_workflow` that does *not*
meet the claimed+active-context criterion (the common case — a field pack can exist without a
currently-*active* approved-context row, e.g. after the context was later superseded, or after the item
was released/re-claimed) now renders in **both**:
- Raw Intake **and** Field Pack Review, or
- Raw Intake **and** the Workflow-warning table

simultaneously, on the same page. This directly contradicts the implementer's own summary: "The
existing Field Pack Review (including Raw Review filters) and workflow-warning table remain separate
downstream/special-purpose surfaces." They remain separate *as rendering targets* — their *item
populations* now overlap. On `main`, this could not happen: the single combined table only ever drew
from `split.intake` (`raw_prep` bucket only), which was mutually exclusive with Field Pack Review and
Workflow-warning by construction.

**Why the new test doesn't catch it**: `raw-intake-clean-prep.behavior.test.mjs` stubs
`splitRawQueueByFieldPack` to always return `{ intake: [], review: [], unknown: [] }`
(`loadRawIntakeHooks`, line 89) — so the real interaction between the two splitters over shared bucket
data is never exercised by the shipped test.

This is graded **CONDITIONAL** rather than a flat FAIL only because the *two-way* split algorithm the
item literally names is itself correct; but the practical, user-visible behavior — "every item goes to
one table, not duplicated" — fails once the page's other two tables are accounted for, which is exactly
the scope the implementer's own summary claims is unaffected.

---

## D. Shared helpers — PASS

`resolveQueueBucket`, `isRawPreparationItem`, `normalizeDashboardWorkflowStage`, and the badge-mapping
function are unmodified — confirmed by diffing the full `app.js` change and grepping every mention of
these four names in the diff: none appear as `+`/changed lines, only as unchanged context or inside
now-deleted code that *called* them. The new splitter (`splitRawIntakeAndCleanPrep`) is local to
`app.js` and not exported/reused elsewhere.

One documentation-only issue found here, not a code defect: the implementer's doc cites a function
`formatWorkflowBadge()` at `app.js:5000-5048` as one of the untouched shared helpers. **No function with
that name exists in app.js.** The actual badge-formatting function is `workflowBadge()` (defined around
line 4929), and the cited range 5000-5048 is unrelated code (assignment-owner/assignee label helpers).
The substantive claim — that this branch doesn't touch badge-mapping logic — is still true by direct
diff inspection, but the citation itself is fabricated/wrong.

---

## E. `has_active_approved_context` — PASS, with correctly-scoped concerns

- **N+1**: confirmed real. `attachItemMatchFields` is called from three `GET /api/items*` list routes
  (`index.mjs:8205`, `:8209`, `:8218`), and the new `repo.hasActiveApprovedContext(itemId)` call runs
  once per item inside that function's per-item `.map()`. It is, however, an **incremental** addition to
  a loop that already performed 3 unconditional per-item repo calls before this change
  (`listSourceRecordsByItem`, `getCurrentFieldPackByItem`, `getWorkflowModelByItem`) — not a newly
  introduced anti-pattern.
- **Cost is low in practice**: `approved_context_blocks` has indexes on `content_item_id` and `status`
  plus a partial unique index covering `(content_item_id, evidence_block_id) WHERE status='active'`
  (`collector/database/schema.sql:511-515`). The query is `WHERE content_item_id=? AND status='active'
  LIMIT 1` — an indexed point lookup with early exit, not a scan. For realistic list sizes this adds
  low single-digit milliseconds total on top of the existing N×3 baseline.
- **Role visibility — confirmed `user` sees it too**: unlike `bulk_preview` (gated by
  `includeBulkPreview = isAdminLikeUser(req.authUser)`, `index.mjs:8188`), `has_active_approved_context`
  is set unconditionally in the same object literal, outside any role check (`index.mjs:1341`). The
  route itself allows `owner`/`admin`/`user` roles through (`index.mjs:8182-8186`). This matches the
  implementer's own stated reasoning (bulk_preview is admin-only, so a role-neutral field was added
  instead) — a correct, deliberate design choice, not an oversight.

---

## F. Chip removal — PASS

Grepped the entire `collector/` tree for `RAW_INTAKE_FILTERS`, `buildRawIntakeFilterHtml`,
`rawIntakeFilter`, `data-intake-filter`, and `raw-stage-filters`: the only remaining hit is the new
test's assertion that `data-intake-filter` markup is **absent** — i.e., the removal is verified, not
left dangling anywhere. `RAW_REVIEW_FILTERS` / `buildRawReviewFilterHtml` (the separate Raw Review
filter, explicitly required to stay untouched) are confirmed present and unmodified.

---

## G. Tests — PASS (revert gate re-run myself, hash-verified)

Ran the implementer's claimed revert gate independently rather than trusting their description:

1. Recorded `collector/server/public/app.js` blob hash on the branch: `e1f9aa00...`.
2. Overlaid `main`'s version onto the working tree (`git checkout main -- collector/server/public/app.js`)
   — hash became `217679fa...`, confirmed identical to `main`'s blob.
3. Ran `node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs`: **1 of 2 tests failed for
   real**, with `AssertionError: function splitRawIntakeAndCleanPrep not found in app.js` — this is
   genuine behavioral testing (the test extracts and `new Function()`-executes the real source text out
   of `app.js`), not a text/regex match. The repository test (independent of app.js) still passed, as
   expected.
4. Restored: `git checkout HEAD -- collector/server/public/app.js` — hash back to `e1f9aa00...`, exact
   match, `git status` clean.

The test genuinely fails when the production code is reverted and restore is byte-exact. Coverage
across the two tests: exhaustive 2-way partition, Raw Intake score visibility, Clean Prep score
absence, chip-markup absence, and the repository boolean signal transition (false→true) — roughly the
5 cases implied by the doc. **Gap**: as noted in C, coverage does not extend to the cross-table overlap
with Field Pack Review / Workflow-warning, because the test stubs `splitRawQueueByFieldPack` to return
empty arrays.

---

## H. Theme — PASS

No `.css` file appears in the diff at all (confirmed by `git diff --stat` and independently by a
sub-agent). No new CSS class was introduced. `workflow-badge-cleaned`, `intake-chip`, and
`raw-interest-wrap` — the three classes the new UI relies on — all have both a base rule and a
`:root[data-theme="dark"]` override in `collector/server/public/styles.css`.

---

## I. False claims vs code defects (implementer's doc)

**False claims** (documentation says something the diff/repo does not support):
1. "382 insertions(+), 72 deletions(-)" total — actual is 407/72 (§B). Every per-file number is
   correct; only the summed total is wrong.
2. `formatWorkflowBadge()` at `app.js:5000-5048` — no such function exists; real name is
   `workflowBadge()`, and the cited line range is unrelated code (§D). The underlying claim it's meant
   to support (badge mapping untouched) is still true.
3. "Field Pack Review ... and workflow-warning table remain separate downstream/special-purpose
   surfaces" — **false as stated**. They remain separate UI panels, but their item populations now
   overlap with the new Raw Intake table (§C). This is the one false claim that also constitutes a real
   code defect, not just a documentation slip.

**Claims independently re-verified as true** (not just re-stated from the doc):
- Final two-tree gate 59/59, identical failure names (§A).
- `node --check` on all three touched JS files, and `git diff --check`: all pass, re-run myself.
- Workflow-warning panel content byte-identical to `main` (§B).
- No CSS file/class touched (§H).
- Every other code citation in "1. Signals for..." and "3. สถานะ badge mapping" sections resolves to
  real code that matches the described behavior, modulo minor line-number drift (a few lines, not a
  wrong claim) — cross-checked function-by-function by an independent sub-agent.
- Revert-gate outcome (test fails on reverted code, passes restored) — re-run myself independently
  rather than trusting the doc's own account of *how* they did it (§G).

---

## Summary table

| Item | Verdict |
|---|---|
| A. Gate | PASS |
| B. Scope | PASS (one false total-count claim, cosmetic) |
| C. Table split | **CONDITIONAL — real duplicate-listing regression against Field Pack Review / Workflow-warning tables** |
| D. Shared helpers | PASS (one wrong function-name citation in the doc, no code impact) |
| E. `has_active_approved_context` | PASS (N+1 real but incremental and indexed; `user` role does see it, as intended) |
| F. Chip removal | PASS |
| G. Tests | PASS (re-verified myself; coverage gap matches the C defect) |
| H. Theme | PASS |
| I. False claims | 3 found, 1 of which (Field Pack Review/warning "remain separate") is also a functional defect |

## Merge readiness

**Not ready.** Fix the item in §C before this can merge: `splitRawIntakeAndCleanPrep` needs to operate
only on the `raw_prep`-bucket subset (matching what `main`'s combined table drew from), or the
Raw Intake/Clean Prep tables need to explicitly exclude items already claimed by
`splitRawQueueByFieldPack`'s `review`/`unknown` buckets, so no item can render in two tables on the same
page at once. The new test suite should also be extended to exercise the two splitters together against
shared bucket data (not a stubbed-empty `splitRawQueueByFieldPack`) so this class of regression is
caught automatically going forward. The two cosmetic doc inaccuracies (§B total count, §D function
name) are worth a one-line fix but are not merge-blocking on their own.
