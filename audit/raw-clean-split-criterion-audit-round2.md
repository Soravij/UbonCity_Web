# External audit round 2 (final, pre-merge) — Raw Intake / Clean Prep criterion fix

Branch `codex/raw-clean-split-criterion-fix` @ `a144e97` (full: `a144e9701b26d294f3ed258fc073513b799d9873`)
vs `main` @ `c67dcd4`. Read-only, dev machine only, in `D:\UbonCity_Web`. No `D:\UbonRuntime`/
`C:\UbonRuntime` path touched. No commit/push/merge performed. The gate was measured by switching
checkout in place in this same working directory (no worktree), per instruction. One sub-agent
(`audit-deep-reasoner`) ran in parallel for Part 2/3 — dispatched only *after* all my own git-checkout
work was finished, specifically to avoid the same-working-tree collision that produced one transient
flaky test failure in round 1's parallel run.

Per instruction, this round audits the **whole branch** (`c67dcd4..a144e97`), not just the closing
delta, given this feature's history of scope creep and regressions across earlier rounds. Every number
and claim from the implementer (`audit/raw-clean-split-criterion-fix.md`) was independently re-measured,
not taken on trust.

---

## Part 1 — delta review (`33ee670` → `a144e97`)

**1. New HTTP test for `PUT /api/items/:id` + `workflow_action=mark_cleaned` — calls the real route.**

Confirmed by reading `collector/tests/raw-intake-clean-prep.behavior.test.mjs:257-327`: the new test
`spawn()`s the actual `collector/server/index.mjs` as a child process (`child = spawn(process.execPath,
[...index.mjs], { cwd: collectorRoot, env: {...} })`), waits for `/api/health`, signs a real JWT with
role `user`, and issues a real `fetch(PUT /api/items/:id, { workflow_action: "mark_cleaned" })` against
that live server, then verifies both the HTTP response body and a direct SQLite read of
`content_workflow_models.cleaned_at`. This is a genuine HTTP-level test, not a repository-layer
shortcut — it did not exist in round 1's audited version.

**Revert-only-`index.mjs`, hash-verified, done by hand:**

```
$ git hash-object collector/server/index.mjs
f2c7e6cd6b541bf5be86cf102e888fc355a3a783        # matches Codex's claimed hash exactly

$ git checkout c67dcd4 -- collector/server/index.mjs
$ git hash-object collector/server/index.mjs
e7d9977661803caed3b16b34b5e025020eb4bff9        # pre-fix blob

$ node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs
✔ Raw Intake / Clean Prep splitter is exhaustive ...
✔ cleaned_at is set only by the user clean marker and not by runCleanStage
✖ mark_cleaned HTTP route persists cleaned_at
  AssertionError: mark_cleaned response exposes the persisted timestamp
  actual: undefined, expected: true
ℹ tests 3 / pass 2 / fail 1

$ git checkout a144e97 -- collector/server/index.mjs
$ git hash-object collector/server/index.mjs
f2c7e6cd6b541bf5be86cf102e888fc355a3a783        # exact match, restored

$ node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs
ℹ tests 3 / pass 3 / fail 0
```

**Codex's claim ("fail 1/3", hash `f2c7e6c`) is exactly correct — verified, not just re-asserted.**

**2. Report's "60" → "59" fix — confirmed genuine, with an accurate root-cause note.**

`audit/raw-clean-split-criterion-fix.md:35-37` now reads "59 failure names" (was "60") and adds: *"The
earlier `60` was a reporting error: it was anchored to the uncommitted `docs/TEST_SUITE_BASELINE.md` left
in this working tree by an unrelated branch, rather than the actual gate summary/name set."* This matches
round 1's independent finding almost exactly (round 1 traced the same uncommitted, unrelated
`docs/TEST_SUITE_BASELINE.md` — a different branch's 60-fail baseline — as the most likely anchor point).
The doc is explicit that it did not re-run `test:all` itself for this closing change and is citing round
1's external measurement — this is an honest disclosure, not a new unverified claim. My own fresh Part 4
measurement below independently re-confirms 59/59 a second time, on this exact commit.

**3. Delta touches only test + report files — confirmed.**

```
$ git diff 33ee670..a144e97 --numstat
7    5    audit/raw-clean-split-criterion-fix.md
97   0    collector/tests/raw-intake-clean-prep.behavior.test.mjs
```

Zero production files in the delta. **PASS.**

---

## Part 2 — whole-branch spec compliance (`c67dcd4..a144e97`)

| # | Spec | Verdict | Evidence |
|---|---|---|---|
| a | Clean Prep = claim AND `cleaned_at`; Raw Intake = rest | **PASS** | `app.js:5115-5128`: `if (claimed && cleanedAt) cleanPrep.push(item); else rawIntake.push(item);` — exact match, unconditional loop, no stub |
| b | Only `mark_cleaned` writes `cleaned_at`; `runCleanStage` never does | **PASS** | `workflow.mjs:1786-1836`: `runCleanStage`'s upsert patch has no `cleaned_at` key at all; `repository.mjs:4854-4858` treats `undefined` as "preserve previous" (stays `null`). Repo-wide grep for `cleaned_at:\s*true`: exactly one production hit, `index.mjs:8977` inside `mark_cleaned`. Verified twice independently — by reading and by hash-verified revert (Part 1 above, and round 1's revert of `repository.mjs`/`schema.sql`, both still valid since those files are byte-identical to round 1) |
| c | schema.sql has `cleaned_at`; `ALTER TABLE` matches; no migration/DDL run in-repo | **PASS** | `schema.sql:972`; doc's `ALTER TABLE content_workflow_models ADD COLUMN cleaned_at TEXT;` matches table/column exactly; no migration file adds it; `client.mjs:39-43`'s `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table |
| d | `/api/items` sends `cleaned_at`; role `user` sees it | **PASS** | `index.mjs:8182-8220` role gate allows `user`; `cleaned_at` attached unconditionally in `attachItemMatchFields`/`attachWorkflowHeadFields`, not behind the admin-only `includeBulkPreview` branch |
| e | `has_active_approved_context`/`hasActiveApprovedContext` fully removed | **PASS** | Repo-wide grep across all JS/TS extensions: zero code hits, only historical doc mentions |
| f | Raw Intake has no status column at all; header/body counts match; colspan adjusted | **PASS** | `app.js:5210-5300`: `showStatus = queueType !== "intake"` gates both header `<th>` and body `<td>`; colspan formula uses the same conditional; test asserts `<th>` count === `<td>` count and passes |
| g | Clean Prep still shows status + "กำลังทำ Clean" | **PASS** | `app.js:5189-5190`: `if (queueType === "clean_prep") return "กำลังทำ Clean";` |
| h | Clean Prep chips/buttons don't wrap | **PASS** | `styles.css:2149-2168`: `#table-clean-prep .intake-chip-row { flex-wrap:nowrap; white-space:nowrap; }`, `#table-clean-prep .raw-actions-cell` / `button { white-space:nowrap; }` |
| i | No new CSS classes (only ID selectors reusing existing classes) | **PASS** | Every added `styles.css` line either extends an existing comma-separated ID selector list or is a comment; no bare `.new-class { }` rule anywhere in the diff |
| j | Shared helpers untouched: `resolveQueueBucket`, `isRawPreparationItem`, `normalizeDashboardWorkflowStage`, `workflowBadge` | **PASS** | `git diff c67dcd4..a144e97 -- app.js \| grep` for all four names: zero hits — not even as context lines |
| k | No state-machine/transition-rule/other-route changes | **PASS** | Full `--stat` for the branch: 7 files, all explained by (a)-(j); `index.mjs`'s only route-level change is inside the pre-existing `mark_cleaned` branch of the pre-existing `PUT /api/items/:id` handler |

**All 11 spec items: PASS.**

---

## Part 3 — regression checks (highest weight — this branch's documented failure history)

**4. Duplicate/dropped items across tables + workflow-warning panel intact.**

`node --test collector/tests/raw-intake-clean-prep.behavior.test.mjs`: **3/3 pass** (confirmed
independently, twice — once by me during Part 1's restore step, once by the sub-agent). Traced with real
data: `getPreparationQueueItems` (`app.js:5105-5111`) pre-filters to exactly the 3 in-scope buckets
(`raw_prep`, `field_pack_review`, `unknown_workflow`); `splitRawQueueByFieldPack` routes them into
`{intake, review, unknown}`; `splitRawIntakeAndCleanPrep` further splits `intake` into
`{rawIntake, cleanPrep}`; `renderRawTable` calls `renderRawQueueTable` exactly 4 times, one per disjoint
bucket output — so every item lands in exactly one of the 4 rendered tables. The test's own fixture
(5 items spanning all 3 buckets) asserts this with `Set`-size and sorted-id-list checks, and passes.

**The workflow-warning table specifically checked and confirmed present**, given this branch's history of
accidentally deleting it in an earlier round: `<table id="table-raw-workflow-unknown">` and its render
call (`app.js:5751-5761`, `queueType: "unknown"`) are both present and untouched by
`c67dcd4..a144e97` — the diff's `app.js` hunks are scoped strictly to `splitRawIntakeAndCleanPrep` and
`renderRawQueueTable`'s status-column conditionals. No stub/placeholder/silent-empty-return exists in
`splitRawQueueByFieldPack`, `resolveQueueBucket`, or `getPreparationQueueItems`.

**5. Scope creep.** Every hunk in every changed production file was walked and matched to a specific
spec letter: `repository.mjs` → (b)/(e) only; `index.mjs` → (a)/(b)/(d) only; `app.js` → (a)/(f)/(g)
only; `styles.css` → (h)/(i) only; `schema.sql` → (c) only. No unrelated function, route, or markup
element was touched anywhere in the branch. **No scope creep found.**

**6. Cross-page contamination.** Every CSS hunk either extends an existing selector's *selector list*
(adding `#table-clean-prep` as one more comma-separated target) or defines a brand-new, fully
ID-scoped rule — no existing selector's *property values* were changed anywhere in the branch. Classes
reused (`.intake-chip-row`, `.raw-actions-cell`, `.raw-title-column`, `.raw-title-cell`, `.raw-main-text`)
keep their original bare-class rules untouched, so other tables/pages using them (Raw Review, Field Pack
Review, article/place chip rows elsewhere) are unaffected in both light and dark themes — confirmed no
new color property was introduced anywhere, so dark-theme inheritance from the generic
`:root[data-theme="dark"] button`/table rules is unaffected. None of the four shared helpers in (j) were
touched at all, so there is no call-site impact to trace.

**All three regression patterns from this branch's history: not present at `a144e97`.**

---

## Part 4 — GATE (measured myself, this session, both trees, `a144e97`)

| Tree | commit | tests | pass | fail | skipped |
|---|---|---:|---:|---:|---:|
| `main` | `c67dcd4` | 823 | 763 | **59** | 1 |
| branch | `a144e97` | 824 | 764 | **59** | 1 |

(Branch total is +1 test/+1 pass vs main — the new HTTP route test; fail count unaffected.)

Sorted failing-test-name lists extracted from both TAP outputs and diffed:

```
$ diff main-fail-names.txt branch-fail-names.txt
$ echo $?
0
```

**Empty diff, exit 0 — byte-identical 59-name failure sets. New: 0. Missing: 0.** Exactly matches the
expected 59/59/new-0/missing-0. `docs/TEST_SUITE_BASELINE.md`'s stale, uncommitted "60" figure (for the
unrelated `codex/harden-runtime-smoke-target-guard` branch) was **not** used as a baseline — this number
comes from a fresh `node --test` run over the same file set `scripts/testAll.mjs` uses, executed twice
in this session, once per tree.

---

## Part 5 — false claims vs. `audit/raw-clean-split-criterion-fix.md`

**None found.** Every claim checked against the current code at `a144e97`:

- Scope/decision paragraph (criterion, `runCleanStage` non-write, schema detection) — accurate.
- `has_active_approved_context` removal claim — accurate, zero remaining references.
- Table/UI changes paragraph (`.intake-chip-row` defaults, theme-inheritance claim) — accurate, verified
  against the actual pre-existing rule (`flex-wrap:wrap` + separate `margin-top:10px`, `styles.css:2460-2478`).
- Verification paragraph's revert-gate claim ("Reverting the production splitter, renderer,
  repository/schema marker, or Clean route marker makes the relevant behavioral assertion fail") — **now
  true for all four**, including the "Clean route marker" clause that round 1 found false (no test
  existed for it then; it exists now and the revert genuinely fails it, per Part 1 above).
- Gate paragraph — accurate, including the honest "not re-run in this closing change" disclosure; my own
  independent re-measurement confirms the cited 59/59 number.
- Runtime DDL caveat — accurate, no migration/DDL runs in-repo.
- Exact-diff numstat table — every row independently re-measured via `git diff c67dcd4..a144e97
  --numstat` and matches exactly (audit doc 60/0, schema.sql 1/0, repository.mjs 17/14, index.mjs 3/1,
  app.js 11/9, styles.css 33/0, test file 125/13, total 250/37).

**Zero false claims remain in this report as of `a144e97`.** Both false claims round 1 found (the "60"
count, and the untested "Clean route marker" revert claim) are genuinely closed, not reworded around.

---

## Overall verdict: **Ready to merge**

| Part | Result |
|---|---|
| 1. Delta review (H fix) | PASS — HTTP route genuinely tested, revert/hash claim exact, report fix genuine, delta scoped to test+doc only |
| 2. Spec a-k | **11/11 PASS** |
| 3. Regression (highest weight) | PASS — no duplicate/dropped items, workflow-warning panel intact, no scope creep, no cross-page contamination |
| 4. Gate | PASS — 59/59, identical name sets, re-measured fresh this session |
| 5. False claims | Zero remaining |

No blocking defect, no false claim, no regression of any of this branch's three historical failure modes
found at `a144e97`. Round 1's two findings (miscounted gate number, untested HTTP revert claim) are both
genuinely fixed — not just reworded — and independently reproduced by hand with hash verification in this
round. **Nothing further needs to change before merge.**
