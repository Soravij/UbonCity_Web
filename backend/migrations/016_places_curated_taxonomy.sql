SET @schema_name = DATABASE();

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'curated_taxonomy_json') = 0,
  'ALTER TABLE places ADD COLUMN curated_taxonomy_json LONGTEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
