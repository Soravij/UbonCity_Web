# Audit: fix/hide-media-evidence-rows @ e9b5b25

**Role:** external auditor (read-only findings; only this report file is written/committed).
**Scope requested:** branch `fix/hide-media-evidence-rows`, commit `e9b5b25`, vs `main`.
**Method:** independent verification only — implementer's report was not trusted for any claim below;
every claim here was re-derived from the actual diff, actual file contents, and actual test runs
performed during this audit.

## 0. Framing correction — "diff vs main" is not the same as "this round's diff"

`git diff main..e9b5b25` touches 6 files (`evidence-candidates.mjs`, `index.mjs`,
`clean-item.html`, `item-editor.js`, `evidence-hide-media-rows.behavior.test.mjs`,
`evidence-provenance-guard.test.mjs`). But `main` (`065da92`) does not yet contain three commits
that sit **underneath** `e9b5b25` on this branch: `95a9aa0`, `ddab90f`, `6060474` — all pre-existing
work from a *different* task (`fix/evidence-provenance`), not authored in this round.

Isolating this round's actual work — `git diff 6060474..e9b5b25` — shows only:

```
collector/server/public/clean-item.html                              |   2 +-
collector/server/public/item-editor.js                                |   8 +-
collector/tests/evidence-hide-media-rows.behavior.test.mjs (new)      | 116 +++++++++
3 files changed, 122 insertions(+), 4 deletions(-)
```

This is the correct scope for A–D below. The `evidence-candidates.mjs` / `index.mjs` /
`evidence-provenance-guard.test.mjs` changes are **not** scope creep by this round's implementer —
they're inherited from an unmerged parent branch. That said, it means this branch as constructed
is not mergeable to `main` as a clean "hide media rows" change — merging it would also merge the
three unrelated provenance-fix commits. Flagged under §5.

## A) Scope creep

**Verified diff (`git diff 6060474..e9b5b25 -- clean-item.html item-editor.js`):**

1. `clean-item.html:248` — `<option value="media">รูปภาพ</option>` removed, replaced with a
   **blank line** (not a clean line deletion — cosmetic sloppiness, not a functional bug):
   ```
   244  <select id="evidence-filter-block-type" aria-label="ประเภท">
   245    <option value="all">ทั้งหมด</option>
   246    <option value="fact">ข้อเท็จจริง</option>
   247    <option value="mention">ข้อความอ้างอิง</option>
   248
   249    <option value="review_snippet">รีวิวย่อ</option>
   ```
2. `item-editor.js:1364` — `if (blockType === "media") return false;` added inside
   `getEvidenceFilteredRows` (function starts `item-editor.js:1358`).
3. `item-editor.js:1598,1601-1603,1608` — summary text and empty-state message reworked to count
   against `nonMediaCount` instead of raw `rows.length`.

**No other production code changed in this round.** No backend, no repository, no reference-media
panel code, no CSS file. This matches the requested scope.

**Does removing `<option value="media">` break the dropdown?**
No functional breakage. `state.evidenceView.blockType` defaults to `"all"`
(`item-editor.js:24-28`) and is not persisted (no localStorage/sessionStorage read of this key
found) — so there is no stale "media" selection that could survive a reload and fail to match a
removed `<option>`. The only way to set `blockType` is the `change` handler at
`item-editor.js:5587-5589`, which reads `event.target.value` directly from the `<select>` — since
the `media` option no longer exists in the DOM, it is simply not selectable, so `blockFilter` can
never become `"media"` through the UI. The hard `blockType === "media"` exclusion at line 1364 runs
*before* the `blockFilter` comparison anyway, so even if `"media"` reached `blockFilter` by some
other path, media rows would still be excluded. **Net: functionally safe, but line 248 should be a
clean line removal, not a blank line left behind — minor diff hygiene issue.**

## B) Revert proof — redone independently, hash-verified

The implementer's own test file (`collector/tests/evidence-hide-media-rows.behavior.test.mjs:97-116`,
"revert proof" test) only does an **in-memory** string-patch revert of the source it reads at test
time — it never touches the real file on disk. That's a legitimate technique (it does prove the
test would fail without the exact filter line), but it is not the same as an actual file-level
revert/restore, so this audit redid the round-trip against the real file:

```
ORIGINAL HASH (item-editor.js @ e9b5b25):
  28b9da1b03c0bcd52fc66d8679d5f0b36b7564443288cce314e98aaf074c7863

Swapped in item-editor.js @ parent commit 6060474 (pre-fix):
  4dcc24ca57fed98dafa8f88e9887d46a82dae8f411b78c01056e0891a8b2fbf4

node --test collector/tests/evidence-hide-media-rows.behavior.test.mjs  (against reverted file)
  ✖ getEvidenceFilteredRows: media rows are excluded
  ✖ getEvidenceFilteredRows: all-media input yields empty result
  ✖ revert proof: removing filter lets media rows through
       AssertionError: original source must contain the media filter line

Restored item-editor.js from backup, re-hashed:
  28b9da1b03c0bcd52fc66d8679d5f0b36b7564443288cce314e98aaf074c7863   <- MATCH

git status / git diff --stat on the file post-restore: clean, no diff

node --test collector/tests/evidence-hide-media-rows.behavior.test.mjs  (restored file)
  ✔ 4 tests, 4 pass, 0 fail
```

**Confirmed:** the fix is real, the test is genuinely behavioral (fails when the fix is absent),
and the working tree was returned to byte-identical state (SHA-256 match) after the experiment.
No trace of the revert remains in the tree.

## C) Filter blast radius — most important item

`getEvidenceFilteredRows` is defined once, at `item-editor.js:1358`. Repo-wide grep (excluding
`node_modules`) for `getEvidenceFilteredRows` found **exactly one caller**:

```
item-editor.js:1588   const visibleRows = getEvidenceFilteredRows(rows);
```

inside `renderEvidenceTable()` (`item-editor.js:1580`). `renderEvidenceTable` itself is called from:

- `item-editor.js:1921` — inside `loadEvidenceContextAndPreview()`, gated by
  `if (!isCleanMode) { renderStepFourGuides(); return; }` at `item-editor.js:1916` — **only runs
  in Clean mode.**
- `item-editor.js:5562` (`syncClaimedItem`), `5589`, `5594`, `5599` (dropdown/sort `change`
  handlers) — these are **not** gated by `isCleanMode` in the JS itself, but `renderEvidenceTable`
  opens with `const table = qs("table-evidence"); if (!table) return;` (`item-editor.js:1581-1582`),
  and `#table-evidence` exists in exactly one HTML file in `collector/server/public/`:
  `clean-item.html`. Confirmed by grepping every `.html` file in that directory — the non-Clean
  page (`item-editor.html`) has no element with that id, so on that page `renderEvidenceTable()`
  is a no-op every time it's called.

**Conclusion: the filter's effect is confined to the Clean page's evidence table only.** No modal,
no export, no other page, no other render path is affected — because there is only one caller of
the filter function, and that caller is DOM-gated to a page that only exists as Clean. The
"ดูรายละเอียด" detail-row/modal path (`item-editor.js:1670-1689`, `1404-1446`) reads
`state.evidenceBlocks` directly (the raw unfiltered array), not through `getEvidenceFilteredRows`,
so it's unaffected either way — but it was never in the filtered code path to begin with, so this
isn't a scope note, just confirms no hidden second consumer exists.

## D) Empty state — misleading, confirmed by reading the exact branch

`item-editor.js:1598-1611` (current, at e9b5b25):

```js
const nonMediaCount = rows.filter((r) => String(r?.block_type || "").trim().toLowerCase() !== "media").length;
...
summaryNode.textContent = visibleRows.length === nonMediaCount
  ? `แสดง ${visibleRows.length} evidence`
  : `แสดง ${visibleRows.length}/${nonMediaCount} evidence`;
...
if (!visibleRows.length) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="6" class="muted">${nonMediaCount ? "ไม่พบ evidence ตามเงื่อนไขที่เลือก" : "ยังไม่มี evidence blocks"}</td>`;
  ...
}
```

For an item whose evidence is 100% `block_type='media'` (confirmed to exist — the user-reported
case with 20 rows): `rows.length = 20`, `nonMediaCount = 0`, `visibleRows.length = 0`.

- Summary line renders **"แสดง 0 evidence"** (not `0/20`) — the `nonMediaCount` denominator is
  itself 0, so the branch that would show a fraction never triggers.
- Empty-row message renders **"ยังไม่มี evidence blocks"** ("no evidence blocks yet") — the
  `nonMediaCount ? ... : ...` ternary picks the *zero-evidence* message specifically because
  `nonMediaCount` is 0, even though `rows.length` (the true evidence count) is 20.

**This is misleading.** An editor looking at this Clean page for that item sees a message that
reads as "this item has no evidence collected at all," when in fact 20 evidence blocks exist and
were deliberately hidden by this round's change. The code correctly distinguishes "0 due to
filter" vs "genuinely 0 rows" for the *block-type/source filter* case (`ไม่พบ evidence ตามเงื่อนไขที่เลือก`)
but collapses that same distinction for the *media-hidden* case back into the generic
zero-evidence message. No `PROJECT_POLICY.md`/`PROJECT_STATE.md` in this repo documents a
required wording for this state — this is an undocumented-but-real UX-correctness gap, not a
policy violation.

## Standards checks

- **New CSS classes / light-dark impact:** none. `styles.css` does not appear in the
  `6060474..e9b5b25` diff at all (confirmed via `git diff --stat`). No new classes introduced.
- **Backend / endpoint / repository / reference-media panel untouched:** confirmed — the round's
  diff touches only `clean-item.html`, `item-editor.js`, and the new test file. No changes to
  `collector/server/index.mjs`, `collector/db/repository.mjs`, or any reference-media panel code
  (`renderAssetsTable`, `/api/items/:id/reference-media`, etc.) in this round.
- **Gate / test baseline, both trees:** see §Results below (measured directly, not taken from the
  implementer's report).
- **Tautological vs behavioral test:** `evidence-hide-media-rows.behavior.test.mjs` dynamically
  extracts the *actual* `getEvidenceFilteredRows`/`classifyEvidenceSourceFamily`/`deriveHostName`
  function bodies from the live `item-editor.js` source via string search
  (`extractFunctionBlock`, lines 12-40) and evaluates them with `new Function(...)` — it is not
  hardcoding expected behavior independent of the source; it re-derives it from the file being
  tested every run. Independently re-verified as behavioral in §B (it fails when the real fix is
  absent, passes when present). Minor portability note: `SOURCE_PATH` at line 6 hardcodes an
  absolute Windows path (`D:/UbonCity_Web/collector/server/public/item-editor.js`) instead of a
  path relative to `import.meta.url` — this will silently break (file-not-found) on any machine
  where the repo isn't cloned to that exact drive/path, including CI. Not a correctness bug in
  what it tests, but a portability defect worth fixing.

## Results — gate measured independently on both trees

Both measured with the standard command from `docs/TEST_SUITE_BASELINE.md`
(`npm run test:all` from repo root), full stdout captured, failing-name sets extracted with the
doc's own recipe (`grep "^✖ " | sed 's/ ([0-9.]*ms)$//' | grep -v "^✖ failing tests:$" | sort -u`).

- **`main` @ `065da92`** (via `git worktree add`, read-only, node_modules junctioned in from the
  main checkout so imports resolve — first attempt without the junction produced spurious
  `ERR_MODULE_NOT_FOUND` failures on `dotenv`/`jsonwebtoken`/`mysql2`/`image-size`, an artifact of
  the bare worktree having no `node_modules`, not a real branch difference; discarded and rerun):
  **915 tests, 848 pass, 66 fail, 1 skipped.**
- **`fix/hide-media-evidence-rows` @ `e9b5b25`** (current checkout):
  **926 tests, 866 pass, 59 fail, 1 skipped.**
- **Sorted failing-name diff:** zero names appear on the branch side that aren't already failing
  on `main` — **no regression introduced.** Seven names fail on `main` but pass on the branch:
  `existing coordinate and map_url policy stays conservative and independent`,
  `existing stored coordinate presence is trim-aware and never mixes partial pairs`,
  `incoming coordinate parsing treats presence, zero, and invalid values correctly`,
  `merge preserves workflow, claim, field pack, and approved context invariants while remaining idempotent`,
  `new-item import still receives location and map_url normally`,
  `non-http Google Maps source URLs do not backfill coordinates or map_url in merge path`,
  `sqlite smoke guard uses canonical paths instead of tmp-looking strings`.
  These are fixed by the three inherited commits (`95a9aa0`/`ddab90f`/`6060474`) sitting
  underneath `e9b5b25` on this branch, not by this round's media-hiding diff itself — noted for
  completeness, not claimed as this round's work.

**Baseline doc mismatch (separate finding, category 2 — stale/contradicted state, not this
round's fault):** `docs/TEST_SUITE_BASELINE.md:113-118` claims current `main` measures
"915 tests, 855 pass, 59 fail, 1 skipped." This audit's independent, freshly-measured run against
the actual current `main` tip (`065da92`) gets **915 / 848 / 66 / 1** — same total, but 7 more
failures and 7 fewer passes than the doc claims. The doc's failing-name table
(`docs/TEST_SUITE_BASELINE.md:148-169`, "Known pre-existing failures, 60") also doesn't list any
of the 7 coordinate/map_url/sqlite-smoke names above. This means the doc is out of date relative
to current `main` — it was measured before whatever last changed `main`'s failure count from 59 to
66 landed (i.e., `main` regressed by 7 tests at some point after the doc's last update, or those 7
were newly-added tests that started failing — not distinguishable from this audit's evidence
alone). This is orthogonal to the media-hiding change (the branch under audit doesn't touch any of
those 7 tests' files) but is a real doc/reality gap worth its own follow-up.

## Verdict

**MERGEABLE**, with two non-blocking cleanup items and one out-of-band note:

1. **Blocking for a *clean* merge (not a code defect):** this branch is stacked on three commits
   (`95a9aa0`, `ddab90f`, `6060474`) that are not yet on `main` and belong to a different task
   (`fix/evidence-provenance`). Merging `e9b5b25` as-is merges that unrelated work too. Land
   `fix/evidence-provenance` (or rebase this branch onto current `main`) first, or merge with the
   understanding that both changes ship together.
2. **Non-blocking, recommended before merge:**
   - `clean-item.html:248` — remove the blank line left behind instead of a clean line deletion.
   - `item-editor.js:1606-1608` empty-state message — distinguish "media-only, hidden by design"
     from "genuinely zero evidence" (see §D) so editors aren't misled into thinking an item has no
     collected evidence when it has 20 hidden media rows.
   - `evidence-hide-media-rows.behavior.test.mjs:6` — replace the hardcoded
     `D:/UbonCity_Web/...` absolute path with one derived from `import.meta.url`, or it will fail
     to find the source file (not fail the assertion — fail to even load) on any machine/CI where
     the repo isn't at that exact path.
3. **Not blocking, independently verified as sound:** scope (A), revert-proof (B), and filter
   blast-radius (C) all check out — no scope creep beyond the two intended files, the guard test is
   genuinely behavioral (hash-verified revert/restore reproduced above), and the filter has exactly
   one caller confined to the Clean page's evidence table by a DOM-existence guard. No backend,
   repository, reference-media panel, or CSS was touched. Zero test regressions.
