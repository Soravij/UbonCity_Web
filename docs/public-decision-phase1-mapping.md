# Public Decision Layer - Phase 1 Mapping

Date: 2026-03-20
Scope: `frontend` public web, `admin`, `backend`, `collector-app`

## 1) Public Route Map (current)

- Home decision entry: `/[lang]` -> `frontend/app/[lang]/page.js`
- Category lists: `/[lang]/attractions|activities|hotels|cafes|restaurants|transport`
- Place detail: `/[lang]/[category]/[slug]`
- Event detail: `/[lang]/events/[id]`
- Transport utility:
  - `/[lang]/transport`
  - `/[lang]/transport/bus-routes`

## 2) Data Sources used by public frontend

Public frontend reads from backend (`NEXT_PUBLIC_API_URL` / `/api`) via `frontend/lib/api.js`:

- `getPlaces(category, lang)` -> `GET /api/places`
- `getPlaceDetail(category, slug, lang)` -> `GET /api/places/:category/:slug`
- `getEvents(lang)` -> `GET /api/events`
- `getEventDetail(id, lang)` -> `GET /api/events/:id`
- `getTransportRoutes` -> `GET /api/transport-routes`
- `getTransportMapsConfig` -> `GET /api/transport/config`

## 3) Published/Approved visibility contract

Backend controller behavior confirms public-only data by default:

- Places:
  - `backend/controllers/placeController.js`
  - `getPlaces/getPlaceDetail` enforce `p.is_approved=1` unless privileged + `include_unapproved=1`
- Events:
  - `backend/controllers/eventController.js`
  - `getEvents/getEventDetail` enforce `e.is_approved=1` unless privileged + `include_unapproved=1`

Result: anonymous/public frontend receives approved items by default.

## 4) Admin production path (content + approval)

Admin writes and approves through backend APIs:

- Places CRUD + approve:
  - `backend/routes/placeRoutes.js`
  - `POST /api/places`, `PUT /api/places/:id`, `PATCH /api/places/:id/approve`
- Events CRUD + approve:
  - `backend/routes/eventRoutes.js`
  - `POST /api/events`, `PUT /api/events/:id`, `PATCH /api/events/:id/approve`

Admin pages tied to this path:

- `admin/src/pages/Places.jsx`
- `admin/src/pages/Events.jsx`
- `admin/src/pages/Approvals.jsx`

## 5) Collector -> Backend sync path

Collector lifecycle export/publish syncs to backend lifecycle import endpoint:

- Collector trigger routes:
  - `collector-app/server/index.mjs`
  - `/api/run/publish`, `/api/run/export`
- Collector sync target:
  - POST to backend `/lifecycle/import-published`
- Backend importer:
  - `backend/routes/lifecycleRoutes.js`
  - `backend/controllers/lifecycleController.js`

Lifecycle importer upserts into backend content tables and keeps imported records pending re-approval (`is_approved=0`) before public exposure.

## 6) Decision-layer metadata gaps (for next phases)

Current public payloads are enough for basic decision UI but not enough for full signal-driven ranking. Missing or not formalized yet:

- Scenario tags (`day_trip`, `budget_500`, `couple`, `family`)
- Trend flags (`new_open`, `viral`, `review_surge`)
- Moment tags (`morning`, `evening`, `rainy_day`)
- Insight signals (`repeat_visit_score`, `momentum_score`)

Phase 2 uses deterministic fallback from existing approved data (category + title/description keywords + freshness by id/time) without changing backend semantics.
