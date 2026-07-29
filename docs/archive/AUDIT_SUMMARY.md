# AUDIT SUMMARY

## Scope
- Audited `backend`, `admin`, `frontend`, and schema-related artifacts for `places`, `categories`, `events`, and translations.
- Excluded implementation changes for social collection/generation/publishing/internal-link features as requested.

## Architecture Findings
- Backend had heavy controller coupling:
  - `backend/controllers/placeController.js` mixed CRUD, validation, import CSV parsing, approval flow, and AI translation.
  - `backend/controllers/eventController.js` mixed table bootstrap, translation, and CRUD.
- Category domain was only partially implemented in practice:
  - App relied on `categories` table in queries, but no dedicated `category` API module existed.
- Translation logic was duplicated across controllers (`place`, `event`, and `translate`).
- No central migration folder for core app schema existed before this refactor.

## Schema/Code Mismatches
- `events` + `event_translations` were both used, but API read path did not consistently expose SEO fields.
- `event_translations` did not reliably contain `meta_title` / `meta_description` in runtime bootstrap paths.
- `place_translations` uniqueness and language indexing were expected by code behavior but not guaranteed by migration scripts.
- `category_translations` existed conceptually but lacked a first-class CRUD backend module.

## Risky Areas
- Runtime DDL inside controllers (`ensure...Table` / `ALTER TABLE`) can hide production migration drift.
- AI translation failures can cascade into approval path if not isolated.
- Mixed responsibility controllers increase regression risk when changing one flow (e.g., import vs approval vs CRUD).

## Dead/Low-Value Code Signals
- `backend/services/translateService.js` was empty (unused placeholder).
- Translation parsing/retry logic was duplicated instead of centralized.

## Recommended Fixes
1. Add migration-first schema alignment under `backend/migrations`.
2. Add explicit category module (`controller + route + repository`) and keep relation checks to places.
3. Centralize translation logic in reusable service.
4. Add validators for event/place update payloads for predictable API behavior.
5. Expose SEO-ready fields in event read responses and frontend metadata generation.
6. Keep route contracts stable to avoid breaking admin/frontend.

## Manual QA Focus After Refactor
- Admin: create/update/approve place flow, including multilingual detail fetch.
- Admin: create/update/approve event flow and event list ordering by approval/update time.
- Admin: category CRUD via API (slug uniqueness + cannot delete category with places).
- Frontend: category pages and place/event detail metadata and rendering.
- DB: run migrations in order and verify index/constraint creation on real `uboncity` DB.
