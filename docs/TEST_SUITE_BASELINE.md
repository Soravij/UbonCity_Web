# Test suite: standard command, baseline, and known failures

## Standard command

```
npm run test:all
```

Must run from the repo root. It wraps `scripts/testAll.mjs`, which:

1. Refuses to run (exits 1 with an explicit message) unless `process.cwd()` is the repo root —
   several collector tests (`in-flight-items`, `raw-delete`, `item-blocker-summary`,
   `audit-delete-tier-consistency`, `deleted-item-purge-gate`,
   `deleted-item-reference-classification`) resolve `collector/database/schema.sql` relative to
   `process.cwd()` instead of `import.meta.url`. Run from the wrong directory and they silently
   open the wrong (or a fresh/empty) schema instead of failing loudly, which is almost certainly
   the real explanation for this project's past "56 vs 60" baseline disputes — not test flakiness.
2. Builds an explicit file list (`fs.readdirSync` + filter, not a shell glob) covering both
   `backend/tests/*.test.mjs` and `collector/tests/*.test.mjs`, so the same files run regardless
   of whether npm invokes cmd.exe, PowerShell, or bash.
3. Runs `node --test --test-concurrency=1 <that file list>` — one Node test-runner process per
   file (this is **not** `--test-isolation=none`), forced serial instead of the default
   CPU-count-parallel scheduling.

Do not run `node --test` directly against `collector/tests` or `backend/tests` separately, and
do not `cd` into `collector/` or `backend/` first — both break the baseline below.

## Why `--test-concurrency=1`, and what was actually tested

The claim "the test suite is flaky" was checked empirically before picking a command, not assumed.
On `main` (`0b4f105`), each candidate below ran 5 times back-to-back and the **sorted list of
failing test names** (not just the count) was diffed run-to-run:

| Candidate | Command shape | Same failing-name set across all 5 runs? |
| --- | --- | --- |
| collector only, default concurrency | `node --test collector/tests/*.test.mjs` | Yes — identical, 5/5 |
| collector only, `--test-concurrency=1` | + `--test-concurrency=1` | Yes — identical, 5/5, and identical to the row above |
| backend+collector combined, default concurrency | `node --test backend/tests/*.test.mjs collector/tests/*.test.mjs` | Yes — identical, 5/5 |
| backend+collector combined, `--test-concurrency=1` | + `--test-concurrency=1` | Yes — identical, 5/5, and identical to the row above |
| backend+collector combined, `--test-isolation=none` | + `--test-isolation=none` (single shared process) | Deterministic *internally* (5/5 identical) but **not equal** to the other four rows — 2 extra failures leak in (`getPlaceDetail rewrites self-hosted media paths to backend absolute urls`, `phase 5-6 backend targeted coverage`) from state bleeding across files sharing one process. Do not use this mode for baseline comparisons. |

Conclusion: **no test flip-flops run-to-run under process-isolated execution** (the default
`node --test` behavior, with or without `--test-concurrency=1`) — concurrency was never the
source of the historical dispute. `--test-concurrency=1` was picked anyway as the standard
because it removes the CPU-parallel scheduler as a variable entirely, at the cost of running
serially instead of in parallel.

One cluster (see `manual-import-merge-backfill.behavior.test.mjs` in the table below) passes
100% in isolation but failed as part of the *default main baseline* full-suite run; that same
cluster did **not** reproduce when re-measured on this branch with the standard `test:all`
command (2/2 identical clean runs — see Verification below). The precise interaction wasn't
chased further (isolating it would need more full-suite runs than this change budgeted for) —
flagged here so a future investigation doesn't have to rediscover it from scratch.

## Baseline

Measured against **`main` @ `d5cc8a1`** (2026-08-05), using the standard command
(`npm run test:all`):

- **826 tests total**
- **766 pass**
- **59 fail**

After this change set (same baseline commit `d5cc8a1`):

- **862 tests total**
- **802 pass**
- **59 fail**
- **1 skipped**

### History: the earlier 66-failure number

An earlier baseline measured **66 fail** (739 pass, same 806 total) against `main` @ `0b4f105`
(also 2026-07-31, same day, earlier commit). This was **not** a different measurement method —
it's the same `npm run test:all` command, just measured before the
`codex/harden-runtime-smoke-target-guard` branch (which fixed the
`manual-import-merge-backfill.behavior.test.mjs` cluster, 6 tests) merged into `main` as
`0c1824b`. That branch's own pre-merge measurement already showed 60 fail with zero regressions
against the 66-fail baseline (verified by diffing sorted failing-name lists, not just counts) —
merging simply made that the new `main` state. The 66 number is kept here only as a historical
data point for that comparison; treat the 60-fail baseline above as current.

## How to check for a regression

**Diff the sorted list of failing test names, never just the count.** A matching count can hide
a regression (one test starts failing while an unrelated one starts passing — net-zero on the
number, but a real regression happened). To get a comparable list:

```
npm run test:all 2>&1 | grep "^✖ " | sed 's/ ([0-9.]*ms)$//' | grep -v "^✖ failing tests:$" | sort -u
```

Run this on your branch and on the `main` commit you branched from (a `git worktree add` in a
scratch location keeps this read-only and doesn't disturb your checkout), then `diff` the two
sorted lists. Anything appearing only on your branch's side is a regression to explain before
merging; anything only on `main`'s side is a pre-existing failure your branch happens to fix (nice,
but call it out explicitly rather than letting it silently change the baseline number).

## Known pre-existing failures (main baseline, 60)

All failures cluster by file — grouped below with what's actually wrong, from reading the real
error each one throws (not guessed). The `manual-import-merge-backfill.behavior.test.mjs`
cluster (6 tests) that appeared in the earlier 66-fail baseline is gone as of `0c1824b` — see
the History note above — and has been dropped from this table.

| File | Count | Cause | Category |
| --- | --- | --- | --- |
| `collector/tests/assignment-ui-scope.test.mjs` | 33 | Assertions compare against navigation/tab-list structure (e.g. expects `["handoff","work","review","assignments"]`) that no longer matches the current UI source. | Outdated harness — assertions weren't updated after a UI/route refactor |
| `collector/tests/article-workspace-ui-surface.test.mjs` | 10 | Regex assertions against HTML markup (e.g. `id="table-article-intake"`) that no longer exists under that id. | Outdated harness — markup ids changed |
| `collector/tests/translation-workflow-fallback.test.mjs` | 4 | `TypeError: repo.updateTranslationRecheck is not a function` — the real function exists in `collector/db/repository.mjs:11691` and is exported, but the test's mock `repo` object doesn't include it. | Outdated harness — mock repo object hasn't kept up with the real repo's method set |
| `collector/tests/article-workspace-translation-behavior.test.mjs` | 3 | `SyntaxError: Cannot use import statement outside a module` — the harness loads the target file with `vm.Script`/`runInNewContext`, which can't parse a file that now contains an ESM `import` statement. | Outdated harness — VM-based loader technique incompatible with a since-added `import` |
| `backend/tests/public-response-dto.test.mjs` | 2 | Regex assertions against serializer source (e.g. expects `serializePublicPlaceResponse(normalizePlaceForResponse(` inline) that no longer matches after a refactor. | Outdated harness |
| `collector/tests/reference-media.routes-source.test.mjs` | 1 | `AssertionError` (strict-equal) on `/api/assets` filtering response shape. | Outdated harness (not traced further) |
| `collector/tests/requested-check-ui.behavior.test.mjs` | 1 | `ReferenceError: buildPreviousConfirmedCheckValues is not defined` — no such function exists anywhere in the codebase under this or a similar name. | Not implemented / renamed away without updating the test |
| `backend/tests/collector-admin-final-review.smoke.test.mjs` | 1 | `Error: smoke safety check failed: DB_NAME is required` (from `scripts/smokeSafety.mjs`). | Needs env — `DB_NAME` (a test/smoke database name) must be set to run this one |
| `collector/tests/article-process-surface.test.mjs` | 1 | Regex assertion against `ensureComposerMediaEditAccess` source text that no longer matches. | Outdated harness |
| `collector/tests/revision-asset-replacement-ui.test.mjs` | 1 | `AssertionError` (deep-equal) on route/HEAD-count wiring. | Outdated harness (not traced further) |
| `collector/tests/release-queue-surface.test.mjs` | 1 | `AssertionError: missing app snippet: function isReleaseQueueCandidate(item)` — that function name no longer appears in the app source. | Outdated harness — function renamed or removed |
| `collector/tests/requested-check-return-form.behavior.test.mjs` | 1 | Regex assertion against `data-requested-check-field="condition_note"` markup that no longer matches. | Outdated harness |
| `backend/tests/review-ingest-inline-body-rewrite.test.mjs` | 1 | `AssertionError` (strict-equal) on confirmed-taxonomy Curation signal shaping. | Outdated harness (not traced further) |

Four rows are marked "not traced further" — the failure was confirmed real and isolated to that
file (not a full-suite artifact), but reading the exact diff between expected/actual wasn't done
line-by-line. Treat those as "known pre-existing, real, needs its own look" rather than assuming
the category guess is exactly right.
