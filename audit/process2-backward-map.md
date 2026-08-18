# Process 2 (ส่งงานไปทำ → ลงงาน → ตรวจงาน) — Backward-Transition Map

Audit only. No code modified. Pipeline: `audit-scanner` (L1) → `audit-deep-reasoner` (L2), per
skill discipline — L1 not skipped.

Scope: the assignment handoff/work/review flow, `pageMode` ∈ {handoff, work, review} in
`collector/server/public/app.js`.

---

## 1. Dual-axis table (production_state × assignment.state per sub-step)

| Step | pageMode | `production_state` | `assignment.state` |
|---|---|---|---|
| 1 – ส่งงานไปทำ | `handoff` | `ready_for_content` (`collector/db/repository.mjs:551`, backward target of `field_working`, surface=`handoff`) | none — `ASSIGNMENT_STATES` (`repository.mjs:459`) has no "pre-assignment" value; step 1 is defined by the *absence* of an open `content_assignments` row |
| 2 – ลงงาน | `work` | `field_working` (`repository.mjs:550`) | `assigned` / `in_progress` (open, unaccepted work; `ASSIGNMENT_TRANSITION_RULES`, `repository.mjs:584-592`) |
| 3 – ตรวจงาน | `review` | `field_review` (`repository.mjs:553-554`, target-of surfaces `assignment_work`/`assignment_review`) | `submitted` / `resubmitted` / `accepted` |

`pageMode` itself is a pure tab selector, decoupled from both axes above: `getAssignmentPageMode`
(`app.js:985-997`) reads `state.preferredTab`; `getDefaultAssignmentPageMode` (`app.js:544-547`)
picks a default by role. Neither reads `production_state` or `assignment.state` directly — the
mapping in this table is a convention enforced by which data each page happens to load, not a
hard binding in code.

---

## 2. Backward edges 3→2 and 2→1 — what exists today

**3→2 (review → work):**
- `production_state` level: **edge exists** — `field_review → field_working`
  (`repository.mjs:550`, surface=`assignment_work`).
- `assignment.state` level: **no direct edge**. None of `submitted`, `resubmitted`, `accepted`
  (`repository.mjs:588-590`) transition straight to `assigned`/`in_progress`. The only path back
  to `in_progress` is the 2-hop `submitted → revision_requested → in_progress`
  (`repository.mjs:587,589`) — a real edge, but not a direct 3→2 edge.

**2→1 (work → handoff):**
- `production_state` level: **edge exists** — `field_working → ready_for_content`
  (`repository.mjs:549`, surface=`handoff`).
- `assignment.state` level: **no edge, direct or indirect, at all.** No value in
  `ASSIGNMENT_STATES` represents "returned to pre-assignment." The only thing that touches the
  assignment row on a 2→1 move is the auto-close side effect (§4), which forces it to the
  terminal `closed` state — a side effect, not a state-machine edge.

Both backward moves are production_state-level operations only; assignment.state has no matching
concept of "go backward" — it only knows how to progress forward or terminate (`closed`).

---

## 3. Endpoint + `#workflow-backward-controls` rendering

`/api/items/:id/workflow/backward-transitions` (`collector/server/index.mjs:9121-9245`), read
against actual code (not summary):
- GET, 9121-9136: read-only, calls `buildPlaceBackwardTransitionsPayload`.
- POST, 9138-9245: validates `type==='place'` only (9149), requires a `reason` (9156-9160),
  validates the requested target via `listLegalBackwardProductionTransitions` (9163-9171), updates
  the workflow model (9174-9186), then runs the assignment auto-close block (9197-9231, see §4).

`#workflow-backward-controls` appears in 11 files. Only `index.html:344` is relevant to the 3
pageModes — it sits **once**, structurally above/outside `#assignment-panel-handoff` (345),
`-work` (490), `-review` (667): the same shared element regardless of which tab is active, not
duplicated per panel. Its visibility is backend-driven only (`can_transition`/`targets`,
`workflow-backward-transitions.js:20-74`), no client-side pageMode gate — matches
`collector/PROJECT_POLICY.md:42-57`. The other 10 matches (`item-editor.html:70`,
`article-intake.html:31`, `article-submit.html:33`, `article-workspace.html:33`,
`clean-item.html:42`, plus their `.js` renderers) belong to the separate article-writing pipeline
pages, not the 3 assignment pageModes.

---

## 4. Assignment side-effect of a production_state backward transition

Confirmed by reading the code directly: `server/index.mjs:9197-9231`.
`OPEN_ASSIGNMENT_STATES_FOR_BACKWARD_CLOSE` (9197-9204) =
`{assigned, in_progress, submitted, resubmitted, revision_requested, accepted}`. Every assignment
on the item in one of those states is force-set to `closed` via `repo.updateAssignmentState(id,
"closed", ...)` (9209) and logged as `assignment.state.auto_close_backward_transition`.

This is a **close, never a revert/reopen** — there is no code path in this block that sets state
back to an earlier value. After either a 3→2 or 2→1 backward transition:
- the affected assignment row ends at `state='closed'` (terminal — `ASSIGNMENT_TRANSITION_RULES.closed
  = Set([])`, `repository.mjs:591`);
- no new assignment is created automatically anywhere in this block — the item becomes
  **assignment-less** until a human creates a fresh one.

---

## 5. Item 29 / item 25 — DB read vs. handoff page (read-only, live DB)

Queried `collector/data/collector.db` (the live DB per `collector/config/paths.mjs:9` — note the
*empty* `data/collector.db` at repo root is a decoy/unused path, not the one the server reads):

| item | `content_items.workflow_status` | `content_workflow_models.production_state` | open assignment | `content_assignments.state` |
|---|---|---|---|---|
| 29 | raw | `field_working` | id=17, kind=field | `in_progress` |
| 25 | raw | `field_working` | id=6, kind=field | `in_progress` |

Both items are mid-work (step 2, `field_working`) with an open, non-accepted field assignment —
**neither should qualify as "ready to hand off" (step 1).** Yet both render under
`pageMode=handoff`. Root cause, traced end-to-end:

`getAssignmentHandoffQueueItems` (`app.js:3596-3606`) filters by `isHandoffEligibleItem`
(`app.js:958-961`), which calls `resolveQueueBucket` (`app.js:747-798`):
- line 754: `hasAcceptedAssignment = snapshot?.hasAcceptedAssignment === true` — only true once an
  assignment reaches `accepted`.
- line 764-766: if accepted, bucket = `"assignment"` (correctly excluded from handoff).
- lines 778-793: **otherwise**, if the field pack is ready
  (`isAssignmentContextReady(fieldPackStatus)`, `app.js:953-955`, true for status
  `ready_for_field`/`ready_for_handoff`) and `production_state` is in an allow-list that
  **includes `field_working`** (line 783) → bucket = `"handoff"`, with no check for an
  open-but-not-yet-accepted assignment.

`hasAcceptedAssignment` is populated server-side via `index.mjs:3963-3988` →
`repo.buildPublishableSourceByItem` (`repository.mjs:8815-8926`) → `isSelectedAssignmentAccepted`
(`collector/services/publishable-assignment-candidate.mjs:59-62`):

```js
export function isSelectedAssignmentAccepted(candidate) {
  const state = String(candidate?.assignment_state || "").trim().toLowerCase();
  return state === "accepted" || state === "closed";
}
```

This function was built for the article publish-readiness pipeline (feeds
`ready_for_publish_source`, `repository.mjs:8859-8863`) and is being reused here to answer a
different question ("is this item already spoken for by an open assignment?"). It only
distinguishes `accepted`/`closed` from everything else, so it silently lumps the entire
in-progress work lifecycle (`assigned`, `in_progress`, `submitted`, `revision_requested`,
`resubmitted`) in with "no assignment yet." Both items 29 and 25 sit exactly there —
`field_working` + `in_progress`, i.e. not-yet-accepted — so they fall through to the handoff
bucket every time. This is not a new bug: it's the same call chain already flagged, without DB
confirmation, in the pre-existing (untracked) debt note `audit/handoff-queue-filter.md`. This
audit confirms it against live data and traces the full path:
`buildPublishableSourceByItem → index.mjs:4007 (attachItemScopeMetadata) →
item.has_accepted_assignment → getItemWorkflowSnapshot (app.js:717) →
resolveQueueBucket (app.js:754,764) → isHandoffEligibleItem (app.js:958) →
getAssignmentHandoffQueueItems (app.js:3596)`.

**Verdict: does the DB match what the handoff page shows? No.** Both items are mid-work with an
open assignment; the handoff page shows them as ready-for-handoff regardless.

---

## Where the mapping is wrong

`resolveQueueBucket` (`app.js:747-798`) currently treats "handoff-eligible" as *"field pack is
ready AND the best assignment hasn't been accepted yet"* — it should mean *"field pack is ready
AND there is no open assignment at all."* It borrows `isSelectedAssignmentAccepted`
(`collector/services/publishable-assignment-candidate.mjs:59-62`), a function written for a
different pipeline that only distinguishes `accepted`/`closed` from every other state, so it
treats "assignment not yet accepted" and "no assignment ever created" as the same thing. Any item
with `production_state='field_working'` and any open field assignment (`assigned`, `in_progress`,
`revision_requested`, `resubmitted`, `submitted`) and a `ready_for_field`-status field pack —
exactly the state a field assignment occupies for its *entire* in-progress lifetime — gets
misrouted into the step-1 handoff queue. Items 29 and 25 are two live instances of this, not an
edge case.

Separately, but on the same theme: the backward-transition endpoint's auto-close block
(`index.mjs:9197-9231`) always **closes** the open assignment on any backward move (3→2 or 2→1)
rather than reopening/reverting it, and creates no replacement — so even a *correct* backward
transition leaves the item assignment-less, relying on a human to notice and re-assign. Neither of
these is a missing production_state edge (both 3→2 and 2→1 edges exist and are legal); the gap is
entirely on the assignment-state side and in how the handoff queue reads it.
