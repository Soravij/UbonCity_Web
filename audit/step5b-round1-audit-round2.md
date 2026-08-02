# Step 5B round 1 — external audit, round 2

Branch: `codex/step5b-round1-canonical-readers` @ `a3aa391` (unchanged from the round-2 brief).
Method: no reports trusted — every item below was reproduced directly on this checkout
(`D:\UbonCity_Web`, machine `dev`). All git history/diff commands, all four test-file runs, one
full-suite run on HEAD, one full-suite run on a temporary `git checkout main`, and one scoped
production-only revert (`git apply -R` on `repository.mjs`/`index.mjs`, tests left at HEAD content)
were executed and their raw output inspected. The working tree was restored to the exact `a3aa391`
diff (`git diff HEAD -- collector/db/repository.mjs collector/server/index.mjs` → 0 lines) and the
branch re-checked-out before writing this report. No files were committed or pushed. Scratch files
created during verification (`audit_*.txt`, `.patch`) were deleted afterward; `audit/round2-*.log`
were left as evidence (gitignored by the root `*.log` rule, same as round 1's baseline logs).

## Overall verdict: **CONDITIONAL**

Both items this round was scoped to check are now backed by real, reproducible evidence: the 6
lossy-state groups (7 concrete states) do fail on a production-only revert with the exact symptom
claimed (`production_state`/`publication_state` become `undefined`), and the gate is clean (59=59,
identical failing-name sets, zero new/zero missing) against a *freshly checked-out* `main`, not a
cached file. Item 6 (`uploads/*.gif`) is confirmed real and has gotten worse, not better, since round
1. The one thing this round does **not** fix — because it wasn't asked to — is round 1's own
still-open **FAIL** on the hard-delete gate removal (`workflow_status_not_raw` blocker deletion in
`repository.mjs`), which is unchanged in this diff and is now further reinforced by a new test that
locks in the exact behavior round 1 flagged as unjustified. That is the one thing standing between
this and an unconditional PASS on the merge-readiness question, and it wasn't in this round's scope
to re-litigate — flagging it here so it isn't silently dropped.

---

## 1. Base verification — **PASS, with one correction to the brief's own framing**

- `git merge-base HEAD main` = `git merge-base HEAD origin/main` = `8a747053e047ecad5bf15a19c29d8f773c2bebb7` — confirmed base is exactly `main` @ `8a74705`.
- `git log --graph --oneline main..HEAD` shows 3 commits, each with exactly 1 parent (`git cat-file -p <sha> | grep -c ^parent` = 1 for all three) — no merge commits, i.e. a genuinely clean linear rebase, not a merge dressed up as one.
- **Correction**: the brief states the diff vs `main` is "readers→canonical + test 2 ไฟล์". The actual `git diff main HEAD --stat` touches **6 code files**, not 2 test files:
  - `collector/db/repository.mjs`, `collector/server/index.mjs` (production)
  - `collector/tests/assignment-ui-scope.test.mjs`, `collector/tests/in-flight-items.test.mjs`, `collector/tests/raw-delete.test.mjs`, `collector/tests/workflow-readers-loud.test.mjs` (**4** test files, not 2)
  - plus 4 audit doc files (`audit/step5b-round1-*.md`, `audit/step5b-workflow-status-mirror.md`) — docs, expected.

  This isn't a new problem — round 1's own "SCOPE BOUNDARY — PASS" finding already reviewed and passed exactly these same 6 code files — it's just that this round's brief undercounts the test-file scope by half. Not blocking, but the "2 files" claim itself is wrong and shouldn't be repeated.

## 2. Lossy coverage (6 groups / 7 concrete states) — **PASS**

`collector/tests/assignment-ui-scope.test.mjs` (added by `a3aa391`), test `"claim-pool readers preserve
all six legacy-lossy workflow state categories on an empty schema DB"`:

| Group | Concrete state(s) | Assertion |
|---|---|---|
| `field_working` | `{production_state: field_working, publication_state: draft}` | own `assert.deepEqual` per item |
| `field_review` | `{field_review, draft}` | own `assert.deepEqual` per item |
| `writing_assigned` | `{writing_assigned, draft}` | own `assert.deepEqual` per item |
| `writing` | `{writing, draft}` | own `assert.deepEqual` per item |
| `completed_unpublished` | `{completed, draft}` | own `assert.deepEqual` per item, plus a separate `buildItemWorkScopeState(...) === "published_or_completed"` check |
| `archived_or_deleted` | `{collected, archived}` **and** `{collected, deleted}` | 2 separate items, each with its own `assert.deepEqual` |

That's 7 concrete states, each individually asserted (not aggregated) — the loop iterates
`expectedById` and runs `assert.deepEqual` + `assert.equal(row.workflow_status, "raw")` +
`assert.equal(hooks.isClaimableRawPoolItem(row), false)` **twice per state** (once via `repo.getItem`,
once via `repo.listItems()`), confirming both readers independently.

**Revert-and-fail proof, reproduced directly:**
```
git apply -R audit_prod.patch   # reverts only repository.mjs + server/index.mjs to main's content
node --test --test-concurrency=1 collector/tests/assignment-ui-scope.test.mjs collector/tests/in-flight-items.test.mjs collector/tests/raw-delete.test.mjs collector/tests/workflow-readers-loud.test.mjs
→ 101 tests, 64 pass, 37 fail (was 0 fail at HEAD for the 4-file scope's own new tests)
```
The lossy-groups test fails exactly as claimed:
```
✖ claim-pool readers preserve all six legacy-lossy workflow state categories on an empty schema DB
  AssertionError: item #1 must retain its canonical state instead of relying on the lossy raw mirror
  +   production_state: undefined,
  +   publication_state: undefined
  -   production_state: 'field_working',
  -   publication_state: 'draft'
```
`collector/tests/in-flight-items.test.mjs`'s new test fails with the identical `undefined`/`undefined`
symptom. Patch was re-applied afterward; `git diff HEAD -- collector/db/repository.mjs
collector/server/index.mjs` returned 0 lines, confirming an exact restore.

## 3. `assignment-ui-scope.test.mjs` real coverage vs relabel — **CONDITIONAL / effectively resolved, but not by fixing the flagged lines**

Two different edits live in this one file and need to be told apart:

- **The original `+2/-2` fixture edit** (commit `72c9088`, the one round 1 flagged as a pure relabel)
  is **unchanged** in this round. Reproduced: on the same production-only revert above, the test
  containing it — `"item ownership scope metadata distinguishes raw pool, claim, assignment, and
  viewer reason"` — **still passes** (`✔`) against reverted (`main`-equivalent) production code. Per
  the brief's own rule ("ถ้ายัง pass ทั้งที่ revert = ยัง relabel อยู่"), this specific edit is still,
  by that test, a relabel — round 1's finding on it stands, uncorrected.
- **The new lossy-groups test** (`a3aa391`, same file, described in §2 above) **does** fail on revert
  with the real `undefined`/`undefined` symptom.

Net effect: round 1's actual concern here — "the file's changes don't prove anything, add a fixture
that would" — is satisfied at the *file* level, because new coverage was added into the same file
that does fail on revert. But that happened by addition, not by correcting the originally-flagged
lines, which remain non-evidence on their own. Calling this outright PASS would overstate what
happened to the specific lines round 1 named; calling it FAIL would ignore that real coverage for the
same risk now exists in the same file. Recording it as resolved-by-addition, not resolved-by-fix.

## 4. Gate: failing-test-name set, HEAD vs a freshly checked-out `main` — **PASS**

Full suite (`npm run test:all`, i.e. `backend/tests/**` + `collector/tests/**`,
`--test-concurrency=1`) run twice, from a clean tree each time:

| | tests | pass | fail |
|---|---|---|---|
| HEAD (`a3aa391`) | 815 | 755 | **59** |
| `main` (`8a74705`, temporary `git checkout main`, then switched back) | 811 | 751 | **59** |

+4 tests / +4 pass at HEAD matches exactly the 4 new tests added by this diff. Failing-test-**names**
extracted from each run's own `✖` lines (not the summary count), deduped, sorted, and diffed as sets:
`comm -23`/`comm -13` between the two 59-line sorted files returned **empty both ways** — the sets are
byte-identical. **new = 0, missing = 0**, confirmed against a live `main` checkout, not a cached file.

**Secondary finding**: the committed baseline file `audit/step5b-round1-failing-test-names.txt` (from
round 1, `a3aa391`'s own repo) has **60** names, not 59. Diffing it against the fresh 59-name set found
one stale entry: `"user profile and external assignee contracts are wired end-to-end with minimal
schema changes"` — present in the old 60-name file but not failing in either fresh run. This matches
`audit/step2-test-failure-set-diff.md`'s own record of that exact test as a "resolved baseline
failure" from step 2, i.e. round 1's saved baseline file was already stale by one entry when it was
written. This didn't break round 1's own name-set comparison (both sides of that comparison used the
same stale file), but it means round 1 never actually validated against a live `main` — this round is
the first time that's been done. Recommend regenerating `step5b-round1-failing-test-names.txt` from a
fresh run before it's cited again.

## 5. `uploads/*.gif` — **CONFIRMED real, and worse than round 1 reported**

- Round 1 (a few hours earlier) found 3 stray files. As of this run: **9** `uploads/media-*.gif` files,
  timestamps `13:02`–`19:16` today — still actively accumulating, likely one per `npm run test:all` /
  browser-smoke invocation (consistent with round 1's hypothesis).
- `git status --short uploads/` → `?? uploads/` (untracked, not ignored). `git status --ignored --short`
  shows `!! backend/uploads/` (correctly ignored) alongside `?? uploads/` (not ignored) — direct
  side-by-side confirmation the root `uploads/` is not covered by any `.gitignore` rule (`.gitignore`
  only has `backend/uploads/` at line 24 and `collector/media/uploads/` at line 43; no bare `uploads/`
  entry exists). Per-file `git check-ignore -v uploads/media-....gif` on 2 sampled files both returned
  exit 1 (not ignored).
- **Caveat on method, for whoever reruns this**: `git check-ignore -v` on a *directory path with a
  trailing slash* (e.g. `uploads/`, or even a made-up `zzz_nonexistent/`) falsely reports a match
  against a genuinely blank line 69 of `.gitignore` on this machine's git — reproduced and confirmed
  as a tool artifact, not a real rule (a known-ignored directory like `node_modules/` matches its real
  pattern correctly; a bare nonexistent directory name with a trailing slash also "matches" line 69,
  which is empty). The reliable signal is the per-*file* check and `git status --ignored`, both used
  above; don't trust a bare directory-with-trailing-slash `check-ignore` call on this box.
- Net: these are real untracked artifacts sitting where a future `git add -A` would pick them up,
  confirmed not destructive but still recommend deleting before merge, same as round 1's
  recommendation — the underlying test-run process that writes to this path is still unaddressed and
  still producing new files during this exact audit session.

---

## Carried over from round 1, not in this round's scope but still true — flagging so it isn't lost

`collector/db/repository.mjs`'s `getRawOnlyHardDeleteEligibility()` in this diff **still** removes
`if (String(item.workflow_status || "").trim().toLowerCase() !== "raw") addBlocker("workflow_status_not_raw");`
— byte-identical to what round 1 marked **FAIL** (`audit/step5b-round1-audit-findings.md` §1), on the
grounds that `collector/scripts/migrate-place-review-flags.mjs` (already on `main`, not part of this
diff) can produce exactly the stale-mirror-vs-clean-canonical divergence this blocker existed to catch,
via a raw-SQL write path that bypasses `reconcileLegacyWorkflowStatusMirror()`. That reasoning wasn't
re-verified this round (out of the given scope), but the code it's about is unchanged, so the finding
still applies as-is.

What's new this round: `collector/tests/raw-delete.test.mjs` (`a3aa391`) adds
`"raw hard-delete eligibility relies on canonical state when the legacy mirror is stale"`, which sets
`workflow_status='approved'` on an otherwise-raw item and asserts it's still hard-delete-eligible with
no `workflow_status_not_raw` blocker — i.e. this round **adds a test that locks in the exact behavior
round 1 flagged as unjustified**, without adding anything that addresses the migration-script bypass
concern. This doesn't change round 1's verdict, but it does mean the diff is moving further in the
direction round 1 said not to merge on, not away from it.

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 1 | Base / rebase cleanliness | PASS (brief's "2 test files" claim is wrong — actually 4) |
| 2 | 6-group / 7-state lossy coverage | PASS |
| 3 | `assignment-ui-scope.test.mjs` coverage vs relabel | CONDITIONAL — resolved by addition, original flagged lines still unfixed |
| 4 | Failing-test-name gate vs fresh `main` | PASS (59=59, identical sets; round-1's saved baseline file found stale by 1) |
| 5 | `uploads/*.gif` | Confirmed real, growing (3→9 files), not gitignored |
| — | Round-1 hard-delete gate FAIL (carried over) | Still unresolved; now reinforced by a new test, not addressed |

**Recommendation**: items 2, 4, and 5 are clean and reproducible. Item 3 is fine in substance (real
coverage now exists) but the brief should stop citing the original `72c9088` fixture edit as evidence
— it still isn't. The blocking issue for merge remains round 1's item 1 (hard-delete gate), which this
round did not touch and which the new `raw-delete.test.mjs` test now codifies rather than resolves.
