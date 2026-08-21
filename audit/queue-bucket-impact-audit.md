# Queue Bucket Impact Audit — `fix/queue-bucket-follows-state` (ecf6a96) vs `main`

Scope: `collector/server/public/app.js:737-789` (`resolveQueueBucket`) and every call site.
Mode: discovery-mode impact audit, static/code-level only (no Runtime DB access).
Diff size confirmed: `collector/server/public/app.js` +15/-1 (lines 765-782), plus a new test file
`collector/tests/queue-bucket-follows-state.test.mjs` (+110). No other files touched.

**Verdict: PASS.** The change is a genuine tightening (fewer false positives into `handoff`), every
item still lands in a bucket, no cross-content-type regression, badge counts share the same source of
truth as the lists, and there is zero CSS/theme impact. Two non-blocking findings below (dead
conditions in the new code, and an undocumented contract) — neither changes the PASS verdict.

---

## 1) Call sites of `resolveQueueBucket` — who calls it, what they do with the result

All 8 call sites read `state.items`, which comes from `GET /api/items` (`app.js:10356,10389`) —
**unfiltered by content type**, so place/event/transport items all flow through the same function
(relevant to §4).

| Call site | Uses result for |
|---|---|
| `isRawPreparationItem` (`app.js:791-794`) | Wraps `bucket === "raw_prep"`; drives Raw queue row label/badge class (`buildRawQueueStatusLabel`/`buildRawQueueStatusBadgeClass`, `app.js:5211,5221`) and row split (`app.js:5270`) |
| `getEditorialSurfaceUrlForItem` (`app.js:800,809`) | `bucket === "published"` forces `isReviewStage = true`, which changes which editor URL/surface is returned (navigation target) |
| `isHandoffEligibleItem` (`app.js:948-951`) | Wraps `bucket === "handoff"`; feeds: Raw Prep review/handoff filter counts (`buildRawReviewFilterHtml`, `app.js:5147-5148`), row badges (`app.js:2035,5209,5219,5273,5722`), and — most importantly — **the handoff tab's actual item list** `getAssignmentHandoffQueueItems` (`app.js:3625-3635`, filters `state.items` down to what row 9045 renders as "กระบวนการ 2 · ขั้น 1") |
| `getPreparationQueueItems` (`app.js:5119-5125`) | Filters `state.items` to `raw_prep \| field_pack_review \| unknown_workflow` — this is the Raw Intake/Prep panel's item list (`app.js:5708`) |
| `getDashboardPrimaryEntryAction` (`app.js:5157-5184`) | Picks the dashboard's primary CTA button + URL per item (`Clean` / `ตรวจชุดสั่งงาน` / `ไปส่งงานไปทำ` / editor) — a decision, not just display |
| `splitRawQueueByFieldPack` (`app.js:5186-5201`) | Splits `state.items` into `intake / review / unknown` arrays that back the Raw queue tables |
| `buildRawQueueStatusLabel` / `buildRawQueueStatusBadgeClass` (`app.js:5203-5222`) | Row-level badge text and CSS class (existing classes only, see §6) |
| `isHandoffEligibleItem` at `app.js:10276` | Gates the handoff detail panel (`getAssignmentContextItem` / `hasContextItem`) |

**Impact beyond the handoff tab:** yes — the same function decides (a) the Raw Prep panel's
review/handoff filter split and counts, (b) the dashboard's primary action button per item, (c) which
editorial URL a "review stage" link points to, and (d) the handoff detail panel's visibility. All of
these move together because they share one function — that is by design, not a side effect introduced
by this diff.

## 2) Can an item land in no bucket?

No. `resolveQueueBucket` always returns one of exactly six literals, in this order:
`unknown_workflow` (749) → `published` (751-753, 757-766) → `assignment` (754-756) → `handoff`
(768-784) → `field_pack_review` (785-787) → **`raw_prep`** (788, unconditional catch-all). Line 788 has
no guard — every code path that falls through the earlier `if`s terminates there. So an item that no
longer qualifies for `handoff` after this diff does not disappear from all tabs; it falls to
`field_pack_review` (if `hasFieldPack` is true) or `raw_prep` otherwise, and both of those buckets have
their own visible queue (`getPreparationQueueItems`, `app.js:5119-5125`). Confirmed no orphaned item is
possible.

## 3) The 9 `production_state` values vs the place ladder in `repository.mjs`

`repository.mjs:510-536` (`buildPlaceTransitionRules`) defines the place positional ladder as 12
states: `collected → analyzed → generated → ready_for_content → field_working → field_review →
writing_assigned → writing → in_review → ready_for_publish → submitted_for_admin_review → completed`
(plus `needs_revision`/`rejected`/`brief_generated`/`content_in_progress` explicitly isolated —
empty edge sets — for place).

The new `app.js:772-780` list has exactly 9 states: `ready_for_content, field_working, field_review,
writing_assigned, writing, in_review, ready_for_publish, submitted_for_admin_review, completed`.
Missing from the list: `collected`, `analyzed`, `generated` — the first 3 rungs. That is correct and
intentional: those 3 pre-field-pack rungs are exactly the case this fix targets (an item that
accidentally carries a stale/ready field-pack pointer while still early in the ladder should **not**
show as handoff-ready). Confirmed by the new test itself (`queue-bucket-follows-state.test.mjs`, case
"head=analyzed + pack ready_for_field → NOT in handoff bucket").

**Finding (informational, not a functional bug):** 4 of the 9 listed states —
`in_review`, `ready_for_publish`, `submitted_for_admin_review`, `completed` — are already returned as
`"published"` by the earlier branches at `app.js:751-753` (`completed`) and `app.js:757-766`
(`in_review`, `ready_for_publish`, `submitted_for_admin_review`), which run *before* the new handoff
check at line 768. Control flow never reaches line 772-780 with `productionState` set to any of those
4 values — they're dead conditions inside the new `if`. Only 5 of the 9 states
(`ready_for_content, field_working, field_review, writing_assigned, writing`) are actually reachable
and doing work. This doesn't cause a wrong bucket (the earlier branch already routes those items
correctly to `published`), but it means the new code reads as checking 9 states when it only exercises
5, which could mislead a future maintainer into thinking `handoff` legitimately covers late-ladder
items. Location: `app.js:772-780`, redundant against `app.js:751-753,757-766`.

## 4) Do event/transport items travel the same path? Does the place-shaped check leak?

Yes to the first question — `resolveQueueBucket` has no `content_type`/`type` branch at all
(confirmed by reading `app.js:737-789` in full), and `state.items` is unfiltered by type (§1), so
event/transport items run through the identical function.

For the second question: `repository.mjs:483-508` (`buildContentTypeTransitionRules`, used by `event`
and `other_transport`/`public_transport_map` per `repository.mjs:576-579`) has a materially different
state set — it never produces `field_working`, `field_review`, `writing_assigned`, or `writing` for
non-place items (those 4 strings don't exist anywhere in the legacy graph). So 4 of the 5 *reachable*
states from §3 are structurally place-only and pose no leak risk for other content types.

The one state that does overlap both graphs is `ready_for_content` (legacy graph:
`repository.mjs:489`, reachable from `brief_generated`). An event/transport item sitting in
`ready_for_content` with a field pack whose status is `ready_for_field`/`ready_for_handoff` would be
bucketed `handoff` under the new code — same as it would have been **before** this diff too, since the
pre-diff condition (`hasFieldPack && isAssignmentContextReady(fieldPackStatus)`, old
`app.js:768`) had no production_state gate at all and would route any not-yet-caught state, including
`ready_for_content`, to `handoff` regardless of content type. **This diff does not introduce or worsen
that cross-type exposure — it only narrows the *place* early-ladder false positive (§3) while leaving
the pre-existing `ready_for_content` shared-state behavior unchanged for event/transport.** No route or
repo-layer code found that restricts `POST /api/items/:id/field-packs` (`index.mjs:12564`) to
`content_type === "place"`, so this shared exposure is real but pre-existing, not new.

## 5) Do badge/counter numbers share the same source as the bucket used for the visible list?

Yes — single source of truth, same call. `buildRawReviewFilterHtml` (`app.js:5144-5155`) computes both
the "review" and "handoff" filter counts as `items.filter((item) => isHandoffEligibleItem(item)).length`
using the exact same `isHandoffEligibleItem → resolveQueueBucket` call that
`getAssignmentHandoffQueueItems` (`app.js:3625-3635`) uses to build the handoff tab's row list. No
separate counter, no cached/precomputed badge value, no numeric badge on the assignment sub-nav tabs
(`app.js:3618-3623,10548-10552` only toggle `.active`, no count). Grepped for any independent
"handoff count" source — none found. Confirmed: badge numbers cannot drift from the visible list
because they are computed by the identical function call, not a parallel path.

## 6) CSS / theme impact

Confirmed zero. `git diff main..fix/queue-bucket-follows-state --stat` shows exactly two files
changed: `collector/server/public/app.js` (+16/-1) and the new test file (+110/-0) — no `.css` file
appears in the diff at all. The touched lines in `app.js` are pure JS conditional logic; no new class
strings, template literals, or `workflow-badge-*` tokens were added or removed. The existing badge
classes referenced downstream (`workflow-badge-sent`, `workflow-badge-generated`, `workflow-badge-raw`,
`workflow-badge-cleaned`, `app.js:5219,5221`) are unchanged pre-existing classes; this diff cannot
affect them since it never touches that code path's class-selection logic, only which items reach it.
**No light/dark theme impact possible from this diff.**

---

## Secondary finding: test coverage is a parallel reimplementation, not the real function

`collector/tests/queue-bucket-follows-state.test.mjs:57-64` defines its own local `resolveBucket()`
helper that mirrors the new logic (`HANDOFF_STATES` array + `hasFieldPack && isReady &&
headAtReadyOrAbove`) rather than executing `app.js`'s actual `resolveQueueBucket`. Today the mirror is
correct (same 9-state list, same AND logic), but it is a duplicate implementation — a future edit to
`resolveQueueBucket` in `app.js` that changes this logic will not be caught by this test unless the
mirror is updated in lockstep. This matches a pre-existing repo-wide pattern for testing
browser-only `app.js` code without a DOM (e.g. `assignment-ui-scope.test.mjs:2812-2820` does
literal-string presence checks against `appJs.includes(snippet)` instead of execution), so this is not
a regression introduced by this branch, just worth flagging as a standing gap. Not blocking.

## Secondary finding: undocumented contract

`resolveQueueBucket` decides real navigation/queue-membership outcomes across at least 4 UI surfaces
(§1) and enforces the place ladder's positional ordering as a hard rule, but neither
`collector/PROJECT_STATE.md` nor `collector/PROJECT_POLICY.md` mentions `resolveQueueBucket`, the
handoff bucket, or the field-pack-readiness gate at all (both greps returned no matches). This is an
"undocumented contract" per this repo's own audit definitions — worth writing up in
`PROJECT_POLICY.md`/`PROJECT_STATE.md` on merge, not a defect in the diff itself.

---

## Summary

| # | Question | Result |
|---|---|---|
| 1 | Call sites & impact | 8 call sites across handoff tab, Raw Prep filters/counts, dashboard CTA, editor URL routing, detail panel visibility — all share one function by design |
| 2 | Item falls out of every bucket | Not possible — unconditional `raw_prep` catch-all at `app.js:788` |
| 3 | 9 states vs place ladder | Correctly excludes the 3 pre-field-pack rungs (`collected/analyzed/generated`); 4 of the 9 listed states are dead/redundant against earlier branches (informational only) |
| 4 | Other content types | Same code path, no type branch; 4 of 5 reachable states are structurally place-only; the one overlapping state (`ready_for_content`) carries pre-existing exposure unchanged by this diff |
| 5 | Badge numbers vs list | Same source call (`isHandoffEligibleItem`/`resolveQueueBucket`) — cannot drift |
| 6 | CSS / theme | Zero CSS touched; confirmed via `--stat` |

**PASS** — no functional regression found. Two non-blocking documentation/test-coverage notes recorded
above for future follow-up, not for this branch to block on.
