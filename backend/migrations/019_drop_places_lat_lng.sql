-- Phase 3: drop legacy places.lat/lng only after verifying no legacy-only coordinates exist.

SET @schema_name = DATABASE();

DROP PROCEDURE IF EXISTS phase3_assert_places_lat_lng_safe;

DELIMITER //
CREATE PROCEDURE phase3_assert_places_lat_lng_safe()
BEGIN
  DECLARE legacy_columns_present INT DEFAULT 0;

  SELECT COUNT(*) INTO legacy_columns_present
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'places'
    AND COLUMN_NAME IN ('lat', 'lng');

  IF legacy_columns_present = 2 THEN
    SET @legacy_coordinate_rows = 0;
    SET @assertion_sql = '
      SELECT COUNT(*) INTO @legacy_coordinate_rows
      FROM places
      WHERE (lat IS NOT NULL OR lng IS NOT NULL)
        AND (latitude IS NULL OR longitude IS NULL)';
    PREPARE assertion_stmt FROM @assertion_sql;
    EXECUTE assertion_stmt;
    DEALLOCATE PREPARE assertion_stmt;

    IF @legacy_coordinate_rows <> 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Phase 3 blocked: places.lat/lng contain coordinates not present in latitude/longitude';
    END IF;
  END IF;
END//
DELIMITER ;

CALL phase3_assert_places_lat_lng_safe();
DROP PROCEDURE phase3_assert_places_lat_lng_safe;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'lat') = 1,
  'ALTER TABLE places DROP COLUMN lat',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'places' AND COLUMN_NAME = 'lng') = 1,
  'ALTER TABLE places DROP COLUMN lng',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
