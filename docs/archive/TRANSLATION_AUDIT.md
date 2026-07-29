# Translation Audit (admin/backend/collector-app)

## Scope inspected
- `D:\UbonCity_Web\backend`
- `D:\UbonCity_Web\admin`
- `D:\UbonCity_Web\collector-app`
- `D:\UbonCity_Web\frontend` (read-only for consumer behavior)

## 1) Grouping model: does `group_id` (or equivalent) already exist?

### Short answer
- There is **no persistent DB column** named `group_id`, `content_group_id`, or `translation_group_id` in backend content tables.
- The system already has a **working equivalent grouping model** via parent entity id + translation tables.

### Existing grouping fields (equivalent)
- Places:
  - Parent: `places.id`
  - Variants: `place_translations.place_id`
  - Language key: `place_translations.lang`
  - Uniqueness: `UNIQUE (place_id, lang)` from migrations.
- Events:
  - Parent: `events.id`
  - Variants: `event_translations.event_id`
  - Language key: `event_translations.lang`
  - Uniqueness: `UNIQUE (event_id, lang)` from migrations.
- Categories:
  - Parent: `categories.id`
  - Variants: `category_translations.category_id`
  - Language key: `category_translations.lang`
  - Uniqueness: `UNIQUE (category_id, lang)` from migrations.

### Where `group_id` appears today
- `group_id` exists as **request payload alias** in place creation flow:
  - `D:\UbonCity_Web\backend\controllers\placeController.js` (reads `req.body.group_id`, resolves to existing `places.id`)
  - `D:\UbonCity_Web\backend\validators\placeValidator.js`
  - `D:\UbonCity_Web\admin\src\pages\Places.jsx` (sends `group_id` in save payload)
- This is not a table column; it maps to `places.id`.

### Conclusion on grouping structure
- Existing structure is valid and should be reused:
  - `places.id` + `place_translations.place_id`
  - `events.id` + `event_translations.event_id`
  - `categories.id` + `category_translations.category_id`
- Minimal extension needed: normalize naming in API docs/DTO to reduce confusion (`group_id` -> `source_entity_id` or reuse `id` directly).

---

## 2) Translation-related APIs/routes/services audit

## Backend routes/services found

### A. `POST /api/translate`
- Route: `D:\UbonCity_Web\backend\routes\translateRoutes.js`
- Controller: `D:\UbonCity_Web\backend\controllers\translateController.js` (`autoTranslate`)
- Service: `D:\UbonCity_Web\backend\services\translationService.js`
- Current behavior:
  - Immediate AI translation from source input to target langs.
  - Used by admin create/edit UI for preview check.
- Classification: **DEPRECATE** (for production lifecycle) or **REROUTE** (preview-only utility endpoint).
- Reason:
  - It triggers translation before final publish step (against target workflow rule).
  - If kept, should be strictly non-lifecycle preview/sandbox and clearly separated.

### B. `PATCH /api/places/:id/approve`
- Route: `D:\UbonCity_Web\backend\routes\placeRoutes.js`
- Controller: `D:\UbonCity_Web\backend\controllers\placeController.js` (`approvePlace`)
- Current behavior:
  - During approve, generates `en/zh/lo` translations and writes `place_translations`.
- Classification: **REROUTE**
- Reason:
  - Approval should only approve source; translation should happen at final pre-frontend publish stage.
  - Endpoint itself stays (approval is needed), but translation side effect should be removed/rerouted.

### C. `PATCH /api/events/:id/approve`
- Route: `D:\UbonCity_Web\backend\routes\eventRoutes.js`
- Controller: `D:\UbonCity_Web\backend\controllers\eventController.js` (`approveEvent`)
- Current behavior:
  - During approve, generates `en/zh/lo` translations and writes `event_translations`.
- Classification: **REROUTE**
- Reason:
  - Same as places; early translation side effect conflicts with target workflow.

### D. Read APIs with language selection
- `GET /api/places?category=...&lang=...`
- `GET /api/places/:category/:slug?lang=...`
- `GET /api/events?lang=...`
- `GET /api/events/:id?lang=...`
- `GET /api/categories?lang=...`
- `GET /api/categories/:slug?lang=...`
- Files:
  - `D:\UbonCity_Web\backend\controllers\placeController.js`
  - `D:\UbonCity_Web\backend\controllers\eventController.js`
  - `D:\UbonCity_Web\backend\controllers\categoryController.js`
- Classification: **KEEP**
- Reason:
  - They are consumer read APIs and already map language fallback logic.

### E. Collector-app translation status APIs
- `GET /api/translations`
- `GET /api/translation-runs`
- File: `D:\UbonCity_Web\collector-app\server\index.mjs`
- Classification: **KEEP**
- Reason:
  - Useful for status/visibility of final-stage translation workflow.

### F. Collector final-stage translation execution
- File: `D:\UbonCity_Web\collector-app\services\workflow.mjs`
- Function: `runFinalTranslationStage(...)` called in `exportStaging(...)`
- Classification: **KEEP**
- Reason:
  - Matches desired rule: translation at final pre-frontend export step.

### G. Legacy/unused translation UI file
- `D:\UbonCity_Web\admin\components\PlaceForm.jsx`
- Not wired in current app routing (`admin/src/App.jsx`).
- Classification: **REMOVE ONLY IF CLEARLY UNUSED**
- Reason:
  - Appears legacy; safe to remove only after confirming no hidden import/build reference.

---

## 3) Recommended target workflow (minimal-change)

1. Source lifecycle
- Draft/review/approval continue without translation generation.
- Approval endpoints only set approval state and logs.

2. Final publish/pre-frontend step
- Collector runs translation generation and automatic checks.
- Store translation tied to source version/fingerprint.
- Mark stale when source changes.

3. Frontend output
- Publish source content always (if approved).
- Include translated variants only when checks pass and not stale.

4. Admin role
- Manage source content and approvals.
- See translation status/check/stale from collector status APIs.
- Optional rerun action at final stage only.

---

## 4) Minimal changes needed (after audit)

1. Stop early translation side effects
- Remove translation generation from:
  - `approvePlace` in `backend/controllers/placeController.js`
  - `approveEvent` in `backend/controllers/eventController.js`
- Keep approval endpoints and logs.

2. Decommission early translate endpoint from main lifecycle
- `POST /api/translate`:
  - deprecate, or
  - reroute as non-persistent preview endpoint with explicit label.

3. Keep/reuse grouping model
- Continue using parent id + translation table model.
- Avoid introducing a new DB-level `group_id` unless there is a cross-entity requirement.

4. Normalize naming
- Reduce confusion by documenting `group_id` as request alias to `places.id`.

---

## 5) Observed translation-risk notes

- Duplicate translation logic currently exists in backend:
  - Generic service: `backend/services/translationService.js`
  - Inline OpenAI call in `backend/controllers/placeController.js` (`translateFromThai`)
  - This should be unified later.

- Route/controller mismatch spotted:
  - `backend/routes/placeRoutes.js` imports `importPlaces`, `importPlacesCsv`
  - These exports were not found in current `backend/controllers/placeController.js` file content.
  - Not a translation design issue directly, but a runtime risk.
