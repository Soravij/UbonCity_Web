CREATE TABLE IF NOT EXISTS homepage_curation_layouts (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  layout_key VARCHAR(64) NOT NULL,
  lang VARCHAR(8) NOT NULL,
  draft_blocks_json LONGTEXT NOT NULL,
  published_blocks_json LONGTEXT NULL,
  updated_by BIGINT NULL,
  published_by BIGINT NULL,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_homepage_curation_layout (layout_key, lang)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
