# Runtime Schema vs. Baseline — Full Drift Diff

**Analysis Date:** 2026-07-29
**Branch:** codex/audit-schema-mismatch
**Sources compared:** `backend/migrations/reference/runtime-schema-2026-07-27.sql` (actual Runtime MySQL 8.0.46 `SHOW CREATE TABLE` snapshot, 27 July 2026) vs. `backend/migrations/000_baseline_schema.sql` (what the code expects on a fresh install)

**IMPORTANT:** All results below are based on a point-in-time snapshot dated 2026-07-27, not a live query. Confirm against the actual runtime database with `SHOW CREATE TABLE` / `information_schema.columns` before writing or running any migration.

---

## A. Column drift (24 tables compared, drift found in 6)

### categories
- `slug`: NOT NULL (baseline) vs nullable, no default (runtime)
- `created_at`: NOT NULL (baseline) vs nullable, `DEFAULT CURRENT_TIMESTAMP` (runtime)

### category_translations
- `title` varchar(255) NOT NULL (baseline) → **does not exist in runtime** (runtime has `name` varchar(255) DEFAULT NULL instead)
- `description` text (baseline) → **does not exist in runtime**
- `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP (baseline) → **does not exist in runtime**
- `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP (baseline) → **does not exist in runtime**
- `category_id`: NOT NULL (baseline) vs nullable (runtime)
- `lang`: varchar(8) (baseline) vs varchar(10) (runtime)

### places
- `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP (baseline) → **does not exist in runtime at all**

### place_translations
- `place_id`: NOT NULL (baseline) vs nullable (runtime)
- `lang`: varchar(8) (baseline) vs varchar(10) (runtime)
- `title`: NOT NULL (baseline) vs nullable (runtime)
- `meta_description`: varchar(320) (baseline) vs **TEXT** (runtime — type change)
- `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP (baseline) → **does not exist in runtime**
- `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP (baseline) → **does not exist in runtime**

### review_contents
- `handoff_snapshot_json` longtext, nullable — **exists in runtime, does not exist in baseline** (a fresh install from baseline would be missing this column)

### users
- `id`: bigint unsigned (baseline) vs **int** (runtime — narrower type, not unsigned)
- `email`: NOT NULL (baseline) vs nullable (runtime)
- `password`: NOT NULL (baseline) vs nullable (runtime)
- `role`: varchar(20) NOT NULL DEFAULT `'user'` (baseline) vs varchar(50) DEFAULT `'admin'` (runtime — length and default both differ)
- `managed_by_user_id`: bigint UNSIGNED (baseline) vs bigint, not unsigned (runtime)
- `created_at`: NOT NULL (baseline) vs nullable (runtime)

### No drift (18 tables)
analytics_events, collector_import_reviews, collector_import_review_actions, content_image_usages, content_purge_audit, events, event_translations, homepage_curation_layouts, media_assets, review_actions, review_content_assets, review_content_translations, transport_add_line_requests, transport_add_line_request_audit_logs, transport_route_audit_logs, transport_routes, transport_route_points, transport_route_stops — column sets match exactly (some tables differ only in column *order*, which has no functional effect).

---

## B. Table drift

None. All 24 tables from the baseline are present in the runtime snapshot, and vice versa.

---

## C. Index / constraint drift

- **categories**: unique key name differs — `uq_categories_slug` (baseline) vs `slug` (runtime). Cosmetic only.
- **category_translations**: baseline declares `UNIQUE KEY uq_category_lang (category_id, lang)` and no FK. Runtime has only a non-unique `KEY category_id (category_id)` (no uniqueness enforced on category_id+lang) plus an FK `category_translations_ibfk_1` (category_id → categories.id) that baseline does not declare at all.
- **places**: baseline declares `UNIQUE KEY uq_places_category_slug (category_id, slug)`, `KEY idx_places_slug (slug)`, `KEY idx_places_category_slug (category_id, slug)`, `KEY idx_places_approved (is_approved)`, and `CONSTRAINT fk_places_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT`. Runtime has only `KEY category_id (category_id)`, `KEY idx_places_is_emer (is_emer)`, and `CONSTRAINT places_ibfk_1 FOREIGN KEY (category_id) REFERENCES categories(id)` (no ON DELETE clause specified). Runtime is missing the unique constraint and 3 of the 4 baseline indexes.
- **place_translations**: `UNIQUE KEY uq_place_lang (place_id, lang)` matches by name on both sides. Runtime additionally has `CONSTRAINT place_translations_ibfk_1 FOREIGN KEY (place_id) REFERENCES places(id)` that baseline does not declare.
- **users**: unique key name differs — `uq_users_email` (baseline) vs `email` (runtime), cosmetic. Baseline declares `CONSTRAINT fk_users_managed_by_user FOREIGN KEY (managed_by_user_id) REFERENCES users(id) ON DELETE SET NULL`; **runtime has no FK constraint for managed_by_user_id at all** (only a matching index).

---

## D. Code references to baseline-only columns (candidates for live breakage)

| Column | Referenced at | Clause | Status |
|---|---|---|---|
| `category_translations.title` / `.description` | `backend/repositories/categoryRepository.js:13-14,18-19,32-33,37-38,52,62-63` | SELECT / INSERT / UPDATE | Confirmed in prior Layer-2 pass — live break (`GET /categories`, `GET /categories/:slug`, `POST /categories`, `PUT /categories/:slug` all fail with `Unknown column`) |
| `category_translations.created_at` / `.updated_at` | No references found anywhere in `backend/` | — | Not exercised by any code path |
| `places.updated_at` | `backend/services/homepageCurationService.js:864` — `p.updated_at` inside `searchHomepageCurationCandidates()`, where `p` = `places` (see `FROM places p` at line 871). Exposed via `GET /homepage-curation/candidates [internal]`. | SELECT | **New finding** — previously misclassified as a false positive because the earlier pass didn't do a full column-by-column diff of `places`. This query fails with `Unknown column 'p.updated_at'` → 500 whenever the candidates search runs with `type=place`. |
| `place_translations.created_at` / `.updated_at` | No references found anywhere in `backend/` | — | Not exercised by any code path |

---

## E. Repair mechanism check (per drifted table)

| Table / issue | Repair mechanism? | Detail |
|---|---|---|
| categories (slug/created_at nullability) | **None** | No `ALTER TABLE categories` found in any migration or bootstrap file. |
| category_translations (title/description/timestamps missing, nullability, lang length) | **None** | `migrations/001_schema_alignment_core.sql` uses `CREATE TABLE IF NOT EXISTS category_translations (...)`, which is a permanent no-op since the table already exists in runtime with a different shape. No `ALTER TABLE category_translations ADD COLUMN` exists anywhere in the codebase. |
| places.updated_at | **None** | Checked `contentGovernanceService.js` (only adds `is_emer`), `placeController.js`'s `ensureApprovalColumn()` (only adds `is_approved` and decision columns), and migrations `004`, `011`, `015`, `019`, `020` — none add `updated_at` to `places`. |
| places index/constraint drift (`uq_places_category_slug`, `idx_places_slug`, `idx_places_category_slug`, `idx_places_approved`) | **Exists** | `migrations/002_safe_constraints_if_missing.sql` adds all four idempotently via `information_schema` existence checks matched by exact name. Whether this migration has actually been applied to the runtime DB as of the 2026-07-27 snapshot cannot be determined from static reading alone — the snapshot does not show these objects present. |
| place_translations (nullability, lang length, meta_description type, timestamps missing) | **Partial / none** | `sharedSchemaBootstrap.js` only adds `meta_title`/`meta_description` columns if entirely missing (existence-check only) — since `meta_description` already exists (as TEXT instead of VARCHAR(320)), this mechanism does not correct its type. No mechanism fixes nullability, `lang` length, or adds `created_at`/`updated_at`. |
| review_contents.handoff_snapshot_json (runtime-only extra column) | N/A | This is a runtime-ahead-of-baseline drift, not a baseline-ahead-of-runtime gap, so the "repair" framing in this section doesn't directly apply. No code reference to this column was found anywhere in `backend/` — it appears to be an orphaned column with no corresponding baseline definition or application usage. |
| users (id type, email/password nullability, role length+default, managed_by_user_id unsigned, created_at nullability, missing FK) | **None** | `userRoleService.js`'s `ensureUserLifecycleColumns()` and migrations `005`, `006`, `007` all gate their `ALTER TABLE users ADD COLUMN` statements on column-existence checks only. Since every one of these columns already exists in runtime (just with a different type/nullability/default), none of these mechanisms ever correct the existing definition. |

---

## Migration-002 naming caveat (raw observation, not a conclusion)

`migrations/002_safe_constraints_if_missing.sql`'s check for the `category_translations` FK looks for a constraint named exactly `fk_category_translations_category` via `information_schema.key_column_usage`. Runtime's existing FK on that column is auto-named `category_translations_ibfk_1`. If migration 002 runs against the current runtime shape, its existence check would find zero matching rows (wrong name, not "no FK") and would attempt to add a second FK constraint on the same column. Not verified against a live database — noted here as raw evidence only.
# หมายเหตุ: ฐานข้อมูล `uboncity` ที่รายงานฉบับนี้บรรยายถูก retire แล้ว
