# Step 1C — `content_assets.assignment_slot_key`

Verdict: **dead current DB code; remove the code that uses the column.** Do not add it back to `schema.sql`.

## 1. Whole-repo grep

Current exact-token grep (`assignment_slot_key` or `slot_key`, excluding `.git`/`node_modules`) found **44 lines**:

- **9 server lines**, all in `collector/server/index.mjs`:
  - `3323`, `3341`: read `slot_key` from an incoming/in-memory asset payload; this is not a DB column access.
  - `3399`, `3645`: read `row.assignment_slot_key` as a JavaScript property.
  - `3422`, `3547`, `3660`: write/return `slot_key` in in-memory diagnostic/readiness objects.
  - `3434`, `3672`: write `assignment_slot_key` into in-memory response/readiness objects.
- **32 test lines**, only in `collector/tests/assignment-work-asset-row.test.mjs` (137, 217, 222, 227, 314, 319, 324, 329, 360, 366, 372, 388, 417, 433, 459, 466) and `collector/tests/revision-asset-retention.test.mjs` (113, 175, 199, 228, 235, 260, 266, 294, 322, 350, 360, 393, 434, 439, 488, 493). They supply `slot_key` fixture/payload values; none references `assignment_slot_key` as a SQL column.
- **3 audit-report lines**: `audit/step1-boot-helper-survey.md:58` and `audit/step1b-repository-helper-survey.md:111,129`; no executable meaning.
- **0** in current `collector/db`, `collector/services`, `collector/scripts`, `backend`, `frontend`, `schema.sql`, migrations, or client/repository helpers.

## 2. Read/write and reachability

The four cited `assignment_slot_key` lines are not SQL reads/writes:

| Lines | Code path | Actual behavior |
| --- | --- | --- |
| `3399`, `3434` | `resolveCurrentRoundEligibleAssignmentMediaAssets` | Reads a JS property, then returns it in an in-memory asset object. The function first returns at `3361-3367` unless `repo.listAssignmentWorkAssetRows` exists. `createRepository()` exposes no such method (grep found no definition). |
| `3645`, `3672` | `evaluateLatestAssignmentSubmissionCaptureTopicReadiness` | Reads/returns a JS property only while iterating `workRows`. It obtains `workRows` from the same absent method at `3627-3629`, so current runtime uses `[]` and cannot reach the property access. |

Neither outer readiness function has a caller outside its own local helper chain: grep finds only declarations/internal calls. They are not attached to an endpoint. In contrast, generic payload `slot_key` is live: `enforceAssignmentSubmissionRequiredFields` reaches `findMissingCapturePrompts`, via `POST /api/assignments/:id/submissions` at `server/index.mjs:11674-11747`. That path reads payload `slot_key` but never stores or queries `content_assets.assignment_slot_key`.

## 3. Behavior without the column

No current SQL string references `assignment_slot_key`; therefore SQLite does **not** throw a missing-column error in current code. If code executed one of the four stale JS property reads against a row without that column, JavaScript evaluates it as `undefined`, normalizes it to `""`, and reports `slot_missing` (`3408`/`3654`), not an SQL error. Current execution does not reach those reads because the repository method is absent.

SQLite would throw `no such column: assignment_slot_key` immediately only if a SQL `SELECT`/`INSERT`/`UPDATE` named it. That was true historically, but is not true in the current checkout.

## 4. Historical and DB evidence

- Dev DB has the legacy column (`TEXT`, nullable), **304** `content_assets` rows, and **0** rows with a non-empty value.
- `git log -S assignment_slot_key --oneline --all` returns 13 historical commits. The introducing commit was `aee08e4 Preserve assignment capture slot metadata`; its diff added the column to `schema.sql` and added `ALTER TABLE ... ADD COLUMN` to `ensureContentAssetWorkflowColumns`. Both are absent now.

## Single proposal

**Remove the code that uses `content_assets.assignment_slot_key`** (the unreachable property/response code), while retaining the live request-payload `slot_key` logic. Evidence for a schema addition is insufficient and contradicted by the current runtime: there is no current SQL producer/consumer, no repository API feeding the stale path, no caller for the readiness functions, and no populated dev data.
