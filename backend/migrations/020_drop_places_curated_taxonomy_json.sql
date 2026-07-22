-- Phase 3: remove only the obsolete places projection; Collector field packs remain untouched.

SET @schema_name = DATABASE();

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'curated_taxonomy_json') = 1,
  'ALTER TABLE places DROP COLUMN curated_taxonomy_json',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
