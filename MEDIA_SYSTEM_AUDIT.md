# Media + Collection Audit

## Scope
- Backend API (`backend/`)
- Admin UI (`admin/`)
- Internal collector (`collector-app/`)

## Findings
1. Media workflow previously mixed with direct `places.image` / `events.image` upload paths.
2. No dedicated review state for raw images before content attachment.
3. No normalized usage relation table for cover/gallery/inline in main backend.
4. Collector had content pipeline but lacked explicit modular social/source adapter intake path and raw ingestion logs.

## Existing Compatibility Constraints
- Existing frontend/admin still depends on `places.image` and `events.image` as legacy cover image.
- Existing place/event create/edit flows must continue working.

## Implemented Direction
- Added `media_assets` + `content_image_usages` in backend with status-driven review flow.
- Kept legacy image fields by syncing cover usage back to `places.image` / `events.image` when requested.
- Added Media Library page + Media Picker modal in admin.
- Added collector source ingestion structures and modular adapters for raw-only collection.
