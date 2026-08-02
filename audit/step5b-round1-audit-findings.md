# Step 5B round 1 — external audit findings

Branch: `codex/step5b-round1-canonical-readers`, uncommitted working-tree diff, base `main` @ `51796ec`
(confirmed `git rev-parse HEAD` == `git rev-parse main`). Reviewed: `audit/step5b-workflow-status-mirror.md`
(the prior survey) and `audit/step5b-round1-implementation.md` (Codex's report). Method: static read of
the actual diff (`git diff`), two independent subagents (audit-scanner for the mechanical sweep,
audit-deep-reasoner for state-graph reachability), plus direct verification I ran myself: a scoped
production-only revert (`git apply -R` on just `repository.mjs`/`index.mjs`, tests left patched) to
confirm each new/changed test actually fails against unpatched code, and a read-only query of
`collector/data/collector.db` via `node:sqlite`. No files were modified — the working tree was restored
to the exact round-1 diff state immediately after the revert test. No fix applied.

## Overall verdict: **CONDITIONAL**

The reader-side migration (claim-pool scope now reads canonical state via a real join, the two
disagreeing legacy→canonical mappers are correctly consolidated into one) is sound and well-tested. But
the hard-delete gate removal (item 1) is **not soundly justified by the evidence Codex presented** — the
"no such row exists today" dev-DB proof was run against a database that is schema-stale and structurally
*cannot* represent the risk case, and there is a real, already-shipped, non-test mechanism
(`migrate-place-review-flags.mjs`) by which the exact divergence the old gate existed to catch is
producible. This doesn't mean production data is being destroyed right now — that's unknowable from this
repo — but it means the removal shouldn't merge on the current justification. Item 5 also found one of
the four test changes doesn't test anything (a relabel, not new coverage), matching the audit brief's own
suspicion.

---

## 1. THE HARD-DELETE GATE — **FAIL** (on the justification; not proven to be actively exploited)

`collector/db/repository.mjs:5589` (pre-diff line, confirmed by both the diff and the scanner) removes:
```js
if (String(item.workflow_status || "").trim().toLowerCase() !== "raw") addBlocker("workflow_status_not_raw");
```
from `getRawOnlyHardDeleteEligibility()`, leaving only the canonical `production_state==='collected'` /
`publication_state==='draft'` blockers (repository.mjs:5594-5595 in the diffed file).

**Codex's proof is invalid, not just weak.** `audit/step5b-round1-implementation.md` ("Hard-delete gate
proof") ran its verification query against `collector/data/collector.db` and got `[]` — zero rows where
legacy and canonical disagree. The deep-reasoner subagent queried the same file read-only
(`PRAGMA table_info(content_workflow_models)`) and found **it doesn't have a `place_review_flag` column
at all** — it still has the legacy `assignment_state` column that step 5A removed. This DB predates both
the place-review-flag schema split (`548e18b`) and 5A. It cannot contain a row in the state this gate
change is actually risky for, so the "0 rows" result confirms nothing about that risk — the proof and the
question it was asked to answer are talking about two different schemas.

**A real, code-verified reachability path exists** (independently confirmed by the deep-reasoner after
correcting my own first-pass hypothesis, which had assumed a *live* transition — that part was wrong and
is called out below):

- `collector/scripts/migrate-place-review-flags.mjs` is a real, npm-wired migration
  (`collector/package.json:41`, `"migrate:place-review-flags": "node scripts/migrate-place-review-flags.mjs"`),
  already merged to `main` in commit `548e18b`, not part of this diff.
- Its `migrateUp()` (lines 132-159) finds `content_workflow_models` rows for `type='place'` with
  `production_state IN ('needs_revision','rejected')`, resolves the state the item transitioned *from*
  via transition history (`latestLegacyProductionSource`, lines 122-130), maps that source through
  `PLACE_REVISION_TARGETS` (lines 6-15) — which explicitly includes `collected: "collected"` — and writes
  the result via **raw SQL** (`db.prepare("UPDATE content_workflow_models SET production_state=?, place_review_flag=? WHERE content_item_id=?")`, lines 154-155), never calling `upsertWorkflowModel()`.
- `reconcileLegacyWorkflowStatusMirror()` — the only thing that keeps `content_items.workflow_status` in
  sync with canonical state — has exactly two callers, `createWorkflowHead` and `upsertWorkflowModel`
  (repository.mjs:6088, 6184, confirmed by grep). The migration script bypasses both. It has zero
  references to `workflow_status` anywhere in the file.
- `place_review_flag` has no blocker of its own in `getRawOnlyHardDeleteEligibility` (confirmed by full
  read of repository.mjs:5568-5660 — the blocker list and the downstream-table sweep never mention it),
  and `content_workflow_transitions` (which the migration also writes to) is explicitly in
  `RAW_ONLY_HARD_DELETE_ALLOWED_REFERENCE_KEYS` (repository.mjs:410-416), so transition history doesn't
  catch it either.

**Correction to my own first hypothesis, confirmed by the deep-reasoner:** a *live* place item cannot
reach `production_state IN ('needs_revision','rejected')` today — `TRANSITION_RULES.place`
(`buildPlaceTransitionRules()`, repository.mjs:506-532) has `needs_revision: new Set([])` and
`rejected: new Set([])` (no outgoing edges, and nothing transitions *into* them for place either); every
live write path that could (`applyArticleNeedsRevisionWorkflowTransition`, server/index.mjs:4561-4596;
the web-review-feedback endpoint, server/index.mjs:14700-14709) explicitly branches around place and
throws if called on one outside `in_review`/`ready_for_publish`/`submitted_for_admin_review`. The generic
graph line I originally cited (repository.mjs:482, `collected: new Set([...,"needs_revision",...])`) is
`buildContentTypeTransitionRules()`, used only by `event`/`other_transport`/`public_transport_map`, not
place — my initial framing of this as a same-day reachable transition was wrong.

**What's actually reachable, and why it still fails the audit's own test ("reachable through a real
transition... if yes this is FAIL"):** the state graph changed at `548e18b`; place items existed *before*
that split, and any that had already reached `needs_revision`/`rejected` under the old shared graph are
real historical data, not hypothetical. Running the real migration script against such a row produces
exactly the divergence described: `production_state='collected'`, `publication_state='draft'` (both
canonical blockers clear), `place_review_flag='revision_requested'` (unchecked), `workflow_status` stuck
at the stale pre-migration value (e.g. `'needs_revision'`) with nothing to resync it unless the item is
independently touched again by `upsertWorkflowModel` for an unrelated reason. Under `main`, the removed
blocker would have refused hard-delete on that row. Under round-1, nothing does.

**What I could not determine (correctly out of scope for static analysis, per the audit skill's
boundary):** whether `npm run migrate:place-review-flags` has actually been run against any real
(non-dev) database that contained such rows, and whether any currently sit in this exact state. That is
runtime/deploy history this repo doesn't contain. **Recommendation, not a fix:** before merging the gate
removal, either (a) add a `place_review_flag`-aware blocker (or a blocker on the derived legacy state,
computed from history rather than the stale mirror) as a real replacement, or (b) get the migration's
run history confirmed against whatever DB actually matters, and re-run Codex's proof query against a
schema-current copy of it — not the stale local dev DB.

---

## 2. THE 6 LOSSY COMBINATIONS — dev-DB proof method confirmed **not applicable**, no regression from round 1 itself

Direct read-only query I ran against `collector/data/collector.db` (`node:sqlite`, `GROUP BY
production_state, publication_state`) returns exactly 3 combinations across all 30 rows: `collected/draft`
(28), `analyzed/draft` (1), `submitted_for_admin_review/approved` (1). None of the survey's 6 lossy
combinations (`field_working`, `field_review`, `writing_assigned`, `writing`, non-published `completed`
production states; `archived`/`deleted` publication states) are present. Codex's "before/after scope
identical" proof (30 items, `audit/step5b-round1-implementation.md` §"Claim-pool migration and dev-DB
evidence") is therefore silent on exactly the cases the survey flagged as the only ones where legacy and
canonical classification could actually disagree — confirming the audit brief's suspicion plainly, as
instructed.

This is compounded by item 1's finding that the same DB is schema-stale (missing `place_review_flag`,
still has the pre-5A `assignment_state` column) — every empirical "identical" claim made against this
specific file should be treated as unvalidated for any state the current schema/migrations introduced
after this DB snapshot was taken, not narrowly just the 6 lossy states.

Mitigating factor, verified independently: the **claim-pool** fix itself (the main consumer of the
lossy legacy→canonical direction) no longer goes through either mapping function at all post-diff — it
reads `production_state`/`publication_state` directly via the new join (repository.mjs:4029-4044), so the
mapping functions' lossiness doesn't affect claim-pool's *correctness*, only the strength of Codex's
"identical" proof as *evidence* for that correctness. Constructed test coverage (an item actually sitting
in one of the 6 lossy states, with an assertion on both old-mirror-based and new-canonical-based
classification) is still missing and would be required to make the equivalence claim trustworthy rather
than merely unrefuted.

---

## 3. SINGLE DECIDER — **PASS**

`mapLegacyStatusToCanonicalStates` (formerly `index.mjs:6883-6910`) is fully deleted — confirmed by the
diff itself (the whole function body is removed) and by my own repo-wide grep
(`grep -rn "mapLegacyStatusToCanonicalStates" D:\uboncity_web`), which returns hits only in
`audit/step5b-round1-implementation.md`, `audit/step5b-workflow-status-mirror.md`, and
`collector/tests/workflow-readers-loud.test.mjs:99` — the last one is the new test's own
`assert.doesNotMatch(serverSource, /function mapLegacyStatusToCanonicalStates/)`, i.e. a negative
assertion confirming absence, not a definition. `mapWorkflowStatusToModelStates` (repository.mjs:659,
now exported) is the sole remaining legacy→canonical mapper; `index.mjs:6881` calls it directly (confirmed
in the diff: `const legacyMapped = mapWorkflowStatusToModelStates(...)`, replacing the old call). The
scanner subagent's independent sweep corroborates this and additionally confirms every write-side call
site (`resolveCreateWorkflowPatch`) now delegates to the same function.

---

## 4. WRITES UNTOUCHED — **PASS**

Confirmed directly from `git diff -- collector/db/repository.mjs collector/server/index.mjs` (I read the
full diff myself, corroborated by the scanner subagent) — none of the following write sites appear in the
diff at all, i.e. byte-identical to `main`: `toItemBaseParams()`, `insertItemStmt`/`updateItemStmt`,
`normalizeInput()`, `saveItem()`/`saveItemInternal()`, `setWorkflowStatus()`,
`withCanonicalWorkflowStatusSeed()`, `reconcileLegacyWorkflowStatusMirror()`, `buildWorkflowHeadDefaults()`,
and all four `delete payload.workflow_status`/`delete requestBody.workflow_status` sanitizer lines
(index.mjs, four call sites). The only lines the diff touches in these two files are: the
`mapWorkflowStatusToModelStates` mapping-function body (adds two aliases, adds `export`), the
`listStmt`/`getStmt` SQL (adds a `LEFT JOIN content_workflow_models`, a read-side change), the
`isClaimableRawPoolItem`/`buildItemWorkScopeState` fallback removal (reads), the deleted
`mapLegacyStatusToCanonicalStates`/`normalizeLegacyWorkflowStatus` functions (dead code removal, not a
writer), and the one hard-delete blocker line (item 1). The column is written on exactly the same paths,
with exactly the same logic, as on `main`.

---

## 5. TESTS ARE REAL EVIDENCE — **CONDITIONAL** (3 of 4 real, 1 is not evidence of anything)

I verified this directly, not just by reading the diff: saved a patch of only the two production files
(`git diff -- collector/db/repository.mjs collector/server/index.mjs`), reverse-applied it
(`git apply -R`) to put production code back to `main`'s behavior while leaving all four test files at
their round-1 (patched) content, ran the four files with `node --test --test-concurrency=1`, then
re-applied the patch to restore the round-1 diff exactly as it was.

| Test | Proves | Fails on reverted prod code? |
|---|---|---|
| `in-flight-items.test.mjs` — "getItem and listItems carry canonical workflow state for claim-pool scope" | `getItem()`/`listItems()` now return `production_state`/`publication_state` from the join | **Yes** — assertion fails, canonical fields are `undefined` on reverted code (confirmed in test run) |
| `raw-delete.test.mjs` — "raw hard-delete eligibility relies on canonical state when the legacy mirror is stale" | A stale non-`raw` mirror no longer blocks a canonically-clean item | **Yes** — fails on reverted code (the removed blocker still fires) |
| `workflow-readers-loud.test.mjs` — "one shared legacy-to-canonical mapping..." | Aliases work through the one shared mapper; the split mapper is gone | **Yes**, but for a blunt reason: reverted `repository.mjs` doesn't `export` `mapWorkflowStatusToModelStates` at all, so the whole file fails to load (`SyntaxError: ... does not provide an export named 'mapWorkflowStatusToModelStates'`) rather than failing a specific assertion. Still valid evidence — it does fail — just less surgical than the other two. |
| `assignment-ui-scope.test.mjs` (the flagged `+2-2`) | — | **No.** Both changed assertions still **pass** unmodified against reverted (main) production code. |

**The `assignment-ui-scope.test.mjs` change is exactly what the audit brief suspected: a relabel, not new
coverage.** Tracing why: `buildItemWorkScopeState` only ever fell back to `item.workflow_status` when
`item.publication_state` was falsy (index.mjs:4132, pre-diff). The two edited fixtures both supply
`publication_state`/`production_state` directly (e.g. line 681: `{ production_state: "collected",
publication_state: "draft", claimed_by_user_id: null }`), so on **both** old and new code the function
takes the "canonical fields present" branch and never touches the fallback line being removed — the
assertions were never exercising the code path this round changed, whether the fixture said
`workflow_status` or `production_state`/`publication_state`. Worse, the *value itself* doesn't
distinguish the branches either: `"raw_pool"` is the function's default fallthrough for any item that
isn't published/claimed/assigned, so even the **original** pre-diff fixture (`{workflow_status: "raw",
claimed_by_user_id: null}`) would still resolve to `"raw_pool"` with the fallback deleted (empty string
production/publication state, no claim, no assignment → falls through to the same default). The one
fixture shape that *would* have been a meaningful regression test — `workflow_status` alone set to
`"published"`/`"completed"` with `production_state`/`publication_state` both absent, checking that
`"published_or_completed"` is still returned once the fallback is gone — is not present anywhere in the
diff. The real regression protection for the risk this fallback existed for comes entirely from the
`in-flight-items.test.mjs` join test (which does fail on revert) — the `assignment-ui-scope.test.mjs`
change contributes no independent evidence either way.

---

## 6. SIDE EFFECTS — **CONFIRMED, minor, flag before merge**

- `audit/step5b-round1-baseline-test.pid` **does not exist** — the brief's assumption was slightly off.
  What exists instead: `audit/step5b-round1-baseline-test.log` (345 KB), `.stderr.log` (0 bytes),
  `audit/step5b-round1-workflow-status-sweep.log` (16 KB). All three match the root `.gitignore:15`
  `*.log` rule (`git check-ignore -v` confirms) — harmless, won't be committed.
- **`uploads/media-1785599471223-il38a3gd.gif`, `media-1785599828959-zqto351b.gif`,
  `media-1785599903470-wxnm715g.gif`** (repo-root `uploads/`, ~42 bytes each, GIF89a placeholder content,
  timestamps 22:51-22:58 clustered with the test-run activity) — I checked this myself directly and it
  contradicts the scanner subagent's claim that these are gitignored: `git check-ignore -v` on this path
  returns **exit 1 (not ignored)**, and `git status --short uploads/` shows `?? uploads/` — genuinely
  untracked, not covered by any `.gitignore` rule (only `backend/uploads/` and `collector/media/uploads/`
  are ignored, not the bare root `uploads/`). These are a real stray artifact, almost certainly a
  byproduct of the full `npm run test:all` baseline run (which includes browser/media-upload smoke
  tests) rather than of round-1's targeted change — out of round-1's stated scope either way. Not
  destructive, but they sit where a future `git add -A` would pick them up. Recommend deleting them
  before merge, and noting the test-run process that creates them (likely a browser smoke test writing to
  a real upload path instead of a temp/fixture directory) as an unrelated follow-up.

---

## 7. SCOPE BOUNDARY — **PASS**

Confirmed via the diff itself and the scanner subagent's independent grep: no `ALTER TABLE`, no
`DROP COLUMN`/`DROP TABLE`, no changes to `collector/database/schema.sql`, no changes to any
`collector/scripts/migrate-*.mjs` file anywhere in this diff. The six changed files are exactly
`collector/db/repository.mjs`, `collector/server/index.mjs`, and four test files. Matches
`audit/step5b-round1-implementation.md`'s own stated scope ("does not migrate or drop
`content_items.workflow_status`, and does not alter or stop its existing writes").

---

## Baseline trust note

Per instructions, I did not re-run the full `npm run test:all` baseline — Codex's report states the
60-name failure set was compared by name, not count, and nothing in the diff gave a specific reason to
distrust that. My own test execution was scoped to exactly the 4 touched files (plus a production-only
revert of the same 4 files' targets), not a full-suite run.
