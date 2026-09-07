-- 034_shortcuts_collate.sql
-- Fix collation for shortcut tables to match existing convention.

ALTER TABLE shortcuts CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE shortcut_translations CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE shortcut_places CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
