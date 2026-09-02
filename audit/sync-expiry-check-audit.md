# Audit: "ไฟล์ซิงก์ยังไม่หมดอายุ" ค้าง 4/5 หลัง sync สำเร็จ — assignment #29 / item 39

Mode: read-only investigation (code + live `collector.db` read-only query). No code changed,
no test/gate run. Branch `audit/sync-expiry-check-2026-08-24`, not merged.

## TL;DR root cause

The expiry check is **entirely client-side** and reads a **stale in-memory cache**
(`state.assignments.assetLookup`) that is never refetched after a successful sync in the
"local files selected → upload" path. `checklist[3]` ("ไฟล์ซิงก์เป็นชุดล่าสุด") and
`checklist[4]` ("ไฟล์ซิงก์ยังไม่หมดอายุ") read from two *different* data sources inside the
same `buildAssignmentSubmissionGateState()` call — one from the just-uploaded response
(fresh), one from the stale cache (old) — so they disagree right after a sync that actually
succeeded.

- File: `collector/server/public/app.js:10030-10071` (`syncAssignmentSubmissionUploads`)
- File: `collector/server/public/app.js:7617-7711` (`buildAssignmentSubmissionGateState`)
- Field compared wrong: `state.assignments.assetLookup` (not refreshed) vs. the DB's actual
  `content_assets.created_at` (refreshed correctly by the server on every sync)

---

## Q1 — Where is "ไฟล์ซิงก์ยังไม่หมดอายุ" computed, what's compared, what's the threshold?

**Client-side**, in `getAssignmentServerSyncedAssetsForCaptureItems()`:

- `collector/server/public/app.js:6925` — `const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;` (24 hours)
- `collector/server/public/app.js:6946` — `const nowMs = Date.now();` (browser clock at render time)
- `collector/server/public/app.js:6975-6981`:
  ```js
  const createdAtMs = Date.parse(String(row?.created_at || ""));
  if (Number.isFinite(createdAtMs) && createdAtMs > 0 && (nowMs - createdAtMs) >= ASSIGNMENT_WORK_SYNC_EXPIRY_MS) {
    expiredRows.push(row);
    return;
  }
  activeRows.push(row);
  ```
  `row.created_at` comes from `row` in `assignmentRows`, itself filtered out of
  `state.assignments.assetLookup` (`app.js:6949-6957`).
- Result flows into `expired_count`/`assets.length` (`app.js:7041-7048`), then into
  `expiredBlocking` in the gate builder:
  `collector/server/public/app.js:7636`:
  ```js
  const expiredBlocking = Number(serverSynced?.expired_count || 0) > 0 && Number(serverSynced?.assets?.length || 0) === 0;
  ```
  and checklist item `not_expired` at `app.js:7686-7690`.

So: compares **browser `Date.now()`** against **`content_assets.created_at`** (as last fetched
into `state.assignments.assetLookup`), threshold **24h**. Nothing here calls the server for a
live "now" — the comparison is done entirely with data already sitting in the tab.

There is a **server-side mirror of the same 24h rule** — see Q5 — but it does not feed this
checklist item at all; it deletes rows out from under the client instead.

## Q2 — Is the compared timestamp rewritten when "ขั้นที่ 1: อัปโหลด/ซิงก์ไฟล์" is pressed?

Yes, on the **server/DB side** — but the client never re-reads it, which is the bug.

Trace from the button:
1. Click handler: `collector/server/public/app.js:11487-11496` → `syncAssignmentSubmissionUploads()`
2. `collector/server/public/app.js:10030-10057` — when there's a local file queue (the case in
   this report — filenames actually changed, i.e. new files were selected and synced):
   - `10050` creates a fresh `syncBatchId`
   - `10051` `uploadedAssets = await uploadAssignmentSubmissionFiles(...)` — does the actual
     upload (`app.js:9930-10028`), hitting
     `POST /api/assignments/:id/assets/upload` (non-chunked) or the chunked
     start/chunks/finalize trio.
   - Server insert: `collector/server/index.mjs:15207`:
     ```
     INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover,
       placement_type, sort_order, assignment_id, assignment_round, assignment_media_type,
       assignment_surface, assignment_sync_batch_id) VALUES (..., 0, ?, ?, ?, ?, ?)
     ```
     `created_at` is **not** in the column list, so SQLite applies the column default —
     `collector/database/schema.sql:158`: `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`.
     **This does get a brand-new timestamp on every sync.** Confirmed against live data (Q4).
   - `10052` `markAssignmentCaptureUploadsSynced(...)` caches the response in
     `state.assignments.syncedUploadAssetsByKey` / `state.assignments.latestUploadedAssets`
     (`app.js:7237-7248`).
   - `10053-10056` re-renders the file list and gate panel from **that in-memory response** —
     **there is no call to `loadAssignmentAssets()` anywhere in this function.**

Compare with the only 4 call sites of `loadAssignmentAssets()` in the whole file
(`app.js:9316, 10186, 10228, 11514`) — none is inside `syncAssignmentSubmissionUploads()`. It's
called on initial assignment selection (`9316`), after a full submit (`10186`), after adding a
deliverable (`10228`), and on the manual "โหลด" button (`11514`) — never after a sync.

So `state.assignments.assetLookup` (the array `getAssignmentServerSyncedAssetsForCaptureItems`
reads `created_at` from) is **not** touched by the sync button at all. It keeps whatever was
fetched the last time the assignment was (re)selected/reloaded — i.e., it compares against a
`created_at` value from *before* this sync, which explains "ค้างตลอด" exactly as suspected in
the report.

## Q3 — Item 3 (sync_current) passes, item 4 (not_expired) fails — same source or different?

**Different sources**, both computed inside `buildAssignmentSubmissionGateState()`
(`app.js:7617-7711`) from the same `composeAssignmentSubmissionEffectiveAssets()` call
(`app.js:7107-7203`), which itself calls `getAssignmentServerSyncedAssetsForCaptureItems()`
once (`7116`) — but the two checklist items don't consume the same slice of its output:

- **`sync_current`** (`app.js:7681-7684`) — `status: !composed?.blockedMessage`. When a local
  queue exists and was already synced (this case), `composed` takes the branch at
  `app.js:7144-7202`, which builds `mergedAssets` from `localSyncedAssets` — i.e. from
  `getSyncedUploadAssetsForKey(syncKey)` / `state.assignments.latestUploadedAssets`
  (`app.js:7144-7147`). **This is the fresh, just-uploaded response** cached by
  `markAssignmentCaptureUploadsSynced` a moment earlier. No `blockedMessage` is set on this
  path (`7195-7202` returns cleanly), so item 3 passes correctly.
- **`not_expired`** (`app.js:7686-7690`) — `status: !expiredBlocking`, and `expiredBlocking`
  (`7636`) is derived from `serverSynced` = the *same* `getAssignmentServerSyncedAssetsForCaptureItems()`
  result from `7116`, which is **always** computed straight off `state.assignments.assetLookup`
  (`app.js:6949`) — the stale cache from Q2, completely independent of the local-queue branch
  that item 3 uses.

So item 3 is answered from "what did the server just hand back for this upload" (fresh), item 4
is answered from "what does the last full asset-list fetch say" (stale). They read the same
`assignmentId`/`captureItems` but two structurally different arrays, and only one of them gets
refreshed by the sync button.

## Q4 — Actual values for assignment #29 right now

Assignment row (`content_assignments`, id=29):
```
state: revision_requested, revision_round: 2, latest_submission_id: 13
created_at: 2026-08-22 08:21:27, updated_at: 2026-08-22 08:30:42
```

`content_assets` rows with `assignment_id=29 AND assignment_surface='assignment_work'`
(14 rows total, two batches):

| round | batch (suffix) | files | `created_at` (UTC) | age vs. now (2026-08-24 04:13 UTC) |
|---|---|---|---|---|
| 2 | `...-20260824...` | 7 (ids 70-76) | `2026-08-24 04:05:00`–`04:05:04` | **~8 minutes** — not expired |
| 1 | `...-20260822...` | 7 (ids 63-69) | `2026-08-22 08:22:58`–`08:23:04` | **~44 hours** — expired (>24h) |

`resolveActiveAssignmentWorkBatchRows()` (`collector/db/repository.mjs:2824-2858`) groups rows
by `slotKey|mediaType` and picks the batch with the highest `(assignment_round, id)` — so for
every one of the 7 slots, round 2 (higher round) wins over round 1. That means a **correct,
live** re-fetch of `GET /api/assets?assignment_id=29` returns only the 7 round-2 rows, all
~8 minutes old — `expired_count` would be `0` and this checklist item would pass.

The reason it currently shows expired in the browser is that `state.assignments.assetLookup`
in that tab still holds whatever was fetched **before** this round-2 sync (i.e., it still
carries round-1 rows, ~44h old, with none of the round-1 slots superseded in the client's
own copy of the array) — `expired_count > 0` and `assets.length === 0` for those stale rows
→ `expiredBlocking = true`. This is a client-cache staleness bug, not a real data problem:
the DB itself is fine.

(Query used: `collector/data/collector.db`, opened `readOnly: true` via `node:sqlite`,
matching the pattern in the pre-existing `collector/temp_query.mjs`.)

## Q5 — Does this block only the client button, or does the server also block?

Both — but they are **not the same mechanism**, and only the client one is currently
misbehaving:

- **Client**: `expiredBlocking` (`app.js:7636`) feeds `blockingReasons` (`app.js:7652-7654`),
  which sets `gateState.canSubmit = false` (`app.js:7699`). `createAssignmentSubmission()`
  checks this **before calling any API** (`app.js:10148-10151`) and throws locally — the
  `POST /api/assignments/:id/submissions` request is never sent. This is the block the user
  is hitting.
- **Server**: `POST /api/assignments/:id/submissions` (`collector/server/index.mjs:11299`)
  independently runs the *same* 24h rule via `cleanupExpiredAssignmentWorkDraftAssets()`
  (`index.mjs:11348-11353`, same `ASSIGNMENT_WORK_SYNC_EXPIRY_MS` constant at `index.mjs:5899`)
  before checking `activeDeliverablesCount < 1` (`index.mjs:11354-11364` — this is the
  "ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง" gate already fixed on `fix/submit-gate-active-batch`).
  This server check runs a **fresh DB query every request**, so it does not suffer from the
  client's staleness problem — if the client block were bypassed/removed, the round-2 batch
  (7 active, non-expired assets) would satisfy this server-side check and the submission would
  go through.

So: the immediate symptom is a **client-only false block**; the server's redundant expiry
enforcement is correct and unaffected (it would pass right now for assignment #29's real data).

---

## What needs to change (not applied in this pass)

Single fix point, client-only: `syncAssignmentSubmissionUploads()`
(`collector/server/public/app.js:10030-10071`) needs to refresh
`state.assignments.assetLookup` (i.e. call `loadAssignmentAssets({ showStatus: false })`, the
same call already used after submit at `app.js:10186`) after a successful upload, before
`buildAssignmentSubmissionGateState()` is rebuilt for the post-sync render at
`app.js:10054`/`10063`. That refetch would pick up the server's already-correct round-2 batch
and clear `expiredBlocking` without needing a page reload.

This is a UI-only fix (`app.js`) — no `repository.mjs`/API/payload-shape change needed, so it
fits a single patch under the project's "one concern per patch" rule.
