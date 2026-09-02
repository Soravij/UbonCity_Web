# Diff audit: fix/backward-reload-deliverables-bundle + fix/submit-gate-active-batch

Read-only audit, Runtime machine. No code changes to the primary working tree, no
commits, no merges, no process restarts. Verification (not fresh discovery) of two
branches against the BUG1/BUG3 findings in `audit/item39-review-page-audit.md`.
Pipeline: audit-scanner → audit-deep-reasoner per branch, plus test-runner in an
isolated git worktree (`isolation: "worktree"`) for revert-proof + gate, so the
primary working tree was never touched even during the revert steps.

---

## Branch A — `fix/backward-reload-deliverables-bundle` (bafdb46)

### Diff
`collector/server/public/app.js:3648` — one line added inside the backward-transition
success callback (`onTransition`, `renderAssignmentBackwardTransitionControls()`,
~app.js:3629-3649):
```js
loadAssignmentDeliverablesBundle({ showStatus: false }).catch(() => {});
```
Plus one new test file, `collector/tests/backward-reload-deliverables-bundle.behavior.test.mjs`.

### A1 — which assignment id does the reload target?
`loadAssignmentDeliverablesBundle()` (`app.js:9754-9777`) resolves the assignment via
`ensureSelectedAssignmentId()` (`app.js:9725-9731`), which reads
`state.assignments.selectedId`. **Confirmed (deep-reasoner)**: in the reported bug
scenario (reviewer on `tab=review`, already viewing assignment #29's own review panel,
triggering the backward-transition widget for that same open assignment),
`selectAssignment(29)` set `selectedId=29` and `contextItemId=39` together
(`app.js:9248, 9252`) before the transition ever runs, and nothing between that point
and `onTransition`'s success callback mutates `selectedId`. So at line 3648,
`ensureSelectedAssignmentId()` returns `29` — the correct assignment — and the
`requestSeq`/`selectedId` guard in `loadAssignmentDeliverablesBundle`
(`app.js:9765`) also passes. **The fix correctly resolves BUG1 for the reported case.**

Edge case found (not the reported scenario, pre-existing architecture, not introduced
by this patch): the backward-transition widget is also reachable from the handoff
queue via `selectAssignmentContextItem()` (`app.js:3614-3627`), which sets
`contextItemId` **without** touching `selectedId`. If triggered from there with
`selectedId` null or stale, either (a) `ensureSelectedAssignmentId()` throws → swallowed
by `.catch(()=>{})` → identical to pre-fix behavior, not worse; or (b) a stale
`selectedId` from a different assignment triggers a harmless redundant refresh of that
*other*, still-correct assignment's own data — no cross-assignment data leakage in
either sub-case. Not a blocker.

### A2 — silent `.catch(() => {})`
Confirmed: swallows network errors, 4xx/5xx, and the "no assignment selected" throw
with zero user feedback (`showStatus: false` also suppresses the success case). Worst
case (per A1) degrades to exactly pre-fix behavior. Minor non-blocking polish gap —
worth a follow-up (e.g. a quiet retry or a subtle "sync failed, refresh manually"
affordance) but not a regression risk.

### A3 — call sites / race safety
`onTransition`/this line has exactly one call site. No button-disable during the async
transition means a fast double-click could fire two overlapping
`loadAssignmentDeliverablesBundle()` calls, but the existing `requestSeq` guard
(`app.js:9765`) discards stale responses — wasted network calls at worst, no incorrect
render.

### A4 — revert-proof
**PASS.** Removing `app.js:3648` in an isolated worktree made both new test cases fail:
```
not ok 1 - onTransition reloads deliverables bundle even when resume_path matches current URL
not ok 2 - onTransition does not return early before loading deliverables bundle in non-navigate path
```
Restoring via `git checkout -- collector/server/public/app.js` reproduced a byte-exact
match: `git hash-object` = `93749ef...` = `git ls-tree bafdb46` blob hash. Re-run after
restore: both tests pass. Test mechanism is a **snippet test** (reads real source,
asserts literal presence/position of the added call inside the real function body) —
not a mocked tautology, and it does fail without the fix, but it does not independently
prove the fix resolves the live-UI symptom (no browser/DOM assertion).

### Gate
**Not measured.** `npm run gate` failed in the isolated worktree — root cause:
fresh worktrees don't include `node_modules` (untracked). A retry copying
`node_modules` from the primary tree also failed. Per STOP RULE, the agent stopped
after this second attempt rather than trying a third workaround. This is a worktree
environment limitation, not evidence of a branch regression (see Branch B below, where
`npm run gate` was separately confirmed broken on `main` itself for an unrelated
reason).

### Verdict: **Mergeable.** No blocking issue found. Revert-proof solid. Deep-reasoner
confirms the fix correctly resolves BUG1 for the reported scenario with no
cross-assignment data-corruption risk in any edge case traced. Gate number unavailable
(environmental), not a merge blocker.

---

## Branch B — `fix/submit-gate-active-batch` (809ac16)

### Diff
`collector/db/repository.mjs` — new function `countActiveAssignmentWorkAssetsByType(assignmentId, contentItemId)`
(~6077-6089), reusing the existing `resolveActiveAssignmentWorkBatchRows` helper
(~2824-2858) via a new prepared statement `listAssignmentWorkAssetsByAssignmentAndTypeStmt`.
`collector/server/index.mjs:11354-11361` — submit gate now calls this instead of two
`repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, ...)` calls (strict
`assignment_round = currentRound` equality). Plus one new test file,
`collector/tests/submit-gate-active-batch.test.mjs`.

### B1 — does it genuinely reuse `resolveActiveAssignmentWorkBatchRows`?
**Yes, confirmed.** `countActiveAssignmentWorkAssetsByType` fetches rows via
`listAssignmentWorkAssetsByAssignmentAndTypeStmt.all(...)` then passes them straight
into `resolveActiveAssignmentWorkBatchRows` — same helper, same call pattern as the
pre-existing `isLatestActiveAssignmentWorkAsset` (~repository.mjs:6066-6075). No
duplicated/reimplemented logic.

### B2 — does "active" match `isLatestActiveAssignmentWorkAsset`'s definition?
**Yes, confirmed.** Both functions fetch via the same statement shape and the same
`resolveActiveAssignmentWorkBatchRows` grouping (by `slotKey`/`mediaType`, keeping the
highest `assignment_round` per group). No divergence between "what counts as active for
the gate" and "what counts as active for deliverable-linking."

### B3 — CRITICAL: can rejected/stale assets slip through the now-lenient gate?
**No — ruled out at the schema level (deep-reasoner, high confidence).**
`content_assets` (`collector/database/schema.sql:143-161`) **has no `status` column at
all**, and no migration ever adds one (`database/migrations/005_image_workflow_guardrails.sql`,
`009_content_asset_caption.sql` checked). There is no "rejected" row-state to filter for.

The real mechanism that invalidates stale round-N media is a **synchronous
hard-delete/detach**, not a status flag: `requestAssignmentRevisionWithReset`
(`repository.mjs:5717-5776`), triggered when a reviewer requests revision with
`image_reset_required`/`video_reset_required=true` (`server/index.mjs:11082-11100`),
calls `deleteAssignmentWorkAssetsByType` (`repository.mjs:5810-5843`) **at the moment
revision is requested** — before the worker ever gets to resubmit. Non-promoted rows
are hard-`DELETE`d; promoted rows are detached (`assignment_id=NULL`,
`assignment_round=0`, ...) via `detachContentAssetFromAssignmentWorkStmt`
(`repository.mjs:3921-3928`), which also makes them invisible to
`listAssignmentWorkAssetsByAssignmentAndTypeStmt`'s
`assignment_id=? AND assignment_surface='assignment_work'` filter. By the time the new
gate runs, there are no stale rows left to over-count. Confirmed by existing test
coverage: `tests/revision-asset-retention.test.mjs:256, 407, 454, 467`.

For **non-reset** backward transitions (the actual BUG3 scenario — `revision_round`
bumped via `repo.updateAssignmentState` at `server/index.mjs:9258` without setting
reset flags), old-round assets are correctly never deleted and legitimately remain
valid — the gate treating them as "active" is exactly the intended fix.

### B4 — `contentItemId` provenance
`assignment.content_item_id` is a required, non-null field on any fetched assignment
row by this point in the route handler (assignment is fetched/validated before the
gate runs, ~server/index.mjs:11305-11308). The `Number(assignment?.content_item_id || 0) || 0`
defensive fallback is belt-and-suspenders, not covering a reachable null case.

### B5 — remaining strict-round callers of `listAssignmentRoundAssetsByType`
Confirmed two live definitions of "which assets count" now coexist:
- **Lenient (active-batch)**: the new gate (`server/index.mjs:11354-11361`).
- **Strict (`assignment_round = currentRound`)**: `enforceAssignmentSubmissionRequiredFields`
  → `findMissingCapturePrompts` (`server/index.mjs:~3397-3461`) and
  `enforceResetPerShotRequirements` (`server/index.mjs:~3515-3578`), both called
  **after** the gate in the same submit handler; also `deleteAssignmentRoundAssetsByType`
  (`repository.mjs:5781`), which appears unreferenced elsewhere in the current codebase
  (likely dead code, not verified further — out of scope).

**Not exploitable.** Worst realistic outcome: gate passes leniently (e.g. an untouched
round-1 video legitimately counts as the ≥1 attachment), then
`enforceResetPerShotRequirements` correctly throws a 400 if a reset-required media type
hasn't been re-shot in the current round — an error surfaced to the user, not a bad
submission created. The strict-round validators aren't acting as an accidental safety
net against rejected assets (none exist to filter); they're independently enforcing
per-shot completeness, orthogonal to the gate's coarse ≥1-attachment check.

**Adjacent, non-blocking finding**: `findMissingCapturePrompts`'s strict-round fallback
could still false-block a legitimate resubmission on the *non-reset* backward-transition
path (assets legitimately at an old round, no reset flags set) — the same BUG3 root
cause, in a second validator this branch doesn't touch. Worth a follow-up audit; not
introduced or worsened by this branch.

### B6 — revert-proof: **FAILED to demonstrate necessity — real gap found.**
Reverting the caller-side change (`server/index.mjs:11354-11361`, back to the two
`listAssignmentRoundAssetsByType` calls) and re-running
`collector/tests/submit-gate-active-batch.test.mjs` produced **no failure** — the test
passed identically with and without the actual fix in place.

Root cause: the test (`submit-gate-active-batch.test.mjs:30-37, 58-61`) extracts and
unit-tests `countActiveAssignmentWorkAssetsByType` **in isolation** via regex-parsing it
out of `repository.mjs`, with a fully mocked prepared statement (`mockStmt.all()`
returning hardcoded arrays). It never calls `POST /api/assignments/:id/submissions`, so
it never exercises the actual line that was changed at the call site. **The test
protects the new repository function's own correctness, but provides zero regression
coverage for the fix that was actually described as fixing BUG3** (the endpoint-level
gate behavior). A future edit that reverted or broke the `server/index.mjs:11354-11361`
call site would pass this test suite unnoticed.

Restoration proof (of the reverted-then-restored file) is clean regardless: `git
checkout -- collector/server/index.mjs` → `git diff --stat` zero changes, `git status
--short` clean, `git hash-object` = `c9ec9be0...` = `git ls-tree 809ac16` blob hash.

Test coverage gap also confirmed: no test case for the `image_reset_required=1`
scenario (B3's safety question) — only round-mismatch-happy-path and
empty-asset-list-blocks cases are covered, both against the mocked isolated function,
not the endpoint.

### Gate
**Not measured** — but for a different, more consequential reason than Branch A:
`npm run gate` fails with `GATE: could not parse summary line from test output` because
`scripts/gate.mjs` invokes `testAll.mjs` expecting piped stdio (`stdio: ["ignore",
"pipe", "pipe"]`), but `testAll.mjs` itself uses `stdio: "inherit"`, so zero bytes are
ever captured for gate's regex to parse. **Confirmed reproducing identically on `main`
directly** (not just this branch) — this is a pre-existing tooling defect, not a
branch-specific regression, but it means `npm run gate` is currently non-functional for
anyone on this repo. Direct invocation of `node scripts/testAll.mjs` does work and
produced a real number in the worktree: `# tests 911, # pass 825, # fail 86, # skipped 0`
— reported here as an observed data point, not as "the branch's gate number" (it wasn't
run as a controlled single measurement per the requested procedure, so treat it as
informational only).

### Verdict: **Logic confirmed safe, but not cleanly mergeable as-is — test gap is a
real blocker for a clean signoff.** The active-batch semantics change itself introduces
no validation-bypass or data-integrity regression (B3, high confidence, traced to the
schema level). But the accompanying test doesn't actually guard the fix it claims to
cover — recommend adding (or rewriting the existing test as) an integration-level test
that calls the real `POST /api/assignments/:id/submissions` route (or at minimum the
real `repo.countActiveAssignmentWorkAssetsByType` wired to a real/in-memory DB, not a
regex-extracted mock) before merge, per this repo's own rule against claiming a fix
without a test that would actually catch its regression.

---

## Cross-cutting notes

- Both branches' gate measurements were blocked, but for **unrelated** reasons: Branch
  A by isolated-worktree missing dependencies (environment-local, resolvable by
  installing deps in the worktree or running gate in the primary tree instead), Branch
  B by a genuine, `main`-reproducing bug in `scripts/gate.mjs` itself (stdio mismatch
  with `testAll.mjs`). The gate.mjs bug is worth its own fix/ticket independent of
  either branch under review here.
- Per the 2-gate-run cap in the original instructions, no attempt was made to establish
  a fresh `main` baseline gate number; `PROJECT_STATE.md`'s documented baseline
  ("gate: 873 / 813 / fail 59 / skipped 1") is itself flagged in that file as
  possibly stale/unverified — a name-level "new failures" comparison against it was not
  attempted for this reason, consistent with the STOP RULE rather than working around
  the run-count cap.
