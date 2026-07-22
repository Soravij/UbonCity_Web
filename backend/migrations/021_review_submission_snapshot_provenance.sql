-- MySQL 8.0-compatible, idempotent review submission provenance columns.
-- Do not use ADD COLUMN IF NOT EXISTS: MySQL 8.0.46 rejects that syntax.

SET @schema_name = DATABASE();

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'review_contents' AND COLUMN_NAME = 'source_submission_id') = 0,
  'ALTER TABLE review_contents ADD COLUMN source_submission_id CHAR(36) NULL AFTER source_content_item_id',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'review_contents' AND COLUMN_NAME = 'source_manifest_hash') = 0,
  'ALTER TABLE review_contents ADD COLUMN source_manifest_hash CHAR(64) NULL AFTER source_submission_id',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'review_content_assets' AND COLUMN_NAME = 'caption') = 0,
  'ALTER TABLE review_content_assets ADD COLUMN caption VARCHAR(255) NULL AFTER checksum',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'review_content_assets' AND COLUMN_NAME = 'source_asset_id') = 0,
  'ALTER TABLE review_content_assets ADD COLUMN source_asset_id BIGINT NULL AFTER caption',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'review_content_assets' AND COLUMN_NAME = 'source_submission_id') = 0,
  'ALTER TABLE review_content_assets ADD COLUMN source_submission_id CHAR(36) NULL AFTER source_asset_id',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
