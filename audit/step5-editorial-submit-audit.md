# Step 5 editorial-submit audit: gate order and dead-path confirmation

Audit date: 2026-08-03. Read-only source inspection only. No endpoint was called, no file was
edited, no SQLite data was touched. Line numbers below are cited against
`collector/server/index.mjs` and `collector/db/repository.mjs` as they stand on branch
`runtime-audit/2026-08-02` (worktree `step5-ladder-forward-runtime`) at commit `c1dd22d`.

Scope note: this branch's worktree currently has `audit/step5-editorial-submit-survey.md` and
`audit/step5-round8-editorial-walk.md` **staged for deletion** (uncommitted). Those two files were
read via `git show c1dd22d:<path>` to get their last-committed text without disturbing that
in-progress, uncommitted change. This audit does not touch or restage them.

## 0. Correction to the framing of this task

The task states the prior survey "claims the handler writes the assignment to `submitted` at
`:9513-9618` first, then transitions at `:9634`" and that this contradicts the live result. Having
read `audit/step5-editorial-submit-survey.md` directly (§1, points 2-3), **that is not what the
survey says**. The survey's actual text:

> "The workspace route calls `ensureArticleProcessTransitionAccess` *before* it reaches its internal
> submission-writing block (`:9491-9496` before `:9511-9618`). For `ready_for_review`, that guard
> demands the editor already own an editorial assignment in `submitted` or `resubmitted`
> (`:4176-4182`) ... an editor with any of those pre-submit states is rejected at step 2 and cannot
> reach that block."

That is the gate-before-write order, and it already states the editor never reaches the write block.
The survey does not mention line 9634 at all. So the specific claim this task asked me to
confirm/refute does not match the survey document that exists in the repo — I'm flagging this rather
than silently treating the task's paraphrase as ground truth. Answering the three numbered questions
against the actual code below happens to reach the same conclusion the survey already reached, and
also happens to be independently corroborated by the live HTTP trace already recorded in
`audit/step5-round8-editorial-walk.md` (same commit), which used this exact scenario (item 9,
assignment #4, editor local id 10, `assigned`, draft body length 135, article-process `drafting`,
head `writing`/`draft`) and got the exact same 403 body quoted below.

## 1. Which line is the Thai error, what calls it, and is the write before or after the gate

**There are two different Thai 403 strings in this handler family, and the live 403 matches only one
of them.**

- `collector/server/index.mjs:4181` — inside `ensureArticleProcessTransitionAccess`
  (function `:4164-4185`):
  ```
  "editor ต้อง submit หรือ resubmit assignment ของตัวเองก่อนส่งบทความเข้าตรวจ"
  ```
  This fires when `role === "editor"`, `nextStatus === "ready_for_review"`, and
  `hasEditorialAssignmentAccess(req, item, allowedStates)` (`:4081-4092`) returns `false`, where
  `allowedStates = new Set(["submitted", "resubmitted"])` (`:4177`). `hasEditorialAssignmentAccess`
  requires the editor's **own** editorial assignment's `state` column to already be `submitted` or
  `resubmitted` (`:4090`).

- `collector/server/index.mjs:9620` — inside the `submit-review` handler itself, in the
  `else if (role === "editor")` branch (`:9619-9622`):
  ```
  "editor ต้องมี editorial assignment ที่พร้อม submit หรือ resubmit ก่อนส่งบทความเข้าตรวจ"
  ```
  This fires when the `.find()` at `:9513-9519` returns no eligible assignment (kind `editorial`,
  access via `hasAssignmentSubmissionAccess`, state in `{assigned, in_progress, revision_requested}`).

The live response body recorded in `audit/step5-round8-editorial-walk.md` (step 4) is:
```json
{"error": "editor ต้อง submit หรือ resubmit assignment ของตัวเองก่อนส่งบทความเข้าตรวจ"}
```
This is an exact match for **`:4181`**, not `:9620`. The task's own scenario text
("editor ต้อง submit หรือ resubmit assignment ของตัวเองก่อน...") is the `:4181` wording too — note
the missing "มี ... ที่พร้อม" that appears in `:9620`'s text.

**Call chain for the actual gate that fired:**
```
app.post(".../submit-review")          :9479
  -> ensureArticleProcessTransitionAccess(req, res, item, "ready_for_review")   :9495 (call site)
       -> function body                                                        :4164-4185
            -> hasEditorialAssignmentAccess(req, item, {submitted, resubmitted}) :4178
            -> res.status(403).json({ error: "...4181 text..." })              :4181
            -> return false                                                    :4182
  -> ensureArticleProcessTransitionAccess returned false -> handler returns    :9495-9497 ("return;")
```
Everything from `:9499` onward — including the `.find()` at `:9513-9519`, the write block at
`:9521-9618` (submission row, deliverable row, `repo.updateAssignmentState(..., "submitted", ...)` at
`:9609`), and the `transitionArticleProcessState(...)` call at `:9634` — **never executes** for this
request. The function returns at line 9497, three lines after the gate check at 9495, roughly 200
lines of source before it would even reach the `.find()` at 9513, let alone the write at 9609 or the
transition at 9634.

**Verdict: refuted (as a general claim about this codebase) / not applicable (as an attribution to
the survey document, which never made that claim).** The gate that produced the observed 403 is
strictly *before* any assignment write in this call — not after it, and not sequential with it at
all, because the function returns before reaching the write code. Whatever produced the "write
happens before the gate" framing does not match either the code or the survey document as committed.

## 2. Every code path that writes `content_assignments.state = 'submitted'` for `assignment_kind = 'editorial'`

`content_assignments.state` is written by exactly one SQL statement in the whole repo:
`collector/db/repository.mjs:3861-3874` (`UPDATE content_assignments SET state=?, ...`), reachable
only through `updateAssignmentStateInternal` (`repository.mjs:5653`) / `updateAssignmentState`
(`repository.mjs:5649-5651`). Grepping every call site of `repo.updateAssignmentState(` /
`updateAssignmentStateInternal(` across `collector/server/index.mjs` and narrowing to calls whose
`nextState` argument can be `"submitted"` gives exactly three call sites (all in
`collector/server/index.mjs`; no other subsystem — `backend/`, `admin/` — touches
`content_assignments` at all):

| # | Write call site | Endpoint | Role gate | Editor reachable for `assignment_kind='editorial'`? |
|---|---|---|---|---|
| 1 | `:9609` (`submissionState` = `"submitted"`/`"resubmitted"`, `:9538`) | `POST /api/items/:id/article-process/submit-review` (`:9479`) | `requireRole("owner","admin","editor","user")` (`:9479`); inner gate `hasAssignmentSubmissionAccess` (`:2685-2701`) + state must be in `{assigned, in_progress, revision_requested}` (`:9513-9519`) | Structurally yes for editor (own assignment, `assignmentKind==="editorial"` short-circuits `:2694`) — **but only if execution ever reaches `:9513`, which requires passing the `:4181` gate first (see §1 and §3).** |
| 2 | `:11211` (`nextState` from `req.body.state`/action alias, normalized against `ASSIGNMENT_STATES` which includes `"submitted"`, `repository.mjs:455`) | `PATCH /api/assignments/:id/state` (`:11159`) | `requireRole("owner","admin","user")` (`:11159`) — **no `editor` in the allow-list at all**; role `"user"` further restricted at `:11178` to `{revision_requested, in_progress, accepted}`, excluding `submitted` | **No.** Editor is rejected by the route middleware before the handler body runs. `ASSIGNMENT_ACTION_TO_STATE` (`:2820-2825`) has no action that maps to `"submitted"`, so even owner/admin must pass a raw `state:"submitted"` in the body — there is no dedicated "submit" action alias here. |
| 3 | `:11481` (`nextAssignmentState` = `"submitted"`/`"resubmitted"`, `:11480`) | `POST /api/assignments/:id/submissions` (`:11388`) | `requireRole("owner","admin","editor","freelance","user")` (`:11388`) at middleware, but handler body explicitly 403s `role === "editor"` at `:11401-11404` with `"editor should submit via article/event workspace flow only"` | **No.** Explicitly blocked in the handler body, independent of `assignment_kind` — this rejection is unconditional for `role==="editor"`, before any assignment or kind lookup happens. |

Two other call sites write non-`submitted` states and are out of scope for this question:
`:4193` (`revision_requested`), `:4228` (`in_progress`), `:10573` (`closed`), `:10688`
(`revision_requested`). A dev seed script (`collector/scripts/seed-mock-work-stage-jobs.mjs:435`)
also calls `updateAssignmentState(..., "submitted", ...)` directly against the repository layer, but
it is not an HTTP endpoint and carries no role gate — excluded from "reachable via endpoint" above.

## 3. Can an editor actually reach `submitted` in the current code? Dead path or untried branch?

**Dead path — confirmed, not merely untried.** This is structural, not a one-off data glitch:

- The *only* editor-reachable writer is path #1 in §2 (`:9609`, inside `submit-review`).
- Reaching `:9609` requires first passing the gate at `:9495` (→ `:4176-4182`), which for role
  `editor` + `ready_for_review` requires the editor's own editorial assignment to **already** be in
  state `{submitted, resubmitted}` (`:4177`, checked at `:4090`).
- The write at `:9609` only ever fires on an assignment whose state is in
  `{assigned, in_progress, revision_requested}` (`:9513-9519`) — the complement set.
- `{submitted, resubmitted} ∩ {assigned, in_progress, revision_requested} = ∅`. No single assignment
  state value can simultaneously satisfy the gate's precondition and the writer's eligibility
  condition. There is no sequencing that lets one editor-initiated call satisfy both, because the
  gate check and the writer are the same handler, in that fixed order, and the gate check that would
  need to be satisfied by a *prior* call is never satisfiable by any other editor-reachable code (see
  path #2 and #3 in §2, both of which structurally exclude `editor`).
- Consequently, if the editor's assignment somehow *were* already `submitted`/`resubmitted` (so the
  `:4181` gate passes), the `.find()` at `:9513-9519` would then find nothing eligible (its own
  eligible-states set excludes `submitted`/`resubmitted`), falling into the `:9619-9622` branch and
  producing the *second* 403 (`:9620`) instead. Either branch of the state space 403s for `editor`.
- `owner`/`admin`/`user` (with management-line access) are unaffected: they return `true` at
  `:4166-4171`, before the editor-only branch (`:4172-4182`) is even reached, so they can drive the
  same handler through the write block and the transition successfully. The dead path is scoped
  specifically to `role === "editor"` self-submission.

This matches the "big finding" pattern from the role-matrix audit: a role is nominally listed in
`requireRole(...)` for the route (`:9479` includes `"editor"`) and the UI is built to call this exact
endpoint (per the survey's §1, `article-workspace-page.js:2166-2180`, `event-workspace-page.js:990-1000`),
but no reachable sequence of calls lets that role complete the flow. It is corroborated live by
`audit/step5-round8-editorial-walk.md`, which ran precisely this scenario against a running instance
and stopped at this exact 403 with SQLite confirming assignment #4 stayed `assigned` with no
submission row created afterward.

No untried branch was found: §2's exhaustive enumeration of every writer of
`content_assignments.state = 'submitted'` shows all three call sites, and two of the three
structurally exclude editor at the role-gate/handler-body level (verifiable by reading the route
declarations and the explicit `role === "editor"` checks), independent of any specific assignment's
current state. There is no fourth path this audit could find in `collector/server/index.mjs`,
`collector/db/repository.mjs`, or `backend/`/`admin/` (neither of which reference
`content_assignments` at all).

## Prior-audit cross-reference

`audit/handoff-tracks-audit.md:71,85` (committed on `dev`, predates this branch's findings) already
documents this as a "lock" / "dead-end combination" — "editor cannot perform the review transition,
while the assignment must be submitted through its workspace flow first" — but frames "submit through
workspace flow" as if it were a distinct, viable step, without naming that the workspace flow *is*
this same endpoint and is the thing being blocked. That framing should be corrected if
`handoff-tracks-audit.md` is revisited: there is no separate "workspace flow" that submits the
assignment first: for editors, no such flow exists in current code.

## Files read

- `collector/server/index.mjs` (lines 2685-2701, 4081-4200, 4558-4620, 9479-9648, 11159-11225, 11380-11495)
- `collector/db/repository.mjs` (lines 455-457, 3840-3940, 5649-5658)
- `audit/step5-editorial-submit-survey.md` (via `git show c1dd22d:...`, staged-deleted in this worktree)
- `audit/step5-round8-editorial-walk.md` (via `git show c1dd22d:...`, staged-deleted in this worktree)
- `audit/handoff-tracks-audit.md`
