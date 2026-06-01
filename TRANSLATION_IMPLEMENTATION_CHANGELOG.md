# Translation Implementation Changelog

## Summary
Implemented translation-architecture alignment based on audit with safe incremental edits:
- Approval endpoints no longer generate translations.
- `/api/translate` is now explicitly manual preview-only.
- Existing multilingual read APIs and collector final-stage translation flow were preserved.
- Existing grouping model (parent id + translation tables) remains unchanged.

## Changes made

### 1) Removed early translation side effects from approval endpoints

#### Places approve endpoint
- File: `backend/controllers/placeController.js`
- Endpoint: `PATCH /api/places/:id/approve`
- Changes:
  - Removed in-endpoint AI translation generation logic.
  - Removed translation upsert side effects during approve.
  - Kept Thai-source existence check.
  - Kept approval status update (`places.is_approved=1`).
  - Kept approval logs and added explicit log note:
    - `translation side effects skipped (approval is source-only)`

#### Events approve endpoint
- File: `backend/controllers/eventController.js`
- Endpoint: `PATCH /api/events/:id/approve`
- Changes:
  - Removed translation-generation side effects during approve.
  - Kept Thai-source existence check.
  - Kept approval status update (`events.is_approved=1, approved_at=CURRENT_TIMESTAMP`).
  - Kept approval logs and added explicit source-only note.

### 2) Marked `/api/translate` as preview-only manual utility

#### Route updates
- File: `backend/routes/translateRoutes.js`
- Changes:
  - Added preferred endpoint: `POST /api/translate/preview`
  - Kept backward-compatible endpoint: `POST /api/translate`
  - Both are preview-only/manual-only.

#### Controller updates
- File: `backend/controllers/translateController.js`
- Changes:
  - Renamed primary handler to `previewTranslateManual`.
  - Kept backward-compatible alias export: `autoTranslate`.
  - Added lifecycle guard messaging in response:
    - `preview_only: true`
    - `manual_only: true`
    - `lifecycle_participation: "none"`
    - explanatory `note`
  - Endpoint behavior remains non-persistent preview output only.

#### Service updates
- File: `backend/services/translationService.js`
- Changes:
  - Added preview-first naming:
    - `requestPreviewTranslation(...)`
    - `previewTranslateWithRetry(...)`
  - Kept backward-compatible alias:
    - `translateWithRetry = previewTranslateWithRetry`
  - Added comments clarifying this service is manual preview utility and not lifecycle automation.

### 3) Admin/UI handling (manual preview only)

- File: `admin/src/pages/Places.jsx`
- Changes:
  - Preview call path changed from `/translate` to `/translate/preview`.
  - Removed automatic translation call on opening preview modal.
  - Translation modal now opens first; actual translation runs only when user clicks the preview translate button.
  - Updated UI copy to emphasize preview-only behavior:
    - Header: `ตรวจสอบคำแปล (Preview เท่านั้น)`
    - Button: `แปลพรีวิว`
  - Save/approve flow remains unchanged and does not call translation endpoint.

## What was rerouted
- Translation generation responsibility is no longer tied to backend approve endpoints.
- Final-stage automated translation remains in collector export workflow (already implemented and kept).

## What was deprecated
- Lifecycle usage of `POST /api/translate` is deprecated.
- Route remains available as backward-compatible manual preview endpoint only.

## Compatibility notes
- Backward compatibility preserved:
  - `POST /api/translate` still works (preview-only semantics).
  - `autoTranslate` export remains as alias to the new preview handler.
  - `translateWithRetry` export remains as alias to preview retry helper.
- No DB schema change introduced.
- No change to multilingual read APIs (`GET ...?lang=...`).
- Restored the local event meta-description helper in `backend/controllers/eventController.js` so create/update event continues to work after the approval-side translation removal.

## Remaining risks
1. Legacy file `admin/components/PlaceForm.jsx` still calls `/api/translate`; appears unused in current routed app.
2. Existing route/controller mismatch outside this task scope may still exist in places import exports.
3. Approve endpoints now rely on external final-stage translation flow to populate non-TH variants; teams should align release process accordingly.
