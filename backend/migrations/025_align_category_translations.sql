-- Migration 025: Align category_translations with baseline schema
-- Runtime table has only (id, category_id, lang, name)
-- Baseline expects (id, category_id, lang, title, description, created_at, updated_at)

-- Step 1: Add missing columns (title nullable initially so ALTER passes on existing rows)
ALTER TABLE `category_translations`
  ADD COLUMN `title` varchar(255) COLLATE utf8mb4_unicode_ci NULL AFTER `lang`,
  ADD COLUMN `description` text COLLATE utf8mb4_unicode_ci AFTER `title`,
  ADD COLUMN `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `description`,
  ADD COLUMN `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

-- Step 2: Backfill title from name
UPDATE `category_translations` SET `title` = `name` WHERE `title` IS NULL;

-- Step 3: Add unique key on (category_id, lang)
ALTER TABLE `category_translations`
  ADD UNIQUE KEY `uq_category_lang` (`category_id`, `lang`);
