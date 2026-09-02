# Verification: commit 7c2f863 vs. requested fix (app.js:10053 only)

Mode: verification (read-only against code; execution via test-runner/gate in an isolated
git worktree, per recipe v2). Branch `fix/sync-refresh-asset-lookup` @ `7c2f863`. No commit,
merge, restart, or edit made to the primary working tree.

Requested: add `loadAssignmentAssets({showStatus:false})` at one point in
`syncAssignmentSubmissionUploads`, after upload success. Delivered: two call sites —
`app.js:10053` (upload path, in scope) and `app.js:10063` (server-synced path, not literally
in scope).

## Q1/Q2 — is app.js:10063 necessary or scope creep?

- **Path:** the branch at app.js:10061-10068, entered only when `uploadQueue.length === 0`
  (no local file staged in this browser tab) **and** `applyAssignmentServerSyncedAssets()`
  (app.js:7205-7226) finds a complete, non-empty already-synced asset set. This is the
  "reopen an assignment that was already synced earlier / elsewhere" case, not a fresh upload.
- **Does this path upload new files?** No. `applyAssignmentServerSyncedAssets()` is
  synchronous, makes no `fetch`/`api()` call — it only recomputes bookkeeping from the
  existing `state.assignments.assetLookup` (via `getAssignmentServerSyncedAssetsForCaptureItems`,
  app.js:6935-7049, which reads `assetLookup` at 6949). So the literal instruction ("after
  upload success") does not cover this branch — **this is scope creep relative to the
  instruction's wording.**
- **Is it functionally necessary anyway?** Partially yes. `buildAssignmentSubmissionGateState()`
  (app.js:7617-7711, re-invoked at 10065) independently recomputes its own fresh call to
  `getAssignmentServerSyncedAssetsForCaptureItems()` off `state.assignments.assetLookup`
  (via `composeAssignmentSubmissionEffectiveAssets` at 7107-7203, called from 7116) — the
  same mechanism as Finding 1 in `audit/client-cache-refresh-sweep.md`. Concrete stale case:
  two tabs open on the same assignment; Tab A does a real upload (gets the app.js:10053
  refresh); Tab B has no local queue and clicks sync — without a refresh at 10063, Tab B's
  gate panel at line 10065 would render off `assetLookup` as of Tab B's last `selectAssignment()`,
  missing Tab A's newer batch or still showing since-superseded expired rows. That is the same
  bug family, just reached through the "nothing new to upload, just re-check" doorway instead
  of the "new upload" doorway.
- **Note on ordering inside this branch:** the `serverSynced` variable at line 10061 (which
  decides whether this branch is even entered) is itself computed from `assetLookup`
  **before** the app.js:10063 refresh runs — so the refresh cannot affect the branch-entry
  decision for the current click, only the panel render that follows it. That's still correct
  for its actual purpose (fixing what's displayed), just worth naming precisely.
- **Verdict:** keep it. It isn't literally what was asked, but removing it reopens the
  identical stale-`assetLookup`-feeds-`buildAssignmentSubmissionGateState` bug for this second
  branch. Flagging as scope creep worth Sor's explicit sign-off, not as a defect to revert.

## Q3 — position (await before re-render, not fire-and-forget)

Both sites: `await loadAssignmentAssets({ showStatus: false }).catch(() => {})` (app.js:10053,
10063). `loadAssignmentAssets` (app.js:9780-9810) is `async`, `await`s `api(assetQuery)`
(line 9795), and only *after* that resolves does it synchronously assign
`state.assignments.assetLookup` (line 9799) before returning. Both call sites `await` this
call, and both precede their respective `renderAssignmentSubmissionFileList()` /
`renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(...))` calls
(10054-10055, 10064-10065) with no other await in between. **Confirmed: correctly sequenced,
not a race.**

## Q4 — matches the app.js:10186 template?

The cited template is actually app.js:10186-10188, inside `createAssignmentSubmission`:
```
if (Number(state.assignments.selectedId || 0) === assignmentId) {
  await loadAssignmentDeliverablesBundle({ showStatus: false }).catch(() => {});
  await loadAssignmentAssets({ showStatus: false }).catch(() => {});
}
```
The two new call sites match the inner call exactly (`async/await`, `{showStatus:false}`,
`.catch(() => {})`) but **omit the outer `selectedId === assignmentId` guard**. Not a
correctness bug: `loadAssignmentAssets` has its own internal reentrancy guard
(`ensureSelectedAssignmentId()` at 9781, re-checked against `state.assignments.selectedId` at
9796-9798) that no-ops the state write if the user navigated to a different assignment
mid-await. Effect of the missing outer guard: in that edge case the new sites would still
fetch and write assets for whatever assignment is *now* selected (harmless, just an extra
request) rather than skipping entirely like the template does. **Deviation confirmed, not a
functional defect.**

## Q5 — are the two new tests behavioral or snippet tests?

**Snippet tests, despite the `.behavior.test.mjs` filename.** Both tests in
`collector/tests/sync-refresh-asset-lookup.behavior.test.mjs` call
`extractNamedFunctionSource(appJs, "syncAssignmentSubmissionUploads")` to pull the function's
source as a **string**, then assert on `String.prototype.indexOf` positions of literal
substrings (`"loadAssignmentAssets({ showStatus: false })"`, `"renderAssignmentSubmissionGatePanel("`,
etc.). Nothing is executed — no DOM, no `state`, no mock `fetch`. This is exactly the
"asserts on a literal line of source code rather than behavior" anti-pattern CLAUDE.md warns
about. Confirmed empirically by the revert-proof run below: these checks are not even scoped
per-branch — `indexOf` finds the *first* match anywhere in the whole function body, so
removing the branch-1 call did not fail the branch-1 test.

## Revert proof (recipe v2: worktree outside OS temp + `.env` copy + `node_modules` junctions
for `collector/` and `backend/` + `git worktree add --detach`)

Worktree: `D:/UbonRuntime/worktrees/revert-proof-sync-refresh-7c2f863`, `--detach 7c2f863`.
Removed only the app.js:10053 line (left 10063 untouched), ran the target test file once:

```
# Subtest: syncAssignmentSubmissionUploads calls loadAssignmentAssets after upload success before re-render gate
ok 1 - syncAssignmentSubmissionUploads calls loadAssignmentAssets after upload success before re-render gate

# Subtest: syncAssignmentSubmissionUploads calls loadAssignmentAssets in server-synced path before re-render gate
not ok 2 - syncAssignmentSubmissionUploads calls loadAssignmentAssets in server-synced path before re-render gate
  error: 'expected at least 2 loadAssignmentAssets calls, found 1'
# tests 2
# pass 1
# fail 1
```

**Result did not match the expected shape.** Test 1 (nominally "the upload-path test") still
passed after removing the upload-path call, because it only checks that *some*
`loadAssignmentAssets({ showStatus: false })` occurs somewhere after the literal string
`"uploadAssignmentSubmissionFiles("` and before *some* `renderAssignmentSubmissionGatePanel("`
in the whole function — and the untouched app.js:10063 call still satisfies that. Test 2 failed
instead, because it's the one that actually counts total occurrences (`>= 2`) across the whole
function body, and removing one of two dropped the count to 1. So the suite as a whole still
correctly flags the revert (1 fail where 0 existed before), but **not via the test named for
that branch** — confirming Q5: these are source-text assertions coupled across the file, not
independent behavioral checks per branch.

Restore: `git checkout -- collector/server/public/app.js` in the worktree.
Hash: `git rev-parse HEAD:collector/server/public/app.js` = `7e90b203b886c82ea26215d0e8e2b0e845a22e4a`,
matches `git rev-parse 7c2f863:collector/server/public/app.js` = same hash. **Byte-exact restore
confirmed.** Worktree removed after (`git worktree remove ... --force`); primary tree untouched
throughout (`git status --short` before/after identical, HEAD/branch unchanged at `7c2f863` /
`fix/sync-refresh-asset-lookup`).

## Gate

Run once (ceiling: revert-proof 1 + gate 1, both now used) from the same worktree root
(`npm run gate`, i.e. `node scripts/gate.mjs`, after `git checkout --` restored it to the
committed `7c2f863` state):

```
GATE tests=1018 pass=952 fail=65 skipped=1
```

vs. baseline main `1013/947/65/1`: **+5 tests, +5 pass, fail unchanged (65), skipped unchanged
(1).** The +5 matches the 2 new tests in this branch plus 3 already-merged tests from
`fix/submit-gate-active-batch` (merged into this branch's history at `21514fa`). No new fail
names to report — fail count is identical to baseline.

## Verdict

- Fail count did not increase vs. baseline → **gate is clean, no regression.**
- app.js:10053 and its test do genuinely guard the real Finding-1 bug (revert proof shows the
  overall suite does catch the revert, via test 2's global count, even though test 1's
  per-branch framing is broken).
- Two things worth Sor's explicit decision before merge, not blockers on their own:
  1. app.js:10063 is scope creep vs. the literal instruction — recommend **keep** (see Q1/Q2),
     but flag it as an intentional expansion, not silently folded in.
  2. The new test file is a snippet/source-text test mislabeled `.behavior.test.mjs`, and its
     two cases are not independently scoped per branch — it would not have caught a revert of
     *only* the 10063 line the same way (that scenario wasn't tested per the run ceiling, but
     the mechanism — first-match `indexOf` across the whole function — implies test 1 would
     still pass and test 2 would still fail, i.e. the same conflation, not a per-line guarantee).
     Recommend a follow-up (separate patch) rewriting this as an actual behavioral test that
     exercises the function with a mocked `api()`/`loadAssignmentAssets`, per CLAUDE.md's
     guidance on stale snippet-tests — not required to unblock this merge, but should not be
     treated as real regression protection in its current form.
- **Mergeable from a gate/correctness standpoint.** The two notes above are review comments for
  Sor's judgment call, not evidence of a functional defect.
