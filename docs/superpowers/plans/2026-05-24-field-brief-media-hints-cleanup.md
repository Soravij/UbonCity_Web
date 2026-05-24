# Field Brief Media Hints Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `field-brief` use `media_hints` as the post-handoff image source-of-truth, then hard-delete AI input images after assignment creation succeeds without breaking downstream surfaces.

**Architecture:** First decouple `field-brief` from `content_assets?only_selected=1` by ensuring every selected `media_hint` carries a stable URL and rendering only from `fieldPack.media_hints`. Then add a narrow post-assignment cleanup that deletes AI input images while preserving assignment work files and anything still referenced by `field_pack_media_hints`.

**Tech Stack:** Node.js, Express, SQLite, Better-SQLite3, vanilla JS frontend

---

### Task 1: Freeze Field Brief Image Source

**Files:**
- Modify: `collector/server/public/item-editor.js`
- Modify: `collector/server/public/field-brief.js`
- Test: manual browser verification on `field-brief.html`

- [ ] **Step 1: Audit current media hint payload shape**

Confirm these paths and keep the scope narrow:
- `item-editor.js` builds `field_pack_media_hints`
- `field-brief.js` currently loads `/api/assets?content_item_id=...&only_selected=1`
- `field-brief.js` renders `state.fieldPack.media_hints`

Expected outcome:
- selected media hints can already store `content_asset_id`, `url`, `kind`, `caption`, `selected`, `item_order`

- [ ] **Step 2: Make selected media hints persist usable URLs**

In `item-editor.js`, ensure the payload builder for selected media hints always sends a resolved `url` for each selected hint, even when it also sends `content_asset_id`.

Acceptance criteria:
- selected hint with bound asset still has a non-empty `url`
- external hint still keeps its manual URL
- no schema change

- [ ] **Step 3: Remove field-brief dependency on selected item assets**

In `field-brief.js`:
- stop loading `/api/assets?content_item_id=${state.itemId}&only_selected=1` for the media hints section
- render media hints from `state.fieldPack.media_hints` only
- include only hints where `selected === 1` or where the hint already exists in field pack data and has a valid `url`

Acceptance criteria:
- `field-brief` still shows chosen reference images
- if no media hints exist, it shows the empty state
- selected item assets are no longer required for media hint rendering

- [ ] **Step 4: Verify field-brief behavior**

Manual checks:
1. Open a field pack with selected media hints.
2. Confirm images render from `fieldPack.media_hints`.
3. Remove one selected hint in the editor, save, refresh field brief.
4. Confirm the removed hint no longer appears.

Expected:
- images shown in field brief match selected media hints only


### Task 2: Define AI Input Cleanup Eligibility

**Files:**
- Modify: `collector/db/repository.mjs`
- Test: narrow repo/runtime verification through existing endpoints

- [ ] **Step 1: Reuse current cleanup policy signals**

Start from the existing cleanup policy around:
- `selected_for_ai`
- `referenced_in_field_pack_media_hints`
- `referenced_in_assignment_deliverables`
- `cover_asset`

Do not invent a new table or schema.

- [ ] **Step 2: Define eligible AI input cleanup set**

Eligible for post-assignment hard delete only if all are true:
- belongs to the item being handed off
- was part of AI input selection (`selected_in_clean=1` and `role != 'unused'`)
- is not on `assignment_surface='assignment_work'`
- is not referenced by `field_pack_media_hints`
- is not referenced by `content_assignment_submission_deliverables`

Non-goals:
- do not preserve cover/gallery just because of role alone after handoff
- do not delete assignment uploads

- [ ] **Step 3: Add a repository helper returning cleanup candidates**

Add a focused helper in `repository.mjs` that returns:
- candidate rows
- blocked rows with reasons
- counts for audit

Expected output shape:
- `removed_links`
- `removed_assets`
- `removed_local_files`
- `skipped_asset_deletes`
- `blocked_asset_references`


### Task 3: Run Cleanup After Assignment Creation Success

**Files:**
- Modify: `collector/server/index.mjs`
- Modify: `collector/db/repository.mjs`
- Test: smoke script or deterministic manual flow

- [ ] **Step 1: Hook cleanup only after assignment create succeeds**

Attach cleanup immediately after the successful `createAssignmentFromReadiness(...)` path.

Constraints:
- do not run cleanup before assignment exists
- do not run cleanup on failed assignment create
- keep cleanup idempotent if the endpoint is retried

- [ ] **Step 2: Hard-delete mapping, asset row, and file**

For each eligible AI input image:
- delete `content_assets` mapping
- delete `assets` row if no other references remain
- delete physical file when storage is local/nas and no other references remain

Reuse existing delete logic where possible.

- [ ] **Step 3: Protect assignment work and referenced hints**

Skip deletion if:
- the asset belongs to `assignment_work`
- it is referenced by `field_pack_media_hints`
- it is referenced by assignment deliverables

Expected:
- AI input images are purged
- field reference images selected through media hints remain
- contributor-uploaded files remain

- [ ] **Step 4: Add audit logging**

Write one audit record on post-assignment cleanup with:
- `content_item_id`
- `assignment_id`
- `removed_links`
- `removed_assets`
- `removed_local_files`
- `skipped_asset_deletes`
- `blocked_asset_references`


### Task 4: Verification

**Files:**
- Modify if needed: `collector/scripts/*` only for a narrow smoke
- Test: syntax + targeted flow verification

- [ ] **Step 1: Syntax checks**

Run:
- `node --check collector/server/index.mjs`
- `node --check collector/db/repository.mjs`
- `node --check collector/server/public/item-editor.js`
- `node --check collector/server/public/field-brief.js`

Expected:
- all pass

- [ ] **Step 2: Manual flow verification**

Verify this sequence:
1. Select a few images in clean for AI draft.
2. In field pack editor, select only some images as `media_hints`.
3. Open `field-brief` and confirm only selected `media_hints` matter.
4. Create assignment successfully.
5. Re-open `field-brief` and assignment surfaces.

Expected:
- `field-brief` still shows selected media hints
- AI input-only images are gone
- assignment work files are untouched

- [ ] **Step 3: Retry/idempotency check**

Retry or revisit the create-assignment success path in a controlled case.

Expected:
- no duplicate cleanup failure
- already-deleted AI input images do not break the endpoint

