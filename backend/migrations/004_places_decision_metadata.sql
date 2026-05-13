-- 004_places_decision_metadata.sql
-- Additive decision-layer metadata for public routing and ranking.

SET @schema_name = DATABASE();

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'decision_featured_score') = 0,
  'ALTER TABLE places ADD COLUMN decision_featured_score INT NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'decision_scenario_tags') = 0,
  'ALTER TABLE places ADD COLUMN decision_scenario_tags VARCHAR(500) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'decision_trend_flags') = 0,
  'ALTER TABLE places ADD COLUMN decision_trend_flags VARCHAR(500) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'decision_moment_tags') = 0,
  'ALTER TABLE places ADD COLUMN decision_moment_tags VARCHAR(500) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'decision_insight_flags') = 0,
  'ALTER TABLE places ADD COLUMN decision_insight_flags VARCHAR(500) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'decision_cover_image') = 0,
  'ALTER TABLE places ADD COLUMN decision_cover_image VARCHAR(1200) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'decision_thumbnail_image') = 0,
  'ALTER TABLE places ADD COLUMN decision_thumbnail_image VARCHAR(1200) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
