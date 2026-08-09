# Recheck audit: fix/hardcoded-test-paths @ 7132a08 (stale branch vs current main)

**Role:** external auditor (read-only against real `main`; only this report file is written/committed;
no merge, no rebase, no push of anything except this report).
**Branch:** `fix/hardcoded-test-paths` (`7132a08`), forked from `main` @ `e05eb90`.
**Current `main`:** `065da92` — **85 commits ahead** of the fork point. This branch has sat stale
for a long time while `main` moved, including a large refactor
(`4a6b2e2 refactor(collector): make schema.sql canonical and remove boot-time schema mutation`,
-1940/+144 lines across `client.mjs`/`repository.mjs`/`index.mjs`/3 test files) that directly
overlaps files this branch touches.

**Method:** every claim below was verified by actually running commands against real git objects —
trial merges in disposable `git worktree` copies (never touching the real `main` ref — see the
incident note in §0), the actual guard test executed with Node (not approximated by grep), and
hash-verified file round-trips. Nothing here is taken from the implementer's original PR description.

## 0. Process incident (disclosure)

While setting up the first trial-merge worktree, a `git commit` run inside that worktree (intended
as a throwaway local commit for test purposes) advanced the **real local `main` branch ref** to the
throwaway commit, because the worktree had `main` checked out and worktrees share branch refs with
the main checkout. This was caught immediately by comparing `git rev-parse main` against
`git rev-parse origin/main` (mismatch), fixed by detaching the worktree's HEAD and running
`git branch -f main origin/main` to restore the local ref to exactly match `origin/main`
(`065da92...`, verified by hash after the fix). No push occurred at any point during this, so
`origin/main` was never at risk. All subsequent worktrees in this audit were created with
`--detach` to prevent a repeat. Flagging this for transparency since the task explicitly forbids
touching `main`.

## 1) Merge cleanliness — tested in a disposable worktree, not on real main

`git merge --no-commit --no-ff fix/hardcoded-test-paths` against a fresh detached worktree of
`main` @ `065da92` produces **2 conflicting files**:

- **`collector/tests/assignment-ui-scope.test.mjs`** (conflict at import block, ~line 7-13). `main`
  added `import { DatabaseSync } from "node:sqlite"` and `createRepository` to the repository
  import (needed by tests `main` added after the fork); the branch added
  `import { fileURLToPath } from "node:url"` (needed for its path fix) and dropped
  `createRepository` from the same import line (it didn't need it in the old snapshot). Both sides
  changed the same lines for unrelated reasons — a real but small conflict, mechanically resolvable
  by keeping both additions.
- **`collector/tests/translation-recheck.repository.test.mjs`** (conflict at line ~273-373). This
  one is **not mechanical** — `main`'s side is *empty* here because commit `4a6b2e2` deleted these
  same two test blocks (`repository migration adds recheck columns to existing nullable-source
  table...` and `...rebuild path does not duplicate columns...`) as part of removing boot-time
  schema migration entirely (1082 lines cut from `repository.mjs`, 274 from `client.mjs` — the
  migration codepath these two tests exercise, e.g. `assertHasRecheckColumns` add-columns behavior,
  no longer exists anywhere in current `main`). The branch's side still has these two tests intact
  (just with the path fixed). **Taking the branch's side blindly here resurrects two tests for
  functionality `main` deliberately deleted — they would fail, not because of anything this branch
  did wrong, but because they test a migration path that doesn't exist anymore.** Confirmed no
  `ALTER TABLE`/column-migration logic remains in `collector/db/repository.mjs` or `client.mjs` on
  current `main` — `grep` for `assertHasRecheckColumns`/`ALTER TABLE` in those two files: no match.
  Correct resolution is to drop the branch's two resurrected tests here, not keep them.

No other files conflict — the other 25 files the branch's diff touches merge cleanly (git's
line-based merge already applied `main`'s independent edits to those files without collision).

## 2) Guard test — proven non-tautological, hash-verified restore

Guard file: `backend/tests/no-hardcoded-absolute-test-paths.contract.test.mjs` (added by this
branch, not present on `main` at all — confirmed via `git cat-file -e main:...` → not found).

Ran on the **properly-resolved merge result** (surgical resolution per §1, not a blind
whole-file `--theirs`, since that would have discarded 50+ lines of `main`'s own unrelated
edits to `assignment-ui-scope.test.mjs` and produced misleading extra failures — caught and
corrected mid-audit, see §4).

**Non-tautological proof, done for real, not just cited from the implementer's test:**

```
Baseline hash (collector/tests/article-workspace-ui-surface.test.mjs, merge-result worktree):
  e9cf386a81c4b94b2b4765d51fbf7c1cf0849fb42705f47d008a78c62276636d

Line 8 changed from:
  const root = path.dirname(__dirname);
to:
  const root = path.resolve("D:/UbonCity_Web/collector");

node --test backend/tests/no-hardcoded-absolute-test-paths.contract.test.mjs
  → offender count 3 → 4, and the new offender line is named exactly:
  collector\tests\article-workspace-ui-surface.test.mjs:8: const root = path.resolve("D:/UbonCity_Web/collector");

Reverted line 8 back to path.dirname(__dirname); re-hashed:
  e9cf386a81c4b94b2b4765d51fbf7c1cf0849fb42705f47d008a78c62276636d   <- MATCH

node --test ... rerun: back to 3 offenders (the 3 pre-existing new-on-main ones from §3),
0 for this file.
```

Confirmed: the guard genuinely inspects file content at test time (not a hardcoded expectation) —
injecting a violation is caught by file:line, and the file was restored byte-identical afterward.

## 3) New hardcoded absolute paths on `main` since the branch forked — **3, not 0**

Ran the actual guard test file directly against a clean `main` @ `065da92` checkout (not a grep
approximation — an earlier pass in this same audit used `git grep -P '\b[A-Za-z]:[\\/]'` and
**undercounted**, silently missing every violation written as `D:\\UbonCity_Web` with an escaped
double-backslash in the source text, which the PCRE engine in this git-for-windows build doesn't
match against that character class the way Node's own regex does — see correction note below).
Ground truth, from actually executing the real test: **`main` currently has 33 hardcoded
drive-path violations total**, across 25 files.

Cross-referencing each offending file against the branch's fork point (`e05eb90`):

- **30 of the 33 are pre-existing** — present in files that already existed at `e05eb90`, in the
  exact same lines the branch's own `7132a08` diff already fixes. `main` just hasn't merged that
  fix yet; these are not new problems, they're the reason this branch exists.
- **3 are genuinely new** — introduced by commits on `main` after the fork point, in files that
  did not exist at `e05eb90` at all (confirmed via `git cat-file -e e05eb90:<path>` → not found for
  all three):

  | File:line | Introduced by |
  | --- | --- |
  | `collector/tests/clean-crawl-shortcut.surface.test.mjs:6` | `6051850 fix: add clean crawl merge shortcut` |
  | `collector/tests/normalizer-media-phone-guard.test.mjs:8` | `e2e489e fix: attach media from payload_json sibling and add national_phone_number to extracted normalizer` |
  | `collector/tests/raw-intake-clean-prep.behavior.test.mjs:15` | `53db178 feat: split raw intake and clean prep tables` |

  All three use the identical pattern: `const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");`.

**Answer: merging this branch as-is, with zero other changes, makes the guard test fail
immediately** — not because of anything wrong with the branch's own diff, but because 3 files
added to `main` after the branch forked never went through the hardcoded-path fix. **3 file:line
spots need fixing before (or as part of) this merge** for the guard to pass.

## 4) Gate numbers — measured directly, both trees, in a properly configured environment

**Methodology correction made mid-audit:** the first two measurement attempts in isolated
`git worktree` copies produced inflated failure counts (66 and 69) that turned out to be
**measurement artifacts, not real failures**:

1. A bare `git worktree` has no `node_modules` (untracked/gitignored) — first attempt threw
   `ERR_MODULE_NOT_FOUND` on `dotenv`/`jsonwebtoken`/`mysql2`/etc. Fixed by junctioning
   `collector/node_modules` and `backend/node_modules` from the real checkout into the worktree.
2. `collector/.env` is untracked (gitignored: `collector/.gitignore:1`) and contains
   `COLLECTOR_SYNC_BACKEND_API`, required by 6 of the `manual-import-merge-backfill.behavior.test.mjs`
   tests (they spawn `collector/server/index.mjs` as a subprocess, which throws
   `Backend auth API base URL is required` without it). A bare worktree doesn't have this file.
   Fixed by copying `collector/.env` into the worktree.
3. One test (`sqlite smoke guard uses canonical paths instead of tmp-looking strings`,
   `backend/tests/smoke-safety.test.mjs:16`) failed only because the first scratch worktree was
   placed under `C:\Users\...\AppData\Local\Temp\`, which **is** the real OS temp root
   (`os.tmpdir()`) — the test's own logic (`scripts/smokeSafety.mjs:31`,
   `resolveRealPathOrParent(os.tmpdir())`) is designed to distinguish a directory that merely
   *looks* tmp-like from one that's actually under the OS temp root, and my worktree location
   defeated that distinction by accident. Fixed by relocating worktrees to `D:\audit-scratch\...`.

After all three fixes, a fresh measurement against pure `main` reproduces
**`docs/TEST_SUITE_BASELINE.md`'s claimed baseline exactly**: `915 tests, 855 pass, 59 fail,
1 skipped`. **This retracts a claim in this session's previous audit report
(`audit/hide-media-evidence-audit.md`), which stated the baseline doc was stale because an
uncorrected worktree measurement showed 66 fail — that 66 was itself the same
missing-`.env`/missing-`node_modules` artifact, not a real doc/reality gap.** The
`docs/TEST_SUITE_BASELINE.md` baseline is accurate as of `065da92`; no correction to that doc is
needed.

**Final numbers, properly configured (`.env` present, `node_modules` linked, worktree outside
the OS temp root), sorted failing-name diff (not just counts):**

- **`main` @ `065da92`:** 915 tests, 855 pass, **59 fail**, 1 skipped — matches
  `docs/TEST_SUITE_BASELINE.md` exactly, name-for-name (spot-checked the full 59-name list against
  the doc's known-failures table; consistent).
- **Merge result** (`main` + `fix/hardcoded-test-paths`, §1's two conflicts resolved surgically —
  keep both sides' imports in `assignment-ui-scope.test.mjs`, drop the branch's stale resurrected
  tests in `translation-recheck.repository.test.mjs`): **916 tests, 855 pass, 60 fail, 1 skipped.**
- **Diff of sorted failing names: exactly one new name** —
  `no test file under backend/tests or collector/tests hardcodes an absolute drive-letter path`
  (the guard test itself, failing on the 3 pre-existing-on-`main` violations from §3). **Zero other
  regressions. Zero tests newly fixed.** Pass count is identical (855 vs 855) because the guard
  test is a new test that fails, not an existing test flipping from pass to fail.

This is a clean, single-cause result: the entire gate delta between `main` and the merge is fully
explained by §3's 3 violations. Fix those 3 lines and the merge result should hit `916/916 tests,
same 59 pre-existing fails, 0 new` (not independently re-verified after a hypothetical fix, since
fixing code is out of scope for this audit — stated as a prediction, not measured).

## 5) Verdict

**Do not merge as-is. Also do not throw the branch away — the fix content itself is sound and
still needed; the branch is just stale.** Two blocking items, both small and well-scoped:

1. **3 new violations on `main` the branch never saw** (§3) — `clean-crawl-shortcut.surface.test.mjs:6`,
   `normalizer-media-phone-guard.test.mjs:8`, `raw-intake-clean-prep.behavior.test.mjs:15`. Same
   one-line fix pattern the branch already applies everywhere else. Without this, the guard test
   fails on merge day one.
2. **1 non-mechanical conflict** (§1) — `translation-recheck.repository.test.mjs` needs its two
   resurrected tests dropped (they test a migration codepath `main` deleted in `4a6b2e2`), not
   auto-resolved by taking either whole side.

Recommended path: **rebase the branch onto current `main`** (re-apply the path-derivation fix on
top of `065da92`, which naturally drops the two obsolete migration tests since they no longer
exist to modify, and separately hand-fix the 3 new files) rather than merging the stale branch and
patching afterward — cleaner history, and the rebase forces exactly the two decisions above to be
made explicitly instead of silently by whichever merge strategy is used. The
`collector/tests/assignment-ui-scope.test.mjs` import-line conflict (§1) is the only place a plain
rebase would still need one manual keep-both-sides resolution; everything else applies cleanly.

Not blocking: the guard test itself is sound and non-tautological (§2, hash-verified). The
branch's own diff introduces no other problems. Gate is clean once the 3 files are fixed.
