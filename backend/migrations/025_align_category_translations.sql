-- Migration 025: Align category_translations with baseline schema
-- Runtime table has only (id, category_id, lang, name)
-- Baseline expects (id, category_id, lang, title, description, created_at, updated_at)
-- Idempotent: each step guards with information_schema so re-run is safe.

SET @db_name := DATABASE();

-- Step 1a: ADD COLUMN title (nullable initially for safe ALTER on existing rows)
SET @has_col_title := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema=@db_name AND table_name='category_translations' AND column_name='title'
);
SET @sql_add_title := IF(@has_col_title = 0,
  'ALTER TABLE category_translations ADD COLUMN title varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER lang',
  'SELECT 1');
PREPARE stmt_add_title FROM @sql_add_title;
EXECUTE stmt_add_title;
DEALLOCATE PREPARE stmt_add_title;

-- Step 1b: ADD COLUMN description
SET @has_col_description := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema=@db_name AND table_name='category_translations' AND column_name='description'
);
SET @sql_add_description := IF(@has_col_description = 0,
  'ALTER TABLE category_translations ADD COLUMN description text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci AFTER title',
  'SELECT 1');
PREPARE stmt_add_description FROM @sql_add_description;
EXECUTE stmt_add_description;
DEALLOCATE PREPARE stmt_add_description;

-- Step 1c: ADD COLUMN created_at
SET @has_col_created_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema=@db_name AND table_name='category_translations' AND column_name='created_at'
);
SET @sql_add_created_at := IF(@has_col_created_at = 0,
  'ALTER TABLE category_translations ADD COLUMN created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER description',
  'SELECT 1');
PREPARE stmt_add_created_at FROM @sql_add_created_at;
EXECUTE stmt_add_created_at;
DEALLOCATE PREPARE stmt_add_created_at;

-- Step 1d: ADD COLUMN updated_at
SET @has_col_updated_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema=@db_name AND table_name='category_translations' AND column_name='updated_at'
);
SET @sql_add_updated_at := IF(@has_col_updated_at = 0,
  'ALTER TABLE category_translations ADD COLUMN updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
  'SELECT 1');
PREPARE stmt_add_updated_at FROM @sql_add_updated_at;
EXECUTE stmt_add_updated_at;
DEALLOCATE PREPARE stmt_add_updated_at;

-- Step 2: Backfill title from name
UPDATE category_translations SET title = name WHERE title IS NULL;

-- Step 3: ADD UNIQUE KEY uq_category_lang
SET @has_uq_category_lang := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE table_schema=@db_name AND table_name='category_translations' AND index_name='uq_category_lang'
);
SET @sql_uq_category_lang := IF(@has_uq_category_lang = 0,
  'ALTER TABLE category_translations ADD UNIQUE KEY uq_category_lang (category_id, lang)',
  'SELECT 1');
PREPARE stmt_uq_category_lang FROM @sql_uq_category_lang;
EXECUTE stmt_uq_category_lang;
DEALLOCATE PREPARE stmt_uq_category_lang;

-- Step 4: Fix collation island — convert table to utf8mb4_unicode_ci
ALTER TABLE category_translations
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 5: Make title NOT NULL (after backfill)
ALTER TABLE category_translations
  MODIFY title varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
