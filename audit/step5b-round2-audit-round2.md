# Step 5B round 2 — external audit, round 2 (verification pass)

Scope: fix commit `4f9ffc2` (5 files, +52/-20) applied on top of `ecdec01`, addressing the
regression found in `audit/step5b-round2-audit-findings.md` §C and the report-accuracy findings in
§G/§A/§D. Per instructions, **B / E / F are not re-audited** (unchanged since round 1). This is a
verification-mode pass: check whether each prior finding is actually resolved, plus side effects of
the new diff.

Method note (per instructions): gate measurement used in-place checkout switching on the primary
worktree (`D:\uboncity_web`), never `git worktree add`, because round 1 established that 8
pre-existing test files hardcode the absolute path `D:\UbonCity_Web` and silently defeat worktree
isolation. `D:\UbonRuntime\...` / `C:\UbonRuntime\...` were not accessed at all (read or write) at
any point in this audit. Nothing was committed, pushed, or merged. Every temporary revert made
during this audit (in scratch worktrees or the primary worktree) was restored and verified byte-clean
before moving on.

**Overall verdict: mergeable.** All items resolved. One new, low-severity, out-of-scope nit was
found (not a blocker, not part of this diff) — see the note under item 4.

---

## 1. Regression closed (prior §C) — **PASS**

`collector/server/index.mjs` diff (+11/-6):
```diff
     rows = db.prepare(`
-    SELECT id, item_uid, type, category, title, slug, claimed_by_user_id, is_deleted, created_at, updated_at
-    FROM content_items
-    WHERE is_deleted=1
+    SELECT i.id, i.item_uid, i.type, i.category, i.title, i.slug,
+           i.claimed_by_user_id, i.is_deleted, i.created_at, i.updated_at,
+           wm.production_state, wm.publication_state
+    FROM content_items i
+    LEFT JOIN content_workflow_models wm ON wm.content_item_id=i.id
+    WHERE i.is_deleted=1
```
plus `production_state: row.production_state || null` / `publication_state: row.publication_state
|| null` added to `buildDeletedItemCleanupReport()`'s return object.

- Join key verified against `collector/database/schema.sql`: `content_workflow_models.content_item_id
  INTEGER NOT NULL UNIQUE` (FK to `content_items.id`), and `production_state`/`publication_state`
  are real columns there. Join is correct.
- **Live check, not just static reading**: seeded a real temp sqlite DB via the same
  `openDatabase`/`createRepository` pattern `raw-delete.test.mjs` uses, created an item (workflow
  model auto-defaults to `collected`/`draft`), soft-deleted it, ran the exact post-fix query.
  Result: `{"id":1,"production_state":"collected","publication_state":"draft"}` — non-null flat
  fields confirmed on a real row, not just plausible-looking SQL.
- `app.js:3142-3143` now reads `row?.production_state` / `row?.publication_state` — matches the API
  shape exactly. Full-file grep of `app.js` for `workflow_model` → one hit, line 152, the unrelated
  literal string `"content_workflow_models"` inside `REFERENCE_CLEANUP_CANDIDATE_KEYS` — not a
  property read. **No `row?.workflow_model?...` remains anywhere in the file.**
- CSS: `git diff 4f9ffc2^..4f9ffc2 -- '*.css'` is empty. The rendered cell is a plain `<td>`
  (`app.js:3149`) with no new class. `#table-data-cleanup` is covered by the pre-existing generic
  `table`/`th`/`td` rules (light theme, `styles.css:2139-2156`) and an existing dark-theme rule that
  already explicitly targets this table (`:root[data-theme="dark"] #panel-users
  #table-data-cleanup th/td`, `styles.css:9726-9742`). Both apply unchanged to the new cell content
  since it introduces no new selector surface. **Confirmed for both light and dark.**
- Doc cross-check: `audit/step5b-round2-implementation.md`'s new claim ("Deleted-item cleanup
  responses now include flat canonical `production_state` and `publication_state`... without new
  CSS classes, using the existing light/dark table theme rules") matches all of the above exactly.
  **No false claim.**

---

## 2. New test is real coverage — **CONDITIONAL** (real regression coverage, but source-text-only, not behavioral)

`deleted-item-cleanup-status-surface.test.mjs` is new (confirmed: `git show 4f9ffc2^:collector/tests/
deleted-item-cleanup-status-surface.test.mjs` → file not found at the parent commit). It reads
`index.mjs` and `app.js` as raw text (`fs.readFileSync`) and asserts specific substrings/regexes are
present via `assert.match`/`assert.doesNotMatch` — it never opens a database or calls the endpoint.

**Revert-test, full**: reverted `index.mjs` + `app.js` to `4f9ffc2^` (keeping the new test),
`git status --short` showed exactly the two files modified, ran the test:
```
✖ deleted-item cleanup API supplies flat canonical state consumed by the cleanup panel
  assert.match(serverSource, /LEFT JOIN content_workflow_models wm ON wm\.content_item_id=i\.id/)
```
Fails as required, on the first assertion (the pre-fix query has no such JOIN). Restored;
`git status --short` empty, and file hashes (`git hash-object`) matched the pre-revert values
exactly, confirming a byte-perfect restore — not just "git says clean." Re-ran the test afterward:
1 pass.

**Half-revert probes** (to test whether this is genuine coverage or a vacuous whole-file check):
- `app.js`-only reverted (index.mjs stays fixed): **fails**, on
  `assert.match(appSource, /const productionState = String\(row\?\.production_state.../)`.
- `index.mjs`-only reverted (app.js stays fixed): **fails**, on the same JOIN regex as the full
  revert.

Both halves independently caught, and both revert cycles were restored and hash-verified clean
afterward. `git rev-parse HEAD` confirmed back at `4f9ffc2` when done.

**Judgment: this is real regression coverage for the specific bug that was fixed** — it would catch
someone re-pasting either half of the pre-fix code back in. It is **not a behavioral/contract test**:
it never executes the SQL or the render function, so it has real blind spots a live/behavioral test
wouldn't — e.g. a join-key type mismatch that makes the JOIN always match zero rows in practice would
still pass this test (the literal SQL text would still be present), and a behaviorally-identical but
differently-worded rewrite (different whitespace, `??` instead of `||`, `SELECT wm.*` instead of the
exact column list) would fail this test despite being correct. Given item 1 above already confirmed
the actual behavior works via a real DB call, this gap doesn't block merge, but it should not be
mistaken for proof that the join stays correct if either file is refactored later — flag as a
follow-up (a lightweight behavioral test calling `listDeletedItemCleanupReports` against a seeded
fixture DB, as already done ad hoc for this audit, would close that gap cheaply).

---

## 3. Side effects of the response-shape change — **PASS**

Repo-wide grep for consumers of `/api/admin/deleted-items` (covering `collector/server/public`,
`admin/src`, `frontend`, `backend`, `scripts`, `ops` — confirmed which of these directories actually
exist and searched all of them): only found in `collector/server/index.mjs` (route def),
`collector/server/public/app.js` (fetch call), and collector smoke scripts / one collector test
(`smoke-data-cleanup*.mjs`, `smoke-reference-cleanup.mjs`, `smoke-data-cleanup-ui-browser.mjs`,
`reference-cleanup-ui-race.test.mjs`). None do a strict shape/key-count check that the two added
fields would break — the change is additive-only, confirmed backward compatible.

Separately grepped for other `.workflow_model` reads elsewhere in the repo to rule out a different
consumer depending on the old (broken) shape: found nested `workflow_model` reads only in files
tied to *different* endpoints (article-process/eligibility: `smoke-article-revision-loop-browser.mjs`,
`smoke-article-workspace-browser.mjs`, `article-submit-page.js`, `event-submit-page.js`) —
unaffected, correctly out of scope.

`git diff 4f9ffc2^..4f9ffc2 -- collector/server/index.mjs` shows exactly 2 hunks, both confirmed (by
reading the surrounding function bodies, lines ~1855-1905) to sit entirely inside
`buildDeletedItemCleanupReport()`/`listDeletedItemCleanupReports()` — **no leakage into any other
route handler in the same file.**

---

## 4. smoke-article-workspace-browser.mjs — **PASS** (one pre-existing, out-of-scope nit noted)

`grep -n "expectedStatus"` across the whole file → exactly one hit, line 244, inside an unrelated
function `waitForArticleProcessStatus(token, itemId, expectedStatus, ...)` where `expectedStatus` is
that function's own legitimately-named parameter — not a stale leftover reference.
`waitForItemProductionState` (lines 226-242) now uses `expectedState` consistently at its one
previously-broken line (227). **No remaining stale reference anywhere in the file.**

Note (confirmed pre-existing via `git show 4f9ffc2^:...` — present before this fix too, not
introduced by it, and outside this round's scope per your instructions not to re-audit F): lines 236
and 241 in that same function compare/report against the raw `expectedState` parameter rather than
the normalized `expected` (trimmed+lowercased) variable computed on line 227. Currently harmless
(the sole call site at line 773 already passes a normalized string), so it doesn't manifest today —
flagging only so it isn't mistaken for something this commit introduced. Not a blocker.

---

## 5. GATE — **PASS**, exact match

Per instructions: in-place checkout switching only, one run each, no repeated/comparison runs.

```
$ git checkout main && node scripts/testAll.mjs
ℹ tests 814 / pass 754 / fail 59 / skipped 1

$ git checkout codex/step5b-round2-drop-workflow-status && node scripts/testAll.mjs   # HEAD = 4f9ffc2
ℹ tests 816 / pass 756 / fail 59 / skipped 1
```

Sorted unique failing-name sets (`grep "^✖ " | sed 's/ ([0-9.]*ms)$//' | grep -v "^✖ failing
tests:$" | sort -u`), diffed:
```
$ comm -13 main-names.txt branch-names.txt   # new in branch
(empty)
$ comm -23 main-names.txt branch-names.txt   # missing (main-only)
(empty)
$ comm -12 main-names.txt branch-names.txt | wc -l
59
```
**main 59 / branch 59 / new 0 / missing 0 — exact match, no differing names.** Primary worktree
confirmed restored to the branch afterward: `git status --short` clean (aside from this report file,
untracked), `git rev-parse HEAD` = `4f9ffc208920a3164a3df096cb98e29add700596`.

---

## 6. Report vs. real tree — **PASS**, all 4 requested corrections verified, no new false claims

| Correction requested | Verified |
|---|---|
| Gate numbers 59/59/0/0 | Doc now states 59/59/0/0 — **matches this audit's independent re-measurement exactly** (item 5 above). |
| Hardcoded-path root cause disclosed | Doc's "Known issue" section lists 8 files: `article-process-field-return-evidence.behavior.test.mjs`, `assignment-accept-confirmed-metadata.repository.test.mjs`, `assignment-ui-scope.test.mjs`, `endpoint-schema-mapping-surface.test.mjs`, `field-pack.repository.test.mjs`, `schema-foundation.repository.test.mjs`, `translation-recheck.repository.test.mjs`, `workflow-readers-loud.test.mjs` — **identical, file-for-file, to round 1's independently-derived list.** |
| Actual `ecdec01` diff `+233/-247` | `git diff main...ecdec01 --shortstat` → **`29 files changed, 233 insertions(+), 247 deletions(-)`, exact match.** |
| Two other diff numbers (`raw-delete.test.mjs` +44/-3, `assignment-ui-scope.test.mjs` +6/-2) | `git diff main...4f9ffc2 --numstat` on both files → **`44 3 raw-delete.test.mjs`, `6 2 assignment-ui-scope.test.mjs` — both exact.** |
| §D reworded to "strict superset" with reasoning | Doc now reads: "The resulting eligible set is a strict superset of main... That broadening is accepted because the mirror is independently stale, while every content-safety blocker remains unchanged. The Runtime measurement taken on 2 August found zero place rows in `needs_revision` or `rejected`, so there was no live fuel for the known migration-bypass shape at that time. No new live-DB query was run for this correction." — **accurately restates round 1's finding rather than re-claiming equivalence, and explicitly discloses the live-DB check wasn't repeated rather than silently omitting it.** |

No new claim in the revised doc contradicts anything found in this round's diff. Per your note, the
decision not to re-run a live-DB query for §D is accepted as your call, not scored as a gap.

---

## Merge decision

**Ready to merge.** All items from round 1 (§C regression, report-number corrections, §D rewording)
are genuinely resolved, verified independently rather than taken on the report's word — including
one live database check (item 1) and two independent gate re-measurements (round 1 and this round,
both landing on identical 59/59/0/0). No new defects found in the `4f9ffc2` diff itself.

Two non-blocking follow-ups worth a ticket, neither in scope for this branch:
1. `deleted-item-cleanup-status-surface.test.mjs` is source-text-only (item 2) — a cheap follow-up
   would add one behavioral assertion (call `listDeletedItemCleanupReports` against a seeded fixture
   DB, as this audit did ad hoc) to close the "join key silently mismatches at runtime" blind spot.
2. `waitForArticleProcessStatus`/`waitForItemProductionState` in
   `smoke-article-workspace-browser.mjs` compare against the raw (non-normalized) parameter in two
   spots (item 4) — pre-existing, currently harmless, latent if a future caller passes an
   unnormalized state string.

## Evidence artifacts (not committed, left for inspection)

- Gate logs and sorted failure-name diffs for this round:
  `C:\Users\Sorav\AppData\Local\Temp\claude\D--uboncity-web\845d5b70-2202-4e16-92e0-e3939e7a77e5\scratchpad\step5b-round2-audit-round2-evidence\`
- Scratch worktrees, updated to `4f9ffc2` and left clean: `C:\t\step5b-round2-branch-test`,
  `C:\t\step5b-round2-def-revert` (confirmed byte-clean after all revert probes). `C:\t\step5b-round2-main-baseline`
  remains at `5a0de7b` (unused this round beyond reference reads). Safe to `git worktree remove` if
  no longer needed.
