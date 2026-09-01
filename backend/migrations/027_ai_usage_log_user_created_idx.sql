-- 027_ai_usage_log_user_created_idx.sql
-- Adds composite index on (user_id, created_at) for date-range queries.

ALTER TABLE ai_usage_log
  ADD KEY idx_ai_usage_log_user_created (user_id, created_at);
