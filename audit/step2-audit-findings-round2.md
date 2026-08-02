# Step 2 canonical-schema audit — round 2

Auditor: external review (read-only), round 2. No code was left modified — see the
"verification method" notes below for the two places this audit temporarily mutated
tracked files (a repository.mjs query, and a full working-tree checkout to baseline) to
prove behavior by execution; both were reverted and confirmed clean before writing this
report.

- Repo: `D:\UbonCity_Web`
- Branch: `codex/step2-canonical-schema`
- HEAD verified: `eb9eb72dc135c81e986028482adede76ff27ead0` (matches required `eb9eb72`)
- Round-1 baseline for this round: `4a6b2e2` (round 1's own verdict: CONDITIONAL, `audit/step2-audit-findings.md`)
- Diff audited this round: `git diff 4a6b2e2..eb9eb72` — 1 commit (`eb9eb72 test(collector): restore assignee contract coverage`),
  5 files: `collector/tests/assignment-ui-scope.test.mjs` (+79/−12), plus 3 new audit
  artifacts and one doc addendum. `collector/db/repository.mjs` and `collector/server/index.mjs`
  are **unchanged** in this diff (confirmed via `git diff 4a6b2e2..eb9eb72 -- collector/db/repository.mjs collector/server/index.mjs` — empty).

## Overall verdict: **PASS to merge into main**, with one carried-over pre-deployment advisory (non-blocking)

Both round-1 findings this round targeted are genuinely closed, verified by actually
executing code (breaking the query under test, replaying the historical test run) rather
than by re-reading the diff. Round 1's own methodology error (misjudging the baseline
status of one test) is confirmed and corrected below. The one item still open from round 1
— non-fresh-database upgrade safety for the removed `ensureApprovedContextActiveUniqueness`
dedup logic — was out of scope for this round's diff (no code changed) and remains
unaddressed; it does not block a `git merge` into `main` (merging touches no live database),
but it should be resolved or explicitly waived before this branch is deployed to the Runtime
machine specifically. See "Carried-over item" at the end.

---

## Correction to round 1 (required by the audit brief before scoring anything else)

**Round 1 claim (wrong):** "`user profile and external assignee contracts are wired
end-to-end with minimal schema changes` passed at baseline `51796ec` and was broken by
`4a6b2e2`'s deletion of `ensureUsersProfileSupport`, contradicting the report's '0 new
failures' claim."

**What was actually wrong with that measurement:** the test hardcodes
`const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");` instead of deriving
the path from `import.meta.url`. Round 1 tried to verify "did this pass at baseline" by
running the test from a separate `git worktree` checked out to `51796ec` — but because the
path is a hardcoded absolute literal (not relative to the worktree), that run still read
`repository.mjs`/`server/index.mjs`/`app.js` from the **live main working tree** (which was
at `4a6b2e2` during round 1), not from the worktree's own `51796ec` content. Round 1 caught
part of this (flagged the hardcoded path as a trap) but then substituted a *content-diff*
argument via `git show 51796ec:...` for just the one `ensureUsersProfileSupport` string,
concluded the test "would have passed," and treated the observed worktree failure as
authentic — without checking whether some *other* assertion in the same test also failed at
true baseline.

**Re-verified this round, properly, in two independent ways:**
1. Created a fresh, disposable `git worktree add --detach ../uboncity-web-r2-baseline 51796ec`,
   patched *only* the worktree's own copy of `collectorRoot` to resolve relative to
   `import.meta.url` (a change made and used entirely inside the disposable worktree — the
   main tree was never touched for this step), and ran the test there. Result: it **still
   fails** at genuine baseline content, but on a completely different assertion —
   `server should include profile/external-assignee contract snippet: profile_json: draftProfile,`
   — not the `ensureUsersProfileSupport` one. The worktree was then deleted.
2. Confirmed directly: `audit/step2-test-failures-51796ec.txt` (added in this round) lists
   `user profile and external assignee contracts are wired end-to-end with minimal schema
   changes` as failing at `51796ec`. This round independently reproduced that exact file from
   scratch (see item 3 below) and it matches byte-for-byte.

**Corrected conclusion:** this test was already broken at true baseline `51796ec`, for a
reason unrelated to the schema-canonicalization work (a stale assertion about a
`profile_json: draftProfile` server snippet, part of a pre-existing, unrelated
avatar/profile-crop UI staleness — see item 4). It was **not** a new failure caused by
`4a6b2e2`. Round 1's "this contradicts the 0-new-failures claim" conclusion is **withdrawn**.
The report's `new = 0, resolved = 0` claim for `4a6b2e2` itself was, on this specific point,
correct all along — round 1's own verification method was the thing that was broken, not the
implementation team's claim.

---

## 1. Is round-1 finding 2 (coverage gap) actually closed? — **PASS**, proven by execution

Round 1 found that deleting `assignments API data contract includes assignee display fields
for linked summaries` removed the only test asserting on the live
`COALESCE(u.display_name, a.assignee_name) AS assignee_display_name` /
`COALESCE(u.email, a.assignee_contact) AS assignee_email` JOIN in `repository.mjs`. `eb9eb72`
replaces it with a same-named test that builds a real temp SQLite DB from `schema.sql`, calls
the real `createRepository()`, inserts one internal assignment (`assignee_user_id` pointing
at a real `users` row) and one external assignment (`assignee_name`/`assignee_contact`/
`external_assignee_profile_json`, no `assignee_user_id`), then asserts
`repo.getAssignmentById(...).assignee_display_name`/`.assignee_email` on both.

Verified this is real behavior coverage, not a relabeled source-scan, by temporarily editing
the live `ASSIGNMENT_SELECT_WITH_ASSIGNEE` query in `collector/db/repository.mjs:3781-3792`
(reverted immediately after each run via `git checkout -- collector/db/repository.mjs`,
confirmed `git diff` empty afterward) and re-running just this test:

| Mutation | Result |
| --- | --- |
| `assignee_display_name`/`assignee_email` forced to `NULL` (breaks both paths) | Test fails on the **internal** assertion first: `actual: {assignee_display_name: null, ...}` vs `expected: {assignee_display_name: 'Internal Assignee', ...}` |
| `assignee_display_name`/`assignee_email` changed to read only `u.display_name`/`u.email` (i.e. drop the `COALESCE(..., a.assignee_name/a.assignee_contact)` fallback, keep the join) | Internal assertion now passes (internal rows have a real `users` join); test fails on the **external** assertion: `actual: {assignee_display_name: null, assignee_email: 'external.assignee@example.com'}` vs `expected: {assignee_display_name: 'External Assignee', ...}` |
| Unmutated (real code) | Passes cleanly |

This proves the test independently exercises both the internal-assignee path (via the `users`
join) and the external-assignee path (via the `COALESCE` fallback to `assignee_name`/
`assignee_contact`) — exactly what round 1 flagged as missing, and exactly what the round-2
brief asked to prove. Round-1 finding 2 is closed correctly.

---

## 2. Is round-1 finding 1 (11 cut assertions) actually closed, and was anything cut that shouldn't have been? — **PASS**

The diff removes exactly 11 literal-string assertions from `"user profile and external
assignee contracts..."` :

| # | Snippet | Checked against |
| --- | --- | --- |
| 1 | `function ensureUsersProfileSupport(db) {` | `repository.mjs` |
| 2 | `db.exec("ALTER TABLE users ADD COLUMN profile_json TEXT;");` | `repository.mjs` |
| 3 | `profile_json: draftProfile,` | `server/index.mjs` |
| 4–7 | `id="user-phone"`, `id="user-email-alt"`, `id="user-line-id"`, `id="user-pic-file"` | `server/public/index.html` |
| 8–11 | `async function openUserProfileCropModal(file) {`, `async function buildUserProfileCropResult() {`, `api("/api/users/avatar/upload", {`, `payload.profile_json = {` | `server/public/app.js` |

Checked each of the 11 against the **git blob content** at both endpoints (`git show
51796ec:<file>` / `git show eb9eb72:<file>` — not live disk, to avoid exactly the trap that
caused round 1's error above):

- **#1–2** (`ensureUsersProfileSupport`): present at `51796ec`, absent at `eb9eb72` — these are
  the genuine, direct casualty of `4a6b2e2`'s helper deletion. Correctly identified and
  correctly trimmed (the underlying behavior, `users.profile_json` existing, is independently
  confirmed present in `schema.sql`).
- **#3–11** (9 remaining): **absent at `51796ec` too.** These target an avatar-upload/
  "crop modal" UI flow (`openUserProfileCropModal`, `buildUserProfileCropResult`,
  `payload.profile_json`, the four `user-*` form field IDs) that was already gone from the
  codebase before this schema-refactor branch even started — unrelated pre-existing test
  debt, not something `4a6b2e2`/`eb9eb72` broke.

**Over-cutting check:** grepped the current tree for each of the 9 pre-existing-stale
snippets and their associated function names to confirm the feature didn't simply *move*
elsewhere (which would make trimming the assertion wrong instead of just early). Found
`openUserProfileCropModal`/`buildUserProfileCropResult` only inside **a different,
untouched test** in the same file — `"user profile picture flow keeps create-form draft
isolated from row-level avatar updates"` (`assignment-ui-scope.test.mjs:2207`) — which still
asserts on these same dead function names and is **still currently failing**, both before and
after this diff, for the same unrelated reason. `eb9eb72` did not touch that test block. This
is not new debt introduced by trimming the other test; it's the same debt, still present,
correctly out of this diff's scope, and cataloged under item 4 below. The `/api/users/:id/profile`
and `/api/users/avatar/upload` **routes** do still exist live in `server/index.mjs:7914,7983`
— only the frontend crop-modal UI and one internal variable name (`draftProfile`) are gone,
which is consistent with a UI refactor, not a backend regression.

**No over-cutting found.** Nothing among the 11 removed assertions still matches live
`eb9eb72` code.

---

## 3. Is the test gate credible? — **PASS**, reproduced from scratch, not just re-diffed

Verified `audit/step2-test-failures-51796ec.txt` is a genuine run output (not fabricated or
copied) and independently redid the whole set-diff computation, end to end:

**HEAD side:** ran `npm run test:all` directly on the live tree (already at `eb9eb72`, no
checkout needed). Result: **811 tests, 751 pass, 59 fail** — an exact match to
`step2-test-failure-set-diff.md`'s claimed head numbers. Extracted the 59 failing test names
from my own run output and diffed them against `audit/step2-test-failures-head.txt`: **zero
differences**, 59/59 identical.

**Baseline side (the harder one, since ~25 test files hardcode the `D:\UbonCity_Web` absolute
path and so cannot be trusted from a separate worktree):** performed a full, temporary,
reversible working-tree checkout — `git checkout 51796ec` (confirmed working tree was clean
before starting: only pre-existing untracked `audit/step2-audit-findings.md` and `uploads/`),
ran `npm run test:all` on the live tree at true baseline content, captured the result, then
`git checkout codex/step2-canonical-schema` to restore, and confirmed `git status`/`git
rev-parse HEAD` back to clean/`eb9eb72` afterward. Result: **819 tests, 758 pass, 60 fail**
— the total test count (819 vs 811) differs by exactly 8, consistent with round 1's 9 deleted
tests minus this round's 1 added test (−9+1=−8). Extracted the 60 failing names from my own
run and diffed against `audit/step2-test-failures-51796ec.txt`: **zero differences**, 60/60
identical, header count (`# Count: 60`) also matches.

**Independent set-diff**, computed directly from my own two captured name lists (not the
provided files): 
- Resolved (in baseline, not in head): exactly one — `user profile and external assignee
  contracts are wired end-to-end with minimal schema changes`.
- New (in head, not in baseline): none.

This exactly matches `new = 0, resolved = 1` as claimed in `audit/step2-test-failure-set-diff.md`
and `audit/step2-canonical-schema-implementation.md`'s addendum. The gate is credible.

---

## 4. Remaining source-scan-style tests — catalog (debt, not fixed)

Grepped `collector/tests/*.test.mjs` (all 67 files) for the pattern "read a source file with
`fs.readFileSync`, then assert `.includes(<literal string>)` against its raw text" — the same
fragile-under-refactor, can't-replay-against-history pattern this round's two closed findings
came from. This is inventory only; nothing here was fixed.

| File | Reads | Hardcoded `D:\UbonCity_Web` path? | Source-scan test names |
| --- | --- | --- | --- |
| `assignment-review-tracking-surface.test.mjs` | app.js, server/index.mjs, index.html | yes | `owner review tracking mode is wired in UI and server` |
| `assignment-round-contract.test.mjs` | app.js, server/index.mjs, repository.mjs | no | `assignment work round helpers no longer derive revision_round + 1`; `review media helper stays bundle-first and falls back to latest submission payload` |
| `assignment-ui-scope.test.mjs` | index.html, app.js, clean-item.html, item-editor.html, item-editor.js, theme-bootstrap.js, theme-control.js, server/index.mjs, styles.css, repository.mjs | **yes** | `user profile and external assignee contracts are wired end-to-end with minimal schema changes` (fixed this round — retains some scan assertions but now also has real-DB coverage alongside); `user profile picture flow keeps create-form draft isolated from row-level avatar updates` (**currently failing**, pre-existing, unrelated — see item 2); `assignment role choices and access control are defined server-side`; `user management UI aligns role choices to permission`; `avatar flow isolates create draft and supports shared crop modal behavior` |
| `item-blocker-summary.test.mjs` | server/index.mjs | no | `blocker-summary handler wires the same visibility gate as the item list` |
| `item-editor-packaging-requirements.test.mjs` | item-editor.js, item-editor.html, clean-item.html | yes | `item editor exposes canonical field-pack structure with required UI bindings`; `custom fields render in form placeholders and capture controls`; `form bindings use explicit data-field keys not implicit element IDs` |
| `reference-media.routes-source.test.mjs` | server/index.mjs | no | `server exposes reference media read/write routes`; `image workflow uses reference media and active routes do not lazily repair imported assets`; `/api/assets is filtered to collector-controlled local media`; `legacy imported media repair route is deprecated and import flows no longer bridge external media` |
| `release-queue-surface.test.mjs` | app.js, index.html, server/index.mjs | yes | `release tab exposes article queue UI and renders accepted handoff items`; `field assignment acceptance leaves place in field review and retains the legacy promotion for non-place items` |
| `requested-check-ui.behavior.test.mjs` | item-editor.js, item-editor.html, repository.mjs | yes | test block at lines 1070-1076 checking `itemEditorJs.includes()` for HTML5 data attributes |
| `revision-asset-replacement-ui.test.mjs` | app.js, server/index.mjs | no | mixed — mostly behavior tests that extract and execute functions from source, with some scanning on the extracted snippets |

Files checked and **excluded** as false positives (they load source text but their actual
assertions check runtime state — DOM class names, computed arrays, generated HTML output —
not the raw loaded source): `article-submit-readiness.behavior.test.mjs`,
`in-flight-items.test.mjs`, `article-submit-translation-recheck.test.mjs`,
`requested-check-return-form.behavior.test.mjs`, `reference-cleanup-ui-race.test.mjs`.

This class of test is inherently unable to be validated against git history the way real
behavior tests can (as this very audit round's method demonstrates: replaying them against a
historical commit requires either patching each file's path-resolution logic first, or a full
working-tree checkout — neither of which is available to whoever normally runs `npm run
test:all`). No action requested this round; filed as known debt for a future pass.

---

## Carried over from round 1, not addressed by this diff — pre-deployment advisory only

`4a6b2e2` (unchanged in this round) removed `ensureApprovedContextActiveUniqueness`, which
used to deduplicate `approved_context_blocks` rows before creating the
`idx_approved_context_active_unique` partial unique index. That index is now declared
directly in `schema.sql` and is (re)executed via `CREATE UNIQUE INDEX IF NOT EXISTS` on every
`openDatabase()` call. A database that predates this index and still has duplicate active
rows will throw a raw SQLite `UNIQUE constraint failed` on open, with no guard and no
automatic cleanup — this audit could not check the actual Runtime database (out of scope per
audit boundaries) so this remains an open risk, not a confirmed bug. Recommend confirming the
Runtime machine's database has no duplicate active `approved_context_blocks` rows before this
branch is deployed there. This does not block merging the branch into `main` at the git level.

## Summary table

| # | Check | Verdict |
| --- | --- | --- |
| — | Round-1 baseline-status correction | Confirmed and corrected: the test was already broken at true `51796ec`, for an unrelated reason — round 1's "new failure" claim is withdrawn |
| 1 | Round-1 finding 2 (coverage gap) closed | **PASS** — proven by breaking the query two ways and observing both internal and external assertions independently fail |
| 2 | Round-1 finding 1 (11 cut assertions) closed, no over-cutting | **PASS** — all 11 verified absent from git blob content at both `51796ec` and `eb9eb72`; the 2 real casualties correctly trimmed, the 9 pre-existing-dead ones correctly identified as unrelated debt |
| 3 | Test gate credible | **PASS** — both failure-name files independently reproduced byte-for-byte from real `npm run test:all` runs at both commits; own set-diff confirms `new=0, resolved=1` |
| 4 | Remaining source-scan test debt | Cataloged, 9 files / ~14 named test blocks — not fixed, filed as debt per instructions |

**Merge verdict: PASS.** The one open item (non-fresh-DB unique-index risk) is a
pre-deployment concern for the Runtime machine, not a reason to withhold this branch from
`main`.
