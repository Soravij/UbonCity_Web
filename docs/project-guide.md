<!-- generated from 91e4a79cc2e46695ee2e5f0d8179d82fe69cbc7b on 2026-08-21 -->

## 1. This system does what

UbonCity is a tourism content platform for Ubon Ratchathani. The Collector app (`collector/server/index.mjs`) is where internal staff and freelance contributors ingest raw place/event data from external sources, run it through an AI pipeline that generates field packs and article drafts, manage field assignments and editorial reviews, then sync the finished content to the Backend API (`backend/server.js`) which serves the public Next.js website (`frontend/app/layout.js`). The Admin panel (`admin/src/main.jsx`) handles content approval, homepage curation, and user management. The Collector owns the entire content lifecycle from raw crawl to publish-ready; the Backend owns the public-facing read API and the final publish decision.

## 2. Data flow: one Place from crawl to website

A place enters the system when an admin creates it via `POST /api/items` (`index.mjs:8290`), which inserts a row into `content_items` (`schema.sql:15`) with `production_state = "collected"`. The admin then runs the clean stage via `PUT /api/items/:id` with `workflow_action: "mark_cleaned"` (`index.mjs:8721`), which calls `runCleanStage()` (`workflow.mjs:1789`) to normalize the raw data and move the item to `production_state = "analyzed"`.

Next, the admin clicks "Generate AI Draft" which calls `POST /api/run/ai-draft` (`index.mjs:14067`). This invokes `runAiDraftStage()` (`workflow.mjs:2213`), which builds a clean context via `buildCleanStructuredContext()` (`clean-context.mjs:107`), freezes a snapshot into `draft_input_snapshots` (`schema.sql:517`), then calls `createAgentGenerationEngine()` (`agent-generation.mjs:919`) to produce a field pack written to `field_packs` (`schema.sql:597`) and a draft written to `content_drafts` (`schema.sql:547`). The item moves to `production_state = "generated"`.

The admin clicks "Ready for Content" (`btn-next-export` in `item-editor.js:5820`), which calls `POST /api/items/:id/place-ready-for-content` (`index.mjs:8773`) to advance the item to `production_state = "ready_for_content"`. A field assignment is then created via `POST /api/items/:id/assignments` (`index.mjs:10555`), calling `createAssignmentFromReadiness()` (`repository.mjs:9051`) which inserts into `content_assignments` (`schema.sql:1004`) and transitions the item to `field_working` when the assignee starts work.

The freelancer submits deliverables via `POST /api/assignments/:id/submissions` (`index.mjs:11230`), writing to `content_assignment_submissions` (`schema.sql:1040`) and `content_assignment_submission_deliverables` (`schema.sql:1080`). The assignment state moves to `submitted`, which triggers `production_state = "field_review"` via `updateAssignmentState()` (`repository.mjs:5556`).

An editor then creates an editorial assignment via `POST /api/items/:id/article-editorial-assignments` (`index.mjs:10341`), moving the item to `writing_assigned`. The writer starts drafting in the article workspace, transitioning through `writing` → `in_review` → `ready_for_publish` via the article-process endpoints (`index.mjs:9264`, `index.mjs:9318`). Finally, `POST /api/items/:id/submit-admin-review` (`index.mjs:13128`) ingests the content into the Backend's `review_contents` table (`000_baseline_schema.sql:277`) and moves the item to `submitted_for_admin_review`. When the Backend publishes, it sends feedback via `POST /api/web-review-feedback` (`index.mjs:14241`), which calls `applyPublishedWebReviewFeedback()` (`index.mjs:14206`) to set `production_state = "completed"` and `publication_state = "published"`.

## 3. Five most-used buttons in Collector

**btn-next-ai (Generate AI Draft)** in `item-editor.js:5788` calls `POST /api/run/ai-draft` (`index.mjs:14067`), which invokes `runAiDraftStage()` (`workflow.mjs:2213`). The function reads the item's approved context and images, sends them to the AI agent engine, then writes a field pack to `field_packs` and a draft to `content_drafts`. The item's `production_state` changes from `analyzed` to `generated`.

**btn-next-export (Ready for Content)** in `item-editor.js:5820` calls `POST /api/items/:id/place-ready-for-content` (`index.mjs:8773`). The handler validates that a field pack exists and the item is at `generated`, then writes `production_state = "ready_for_content"` to `content_workflow_models` (`schema.sql:957`) via `repo.upsertWorkflowModel()`. No other tables are touched; this is a pure state gate.

**btn-save (Save & Mark Cleaned)** in `item-editor.js:5745` calls `PUT /api/items/:id` (`index.mjs:8721`) with `workflow_action: "mark_cleaned"`. The handler updates the item's title, description, tags, and coordinates in `content_items`, then transitions `production_state` from `collected` to `analyzed`. This is the only way to move an item past the initial `collected` state without running the bulk pipeline.

**Assignment Submit** in the assignment workspace calls `POST /api/assignments/:id/submissions` (`index.mjs:11230`). The handler writes a submission row to `content_assignment_submissions` and deliverable rows to `content_assignment_submission_deliverables`, then calls `updateAssignmentState()` (`repository.mjs:5556`) to move the assignment to `submitted`. For field assignments on places, this side-effects `production_state` to `field_review`.

**Submit for Admin Review** in `article-submit-page.js` calls `POST /api/items/:id/submit-admin-review` (`index.mjs:13128`). The handler validates export readiness and translation recheck, builds a review ingest payload via `buildReviewIngestContentPayload()` (`review-ingest-mapping.mjs:1`), POSTs it to the Backend's `/api/review-content/ingest` endpoint, then writes `production_state = "submitted_for_admin_review"` to `content_workflow_models`.

## 4. Files that matter

`collector/server/index.mjs` (15,482 lines) is the Collector's Express app; every API route, every inline handler, and all the glue between services and the repository live here. `collector/db/repository.mjs` (12,947 lines) is the data access layer with 200+ methods covering every DB operation, the state machine definitions, and transition enforcement. `collector/services/workflow.mjs` (2,873 lines) owns the pipeline stages—clean, AI draft, quality checks, translation repair, and review actions. `collector/database/schema.sql` (1,251 lines) defines all 65 SQLite tables. `backend/server.js` (117 lines) is the Backend Express app that mounts 15 route modules and handles startup infrastructure. `backend/migrations/000_baseline_schema.sql` (537 lines) defines the 25 MySQL tables. Everything else—other service files, UI files, config—is supporting material.

## 5. index.mjs zone map

Base path: `collector/server/index.mjs` (15,482 lines).

| Lines | What it does | First / last landmark |
|-------|-------------|----------------------|
| 1–94 | Imports from all service modules, db, config | `import "dotenv/config"` :1 / `import { buildReviewIngestContentPayload }` :93 |
| 95–153 | Constants, AI agent profiles, asset version setup | `ARTICLE_AGENT_KEY` :95 / `resolveCollectorAssetVersionForFile()` :154 |
| 154–263 | Static file helpers: HTML/JS rendering, asset URL rewriting | `resolveCollectorAssetVersionForFile()` :154 / `renderCollectorRootHtml()` :264 |
| 264–971 | Pure utility functions: AI config, transport normalization, HTML sanitization | `renderCollectorRootHtml()` :264 / `sanitizeArticleRichTextHtml()` :972 |
| 972–1915 | Item enrichment, merge logic, soft-delete prep, audit snapshots | `sanitizeArticleRichTextHtml()` :972 / `purgeDeletedItemTx()` :1916 |
| 1916–2718 | Item merge, bulk operations, assignment access checks | `purgeDeletedItemTx()` :1916 / `hasAssignmentDraftAccess()` :2712 |
| 2719–2750 | Express middleware setup: CORS, JSON, rate limiter, static mounts | `app.set("trust proxy", 1)` :2725 / `app.use(express.static(...))` :2750 |
| 2751–7197 | Root HTML route, static HTML/JS serving middleware, Google Maps proxy | `app.get("/")` :2751 / `assignmentChunkUploadRateLimit` :7196 |
| 7198–7800 | Health, auth, admin diagnostics, user CRUD, config, workflow-states | `GET /api/health` :7198 / `GET /api/workflow-states` :7801 |
| 7801–8340 | AI policies, agent profiles, item list/detail, bulk ops, create item | `GET /api/workflow-states` :7801 / `POST /api/items` :8290 |
| 8341–8575 | Transport map v1 routes (config, CRUD, release) | `GET /api/transport-map/config` :8341 / `POST .../release-main` :8489 |
| 8576–9100 | Item claim/release/takeover, save, place-ready, editor-work, AI suggestions | `POST /api/items/:id/claim` :8576 / `POST .../article-suggestion` :9022 |
| 9101–9546 | Workflow model, backward transitions, article-process, transitions, audit logs | `GET .../workflow-model` :9101 / `PUT .../workflow-model` :9547 |
| 9547–10164 | Intelligence, readiness, brief, execution controls, channels, governance | `PUT .../workflow-model` :9547 / `POST .../assignments/from-readiness` :10165 |
| 10165–10748 | Assignment CRUD: create, editorial, request-revision, from-readiness | `POST .../assignments/from-readiness` :10165 / `POST .../assignments` :10555 |
| 10749–12179 | Assignment list/detail, state, submissions, deliverables, governance, history | `GET /api/assignments/mine` :10749 / `GET .../history` :12110 |
| 12180–12900 | Search enrichment, intelligence, social signals, momentum, content direction, evidence, field packs, media candidates | `GET .../search-enrichment` :12180 / `GET .../media-candidates` :12864 |
| 12900–13500 | Transport v1 remaining, export readiness, submit-admin-review | transport v1 routes / `POST .../submit-admin-review` :13128 |
| 13500–14500 | Bulk pipeline runs, review queue, web-review feedback, backward transitions, translation runs | `POST /api/run/clean` :14062 / `GET /api/translation-runs` :14500 |
| 14500–15365 | Legacy run endpoints, quality/staging/exports, assets, upload, error handler, exports | `POST /api/run/approve` :14504 / `export { ... }` :15365 |
| 15367–15380 | Server startup: db.close on exit, app.listen | `process.once("exit", ...)` :15367 / `app.listen(...)` :15374 |

## 6. If you need to fix X, look here

Base paths: `collector/db/` for repository.mjs, `collector/services/` for workflow.mjs and others, `collector/server/` for index.mjs and UI files.

| What you're fixing | Main file |
|-------------------|-----------|
| Place ladder transition | `repository.mjs:510` |
| Assignment state stuck | `repository.mjs:5556` |
| AI draft generation fails | `workflow.mjs:2213` |
| Content not reaching backend | `index.mjs:13128` |
| Translation stuck or failing | `workflow.mjs:1560` |
| Transport v2 not rendering | `transport-v2-router.mjs:1958` |
| Item deletion blocked | `raw-delete.mjs:32` |
| Frontend not showing content | `backend/routes/placeRoutes.js:18` |

**กับดัก:**

1. Place ใช้ strict positional ladder (`repository.mjs:510`) ไม่ใช่ legacy flexible graph (`repository.mjs:483`); สลับกันจะ no-op เงียบ
   - `index.mjs:9138` (backward endpoint), `workflow-backward-transitions.js:20` (UI)

2. `updateAssignmentState()` side-effect `production_state` เฉพาะ field assignment บน place เท่านั้น
   - `repository.mjs:584` (assignment rules), `index.mjs:10996` (PATCH endpoint)

3. `validateCleanMinimum()` บล็อก generation ถ้า approved context หายไป
   - `clean-context.mjs:107` (context builder), `agent-generation.mjs:919` (engine)

4. ต้องมี env vars `COLLECTOR_SYNC_BACKEND_API` และ `COLLECTOR_PUBLIC_BASE_URL`; fail เงียบถ้า translation recheck ไม่ผ่าน
   - `review-ingest-mapping.mjs:1` (payload), `backend/routes/reviewContentRoutes.js:60` (ingest)

5. Fingerprint mismatch ที่ `workflow.mjs:268` ทำให้ stale detection; source content เปลี่ยน = translations ทั้งหมด invalid
   - `workflow.mjs:1659` (repair), `workflow.mjs:1200` (ready check)

6. OSRM resolution เป็น async; `routing_status` ค้าง `missing` จนกว่า `/resolve` สำเร็จ
   - `transport-v2-router.mjs:1992` (render-poster), `schema.sql:415` (resolved paths)

7. `REFERENCE_HARD_BLOCKER_DEFS` ที่ `repository.mjs:429` นิยาม permanent blockers ที่ override ไม่ได้
   - `raw-delete.mjs:65` (classify), `index.mjs:8050` (bulk-delete)

8. Frontend อ่านจาก Backend MySQL ไม่ใช่ Collector SQLite; content ต้อง ingest ก่อน
   - `frontend/app/[lang]/page.js` (homepage), `frontend/app/api/media-proxy/route.js:37` (proxy)

## 7. Things to know before touching

The Place production ladder at `repository.mjs:510` is intentionally stricter than the event/transport graph at `repository.mjs:483`; Place isolates `needs_revision`, `rejected`, `brief_generated`, and `content_in_progress` as terminal empty sets, using `place_review_flag` (`repository.mjs:468`) instead. The `state_version` column in `content_workflow_models` (`schema.sql:967`) is an optimistic concurrency token incremented on every transition; ignoring it causes lost updates. The `field_pack_assignments` table (`schema.sql:708`) is an optional supplementary table with no effect on display or guard logic; it is not a bug. The `close_assignment` action at `index.mjs:2833` has no UI caller; items stuck at `assigned` have no release path through the website. The `saveCurrentFieldPack()` function at `item-editor.js:4398` is confirmed dead code. The `article-intake` backward widget for `writing_assigned → field_review` has not been verified on Runtime because the dev DB has no item in that state.

## 8. หน้าจอไหนทำอะไร

Base path: `collector/server/public/`

| หน้า (html / js) | ใช้ตอนไหน | ปุ่มหลัก |
|-----------------|----------|---------|
| `index.html` / `app.js` | Login + เลือกบทบาทเข้าระบบ | ปุ่ม Login, ลิงก์เข้าแต่ละบทบาท |
| `place.html` / `place-page.js` | Hub หลักของ Place — เลือก process card | 3 ปุ่ม: จัดชุดข้อมูล, ส่งเข้า AI, ส่งงานเขียน |
| `item-editor.html` / `item-editor.js` | แก้ไข item + field pack + AI draft | btn-save, btn-next-ai, btn-next-export |
| `clean-item.html` / `item-editor.js` | ทำความสะอาดข้อมูล item (ใช้ js เดียวกับ item-editor) | btn-save (mark cleaned) |
| `article-intake.html` / `article-intake.js` | รับงานเขียน — สร้าง editorial assignment | ปุ่มรับงาน, backward transition |
| `article-workspace.html` / `article-workspace-page.js` | เขียนบทความ — แก้ไข draft | btn-save, ปุ่มส่งตรวจ |
| `article-submit.html` / `article-submit-page.js` | ตรวจบทความ + ส่งเข้า admin review | ปุ่ม approve, submit-admin-review |
| `article-preview.html` / `article-preview-page.js` | ดูตัวอย่างบทความก่อนส่ง | ปุ่มย้อนกลับ, ปุ่มส่ง |
| `field-brief.html` / `field-brief.js` | ดู brief สำหรับ field work | ปุ่มเริ่มงาน, ปุ่มส่ง deliverables |
| `editor-home.html` / `editor-home.js` | หน้าแรกของ editor — รายการงานที่ได้รับ | ลิงก์เข้า assignment แต่ละชิ้น |
| `freelance-home.html` / `freelance-home.js` | หน้าแรกของ freelance — รายการงานที่ได้รับ | ลิงก์เข้า assignment แต่ละชิ้น |
| `events.html` / `events-page.js` | รายการ events ทั้งหมด | ลิงก์เข้า event แต่ละชิ้น |
| `events-manager.html` / `events-manager-page.js` | จัดการ events — สร้าง/ลบ/merge | ปุ่มสร้าง, bulk delete, bulk merge |
| `event-workspace.html` / `event-workspace-page.js` | แก้ไข event detail | btn-save, ปุ่มส่งเข้า AI |
| `event-submit.html` / `event-submit-page.js` | ส่ง event เข้า admin review | ปุ่ม submit |
| `event-preview.html` / `event-preview-page.js` | ดูตัวอย่าง event | ปุ่มย้อนกลับ |
| `other-transport.html` / `other-transport-page.js` | จัดการ transport ประเภทอื่น (taxi, van) | ปุ่มสร้าง, แก้ไข |
| `transport.html` / `transport-page.js` | Hub หลักของ transport | ลิงก์เข้า transport map, v2 routes |
| `transport-map-workspace.html` / `transport-map-workspace-page.js` | แก้ไข transport map v1 | ปุ่มบันทึก, release |
| `transport-map-routes.html` / `transport-map-routes-page.js` | รายการ routes บน transport map v1 | ลิงก์เข้า route แต่ละชิ้น |
| `transport-map-review.html` / `transport-map-review-page.js` | ตรวจ transport map v1 ก่อน release | ปุ่ม approve, reject |
| `transport-v2-base-maps.html` / `transport-v2-base-maps-page.js` | จัดการ base maps ของ transport v2 | ปุ่มสร้าง, แก้ไข, render |
| `transport-v2-routes.html` / `transport-v2-routes-page.js` | รายการ routes ของ transport v2 | ลิงก์เข้า route แต่ละชิ้น |
| `transport-v2-routes-review.html` / `transport-v2-routes-review-page.js` | ตรวจ routes ของ transport v2 | ปุ่ม approve, reject |
| `transport-v2-path-editor.html` / `transport-v2-path-editor-page.js` | แก้ไข path/stops ของ transport v2 route | ปุ่มบันทึก, resolve, render-poster |
| `transport-v2-review.html` / `transport-v2-review-page.js` | ตรวจ transport v2 route ก่อน release | ปุ่ม approve, reject |
| `transport-v2-workspace.html` | Redirect ไป `transport-v2-path-editor.html` | ไม่มีปุ่ม (redirect) |
