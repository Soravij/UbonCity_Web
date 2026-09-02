# Diff audit — fix/ready-for-writer-queue-bucket (main..fd3c895)

Verification mode. Diff resolves finding #1 from `audit/item39-backward-queue-audit.md`
("lowest risk, highest impact" proposal). Read-only pass: no edits kept, no commits, no
branch switches, no restarts. Currently-checked-out branch on Runtime was already
`fix/ready-for-writer-queue-bucket` @ `fd3c895` at the start of this audit (not switched
by this session).

## A — Revert proof (mutation test)

1. Baseline, fix in place: hashed `collector/server/public/app.js`
   (`sha256:d818e5d5...296f3`), ran `node --test "collector/tests/ready-for-writer-queue-bucket.behavior.test.mjs"`
   via `test-runner` → **3/3 pass**.
2. Mutated: removed the single added line (`|| productionState === "ready_for_writer"`)
   from `app.js:788` via Edit; confirmed via `git diff` that exactly 1 line was removed
   and nothing else touched.
3. Re-ran the same test file via `test-runner` on the mutated file → **1 pass, 2 fail**:
   ```
   ready_for_writer + hasFieldPack=true + ready_for_field → handoff
     expected handoff but got field_pack_review for ready_for_writer with field pack
     + 'field_pack_review'  - 'handoff'
   ready_for_writer + hasFieldPack=true + ready_for_handoff → handoff
     expected handoff but got field_pack_review for ready_for_writer with ready_for_handoff pack
     + 'field_pack_review'  - 'handoff'
   ready_for_writer + hasFieldPack=true + draft status → field_pack_review (not handoff)
     PASSED   (unaffected guard case — correctly unaffected by the mutation)
   ```
   Failures point directly at the bug (expected `handoff`, got `field_pack_review`) —
   not a crash, not a missing-symbol error. Test 3 staying green while 1–2 flip proves
   this is not a tautology; it's discriminating exactly the line that changed.
4. Restored the line via Edit. Verified: `sha256sum collector/server/public/app.js` →
   `d818e5d5184b16d865cb2b8e75c6a1d586d422bf17b3cbb03ac553155ac296f3` (identical to step
   1) and `git diff collector/server/public/app.js` → empty.

**A: PASS.** Revert proof is real, restore is byte-identical, test is not a tautology.

## B — Diff scope

`git diff main..fd3c895 --stat`:
```
 collector/server/public/app.js                                   |  1 +
 collector/tests/ready-for-writer-queue-bucket.behavior.test.mjs   | 98 +++++++++++
 2 files changed, 99 insertions(+)
```
Exactly 2 files. `git diff main..fd3c895 -- collector/server/public/app.js` shows a
single added line at `app.js:788`, inside the `handoff` bucket's `productionState`
allowlist in `resolveQueueBucket()`; 0 deletions, 0 lines touched elsewhere in that
function or file. `audit-scanner` independently confirmed no other branch of
`resolveQueueBucket` (`assignment` ~767, `published` ~770-780, `field_pack_review`
fallback ~798-799, `raw_prep` ~801) was touched. No CSS file appears in the diff at all.

**B: PASS.** Pure 1-line addition + 1 new test file, no scope creep.

## C — Logical correctness

- `isAssignmentContextReady(fieldPackStatus)` (`app.js:956-959`, unchanged by this diff)
  still gates the `handoff` branch — it requires
  `fieldPackStatus ∈ {"ready_for_field", "ready_for_handoff"}`. The new
  `"ready_for_writer"` disjunct only matters if that gate already passed; it cannot pull
  an item into `handoff` on its own.
- `audit-scanner` confirmed `production_state = "ready_for_writer"` is reachable with a
  non-ready field-pack status (`field_pack_status` values include `draft`,
  `field_in_progress`, `field_done`, `on_hold` per `repository.mjs:2347-2353`), and
  verified the new test's own guard case (test 3: `ready_for_writer` + `draft` status →
  still `field_pack_review`, passing both before and after mutation) exercises exactly
  that scenario. No item that should legitimately still show `field_pack_review` gets
  pulled into `handoff` by this change — the `isAssignmentContextReady` gate is
  untouched and still does the work.
- No comment, `PROJECT_POLICY.md`, or `PROJECT_STATE.md` entry documents
  `ready_for_writer`'s exclusion from the `handoff` allowlist as intentional — its
  neighbors on both sides (`field_review`, `writing_assigned`) were already present, so
  its omission reads as the gap the original `item39-backward-queue-audit.md` finding
  identified, not a deliberate design choice being overturned.
- Test file (`collector/tests/ready-for-writer-queue-bucket.behavior.test.mjs:13-48`)
  reads the real `app.js` from disk via `fs.readFileSync` + brace-matched function
  extraction, then `new Function(...)`-evals the actual `getItemWorkflowSnapshot`,
  `getUnknownWorkflowState`, `isAssignmentContextReady`, and `resolveQueueBucket` source
  — it is testing the shipped file, not reimplemented logic.
- Path resolution: `path.resolve(__dirname, "..", "server", "public", "app.js")` built
  from `fileURLToPath(import.meta.url)` (lines 9-11) — no hardcoded absolute path,
  consistent with this repo's CLAUDE.md path-portability rule.

**C: PASS.** No regression risk found; test harness verified sound.

## D — Gate (measured once, on branch)

`npm run gate` on `fix/ready-for-writer-queue-bucket` @ `fd3c895` (run exactly once, via
`test-runner`, per instruction — not re-run):
```
tests: 1021   pass: 954   fail: 66   skipped: 1
```
Recorded baseline in `.gate-summary.json` **before this run overwrote it** (captured
earlier this session):
```
tests: 1013   pass: 947   fail: 65   skipped: 1
```
**Numbers do not cleanly match, and I am stopping here rather than chasing it (per
instruction).** The delta is +8 tests / +1 fail, but this diff only adds 3 tests (1 new
file) — so +5 of those tests, and the baseline itself, are not attributable to this diff.
Root cause of the mismatch: the `.gate-summary.json` baseline is dated **2026-08-22
23:32**, and `main` has since taken 5 more merges (`45f4efe`, `7c2f863`, `21514fa`,
`9cab55c`, `cf4a755` — all visible in `git log main` at the time of this audit), each
likely contributing its own test-count/fail-count movement. This baseline file is not a
trustworthy "main right now" reference; I have no way to obtain a current, uncontaminated
main baseline without checking out `main`, which is owner-managed on Runtime and out of
scope for this pass.

The one failing-test name visible in the (truncated) gate output was **"collector admin
final review smoke"** (exact test-name grep against `collector/tests/` did not find a
literal match, so this is likely a composed `describe`+`it` label truncated/paraphrased
by the runner, not a literal string in the source). This is unrelated to
`resolveQueueBucket` on its face — it is a client-side display-bucket helper with no
reachable path into an admin review-submission endpoint — but I could not enumerate the
other 65 failing names (output was truncated) to positively rule out overlap with this
diff's scope.

**D: INCONCLUSIVE, not attributable to this diff.** No evidence the diff caused new
failures (the change is a single additive OR-clause read only by client-side bucket
display logic, confirmed isolated in B/C), but the baseline itself is stale and a clean
apples-to-apples count is not available without a main-branch run, which I did not
perform (checkout is owner-managed; I was not instructed to use a worktree). Recommend
Sor run `npm run gate` on current `main` once, by hand, if a hard number match is
required before merge.

## Verdict

**MERGEABLE**, with one caveat for Sor's judgment: D's fail-count delta (+1) cannot be
attributed to this diff on the evidence gathered (A/B/C all clean, change is a single
isolated additive line, mutation-proof is solid, no other bucket branch touched), but it
also cannot be positively cleared to zero because the recorded main baseline is 2 days
stale. If a byte-exact gate match against current `main` is a hard requirement before
merge, that one comparison run needs to happen on `main` directly (owner-managed), not
by this session.
