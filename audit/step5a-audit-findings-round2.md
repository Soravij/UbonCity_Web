# Step 5A re-audit — verification of fix commit e4b9917

Scope: diff `48057c1..e4b9917` (10 files) on `codex/impl-step5a-remove-assignment-mirror`, verifying
against the two bugs in `audit/step5a-audit-findings.md`. Verification mode — no fresh repo scan, no
`test:all`. Method: `audit-deep-reasoner` agent pass, cross-checked directly by reading
`collector/services/publishable-assignment-candidate.mjs` and its call site in
`collector/db/repository.mjs:9995-10069` myself before writing this up.

## Verdict: **FAIL** — do not merge as-is

Bug 1 and Bug 2 from the prior round are genuinely fixed. But the fix introduces a new, high-severity
regression that breaks the normal (non-reworked) completion path, and no test in this diff would have
caught it.

## Check 1 — Bug 1 (reworked item wrongly reads "accepted forever"): **CLOSED**

`resolveItemScopeContext` (`collector/server/index.mjs:4255-4258`) now derives `has_accepted_assignment`
from `repo.buildPublishableSourceByItem(...).checks.assignment_accepted`, the same function and value
that feeds `buildPublishableSourceByItem`'s own consumers — one code path, not the old standalone
any-row `.some()`. Article Intake (`article-intake.js:410-479`) and the dashboard/in-flight label
(`app.js:705-756,2956`) both read this single `has_accepted_assignment` value. Re-derived the exact
rework scenario from round 1 (old round accepted→closed via `returnFieldAssignmentForRework`, new round
`assigned`): the closed round is filtered out of the candidate pool by
`isActiveAssignmentCandidate` (`publishable-assignment-candidate.mjs:11-13`) before selection, so the
active `assigned` round is chosen and correctly reads not-accepted everywhere. Confirmed by
`assignment-state-reader.test.mjs:110-143` ("a closed historical round cannot make the active assigned
round accepted") — genuine proof, hardcodes the expected `assignment_state: "assigned"` /
`assignment_accepted: false` and would fail against the reverted (round-1) helper.

## Check 2 — Bug 2 (two competing "accepted" definitions): **CLOSED**

Repo-wide grep for `hasAcceptedOrClosedAssignment` and `isAcceptedOrClosedAssignmentState`: zero code
hits (only historical mentions inside `audit/*.md`, which is expected — those are dated records, not
live code). Every consumer — Article Intake, dashboard, item-scope `has_accepted_assignment`, and
`buildPublishableSourceByItem`'s own `checks.assignment_accepted` — now goes through the single new
module `collector/services/publishable-assignment-candidate.mjs`
(`selectBestPublishableAssignmentCandidate` + `isSelectedAssignmentAccepted`), called from exactly one
production call site (`repository.mjs:10034,10046,10066`). One source of truth, confirmed.

## Check 3 — No regression on the normal completion path: **REGRESSION FOUND**

`isActiveAssignmentCandidate` (`collector/services/publishable-assignment-candidate.mjs:11-13`):
```js
export function isActiveAssignmentCandidate(candidate) {
  return String(candidate?.assignment_state || "").trim().toLowerCase() !== "closed";
}
```
This filters out `closed` **unconditionally** — with no check for whether the round is superseded by a
newer one. `selectBestPublishableAssignmentCandidate` (`:20-23`) applies this filter before ranking, so
a `closed` row is never even a candidate for selection, regardless of history. `isSelectedAssignmentAccepted`
(`:42-44`) also only recognizes the literal string `"accepted"`, never `"closed"`.

Traced the data flow in `repository.mjs:9995-10069`: `candidates` is built by mapping over **all**
assignment rows for the item (no pre-filtering); the closed-exclusion happens entirely inside
`selectBestPublishableAssignmentCandidate`. Consequence for an item with exactly **one** assignment that
was properly accepted and then closed (the ordinary, non-reworked completion path —
`accepted -> closed` is a normal terminal transition per `repository.mjs:586` and the
`POST /api/assignments/:id/close`-style route, not just a rework artifact): the filter removes its only
row, `selectBestPublishableAssignmentCandidate` returns `null` (`:39`, `[0] || null` on an empty array),
and:
- `checks.assignment_accepted` → `isSelectedAssignmentAccepted(null)` → `false`
- `source`/`candidate` → `null`
- `issues` → `["Missing publishable assignment source"]` (plus `"Missing current field pack"` if
  applicable) — i.e. the item reads as if it has **no** assignment at all, not merely "not yet accepted"

This was independently reproduced (not just read) against a real DB in the verification pass: one item,
one field assignment, driven `assigned -> submitted -> accepted -> closed`, then
`buildPublishableSourceByItem(item.id)` returned `assignment_accepted: false, source: null`. I confirmed
the same result by reading the code path directly (`repository.mjs:9995-10069` +
`publishable-assignment-candidate.mjs:11-44`) without relying solely on the subagent's run.

This is a genuine regression relative to both the removed `isAcceptedOrClosedAssignmentState` (which
matched `accepted` OR `closed`) and pre-Step-5A `main`. It also propagates to every Bug-1 consumer:
Article Intake will treat a fully, cleanly completed item's assignment signal as absent, and the
dashboard/in-flight "งานที่มอบหมายถูกรับแล้ว" (assignment accepted) label will not show for a
completed, closed round either.

The `ASSIGNMENT_STATE_RANK` map in the same file (`:1-9`) assigns `closed` rank `1` — second only to
`accepted` — which is inconsistent with `isActiveAssignmentCandidate` dropping it before rank is ever
consulted. The rank table's own shape suggests the intent was for `closed` to remain a valid, rankable
(and presumably accepted-counting) candidate when it is not superseded, and only be excluded when a
newer round exists on the same item. As written, `closed` is excluded from ranking entirely, and even if
it survived to selection, `isSelectedAssignmentAccepted` would still not count it as accepted — a second,
independent way the same case fails. Fix needs to distinguish "closed and superseded by a later round on
the same item" from "closed as the item's only/most-recent round," e.g. by only excluding a `closed`
round when a later-created round exists for the same `content_item_id`.

## Check 4 — Test proof quality: **GAP FOUND** (the exact regression above shipped untested)

- `assignment-state-reader.test.mjs:110-143` — genuine, non-tautological proof for the Bug-1 rework case
  (hardcoded expected values, would fail against the old helper). Good.
- `assignment-state-reader.test.mjs:145-172` — proves closed-ranks-below-active-round correctly, but
  every fixture in it includes a second, active candidate alongside the closed one. **No fixture anywhere
  in this diff creates an item with a closed round as its only/sole assignment** — the exact case that
  regressed. This gap is why Check 3's bug shipped uncaught.
- `assignment-ui-scope.test.mjs` changes (`:296-301,2736-2737`) are snippet/string-presence checks against
  `index.mjs` source text — they prove the wiring wasn't silently reverted, not that the wiring behaves
  correctly. Would not catch Issue 1.
- `in-flight-items.test.mjs:261-270` (new) hardcodes `has_accepted_assignment: false` as fixture *input*
  and only checks that the label mapping honors a given flag — it does not independently derive the flag
  from real assignment rows, so it's tautological with respect to this bug and proves nothing about
  `publishable-assignment-candidate.mjs` itself.

## Test run (scoped, not `test:all`)

`node --test collector/tests/assignment-state-reader.test.mjs collector/tests/assignment-ui-scope.test.mjs collector/tests/in-flight-items.test.mjs`
from repo root: 82 tests / 49 pass / 33 fail. All 33 failures are confined to
`assignment-ui-scope.test.mjs` and were confirmed (via a disposable worktree at `48057c1`) to be
pre-existing on the prior commit too — unrelated stale snippet assertions, not caused by this diff.
`assignment-state-reader.test.mjs`: 2/2 pass. `in-flight-items.test.mjs`: 11/11 pass. (None of these
passing counts contradict Check 3 — the regression is real but untested, so the existing suite is green
despite it.)

## What must be fixed before this can pass

1. **Blocking:** `isActiveAssignmentCandidate` must stop excluding every `closed` round unconditionally.
   It needs to keep a `closed` round eligible (and countable as accepted) when it is the item's only or
   most-recent round, and only exclude a `closed` round when a strictly newer round exists on the same
   item (the actual rework-supersession case Bug 1 was about). `isSelectedAssignmentAccepted` likely also
   needs to accept `"closed"` as an accepted state once that candidate is allowed through, matching the
   removed helper's original `accepted OR closed` rule.
2. **Blocking:** add a test fixture with a single, terminal `closed` assignment (no other rounds on the
   item) and assert `assignment_accepted: true` / a real candidate is returned — this is the case that
   just regressed silently.
