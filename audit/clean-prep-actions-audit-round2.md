# External audit round 2: Clean Prep row-action hotfix — test-gap closure

**Branch:** `codex/clean-prep-actions-hotfix` @ `5c49d26`
**Baseline:** `main` @ `d2911fb`
**Scope:** delta `8b38ef8 → 5c49d26` (commits `149cfac`, `5c49d26`), plus whole-branch sanity (`d2911fb...5c49d26`)
**Machine/repo:** dev, `D:\UbonCity_Web` — read-only, no Runtime access, no commit/push/merge, report not committed
**Method:** every implementer claim re-measured independently. Static checks (items 2 partial, 3, 5, 6, 8) delegated to a parallel sub-agent using `git show`/`git diff` only (no checkout, to avoid racing this session's own sequential checkout work). Mutating proofs (items 1's non-tautology experiment, 4, 7's gate) run by me directly, sequentially, with the working tree stashed/restored around each.

**Overall verdict: PASS — mergeable.** All 8 items pass. One non-blocking documentation staleness note under item 8 (not a new false claim, just an unrefreshed section) — worth a follow-up edit, not a blocker.

---

## 1. Does the test now derive containers from the real template? — PASS

Confirmed by reading `collector/tests/raw-intake-clean-prep.behavior.test.mjs`: `loadRawIntakeHooks()`'s mock `document.querySelector` no longer pre-seeds a 3-entry map. It now auto-vivifies (`if (!actionBodies.has(selector)) actionBodies.set(selector, {})`) — it only knows about a selector once `renderRawTable`'s real extracted source actually queries it. Container discovery is genuinely template-derived, not hardcoded.

**Reproduced Codex's non-tautology claim myself, not just by reading it.** With `KNOWN_UNBOUND_TABLE_IDS` at its committed value (`["table-raw-workflow-unknown"]`), the full test file passes 5/5. I then temporarily cleared it to `new Set([])` (working-tree-only edit, `sed`, never committed) and re-ran:

```
✖ every table renderRawTable renders with actionable buttons is bound to the delegated row-action handler
  AssertionError: table-raw-workflow-unknown renders actionable buttons but its tbody is not bound
  to the same delegated handler as Raw Intake (add it to KNOWN_UNBOUND_TABLE_IDS only if that is intentional)
```
Exactly one failure, naming exactly the right table. Restored the file from a pre-edit backup immediately after (`git status` confirmed zero diff afterward). **Claim reproduced independently, not tautological.**

I did not go further and hand-author a brand-new fake table into `app.js` to test true novelty (beyond the pre-existing `table-raw-workflow-unknown` case) — that would mean editing production code, which this audit and the implement round are both explicitly barred from doing. The exemption-clearing experiment is the proof the audit brief actually asked for, and it's sufficient: it demonstrates the assertion loop is live and keyed by real derived data, not a tautology that always passes.

## 2. Is the `table-raw-workflow-unknown` exemption correct and appropriately scoped? — PASS

Independently confirmed (sub-agent, cross-checked against my own earlier reading of this code in round 1):

- **Pre-existing, not new:** `main`'s `app.js` binds only `#table-raw-intake tbody` and `#table-raw-review tbody` (2 bindings total). Branch HEAD binds those two plus `#table-clean-prep tbody` (3 bindings, the round-1 fix). Neither ref ever queries or binds `#table-raw-workflow-unknown tbody`. The gap is identical before and after this whole branch — this fix does not touch it.
- **Not over-broad:** the check is `KNOWN_UNBOUND_TABLE_IDS.has(tableId)`, an exact `Set` string-equality lookup against the literal `tableId` each real `renderRawQueueTable({tableId: ...})` call site uses (`table-raw-intake`, `table-clean-prep`, `table-raw-review`, `table-raw-workflow-unknown`). No prefix/substring/regex matching — it cannot accidentally swallow a different table.
- **Exhaustive over what `renderRawTable` renders:** the loop iterates `hooks.renderedTables`, populated by intercepting the *actual* `renderRawQueueTable(...)` calls inside the real extracted `renderRawTable` source (not a hand-maintained list in the test). The existing splitter test already asserts this array has exactly 4 entries, matching the 4 real call sites in `app.js`. Nothing renderable by this function can skip the check silently.
- **Follow-up finding, not a blocker (as the audit brief itself framed it):** the "⚠ Workflow state ผิดปกติ" table's buttons are confirmed genuinely dead in current production on both `main` and this branch — `queueType: "unknown"` rows render an unconditional `open-state-entry` button (and conditionally claim/release/takeover/delete) via the shared template, but no click handler is ever bound to that tbody. Clicking any button in that table does nothing today. This is out of scope for the Clean Prep hotfix (production code shouldn't change for it here) but is now a documented, testable, named gap instead of invisible tribal knowledge — worth a follow-up ticket.

## 3. Are the two added assertions real? — PASS

In the existing button-coverage test (`collector/tests/raw-intake-clean-prep.behavior.test.mjs:254`), both gaps flagged in round 1 are now genuine `assert.match` calls, not just render calls with unused flags:
- Line 279: `assert.match(rawActions, /data-action="takeover-item" data-id="77"[^>]*>Take over<\//);`
- Line 281: `assert.match(rawActions, /<input type="checkbox" data-action="select" data-id="77"/, "Raw Intake row-select checkbox keeps its action attributes");`

## 4. Revert proof — PASS, reproduced directly (not delegated)

```
git hash-object collector/server/public/app.js        → bf92dce... (branch HEAD)
git checkout main -- collector/server/public/app.js
git hash-object collector/server/public/app.js        → effb878... (main's version)
node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs
  → tests 5, pass 3, fail 2
  ✖ "Raw Intake and Clean Prep action buttons retain handler attributes and delegated containers"
     AssertionError: Clean Prep actions use the same delegated handler as Raw Intake (actual: undefined)
  ✖ "every table renderRawTable renders with actionable buttons is bound to the delegated row-action handler"
     AssertionError: table-clean-prep renders actionable buttons but its tbody is not bound... (actual: undefined)
git checkout codex/clean-prep-actions-hotfix -- collector/server/public/app.js
git hash-object collector/server/public/app.js        → bf92dce... (matches original exactly)
```
**Exactly 2 of 5 fail as claimed**, both naming the real cause with a real assertion diff (not a crash or a vacuous pass). Restore hash matches `bf92dce...` exactly, confirming zero residual change.

## 5. Delta scope (`8b38ef8..5c49d26`) — PASS

```
git diff 8b38ef8..5c49d26 --stat
 audit/clean-prep-actions-fix.md                    | 16 ++++-
 collector/tests/raw-intake-clean-prep.behavior.test.mjs | 81 +++++++++++++++++++---
```
Exactly 2 files: the report doc and the test file. **Zero production code changed in the round-2 delta.**

## 6. Whole-branch sanity (`d2911fb...5c49d26`) — PASS

- `git diff d2911fb..5c49d26 -- collector/server/public/app.js` is exactly the same 2-line addition audited in round 1 (`cleanPrepTbody` declaration + `cleanPrepTbody.onclick = handleRowAction`). Round 2 added nothing further to `app.js` — confirmed both by the delta check in item 5 and directly here.
- No `.css` file anywhere in `git diff d2911fb..5c49d26 --stat`.
- `resolveQueueBucket` (737), `isRawPreparationItem` (777), `workflowBadge` (4929), `normalizeDashboardWorkflowStage` (5058) all sit well above the only touched line range (5865–5867/5935–5937) — necessarily byte-identical to `main`, confirmed by the diff itself covering nothing near them.
- No file under a routes/ or workflow/state-machine path appears in the branch-wide `--stat`.

## 7. Gate — PASS, and Codex's "no test:all needed" claim checked against how `testAll.mjs` actually works

**Methodology claim verified true.** `scripts/testAll.mjs`'s own header comment states the invocation is "still one process per file — this is not `--test-isolation=none`", and its single `spawnSync` call passes `node --test --test-concurrency=1 <all files>` — Node's built-in `--test` runner isolates each matched test file into its own child process by default. A change confined to one test file's internal JS logic (as this round's changes are — no production file touched, see items 5–6) cannot leak into another file's process. Codex's reasoning for skipping a full re-run was methodologically sound, not just a convenient excuse — but per this audit's instructions, the actual numbers were still re-measured independently rather than taken on that reasoning alone:

Measured myself, stashing/restoring the working tree around each checkout, no worktree used:

| | `main` @ d2911fb | branch @ 5c49d26 |
|---|---|---|
| tests | 824 | 826 |
| pass | 764 | 766 |
| fail | **59** | **59** |
| skipped | 1 | 1 |

Sorted failing-name-list diff: **empty** (identical sets). **59/59, new 0, missing 0 — exact match to expectation, matches round 1's numbers exactly (this round's changes are test-file-only and don't touch the counted `main` baseline).** The 2 extra tests on the branch (826 vs 824) are the two tests added across both rounds; neither appears in either failure list. `docs/TEST_SUITE_BASELINE.md`'s working-tree content was not used as the baseline, per instruction.

## 8. `audit/clean-prep-actions-fix.md` — CONDITIONAL PASS (no new false claim; one stale section found)

**The specific claim flagged in round 1 is fixed correctly.** "asserts every action" is gone. The corrected text (lines 16–20) lists exactly what's asserted — Raw Intake's open-state-entry/claim-item/release-item/takeover-item/delete/checkbox, Clean Prep's open-state-entry/release-item/delete — and this list was checked line-by-line against the actual test assertions (item 3 above): it matches exactly. No inaccuracy in the corrected prose.

**New finding — a different section of the same doc is now stale, not incorrect-when-written but misleading-in-context:**
```
## Actual diff size
...
2       0       collector/server/public/app.js
60      7       collector/tests/raw-intake-clean-prep.behavior.test.mjs
```
This is `d2911fb..8b38ef8`'s diff (round 1 only) — I confirmed the exact numbers: `git diff --numstat d2911fb..8b38ef8` gives `60 7` for the test file, `git diff --numstat 8b38ef8..5c49d26` adds `73 8` more, so the cumulative branch diff for that file is now `125 7`, not `60 7`. The section wasn't touched by the `5c49d26` edit that fixed the prose above it, and its header ("Command run before adding this audit record") doesn't state which commit range it covers. A reader skimming this doc today could reasonably take `60/7` as the current total diff size for the test file, which is now wrong by more than double.

This is **not a newly-introduced false claim** — the numbers were true for the commit they were measured against, and nobody asserted new false numbers in round 2. It's a doc-freshness gap: a section that needed a one-line update ("as of 8b38ef8; see round-2 delta for the rest") when the surrounding doc was touched, and wasn't. Flagging it because this specific doc has already overstated once — worth a follow-up line, not worth blocking the merge over.

---

## Merge decision

**Mergeable.** All 4 substantive gaps from round 1 (hardcoded container map, missing checkbox assertion, missing takeover-item assertion, overstated "every action" claim) are closed and independently reproduced — not just re-read — as actually closed. The delta and whole-branch diffs stay exactly within their stated scope (test file + report doc only; the 2-line production fix from round 1 is unchanged). The gate matches expectation exactly, measured fresh rather than trusted. The one open item is a cosmetic doc-staleness note in `clean-prep-actions-fix.md`'s "Actual diff size" section — recommend a follow-up one-line fix, but it does not block merging this branch.
