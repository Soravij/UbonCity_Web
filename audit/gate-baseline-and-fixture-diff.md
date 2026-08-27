# Audit — gate baseline & content-type-transition-rules fixture diff

- **Machine:** Runtime — `D:\UbonRuntime\repos\UbonCity_Web`
- **Branch under test:** `fix/writing-assigned-to-in-review` @ `7fe8d8a` vs `main` @ `a2be1b9`
- **Mode:** READ-ONLY. No code change, no merge, no collector restart.
- **Date:** 2026-08-27

## Verdict

**MERGEABLE** (gate-wise). The branch introduces **zero gate regressions**. The 4 failing
tests in `collector/tests/content-type-transition-rules.test.mjs` the task asked about are
**pre-existing failures on `main`**, proven by diff causality (see §3). The 2 regressions
from the previous audit round (`:149`, `:263`) are **gone** — confirmed by an actual branch
gate run (§4).

Remaining caveat: the literal `main` gate number was **not** measured on Runtime (see
"Method deviation" below), so the baseline count is derived, not observed.

## Method deviation (stop-rule / policy)

Task step 1 required `git checkout main` then `git checkout 7fe8d8a` inside
`D:\UbonRuntime\repos\UbonCity_Web`. `CLAUDE.md` lists `git checkout` in that directory as
**owner-managed — "agents must not run these; Sor runs them by hand."** So step 1a
(`checkout main → npm run gate`) was not executed. Instead:

- HEAD was already at `7fe8d8a`, so the **branch-side gate (1b) was run once** via the
  `test-runner` agent (§4).
- The **`main` side is answered by static diff analysis** (§3), which is conclusive for the
  regression-vs-pre-existing question. Only the exact baseline *number* is left underived.

To get the observed `main` number, either Sor runs `npm run gate` on a `main` checkout, or
approves a `git worktree` (endorsed by `docs/TEST_SUITE_BASELINE.md`, with its 4 setup
traps: `.env`, `node_modules` junctions, non-temp location, `--detach`).

## 1. Branch-side failing test names (observed)

`npm run gate` @ `7fe8d8a`, run once:

```
GATE tests=1044 pass=975 fail=68 skipped=1
```

Full sorted failing-name list captured — see `audit/gate-branch-7fe8d8a-fails.txt`.
68 failures. Of the 6 tracked tests in `content-type-transition-rules.test.mjs`:

| line | test | on branch |
| --- | --- | --- |
| :149 | place contains only its final positional ladder while non-place types retain the complete legacy graph | **PASS** |
| :170 | place backward metadata is the only exposed backward path and remains attached to valid graph edges | **FAIL** |
| :220 | every place backward transition records its policy reason and can replay forward to its original step | **FAIL** |
| :263 | each content type accepts exactly its expected transition graph | **PASS** |
| :319 | place return-to-clean walks every legal backward hop to analyzed without a shortcut | **FAIL** |
| :508 | atomic editorial assignment creation preserves legacy place state and rolls back when workflow write fails | **FAIL** |

## 2. main-side failing names — derived, not observed

The complete `main..7fe8d8a` code/test delta is only these 2 lines plus 2 inert additions:

```
 collector/db/repository.mjs                        | 1 line  (buildPlaceTransitionRules)
 collector/tests/content-type-transition-rules.test.mjs | 1 line  (PLACE_PRODUCTION_RULES fixture)
 audit/writing-assigned-in-review-audit.md          | new doc (inert)
 collector/tests/place-ladder-writing-assigned-in-review.test.mjs | new file, 4 tests, all PASS on branch
```

Both 1-line changes are identical in content: add `"in_review"` to the `writing_assigned`
forward-transition list.

```diff
-      writing_assigned: new Set(["writing", "ready_for_writer", "field_review"]),          # repository.mjs:525
+      writing_assigned: new Set(["writing", "ready_for_writer", "field_review", "in_review"]),

-  writing_assigned: ["writing", "ready_for_writer", "field_review"],                       # test fixture:61
+  writing_assigned: ["writing", "ready_for_writer", "field_review", "in_review"],
```

`git diff main..7fe8d8a -- collector/db/repository.mjs` shows **no change** to
`listLegalBackwardProductionTransitions`, `returnFieldPackToCleanAtomic`,
`createAssignmentWithWorkflow`, `PLACE_BACKWARD_PRODUCTION_TRANSITIONS`, or any backward
logic.

Therefore the branch fail-name **set is identical to `main`'s**. Derived `main` baseline:
**≈ 68 fail** (1040 tests / ~971 pass / 1 skipped — 4 fewer tests than the branch because
`place-ladder-writing-assigned-in-review.test.mjs` is branch-only and all 4 of its tests
pass).

## 3. The 4 focus tests — each side of the diff

All 4 are **FAIL on branch (§1) and, by causality, FAIL identically on `main` → PRE-EXISTING.**

Why the branch cannot be the cause:

- **:170** `content-type-transition-rules.test.mjs:170` — asserts the test-local
  `PLACE_BACKWARD_EDGES` fixture (`:73`, unchanged) against the
  `PLACE_BACKWARD_PRODUCTION_TRANSITIONS` export (unchanged), and exercises
  `repo.listLegalBackwardProductionTransitions` (unchanged). Adding a *forward* edge
  `writing_assigned → in_review` adds no backward edge. No causal path.
- **:220** `:220` — iterates `PLACE_BACKWARD_EDGES` (`:73`) + `FORWARD_REPLAY_PATHS`
  (`:86`), both unchanged; uses `repo.upsertWorkflowModel` / `listWorkflowTransitionsByItem`
  (unchanged). No `in_review` entry exists for `writing_assigned` in either fixture. No
  causal path.
- **:319** `:319` — local `paths` table (`:321`, unchanged), drives
  `repo.returnFieldPackToCleanAtomic` (unchanged), which walks **backward** edges. A new
  forward edge creates no backward shortcut. No causal path.
- **:508** `:508` — `repo.createAssignmentWithWorkflow` (unchanged) for `editorial`
  assignments on `collected` / `analyzed` / `content_in_progress` / `field_review`.
  Nothing touches `writing_assigned` or `in_review`. No causal path.

Only `:149` (via `assertAllTypeRulesMatchExpectedGraph` → `expectedPlaceRules()` →
`PLACE_PRODUCTION_RULES`) and `:263` (same `expectedPlaceRules()` path) read the changed
fixture line `:61`. The other 4 never call `expectedPlaceRules()`.

### Which commit made the 4 fail (they are on `main`)

`content-type-transition-rules.test.mjs` is **not** in the known-failures table of
`docs/TEST_SUITE_BASELINE.md` (last measured at 915 tests, ~2026-08-09), so the file was
green then. The place-ladder fixture/rule commits on `main` after that date are the
candidates:

| commit | date | subject |
| --- | --- | --- |
| `f98acce` | 2026-08-13 | fix(test): walk place ladder in fixtures for atomic transition guard |
| `54ddae0` | 2026-08-21 | test: update legacy rules to include ready_for_writer state |
| `da3305d` | 2026-08-25 | fix(test): update place fixture for writing_assigned->field_review backward edge |

Pinning the exact one requires a bisect run (not done — out of scope for a READ-ONLY diff
audit, and blocked by the checkout restriction). What matters for the merge decision is
settled: **not this branch.**

## 4. Prior-round regressions `:149` / `:263` — gone?

**YES — confirmed by the branch gate run (§1), both PASS.**

Mechanism: `af3d341` landed the `repository.mjs` rule change without the matching test
fixture, so `:149` and `:263` (which assert fixture == repo rules) failed — the 2
regressions flagged in `audit/writing-assigned-in-review-audit.md` / commit `ee077b1`.
`7fe8d8a` re-synced the fixture line `:61`. Both sides now agree → both tests pass.

Net branch effect on the gate: 0 regressions, 0 fixes to `main`'s list (it only repaired
regressions it introduced within the branch), + 4 new passing tests from the new file.

## 5. The "59" baseline is stale — do not use it

`docs/TEST_SUITE_BASELINE.md` records **59 fail** — but measured at **915 tests total**
(last touched `c3256e8`, 2026-08-09). The current suite is **1044 tests** (branch) /
~1040 (main): ~125–129 tests added since, many of them UI-harness tests that fail
pre-existing (the doc's own table already lists 33 in `assignment-ui-scope.test.mjs`
alone). The real current `main` baseline is **≈ 68 fail** (derived, §2) — the previous
audit's observed "69" on the branch and this run's "68" bracket it; the drift is suite
growth, not regression.

**Recommendation:** run `npm run gate` once on a fresh `main` checkout and rewrite the
Baseline section of `docs/TEST_SUITE_BASELINE.md` with the 1040-test numbers.
