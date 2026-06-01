# CHANGELOG REFACTOR

## Summary
This refactor focused on architecture cleanup and schema alignment for Places/Categories/Events, while preserving existing route contracts and UI behavior.

## What Changed

### 1) Backend structure improvements
- Added reusable language constants:
  - `backend/constants/languages.js`
- Added reusable translation service:
  - `backend/services/translationService.js`
- Added validators:
  - `backend/validators/placeValidator.js`
  - `backend/validators/eventValidator.js`
  - `backend/validators/categoryValidator.js`
- Added category repository and domain module:
  - `backend/repositories/categoryRepository.js`
  - `backend/controllers/categoryController.js`
  - `backend/routes/categoryRoutes.js`
- Wired new category routes in:
  - `backend/server.js`

### 2) Places module hardening
- Updated `updatePlace` validation in:
  - `backend/controllers/placeController.js`
- Import flow now normalizes `lang` against supported language set.

### 3) Events module alignment + SEO fields
- Refactored event translation flow to use shared translation service.
- Added payload validation to create/update event flows.
- Extended event translation upsert to include `meta_title` and `meta_description`.
- Event read APIs now return `meta_title` / `meta_description` with fallback behavior.

### 4) Schema migration baseline
- Added migration files:
  - `backend/migrations/001_schema_alignment_core.sql`
  - `backend/migrations/002_safe_constraints_if_missing.sql`
- Includes:
  - translation dedup cleanup
  - optional SEO columns on translation tables
  - safe index and constraint creation checks

### 5) Frontend SEO readiness
- Added metadata generation for category pages:
  - `frontend/app/[lang]/attractions/page.js`
  - `frontend/app/[lang]/activities/page.js`
  - `frontend/app/[lang]/hotels/page.js`
  - `frontend/app/[lang]/cafes/page.js`
  - `frontend/app/[lang]/restaurants/page.js`
  - `frontend/app/[lang]/transport/page.js`
- Added metadata generation for detail pages:
  - `frontend/app/[lang]/[category]/[slug]/page.js`
  - `frontend/app/[lang]/events/[id]/page.js`

## Why It Changed
- Reduce controller-level coupling and duplicated translation logic.
- Align runtime behavior with expected DB invariants.
- Make category domain explicit and maintainable.
- Improve multilingual SEO baseline without introducing AI automation changes.

## Potentially Breaking Changes
- New category admin APIs enforce slug uniqueness and prevent deleting categories that still have places.
- Migration `002` can fail if existing data violates intended uniqueness constraints (e.g., duplicate slugs or duplicate translation rows not covered by dedup rules).

## Manual UI Testing Still Required
1. Admin place update + approval + frontend display in all supported languages.
2. Admin event update + approval + frontend event detail rendering and metadata.
3. Category API CRUD end-to-end from admin integration (if/when UI is connected).
4. Transport/admin unrelated flows sanity check (regression smoke test).

## Migration Run Order
1. `backend/migrations/001_schema_alignment_core.sql`
2. `backend/migrations/002_safe_constraints_if_missing.sql`
