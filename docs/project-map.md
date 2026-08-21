<!-- generated from 0d88134d296ff33eaaafde5cc09a6aaee7ec8bbb on 2026-08-21 -->

## 1. Layout

- `collector/` — Internal content pipeline tool (Express 4 + SQLite); entry: `collector/server/index.mjs`
- `backend/` — Public REST API (Express 5 + MySQL); entry: `backend/server.js`
- `admin/` — Admin dashboard SPA (React 19 + Vite); entry: `admin/src/main.jsx`
- `frontend/` — Public website (Next.js 16 + React 19); entry: `frontend/app/layout.js`
- `scripts/` — Monorepo test orchestration & CI gate; entry: `scripts/testAll.mjs`
- `ops/` — Ops helper scripts (PowerShell); entry: `ops/windows/test-stack.ps1`
- `tests/` — not found (root-level `tests/` dir does not exist; tests live in `backend/tests/` and `collector/tests/`)
- `shared/` — Cross-cutting taxonomy catalog; entry: `shared/taxonomy/taxonomy-catalog.mjs`
- `docs/` — Project documentation & UAT checklists; no entry point

## 2. Entry Points

- root `npm run test:all` → `scripts/testAll.mjs:1`
- root `npm run gate` → `scripts/gate.mjs:1`
- backend `npm run dev` → `nodemon server.js` → `backend/server.js:1`
- backend `npm start` → `node server.js` → `backend/server.js:1`
- collector `npm start` → `node server/index.mjs` → `collector/server/index.mjs:1`
- collector `npm run dev` → `node --watch server/index.mjs` → `collector/server/index.mjs:1`
- collector `npm run pipeline` → `node pipeline/run.mjs` → `collector/pipeline/run.mjs:1`
- collector `npm run db:init` → `node scripts/init-db.mjs` → `collector/scripts/init-db.mjs:1`
- frontend `npm run dev` → `next dev` → `frontend/app/layout.js:1`
- frontend `npm run build` → `next build`
- admin `npm run dev` → `vite` → `admin/src/main.jsx:1`
- admin `npm run build` → `vite build`

## 3. Route Table

### 3A. Backend API (`backend/server.js`)

- GET `/api/categories` → `backend/routes/categoryRoutes.js:13` → `getCategories` — public
- GET `/api/categories/:slug` → `backend/routes/categoryRoutes.js:14` → `getCategoryDetail` — public
- POST `/api/categories` → `backend/routes/categoryRoutes.js:15` → `createCategory` — protect+authorizeOwner
- PUT `/api/categories/:slug` → `backend/routes/categoryRoutes.js:16` → `updateCategory` — protect+authorizeOwner
- DELETE `/api/categories/:slug` → `backend/routes/categoryRoutes.js:17` → `deleteCategory` — protect+authorizeOwner
- GET `/api/places` → `backend/routes/placeRoutes.js:18` → `getPlaces` — public
- GET `/api/places/:category/:slug/nearby` → `backend/routes/placeRoutes.js:19` → `getNearbyPlaces` — public
- GET `/api/places/:category/:slug` → `backend/routes/placeRoutes.js:20` → `getPlaceDetail` — public
- POST `/api/places` → `backend/routes/placeRoutes.js:21` → `createPlace` — protect+authorizeOwner
- POST `/api/places/import` → `backend/routes/placeRoutes.js:22` → `importPlaces` — protect+authorizeOwner
- POST `/api/places/import-csv` → `backend/routes/placeRoutes.js:23` → `importPlacesCsv` — protect+authorizeOwner
- PUT `/api/places/:id` → `backend/routes/placeRoutes.js:24` → `updatePlace` — protect+authorizeOwner
- PATCH `/api/places/:id/approve` → `backend/routes/placeRoutes.js:25` → `approvePlace` — protect+authorizeAdmin
- DELETE `/api/places/:id` → `backend/routes/placeRoutes.js:26` → `deletePlace` — protect+authorizeOwner
- GET `/api/events` → `backend/routes/eventRoutes.js:14` → `getEvents` — public
- GET `/api/events/:id` → `backend/routes/eventRoutes.js:15` → `getEventDetail` — public
- POST `/api/events` → `backend/routes/eventRoutes.js:16` → `createEvent` — protect+authorizeOwner
- PUT `/api/events/:id` → `backend/routes/eventRoutes.js:17` → `updateEvent` — protect+authorizeOwner
- PATCH `/api/events/:id/approve` → `backend/routes/eventRoutes.js:18` → `approveEvent` — protect+authorizeAdmin
- DELETE `/api/events/:id` → `backend/routes/eventRoutes.js:19` → `deleteEvent` — protect+authorizeOwner
- POST `/api/register` → `backend/routes/authRoutes.js:30` → `register` — protect+authorizeAdmin
- POST `/api/login` → `backend/routes/authRoutes.js:31` → `login` — loginRateLimit
- GET `/api/me` → `backend/routes/authRoutes.js:32` → `me` — protect
- GET `/api/users` → `backend/routes/userRoutes.js:19` → `getUsers` — protect
- GET `/api/users/:id` → `backend/routes/userRoutes.js:20` → `getUser` — protect+authorizeAdmin
- POST `/api/users` → `backend/routes/userRoutes.js:21` → `createUser` — protect
- PATCH `/api/users/:id` → `backend/routes/userRoutes.js:22` → `applyUserChanges` — protect
- POST `/api/users/:id/avatar` → `backend/routes/userRoutes.js:23` → `uploadUserAvatar` — protect
- DELETE `/api/users/:id/avatar` → `backend/routes/userRoutes.js:24` → `deleteUserAvatar` — protect
- PATCH `/api/users/:id/profile` → `backend/routes/userRoutes.js:25` → `updateUserProfile` — protect
- PATCH `/api/users/:id/role` → `backend/routes/userRoutes.js:26` → `updateUserRole` — protect+authorizeOwner
- PATCH `/api/users/:id/lifecycle` → `backend/routes/userRoutes.js:27` → `updateUserLifecycle` — protect+authorizeOwner
- PATCH `/api/users/:id/manager` → `backend/routes/userRoutes.js:28` → `updateUserManager` — protect+authorizeAdmin
- DELETE `/api/users/:id` → `backend/routes/userRoutes.js:29` → `deleteUser` — protect+authorizeOwner
- GET `/api/media-assets` → `backend/routes/mediaRoutes.js:17` → `listMediaAssets` — protect
- GET `/api/media-assets/:id` → `backend/routes/mediaRoutes.js:18` → `getMediaAssetDetail` — protect
- POST `/api/media-assets/register` → `backend/routes/mediaRoutes.js:19` → `registerMediaAsset` — protect+authorizeOwner
- POST `/api/media-assets/upload` → `backend/routes/mediaRoutes.js:20` → `uploadMediaAsset` — protect+authorizeOwner
- PATCH `/api/media-assets/:id` → `backend/routes/mediaRoutes.js:21` → `updateMediaAsset` — protect+authorizeOwner
- DELETE `/api/media-assets/:id` → `backend/routes/mediaRoutes.js:22` → `deleteMediaAsset` — protect+authorizeOwner
- GET `/api/media-usages` → `backend/routes/mediaRoutes.js:24` → `listMediaUsages` — protect
- POST `/api/media-usages` → `backend/routes/mediaRoutes.js:25` → `createMediaUsage` — protect+authorizeOwner
- DELETE `/api/media-usages/:id` → `backend/routes/mediaRoutes.js:26` → `deleteMediaUsage` — protect+authorizeOwner
- POST `/api/analytics/events` → `backend/routes/analyticsRoutes.js:13` → `createAnalyticsEvent` — public
- GET `/api/analytics/cta-summary` → `backend/routes/analyticsRoutes.js:14` → `getCtaSummary` — protect+authorizeAdmin
- GET `/api/analytics/top-entities` → `backend/routes/analyticsRoutes.js:15` → `getTopEntities` — protect+authorizeAdmin
- GET `/api/analytics/recent-events` → `backend/routes/analyticsRoutes.js:16` → `getRecentAnalyticsEvents` — protect+authorizeAdmin
- GET `/api/analytics/missing-cta` → `backend/routes/analyticsRoutes.js:17` → `getMissingCtaPlaces` — protect+authorizeAdmin
- POST `/api/review-content/ingest` → `backend/routes/reviewContentRoutes.js:60` → `ingestReviewContentAction` — requireCollectorTokenOrPrivilegedUser
- POST `/api/review-content/event-queue/enqueue` → `backend/routes/reviewContentRoutes.js:61` → `enqueueEventReviewQueueAction` — requireCollectorIngestToken
- GET `/api/review-content/source-status` → `backend/routes/reviewContentRoutes.js:62` → `getReviewContentStatusBySourceAction` — requireCollectorIngestToken
- GET `/api/review-content/:id` → `backend/routes/reviewContentRoutes.js:63` → `getReviewContentDetail` — protectReviewContentReadAccess
- POST `/api/review-content/:id/access-token` → `backend/routes/reviewContentRoutes.js:64` → `createReviewAccessTokenAction` — protect+authorizeEditorOrAdmin
- POST `/api/review-content/:id/approve` → `backend/routes/reviewContentRoutes.js:65` → `approveReviewContentAction` — protect+authorizeEditorOrAdmin
- POST `/api/review-content/:id/needs-revision` → `backend/routes/reviewContentRoutes.js:66` → `needsRevisionAction` — protect+authorizeEditorOrAdmin
- POST `/api/review-content/:id/reject` → `backend/routes/reviewContentRoutes.js:67` → `rejectAction` — protect+authorizeEditorOrAdmin
- POST `/api/review-content/legacy-needs-revision` → `backend/routes/reviewContentRoutes.js:68` → `legacyNeedsRevisionAction` — protect+authorizeEditorOrAdmin
- POST `/api/review-content/legacy-reject` → `backend/routes/reviewContentRoutes.js:69` → `legacyRejectAction` — protect+authorizeEditorOrAdmin
- POST `/api/upload/image` → `backend/routes/uploadRoutes.js:7` → `uploadImage` — protect+authorizeOwner
- DELETE `/api/upload/image` → `backend/routes/uploadRoutes.js:8` → `deleteImage` — protect+authorizeOwner
- POST `/api/translate/preview` → `backend/routes/translateRoutes.js:16` → `previewTranslateManual` — protect+authorizeOwner+translateRateLimit
- POST `/api/translate` → `backend/routes/translateRoutes.js:19` → `previewTranslateManual` — protect+authorizeOwner+translateRateLimit
- GET `/api/transport/config` → `backend/routes/transportRoutes.js:21` → `getTransportConfig` — public
- GET `/api/transport-routes` → `backend/routes/transportRoutes.js:22` → `getTransportRoutes` — public
- GET `/api/transport-routes/:id` → `backend/routes/transportRoutes.js:23` → `getTransportRouteById` — public
- POST `/api/transport-routes` → `backend/routes/transportRoutes.js:25` → `createTransportRoute` — protect+authorizeOwner
- PUT `/api/transport-routes/:id` → `backend/routes/transportRoutes.js:26` → `updateTransportRoute` — protect+authorizeOwner
- DELETE `/api/transport-routes/:id` → `backend/routes/transportRoutes.js:27` → `deleteTransportRoute` — protect+authorizeOwner
- POST `/api/transport-routes/import-collector` → `backend/routes/transportRoutes.js:28` → `importCollectorTransportRoutes` — public (sync token in body)
- POST `/api/transport-routes/import-geojson` → `backend/routes/transportRoutes.js:29` → `importTransportGeoJson` — protect+authorizeOwner
- GET `/api/transport-routes/export` → `backend/routes/transportRoutes.js:30` → `exportTransportRoutes` — protect+authorizeOwner
- POST `/api/transport-requests/add-line` → `backend/routes/transportRoutes.js:32` → `submitAddLineRequest` — protect
- GET `/api/transport-requests/add-line` → `backend/routes/transportRoutes.js:33` → `listAddLineRequests` — protect+authorizeOwner
- PATCH `/api/transport-requests/add-line/:id/review` → `backend/routes/transportRoutes.js:34` → `reviewAddLineRequest` — protect+authorizeOwner
- POST `/api/transport-requests/add-line/:id/apply` → `backend/routes/transportRoutes.js:35` → `applyAddLineRequest` — protect+authorizeOwner
- GET `/api/homepage-layout` → `backend/routes/homepageCurationRoutes.js:15` → `getPublishedHomepageLayoutHandler` — public
- GET `/api/homepage-curation/layout` → `backend/routes/homepageCurationRoutes.js:16` → `getHomepageCurationLayoutHandler` — protect+authorizeAdmin
- GET `/api/homepage-curation/taxonomy-catalog` → `backend/routes/homepageCurationRoutes.js:19` → `getHomepageCurationTaxonomyCatalogHandler` — protect+authorizeReviewContentInternal
- GET `/api/homepage-curation/candidates` → `backend/routes/homepageCurationRoutes.js:20` → `searchHomepageCurationCandidatesHandler` — protect+authorizeReviewContentInternal
- POST `/api/homepage-curation/preview` → `backend/routes/homepageCurationRoutes.js:21` → `previewHomepageCurationLayoutHandler` — protect+authorizeAdmin
- PUT `/api/homepage-curation/layout` → `backend/routes/homepageCurationRoutes.js:22` → `updateHomepageCurationLayoutHandler` — protect+authorizeAdmin
- POST `/api/homepage-curation/layout/publish` → `backend/routes/homepageCurationRoutes.js:23` → `publishHomepageCurationLayoutHandler` — protect+authorizeAdmin
- POST `/api/internal/ai/json` → `backend/routes/internalAiRoutes.js:23` → inline — requireLifecycleSyncToken
- GET `/api/integrations/readiness` → `backend/routes/integrationReadinessRoutes.js:6` → `getIntegrationReadiness` — public
- GET `/api/collector-import-reviews` → `backend/routes/importReviewRoutes.js:12` → `getCollectorImportReviewQueue` — protect+authorizeAdmin
- GET `/api/collector-import-reviews-deleted` → `backend/routes/importReviewRoutes.js:13` → `getDeletedContentHistory` — protect+authorizeAdmin
- GET `/api/collector-import-reviews/:id` → `backend/routes/importReviewRoutes.js:14` → `getCollectorImportReviewQueueDetail` — protect+authorizeAdmin
- PATCH `/api/collector-import-reviews/:id/reject` → `backend/routes/importReviewRoutes.js:15` → `rejectCollectorImportReview` — protect+authorizeAdmin

### 3B. Collector API (`collector/server/index.mjs`)

- GET `/` → `index.mjs:2751` → `renderCollectorRootHtml()` — public
- GET `/api/google-maps/photo` → `index.mjs:2757` → safeAsync inline — public
- GET `/api/health` → `index.mjs:7198` → inline — public
- GET `/api/integrations/readiness` → `index.mjs:7202` → inline — public
- POST `/api/auth/login` → `index.mjs:7221` → safeAsync inline — loginRateLimit
- POST `/api/auth/logout` → `index.mjs:7359` → inline — public
- GET `/api/auth/me` → `index.mjs:7364` → inline — requireAuth
- GET `/api/admin/runtime-diagnostics` → `index.mjs:7368` → inline — requireRole("owner")
- GET `/api/admin/assignment-health` → `index.mjs:7375` → safeAsync inline — requireRole("owner")
- GET `/api/users` → `index.mjs:7538` → safeAsync inline — requireAuth
- POST `/api/users/sync` → `index.mjs:7565` → safeAsync inline — requireRole("owner","admin")
- GET `/api/users/assignable` → `index.mjs:7600` → safeAsync inline — requireRole("owner","admin","user")
- POST `/api/users` → `index.mjs:7648` → inline — requireAuth
- PATCH `/api/users/:id/role` → `index.mjs:7655` → inline — requireRole("owner")
- PATCH `/api/users/:id/profile` → `index.mjs:7663` → inline — requireRole("owner","admin","user")
- POST `/api/users/avatar/upload` → `index.mjs:7732` → async inline — requireRole("owner","admin","user")+uploadRateLimit
- PATCH `/api/users/:id/password` → `index.mjs:7768` → inline — requireRole("admin","owner")
- DELETE `/api/users/:id` → `index.mjs:7779` → inline — requireRole("owner")
- GET `/api/config` → `index.mjs:7785` → inline — requireRole("owner")
- GET `/api/workflow-states` → `index.mjs:7801` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/ai-feature-policies` → `index.mjs:7810` → inline — requireRole("owner")
- GET `/api/ai-feature-policies/runtime` → `index.mjs:7823` → inline — requireRole("owner")
- PUT `/api/ai-feature-policies/:featureKey` → `index.mjs:7846` → inline — requireRole("owner")
- GET `/api/agent-profiles` → `index.mjs:7902` → inline — requireRole("owner")
- GET `/api/agent-profiles/:agentKey` → `index.mjs:7910` → inline — requireRole("owner")
- PUT `/api/agent-profiles/:agentKey` → `index.mjs:7919` → inline — requireRole("owner")
- POST `/api/agent-profiles/:agentKey/reset` → `index.mjs:7946` → inline — requireRole("owner")
- GET `/api/items` → `index.mjs:7964` → inline — public (scope-filtered)
- GET `/api/items/blocker-summary` → `index.mjs:8010` → inline — requireRole("owner","admin","user")
- POST `/api/items/bulk-delete` → `index.mjs:8050` → inline — requireRole("admin","owner")
- POST `/api/items/bulk-category` → `index.mjs:8131` → inline — requireRole("admin","owner")
- POST `/api/items/bulk-merge` → `index.mjs:8154` → inline — requireRole("admin","owner")
- GET `/api/items/:id` → `index.mjs:8184` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/items` → `index.mjs:8290` → inline — requireRole("owner","admin")
- POST `/api/events-manager/items` → `index.mjs:8209` → inline — requireRole("owner","admin","user")
- POST `/api/other-transport/items` → `index.mjs:8250` → inline — requireRole("owner","admin","user")
- POST `/api/items/:id/claim` → `index.mjs:8576` → inline — requireRole("owner","admin","user")
- POST `/api/items/:id/release` → `index.mjs:8624` → inline — requireRole("admin","user")
- POST `/api/items/:id/takeover` → `index.mjs:8667` → inline — requireRole("admin")
- PUT `/api/items/:id` → `index.mjs:8721` → inline — requireRole("admin","user")
- POST `/api/items/:id/place-ready-for-content` → `index.mjs:8773` → inline — requireRole("owner","admin","user")
- PUT `/api/items/:id/editor-work` → `index.mjs:8822` → inline — requireRole("owner","admin","editor","user")
- POST `/api/items/:id/seo-suggestion` → `index.mjs:8963` → async inline — requireRole("owner","admin","editor","user")
- POST `/api/items/:id/article-suggestion` → `index.mjs:9022` → safeAsync inline — requireRole("owner","admin","editor","user")
- GET `/api/items/:id/workflow-model` → `index.mjs:9101` → inline — requireRole("owner","admin","editor","user")
- GET `/api/items/:id/workflow/backward-transitions` → `index.mjs:9121` → inline — requireRole("owner","admin","editor","user")
- POST `/api/items/:id/workflow/backward-transitions` → `index.mjs:9138` → inline — requireRole("owner","admin","user")
- GET `/api/items/:id/article-process` → `index.mjs:9247` → inline — requireRole("owner","admin","editor","user")
- POST `/api/items/:id/article-process/transition` → `index.mjs:9264` → safeAsync inline — requireRole("owner","admin","editor","user")
- POST `/api/items/:id/article-process/submit-review` → `index.mjs:9318` → inline — requireRole("owner","admin","editor","user")
- GET `/api/items/:id/transitions` → `index.mjs:9489` → inline — requireRole("admin","user")
- GET `/api/items/:id/audit-logs` → `index.mjs:9521` → inline — requireRole("admin","user")
- PUT `/api/items/:id/workflow-model` → `index.mjs:9547` → inline — requireRole("owner","admin","user")
- GET `/api/items/:id/intelligence-model/latest` → `index.mjs:9613` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/items/:id/intelligence-model` → `index.mjs:9631` → inline — requireRole("admin")
- GET `/api/items/:id/readiness/latest` → `index.mjs:9654` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/items/:id/brief/latest` → `index.mjs:9673` → inline — requireRole("owner","admin","user")
- POST `/api/items/:id/recompute-readiness-brief` → `index.mjs:9692` → inline — requireRole("admin","user")
- GET `/api/items/:id/execution-controls/latest` → `index.mjs:9732` → inline — requireRole("admin","user")
- POST `/api/items/:id/recompute-execution-controls` → `index.mjs:9759` → inline — requireRole("admin","user")
- GET `/api/items/:id/execution-channels` → `index.mjs:9790` → inline — requireRole("admin","user")
- GET `/api/items/:id/execution-readiness` → `index.mjs:9813` → inline — requireRole("admin","user")
- GET `/api/items/:id/execution-readiness/:channel` → `index.mjs:9836` → inline — requireRole("admin","user")
- POST `/api/items/:id/execution-readiness/evaluate` → `index.mjs:9864` → inline — requireRole("admin","user")
- GET `/api/items/:id/governance-summary` → `index.mjs:9906` → inline — requireRole("admin","user")
- POST `/api/items/:id/governance-summary/evaluate` → `index.mjs:9929` → inline — requireRole("admin","user")
- GET `/api/items/:id/execution-channels/:channel/latest` → `index.mjs:9965` → inline — requireRole("admin","user")
- POST `/api/items/:id/execution-channels` → `index.mjs:9995` → inline — requireRole("admin","user")
- POST `/api/items/:id/execution-channels/:channel/validate-latest` → `index.mjs:10034` → inline — requireRole("admin","user")
- POST `/api/items/:id/execution-channels/:channel/generate` → `index.mjs:10081` → async inline — requireRole("admin","user")
- GET `/api/items/:id/assignments` → `index.mjs:10322` → inline — requireRole("owner","admin","user")
- POST `/api/items/:id/article-editorial-assignments` → `index.mjs:10341` → inline — requireRole("owner","admin","user")
- POST `/api/items/:id/article-editorial-assignments/:assignmentId/request-revision` → `index.mjs:10493` → inline — requireRole("owner","admin","user")
- POST `/api/items/:id/assignments` → `index.mjs:10555` → inline — requireRole("admin","user")
- POST `/api/items/:id/assignments/from-readiness` → `index.mjs:10165` → inline — requireRole("owner")
- GET `/api/items/:id/search-enrichment` → `index.mjs:12180` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/items/:id/search-enrichment` → `index.mjs:12201` → inline — requireRole("admin")
- POST `/api/items/:id/recompute-intelligence` → `index.mjs:12226` → inline — requireRole("admin")
- GET `/api/items/:id/place-intelligence` → `index.mjs:12262` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/place-intelligence/top` → `index.mjs:12288` → inline — public
- GET `/api/items/:id/social-signals` → `index.mjs:12300` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/items/:id/social-signals` → `index.mjs:12320` → inline — requireRole("admin")
- GET `/api/items/:id/momentum` → `index.mjs:12345` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/items/:id/momentum/recompute` → `index.mjs:12372` → inline — requireRole("admin")
- POST `/api/items/:id/recompute-content-direction` → `index.mjs:12402` → inline — requireRole("admin")
- GET `/api/items/:id/content-direction` → `index.mjs:12431` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/content-direction/top` → `index.mjs:12451` → inline — public
- GET `/api/items/:id/evidence-blocks` → `index.mjs:12473` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/items/:id/evidence-blocks` → `index.mjs:12499` → inline — requireRole("admin","user")
- GET `/api/items/:id/approved-context` → `index.mjs:12524` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/items/:id/approved-context` → `index.mjs:12545` → inline — requireRole("admin","user")
- PATCH `/api/items/:id/approved-context/:contextId` → `index.mjs:12572` → inline — requireRole("admin","user")
- GET `/api/items/:id/field-pack/current` → `index.mjs:12604` → inline — requireRole("owner","admin","editor","freelance","user")
- POST `/api/items/:id/field-packs` → `index.mjs:12655` → inline — requireRole("owner","admin","user")
- PUT `/api/field-packs/:fieldPackId` → `index.mjs:12691` → inline — requireRole("owner","admin","user")
- POST `/api/items/:id/field-pack/regenerate` → `index.mjs:12739` → async inline — requireRole("owner","admin","user")+workflowRateLimit
- GET `/api/items/:id/draft-input-preview` → `index.mjs:12826` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/items/:id/media-candidates` → `index.mjs:12864` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/transport-map/config` → `index.mjs:8325` → inline — requireRole("owner","admin","user")
- GET `/api/transport-map-routes` → `index.mjs:8347` → inline — requireRole("owner","admin")
- GET `/api/transport-map-routes/:id` → `index.mjs:8357` → inline — requireRole("owner","admin","user")
- POST `/api/transport-map-routes` → `index.mjs:8374` → inline — requireRole("owner","admin")
- PUT `/api/transport-map-routes/:id` → `index.mjs:8421` → inline — requireRole("owner","admin","user")
- POST `/api/transport-map-routes/:id/release-main` → `index.mjs:8489` → safeAsync inline — requireRole("owner","admin")+workflowRateLimit
- GET `/api/assignments/mine` → `index.mjs:10749` → inline — requireRole("owner","admin","editor","freelance","user")
- GET `/api/assignments/:id` → `index.mjs:10878` → inline — requireRole("owner","admin","editor","freelance","user")
- GET `/api/assignments/:id/draft` → `index.mjs:10897` → inline — requireRole("owner","admin","editor","freelance","user")
- PUT `/api/assignments/:id/draft` → `index.mjs:10930` → inline — requireRole("owner","admin","editor","freelance","user")
- DELETE `/api/assignments/:id/draft` → `index.mjs:10967` → inline — requireRole("owner","admin","editor","freelance","user")
- PATCH `/api/assignments/:id/state` → `index.mjs:10996` → async inline — requireRole("owner","admin","user")
- POST `/api/assignments/:id/return-to-field` → `index.mjs:11136` → async inline — requireRole("owner","admin","user")
- POST `/api/assignments/:id/submissions` → `index.mjs:11230` → inline — requireRole("owner","admin","editor","freelance","user")
- GET `/api/assignments/:id/submissions` → `index.mjs:11382` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/assignments/:id/deliverables` → `index.mjs:11406` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/assignments/:id/deliverables/latest-bundle` → `index.mjs:11430` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/assignments/:id/deliverables/utility-readiness` → `index.mjs:11469` → inline — requireRole("admin","user")
- POST `/api/assignments/:id/deliverables/utility-readiness/evaluate` → `index.mjs:11493` → inline — requireRole("admin","user")
- GET `/api/assignments/:id/deliverables/review-decision` → `index.mjs:11532` → inline — requireRole("admin","user")
- POST `/api/assignments/:id/deliverables/review-decision/evaluate` → `index.mjs:11556` → inline — requireRole("admin","user")
- GET `/api/assignments/:id/submission-decision` → `index.mjs:11596` → inline — requireRole("admin","user")
- POST `/api/assignments/:id/submission-decision/evaluate` → `index.mjs:11620` → inline — requireRole("owner","admin","user")
- GET `/api/assignments/:id/deliverables/governance-summary` → `index.mjs:11679` → inline — requireRole("owner","admin","user")
- POST `/api/assignments/:id/deliverables/governance-summary/evaluate` → `index.mjs:11703` → inline — requireRole("owner","admin","user")
- GET `/api/assignments/:id/handoff-governance` → `index.mjs:11761` → inline — requireRole("admin","user")
- POST `/api/assignments/:id/handoff-governance/evaluate` → `index.mjs:11785` → inline — requireRole("admin","user")
- GET `/api/assignments/:id/submissions/:submissionId/deliverables` → `index.mjs:11842` → inline — requireRole("owner","admin","editor","user","freelance")
- POST `/api/assignments/:id/submissions/:submissionId/deliverables` → `index.mjs:11877` → inline — requireRole("owner","admin","editor","user","freelance")
- GET `/api/assignments/:id/deliverables/summary` → `index.mjs:11937` → inline — requireRole("admin","user","freelance")
- POST `/api/assignments/:id/deliverables/summary/evaluate` → `index.mjs:11961` → inline — requireRole("admin","user","freelance")
- GET `/api/assignments/:id/deliverables/readiness` → `index.mjs:11999` → inline — requireRole("admin","user","freelance")
- POST `/api/assignments/:id/deliverables/readiness/evaluate` → `index.mjs:12023` → inline — requireRole("admin","user","freelance")
- GET `/api/assignments/:id/handoff-source` → `index.mjs:12062` → inline — requireRole("admin","user","freelance")
- GET `/api/assignments/:id/history` → `index.mjs:12110` → inline — requireRole("owner","admin","editor","user","freelance")

### 3C. Collector MCP (`collector/server/mcp/index.mjs`)

- POST `/api/mcp/` → `mcp/index.mjs:247` → `handleJsonRpcRequest` — requireRole("owner","admin","editor","user")
- POST `/api/mcp-chatgpt-test/` → `mcp/index.mjs:262` → `handleJsonRpcRequest` — token query param

### 3D. Collector Transport V2 (`collector/server/transport-v2-router.mjs`)

- GET `/api/v2/transport/base-maps` → `transport-v2-router.mjs:1131` — allow("owner","admin","editor","user")
- POST `/api/v2/transport/base-maps` → `transport-v2-router.mjs:1144` — allow("owner","admin")
- PUT `/api/v2/transport/base-maps/:id` → `transport-v2-router.mjs:1223` — allow("owner","admin")
- POST `/api/v2/transport/base-maps/:id/render-annotation` → `transport-v2-router.mjs:1329` — allow("owner","admin")
- POST `/api/v2/transport/base-maps/:id/render-published` → `transport-v2-router.mjs:1344` — allow("owner","admin")
- GET `/api/v2/transport/base-maps/:id/labels` → `transport-v2-router.mjs:1582` — allow("owner","admin","editor","user")
- PUT `/api/v2/transport/base-maps/:id/labels` → `transport-v2-router.mjs:1588` — allow("owner","admin")
- POST `/api/v2/transport/base-maps/:id/labels/translate` → `transport-v2-router.mjs:1655` — allow("owner","admin")
- POST `/api/v2/transport/base-maps/:id/overlays/image` → `transport-v2-router.mjs:1730` — allow("owner","admin")+upload.single
- GET `/api/v2/transport/label-layouts` → `transport-v2-router.mjs:1359` — allow("owner","admin","editor","user")
- GET `/api/v2/transport/label-layouts/:id` → `transport-v2-router.mjs:1368` — allow("owner","admin","editor","user")
- POST `/api/v2/transport/label-layouts` → `transport-v2-router.mjs:1377` — allow("owner","admin")
- PUT `/api/v2/transport/label-layouts/:id` → `transport-v2-router.mjs:1406` — allow("owner","admin")
- GET `/api/v2/transport/label-layouts/:id/labels` → `transport-v2-router.mjs:1447` — allow("owner","admin","editor","user")
- PUT `/api/v2/transport/label-layouts/:id/labels` → `transport-v2-router.mjs:1453` — allow("owner","admin")
- POST `/api/v2/transport/label-layouts/:id/labels/translate` → `transport-v2-router.mjs:1494` — allow("owner","admin")
- GET `/api/v2/transport/routes` → `transport-v2-router.mjs:1768` — allow("owner","admin","editor","user")
- POST `/api/v2/transport/routes` → `transport-v2-router.mjs:1772` — allow("owner","admin")
- GET `/api/v2/transport/routes/:id` → `transport-v2-router.mjs:1805` — allow("owner","admin","editor","user")
- PUT `/api/v2/transport/routes/:id` → `transport-v2-router.mjs:1811` — allow("owner","admin","editor","user")
- POST `/api/v2/transport/routes/:id/thumbnail` → `transport-v2-router.mjs:1861` — allow("owner","admin","editor","user")+upload.single
- PUT `/api/v2/transport/routes/:id/control-points` → `transport-v2-router.mjs:1918` — allow("owner","admin","editor","user")
- PUT `/api/v2/transport/routes/:id/stops` → `transport-v2-router.mjs:1938` — allow("owner","admin","editor","user")
- POST `/api/v2/transport/routes/:id/resolve` → `transport-v2-router.mjs:1958` — allow("owner","admin","editor","user")
- POST `/api/v2/transport/routes/:id/render-poster` → `transport-v2-router.mjs:1992` — allow("owner","admin","editor","user")

### 3E. Frontend API (`frontend/app/api/`)

- GET `/api/media-proxy` → `frontend/app/api/media-proxy/route.js:37` → `GET` — public
- POST `/api/review-session` → `frontend/app/api/review-session/route.js:4` → `POST` — public (sets httpOnly cookie)
- GET `/api/review-media` → `frontend/app/api/review-media/route.js:37` → `GET` — public

## 4. Core Modules

### 4A. `collector/server/index.mjs` (15,482 lines)

- exports: none (Express app entry point, all logic is local functions)
- `resolveCollectorAssetVersionForFile()` → `index.mjs:154`
- `scorePlaceInterestingness()` → `index.mjs:1088`
- `mergeContentItems()` → `index.mjs:2209`
- `purgeDeletedItemTx()` → `index.mjs:1916`
- `sanitizeArticleRichTextHtml()` → `index.mjs:972`
- `renderCollectorRootHtml()` → `index.mjs:264`
- `resolvePlaceLadderWorkflowPatch()` → `index.mjs:4267`
- `transitionArticleProcessState()` → `index.mjs:4196`
- `mapArticleProcessStatusToWorkflowPatch()` → `index.mjs:4519`
- `finalizeArticleProcessReadyForSync()` → `index.mjs:4321`
- `applyPublishedWebReviewFeedback()` → `index.mjs:14206`

### 4B. `collector/services/workflow.mjs` (2,873 lines)

- `parseImportText(format, text)` → `workflow.mjs:126` — parse JSON/CSV import text
- `buildSourceFingerprint(article)` → `workflow.mjs:251` — SHA1 fingerprint for translation source
- `isTranslationSourceFingerprintMismatch(row, currentSourceFingerprint)` → `workflow.mjs:268`
- `isTranslationRowStale(row, currentSourceFingerprint)` → `workflow.mjs:274`
- `isTranslationTechnicalReady(row, currentSourceFingerprint)` → `workflow.mjs:1200`
- `isTranslationRecheckPassed(row, currentSourceFingerprint)` → `workflow.mjs:1206`
- `getCurrentTranslationSourceFingerprint(repo, contentItemId)` → `workflow.mjs:1211`
- `rerunProblemTranslations(repo, actorEmail, options)` → `workflow.mjs:1560`
- `rerunTranslationRecheck(repo, actorEmail, options)` → `workflow.mjs:1611`
- `repairTranslationFromRecheckIssues(repo, contentItemId, lang, aiConfig, actorEmail)` → `workflow.mjs:1659`
- `repairAndRecheckTranslationFromIssues(repo, contentItemId, lang, aiConfig, actorEmail)` → `workflow.mjs:1762`
- `runCleanStage(repo, actorEmail)` → `workflow.mjs:1789` — clean pipeline stage
- `buildFieldPackPayloadFromAgent(fieldPack, existingFieldPack, options)` → `workflow.mjs:1994`
- `saveAgentFieldPack(repo, item, fieldPack, actorEmail, options)` → `workflow.mjs:2175`
- `runAiDraftStage(repo, actorEmail, options)` → `workflow.mjs:2213` — AI draft pipeline stage
- `runQualityStage(repo, actorEmail, options)` → `workflow.mjs:2556` — quality checks pipeline stage
- `applyReviewAction(repo, actorEmail, payload)` → `workflow.mjs:2647` — approve/reject/request_changes
- `returnFieldPackToClean(repo, actorEmail, payload)` → `workflow.mjs:2744`
- `reopenReviewDecision(repo, actorEmail, payload)` → `workflow.mjs:2759`
- `reviewInternalLink(repo, actorEmail, suggestionId, action)` → `workflow.mjs:2825`

### 4C. `collector/db/repository.mjs` (12,947 lines)

- `normalizeReferenceMediaUrl(value)` → `repository.mjs:65` — canonicalize reference media URL
- `REFERENCE_HARD_BLOCKER_DEFS` → `repository.mjs:429` — frozen array of hard-blocker definitions
- `PRODUCTION_STATES` → `repository.mjs:440` — Set of 16 production state names
- `PUBLICATION_STATES` → `repository.mjs:458` — Set of 6 publication state names
- `ASSIGNMENT_STATES` → `repository.mjs:459` — Set of 7 assignment state names
- `PLACE_REVIEW_FLAGS` → `repository.mjs:468` — Set of 3 place review flag values
- `PLACE_BACKWARD_PRODUCTION_TRANSITIONS` → `repository.mjs:541` — frozen backward transition map
- `TRANSITION_RULES` → `repository.mjs:575` — frozen per-content-type transition graphs
- `mapWorkflowStatusToModelStates(workflowStatus)` → `repository.mjs:666` — legacy status mapper
- `hasRecognizedEvaluationOverrideInput(raw)` → `repository.mjs:2104`
- `resolveActiveAssignmentWorkBatchRows(rows)` → `repository.mjs:2819`
- `createRepository(db)` → `repository.mjs:2855` — factory returning 200+ methods
- `canTransition(contentType, stateGroup, fromState, toState)` → `repository.mjs:4753`
- `assertValidTransition(contentType, stateGroup, fromState, toState)` → `repository.mjs:4788`
- `recordWorkflowTransition(contentItemId, stateGroup, fromState, toState, ...)` → `repository.mjs:4796`
- `listLegalBackwardProductionTransitions(contentType, fromState)` → `repository.mjs:4769`
- `updateAssignmentState()` → `repository.mjs:5556`

### 4D. Other Collector Services

- `normalizeFieldPack(input, options)` → `collector/services/agent-generation.mjs:138`
- `resizeImageBuffer(buffer, originalMime)` → `collector/services/agent-generation.mjs:324`
- `createAgentGenerationEngine(aiConfig)` → `collector/services/agent-generation.mjs:919`
- `buildArticleSuggestionRequestContext(...)` → `collector/services/article-agent.mjs:80`
- `normalizeArticleSuggestion(input)` → `collector/services/article-agent.mjs:115`
- `buildArticleSuggestionPrompt(input, agentProfileText)` → `collector/services/article-agent.mjs:138`
- `isBackendAiConfigured(aiConfig)` → `collector/services/backend-ai-client.mjs:20`
- `executeBackendAiJson({...})` → `collector/services/backend-ai-client.mjs:26`
- `computeCompleteness(item, approvedBlocks, imageContext)` → `collector/services/clean-context.mjs:66`
- `buildCleanStructuredContext(repo, contentItemId, options)` → `collector/services/clean-context.mjs:107`
- `validateCleanMinimum(repo, contentItemId)` → `collector/services/clean-context.mjs:210`
- `buildCleanContextSummary(repo, contentItemId)` → `collector/services/clean-context.mjs:238`
- `buildFieldPackContractFromCleanContext(cleanContext)` → `collector/services/clean-context.mjs:498`
- `generateExecutionChannelForItem(repo, contentItemId, channel, options)` → `collector/services/execution-generation.mjs:203`
- `isActiveAssignmentCandidate(candidate, candidates)` → `collector/services/publishable-assignment-candidate.mjs:26`
- `getPublishableAssignmentStateRank(value)` → `collector/services/publishable-assignment-candidate.mjs:31`
- `selectBestPublishableAssignmentCandidate(candidates)` → `collector/services/publishable-assignment-candidate.mjs:36`
- `isSelectedAssignmentAccepted(candidate)` → `collector/services/publishable-assignment-candidate.mjs:59`
- `sweepPurgedDeliverableAssets(assetIds, deleteUnusedAsset, options)` → `collector/services/purge-asset-sweep.mjs:1`
- `getNeverOverrideBlockersForItem(db, itemId)` → `collector/services/raw-delete.mjs:32`
- `classifyPurgeGroups(groups)` → `collector/services/raw-delete.mjs:65`
- `planDeletedItemPurge(classified, confirmedOverrides)` → `collector/services/raw-delete.mjs:77`
- `planBulkItemDelete(rows, dependencies)` → `collector/services/raw-delete.mjs:125`
- `stripHtmlToPlainText(value, maxLen)` → `collector/services/seo-agent.mjs:25`
- `normalizeSeoSuggestion(input)` → `collector/services/seo-agent.mjs:51`
- `buildSeoSuggestionRequestContext(sourceInput, item, sanitizeHtml)` → `collector/services/seo-agent.mjs:72`
- `buildSeoSuggestionPrompt(input, agentProfileText)` → `collector/services/seo-agent.mjs:97`

## 5. Data Model

### 5A. Collector Schema (`collector/database/schema.sql`)

- `users` → `schema.sql:3` — user accounts (email, role, password_hash, managed_by)
- `content_items` → `schema.sql:15` — core entity (places/events/transport; title, geo, tags, claim)
- `source_records` → `schema.sql:46` — external source data per content_item
- `reviews_raw` → `schema.sql:61` — raw review text from external sources
- `content_versions` → `schema.sql:71` — version history of cleaned content
- `quality_checks` → `schema.sql:86` — quality gate results per content_item
- `staging_items` → `schema.sql:96` — items staged for export
- `export_jobs` → `schema.sql:107` — export job tracking
- `assets` → `schema.sql:118` — media asset registry (storage, mime, checksum)
- `asset_variants` → `schema.sql:131` — image variants (thumbnails)
- `content_assets` → `schema.sql:143` — M:N link content_items↔assets
- `content_asset_name_sequences` → `schema.sql:163` — per-item asset naming counter
- `content_reference_media_selections` → `schema.sql:170` — selected reference media for AI
- `pipeline_runs` → `schema.sql:185` — pipeline execution log
- `audit_logs` → `schema.sql:197` — system-wide audit trail
- `collector_sync_state` → `schema.sql:212` — key-value sync state store
- `source_ingestions` → `schema.sql:219` — source ingestion batch tracking
- `source_raw_items` → `schema.sql:231` — raw ingested items before normalization
- `source_raw_media` → `schema.sql:248` — raw media URLs for source_raw_items
- `transport_base_maps_v2` → `schema.sql:264` — base map definitions (bounds, viewbox, projection)
- `transport_base_map_labels_v2` → `schema.sql:296` — labels on base maps
- `transport_label_layouts_v2` → `schema.sql:313` — named label layout configurations
- `transport_label_layout_items_v2` → `schema.sql:323` — individual label items within layouts
- `transport_routes_v2` → `schema.sql:344` — transport route definitions (name, vehicle, color, statuses)
- `transport_route_control_points_v2` → `schema.sql:382` — ordered GPS control points
- `transport_route_stops_v2` → `schema.sql:398` — named stops along a route
- `transport_route_resolved_paths_v2` → `schema.sql:415` — OSRM-resolved route geometry
- `transport_route_poster_paths_v2` → `schema.sql:433` — simplified geometry for poster rendering
- `transport_route_render_jobs_v2` → `schema.sql:450` — render job queue for route posters
- `evidence_blocks` → `schema.sql:467` — evidence/fact blocks per content_item
- `approved_context_blocks` → `schema.sql:491` — editor-approved evidence excerpts
- `draft_input_snapshots` → `schema.sql:517` — frozen input snapshots for AI draft
- `generation_runs` → `schema.sql:533` — AI generation run tracking
- `content_drafts` → `schema.sql:547` — AI-generated drafts (title, body, quality score)
- `review_reports` → `schema.sql:576` — automated review scoring
- `field_packs` → `schema.sql:597` — field work packages (summary, story angle, curation status)
- `field_pack_checklists` → `schema.sql:651` — checklist items within field_packs
- `field_pack_references` → `schema.sql:671` — reference URLs for field_packs
- `field_pack_media_hints` → `schema.sql:689` — media hints for field work
- `field_pack_assignments` → `schema.sql:708` — assignment links for field_packs
- `review_actions` → `schema.sql:732` — review action log per content_item
- `internal_link_suggestions` → `schema.sql:744` — suggested internal links between items
- `publish_runs` → `schema.sql:761` — publish job tracking
- `published_articles` → `schema.sql:772` — final published article snapshots
- `content_translations` → `schema.sql:798` — translated content per language
- `translation_runs` → `schema.sql:841` — translation job batch tracking
- `search_enrichment_records` → `schema.sql:858` — web search enrichment data
- `place_intelligence_scores` → `schema.sql:878` — place intelligence scores
- `social_signal_sources` → `schema.sql:897` — social media signal collection
- `social_momentum_snapshots` → `schema.sql:915` — social momentum tracking per platform
- `content_direction_reports` → `schema.sql:934` — content direction analysis
- `content_workflow_models` → `schema.sql:957` — core state machine head per content_item
- `content_workflow_transitions` → `schema.sql:984` — transition audit log
- `content_assignments` → `schema.sql:1004` — work assignments (field/editorial)
- `content_assignment_submissions` → `schema.sql:1040` — submission records per assignment
- `content_assignment_submission_drafts` → `schema.sql:1062` — auto-saved drafts for submissions
- `content_assignment_submission_deliverables` → `schema.sql:1080` — individual deliverables
- `content_intelligence_models` → `schema.sql:1104` — content intelligence scoring
- `content_readiness_briefs` → `schema.sql:1138` — readiness assessment
- `content_execution_controls` → `schema.sql:1154` — execution constraints
- `review_submission_snapshots` → `schema.sql:1174` — immutable submission snapshots
- `content_execution_channels` → `schema.sql:1195` — channel-specific content versions
- `content_assignment_handoff_snapshots` → `schema.sql:1216` — handoff packages for assignments
- `ai_feature_policies` → `schema.sql:1233` — AI feature policy configuration
- `agent_profiles` → `schema.sql:1242` — AI agent profiles

### 5B. Backend Schema (`backend/migrations/000_baseline_schema.sql`)

- `analytics_events` → `000_baseline_schema.sql:15` — click tracking events (MAP/PHONE/LINE/FACEBOOK/WEBSITE_CLICK)
- `categories` → `000_baseline_schema.sql:31` — content categories (slug only)
- `category_translations` → `000_baseline_schema.sql:40` — category names/descriptions per language
- `collector_import_reviews` → `000_baseline_schema.sql:54` — import review queue
- `collector_import_review_actions` → `000_baseline_schema.sql:81` — action log for import reviews
- `content_purge_audit` → `000_baseline_schema.sql:95` — audit trail for content deletion
- `events` → `000_baseline_schema.sql:112` — public events
- `event_translations` → `000_baseline_schema.sql:137` — event translations
- `homepage_curation_layouts` → `000_baseline_schema.sql:152` — homepage layout curation
- `media_assets` → `000_baseline_schema.sql:168` — media library
- `content_image_usages` → `000_baseline_schema.sql:200` — image usage tracking
- `places` → `000_baseline_schema.sql:219` — public places (category, slug, CTA fields)
- `place_translations` → `000_baseline_schema.sql:261` — place translations
- `review_contents` → `000_baseline_schema.sql:277` — review content from collector
- `review_actions` → `000_baseline_schema.sql:326` — review content action log
- `review_content_assets` → `000_baseline_schema.sql:344` — assets attached to review content
- `review_content_translations` → `000_baseline_schema.sql:374` — translations for review content
- `transport_add_line_requests` → `000_baseline_schema.sql:395` — user-submitted add-line requests
- `transport_add_line_request_audit_logs` → `000_baseline_schema.sql:415` — audit log for add-line requests
- `transport_route_audit_logs` → `000_baseline_schema.sql:431` — transport route audit
- `transport_routes` → `000_baseline_schema.sql:450` — transport routes
- `transport_route_points` → `000_baseline_schema.sql:477` — ordered GPS points for routes
- `transport_route_stops` → `000_baseline_schema.sql:490` — named stops for routes
- `users` → `000_baseline_schema.sql:504` — user accounts
- `ai_usage_log` → `000_baseline_schema.sql:521` — AI API usage tracking

## 6. State Machines

- PRODUCTION_STATES → `repository.mjs:440` — values: collected, analyzed, brief_generated, ready_for_content, field_working, field_review, writing_assigned, writing, content_in_progress, generated, in_review, needs_revision, ready_for_publish, submitted_for_admin_review, rejected, completed
- PUBLICATION_STATES → `repository.mjs:458` — values: draft, approved, published, unpublished, archived, deleted
- ASSIGNMENT_STATES → `repository.mjs:459` — values: assigned, in_progress, submitted, revision_requested, resubmitted, accepted, closed
- ASSIGNMENT_SUBMISSION_STATES → `repository.mjs:460` — values: submitted, resubmitted
- ASSIGNMENT_DELIVERABLE_TYPES → `repository.mjs:461` — values: photos, videos, raw_notes, caption_draft, script_draft, article_draft
- ASSIGNMENT_DELIVERABLE_STATUSES → `repository.mjs:462` — values: draft, submitted, reviewed, accepted, rejected
- ASSIGNMENT_KINDS → `repository.mjs:466` — values: field, editorial
- PLACE_REVIEW_FLAGS → `repository.mjs:468` — values: none, revision_requested, rejected
- EXECUTION_CHANNELS → `repository.mjs:470` — values: facebook, tiktok
- EXECUTION_STATUSES → `repository.mjs:471` — values: draft, generated, validated, ready, blocked, superseded
- field_packs.status CHECK → `schema.sql:603` — values: draft, ready_for_field, field_in_progress, field_done, on_hold
- field_pack_checklists.status CHECK → `schema.sql:660` — values: todo, doing, done, skip
- field_pack_checklists.type CHECK → `schema.sql:654` — values: must_verify_fact, must_capture, must_ask_question
- content_drafts.confirmed_meta_status CHECK → `schema.sql:560` — values: not_started, in_review, confirmed
- field_packs.curation_status CHECK → `schema.sql:624` — values: not_started, in_review, curated
- transport_routes_v2.workflow_status → `schema.sql:353` — default: draft
- transport_routes_v2.routing_status → `schema.sql:357` — default: missing
- transport_routes_v2.poster_status → `schema.sql:359` — default: missing
- review_contents.status (backend) → `000_baseline_schema.sql:284` — values: draft, pending_review, needs_revision, rejected, published
- review_actions.action_type (backend) → `000_baseline_schema.sql:330` — values: ingested, approved, needs_revision, rejected, reingested
- media_assets.status (backend) → `000_baseline_schema.sql:173` — values: pending, approved, rejected, archived
- analytics_events.event_type (backend) → `000_baseline_schema.sql:17` — values: MAP_CLICK, PHONE_CLICK, LINE_CLICK, FACEBOOK_CLICK, WEBSITE_CLICK
- content_image_usages.usage_type (backend) → `000_baseline_schema.sql:205` — values: cover, gallery, inline
- user roles (backend) → `backend/services/userRoleService.js:4` — values: owner, admin, editor, freelance, user
- user roles (collector) → `schema.sql:10` + `index.mjs` — values: owner, admin, editor, user, freelance, system
- TRANSITION_RULES (place production) → `repository.mjs:510` — 12 states, strict positional ladder
- TRANSITION_RULES (event/transport production) → `repository.mjs:483` — legacy flexible graph
- TRANSITION_RULES (publication) → `repository.mjs:499` — 6-state publication graph
- ASSIGNMENT_TRANSITION_RULES → `repository.mjs:584` — 7-state assignment lifecycle

## 7. Place Ladder

| Step | Route Up | Handler | Service Fn | UI Markup+Binding | Edge Down |
|------|----------|---------|------------|-------------------|-----------|
| collected→analyzed | `POST /api/run/clean` → `index.mjs:14062` | inline | `runCleanStage()` → `workflow.mjs:1789` | `btn-save` with `btn-next-ai` → `item-editor.js:5745` | not available as backward |
| analyzed→generated | `POST /api/run/ai-draft` → `index.mjs:14067` | inline | `runAiDraftStage()` → `workflow.mjs:2213` | `btn-next-ai` → `item-editor.js:5788` | `POST /api/items/:id/workflow/backward-transitions` → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| generated→ready_for_content | `POST /api/items/:id/place-ready-for-content` → `index.mjs:8773` | inline | `repo.upsertWorkflowModel()` → `repository.mjs:4946` | `btn-next-export` → `item-editor.js:5820` | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| ready_for_content→field_working | `POST /api/items/:id/assignments` → `index.mjs:10555` | inline | `repo.createAssignmentFromReadiness()` → `repository.mjs:9051` | handoff queue assignment creation → `place.html:154` | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| field_working→field_review | `PATCH /api/assignments/:id/state` → `index.mjs:10996` | inline | `repo.updateAssignmentState()` → `repository.mjs:5556` | assignment submission → `POST /api/assignments/:id/submissions` → `index.mjs:11230` | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| field_review→writing_assigned | `POST /api/items/:id/article-editorial-assignments` → `index.mjs:10341` | inline | `repo.createAssignmentWithWorkflow()` via `resolvePlaceLadderWorkflowPatch()` → `index.mjs:4267` | article-intake page → `place.html:168` → `btn-open-place-write` | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| writing_assigned→writing | `POST /api/items/:id/article-process/transition` → `index.mjs:9264` | inline | `transitionArticleProcessState()` → `index.mjs:4196` → `mapArticleProcessStatusToWorkflowPatch("drafting")` → `index.mjs:4548` | article-workspace → `article-workspace.js` start drafting | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| writing→in_review | `POST /api/items/:id/article-process/submit-review` → `index.mjs:9318` | inline | `transitionArticleProcessState()` → `index.mjs:4196` → `mapArticleProcessStatusToWorkflowPatch("ready_for_review")` → `index.mjs:4519` | article-submit page → `article-submit-page.js` submit button | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| in_review→ready_for_publish | `POST /api/items/:id/article-process/transition` → `index.mjs:9264` (status: ready_for_sync) | inline | `finalizeArticleProcessReadyForSync()` → `index.mjs:4321` → `applyReviewAction()` → `workflow.mjs:2647` | article-submit page → approve+sync action | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| ready_for_publish→submitted_for_admin_review | `POST /api/items/:id/submit-admin-review` → `index.mjs:13128` | inline | `repo.upsertWorkflowModel()` → `repository.mjs:4946` | article-submit page → submit for admin review button | backward → `index.mjs:9138`; UI → `workflow-backward-transitions.js:20` |
| submitted_for_admin_review→completed | `POST /api/web-review-feedback` → `index.mjs:14241` | inline | `applyPublishedWebReviewFeedback()` → `index.mjs:14206` | not found (backend-driven event) | terminal (no backward) |

## 8. Gaps

- `close_assignment` (`index.mjs:2833`, `PATCH /api/assignments/:id/state`) — has no UI caller in any state; items stuck at `assigned` have no release path through the website
- `saveCurrentFieldPack()` (`item-editor.js:4398`) — confirmed dead code, no remaining caller
- `POST /api/run/clean` (`index.mjs:14062`) — no direct UI button; only callable as admin bulk pipeline run or via `PUT /api/items/:id` with `workflow_action: "mark_cleaned"`
- `POST /api/run/ai-draft` (`index.mjs:14067`) — UI button exists (`btn-next-ai`) but the route itself is also callable as bulk pipeline run
- `submitted_for_admin_review→completed` — no collector UI button; transition is backend-driven via `POST /api/web-review-feedback` or `POST /api/items/:id/pull-web-publication-status`
- `article-intake backward widget` (`writing_assigned→field_review`) — not verified on Runtime; dev DB has no item in `writing_assigned` state
- `renderStepFourNextPanel()` (`item-editor.js:4696`) and `applyEditorActionGuards()` (`item-editor.js:234`) — duplicate `getEditPermissionGuard()`/`getEditorAssignmentGuard()` computation; undocumented invariant
- `POST /api/transport-routes/import-collector` (`backend/routes/transportRoutes.js:28`) — public endpoint with sync token in body, not standard auth guard
