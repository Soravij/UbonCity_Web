# Category translations usage audit

Audit scope: repository source under `backend/`, `frontend/`, `admin/`, `collector/`, and migration/reference files. This was a source-only audit: no application code was changed and no database connection was made. The runtime-shape evidence below is the checked-in `SHOW CREATE TABLE` snapshot dated 2026-07-27, not a fresh live-database query.

Classification in section B uses `READ` and `WRITE` only for data SQL. Table-definition and constraint statements are marked `DDL` (neither a data read nor a data write).

## A. Every backend reference to `category_translations`

### Runtime data access

| File:line | Enclosing function | SQL context | Path |
|---|---|---|---|
| `backend/repositories/categoryRepository.js:10-20` | `listCategories` | `SELECT c.id, c.slug, COALESCE(ct_lang.title, ct_th.title, c.slug) AS title, COALESCE(ct_lang.description, ct_th.description, NULL) AS description ... FROM categories c LEFT JOIN category_translations ct_lang ON ct_lang.category_id=c.id AND ct_lang.lang=? LEFT JOIN category_translations ct_th ON ct_th.category_id=c.id AND ct_th.lang='th' ORDER BY c.id ASC` | public, through `GET /api/categories` |
| `backend/repositories/categoryRepository.js:29-40` | `getCategoryBySlug` | Same two `COALESCE` expressions and two joins; additionally `WHERE c.slug=? LIMIT 1` | public, through `GET /api/categories/:slug` |
| `backend/repositories/categoryRepository.js:47-55` | `createCategoryWithTranslation` | `INSERT INTO category_translations (category_id, lang, title, description) VALUES (?,?,?,?)` | owner/admin, through `POST /api/categories` |
| `backend/repositories/categoryRepository.js:60-68` | `upsertCategoryTranslation` | `INSERT INTO category_translations (category_id, lang, title, description) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description)` | owner/admin, through `PUT /api/categories/:slug` |
| `backend/repositories/categoryRepository.js:75-89` | `deleteCategoryBySlug` | `DELETE FROM category_translations WHERE category_id=?` | owner/admin, through `DELETE /api/categories/:slug`; this statement does not name `title`, `description`, or `name` |

### Runtime/lazy bootstrap

| File:line | Enclosing function | SQL context | Path |
|---|---|---|---|
| `backend/controllers/categoryController.js:17-34` | `ensureCategoryTables` | `CREATE TABLE IF NOT EXISTS category_translations (...)` with `title VARCHAR(255) NOT NULL` and `description TEXT NULL` | internal/bootstrap; invoked from every category controller action before its repository work |

The controller calls are at `backend/controllers/categoryController.js:39`, `51`, `71`, `101`, and `129`. The server mounts the routes below `/api` at `backend/server.js:74`.

### Migrations and schema/constraint SQL

| File:line | Enclosing SQL block | SQL context | Path |
|---|---|---|---|
| `backend/migrations/000_baseline_schema.sql:39-50` | baseline table declaration | `CREATE TABLE IF NOT EXISTS category_translations` with `title` and `description` | internal/migration |
| `backend/migrations/001_schema_alignment_core.sql:4-13` | core-alignment table declaration | `CREATE TABLE IF NOT EXISTS category_translations` with `title` and `description` | internal/migration |
| `backend/migrations/002_safe_constraints_if_missing.sql:105-125` | category-language index blocks | `information_schema.statistics` checks, followed by dynamic `CREATE UNIQUE INDEX ... ON category_translations (category_id, lang)` and `CREATE INDEX ... ON category_translations (lang)` | internal/migration |
| `backend/migrations/002_safe_constraints_if_missing.sql:151-163` | category foreign-key block | `information_schema.key_column_usage` check, followed by dynamic `ALTER TABLE category_translations ADD CONSTRAINT ... FOREIGN KEY (category_id)` | internal/migration |
| `backend/migrations/reference/golden-fresh-install-schema.sql:30-40` | historical fresh-install declaration | `CREATE TABLE category_translations` with `title` and `description` | reference-only schema snapshot; not executable migration |

### Checked-in runtime schema reference

| File:line | SQL context | Path |
|---|---|---|
| `backend/migrations/reference/runtime-schema-2026-07-27.sql:24-32` | `CREATE TABLE category_translations` showing columns `id`, `category_id`, `lang`, and `name` | reference-only runtime snapshot; not executable migration |
| `backend/migrations/reference/README.md:3-5` | labels the snapshot as `SHOW CREATE TABLE` output from Runtime MySQL 8.0.46 on 2026-07-27 and records category-translations schema drift | reference-only documentation |

### Files searched with no table reference

`backend/config/sharedSchemaBootstrap.js` has no `category_translations` reference. Its `ensureSharedSchemaBootstrap` function creates/repairs `place_translations`, `event_translations`, `media_assets`, and `content_image_usages` only (`backend/config/sharedSchemaBootstrap.js:3-134`). It is run at server startup (`backend/server.js:96`), but it does not create, alter, inspect, or query `category_translations`.

No further `category_translations` references were found in backend controllers, services, routes, bootstrap/ensure files, tests, or scripts; none were found in `frontend/`, `admin/`, or `collector/` code. Historical root/audit documents and the migration reference files are excluded from that runtime-code statement and are listed where relevant above.

## B. Column usage classification: `title`, `description`, and `name`

| Column | File:line and enclosing function/block | Operation | Classification | Path | Exact usage |
|---|---|---|---|---|---|
| `title` | `backend/repositories/categoryRepository.js:13`, `listCategories` | `SELECT` expression | READ | public | `COALESCE(ct_lang.title, ct_th.title, c.slug) AS title` |
| `description` | `backend/repositories/categoryRepository.js:14`, `listCategories` | `SELECT` expression | READ | public | `COALESCE(ct_lang.description, ct_th.description, NULL) AS description` |
| `title` | `backend/repositories/categoryRepository.js:32`, `getCategoryBySlug` | `SELECT` expression | READ | public | `COALESCE(ct_lang.title, ct_th.title, c.slug) AS title` |
| `description` | `backend/repositories/categoryRepository.js:33`, `getCategoryBySlug` | `SELECT` expression | READ | public | `COALESCE(ct_lang.description, ct_th.description, NULL) AS description` |
| `title` | `backend/repositories/categoryRepository.js:52-54`, `createCategoryWithTranslation` | `INSERT` column/value | WRITE | owner/admin | value is the `title` function argument |
| `description` | `backend/repositories/categoryRepository.js:52-54`, `createCategoryWithTranslation` | `INSERT` column/value | WRITE | owner/admin | value is `description || null` |
| `title` | `backend/repositories/categoryRepository.js:62-67`, `upsertCategoryTranslation` | `INSERT` column/value and `ON DUPLICATE KEY UPDATE` assignment | WRITE | owner/admin | insert value is the `title` argument; update is `title=VALUES(title)` |
| `description` | `backend/repositories/categoryRepository.js:62-67`, `upsertCategoryTranslation` | `INSERT` column/value and `ON DUPLICATE KEY UPDATE` assignment | WRITE | owner/admin | insert value is `description || null`; update is `description=VALUES(description)` |
| `title` | `backend/controllers/categoryController.js:25`, `ensureCategoryTables` | column definition | DDL | internal/bootstrap | `title VARCHAR(255) NOT NULL` |
| `description` | `backend/controllers/categoryController.js:26`, `ensureCategoryTables` | column definition | DDL | internal/bootstrap | `description TEXT NULL` |
| `title` | `backend/migrations/000_baseline_schema.sql:44`, baseline declaration | column definition | DDL | internal/migration | `` `title` varchar(255) NOT NULL `` |
| `description` | `backend/migrations/000_baseline_schema.sql:45`, baseline declaration | column definition | DDL | internal/migration | `` `description` text `` |
| `title` | `backend/migrations/001_schema_alignment_core.sql:8`, alignment declaration | column definition | DDL | internal/migration | `title VARCHAR(255) NOT NULL` |
| `description` | `backend/migrations/001_schema_alignment_core.sql:9`, alignment declaration | column definition | DDL | internal/migration | `description TEXT NULL` |
| `title` | `backend/migrations/reference/golden-fresh-install-schema.sql:35`, historical fresh-install declaration | column definition | DDL/reference | reference-only | `` `title` varchar(255) NOT NULL `` |
| `description` | `backend/migrations/reference/golden-fresh-install-schema.sql:36`, historical fresh-install declaration | column definition | DDL/reference | reference-only | `` `description` text `` |
| `name` | `backend/migrations/reference/runtime-schema-2026-07-27.sql:28`, runtime snapshot | column definition | DDL/reference | reference-only | `` `name` varchar(255) DEFAULT NULL `` |

`title`, `description`, and `name` do not occur in a `WHERE`, `ORDER BY`, or table `JOIN` condition for `category_translations`; the joins use `category_id` and `lang` only. There are no test/script data accesses to any of the three columns.

## C. Direct answers

### Write paths for `title` and `description`

Yes. There are two data write paths, both owner-only routes:

| Endpoint | Route/access control | Controller -> repository | Written fields |
|---|---|---|---|
| `POST /api/categories` | `protect`, `authorizeOwner`, and `logOwnerOverrideAction("category.create")` at `backend/routes/categoryRoutes.js:15` | `createCategory` (`backend/controllers/categoryController.js:62-83`) -> `createCategoryWithTranslation` (`backend/repositories/categoryRepository.js:47-58`) | inserts `title`; inserts `description || null` |
| `PUT /api/categories/:slug` | `protect`, `authorizeOwner`, and `logOwnerOverrideAction("category.update")` at `backend/routes/categoryRoutes.js:16` | `updateCategory` (`backend/controllers/categoryController.js:85-125`) -> `upsertCategoryTranslation` (`backend/repositories/categoryRepository.js:60-69`) | inserts both fields or updates both using `VALUES(...)`; `description` input becomes `null` when falsy |

The validators make `title` required and permit `description` to be omitted/null: `backend/validators/categoryValidator.js:8-16` and `25-33`.

### Public reads

`title` and `description` are read by public API routes, not only by owner/curation routes:

| Endpoint | Route evidence | Read evidence |
|---|---|---|
| `GET /api/categories?lang=...` | no auth middleware at `backend/routes/categoryRoutes.js:13`; mounted under `/api` at `backend/server.js:74` | `getCategories` returns `listCategories(lang)` at `backend/controllers/categoryController.js:37-46`; SELECT expressions are at `backend/repositories/categoryRepository.js:13-19` |
| `GET /api/categories/:slug?lang=...` | no auth middleware at `backend/routes/categoryRoutes.js:14` | `getCategoryDetail` returns `getCategoryBySlug(...)` at `backend/controllers/categoryController.js:49-59`; SELECT expressions are at `backend/repositories/categoryRepository.js:32-39` |

### `name` usage

For the category table specifically, no runtime code reads or writes `category_translations.name`. The only category-table `name` occurrence is the historical runtime-schema reference at `backend/migrations/reference/runtime-schema-2026-07-27.sql:28`.

The repository has unrelated generic uses of a property/column named `name`; these are not mapped to or selected from `category_translations`. One frontend generic fallback exists in `frontend/lib/schemaMetadata.js:113-115` (`entity?.title || entity?.name || entity?.meta_title || fallback`), but no frontend category API client supplies category-table records to it.

### NULL handling and public response shape

The read SQL has these explicit behaviors:

| Field returned by category API | Expression | Result when translation values are NULL/missing |
|---|---|---|
| `title` | `COALESCE(ct_lang.title, ct_th.title, c.slug)` at `backend/repositories/categoryRepository.js:13` and `32` | falls back from requested language to Thai, then to `categories.slug`; the API title expression itself is not NULL if `c.slug` is non-NULL |
| `description` | `COALESCE(ct_lang.description, ct_th.description, NULL)` at `backend/repositories/categoryRepository.js:14` and `33` | falls back from requested language to Thai; if neither has a non-NULL description, the SQL result is NULL and `res.json` returns that field as JSON `null` |

There is no `name` fallback in either query. `description || null` is used only on the two write paths, not as a read fallback.

### Frontend/public-site consumption

No frontend/public-site code calls `/api/categories` or `/api/categories/:slug`, and no frontend component/page renders a category API record's `title`, `description`, or `name`. `frontend/lib/api.js` defines requests for places, place details, nearby places, events, and homepage layout; its relevant API functions begin at `frontend/lib/api.js:82`, `96`, `110`, `130`, and `143`, with no category API function. Searches of `frontend/`, `admin/`, and `collector/` found no `/categories` API usage.

Therefore there is no current frontend rendering outcome for a NULL category `title` or `description`. At the API boundary, the documented source behavior is: title has the `slug` fallback above; description can be delivered as `null`.

## D. Checked-in schema evidence and bootstrap mechanisms

### Actual schema reference

`backend/migrations/reference/runtime-schema-2026-07-27.sql:24-32` is the checked-in `SHOW CREATE TABLE` snapshot. It declares `category_translations(id, category_id, lang, name)` and does not declare `title` or `description`. `backend/migrations/reference/README.md:3-5` identifies this as a reference-only runtime snapshot and records that this table has schema drift.

### Files that declare `title` / `description` for the table

| File | `title`/`description` declaration | Mechanism | Behavior for an already-existing table |
|---|---|---|---|
| `backend/migrations/000_baseline_schema.sql:40-50` | lines 44-45 | `CREATE TABLE IF NOT EXISTS` | Does not alter an existing table; therefore does not add either column to an existing `category_translations`. The header states this baseline is for a blank database (`:1-12`). |
| `backend/migrations/001_schema_alignment_core.sql:4-13` | lines 8-9 | `CREATE TABLE IF NOT EXISTS` | Does not alter an existing table; this file has no `ALTER TABLE category_translations ADD COLUMN ...` or `information_schema.columns` check for either field. |
| `backend/controllers/categoryController.js:20-32` | lines 25-26 | lazy `CREATE TABLE IF NOT EXISTS` guarded in-process by `ensuredCategoryTables` | Does not alter an existing table. When the query succeeds, line 34 sets the process-local flag, so later category requests in that process skip even this DDL call. |

### Other category-table migration mechanisms

`backend/migrations/002_safe_constraints_if_missing.sql` does query `information_schema`, but only for indexes and a foreign key, not columns:

- `:105-114` checks `information_schema.statistics` for `uq_category_translations_category_lang`, then dynamically creates the unique index if absent.
- `:116-125` checks `information_schema.statistics` for `idx_category_translations_lang`, then dynamically creates the index if absent.
- `:151-163` checks `information_schema.key_column_usage` for `fk_category_translations_category`, then dynamically adds that foreign key if absent.

It has no `information_schema.columns` check and no `ALTER TABLE category_translations ADD COLUMN title` or `... description` statement.

`backend/config/sharedSchemaBootstrap.js` is run during startup (`backend/server.js:96`) and uses `CREATE TABLE IF NOT EXISTS`, `SHOW COLUMNS`, and `ALTER TABLE` for other tables, but contains no category-table statement (`backend/config/sharedSchemaBootstrap.js:3-134`). Consequently, none of its column checks/ALTER statements applies to `category_translations`.

The historical `backend/migrations/reference/golden-fresh-install-schema.sql:30-40` also declares `title` and `description`, but `backend/migrations/reference/README.md:7-9` labels it a historical reference rather than a migration or comparison target.
