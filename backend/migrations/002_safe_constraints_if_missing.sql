-- 002_safe_constraints_if_missing.sql
-- Adds indexes and constraints only when missing.

SET @db_name := DATABASE();

SET @has_idx_places_slug := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='places' AND index_name='idx_places_slug'
);
SET @sql_idx_places_slug := IF(@has_idx_places_slug = 0,
  'CREATE INDEX idx_places_slug ON places (slug)',
  'SELECT 1');
PREPARE stmt_idx_places_slug FROM @sql_idx_places_slug;
EXECUTE stmt_idx_places_slug;
DEALLOCATE PREPARE stmt_idx_places_slug;

SET @has_idx_places_category_slug := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='places' AND index_name='idx_places_category_slug'
);
SET @sql_idx_places_category_slug := IF(@has_idx_places_category_slug = 0,
  'CREATE INDEX idx_places_category_slug ON places (category_id, slug)',
  'SELECT 1');
PREPARE stmt_idx_places_category_slug FROM @sql_idx_places_category_slug;
EXECUTE stmt_idx_places_category_slug;
DEALLOCATE PREPARE stmt_idx_places_category_slug;

SET @has_idx_places_approved := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='places' AND index_name='idx_places_approved'
);
SET @sql_idx_places_approved := IF(@has_idx_places_approved = 0,
  'CREATE INDEX idx_places_approved ON places (is_approved)',
  'SELECT 1');
PREPARE stmt_idx_places_approved FROM @sql_idx_places_approved;
EXECUTE stmt_idx_places_approved;
DEALLOCATE PREPARE stmt_idx_places_approved;

SET @has_uq_place_lang := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='place_translations' AND index_name='uq_place_translations_place_lang'
);
SET @sql_uq_place_lang := IF(@has_uq_place_lang = 0,
  'CREATE UNIQUE INDEX uq_place_translations_place_lang ON place_translations (place_id, lang)',
  'SELECT 1');
PREPARE stmt_uq_place_lang FROM @sql_uq_place_lang;
EXECUTE stmt_uq_place_lang;
DEALLOCATE PREPARE stmt_uq_place_lang;

SET @has_idx_place_lang := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='place_translations' AND index_name='idx_place_translations_lang'
);
SET @sql_idx_place_lang := IF(@has_idx_place_lang = 0,
  'CREATE INDEX idx_place_translations_lang ON place_translations (lang)',
  'SELECT 1');
PREPARE stmt_idx_place_lang FROM @sql_idx_place_lang;
EXECUTE stmt_idx_place_lang;
DEALLOCATE PREPARE stmt_idx_place_lang;

SET @has_idx_events_approved := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='events' AND index_name='idx_events_approved'
);
SET @sql_idx_events_approved := IF(@has_idx_events_approved = 0,
  'CREATE INDEX idx_events_approved ON events (is_approved)',
  'SELECT 1');
PREPARE stmt_idx_events_approved FROM @sql_idx_events_approved;
EXECUTE stmt_idx_events_approved;
DEALLOCATE PREPARE stmt_idx_events_approved;

SET @has_idx_events_approved_at := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='events' AND index_name='idx_events_approved_at'
);
SET @sql_idx_events_approved_at := IF(@has_idx_events_approved_at = 0,
  'CREATE INDEX idx_events_approved_at ON events (approved_at)',
  'SELECT 1');
PREPARE stmt_idx_events_approved_at FROM @sql_idx_events_approved_at;
EXECUTE stmt_idx_events_approved_at;
DEALLOCATE PREPARE stmt_idx_events_approved_at;

SET @has_uq_event_lang := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='event_translations' AND index_name='uq_event_translations_event_lang'
);
SET @sql_uq_event_lang := IF(@has_uq_event_lang = 0,
  'CREATE UNIQUE INDEX uq_event_translations_event_lang ON event_translations (event_id, lang)',
  'SELECT 1');
PREPARE stmt_uq_event_lang FROM @sql_uq_event_lang;
EXECUTE stmt_uq_event_lang;
DEALLOCATE PREPARE stmt_uq_event_lang;

SET @has_idx_event_lang := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='event_translations' AND index_name='idx_event_translations_lang'
);
SET @sql_idx_event_lang := IF(@has_idx_event_lang = 0,
  'CREATE INDEX idx_event_translations_lang ON event_translations (lang)',
  'SELECT 1');
PREPARE stmt_idx_event_lang FROM @sql_idx_event_lang;
EXECUTE stmt_idx_event_lang;
DEALLOCATE PREPARE stmt_idx_event_lang;

SET @has_uq_category_lang := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='category_translations' AND index_name='uq_category_translations_category_lang'
);
SET @sql_uq_category_lang := IF(@has_uq_category_lang = 0,
  'CREATE UNIQUE INDEX uq_category_translations_category_lang ON category_translations (category_id, lang)',
  'SELECT 1');
PREPARE stmt_uq_category_lang FROM @sql_uq_category_lang;
EXECUTE stmt_uq_category_lang;
DEALLOCATE PREPARE stmt_uq_category_lang;

SET @has_idx_category_lang := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='category_translations' AND index_name='idx_category_translations_lang'
);
SET @sql_idx_category_lang := IF(@has_idx_category_lang = 0,
  'CREATE INDEX idx_category_translations_lang ON category_translations (lang)',
  'SELECT 1');
PREPARE stmt_idx_category_lang FROM @sql_idx_category_lang;
EXECUTE stmt_idx_category_lang;
DEALLOCATE PREPARE stmt_idx_category_lang;

SET @has_uq_categories_slug := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name AND table_name='categories' AND index_name='uq_categories_slug'
);
SET @sql_uq_categories_slug := IF(@has_uq_categories_slug = 0,
  'CREATE UNIQUE INDEX uq_categories_slug ON categories (slug)',
  'SELECT 1');
PREPARE stmt_uq_categories_slug FROM @sql_uq_categories_slug;
EXECUTE stmt_uq_categories_slug;
DEALLOCATE PREPARE stmt_uq_categories_slug;

SET @has_uq_places := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema=@db_name
    AND table_name='places'
    AND index_name='uq_places_category_slug'
);
SET @sql_uq_places := IF(@has_uq_places = 0,
  'ALTER TABLE places ADD CONSTRAINT uq_places_category_slug UNIQUE (category_id, slug)',
  'SELECT 1');
PREPARE stmt_uq_places FROM @sql_uq_places;
EXECUTE stmt_uq_places;
DEALLOCATE PREPARE stmt_uq_places;

SET @has_fk_category_trans := (
  SELECT COUNT(*)
  FROM information_schema.key_column_usage
  WHERE constraint_schema=@db_name
    AND table_name='category_translations'
    AND constraint_name='fk_category_translations_category'
);
SET @sql_fk_category_trans := IF(@has_fk_category_trans = 0,
  'ALTER TABLE category_translations ADD CONSTRAINT fk_category_translations_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmt_fk_category_trans FROM @sql_fk_category_trans;
EXECUTE stmt_fk_category_trans;
DEALLOCATE PREPARE stmt_fk_category_trans;
