# Changelog: Media + Collection Incremental Upgrade

## Added
- `backend/migrations/003_media_library.sql`
- `backend/controllers/mediaController.js`
- `backend/routes/mediaRoutes.js`
- `admin/src/pages/MediaLibrary.jsx`
- `admin/src/components/MediaPickerModal.jsx`
- `collector-app/database/migrations/001_source_ingestion.sql`
- `collector-app/collector/sources/*` adapters and normalization modules

## Updated
- `backend/server.js`: media routes registration
- `backend/config/ensureUtf8mb4.js`: include media tables
- `admin/src/pages/Places.jsx`: media picker + pending usage attach flow
- `admin/src/pages/Events.jsx`: media picker + pending usage attach flow
- `admin/src/pages/Dashboard.jsx` and `admin/src/App.jsx`: menu/route for media library
- `collector-app/database/schema.sql`: source ingestion/raw source/raw media tables
- `collector-app/db/repository.mjs`: source ingestion repository methods
- `collector-app/server/index.mjs`: source collection APIs
- `collector-app/server/public/index.html`: source collection section in Raw Inbox
- `collector-app/server/public/app.js`: source collection UI actions + ingestion table rendering

## Compatibility
- Legacy `places.image` / `events.image` behavior preserved for cover usage via `apply_legacy_cover`.
- Existing place/event content save flows still function.
