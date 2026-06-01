# CHANGELOG_TRANSLATION_WORKFLOW

## Added
- New migration: `collector-app/database/migrations/004_translation_workflow.sql`
  - `content_translations`
  - `translation_runs`
- New modules:
  - `collector-app/translation/service.mjs`
  - `collector-app/quality/translation-checks.mjs`

## Changed
- `collector-app/services/workflow.mjs`
  - Added final-stage-only translation run at `exportStaging`.
  - Translation now runs only from published source records.
  - Added source fingerprint tie (`content_item_id:draft_id:review_report_id`).
  - Mark old translations stale when source fingerprint changes.
  - Auto-check translations before allowing frontend export inclusion.
  - Export now writes `published-articles-translations.json` (check-passed + fresh only).
- `collector-app/db/repository.mjs`
  - Added translation table/runtime ensure.
  - Added translation CRUD/status methods and translation run tracking.
  - `listPublishedArticles` now includes `source_lang` for translation target filtering.
- `collector-app/server/index.mjs`
  - `POST /api/run/export` now passes AI config + actor into final translation stage.
  - Added visibility/action endpoints used by UI and translation status:
    - `POST /api/review/action`
    - `GET /api/review-queue`
    - `GET /api/internal-links`
    - `POST /api/internal-links/:id/review`
    - `POST /api/run/publish`
    - `POST /api/run/stage`
    - `GET /api/published`
    - `GET /api/translations`
    - `GET /api/translation-runs`
- `collector-app/server/public/index.html`
  - Added translation status table in Staging/Publish panel.
- `collector-app/server/public/app.js`
  - Fetch and render translation status in UI.

## Preserved behavior
- No translation generation during draft stage.
- No translation generation during review stage.
- Existing source publish gate remains intact.
- Failed translations do not block source publication.

## Notes
- Deterministic fallback translator is provided for local/internal runs without API key.
- OpenAI-based translation is automatically used when AI config is enabled.
