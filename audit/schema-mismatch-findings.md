# Layer-2 Deep Findings — Schema Mismatch & Swallowed Errors

**Analysis Date:** 2026-07-28
**Branch:** codex/audit-schema-mismatch
**Input:** audit/schema-mismatch-scan.md (Layer-1 scan)
**Scope:** Read-only analysis. No code changes, no patches proposed.

---

## Key correction to Layer-1 report

L1's Section A claimed "0 mismatches / 294 queries verified" — but that check was performed against the **idealized** baseline (`000_baseline_schema.sql`) union'd with the bootstrap/lazy-creator functions, not against the **actual runtime schema**.

`backend/migrations/reference/runtime-schema-2026-07-27.sql` is a `SHOW CREATE TABLE` snapshot of Runtime MySQL 8.0.46 taken 2026-07-27. Its own `backend/migrations/reference/README.md` states: *"Known schema drift remains: `category_translations` has the wrong shape, and `users.role` defaults to `'admin'`."*

Re-checking column references against this real snapshot (rather than the idealized DDL) surfaces one live, real bug that L1 missed.

---

## A. Schema reference classification

| # | Item | Reference | Effective schema resolution | Classification | Notes |
|---|---|---|---|---|---|
| 1 | `categoryRepository.js:13-14,18-19,32-33,37-38,52,62-63` | `ct_lang.title`, `ct_lang.description`, `ct_th.title`, `ct_th.description` | **Does not exist in production.** Real `category_translations` = `(id, category_id, lang, name)` only (`runtime-schema-2026-07-27.sql:24-32`). Baseline SQL / `001_schema_alignment_core.sql` assume `(title, description, created_at, updated_at, UNIQUE(category_id,lang))`, but since the table already exists in prod, `CREATE TABLE IF NOT EXISTS` is a permanent no-op — nothing ever ALTERs `name`→`title` or adds `description`. | **บั๊กจริง (real bug)** | Breaks: `GET /categories`, `GET /categories/:slug`, `POST /categories [owner]`, `PUT /categories/:slug [owner]` — all fail with `Unknown column 'title'` → 500. `DELETE /categories/:slug [owner]` unaffected (never touches title/description). |
| 2 | `users.role` default `'user'` (code) vs. runtime default `'admin'` (`runtime-schema-2026-07-27.sql:463`) | `users.role` | Column exists; only DEFAULT differs. Every `INSERT INTO users` found explicitly supplies `role`, so the DB default is currently never exercised. | **false positive** (for column-existence purposes) | See Adjacent Findings — latent risk, not a live break. |
| 3 | `events.is_emer`, `places.is_emer` | unconditional use in `eventController.js`, `placeController.js` | Present — self-healed at boot by `contentGovernanceService.js:ensureContentGovernanceInfrastructure()`, confirmed in runtime dump lines 126, 221. | **false positive** | Not added by the named `ensureEventsTable`/`ensureApprovalColumn`, but a third function adds it unconditionally on every boot. |
| 4 | `media_assets.width`, `.height` | `eventController.js:90-91,118-119`, `placeController.js:443-444,471-472` | Present in baseline, `sharedSchemaBootstrap.js`, and runtime dump (lines 174-175). | **false positive** | Clean across all three sources. |
| 5 | `places`/`review_contents` decision & tracking columns (`decision_featured_score`, `decision_scenario_tags`, `tracking_entity_type`, transport/location fields, `google_place_id`, etc.) | `placeController.js`, `homepageCurationService.js`, `reviewIngestService.js`, `reviewDecisionService.js` | All present in baseline, `ensureApprovalColumn()` DECISION_COLUMN_DEFINITIONS, and runtime dump lines 198-224/292-321. | **false positive** | Full column-by-column cross-check confirmed. |
| 6 | `review_content_assets`, `review_content_translations`, `review_actions`, `collector_import_review_actions`, `transport_add_line_requests`/`_audit_logs`, `transport_route_audit_logs`, `analytics_events` | dozens of columns across `reviewIngestService.js`, `collectorImportReviewService.js`, `reviewDecisionService.js`, `transportController.js`, `analyticsController.js` | All present in baseline + runtime dump. | **false positive** | No name mismatches found. |
| 7 | Task-example references: `p.updated_at`, `ma.width`, `ct_lang.title` | see items above | `p.updated_at` and `ma.width` exist; `ct_lang.title` does not. | Mixed — see items 1 and 4 | Directly resolves the three examples named in the original task. |

**Classification breakdown:** 1 real bug, 6 false-positive groups (covering dozens of individual references), 0 dead code, 0 needs-more-info.

**Method:** Independently re-swept `backend/controllers`, `backend/services`, `backend/repositories` for all query sites (not relying on L1's aggregate claim), cross-referenced against baseline ∪ `sharedSchemaBootstrap.js` ∪ `ensureEventsTable` ∪ `ensureCategoryTables` ∪ `ensureTransportSchema` ∪ `ensureHomepageCurationTables` ∪ `ensureUserLifecycleColumns` ∪ `ensureApprovalColumn` ∪ `ensureContentGovernanceInfrastructure` ∪ the actual `runtime-schema-2026-07-27.sql` snapshot.

---

## B. Swallowed-error catch blocks ranked by severity

| Rank | File:Line | Endpoint(s) guarded | Logging | Why this severity |
|---|---|---|---|---|
| **1** | `categoryController.js:44-46` (getCategories), `:57-59` (getCategoryDetail) | `GET /categories` (public), `GET /categories/:slug` (public) | None — `err` never referenced | **Most dangerous.** Public, unauthenticated, currently 500ing in production right now (Task A item 1), and completely invisible in logs. Active incident, zero observability. |
| **2** | `categoryController.js:80-82` (createCategory), `:122-124` (updateCategory DB-op catch) | `POST /categories [owner]`, `PUT /categories/:slug [owner]` | None | Also broken by the same live schema drift. Lower traffic (owner-only) than #1, but still active and invisible. |
| **3** | `authController.js:272-274` (`me`) | `GET /me [auth]` | None — bare `catch {}`, no error variable bound at all | Not currently broken, but likely the highest-frequency authenticated endpoint (session hydration on every page load). Any future DB blip is 100% invisible. |
| 4 | `analyticsController.js` ~131, ~171, ~229, ~260, ~319 | `POST /analytics/events` (public, high-frequency), 4x `[admin]` reads | Extracts `err.message` for 400s, never logs on 500 fallback | `POST /analytics/events` fires on every CTA click site-wide; silent write failures would degrade analytics undetected. |
| 5 | `categoryController.js:134-138` (deleteCategory) | `DELETE /categories/:slug [owner]` | Substring check on `err.message` only | Owner-only, low frequency, and not affected by the schema drift (delete never touches title/description). |
| 6 | `eventController.js:698-704` (deleteEvent/purge) | `DELETE /events/:id [owner]` | Message-substring dispatch only | Owner-only, infrequent, but hides genuine data-integrity failures. |
| 7 | `importReviewController.js:52-56, 68-72, 88-93` | `GET /collector-import-reviews* [admin]`, `PATCH .../reject [admin]` | Checks one specific message string, swallows everything else | Admin-only internal tooling, lower call volume. |
| 8 | `mediaController.js:374-381` | `GET /media-assets [auth]` | Partially logs — `console.error("mediaController failure", err)` fires on the 500 path; only the 400 client-validation branch skips logging | Least severe — genuine 500s are already visible in logs. |

---

## Adjacent findings (out of scope for this audit, flagged for follow-up)

- `users.role` DB-level default is `'admin'` in production vs `'user'` in code — currently harmless (every INSERT supplies `role` explicitly) but a latent privilege-escalation trap if any future code path omits it.
- `is_emer` self-healing for `events`/`places` depends entirely on `ensureContentGovernanceInfrastructure()` running after `ensureEventsTable()`/`ensureApprovalColumn()` in `server.js`'s boot order — fragile; if boot order ever changes, this silently stops working while `ensureEventsTable`/`ensureApprovalColumn` alone would look intact.
- `users`, `categories`, and `places` have no `CREATE TABLE` definition anywhere in code or migrations (per `backend/migrations/reference/README.md`) — they predate the migration system, so their "baseline" has never actually been validated against a real deploy.

---

## Open questions

- If `runtime-schema-2026-07-27.sql` is stale by the time this is acted on, item A.1's live-break status should be re-verified with a fresh `SHOW CREATE TABLE category_translations` on the runtime DB.
# หมายเหตุ: ฐานข้อมูล `uboncity` ที่รายงานฉบับนี้บรรยายถูก retire แล้ว
