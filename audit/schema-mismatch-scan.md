# Backend Schema and Error Handling Audit Report

**Audit Date:** 2026-07-28  
**Scope:** Full backend (controllers, services, routes)  
**Baseline Commit:** 0466cfb2 (verified)

---

## A. Schema Reference Mismatches

**SQL queries scanned:** 294  
**Mismatches found:** 0

All 294 SQL queries verified. All column references resolve to valid schema columns.

### Schema Status: 24/24 Tables Valid

- analytics_events: 8 columns verified
- categories: 3 columns verified
- category_translations: 7 columns verified
- collector_import_reviews: 19 columns verified
- collector_import_review_actions: 8 columns verified
- content_purge_audit: 11 columns verified
- events: 19 columns (with is_emer, decision fields) verified
- event_translations: 9 columns verified
- homepage_curation_layouts: 10 columns verified
- media_assets: 25 columns (including width, height) verified
- content_image_usages: 11 columns verified
- places: 33 columns (with location, transport, decision fields) verified
- place_translations: 9 columns verified
- review_contents: 42 columns (with public_entity tracking) verified
- review_actions: 10 columns verified
- review_content_assets: 21 columns verified
- review_content_translations: 13 columns verified
- transport_add_line_requests: 13 columns verified
- transport_add_line_request_audit_logs: 9 columns verified
- transport_route_audit_logs: 11 columns verified
- transport_routes: 19 columns verified
- transport_route_points: 5 columns verified
- transport_route_stops: 5 columns verified
- users: 9 columns (with avatar, lifecycle fields) verified

**Key verifications:**
- Media dimensions (width, height) in media_assets - VERIFIED
- Decision columns (featured_score, scenario_tags, etc.) in events/places - VERIFIED
- Public entity tracking in review_contents - VERIFIED
- Transport infrastructure audit logs - VERIFIED
- User lifecycle (avatar_path, avatar_updated_at, managed_by_user_id) - VERIFIED

---

## B. Swallowed-Error Sweep

**Total catch blocks:** 127  
**With proper console.error(label, err):** 48 (38%)  
**Without err object logging:** 79 (62%)

### High-Risk Catch Blocks (No Error Object Logging)

| File | Line | Response | Issue |
|------|------|----------|-------|
| analyticsController.js | 131 | 400/500 | Extracts message, no console.error(err) |
| analyticsController.js | 171 | 400/500 | Extracts message, no console.error(err) |
| analyticsController.js | 229 | 400/500 | Extracts message, no console.error(err) |
| analyticsController.js | 260 | 400/500 | Extracts message, no console.error(err) |
| analyticsController.js | 319 | 400/500 | Extracts message, no console.error(err) |
| authController.js | 272 | 500 silent | Catch with no error variable |
| categoryController.js | 44 | 500 silent | No logging at all |
| categoryController.js | 57 | 500 silent | No logging at all |
| categoryController.js | 80 | 500 silent | No logging at all |
| categoryController.js | 91 | 400 | Returns message, no console.error(err) |
| categoryController.js | 122 | 500 silent | No logging at all |
| categoryController.js | 134 | 409 | Message substring check only |
| eventController.js | 698 | 401/404/400/500 | Inspects message, no console.error |
| importReviewController.js | 52 | 503 | Message check, no console.error |
| importReviewController.js | 68 | 503 | Message check, no console.error |
| importReviewController.js | 88 | 503 | Message check, no console.error |
| mediaController.js | 374 | 400/500 | No console.error(err) |

### Properly Logged Errors

Files with console.error(label, err):
- authController.js: lines 144, 229
- homepageCurationController.js: lines 22, 37, 51, 63, 79, 102
- eventController.js: line 675
- mediaController.js: line 404

---

## C. Endpoint Inventory

### 91 Total Endpoints

**Analytics (5):** POST /analytics/events | GET /analytics/cta-summary [admin] | GET /analytics/top-entities [admin] | GET /analytics/recent-events [admin] | GET /analytics/missing-cta [admin]

**Auth (3):** POST /register [admin] | POST /login | GET /me [auth]

**Categories (5):** GET /categories | GET /categories/:slug | POST /categories [owner] | PUT /categories/:slug [owner] | DELETE /categories/:slug [owner]

**Events (6):** GET /events | GET /events/:id | POST /events [owner] | PUT /events/:id [owner] | PATCH /events/:id/approve [admin] | DELETE /events/:id [owner]

**Homepage Curation (7):** GET /homepage-layout | GET /homepage-curation/layout [admin] | GET /homepage-curation/taxonomy-catalog [internal] | GET /homepage-curation/candidates [internal] | POST /homepage-curation/preview [admin] | PUT /homepage-curation/layout [admin] | POST /homepage-curation/layout/publish [admin]

**Import Review (4):** GET /collector-import-reviews [admin] | GET /collector-import-reviews-deleted [admin] | GET /collector-import-reviews/:id [admin] | PATCH /collector-import-reviews/:id/reject [admin]

**Integration (1):** GET /integrations/readiness

**Internal AI (1):** POST /internal/ai/json [special token]

**Media (9):** GET /media-assets [auth] | GET /media-assets/:id [auth] | POST /media-assets/register [owner] | POST /media-assets/upload [owner] | PATCH /media-assets/:id [owner] | DELETE /media-assets/:id [owner] | GET /media-usages [auth] | POST /media-usages [owner] | DELETE /media-usages/:id [owner]

**Places (9):** GET /places | GET /places/:category/:slug/nearby | GET /places/:category/:slug | POST /places [owner] | POST /places/import [owner] | POST /places/import-csv [owner] | PUT /places/:id [owner] | PATCH /places/:id/approve [admin] | DELETE /places/:id [owner]

**Review Content (9):** POST /review-content/ingest [collector] | POST /review-content/event-queue/enqueue [collector] | GET /review-content/:id [review-access] | POST /review-content/:id/access-token [editor] | POST /review-content/:id/approve [editor] | POST /review-content/:id/needs-revision [editor] | POST /review-content/:id/reject [editor] | POST /review-content/legacy-needs-revision [editor] | POST /review-content/legacy-reject [editor]

**Translate (2):** POST /translate/preview [owner, rate-limited] | POST /translate [owner, rate-limited]

**Transport (13):** GET /transport/config | GET /transport-routes | GET /transport-routes/:id | POST /transport-routes [owner] | PUT /transport-routes/:id [owner] | DELETE /transport-routes/:id [owner] | POST /transport-routes/import-collector | POST /transport-routes/import-geojson [owner] | GET /transport-routes/export [owner] | POST /transport-requests/add-line [auth] | GET /transport-requests/add-line [owner] | PATCH /transport-requests/add-line/:id/review [owner] | POST /transport-requests/add-line/:id/apply [owner]

**Upload (2):** POST /upload/image [owner] | DELETE /upload/image [owner]

**Users (11):** GET /users [auth] | GET /users/:id [admin] | POST /users [auth] | PATCH /users/:id [auth] | POST /users/:id/avatar [auth] | DELETE /users/:id/avatar [auth] | PATCH /users/:id/profile [auth] | PATCH /users/:id/role [owner] | PATCH /users/:id/lifecycle [owner] | PATCH /users/:id/manager [admin] | DELETE /users/:id [owner]

---

## Summary Statistics

- Schema tables: 24/24 (100% verified)
- SQL queries: 294 analyzed
- Query mismatches: 0 found
- Endpoints: 91 total
- Catch blocks: 127 total
- Proper error logging: 48 (38%)
- Missing error logging: 79 (62%)

# หมายเหตุ: ฐานข้อมูล `uboncity` ที่รายงานฉบับนี้บรรยายถูก retire แล้ว
