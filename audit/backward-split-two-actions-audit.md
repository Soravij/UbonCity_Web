# Backward-transition split: feasibility audit (read-only)

Scope: feasibility check only, per Sor's request following up on
`audit/item39-backward-queue-audit.md` item 2. Goal is to split the single
backward-in-process button available at `production_state = writing_assigned`
into two distinct one-click actions:

- **Action A** "เปลี่ยนคนเขียน" (change writer) — `writing_assigned → ready_for_writer`,
  close editorial assignment, do not touch field assignment. This is the current
  1-click behavior, unchanged.
- **Action B** "ส่งกลับให้ field แก้" (send back to field) — `writing_assigned → field_review`
  in one click, plus reopen any `accepted` field assignment to `revision_requested`.
  Today this requires two separate clicks through the intermediate `ready_for_writer` state.

No files modified. Pipeline: `audit-scanner` (Layer 1) → `audit-deep-reasoner` (Layer 2).

---

## Q1 — Does `PLACE_BACKWARD_PRODUCTION_TRANSITIONS` support a direct
`writing_assigned → field_review` edge? Is there a second place that validates edges?

**Verdict: needs-code-change, in TWO separate places — not one.**

1. `collector/db/repository.mjs:557-559` — the metadata table's
   `writing_assigned` key currently has exactly one target, `ready_for_writer`.
   The value shape is an object keyed by target state (not an array), and this
   shape already supports multiple targets — confirmed by the existing
   `field_review` entry (2 keys: `field_working`, `generated`, lines 550-553)
   and `in_review` entry (2 keys: `writing`, `field_review`, lines 566-569).
   Adding a `field_review` key alongside `ready_for_writer` under
   `writing_assigned` is structurally identical to those existing multi-target
   entries — **confirmed-safe in isolation**.

2. **Missed by Layer 1 — a second, independent gate.**
   `listLegalBackwardProductionTransitions()` (`repository.mjs:4774-4791`)
   doesn't just read the metadata table — line 4780 filters every candidate
   through `canTransition("place", "production", fromState, toState, contentItemId)`,
   which checks the adjacency graph built by `buildPlaceTransitionRules()`
   (`repository.mjs:511-538`). That graph currently has:
   ```
   writing_assigned: new Set(["writing", "ready_for_writer"]),   // line 525
   ```
   `field_review` is **not** in this set. Adding only the metadata table entry
   would have the new target silently filtered back out of the GET response,
   and any POST sent anyway would still 409 — `upsertWorkflowModel()`
   (`repository.mjs:4951`) calls `assertValidTransition()` at line 4978 against
   this same Set.

   **Required change**: both `repository.mjs:525` (add `"field_review"` to the
   Set) **and** the new key under `repository.mjs:557-559` in the metadata
   table. Neither alone is sufficient — this is the riskiest point of the
   whole change (see bottom).

---

## Q2 — `index.mjs:9203-9273` auto-close / reopen / other side effects

**2a. Generic auto-close (`index.mjs:9203-9227`) — confirmed-safe, no change needed.**
`closeKind` is derived purely from `fromProductionState`
(`EDITORIAL_PROCESS_STATES = {"writing_assigned","writing"}` → `"editorial"`),
never from `target.production_state`. A direct `writing_assigned → field_review`
POST computes `closeKind = "editorial"` identically to today's
`writing_assigned → ready_for_writer` POST, closing only
`assignment_kind === "editorial"` open assignments — exactly what Action B needs,
with zero code change.

**2b. Reopen block (`index.mjs:9252-9273`) — needs-code-change, with a real-risk
trap in the naive fix.**
Current condition:
```js
if (fromProductionState === "ready_for_writer" && target.production_state === "field_review") {
```
For a direct `writing_assigned → field_review` jump, `fromProductionState` is
`"writing_assigned"`, so this **does not fire** — Action B's core requirement
(reopen `accepted` field assignment) is unmet for the new edge.

- **Safe fix**: broaden the source-state check —
  `(fromProductionState === "ready_for_writer" || fromProductionState === "writing_assigned") && target.production_state === "field_review"`.
- **Do NOT** simplify to `target.production_state === "field_review"` alone.
  There is a second, unrelated existing edge that also targets `field_review`:
  `in_review → field_review` (`repository.mjs:568`, `direction: "cross_process"`,
  label "ตรวจงาน"). Dropping the source-state guard entirely would make that
  unrelated, existing `in_review → field_review` backward transition *also*
  start reopening accepted field assignments — an unrequested behavior change
  to a different feature, uncovered by any test.

**Other `ready_for_writer` references in `index.mjs` — none skipped by the
one-click path:**
- `index.mjs:4464` — `deriveArticleProcessStatus()` buckets both
  `ready_for_writer` and `field_review` as `"drafting"` (lines 4463-4464).
  Path-independent, no issue.
- `index.mjs:9214` — `SKIP_AUTO_CLOSE_STATES = new Set(["ready_for_writer"])`
  only matters when `ready_for_writer` is the *source*, irrelevant to a new
  edge that never has it as source.
- `index.mjs:10462` — editorial-assignment-creation endpoint requires
  `currentProductionState === "ready_for_writer"`; different endpoint, not
  exercised by the backward-transition POST.
- `index.mjs:11130/11137` — field-assignment-acceptance forward transition,
  gated on `currentProductionState === "field_review"` (`index.mjs:11126`),
  keyed on current state only, not on transition history.

No side effect anywhere is tied to *having passed through* `ready_for_writer`
as a transient intermediate state — everything checked is keyed on current
state, except the reopen condition already flagged above.

---

## Q3 — UI (`app.js:3629-3660` / shared renderer) — auto-render 2 buttons? Label collision?

**Verdict: confirmed-safe.**

- `workflow-backward-transitions.js:39-40` renders one button per array entry
  (`targets.map()`), keyed by `data-backward-target="${target.production_state}"`;
  the click handler (line 64) matches by `production_state`, never by `label_th`.
  With 2 targets under `writing_assigned`, this already produces 2 buttons with
  no client-side change needed.
- Relabeling the existing `writing_assigned → ready_for_writer` entry's
  `label_th` from `"รับงาน"` to `"เปลี่ยนคนเขียน"` (`repository.mjs:558`) is a
  pure data change — no collision against the new `field_review` entry's label
  `"ส่งกลับให้ field แก้"`, since both are independent object values rendered
  independently.
- Grepped the literal strings `รับงาน`, `ส่งกลับให้แก้`, `ส่งกลับให้ field`,
  `เปลี่ยนคนเขียน` across `app.js`, `repository.mjs`, `index.mjs`: no other file
  hardcodes a lookup keyed on these label strings for this feature (other
  `รับงาน` occurrences elsewhere are unrelated UI copy — claim-item chips,
  holder labels — not tied to this table).
- Current label meaning check: `"รับงาน"` ("take the job") is a reasonable label
  for the *current* single meaning (assignment gets closed, item awaits a new
  writer) but does not communicate "this closes the current writer's
  assignment" — renaming to `"เปลี่ยนคนเขียน"` is more accurate and doesn't
  conflict with anything downstream.

---

## Q4 — Side effects: other endpoint callers / pages assuming one target

**Verdict: confirmed-safe.**

- `resolveQueueBucket()` (`app.js:749-803`): `field_review` (line 787) and
  `ready_for_writer` (line 788) are already in the same `"handoff"` bucket
  condition (gated by `hasFieldPack && isAssignmentContextReady(...)`).
  Bucketing depends only on current `productionState`, not transition history —
  skipping the transient `ready_for_writer` display under the one-click Action B
  path is already handled correctly.
- The shared renderer (`workflow-backward-transitions.js`) is consumed by 5
  surfaces: `app.js:3629-3660`, `article-intake.js:380-419`,
  `article-submit-page.js:981-1016`, `article-workspace-page.js:1891-1925`,
  `item-editor.js:5325-5359`. All four non-`app.js` consumers are structurally
  identical thin wrappers — call `renderWorkflowBackwardTransitionControls(...)`
  with an `onTransition` callback that POSTs `{target_production_state, reason}`
  and follows `result.resume_path` generically. None assumes a single-target
  array length or branches per target.
- `placeBackwardTransitionResumePath()` (`index.mjs:4129-4139`) maps
  `surface: "assignment_review"` — used by both the existing
  `ready_for_writer` target and the new `field_review` target under
  `writing_assigned` — to the same `/?tab=review&item_id=...` resume path.
  Consistent, no divergent resume behavior between the two buttons.

---

## Test conflict found outside the four questions (must be called out, not
silently routed around)

`collector/tests/backward-autoclose-scope.test.mjs:116-162` — POSTs
`target_production_state: "field_review"` against an item seeded at
`writing_assigned`, asserts HTTP 200, then asserts `field.state === "accepted"`
(i.e. explicitly asserts the field assignment is **not** reopened).

- Against the *current* table + adjacency graph, this edge doesn't exist yet,
  so this POST should currently fall through to the 409 branch
  (`index.mjs:9172-9177`, `target` undefined from `.find()`) — worth confirming
  with an actual run via `test-runner` before implementation, since this
  test's first assertion (200) looks like it may already be failing today,
  independent of this feature.
- More importantly: once Action B lands (table entry + adjacency edge +
  broadened reopen condition), this test's second assertion —
  `field.state === "accepted"` — directly **contradicts** the new required
  behavior for exactly this edge (reopen to `revision_requested`). Per
  CLAUDE.md, this is a required, explicitly-called-out test rewrite, not
  something to edit silently.

---

## Scope of files that would need to change (if this is implemented)

- `collector/db/repository.mjs` — two edits: adjacency Set (line 525) + new
  metadata table key (line ~558), plus relabeling the existing entry's
  `label_th`.
- `collector/server/index.mjs` — one edit: broaden the reopen condition
  (lines 9252-9273) to include `fromProductionState === "writing_assigned"`.
- `collector/tests/backward-autoclose-scope.test.mjs` — rewrite the
  `writing_assigned → field_review` test case's expected outcome (lines 116-162).
- No changes needed to `app.js`, `workflow-backward-transitions.js`,
  `article-intake.js`, `article-submit-page.js`, `article-workspace-page.js`,
  or `item-editor.js` — all already array/multi-target-safe.

This spans both `repository.mjs` (validation-only concern) and `index.mjs`
(the assignment side-effect concern) — per this repo's patch-discipline rule,
these read as two different concerns and should likely be staged as separate
patches/commits even though both are required for Action B to work end-to-end,
plus a third patch for the test rewrite.

---

## Riskiest point

The adjacency-graph gate at **`collector/db/repository.mjs:525`**
(`buildPlaceTransitionRules()`'s `production.writing_assigned` Set). An
implementation that only touches the metadata table
(`PLACE_BACKWARD_PRODUCTION_TRANSITIONS`, lines 543-576) — which is the
obvious, visible place to add a target and which Layer 1 scanning alone
pointed to — will look structurally correct (matching the existing
`field_review`/`in_review` multi-target pattern) and still silently 409 on
every attempt, because `listLegalBackwardProductionTransitions()` filters the
new entry out via `canTransition()` before it reaches the API response, and
`upsertWorkflowModel()` would reject it again even if that filter were somehow
bypassed. This is a two-line, two-location change that must land together
(`repository.mjs:525` and `repository.mjs:557-559`), and nothing about the
table's shape alone would surface the omission during casual review.

Second-riskiest: the reopen condition's naive fix (dropping the
`fromProductionState` guard down to `target.production_state === "field_review"`
alone) would silently change behavior for the unrelated, existing
`in_review → field_review` edge (`repository.mjs:568`) — a regression with no
test coverage today.

---

## Method note

`audit-scanner` (Layer 1) ran first per the mandated pipeline and produced the
initial candidate list, correctly identifying that the transition table and
shared UI renderer are already multi-target-safe. `audit-deep-reasoner`
(Layer 2) then traced the full call chain and found the adjacency-graph gate
(`repository.mjs:525`) that Layer 1's candidate list did not surface at all,
confirmed the auto-close block needs no change, flagged the real-risk trap in
the reopen condition's naive fix, and identified the pre-existing test
conflict in `backward-autoclose-scope.test.mjs`. No code was modified; no
tests were run.
