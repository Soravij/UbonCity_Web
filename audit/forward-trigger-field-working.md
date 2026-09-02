# Forward trigger audit: ready_for_content → field_working (UI side)

Commit audited: `12b02f7` (branch `fix/pipeline-round-15aug`)
Status: READ-ONLY scan — no code changed.

Scope note: `audit/ladder-function-map` (referenced in the task) does not exist as a committed
file in this working tree at `12b02f7` (only `.git/logs/refs/remotes/origin/codex/place-ladder*`
and `.git/worktrees/step5-ladder-forward-runtime` hits) — cannot cross-check it directly, taking
the task's description of its scope (backward edges) at face value.

The forward rule itself is confirmed legal: `collector/db/repository.mjs:520`
`ready_for_content: new Set(["field_working", "generated"])`.

---

## 1) "เปิดงาน" button — what it actually does

`data-action="open-assignment"` (`collector/server/public/app.js:9253`, rendered into
`#table-assignments`, which is the table under the "งานที่ฉันต้องทำ" heading —
`collector/server/public/index.html:468` / `:475`).

Click handler, `collector/server/public/app.js:11446-11452`:
```js
if (action === "open-assignment") {
  const id = Number(btn.dataset.id || 0);
  if (id) {
    selectAssignment(id);
    qs("assignment-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return;
}
```

It calls `selectAssignment(id)` and scrolls. **It does not issue any PATCH.** No call to
`/api/assignments/:id/state` exists in this handler or in `selectAssignment()`
(`app.js:9260-9339` inspected in full — the function only sets `state.assignments.*`, renders
summaries/forms, and calls `setAssignmentDetailVisible(true)` at `app.js:9329` +
`updateAssignmentActionControls(assignment)` at `app.js:9338`).

`updateAssignmentActionControls` (`app.js:4714-4792`) is what populates the real transition
control — a `<select id="assignment-state-action">` (`index.html:550`) plus
`<button id="btn-assignment-update-state">` (`index.html:569`), both inside
`#assignment-detail-panel` (`index.html:512`, starts `class="secondary-panel hidden"` until
`setAssignmentDetailVisible(true)` unhides it). The button's click handler
(`app.js:11469-11478`) calls `updateAssignmentState()` (`app.js:9909-9941`), which is the
function that actually does `PATCH /api/assignments/:id/state`.

So "เปิดงาน" only reveals/selects the assignment; the state-changing control is a **separate**
select+button pair one scroll further down. Typing into fields or uploading assets never touches
either control, so "กรอกข้อมูล/อัปโหลด asset/กดปุ่ม 'เปิดงาน' ก็ไม่ขยับ" is expected given this
wiring — none of those three actions call the state endpoint.

---

## 2) Does the page auto-open on first load, via the same handler?

Yes. The assignments-refresh routine (`app.js:9606-9698`, the function containing the
`api(actionablePath)/api(managedPath)/api(submittedPath)` calls) auto-selects an assignment on
every load/refresh via the identical `selectAssignment(...)` call used by the button handler —
e.g. `selectAssignment(landingAssignmentId, ...)` at `app.js:9657`, `selectAssignment(rows[0]?.id)`
at `app.js:9673`/`9683`/`9692`, and equivalent branches again at `app.js:9763-9767` in the sibling
render path. There is no separate "auto-open" code path — same function, same behavior: reveals
the detail panel and pre-populates the state control, but issues no PATCH by itself. This matches
the report's observation that the state was already "open" (panel visible, item on screen) yet
never moved — auto-select and manual "เปิดงาน" click are behaviorally identical no-ops on state.

---

## 3) Full production-state table — is there a forward-trigger element per state?

Ladder from `repository.mjs:516-534` (place type), each edge checked for a UI caller:

| Edge (from → to) | UI trigger found | Location |
|---|---|---|
| `collected → analyzed` | Yes — `workflow_action: "mark_cleaned"` on item save | `item-editor.js` → `PUT /api/items/:id` (`index.mjs:8721-8771`, sets `production_state:"analyzed"` at `index.mjs:8757`) |
| `analyzed → generated` | **Not located** in `collector/server/public/*.js` as a direct "set generated" caller in this pass — likely part of the AI-generation pipeline rather than a manual button; out of this audit's evidence (would need a dedicated pass, not covered by the 4 questions asked) |
| `generated → ready_for_content` | Yes | `item-editor.js:5838` → `POST /api/items/:id/place-ready-for-content` (`index.mjs:8773-8819`) |
| **`ready_for_content → field_working`** | Yes, but only via the state-action control described in Q1/Q4, not "เปิดงาน" | `app.js:11469` `btn-assignment-update-state` → `updateAssignmentState()` (`app.js:9909`) → `PATCH /api/assignments/:id/state {action:"reopen_in_progress"}` → sync logic `repository.mjs:5618-5642` |
| `field_working → field_review` | Yes | Assignment submit (`submit`/`resubmit` in `ASSIGNMENT_UI_STATE_CONFIG.assigned/in_progress.submissionActions`, `app.js:58-74`) → `createAssignmentSubmission()` → same sync logic `repository.mjs:5618-5642` (`normalizedState` in `["submitted","resubmitted"]` → `field_review`) |
| `field_review → writing_assigned` | Yes | `article-intake.js:905` → `POST /api/items/:id/article-editorial-assignments` (`index.mjs:10341-10422`, sets `writing_assigned` at `index.mjs:10422`) |
| `writing_assigned → writing` | **No dedicated UI trigger** — already investigated and closed as intentional in the prior 15aug round (finding **E**, `collector/PROJECT_STATE.md:74-80`): both states collapse to the same article-process status `"drafting"` (`index.mjs:4451-4463` in `deriveArticleProcessStatus`), so there is no separate button for this sub-edge by design, not by omission | n/a |
| `writing → in_review` | Yes | `article-workspace-page.js:2105` → `POST /api/items/:id/article-process/submit-review` (`index.mjs:9318-...`, status `ready_for_review` maps to `production_state:"in_review"` at `index.mjs:4534-4539`) |
| `in_review → ready_for_publish` | Yes | `transitionArticle("ready_for_sync", ...)` — `article-submit-page.js:1401` / `event-submit-page.js:805` → `POST /api/items/:id/article-process/transition` (maps to `production_state:"ready_for_publish"` at `index.mjs:4522-4526`) |
| `ready_for_publish → submitted_for_admin_review` | Yes | `article-submit-page.js:1336` / `event-submit-page.js:737` → `POST /api/items/:id/submit-admin-review` (`index.mjs:13128`) |
| `submitted_for_admin_review → completed` | **Not located** in the `collector/` subsystem's public JS — no caller of a "completed" transition found in this pass. Not confirmed broken: this may legitimately live in the separate `admin/` subsystem, which was out of the grep scope used here (only `collector/server/public/*.js` and `collector/server/index.mjs` were searched) | n/a — needs a dedicated admin-subsystem pass to confirm either way |

Net: the one edge with a *confirmed* button-vs-behavior mismatch of the kind reported is
`ready_for_content → field_working` — not because the trigger is missing, but because the button
users reach for first ("เปิดงาน" on the actionable-work table) isn't it. `writing_assigned →
writing` has no dedicated trigger but that's already-documented-intentional (E). The other two
gaps (`analyzed → generated`, `submitted_for_admin_review → completed`) are **unconfirmed absences**,
not verified missing triggers — flagging as open questions, not findings, per the audit boundary
against asserting on unchecked ground.

---

## 4) ASSIGNMENT_UI_STATE_CONFIG — is `assigned` missing `reopen_in_progress`, or is it filtered for owner?

Not missing, and not filtered for owner.

`ASSIGNMENT_UI_STATE_CONFIG.assigned.stateActions` (`app.js:51-55`):
```js
assigned: Object.freeze({
  stateActions: [
    Object.freeze({ value: "reopen_in_progress", label: "เริ่มทำงาน" }),
    Object.freeze({ value: "close_assignment", label: "ปิดงาน" }),
  ],
```
`reopen_in_progress` is present, and listed first — `updateAssignmentActionControls`
(`app.js:4774-4780`) defaults the `<select>` to `stateActions[0]` when there's no prior selection,
so it pre-selects `reopen_in_progress` on open.

Role filtering happens in `filterAssignmentStateActionsForRole()` (`app.js:1013-1023`):
```js
function filterAssignmentStateActionsForRole(actions = []) {
  const rows = Array.isArray(actions) ? actions : [];
  if (!isStandardUser()) {
    return rows;
  }
  return rows.filter((row) => {
    const action = String(row?.value || "").trim().toLowerCase();
    const nextState = ASSIGNMENT_UI_ACTION_TO_STATE[action] || "";
    return nextState === "in_progress" || nextState === "revision_requested";
  });
}
```
The filter only *restricts* when `isStandardUser()` is true, and `isStandardUser()`
(`app.js:944-946`) is `currentRole() === "user"` only — `"owner"` returns `false`, so for owner the
function returns `rows` unfiltered; `reopen_in_progress` passes through untouched. (Note: even the
restrictive branch for role `"user"` would keep `reopen_in_progress`, since its mapped next state
`in_progress` is one of the two allowed values — so this filter wouldn't have dropped it for any
role in this config.)

Separately, `canPatchAssignmentState()` (`app.js:980-983`) gates the whole control
(`disabled` on select/button, `app.js:4780`/`4790`): `role === "owner" || "admin" || "user"` — owner
passes.

No condition in this pass filters `reopen_in_progress` out for owner. The control renders enabled
and pre-selected for state `assigned`.

---

## Summary (≤10 lines)

"เปิดงาน" (`app.js:9253`/`11446`) only calls `selectAssignment()` — no PATCH, ever; the real trigger
is a separate select+button pair (`index.html:550`/`569` → `app.js:9909` `updateAssignmentState()`)
that only becomes visible after opening. Page auto-load uses the exact same `selectAssignment()`
call (`app.js:9606-9698`, e.g. line 9657/9673/9683/9692) — so auto-open and manual "เปิดงาน" are
behaviorally identical no-ops on state, matching the reported symptom. `ASSIGNMENT_UI_STATE_CONFIG`
does list `reopen_in_progress` for `assigned` (`app.js:53`) and nothing filters it out for owner
(`app.js:1013-1023`, `944-946`, `980-983`) — the control is enabled and pre-selected. Full-ladder
scan found one other closed/intentional gap (`writing_assigned → writing`, already documented as
finding E) and two unconfirmed absences (`analyzed → generated`, `submitted_for_admin_review →
completed`) that need a dedicated pass, not asserted as bugs here.
