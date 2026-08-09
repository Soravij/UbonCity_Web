# Audit: fix/evidence-provenance @ 6060474

**Role:** external auditor (read-only findings; only this report file is written/committed).
**Scope requested:** branch `fix/evidence-provenance` (95a9aa0 → ddab90f → 6060474), vs current `main` (15560b5).
**Method:** independent verification only — commit messages were not trusted for any claim; every
claim below was re-derived from the actual diff, actual file contents, and actual command output
(hash-verified revert, isolated worktree rebase, full-suite gate runs).

## 1) What the branch fixes, and what bug it fixes

**Before** (`main`/merge-base `065da92`, `collector/server/index.mjs:6847` and `:6891`):
```js
const sourceRecord = sourceRecords[0] || null;
```
`sourceRecords` comes from `repo.listSourceRecordsByItem()`, backed by
`collector/db/repository.mjs:2978`:
```sql
SELECT * FROM source_records WHERE content_item_id=? ORDER BY id DESC
```
`ORDER BY id DESC` means `[0]` is always the **most-recently-inserted** source record for the item,
regardless of which source the normalized payload being seeded actually came from.

**After** (`6060474`, same lines): matches `options.normalized.source_url` against each
`sourceRecords[].source_url` / `.source_entity_id` via `normalizeUrlForComparison`, falling back to
`null` (no provenance) on no match, instead of guessing.

**Proof the old code was wrong in practice** — hash-verified revert done in an isolated worktree
(`C:/t/audit-evidence-provenance-verify`, temp branch, deleted after use):
- Hash of `server/index.mjs` at branch tip: `dcc95f86…`
- Reverted `:6847`/`:6891` to `sourceRecords[0]`, re-ran `collector/tests/evidence-provenance-guard.test.mjs`:
  `4/7 fail`, with real value diffs, e.g.
  `AssertionError: :6847 wongnai match: expected source_record_id "50" but got "200"` — a Google
  record's id gets stamped onto a Wongnai-sourced evidence block, and
  `AssertionError: no match: expected source_record_id "null" but got "200"` — even when nothing
  matches, the old code stamped the highest-id record's id instead of leaving provenance unset.
- Restored file, re-hashed: `dcc95f86…` (match), `git status` clean, re-ran tests: `7/7 pass`.

This is a real bug fix: with 3+ source_records per item (multi-source collection is normal in this
pipeline), the old code silently mis-attributed evidence to the wrong source on every item where the
newest inserted record wasn't the one the current normalized payload came from.

## 2) Scope — `index.mjs` changes

`git diff 065da92..6060474 -- collector/server/index.mjs` touches exactly:
- `index.mjs:45` — import adds `normalizeUrlForComparison` from `evidence-candidates.mjs`.
- `index.mjs:6847-6850` — matching logic inside `seedEvidenceBlocksForItem`'s `options.normalized`
  branch.
- `index.mjs:6887-6890` — matching logic inside the same function's fallback-when-no-candidates
  branch.

`seedEvidenceBlocksForItem` has 4 call sites (all unchanged by this branch, confirmed by grep):
- `index.mjs:6670` and `:6701` — inside `importCollectedRawItem()` (merge and new-item import paths;
  both pass `options.normalized`, hitting the fixed `:6847` branch).
- `index.mjs:12407` — `GET /api/items/:id/evidence-blocks` (`index.mjs:12390`), called with **no**
  `options` at all. This hits the `else` loop (unaffected — it already stamped each source_record's
  own id per iteration, never used `[0]`), and only reaches the fixed `:6891` fallback path when
  none of the item's source_records have parseable `payload_json`.
- `index.mjs:13895` — bulk auto-import loop, also passes `options.normalized`.

**Behavior change:** no route, method, status code, or response JSON shape changes anywhere. The
only observable difference is the *value* of `source_record_id` (and derived `source_record_type`)
on newly-seeded evidence blocks for items with ≥2 source_records — from "whichever was inserted
last" to "the one whose URL/entity-id actually matches" (or `null` if none match). Existing/previously
seeded evidence blocks are untouched (dedup via `makeEvidenceSignature`, not re-seeded).

## 3) `normalizeUrlForComparison` — same function as reference-media's, or different?

**Different function**, not shared. `evidence-candidates.mjs:58-73`:
```js
export function normalizeUrlForComparison(url) {
  // hostname (lowercased, "www." stripped) + pathname (trailing "/" stripped)
  // query string and hash are DROPPED entirely
}
```
vs. reference-media's own `repository.mjs:64-87` (`normalizeReferenceMediaUrl`):
```js
function normalizeReferenceMediaUrl(value) {
  // decodes entities; special-cases /api/google-maps/photo?name=... (keeps only `name`);
  // otherwise requires http(s), strips hash, KEEPS all query params (sorted), returns full URL
}
```
These solve different problems and are correctly separate: `normalizeUrlForComparison` matches
**page-level source URLs** (Wongnai/Facebook/Google-Maps *post/place* pages stored in
`source_records.source_url`), where dropping tracking query params (`?ref=`, `?utm_source=`) is
desirable. `normalizeReferenceMediaUrl` matches **photo/media URLs**, where the query string often
*is* the image identity (e.g. Google's `name` param, Facebook CDN signature params), so it must be
preserved.

Confirmed via `git grep normalizeUrlForComparison` at `6060474`: it has exactly 3 call sites, all in
`evidence-candidates.mjs`/`index.mjs`, all comparing `source_records.source_url` /
`source_entity_id` — never a media/photo URL. `source_entity_id` itself is only ever populated from
`google_place_id` or `rawItem.source_ref` (`index.mjs:6590,6620,13875`) — never a media URL.

**Does the known `_-x_` / unsigned-fbcdn malformed-URL issue apply here?** No — that issue is about
media/photo asset URLs (the domain `normalizeReferenceMediaUrl` and `media-filter.mjs` operate on),
and this branch's matching never touches media URLs at all; it only compares article/page-level
`source_url` and place/entity IDs. There is no path by which a malformed CDN photo URL reaches
`normalizeUrlForComparison` in this code. (One theoretical, unrelated edge case: `source_entity_id`
values that aren't URLs — e.g. a raw Google place ID — fail `new URL()` and fall through to the
regex-based fallback branch in `normalizeUrlForComparison`, which just lowercases/trims the raw
string; a contrived collision between a normalized page-URL string and a raw entity-id string is
possible in principle but not connected to the fbcdn/`_-x_` issue and not observed in the test data.)

## 4) `evidence-provenance-guard.test.mjs` — behavioral or tautological?

**Behavioral, not tautological.** The test (`collector/tests/evidence-provenance-guard.test.mjs`)
reads the real `collector/server/index.mjs` off disk via
`fs.readFileSync(path.resolve(__dirname, "..", "server", "index.mjs"))`, extracts the actual
`seedEvidenceBlocksForItem` function body by brace-matching, and `Function()`-evals it with real
dependencies (including the real `normalizeUrlForComparison` and `buildEvidenceCandidatesForNormalized`
imports) — it does not re-implement or mock the matching logic being tested.

Hash-verified round trip (done in isolated worktree, not the primary checkout):
- 7/7 pass at branch tip (hash `dcc95f86…`).
- Reverted `:6847`/`:6891` to `sourceRecords[0]`: 3/7 pass, 4/7 fail with concrete value diffs
  (`200` vs expected `50`; `200` vs expected `null`) — see §1.
- Restored file: hash matches (`dcc95f86…`), `git status` clean, 7/7 pass again.

**Hardcoded absolute paths:** none found. `__dirname` is derived from `import.meta.url`
(`fileURLToPath`), and `serverPath` is `path.resolve(__dirname, "..", "server", "index.mjs")` —
portable across machines, consistent with the `fix/hardcoded-test-paths` fix already on `main`.

## 4b) Rebase onto current main — clean?

Tested in an isolated worktree on a temporary branch (`audit-tmp/evidence-provenance-rebase`,
created from `fix/evidence-provenance`, never touched `main` itself; deleted after use):
```
git rebase 15560b5   →   Successfully rebased and updated refs/heads/audit-tmp/evidence-provenance-rebase.
```
**Clean, zero conflicts.** All 3 commits replay (new hashes: `c89eea2`, `82a1576`, `2405fe5`); diff
vs. `15560b5` is identical file set (`evidence-candidates.mjs`, `index.mjs`,
`evidence-provenance-guard.test.mjs`) to the diff vs. the original merge-base — `main`'s 3 commits
since branch point (`fix/hardcoded-test-paths`) don't touch any of the same files.

## 5) Gate: main vs. rebase result

- `main` (15560b5), `npm run gate`: **tests=916 pass=856 fail=59 skipped=1**
- Rebase result, first attempt: **tests=923 pass=856 fail=66 skipped=1** — looked like +7 new
  failures. Root-caused: not a code regression — `git worktree add` doesn't carry gitignored files,
  so `collector/.env` (holding `COLLECTOR_SYNC_BACKEND_API`) was missing in the worktree, breaking
  `manual-import-merge-backfill.behavior.test.mjs` and `raw-intake-clean-prep.behavior.test.mjs`
  (`Error: Backend auth API base URL is required`) — an artifact of the audit's own worktree setup,
  not the branch.
- After copying `collector/.env` into the worktree, re-ran: **tests=923 pass=863 fail=59 skipped=1**.
  Diffed the full failing-test-name sets between `main` and the rebase result: **identical, 0 new
  failures, 0 fixed**. The +7 tests are exactly the branch's own
  `evidence-provenance-guard.test.mjs` suite, all passing.

## 6) Verdict: MERGEABLE

All 6 checks pass:
- Fix is real and proven with a hash-verified before/after (not just commit-message claim).
- Scope is contained to `seedEvidenceBlocksForItem`'s internal matching logic — no route/response
  contract changes, and the only other caller path (`GET /api/items/:id/evidence-blocks`) is
  unaffected except in the already-broken fallback case this branch fixes.
- `normalizeUrlForComparison` is correctly scoped to page-level source URLs, is a different function
  from reference-media's (correctly so, given different needs), and has no path connecting it to the
  known malformed-media-URL (`_-x_`/unsigned-fbcdn) issue.
- The guard test is genuinely behavioral (evals real production source, hash-verified revert flips
  it red) and has no hardcoded paths.
- Rebase onto current `main` is clean, no conflicts.
- Gate shows zero new failures after rebase (the initial +7 was an audit-environment artifact, not
  a branch defect), and the branch's own 7 new tests all pass.

No blocking items. No changes requested.
