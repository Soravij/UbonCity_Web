# Step 5B round 1 — external audit, round 3 (merge gate)

Branch: `codex/step5b-round1-canonical-readers` @ `ad733e2` (confirmed via `git log --oneline -1` at
the start of this pass; machine/repo matched the brief, no other checkout touched). Method: nothing
from any implementation report was trusted — every item below was reproduced directly: full `git
diff`/`git show` inspection, a production-only revert (`git apply -R` on `repository.mjs`/`index.mjs`
only, tests left at HEAD) with a byte-hash-verified restore afterward, one full-suite run on HEAD, one
full-suite run on a freshly `git checkout main`'d tree (then switched back), and per-real-file (no
trailing slash) `git check-ignore` checks. No files were committed or pushed; scratch files created for
this pass were deleted afterward; `audit/round3-*.log` were kept as evidence (gitignored).

## Overall verdict: **CONDITIONAL**

Five of six items are clean, verified fixes since round 2: the hard-delete gate is now byte-identical
to `main`, the risky test that locked in its removal is gone, the diff's scope is exactly what it
should be, the lossy-state coverage still genuinely fails on a production-only revert, the failing-test
gate is 59=59 against a live `main` checkout, and the new `.gitignore` entry correctly (and narrowly)
covers the stray upload GIFs. **Item 1 is a genuine FAIL**, but of a specific kind worth being precise
about: it is not that the underlying code got worse — round 2 already established that
`assignment-ui-scope.test.mjs`'s original `72c9088` relabel is offset by real coverage added elsewhere
in the same file, and that's still exactly true here. The FAIL is that **the claim this round's brief
attributes to Codex — that the relabel was reverted to match `main` — is false**, and provably so: the
file is byte-identical to what round 2 already reviewed, and the one commit added since round 2
(`ad733e2`) doesn't touch this file at all. Recommend the merge proceed only after that specific claim
is corrected or retracted, precisely because an audit that lets a false status claim through undermines
trust in every other claim in the same report — even though this pass independently re-verified all of
those and found them true.

---

## 1. DISCREPANCY check — **FAIL** (false claim, proven against the tree)

`git show --stat ad733e2` (the only commit added since round 2's `a3aa391`):
```
.gitignore                          |  1 +
collector/db/repository.mjs         |  1 +
collector/tests/raw-delete.test.mjs | 15 +--------------
```
`collector/tests/assignment-ui-scope.test.mjs` is **not in this commit's file list at all** — confirming
the brief's own suspicion before I even looked at the diff. Direct check:
```
git diff main -- collector/tests/assignment-ui-scope.test.mjs
```
produced output **byte-identical** to what round 2 already reviewed:
- The original `72c9088` relabel is still present, unchanged:
  `assert.equal(hooks.buildItemWorkScopeState({ production_state: "collected", publication_state: "draft", claimed_by_user_id: null }, null), "raw_pool")`
  (was `{ workflow_status: "raw", claimed_by_user_id: null }` on `main`) — this is exactly the edit
  round 1 called a relabel and round 2 confirmed still passes unmodified against reverted production
  code (re-confirmed again in item 4 below).
- The lossy-groups test (`"claim-pool readers preserve all six legacy-lossy workflow state categories
  on an empty schema DB"`, added in `a3aa391`) is still present, unchanged.

**Conclusion**: the claim that this file was reverted to `main`'s version is not supported by the tree
— nothing in it changed since round 2. Reporting FAIL as instructed. This is a claim-accuracy problem,
not evidence the code regressed; see the overall verdict above for how that distinction is weighed.

## 2. Hard-delete gate restored to `main` — **PASS**

`git diff main -- collector/db/repository.mjs` no longer touches the `getRawOnlyHardDeleteEligibility`
region at all (`grep -n "workflow_status_not_raw\|addBlocker\|getRawOnlyHardDeleteEligibility"` on the
diff output returns nothing). Direct line comparison:
```
HEAD (repository.mjs:4513): if (String(item.workflow_status || "").trim().toLowerCase() !== "raw") addBlocker("workflow_status_not_raw");
main (repository.mjs:4498): if (String(item.workflow_status || "").trim().toLowerCase() !== "raw") addBlocker("workflow_status_not_raw");
```
Identical text (the line-number shift is just from unrelated earlier additions in the file). This
directly resolves round 1/round 2's carried-over FAIL on this point.

`git diff main -- collector/tests/raw-delete.test.mjs` → **0 lines, completely empty**. The
`a3aa391`-added test that asserted the removed gate's behavior as intended (`"raw hard-delete
eligibility relies on canonical state when the legacy mirror is stale"`) is gone — the file matches
`main` exactly.

## 3. Full diff scope — **PASS**

```
git diff main --stat
 .gitignore                                     |   1 +
 audit/step5b-round1-audit-findings.md          | 235 ++
 audit/step5b-round1-failing-test-names.txt     |  60 ++
 audit/step5b-round1-implementation.md          | 152 ++
 audit/step5b-workflow-status-mirror.md         | 362 ++
 collector/db/repository.mjs                    |  25 +-
 collector/server/index.mjs                     |  42 +-
 collector/tests/assignment-ui-scope.test.mjs   |  66 +
 collector/tests/in-flight-items.test.mjs       |  18 +
 collector/tests/workflow-readers-loud.test.mjs |   9 +
```
No migration script, no `schema.sql`, no other file appears. `raw-delete.test.mjs` correctly dropped
out of the list (matches `main`, per item 2). `.gitignore` +1 line only. 4 audit docs (unchanged from
round 1/2, informational). The two production files' full diffs were read in full: `repository.mjs`
only touches `mapWorkflowStatusToModelStates` (adds two historical aliases + `export`) and the
`listStmt`/`getStmt` join (read-side); `server/index.mjs` only touches `isClaimableRawPoolItem` and
`buildItemWorkScopeState`'s fallback removal (reads) and the deletion of the now-redundant
`mapLegacyStatusToCanonicalStates`/`normalizeLegacyWorkflowStatus` in favor of the single shared
mapper. None of the known `content_items.workflow_status` **write** sites
(`toItemBaseParams`/`insertItemStmt`/`updateItemStmt`/`normalizeInput`/`saveItem`/`setWorkflowStatus`/
`withCanonicalWorkflowStatusSeed`/`reconcileLegacyWorkflowStatusMirror`/`buildWorkflowHeadDefaults`/the
four `delete payload.workflow_status` sanitizers) appear anywhere in either file's diff — confirmed by
their absence from the diff output, same as rounds 1 and 2 found. Writes remain untouched.

## 4. Coverage still real after revert — **PASS**

```
git diff main HEAD -- collector/db/repository.mjs collector/server/index.mjs > audit_prod_r3.patch
git apply -R audit_prod_r3.patch   # production files only, back to main's content
node --test --test-concurrency=1 collector/tests/assignment-ui-scope.test.mjs collector/tests/in-flight-items.test.mjs collector/tests/workflow-readers-loud.test.mjs
→ 81 tests, 46 pass, 35 fail
```
Both canonical-state tests fail with the same `undefined`/`undefined` symptom as rounds 1–2:
```
✖ claim-pool readers preserve all six legacy-lossy workflow state categories on an empty schema DB
  + production_state: undefined, publication_state: undefined  (expected e.g. field_working/draft)
✖ getItem and listItems carry canonical workflow state for claim-pool scope
  + production_state: undefined, publication_state: undefined  (expected ready_for_publish/approved)
```
The relabeled test (`"item ownership scope metadata distinguishes raw pool, claim, assignment, and
viewer reason"`) **still passes** on reverted code — consistent with item 1's finding that this
specific edit remains unfixed, offset by (not replaced by) the lossy-groups test in the same file.

**Restore verified three ways, not just by re-applying the patch:**
```
git apply audit_prod_r3.patch
git diff HEAD -- collector/db/repository.mjs collector/server/index.mjs   → 0 lines
git hash-object collector/db/repository.mjs  → 4d12cf1...  (== git rev-parse HEAD:collector/db/repository.mjs)
git hash-object collector/server/index.mjs   → 1f2b5a7...  (== git rev-parse HEAD:collector/server/index.mjs)
```
(A stale `git status` briefly showed these two files as `M` after the restore — a Windows mtime/stat
cache artifact, not a real change; the hash comparison above proves the working-tree bytes are
identical to HEAD's committed blobs. Noting this so it isn't mistaken for a real problem if seen again
— `git checkout -- <file>` clears it safely once content-identity is confirmed via hash first.)

## 5. Gate: failing-test-name set, HEAD vs a freshly checked-out `main` — **PASS**

| | tests | pass | fail |
|---|---|---|---|
| HEAD (`ad733e2`) | 814 | 754 | **59** |
| `main` (`8a74705`, fresh `git checkout main`, switched back after) | 811 | 751 | **59** |

(814 vs round 2's 815 is expected: `a3aa391`'s 4 new tests minus the 1 removed by `ad733e2`'s
`raw-delete.test.mjs` revert = net +3 vs `main`'s 811.)

Failing-name sets extracted from each run's own `✖` lines (not the summary count), sorted, deduped, and
diffed: `comm -23`/`comm -13` both returned **empty**. **new = 0, missing = 0**, confirmed against a
live checkout, not a cached baseline file.

## 6. `.gitignore` — **PASS**

New line: `uploads/*.gif` (`.gitignore` diff, `+1`, right after the existing `collector/media/uploads/`
entry). Verified with **real file paths only, no trailing slash**, per the brief's instruction:
```
for f in uploads/*; do git check-ignore "$f" ...; done
→ all 12 current uploads/media-*.gif files: IGNORED
```
(count is up from round 2's 9 — the underlying test-run process is still producing them, but they're
now correctly ignored regardless.)

**Confirmed the new pattern doesn't over-match:**
- `collector/somewhere/uploads/foo.gif` (synthetic nested path, not a real ignored location) →
  **not ignored** (exit 1) — the pattern is anchored to the repo root (it contains a `/` not at the
  end, so per gitignore semantics it doesn't apply at arbitrary depth) and does not leak into other
  `uploads`-named directories.
- `uploads/test.png` (non-gif file in the real root `uploads/`) → **not ignored** (exit 1) — scoped to
  `.gif` only, as intended.
- No other tracked `uploads` directories exist in the repo besides `backend/uploads/` and
  `collector/media/uploads/`, both already covered by their own separate, pre-existing rules.

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 1 | Fixture-relabel-reverted claim vs actual tree | **FAIL** — claim is false; file unchanged since round 2 |
| 2 | Hard-delete gate restored to `main` | PASS |
| 3 | Diff scope (readers + lossy test + `.gitignore` only) | PASS |
| 4 | Lossy coverage still fails on production-only revert | PASS |
| 5 | Failing-test-name gate vs fresh `main` | PASS (59=59, identical sets) |
| 6 | `.gitignore` covers `uploads/*.gif` correctly, no over-match | PASS |

**Recommendation**: the code-level substance is merge-ready — items 2–6 are all genuine, verified
fixes and round 1/2's blocking hard-delete concern is resolved. The one open item is process, not code:
correct the false "reverted to main" claim about `assignment-ui-scope.test.mjs` before merging (the
honest status is what round 2 already recorded — real coverage exists in that file via the lossy-groups
test, but the specific relabeled fixture edit was never fixed, only offset). Once that claim is
reconciled with what's actually in the tree, this is a clean merge.
