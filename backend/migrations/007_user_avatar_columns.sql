-- 007_user_avatar_columns.sql
-- Dedicated account-owned avatar storage.

ALTER TABLE users
  ADD COLUMN avatar_path VARCHAR(1200) NULL,
  ADD COLUMN avatar_updated_at TIMESTAMP NULL DEFAULT NULL;
