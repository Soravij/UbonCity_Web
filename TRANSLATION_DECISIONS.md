# Translation Decisions

## Reuse existing group structure?
- Decision: **YES**
- Why:
  - Existing multilingual grouping already works via parent entity id + translation table relation.
  - Current stable links:
    - Places: `places.id` -> `place_translations.place_id`
    - Events: `events.id` -> `event_translations.event_id`
    - Categories: `categories.id` -> `category_translations.category_id`
  - Adding a new global `group_id` layer now would increase migration risk without clear benefit.

## Reuse existing translation API?

### Keep
1. Collector status APIs
- `GET /api/translations` (`collector-app/server/index.mjs`)
- `GET /api/translation-runs` (`collector-app/server/index.mjs`)
- Why: needed for status/check/stale visibility.

2. Language-aware read APIs
- Places/events/categories `GET ...?lang=...` in backend controllers.
- Why: required for multilingual read behavior.

### Deprecate
1. `POST /api/translate`
- Current file: `backend/routes/translateRoutes.js` + `backend/controllers/translateController.js`
- Why:
  - Triggers translation before final publish stage.
  - Conflicts with target rule: translate only at final pre-frontend step.

### Reroute
1. `PATCH /api/places/:id/approve`
- Keep approval responsibility.
- Reroute translation side effect out of this endpoint.
- Approval should not generate translated variants.

2. `PATCH /api/events/:id/approve`
- Same approach as places.
- Keep approval, remove/reroute translation generation.

3. Optional preview translation utility
- If business still wants preview, reroute to explicit non-lifecycle utility endpoint (no persistence, no workflow state impact).
- Must be clearly labeled as preview/testing only.

### Remove only if clearly unused
1. `admin/components/PlaceForm.jsx`
- Appears legacy and not connected to `admin/src/App.jsx` route tree.
- Remove only after quick import/build confirmation.

## Which endpoints should stop triggering early translation
1. `PATCH /api/places/:id/approve`
2. `PATCH /api/events/:id/approve`
3. `POST /api/translate` (for lifecycle use)

## Which endpoints should become status/config/rerun style
1. Keep using collector visibility APIs:
- `GET /api/translations`
- `GET /api/translation-runs`

2. Add (or formalize later) collector translation ops APIs (at final stage only)
- Suggested pattern:
  - `POST /api/run/export` (already exists; includes final translation stage)
  - optional future: `POST /api/translations/rerun` scoped to final-stage published source only
- Note: no draft/review translation trigger should be added.

## Target workflow decision (final)
1. Admin/backend handles source content, approval, and language-aware reads.
2. Collector handles translation generation + automatic checks at final pre-frontend export only.
3. Frontend consumes:
- source content
- translated variants only when check status passed and not stale.

## Minimal change set
1. Remove translation generation logic from backend approve handlers.
2. Mark `/api/translate` deprecated (or move to preview-only utility).
3. Keep and document existing id-based grouping model.
4. Keep collector translation status APIs as source of truth for translation state.
