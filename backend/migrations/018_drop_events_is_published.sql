-- Phase 3: remove the legacy event publication flag after its one-way approval backfill.

SET @schema_name = DATABASE();

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'events' AND COLUMN_NAME = 'is_published') = 1,
  'ALTER TABLE events DROP COLUMN is_published',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
