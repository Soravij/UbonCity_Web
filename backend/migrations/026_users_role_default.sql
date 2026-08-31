-- 026_users_role_default.sql
-- Fixes users.role DEFAULT from 'admin' to 'user'.
-- Idempotent: skips if already 'user'.

SET @db_name := DATABASE();

SET @needs_alter := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'role'
    AND (COLUMN_DEFAULT IS NULL OR COLUMN_DEFAULT != 'user')
);
SET @sql_alter_role := IF(@needs_alter > 0,
  'ALTER TABLE users MODIFY `role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT ''user''',
  'SELECT 1');
PREPARE stmt_alter_role FROM @sql_alter_role;
EXECUTE stmt_alter_role;
DEALLOCATE PREPARE stmt_alter_role;
