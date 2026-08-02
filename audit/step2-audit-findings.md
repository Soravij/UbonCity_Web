# Step 2 canonical-schema audit findings

Auditor: external review (read-only), per `/audit` skill. No code, test, or schema files were
modified in the course of this audit. All verification below was produced by actually running
code (building real SQLite databases, invoking the real guard functions, running the real test
files) — not by reading the implementation team's own claims. Every implementation-side document
(`audit/step2-canonical-schema-implementation.md`, `audit/step2-test-triage.md`,
`audit/step1*.md`) was treated as a claim to be independently re-derived, per the audit brief.

- Repo: `D:\UbonCity_Web`
- Branch: `codex/step2-canonical-schema`
- HEAD verified: `4a6b2e2d55b2d02709e34afda215b2c2742aee36` (matches required `4a6b2e2`)
- Baseline: `51796ec` (`51796ecc57d0c9ce5dfd4dbd9c78614a16a5a25b`)
- Diff audited: `git diff 51796ec..4a6b2e2` (12 files, +419/−1940)

## Overall verdict: **CONDITIONAL**

The two most load-bearing claims — schema.sql completeness for fresh databases, and the two
runtime guards actually rejecting bad databases — are **independently proven true by execution**,
not just by reading the diff. However, the implementation report's test-gate claim
("`new = 0`, `resolved = 0`" against the 60-failure baseline) is **directly contradicted**: this
audit reproduced a currently-failing test caused by this diff that was not part of the accounted-
for 9 deletions and was not caught by the report's own comparison. One of the 9 deletions also
removed the only test coverage for a still-live API data contract. Neither finding invalidates the
core schema-canonicalization work, but the change should not be considered fully verified until
both are fixed.

---

## 1. Is schema.sql actually complete? — **PASS** (proven by execution, not by trusting the "diff = 0" claim)

The implementation report's "canonical-schema proof" table (diff = 0/0/0) is not itself wrong, but
it was *measured after the helpers were already deleted*, which the audit brief correctly flags as
circular. This audit re-derived it from the pre-deletion baseline instead:

**Method** (all executed with Node 24 / `node:sqlite`, in a scratch dir outside the repo, since removed):
1. Extracted `client.mjs` and `schema.sql` as they existed at `51796ec` (before any helper was deleted).
2. Built a fresh, empty database by running the **old** `openDatabase()` — i.e. the old `schema.sql`
   plus every one of the 8 boot-time `ensure*` mutation helpers that ran at open time — end to end.
3. Built a second fresh, empty database from **only** the new (`4a6b2e2`) `schema.sql`, run through
   nothing but a raw `db.exec(schemaSql)` plus the two remaining guards (i.e. exactly what
   `openDatabase()` does now).
4. Dumped full `sqlite_master` DDL, `PRAGMA table_info` (name/type/notnull/default/pk), and
   `PRAGMA foreign_key_list` for every table and index in both databases, and diffed the dumps
   table-by-table, column-by-column.

**Result:** the diff contains exactly 4 changed table blocks and 2 new index lines. Every single
line in the diff is an *addition* on the new-schema side (new columns/tables/indexes) — there is
**zero** case of a column, table, index, or FK that the old fully-migrated DB had and the new
schema.sql-only DB lacks. The additions (`agent_profiles`, `content_assignment_submission_drafts`
+ its 2 indexes, 5 `content_assets.assignment_*` columns, `content_assignment_submissions.updated_at`,
7 `content_assignments` acceptance/reset columns, `field_pack_checklists.capture_type` +
corrected `checklist_type` CHECK, and 3 new indexes) are exactly what `schema.sql`'s own diff
against `51796ec` shows was added directly into the DDL in this same commit — i.e. the helpers'
output was correctly folded into the canonical file, not silently dropped.

**Intentional exclusions, independently re-verified (not trusted from docs):**
The implementation doc claims 3 items were intentionally *not* added: `release_snapshots`,
`content_assignment_submissions.source_handoff_snapshot_id`, and `content_assets.assignment_slot_key`.
Grepped the whole current `collector/` tree for all three:
- `release_snapshots`: zero live references; only appears as the target of
  `collector/database/migrations/011_drop_release_snapshots.sql` (`DROP TABLE IF EXISTS`) — it is
  being actively retired, not something schema.sql should declare. Confirmed safe to exclude.
- `source_handoff_snapshot_id`: zero references anywhere in `repository.mjs` or `server/index.mjs`
  at HEAD. Confirmed safe to exclude.
- `assignment_slot_key`: the two functions that read `row.assignment_slot_key`
  (`resolveCurrentRoundEligibleAssignmentMediaAssets`,
  `evaluateAssignmentCaptureTopicReadinessFromAssets` / `evaluateLatestAssignmentSubmissionCaptureTopicReadiness`)
  were deleted in this same diff (part of the −286 lines in `server/index.mjs`). Confirmed via
  `git show 51796ec:collector/db/repository.mjs` that the repository method they depended on,
  `listAssignmentWorkAssetRows`, **never existed even at baseline** — so these were unreachable
  dead code before this diff too, not a live production path. (Note: `audit/step1b-repository-helper-survey.md`
  originally flagged this as "production currently requires it," which would have been a real
  gap; `audit/step1c-assignment-slot-key.md` did a deeper reachability trace and correctly reversed
  that conclusion before implementation. The final code matches the corrected conclusion. This
  audit independently reproduced the same "no such repository method" finding.)

### Conditional note — this proof covers *fresh* databases only, not upgrade safety for existing ones

The audit brief's method (build-empty-and-diff) inherently only tests fresh-DB parity, which is
what it asked for and what is now proven. But one deleted helper did more than DDL:
`ensureApprovedContextActiveUniqueness` (deleted from `client.mjs`) first **deduplicated existing
rows** (deactivating all but the newest `approved_context_blocks` row per
`content_item_id, evidence_block_id` where `status='active'`) and only *then* created the unique
partial index `idx_approved_context_active_unique`. That index is now declared directly in
`schema.sql:514` and is executed via `db.exec(schemaSql)` on **every** open (not just fresh
creation, since `CREATE TABLE/INDEX IF NOT EXISTS` runs unconditionally each time `openDatabase()`
runs with a schema path). If any existing database — one that predates this index and still has
duplicate active rows — is opened with the new code, `CREATE UNIQUE INDEX` will throw a raw SQLite
`UNIQUE constraint failed` error, with no guard and no cleanup step, where the old code silently
self-healed it. This is a real regression risk for **non-fresh** databases specifically (the dev/
runtime DB was explicitly out of scope for this audit per the no-live-data boundary), and it has
no equivalent to the two named guards. Flagged as a gap in guard *coverage*, not in schema.sql
*completeness* — hence this doesn't change the PASS verdict for item 1, but it should inform
whether the Runtime machine's actual DB is safe to open under the new code before merging.

---

## 2. Was anything deleted that shouldn't have been? — **PASS**, with one scope-drift note

`repository.mjs` (−1082 lines, 17 deleted `ensure*` functions): every one read
`PRAGMA table_info`/`sqlite_master`, then conditionally ran `ALTER TABLE`/`CREATE TABLE IF NOT
EXISTS`, with two cases (`ensureTranslationTables`, `ensureContentAssetWorkflowColumns`,
`ensureAssignmentTableSupport`, `ensureFieldPackAssignmentForeignKeySupport`) additionally doing
one-time data backfill/rebuild gated on detecting the *old* column shape — which cannot trigger on
a schema.sql-built DB, since the columns already exist NOT NULL with defaults from creation.
Repo-wide grep for all 17 function names found zero remaining call sites anywhere. Clean.

`server/index.mjs` (−286 lines): this is **not** schema/DB-bootstrap code, despite the commit's
stated scope. It deletes four business-logic functions
(`resolveCurrentRoundEligibleAssignmentMediaAssets`, `evaluateAssignmentCaptureTopicReadinessFromAssets`,
`evaluateAssignmentCaptureTopicReadiness`, `evaluateLatestAssignmentSubmissionCaptureTopicReadiness`)
that evaluated assignment media-capture "topic readiness." Independently confirmed these were
already dead at baseline (no caller outside their own chain, and their one required repository
method never existed — see item 1 above), so deleting them changes no runtime behavior. This is
correct dead-code removal, but it is scope drift relative to the commit's stated purpose
("remove boot-time schema mutation") — worth a note for commit hygiene, not a functional defect.

---

## 3. Do the guards actually work? — **PASS**, proven by execution

`repository.mjs`'s `createRepository(db)` calls `assertPlaceReviewFlagMigrationApplied(db, ...)`
and `assertAssignmentStateMigrationApplied(db, ...)` as its first two statements, before any
`db.prepare(...)` call. Verified by running `createRepository()` (the real, unmodified function)
against three constructed databases:

| DB variant | Result |
| --- | --- |
| Fresh schema.sql with `place_review_flag` column removed | `Error: content_workflow_models.place_review_flag is missing; run npm run migrate:place-review-flags before creating Collector repository` |
| Fresh schema.sql with legacy `assignment_state` column added back | `Error: content_workflow_models.assignment_state still exists; run npm run migrate:remove-assignment-state before creating Collector repository` |
| Fresh schema.sql, unmodified (baseline) | No error — repository created successfully |

Both failure cases produced the guard's own descriptive error, not a generic SQLite
`no such column`/constraint error — confirming the guards run *before* any prepared statement can
reach the missing/legacy column, exactly as `repository.mjs:2895-2896` implies from reading it.

---

## 4. Were the 9 deleted tests deleted correctly? — **CONDITIONAL / FAIL-tier finding**

Re-verified all 9 independently against the actual old test bodies (`git show 51796ec:<path>`) and
the actual deleted helper code, not the triage table.

**8 of 9 — correctly deleted.** Each asserted either (a) a source-scan for a specific deleted
`ensure*` function's DDL string, or (b) legacy-repair behavior (build a hand-crafted pre-migration
table, call `createRepository`, expect backfilled columns) whose target columns are now statically
declared in `schema.sql`. None of the 8 covered any behavior beyond the deleted helpers themselves.

**1 of 9 — should have been rewritten, not deleted; coverage gap introduced.**
`assignments API data contract includes assignee display fields for linked summaries`
(`collector/tests/assignment-ui-scope.test.mjs:967`, baseline) conflated two unrelated assertions:
a dead DDL-string scan (`"assignee_name TEXT"` from the deleted `ensureAssignmentTableSupport`)
*and* an assertion that the live `COALESCE(u.display_name, a.assignee_name) AS assignee_display_name`
/ `COALESCE(u.email, a.assignee_contact) AS assignee_email` JOIN exists — independently confirmed
still present and wired into `getAssignmentByIdStmt`/`getAssignmentByUidStmt` at
`repository.mjs:3781-3785` (HEAD), which are called pervasively from `collector/server/index.mjs`.
Deleting the whole test removed the only coverage for that still-live data contract. Grepped the
current test suite: no currently-passing test asserts on `assignee_display_name`/`assignee_email`/
`assignee_role` against an actual DB query result (`assignment-state-reader.test.mjs` and
`assignment-accept-confirmed-metadata.repository.test.mjs` call `getAssignmentById` extensively but
never assert on these fields; the remaining references in `assignment-ui-scope.test.mjs` are
synthetic in-memory hook/normalization tests, not real repository queries). **This is a genuine
coverage gap**, not a runtime bug — the underlying query still works — but it means a future
regression in the assignee-display JOIN would go undetected.

**A 10th, unaccounted-for regression — not in the list of 9, and not caught by the report's test gate.**
`collector/tests/assignment-ui-scope.test.mjs`'s test
`"user profile and external assignee contracts are wired end-to-end with minimal schema changes"`
(around line 998-1011) was **not touched by this diff at all** (confirmed: `git diff 51796ec..4a6b2e2`
on that file shows zero lines changed in or near this test block). It source-scans
`repository.mjs` for the literal string `"function ensureUsersProfileSupport(db) {"`.
`ensureUsersProfileSupport` was one of the 17 helpers deleted from `repository.mjs` in this diff.
Reproduced directly: running `node --test collector/tests/assignment-ui-scope.test.mjs` against the
current working tree fails this exact assertion:
```
AssertionError: repository/server should include new contract snippet: function ensureUsersProfileSupport(db) {
false !== true
```
Confirmed via `git show 51796ec:collector/db/repository.mjs` that the string existed verbatim in
the baseline file, and the test body referencing it is byte-identical between baseline and HEAD —
so this test passed at baseline and fails now, purely because of this diff. This directly
contradicts `audit/step2-canonical-schema-implementation.md`'s claim that the final
`npm run test:all` run showed the 60 failing test names as an exact match to the baseline set
(`new = 0`, `resolved = 0`). At least one new failure exists that the report's gate did not
account for. (This audit did not re-run the full 810-test suite to find a complete recount — the
point proven here is that the specific "0 new" claim is false, not what the true new-failure count is.)

The underlying behavior this stale test checks for (`users.profile_json` existing) is fine —
confirmed present directly in `schema.sql`. This is a test-hygiene defect (a 10th test that should
have been updated alongside the other 9), not a schema or runtime defect. But because it
contradicts a specific, checkable claim in the implementation report, it is the reason item 4 is
not a clean PASS.

---

## 5. Is removeLegacyLocalAuthData's removal safe? — **PASS**

The deleted function ran on every DB open: `DROP TABLE IF EXISTS user_sessions;` and
`UPDATE users SET password_hash='' WHERE COALESCE(password_hash, '')<>''`.
- `user_sessions`: confirmed absent from `schema.sql` (was never schema-declared, purely
  incidental legacy debris) and confirmed zero references anywhere in live `.mjs`/`.js` code.
- `password_hash`: traced the actual authentication path. Collector auth is JWT/backend-SSO based
  (`authenticateViaBackendLogin()` in `collector/server/auth-integration.mjs`, verified via
  `jwt.verify(token, backendJwtSecret, ...)`). The only write to `password_hash` anywhere is the
  user-provisioning INSERT, which hardcodes it to `''` directly, independent of the old boot-time
  cleanup. No code path anywhere reads `password_hash` to authenticate a request — there is no
  dormant local-password login mechanism that a stray non-empty value could re-enable. Removal is
  safe.

---

## 6. Leftovers — grep sweep for dangling references

- **Found:** the `ensureUsersProfileSupport` string still referenced in
  `collector/tests/assignment-ui-scope.test.mjs` (see item 4 — same finding, cross-referenced here
  since it is exactly the "helper deleted but a caller/reference still names it" case this item
  asks about). A full grep across `collector/` for all 26 deleted helper function names
  (17 from `repository.mjs` + 9 from `client.mjs`, including `removeLegacyLocalAuthData` and
  `ensureUsersAuthColumns`) found this as the **only** dangling reference.
- **Docs checked, clean:** root and `collector/` `PROJECT_POLICY.md`/`PROJECT_STATE.md`, and
  `agent.md`, contain no mention of boot-time schema helpers in either direction (neither stale
  claims that they exist, nor documentation that they were removed — the whole mechanism was
  always undocumented at the policy/state level, so there's nothing to correct there).
  `PATCH_CHANGELOG.md` mentions `ensureLifecycleColumns` once, but as a past-tense historical
  changelog entry, not a live-state claim — not an issue.
- **No dead imports found:** `workflow-head-schema.mjs` (the only module `client.mjs`/`repository.mjs`
  import for the guards) is unchanged between baseline and HEAD and both guard functions it exports
  are actually used.

---

## Summary table

| # | Check | Verdict |
| --- | --- | --- |
| 1 | schema.sql completeness | **PASS** (proven by execution; conditional note on non-fresh-DB upgrade safety for the removed dedup logic) |
| 2 | Over-deletion | **PASS** (one scope-drift note on server/index.mjs's −286 lines being unrelated dead-code cleanup, not schema work) |
| 3 | Guard behavior | **PASS** (proven by execution against 3 constructed DBs) |
| 4 | 9 deleted tests | **CONDITIONAL** — 8/9 correct; 1/9 introduced a coverage gap; a 10th, untouched test now fails and contradicts the report's "0 new failures" claim |
| 5 | removeLegacyLocalAuthData | **PASS** |
| 6 | Leftovers | 1 dangling reference found (same as item 4's 10th-test finding); docs clean |

## Recommended follow-up (implement step, not this audit)

1. Fix or delete the stale `ensureUsersProfileSupport` snippet assertion in
   `assignment-ui-scope.test.mjs` (~line 1011) — same treatment as the other 9.
2. Add a real data-contract test that queries a DB through `getAssignmentById`/`getAssignmentByUidStmt`
   and asserts on `assignee_display_name`/`assignee_email`/`assignee_role`, to replace the coverage
   lost when the assignee-display test was deleted wholesale instead of trimmed.
3. Re-run `npm run test:all` and re-diff the failing-test-name set against the true baseline before
   relying on the "0 new failures" claim again.
4. Before deploying this branch against any non-fresh database (the Runtime machine's DB in
   particular), confirm it does not have duplicate active `approved_context_blocks` rows that would
   make the new unconditional `CREATE UNIQUE INDEX idx_approved_context_active_unique` throw on open.
