-- 001_schema_alignment_core.sql
-- Safe alignment for uboncity core content tables.

CREATE TABLE IF NOT EXISTS category_translations (
  id INT NOT NULL AUTO_INCREMENT,
  category_id INT NOT NULL,
  lang VARCHAR(8) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

ALTER TABLE place_translations
  ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS meta_description VARCHAR(320) NULL;

ALTER TABLE event_translations
  ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS meta_description VARCHAR(320) NULL;

-- Deduplicate place translations before unique key creation (keep newest id).
DELETE t1 FROM place_translations t1
INNER JOIN place_translations t2
  ON t1.place_id = t2.place_id
 AND t1.lang = t2.lang
 AND t1.id < t2.id;

-- Deduplicate event translations before unique key creation (keep newest id).
DELETE t1 FROM event_translations t1
INNER JOIN event_translations t2
  ON t1.event_id = t2.event_id
 AND t1.lang = t2.lang
 AND t1.id < t2.id;
