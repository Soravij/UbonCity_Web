-- 006_user_profile_json.sql
-- User profile payload aligned with collector account fields.

ALTER TABLE users
  ADD COLUMN profile_json JSON NULL;
