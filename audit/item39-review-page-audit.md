# Item 39 (More Moon) / Assignment #29 — tab=review audit

Read-only audit, Runtime machine. No code changes, no commits, no branches, no restarts.
Pipeline: audit-scanner (Layer 1) → audit-deep-reasoner (Layer 2) per bug, plus direct
read-only queries against `collector/data/collector.db` for ground truth.

## Ground truth (collector/data/collector.db, read via node:sqlite)

`content_assignments` id=29: `content_item_id=39`, `assignment_kind="field"`,
`state="revision_requested"`, `revision_round=2`, `latest_submission_id=13`,
`accepted_submission_id=13`, `accepted_handoff_snapshot_id=18`,
`image_reset_required=0`, `video_reset_required=0`,
`internal_note="reopened by backward workflow transition: ready_for_writer -> field_review"`,
`updated_at="2026-08-22 08:30:42"`.

`content_assignment_submission_deliverables`: 7 rows for `submission_id=13` (5 photos +
2 videos, all `status="submitted"`, created `2026-08-22 08:28:25`) — confirms the
finalized submission genuinely has 7 deliverables server-side.

`content_assets` (the raw upload/round-tagging table): all 7 rows tied to assignment 29
(ids 63-69) are tagged `assignment_round=1`. **Zero rows exist with `assignment_round=2`**,
even though `content_assignments.revision_round=2`.

---

## BUG 1 — upload/sync section shows 0 photos/0 videos after backward transition

**Status: PLAUSIBLE (medium-high confidence), root cause traced but not runtime-verified.**

Root cause: the review page's media display is fed by `state.assignments.deliverablesBundle`,
a client-side cache populated only when `loadAssignmentDeliverablesBundle()` runs for the
selected assignment. The backward-transition handler does not refresh this cache for the
reopened assignment.

- Display path: `collector/server/public/app.js:9278` `renderAssignmentReviewSubmissionContent()`
  → `app.js:4118-4207` `getAssignmentReviewMediaItems()` reads `state.assignments.deliverablesBundle`,
  returns empty-state text (`"ยังไม่มีรูปที่ส่งกลับล่าสุด"` / `"...วิดีโอ..."`, app.js:4131-4134,
  4194-4197) if the bundle is null/stale for this assignment.
- Refresh path (only source of truth): `app.js:9309` `loadAssignmentDeliverablesBundle()` →
  `GET /api/assignments/:id/deliverables/latest-bundle` → `repository.mjs:6353`
  `getLatestAssignmentDeliverablesBundle()` → `repository.mjs:6211-6278`
  `summarizeAssignmentDeliverables()`. **Backend logic is correct** — it filters purely by
  `assignment.latest_submission_id` and `isFulfilledAssignmentDeliverableStatus()`
  (`repository.mjs:464`, includes "submitted"), with no dependency on `assignment.state`. A
  fresh fetch for assignment 29 would correctly return all 7 deliverables right now.
- Missing trigger: the backward-transition handler `onTransition`
  (`app.js:3629-3649`) patches `state.items` (content item only) and calls
  `window.location.assign(result.resume_path)` **only if** `resume_path` differs from the
  current `pathname+search`. `resume_path` for this transition is
  `/?tab=review&item_id=${id}` (`server/index.mjs:4134`, via `placeBackwardTransitionResumePath`)
  — it has no `assignment_id`. If the reviewer triggers the transition while already on
  `/?tab=review&item_id=39` (the normal case), the strings match, no navigation happens, and
  nothing calls `selectAssignment()` / `loadAssignmentDeliverablesBundle()` for assignment 29 —
  so if that assignment's bundle wasn't already loaded this session, the panel keeps showing
  the empty state.
- Why re-clicking "fixes" it: there is no dedicated sync control inside
  `#assignment-panel-review`. The literal "ขั้นที่ 1: อัปโหลด/ซิงก์ไฟล์" button
  (`#btn-assignment-sync-upload`, `app.js:11486-11490` → `syncAssignmentSubmissionUploads()`,
  `app.js:10029-10070`) lives only inside `#assignment-panel-work` and never calls
  `loadAssignmentDeliverablesBundle()`. What actually repopulates the counts is re-selecting
  the assignment row (`table-assignments-review` → `"open-assignment"` action,
  `app.js:11380-11411` → `selectAssignment(id)`, `app.js:9201` → `app.js:9309`), which forces
  a fresh bundle fetch.

**Fix point:** single function, `app.js:3629-3649` (`onTransition`) — after a backward
transition resolves, unconditionally reload the deliverables bundle for the affected
assignment (or force `selectAssignment()`/re-render) instead of relying on the
`resume_path`-equality navigation check. UI-only patch (`app.js` + related test).

**Ruled out:** BUG2's work-panel content bleeding into the review panel — refuted with the
same CSS-isolation evidence as BUG2 below (`#assignment-panel-work` is `display:none` on
`pageMode==="review"`; a hidden ancestor cannot be worked around by inner-node class toggles).
One unrelated edge case found: `role==="freelance"` forces `pageMode="work"` even when
`tab=review` is requested (`app.js:417-420`, `988-999`), but backward transitions require
`owner/admin/user` role (`server/index.mjs:9144`), so this doesn't apply to the reported flow.

---

## BUG 2 — both "ขั้นที่ 2: ลงงาน" and "ขั้นที่ 3: ตรวจงาน" appear to render together

**Status: NOT CONFIRMED at the code level — likely false positive, or a stale/cached browser
bundle. Recommend a live browser check (hard refresh) before spending implementation time here.**

Traced the full render chain (`syncAssignmentPageMode()`, `app.js:4410-4517`; `getAssignmentWorkspaceLayout()`,
`app.js:3808-3877`; `syncAssignmentWorkflowLayout()`, `app.js:4558-4650`) against the current
DOM structure (`index.html`):

- `#assignment-panel-work` (index.html:490-666) and `#assignment-panel-review`
  (index.html:667-768) are separate, non-overlapping DOM subtrees since the sanctioned
  pageMode DOM split (see `audit/dom-split-plan.md`). Each panel-mode id
  (`assignment-state-workspace`, `assignment-submission-workspace`,
  `assignment-review-workspace`) appears exactly once in `index.html`, confirmed via grep —
  no duplicate markup.
- `syncAssignmentPageMode()` unconditionally sets exactly one of
  `assignment-panel-handoff|work|review` visible via `.hidden` toggle
  (`app.js:4481-4483`), and `getAssignmentPageMode()` (`app.js:988-1000`) always resolves to
  exactly one mode.
- `.hidden { display: none !important; }` (`styles.css:2310-2312`) is the only CSS rule
  governing these containers — no override exists anywhere in `styles.css` or `index.html`.
  A hidden ancestor removes the whole subtree from rendering regardless of any `is-active`/
  `is-collapsed` class churn happening on descendant nodes inside it.
- The `effectiveLayout` override in `syncAssignmentWorkflowLayout()` (`app.js:4564-4579`)
  only branches for `pageMode === "work"`; for `pageMode === "review"` this is a no-op by
  design (not a bug) because the ancestor panel-hide already handles isolation.

No route was found in current source where both sections are simultaneously un-hidden for
any role/state combination matching the reported scenario (owner/admin/user, `revision_requested`).
If this was genuinely observed live, the most likely explanations are (a) a cached/stale JS
bundle from before the DOM-split migration landed, or (b) the user's own bug-report numbering
("(2.2)"/"(2.3)") was shorthand for "the second and third thing I noticed," not literal
on-screen labels next to each other — worth clarifying directly.

**Adjacent (not a visible bug, but worth cleanup):** `getAssignmentWorkspaceLayout()` still
unconditionally computes/writes `stateTitle`/`submissionTitle`/`reviewTitle` text for all
three sections on every call (`app.js:4612-4617` region), even though `audit/dom-split-plan.md`
§C/Step 5 called for narrowing this function's scope post-split. Currently harmless because
the panel-hide masks it, but it's dead-code-adjacent scope creep from the migration that
wasn't finished.

---

## BUG 3 — sync 7/7 files, checklist passes, "ส่งงานกลับ" click does nothing; block message persists

**Status: CONFIRMED, high confidence. Three compounding issues.**

### 3a. Client checklist is round-blind, and round-2 assets genuinely don't exist yet

- `app.js:6934-6965` `getAssignmentServerSyncedAssetsForCaptureItems()` filters
  `state.assignments.assetLookup` only by `assignment_id`/surface/slot key — no round
  filter (comment at 6949-6950 explicitly assumes the server already scopes to "active" rows).
- `server/index.mjs:14597-14617` `GET /api/assets` computes
  `assignmentRound = resolveAssignmentCurrentRound(assignment)` (line 14615) but never passes
  it into the actual row fetch, `listActiveAssignmentWorkAssetRows({ assignmentId })` (line 14617).
- `server/index.mjs:5914-5960` `listDraftAssignmentWorkAssetRows()` only adds the
  `ca.assignment_round=?` clause `if (assignmentRound > 0)` (5924-5927) — since the caller
  never passes it, rows from every round are eligible.
- `repository.mjs:2824-2858` `resolveActiveAssignmentWorkBatchRows()` groups by
  `(slotKey, mediaType)` and keeps the highest `assignment_round` **found within that group**
  — it is not a global "matches current round" filter. Ground truth confirms this actually
  bites here: all 7 `content_assets` rows for assignment 29 are `assignment_round=1`, so the
  "active batch" the client trusts is round-1 data, and the client has no way to notice this
  doesn't match `revision_round=2`.
- Root cause of the round mismatch: `content_assets` rows are tagged with a round number only
  at upload/chunk-finalize time and are never retroactively retagged when `revision_round` is
  bumped or when a field assignment is reopened by a backward transition. The reopen handler
  (`server/index.mjs`, `fromProductionState==="ready_for_writer" && target.production_state==="field_review"`)
  only calls `repo.updateAssignmentState(assignment.id, "revision_requested", ...)` — a pure
  state flip that touches nothing in `content_assets`. Since `image_reset_required=0` and
  `video_reset_required=0`, no fresh upload was ever required, so no round-2 rows were ever
  created — the checklist's "pass" is real (round-1 assets do exist) but doesn't match what
  the server's submit gate demands.

### 3b. Server's submit gate strictly requires current-round assets, with no fallback

- `server/index.mjs:11348-11364` — `resolveAssignmentCurrentRound(assignment)` = 2, then
  `repo.listAssignmentRoundAssetsByType(assignmentId, 2, "image"|"video")`
  (11355-11356); combined count is 0 (all assets are round=1) → returns `409` with
  `"บล็อกการส่งงาน: ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง"` (11359-11364).
- `repository.mjs:5697-5715` / SQL at `repository.mjs:3859-3878`:
  `WHERE ca.assignment_id=? AND ca.assignment_round=? AND ...` — strict equality, no fallback.
- Contrast: `repository.mjs:6066-6075` `isLatestActiveAssignmentWorkAsset()`, used when
  actually linking deliverables, uses the lenient `resolveActiveAssignmentWorkBatchRows()`
  logic instead of strict round match. The submit gate and the deliverable-linking logic use
  two different definitions of "the assets that count." `image_reset_required`/
  `video_reset_required` exist to express "no new media needed this round" but are only
  consulted *after* the gate (11402-11409), never to relax it.
- This gate (strict round match, no reset-flag fallback) is not a recent regression — it was
  introduced whole in an earlier commit ("Tighten assignable scope and block empty
  submissions") and predates this incident.

### 3c. The 409 is delivered, but lands far from where the user is looking — hence "nothing happens"

- `app.js:11475-11484` click handler for `btn-assignment-submit` does reach the server: the
  client gate wrongly passes (3a), so `createAssignmentSubmission()` (`app.js:10120-10162`)
  proceeds past its own pre-flight check (10142-10150) to `await api(...)` (10159-10162).
  `api()` (`app.js:1063`) throws the 409's `error` text, caught at 11475-11484, and written via
  `setStatus("assignment-status", err.message, true)` — **the error is not silently swallowed.**
- But `#assignment-status` (`index.html:527`) sits near the **top** of `#assignment-panel-work`,
  next to the "1.1 โหลดงานในกระบวนการนี้" queue-load toolbar — while the submission checklist
  and `btn-assignment-submit` button (`index.html:595-651`) are ~70-120 lines further down,
  where the user is actually scrolled to. `setStatus()` (`app.js:1071-1082`) only sets
  text/classes, no scroll-into-view. Compare: the pre-flight client-gate-block path *does*
  call `focusFirstAssignmentSubmissionGateIssue()` (`app.js:10148`) to scroll to the failing
  item — but the server-rejection catch branch (11475-11484) has no equivalent call. So the
  "งานที่ฉันต้องทำ"/block-message text the user reports seeing "still up" is the live,
  correct result of their own click — just off-screen, not stale leftover state.

**Fix points — two separate concerns, do not combine into one patch:**
- **Validation-only patch** (`repository.mjs` / `server/index.mjs`): decide and implement a
  consistent round-resolution rule shared by the submit gate and deliverable-linking logic —
  either retag/carry forward `content_assets.assignment_round` when a backward transition
  reopens an assignment with `image_reset_required=0`/`video_reset_required=0`, or have the
  submit gate at `server/index.mjs:11348-11364` fall back to `resolveActiveAssignmentWorkBatchRows()`
  semantics instead of strict `assignment_round` equality. This is a product decision (should
  a no-reset-required round be submittable on last round's media, or must the client be told
  to re-upload?) — flagging for the user/implement step, not deciding here.
- **UI-only patch** (`app.js`): pass the server's `assignmentRound` through on the `GET
  /api/assets` call (or otherwise make the client checklist round-aware) so it doesn't
  falsely report "ready to send," AND add a scroll-into-view / re-focus call to the
  server-rejection catch branch at `app.js:11475-11484`, mirroring `focusFirstAssignmentSubmissionGateIssue()`.

---

## Can all 3 be fixed in one round/branch?

**No — recommend at minimum 3 separate patches, possibly across 2 branches:**

1. **BUG1 fix** — UI-only, single function (`app.js:3629-3649`). Independent of the others.
2. **BUG3 fix** — must itself be split per this repo's patch discipline ("do not mix UI and
   validation changes in the same patch"): one validation-side patch (round-resolution
   consistency, `repository.mjs`/`server/index.mjs`) and one UI-side patch (round-aware
   client checklist + scroll-to-error, `app.js`). The validation patch needs a product
   decision first (see 3b) before implementation starts.
3. **BUG2** — do not implement anything yet. No confirmed code defect exists; needs a live
   browser reproduction (hard refresh, confirm role/tab/state at the moment of the report)
   before deciding whether there's anything to fix at all.

BUG1's fix and BUG3's UI-side fix both touch `app.js` and could plausibly land in the same
UI-only commit if the user wants; BUG3's validation-side fix should not be bundled with either,
per the repo's own "Validation-only patch → repository.mjs... do not mix UI and validation" rule.
