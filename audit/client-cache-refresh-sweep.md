# Audit: client-side cache-refresh sweep — Assignment Work / Review (app.js)

Mode: read-only, discovery. No code changed, no test/gate run, no commit/branch/push
performed by this pass. Pipeline: `audit-scanner` (Layer 1) → `audit-deep-reasoner`
(Layer 2), per this repo's audit skill contract.

Bug family: an action succeeds on the server, but the client-side cache/state that
feeds the UI is never refreshed afterward, so the screen keeps showing stale data.
Two known instances already existed in `collector/server/public/app.js`:
- `onTransition` backward transition (fixed, merged) — missing `deliverablesBundle` reload.
- `syncAssignmentSubmissionUploads` (not yet fixed) — missing `assetLookup` reload.

This sweep looked for every other instance of the same family in the same file.

## 1. `state.assignments` cache fields and their loaders

| Field | Loader(s) | File:Line |
|---|---|---|
| rows, managedRows, submittedRows | `refreshAssignments()` | app.js:9565-9567 |
| deliverablesBundle | `loadAssignmentDeliverablesBundle()` | app.js:9768 |
| assets, assetLookup | `loadAssignmentAssets()` | app.js:9799-9801 |
| latestSubmissionRows | `loadAssignmentSubmissions()` | app.js:9745 |
| workLatestComment | `loadAssignmentLatestWorkComment()` | app.js:4395 |
| contextFieldPack, contextAssignments | `loadAssignmentContextFieldPackStatus()` | app.js:3693-3708 |
| handoffSourcePackages | `loadAssignmentRequestedCheckHandoffSource()` | app.js:3746 |
| backwardTransitions | `refreshAssignmentBackwardTransitions()` | app.js:3657 |
| selectedId, captureUploadDrafts, captureUploadLoading, captureUploadSyncState | set directly (not server-loaded) | — |

`selectAssignment()` (app.js:9202) is the reset point: it clears `deliverablesBundle`,
`assets`, `assetLookup` (app.js:9265-9268) and re-spawns every loader above
(app.js:9300-9330). Any mutating action that doesn't otherwise refresh a field is
"self-healed" the next time `selectAssignment()` runs on the same id — which matters
for severity below.

## 2. Server-mutating actions inventoried

| Action | File:Line | Endpoint |
|---|---|---|
| `onTransition()` backward transition | app.js:3631-3649 | POST `/api/items/:id/workflow/backward-transitions` |
| `createAssignmentSubmission()` | app.js:10121-10199 | POST `/api/assignments/:id/submissions` |
| `createAssignmentDeliverable()` | app.js:10201-10237 | POST `/api/assignments/:id/submissions/:id/deliverables` |
| `syncAssignmentSubmissionUploads()` → `uploadAssignmentSubmissionFiles()` | app.js:10030-10071 / 9930 | POST `/api/assignments/:id/assets/upload(s)` |
| `applyAssignmentReviewDecision()` | app.js:9388-9426 | PATCH `/api/assignments/:id/state` |
| `returnSelectedAssignmentToField()` | app.js:9456-9488 | POST `/api/assignments/:id/return-to-field` |
| `updateAssignmentState()` | app.js:9835-9867 | PATCH `/api/assignments/:id/state` |
| `deleteAssignmentSubmissionServerDraft()` | app.js:1301-1311 | DELETE `/api/assignments/:id/draft` |
| Table reopen listeners | app.js:11394-11398, 11428-11432 | PATCH `/api/assignments/:id/state` |

## 3. Refresh-present/absent table (full inventory)

| Action | Should refresh | Refreshes? | Evidence |
|---|---|---|---|
| `onTransition()` backward | deliverablesBundle | **Present** | `loadAssignmentDeliverablesBundle()` at app.js:3648 — confirmed sufficient, see §4 |
| `createAssignmentSubmission()` | rows, deliverablesBundle, assets | Present (errors swallowed, see §4) | app.js:10183, 10185, 10186 |
| `createAssignmentDeliverable()` | rows, submissions, deliverablesBundle, assets | Present | app.js:10225-10228 |
| `syncAssignmentSubmissionUploads()` | assetLookup | **ABSENT** | no `loadAssignmentAssets()` call anywhere in app.js:10030-10071 |
| `applyAssignmentReviewDecision("request_revision")` | rows (deliverablesBundle/assets indirectly) | Present, indirectly | `refreshAssignments({preserveSelection:true})` at app.js:9424 transitively re-runs `selectAssignment()`, which unconditionally reloads assetLookup/deliverablesBundle — see §4 |
| `returnSelectedAssignmentToField()` | rows | Present | app.js:9483, 9486 |
| `updateAssignmentState()` | rows | Present | app.js:9865 |
| `deleteAssignmentSubmissionServerDraft()` | none (draft only, no server-persisted asset change) | N/A | — |
| Table reopen listeners | rows | Present | app.js:11398, 11432 → `selectAssignment()` |

## 4. Verified findings

### Finding 1 — CONFIRMED, BLOCKING: `syncAssignmentSubmissionUploads()` never refreshes `assetLookup`

- **File:Line:** app.js:10030-10071 (missing call); reads land in
  `getAssignmentServerSyncedAssetsForCaptureItems()` app.js:6935-7049 (reads
  `assetLookup` at 6949) → `buildAssignmentSubmissionGateState()` app.js:7617-7711
  (`expiredBlocking` at 7636, checklist item `not_expired` at 7686-7690). Only writer
  of `assetLookup` is `loadAssignmentAssets()` (app.js:9780-9799); it is never called
  from the sync path.
- **Root cause:** After a successful upload, results are cached only into
  `state.assignments.syncedUploadAssetsByKey`/`latestUploadedAssets`
  (`markAssignmentCaptureUploadsSynced`, app.js:7237-7248). The "sync files not
  expired" checklist item is computed from the older, un-refreshed `assetLookup`
  array instead, comparing browser `Date.now()` against a `created_at` that predates
  this sync. If the slot had an earlier, now-superseded (and now actually expired)
  batch, `expiredBlocking` stays `true` forever for that tab.
- **User-visible failure:** `createAssignmentSubmission()` checks `gateState.canSubmit`
  **before calling the API** (app.js:10143-10151) and throws locally — the submit
  request is never even sent. The submit button/flow is blocked indefinitely until
  the user forces a reselect/reload (which calls `loadAssignmentAssets()` fresh).
  This is corroborated by a prior live-DB investigation in this repo,
  `audit/sync-expiry-check-audit.md`, which reproduced this exact symptom against
  assignment #29 / item 39 and confirmed the server's own copy of the data was fine
  (round-2 assets ~8 minutes old) — the block was purely client-cache staleness.
- **Severity: BLOCKING.**

### Ruled out (false positives from Layer 1 triage)

- **app.js:3631-3649 (`onTransition` backward transition):** Traced the endpoint
  (`collector/server/index.mjs:9144-9287` → `repo.updateAssignmentState`/
  `upsertWorkflowModel`, `collector/db/repository.mjs:5561-5668`) — confirmed no
  `content_assets` table access anywhere in this path. Backward transition changes
  workflow/assignment state only, not raw assets, so the existing
  `loadAssignmentDeliverablesBundle()` call is sufficient. The already-merged fix is
  complete; no gap remains here.
- **app.js:9388-9426 (`applyAssignmentReviewDecision`, `request_revision`):**
  `request_revision` with `image_reset_required`/`video_reset_required` does delete
  server-side assets (`PATCH /api/assignments/:id/state` → `index.mjs:11050-11117` →
  `repo.requestAssignmentRevisionWithReset`, `repository.mjs:5717-5778` →
  `deleteAssignmentWorkAssetsByType`). But `refreshAssignments({preserveSelection:true})`
  (app.js:9424) transitively calls `selectAssignment()` in every branch — either
  re-selecting the same id (which unconditionally clears+reloads `assetLookup`/
  `deliverablesBundle`, app.js:9267-9268, 9310-9320) or deselecting entirely
  (app.js:9600-9621) if the item left the reviewer's queue. Either path avoids
  showing stale post-reset media. No gap.

### Adjacent, lower-priority: swallowed refresh errors

`app.js:10183`, `:10185`, `:10186` (`createAssignmentSubmission`) wrap
`refreshAssignments()`/`loadAssignmentDeliverablesBundle()`/`loadAssignmentAssets()`
in bare `.catch(() => {})` with no toast/log. If one throws right after a successful
submission, the user sees a success message while the corresponding local cache
stays at pre-submission values with no signal that refresh failed.

- **Severity: TRANSIENT, not blocking.** For the common case (role can patch
  assignment state), a `window.location.assign` full-page navigation follows
  immediately (app.js:10190-10197), which supersedes any stale in-memory state
  regardless. For the rare non-navigating path, staleness self-corrects on the next
  `selectAssignment()`/`refreshAssignments()` call, and the submit button is
  independently hard-disabled via direct DOM mutation (app.js:10166-10167), so no
  double-submit risk either way.
- **This is not isolated to this function** — it's an established convention. The
  same `.catch(() => {})` pattern after these same loaders appears at 6 sites total:
  app.js:3648 (the already-merged `onTransition` fix), 10183, 10185, 10186, 10228
  (`createAssignmentDeliverable`), and 11354. Treating this as a real defect would
  mean a separately-scoped "surface refresh errors to the user" patch across the
  whole file, not a fix folded into Finding 1.

## Severity summary

| Finding | Severity | Blocks user? |
|---|---|---|
| `syncAssignmentSubmissionUploads()` missing `loadAssignmentAssets()` | BLOCKING | Yes — submit gate stays failed indefinitely until manual reselect/reload |
| `createAssignmentSubmission()` swallowed refresh errors (6 sites file-wide) | TRANSIENT | No — self-corrects via navigation or next natural reselect; not scoped to this sweep's target function |

## Fix-together vs. fix-separately

**One real bug found** (Finding 1), so there's no meaningful "shared helper vs.
bespoke" tradeoff to weigh in practice — but for completeness:

- A shared helper (e.g. `refreshAssignmentWorkCaches(id)` calling both
  `loadAssignmentAssets()` and `loadAssignmentDeliverablesBundle()`) would prevent
  this exact class of omission at *future* call sites, since both already-fixed and
  still-broken instances were missing one of that same pair.
- But not every mutation needs both loaders — `onTransition` genuinely only needs
  deliverables; forcing an unconditional asset refetch there adds an unneeded
  `/api/assets` round-trip. Introducing a new shared abstraction and rewiring
  multiple existing call sites also cuts against this repo's CLAUDE.md freeze rules
  ("one concern per patch," "do not refactor the renderer wholesale").
- **Recommendation:** bespoke, single-line fix at the one broken site —
  `loadAssignmentAssets({ showStatus: false })` added to
  `syncAssignmentSubmissionUploads()` (app.js:10030-10071), mirroring the identical
  call already used after submit at app.js:10186. This is a UI-only change
  (`app.js`), fits the "UI-only patch" allowlist in CLAUDE.md, and matches the fix
  already proposed independently in `audit/sync-expiry-check-audit.md`.

## Method note

Layer 1 (`audit-scanner`) flagged 5 candidates. Layer 2 (`audit-deep-reasoner`)
traced each into its actual endpoint/repository code and confirmed 1 real BLOCKING
bug, ruled out 2 as false positives (refresh happens transitively via
`selectAssignment()` or isn't needed at all), and downgraded 2 (the swallowed-catch
sites) to a separately-scoped, TRANSIENT, non-blocking, repo-wide convention rather
than a defect specific to this sweep's target.
