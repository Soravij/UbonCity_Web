# External audit — Raw Intake / Clean Prep criterion fix

Branch `codex/raw-clean-split-criterion-fix` @ `33ee670` vs `main` @ `c67dcd4`. Read-only audit,
performed entirely in `D:\UbonCity_Web` on the dev machine. No `D:\UbonRuntime`/`C:\UbonRuntime` path
was touched. No file was committed, pushed, or merged. The gate was measured by switching checkout in
place in this same working directory (no worktree), per instruction. One sub-agent (`audit-deep-reasoner`)
ran in parallel, in the same shared working tree, for sections C and D; its findings are cross-checked
against my own independent evidence below and the coincidence with my own revert testing is called out
explicitly where it matters (§D).

Every number in the implementer's own report (`audit/raw-clean-split-criterion-fix.md`) was
independently re-measured — none were taken on trust.

---

## A. GATE — re-measured myself, both trees, one run each

| Tree | commit | tests | pass | fail | skipped |
|---|---|---:|---:|---:|---:|
| `main` | `c67dcd4` | 823 | 763 | **59** | 1 |
| branch | `33ee670` | 823 | 763 | **59** | 1 |

Sorted failing-test-name lists (`node --test --test-reporter=tap` over the same file set
`scripts/testAll.mjs` uses) were extracted for both trees and diffed: **`diff` output is empty, exit 0**
— byte-identical 59-name failure sets, zero new failures, zero fixed failures introduced by `33ee670`.

**Verdict: main measures 59, not 60 — the implementer's "60" is a false claim on the count; the
substantive safety claim (zero regression) is independently confirmed true.**

Supporting detail on *why* it's 59, not 60:

- Every individual failing-test cluster the implementer's doc names by description — `collector admin
  final review smoke`, the assignment/article UI contract group, `/api/assets is filtered to
  collector-controlled local media`, the `requested-check` test, `index route wiring keeps HEAD route
  count and replacement helper on assignment upload only`, and all four `rerunProblemTranslations`
  cases — is present, verbatim, in my measured 59-name list. Their name-set diff methodology (comparing
  sorted lists, not just counts) was evidently real and correctly executed; only the reported total (60)
  is wrong.
- A prior, independent audit round for this same feature area (`audit/raw-intake-split-audit-round2.md`,
  §4) measured `main @ e59a1da` (an earlier ancestor of `c67dcd4`, before this feature merged) at
  **59** fail / 821 tests, and the feature branch at that time (`28141d9`) at **59** fail / 823 tests —
  the same 59, on `main`, well before this criterion-fix branch existed. `main` has not moved off 59
  since. This directly corroborates the user's premise that main has "always measured 59," including
  after `c67dcd4`.
- Most likely source of the implementer's "60": an uncommitted, unrelated local file present in this
  same working tree, `docs/TEST_SUITE_BASELINE.md` (modified but never committed — visible in `git
  status` at the start of this audit), documents a **"60 fail"** baseline prominently, for a *different*
  branch (`codex/harden-runtime-smoke-target-guard` @ `0c1824b`, dated 2026-07-31, unrelated to this
  criterion fix). It is plausible the implementer anchored on that adjacent "60" figure rather than
  reading their own `test:all` run's actual summary line. This is inference, not proof — but it is the
  only concrete "60" in the repo, and it sits in the same directory the gate was run from.

---

## B. CSS — styles.css

**Actual diff, `c67dcd4..33ee670`: `+33 / -0`, not `+59/-26` as the audit brief's premise states.**
This number also does not match anywhere in the repo — including the implementer's own report, which
correctly states `33 / 0` (`audit/raw-clean-split-criterion-fix.md` line 56). The `+59/-26` figure
appears to be a bad premise in the audit brief itself, not a claim made by the implementer. Flagging it
as a correction, not a finding against the branch.

**Classes added: zero.** Every new selector is an **ID** selector (`#clean-prep-table-wrap`,
`#table-clean-prep`) joined into existing comma-separated selector lists, or a new rule block scoped
under the new ID that reuses **existing** classes (`.intake-chip-row`, `.raw-actions-cell`,
`.raw-title-cell`, `.raw-title-column`, `.raw-main-text`). No `.new-class-name { }` definition appears
anywhere in the diff. This satisfies "must not create new classes."

- `.intake-chip-row` (used by `#table-clean-prep` and elsewhere, e.g. article/place chip rows) keeps its
  global default (`display:flex; flex-wrap:wrap; gap:6px` + separate `margin-top:10px` rule,
  `styles.css:2460-2478`) untouched — the new `#table-clean-prep .intake-chip-row` rule only *overrides*
  `flex-wrap`/`margin-top`/`white-space` inside that one ID's scope; it does not edit the shared rule, so
  other pages using `.intake-chip-row` (e.g. the raw/review tables, article chip rows) are unaffected.
  Confirmed by reading every `.intake-chip-row` occurrence in the file (2 hits, both pre-existing).
- `.raw-actions-cell`, `.raw-title-cell`, `.raw-main-text` are likewise only extended with new
  `#table-clean-prep`-prefixed compound selectors; their bare class rules are untouched.
- **Light/dark:** none of the new rules set any color property (only `padding`, `font-size`,
  `line-height`, `border-radius`, `margin-right`, `white-space`, `display`, `flex-wrap`,
  `max-height`/`overflow-y`, `position`). Color/theme is inherited from the generic, already-dark-themed
  `button`/table rules (e.g. `:root[data-theme="dark"] button` at `styles.css:5688`), which apply
  regardless of which table ID contains the button. No new dark-mode gap was introduced because no new
  color was introduced.

**Verdict: PASS.** No new classes. Existing class rules for `.intake-chip-row` etc. are extended only
inside the new ID's scope, verified not to affect other pages. Light/dark both inherit correctly (no new
colors added at all).

---

## C. `cleaned_at`

**Verdict: PASS**, confirmed independently (my own reading + sub-agent's separate trace, both agree):

- **Only `mark_cleaned` sets it.** Repo-wide grep for `cleaned_at:\s*true` finds exactly one hit:
  `collector/server/index.mjs:8977`, inside the `workflow_action === "mark_cleaned"` branch.
- **`runCleanStage` does not write it — proven two ways:**
  1. *Static*: `collector/services/workflow.mjs:1816-1824` — its `upsertWorkflowModel` patch object has
     no `cleaned_at` key at all (not `true`, not `null` — absent). `buildWorkflowHeadPayload`
     (`repository.mjs:4854-4858`) treats `undefined` the same as `payload.cleaned_at == null`, which
     preserves the previous value (`null` for a never-cleaned item).
  2. *Behavioral, with a real sqlite DB, not a stub*:
     `collector/tests/raw-intake-clean-prep.behavior.test.mjs:194-230` creates a fresh item, runs the
     real `runCleanStage`, and asserts `production_state === "analyzed"` (proving the auto-clean stage
     did run) **and** `cleaned_at === null` (proving it left the marker untouched). I additionally
     **reverted `repository.mjs` alone** to its pre-fix (`c67dcd4`) version and re-ran this exact test:
     it failed for real (`actual: null, expected: true` on the user-marker assertion) — restored the
     file, hash matched exactly (`d0e7005...`), test passed 2/2 again. This proves the repository-layer
     logic is load-bearing, not vestigial.
- **schema.sql**: `cleaned_at TEXT` is present on `content_workflow_models` (`schema.sql:972`), and the
  doc's `ALTER TABLE content_workflow_models ADD COLUMN cleaned_at TEXT;` matches the real table/column
  name exactly (no typo). I reverted `schema.sql` alone to `c67dcd4` and re-ran the test: it failed for
  real (`actual: undefined, expected: null`); restored, hash matched (`7172292...`), 2/2 passed again.
- **No migration script, no DDL executed in-repo.** Repo-wide search for `ALTER TABLE.*content_workflow_models`
  finds only the audit doc's own text and two unrelated migrations for other columns. `openDatabase`
  (`collector/db/client.mjs`) runs `schema.sql` via `CREATE TABLE IF NOT EXISTS` on every open — a no-op
  against an existing Runtime table, so it will **not** retroactively add the column there. The "run this
  once on Runtime, not run here" caveat in the implementer's doc is accurate.
- **`/api/items` and role `user`**: the route (`index.mjs:8182-8188`) allows `owner`/`admin`/`user`
  roles through; `cleaned_at` is attached unconditionally per item via `attachItemMatchFields`
  (`index.mjs:~1341`) and `attachWorkflowHeadFields` (`~1401`). `isAdminLikeUser`/`includeBulkPreview`
  only gates the separate `bulk_preview` object, not `cleaned_at`. Role `user` sees it. Confirmed by
  reading the route directly, not inferred.

---

## D. Split criterion — exhaustive, proven with real data across all 3 buckets

**Verdict: PASS.**

- The Raw Intake dashboard operates on exactly 3 buckets out of `resolveQueueBucket`'s 6 possible
  return values: `raw_prep`, `field_pack_review`, `unknown_workflow` (filtered by
  `getPreparationQueueItems`, `app.js:5105-5111`; the other 3 — `published`, `assignment`, `handoff` —
  never reach this splitter at all, which matches the requirement's own reference to "3 buckets").
- `splitRawIntakeAndCleanPrep` has exactly one caller in the whole file
  (`renderRawTable` → `splitRawIntakeAndCleanPrep(workflowSplit.intake)`, `app.js:5694`) — it only ever
  receives the `raw_prep` bucket, never `field_pack_review` or `unknown_workflow`.
- **Real-data proof, not code reading**: `collector/tests/raw-intake-clean-prep.behavior.test.mjs:151-181`
  constructs 5 items spanning all 3 in-scope buckets (3×`raw_prep` covering unclaimed / claimed-not-cleaned
  / claimed-and-cleaned, 1×`field_pack_review`, 1×`unknown_workflow`), runs the real (extracted, not
  reimplemented) `splitRawQueueByFieldPack` + `splitRawIntakeAndCleanPrep` + `renderRawTable`, and asserts:
  every id lands in exactly one of the 4 rendered tables (`Set` size check), none are dropped
  (`[1,2,3,4,5]` sorted match), and the two `raw_prep` items with `cleaned_at` set/unset land correctly
  (Clean Prep `[3]` / Raw Intake `[1,2]`).
- **No stub.** `splitRawIntakeAndCleanPrep` (`app.js:5115-5128`) is an unconditional loop —
  `if (claimed && cleanedAt) cleanPrep.push(item); else rawIntake.push(item);` — no `try/catch`, no
  feature flag, no early return that could produce an empty result.
- **One flaky anomaly, explained, not a code defect.** The parallel sub-agent doing this same check
  reported 1 failing run out of 31 (`actual [1,2,3]` vs `expected [1,2]` — item 3 leaking into Raw
  Intake). That exact failure signature is what pre-fix `app.js` produces (confirmed directly: it's the
  same output I got in §H when I deliberately reverted `app.js` to `c67dcd4` for the hash-verification
  test). Since the sub-agent ran concurrently with me in the **same shared working tree** (per the
  no-worktree instruction, no isolation was used), and my own revert of `app.js` to the pre-fix version
  happened around the same time as the agent's test runs, the far more likely explanation is a
  transient read of `app.js` mid-revert on my end, not a real intermittent bug — 30/31 runs plus two
  independent manual reproductions of the harness all show correct, deterministic behavior against the
  actual on-disk `app.js`. Flagging for completeness; not scored as a defect.

---

## E. `has_active_approved_context` / `hasActiveApprovedContext` — fully removed

**Verdict: PASS.** Repo-wide grep (`*.js`, `*.mjs`, `*.jsx`, `*.ts`, `*.tsx`) for both identifiers:
**zero matches.** The only remaining references anywhere in the repo are prose in audit markdown files
describing the removal (`audit/raw-clean-split-criterion-fix.md`, and historical docs
`raw-intake-split-audit.md`/`-implementation.md` describing the *old*, now-removed design). No dangling
caller, no dead export, no leftover SQL statement (`repository.mjs`'s `hasActiveApprovedContextStmt` and
the exported `hasActiveApprovedContext()` function are both deleted in the diff, confirmed by direct
`git diff` read).

---

## F. Raw Intake status column — fully removed, Clean Prep keeps it

**Verdict: PASS.**

- `showStatus = queueType !== "intake"` (`app.js:5224`) gates **both** the header `<th>สถานะ</th>` and
  the body `<td>` for the status badge — confirmed both are wrapped in the same `showStatus ? ... : ""`
  ternary (`app.js:5232`, `5288`), so header/body column counts stay in sync by construction, not by
  coincidence.
- The empty-state `colspan` is recomputed as a sum of conditional flags
  (`6 + (canManage && intake ? 1 : 0) + (showInterestingness ? 1 : 0) + (showStatus ? 1 : 0)`,
  `app.js:5241-5244`) rather than the old branching arithmetic — this is exactly the "matching
  header/body column counts" requirement, verified by the shipped test's own assertion
  (`(rawRow.head.match(/<th/g)||[]).length === (rawRow.row.match(/<td/g)||[]).length`,
  `raw-intake-clean-prep.behavior.test.mjs:186`) and independently reasoned through the source.
- **Clean Prep still shows status**: `queueType: "clean_prep"` → `showStatus = true`; its label is
  hardcoded `"กำลังทำ Clean"` and badge class `"workflow-badge-cleaned"`
  (`buildRawQueueStatusLabel`/`buildRawQueueStatusBadgeClass`, `app.js:5189-5203`) — exactly the required
  label text, confirmed present in source, not just in a test double.

---

## G. Shared helpers — confirmed untouched

**Verdict: PASS.** `git diff c67dcd4..33ee670` for `resolveQueueBucket`, `isRawPreparationItem`,
`normalizeDashboardWorkflowStage`, `workflowBadge`: **zero hits** — these names do not appear anywhere
in the diff at all (not even as context lines near a change), across `app.js`, `index.mjs`, or
`repository.mjs`. All four functions still exist, confirmed present at
`app.js:737` / `:777` / `:5058` / `:4929` respectively.

---

## H. Tests — revert/restore/hash verification, done by hand, and behavioral-vs-regex classification

Performed personally (not delegated), one production file at a time, sequentially, to avoid working-tree
contention: recorded the branch-tip blob hash, `git checkout c67dcd4 -- <file>`, ran
`node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs`, recorded the result, then
`git checkout 33ee670 -- <file>`, re-hashed (exact match every time), and re-ran to confirm 2/2 pass
again. Final `git status`/`git diff` on all 5 production files: clean, zero residual changes.

| File reverted alone | Test result | Matches implementer's claim? |
|---|---|---|
| `collector/server/public/app.js` | **1/2 fail** — `actual:[1,2,3]` vs `expected:[1,2]` | Yes |
| `collector/db/repository.mjs` | **1/2 fail** — `actual:null` vs `expected:true` | Yes |
| `collector/database/schema.sql` | **1/2 fail** — `actual:undefined` vs `expected:null` | Yes |
| `collector/server/index.mjs` (mark_cleaned route) | **2/2 pass — no failure at all** | **No — false claim** |

The implementer's doc (line 30) claims: *"Reverting the production splitter, renderer,
repository/schema marker, or Clean route marker makes the relevant behavioral assertion fail."* Three of
four are true and verified. The fourth is false: the shipped test never calls the `/api/items/:id` PUT
route or the `mark_cleaned` action at all — its second test calls
`repo.upsertWorkflowModel(id, { cleaned_at: true }, ...)` **directly**, bypassing `index.mjs` entirely.
Reverting the route's `cleaned_at: true` line has zero effect on the test suite. This is a genuine test
**coverage gap**, not a functional defect — I confirmed by direct code reading that `index.mjs:8977`
does correctly set `cleaned_at: true` in the real `mark_cleaned` branch; it's simply untested at the
HTTP-route layer.

**Behavioral vs regex, classified per assertion:**

- Structural (`assert.deepEqual`/`assert.equal` on real function return values, DB rows, or computed
  counts) — the strongest category: bucket-split id arrays, `Set` de-dup/completeness checks, the
  header/body `<th>`/`<td>` count comparison, both `cleaned_at` DB-state assertions. These exercise real
  extracted source (`extractFunction()` + `new Function()`, same brace-balancing technique validated in
  the prior round-2 audit) or a real sqlite DB via `openDatabase`/`createRepository` — not
  reimplementations.
- Regex-on-real-output (`assert.match`/`assert.doesNotMatch` against rendered HTML strings) — used for
  `/น่าสนใจ/`, `/สถานะ/`, `/#91/`, `/#55/`. These are still exercising the real
  `renderRawQueueTable` function's actual HTML output (not a hardcoded string), so they are behavioral in
  the sense that matters (a code change that alters real rendering breaks them) — but the assertion
  technique itself is substring/regex matching rather than structural equality, which is a weaker
  guarantee (e.g. it wouldn't catch an extra spurious `สถานะ` appearing elsewhere in the row). Noting
  this as a legitimate but secondary distinction, not a defect.
- No hardcoded-string-only / non-executing assertions found — every assertion in the file runs against
  live extracted code or a live DB.

**Six required cases** — confirmed all six are present in the first `test()` block
(`raw-intake-clean-prep.behavior.test.mjs:149-192`): (1) unclaimed Raw Intake row (id 1), (2)
claimed-but-not-cleaned Raw Intake row (id 2), (3) claimed-and-cleaned Clean Prep row (id 3), (4) score
rendering (`#91` present for Raw Intake, `#55` absent for Clean Prep), (5) no duplicate/drop across all
four rendered tables (the `Set`-size and sorted-ids assertions), (6) no Raw status column + matching
header/body counts. The seventh item ("`runCleanStage` leaves `cleaned_at` unset") is a separate,
second `test()` block — verified in §C.

**Verdict: CONDITIONAL PASS.** The revert-gate technique is real and 3/4 reproduced exactly as claimed
with hash-verified restoration. The 4th claim (Clean route marker) is a false claim — no test coverage
exists for the HTTP route path, only for the repository call it wraps. Not a functional defect (the
route code itself is correct), but the claim as written is inaccurate and should be corrected or the
route should get direct coverage.

---

## I. False claims vs. code defects — summary

| # | Claim | Source | Status |
|---|---|---|---|
| 1 | "60 failure names" on both trees (gate) | implementer's doc, line 35 | **False claim** — actual is 59/59, identical name sets. Substantive conclusion (zero regression) is true; only the digit is wrong. |
| 2 | "Reverting ... the Clean route marker makes the relevant behavioral assertion fail" | implementer's doc, line 30 | **False claim** — reverting `index.mjs` causes 2/2 pass, zero failures. Test coverage gap, not a code defect (route logic itself verified correct by direct reading). |
| 3 | `styles.css` diff is `+59/-26` | **audit brief's own premise**, not the implementer's | **Inaccurate premise** — actual is `+33/-0`, matching the implementer's own (correct) report. Not attributable to the branch/implementer. |
| 4 | Everything else in the implementer's doc (scope/decision, table/UI changes, schema/DDL caveat, exact diff numstat table) | implementer's doc | Independently verified accurate — see §B–§G. |

No code defects were found in this branch. Both false claims found are reporting/measurement errors, not
logic bugs — every underlying functional claim (zero test regression, `cleaned_at` write-path isolation,
exhaustive bucket split, helper functions untouched, `has_active_approved_context` fully removed, status
column correctly scoped, no new CSS classes) held up under independent, hands-on re-verification.

---

## Overall verdict: **Ready to merge**, conditional on fixing the doc, not the code

- **A. Gate**: CONDITIONAL PASS — zero regression confirmed independently; the "60" count is wrong and
  should be corrected to 59 in the doc.
- **B. CSS**: PASS.
- **C. cleaned_at**: PASS.
- **D. Split criterion**: PASS.
- **E. approved-context removal**: PASS.
- **F. Status column**: PASS.
- **G. Shared helpers**: PASS.
- **H. Tests**: CONDITIONAL PASS — revert-gate technique genuinely reproduces 3 of 4 claimed breakages
  with hash-verified restoration; the 4th (Clean route marker) is untested and its claim is false.
- **I.** Two false claims found, both cosmetic/reporting errors, zero functional code defects.

No blocking defect exists in the code itself. Recommend, before or shortly after merge: (1) correct the
"60" to "59" in `audit/raw-clean-split-criterion-fix.md` line 35, (2) either add a direct
`/api/items/:id` + `mark_cleaned` HTTP-level test or soften the "Clean route marker" revert claim to
match what's actually covered, (3) re-run `npm run test:all` once more from a clean, single-writer
working tree before merge, since this audit's own gate run shared the working directory with a parallel
sub-agent and with my own manual file reverts — no corruption was found in my own two full gate runs, but
it's cheap insurance given §D's flaky-run finding.
