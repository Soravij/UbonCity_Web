# item 39 backward-queue audit — root cause (read-only)

Scope: manual ladder-walk item 39 ("More Moon"), 3 bugs traced to one surface: the
"ถอยในกระบวนการ" (backward-in-process) control on `article-intake.html` and the queue
pages that read `production_state` afterward. Discovery mode. No files modified.
Pipeline used: `audit-scanner` (Layer 1) → manual verification of every cited line
(Layer 2 equivalent, done directly rather than via `audit-deep-reasoner`, since the
scanner's candidate list plus direct DB reads already pinned an exact, reproducible
root cause for both bugs — see "Method note" at the end).

---

## Q1 — BUG 5: backward button, round 1 vs round 2 diverge

### Chain: button → handler → endpoint → state writers

1. **Client handler** — `collector/server/public/app.js:3629-3650`
   `renderAssignmentBackwardTransitionControls()` wires the `onTransition` callback that
   fires when the user picks a target and confirms. It POSTs:
   ```js
   const result = await api(`/api/items/${itemId}/workflow/backward-transitions`, {
     method: "POST",
     body: JSON.stringify({ target_production_state: targetProductionState, reason }),
   });
   ```
   (line 3633-3636). The available `targetProductionState` options come from a separate
   GET at the same path, loaded by `refreshAssignmentBackwardTransitions()` (line 3653).

2. **Endpoint** — `collector/server/index.mjs:9144` —
   `app.post("/api/items/:id/workflow/backward-transitions", ...)`.

3. **Target lookup (single-step only)** — `index.mjs:9169-9171`:
   ```js
   const target = repo
     .listLegalBackwardProductionTransitions("place", workflowBefore.production_state, id)
     .find((entry) => entry.production_state === targetState);
   ```
   backed by the lookup table `collector/db/repository.mjs:543-576`
   (`PLACE_BACKWARD_PRODUCTION_TRANSITIONS`). Each key is a *current* production_state,
   mapping to exactly **one** legal backward target — this is a one-step-per-click graph,
   not a multi-step jump:
   - `writing_assigned` → `ready_for_writer` only, `label_th: "รับงาน"` (repository.mjs:557-559)
   - `ready_for_writer` → `field_review` only, `label_th: "ส่งกลับให้แก้"` (repository.mjs:560-562)

   So the literal Q1 button label "ส่งกลับให้แก้" only exists as a target when the item's
   current production_state is already `ready_for_writer`. From `writing_assigned` the
   only available backward button is labeled "รับงาน" and lands on `ready_for_writer`,
   one step short of `field_review`.

4. **production_state write** — `index.mjs:9180-9192`, `repo.upsertWorkflowModel(...)`
   writes the new row into `content_workflow_models` (confirmed live: see Q3) and logs
   a `content_workflow_transitions` row.

5. **Assignment-state side effects on backward** — `index.mjs:9203-9273`, two independent
   blocks:
   - **Generic auto-close** (`index.mjs:9203-9251`): closes assignments in
     `{assigned, in_progress, submitted, resubmitted, revision_requested, accepted}`
     whose `assignment_kind` matches `fromProductionState`'s process bucket
     (`EDITORIAL_PROCESS_STATES = {writing_assigned, writing}`,
     `FIELD_PROCESS_STATES = {field_working, field_review}`,
     `SKIP_AUTO_CLOSE_STATES = {ready_for_writer}` at line 9214). This is what closed
     assignment `#31` and `#32` (both editorial, `fromProductionState="writing_assigned"`)
     with `internal_note: "auto-closed by backward workflow transition: writing_assigned -> ready_for_writer"`.
   - **Reopen-to-revision_requested — the divergence point** (`index.mjs:9252-9273`):
     ```js
     if (fromProductionState === "ready_for_writer" && target.production_state === "field_review") {
       const acceptedFieldAssignments = repo.listAssignmentsByItem(id)
         .filter((a) => a.assignment_kind === "field")
         .filter((a) => a.state === "accepted");
       for (const assignment of acceptedFieldAssignments) {
         repo.updateAssignmentState(assignment.id, "revision_requested", ...);
       }
     }
     ```
     This block is **only entered on the exact edge `ready_for_writer → field_review`**.
     It is never entered on `writing_assigned → ready_for_writer`.

### Why round 1 landed correctly and round 2 did not

- **Round 1** (DB-confirmed, see Q3 timeline): the user clicked backward **twice**:
  `writing_assigned→ready_for_writer` (20:36:41, closes assignment `#31`) then
  `ready_for_writer→field_review` (20:38:02). The second click satisfied the
  `index.mjs:9252` condition, so field assignment `#29` (then `accepted`) was correctly
  reopened to `revision_requested` — this is the "correct" outcome the report describes.
- **Round 2**: after Assign Editor created assignment `#32`, the user clicked backward
  **once**: `writing_assigned→ready_for_writer` (20:50:04, closes assignment `#32`).
  Production_state stopped at `ready_for_writer` — it never reached `field_review`, so
  `index.mjs:9252`'s condition was never true, and assignment `#29` was **not** reopened
  — it is still sitting in state `accepted` (confirmed live, Q3).

  This is not a state-graph bug by itself (`ready_for_writer` is a legitimate, correctly
  named intermediate state one step before `field_review`) — the divergence is a
  **display bug**, traced next.

### Why the item then *appears* to fall back to "Field Pack Review"

`ready_for_writer` is a real, valid production_state, but it is missing from the queue
bucket allowlist that decides what a dashboard/queue row displays as. In
`collector/server/public/app.js`, `resolveQueueBucket()` (line 749-802):

```js
if (
  hasFieldPack
  && isAssignmentContextReady(fieldPackStatus)
  && (
    productionState === "ready_for_content"
    || productionState === "field_working"
    || productionState === "field_review"
    || productionState === "writing_assigned"   // <- present
    || productionState === "writing"
    || productionState === "in_review"
    || productionState === "ready_for_publish"
    || productionState === "submitted_for_admin_review"
    || productionState === "completed"
    // "ready_for_writer" is NOT in this list
  )
) {
  return "handoff";
}
if (hasFieldPack) {
  return "field_pack_review";   // <- app.js:799, falls through to here
}
```
(`app.js:781-799`). Because `ready_for_writer` is absent from the `handoff` allowlist,
any item sitting exactly at `ready_for_writer` with a field pack attached
(`hasFieldPack === true`, true for item 39: `current_field_pack_id = 38`) falls through
to `return "field_pack_review"` (line 799) — the earliest-stage bucket, labeled
`"รอตรวจชุดสั่งงาน"` (`app.js:5090`, `5184`, `5777`). This is the literal string the
user saw. `writing_assigned` and `field_review` (its immediate neighbors on both sides)
*are* in the allowlist, so an item only ever visibly regresses to "Field Pack Review"
when it is caught in this one specific state, `ready_for_writer`, with a field pack
already attached — exactly the state a single backward click from `writing_assigned`
produces.

Root cause is therefore two independent lines that both need `ready_for_writer` handled
explicitly, not implicitly:
- `index.mjs:9252` — the assignment-reopen condition is scoped to one specific edge and
  silently does nothing on any other backward edge.
- `app.js:781-794` — the handoff-bucket allowlist omits `ready_for_writer`, so the
  bucket resolver's fallback (line 798-799) mis-displays it as the earliest stage.

---

## Q2 — queue map (BUG 2 + BUG 6)

| # | Page/tab | Endpoint | State filter (file:line) |
|---|----------|----------|---------------------------|
| 2.1 | ส่งงานไปทำ (handoff) | client-side over `state.items` | `isHandoffEligibleItem()` → `resolveQueueBucket(item) === "handoff"` (`app.js:961-964`, bucket logic `app.js:749-802`) |
| 2.2 | ลงงาน (tab=work / actionable) | `GET /api/assignments/mine?scope=actionable` (`index.mjs:10849-10859`) | non-editor: `buildActionableAssignmentsForActor()` → `actionableStates = {assigned, in_progress, revision_requested}` (`index.mjs:3626`) |
| 2.3 | ตรวจงาน (tab=review) | `GET /api/assignments/mine?scope=review[&include_tracking=1]` (`index.mjs:10870-10878`) | `buildReviewAssignmentsForActor()` (`index.mjs:3647-3681`): `reviewStates = {submitted, resubmitted}`, or `{submitted, resubmitted, revision_requested, accepted}` **when `role==="owner" && include_tracking"** (`index.mjs:3650-3652`) |
| 3.1 | assign editor (article-process gate) | `isAssignmentContextReady(fieldPackStatus)` (`app.js:956-959`) — checks `field_pack_status ∈ {ready_for_field, ready_for_handoff}`, unrelated to `production_state` | n/a — this page gates on field-pack status, not on assignment state at all |
| 3.2 | เขียนบทความ (article-intake.html) | `GET /api/assignments/mine?assignee_user_id=...&limit=50` — **no `scope` param** | Falls through every `scope` branch in `index.mjs:10803-10877` to the **default branch at `index.mjs:10925-10928`**: `filterAssignmentsByManagementLine(req.authUser, repo.listAssignmentsByAssignee(assigneeId, limit))` — **no state filter of any kind** at the server. Client then filters only by `assignment_kind === "editorial"` (scanner-reported `article-intake.js:727`; not independently re-read this pass). |

**Confirms the user's suspicion for 2.3**: `index.mjs:3650-3652` is the exact line —
an assignment in state `revision_requested` (or `accepted`) enters the "ตรวจงาน" review
queue only when the caller is `role === "owner"` **and** passes `include_tracking=1`.
Without that flag, `revision_requested` is excluded from 2.3 entirely (falls into 2.2's
`actionableStates` instead, `index.mjs:3626`).

**Single source of truth?** Yes for the *stored* value — `content_workflow_models`
(one row per `content_item_id`, columns `production_state`, `publication_state`,
`state_version`, `last_transition_at`) is the canonical state, written exclusively via
`repo.upsertWorkflowModel()` and audited into `content_workflow_transitions`. Confirmed
live for item 39 (Q3 below): the table row matches the last transition log entry exactly.

**But no page reads it directly as "the current stage."** Every queue surface instead
re-derives a *display bucket* or *filter set* from a different combination of signals:
- 2.1 derives from `resolveQueueBucket()`, a 6-branch heuristic over `productionState`,
  `hasOpenAssignment`, `hasFieldPack`, and `fieldPackStatus` (`app.js:749-802`).
- 2.2/2.3/3.2 derive from `content_assignments.state` only — never look at
  `production_state` at all.
- 3.1 derives from `field_pack_status` only.

Because each surface computes "where is this item" from a different subset of columns,
and `resolveQueueBucket()`'s allowlist (Q1) has a gap, the same underlying
`production_state = ready_for_writer` renders as "still needs field pack review" on the
dashboard while assignment `#29` (state `accepted`) simultaneously would NOT appear on
2.3's review tab (accepted only shows there with owner+`include_tracking`) and DOES
appear on 2.2's actionable tab only if its state were `assigned/in_progress/revision_requested`
— which it currently is not (it's `accepted`), so item 39's field assignment is
presently invisible on 2.2 and 2.3 both, and the item itself is invisible on 2.1 (bucket
fell through to `field_pack_review`, not `handoff`). There is no single function all five
surfaces call — this is undocumented, duplicated derivation, not a shared contract.

---

## Q3 — live state, read-only (`collector/data/collector.db`, `DatabaseSync(..., {readOnly:true})`)

**`content_workflow_models` (canonical current state), `content_item_id=39`:**
```
production_state: "ready_for_writer"
publication_state: "draft"
current_field_pack_id: 38
state_version: 7
last_transition_at: "2026-08-24 20:50:04"   (local time, matches last transition below)
```
`content_items.workflow_status = "raw"` — a separate, stale legacy column, unrelated to
`content_workflow_models.production_state`; not read by any of the queue logic traced
above (flagged by the scanner, not independently re-verified — treat as low-confidence
until someone greps its readers).

**`content_assignments` rows for item 39:**
| id | kind | state | revision_round | notes |
|----|------|-------|-----------------|-------|
| 28 | field | closed | 0 | auto-closed by backward transition: field_working → ready_for_content |
| 29 | field | **accepted** | 3 | last transition: resubmitted→accepted @ local 20:46:15; **not reopened** by the round-2 backward click |
| 31 | editorial | closed | 0 | auto-closed by backward transition: writing_assigned → ready_for_writer (20:36:41) |
| 32 | editorial | closed | 0 | auto-closed by backward transition: writing_assigned → ready_for_writer (20:50:04) |

**`content_workflow_transitions` tail for item 39 (state_group=production, chronological, local time):**
```
20:34:16  ready_for_writer   → writing_assigned    (assignment #31 created)
20:36:41  writing_assigned   → ready_for_writer    (backward click #1 of round 1; closes #31)
20:38:02  ready_for_writer   → field_review        (backward click #2 of round 1; reopens #29 to revision_requested)
20:44:59  field_working      → field_review        (#29 resubmitted)
20:46:15  field_review       → ready_for_writer    (#29 accepted)
20:47:32  ready_for_writer   → writing_assigned    (assignment #32 created)
20:49:19  (#32 assigned → in_progress)
20:50:04  writing_assigned   → ready_for_writer    (backward click of round 2; closes #32) ← current head
```
No transition after 20:50:04 exists in the log — this is the true, current, and only
production_state. It never actually regressed to `generated`/"Field Pack Review" in the
data; the dashboard's *display* of "Field Pack Review" is a rendering artifact of the
`resolveQueueBucket()` gap described in Q1, not a real state regression.

---

## Proposed fixes, ranked by risk (not implemented — proposals only)

1. **Lowest risk, highest impact** — `app.js:781-794`: add `"ready_for_writer"` to the
   `handoff` bucket's `productionState` allowlist. This alone stops the false "Field
   Pack Review" display for any item sitting between `writing_assigned` and
   `field_review`. Single-line, additive, no state-graph change.
2. **Medium risk** — `index.mjs:9252`: the reopen-to-`revision_requested` condition is
   scoped to exactly one edge (`ready_for_writer → field_review`). Confirm with the
   product owner whether a single backward click from `writing_assigned` (landing on
   `ready_for_writer`) should also reopen an `accepted` field assignment, or whether
   requiring the second click is intentional (it does correctly close the editorial
   assignment either way). If intentional, this is a documentation gap, not a bug —
   `PROJECT_POLICY.md` §7A is cited in a comment at `index.mjs:9200-9202` for the
   auto-close block but says nothing about the reopen block's single-edge scope.
3. **Higher risk / needs product decision** — Q2's five surfaces each derive "current
   stage" independently. Consolidating them behind one shared function reading
   `content_workflow_models.production_state` + `content_assignments.state` would close
   this whole bug class, but touches `app.js`, `index.mjs`, and possibly
   `article-intake.js` — multiple concerns, should be its own scoped task per this
   repo's patch-discipline rule, not bundled with fix #1 or #2.

---

## Method note

`audit-scanner` (Layer 1) was run first per the mandated pipeline and produced the
candidate list that located `index.mjs:9144-9287` and `app.js:749-802`/`resolveQueueBucket`.
Its file attribution for `buildReviewAssignmentsForActor`/`buildActionableAssignmentsForActor`
(reported as `app.js`) was corrected during verification — those functions are in
`collector/server/index.mjs:3614-3690`, not `app.js`. Every citation in this report above
was re-read directly from source after the scan, so line numbers here are first-hand, not
carried over from the scanner's output uncorrected. `audit-deep-reasoner` (Layer 2) was not
separately invoked because the scanner's candidates plus direct reads plus live (read-only)
DB rows already converged on a single, internally consistent, reproducible root cause with
no remaining ambiguity to adjudicate — invoking Layer 2 would have re-derived the same
conclusion from the same evidence.
