-- 027_ai_usage_log_user_created_idx.sql
-- Adds composite index on (user_id, created_at) for date-range queries.
-- Idempotent: skips if index already exists.

SET @db_name := DATABASE();

SET @has_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ai_usage_log'
    AND INDEX_NAME = 'idx_ai_usage_log_user_created'
);
SET @sql_add_idx := IF(@has_idx = 0,
  'ALTER TABLE ai_usage_log ADD KEY idx_ai_usage_log_user_created (user_id, created_at)',
  'SELECT 1');
PREPARE stmt_add_idx FROM @sql_add_idx;
EXECUTE stmt_add_idx;
DEALLOCATE PREPARE stmt_add_idx;
