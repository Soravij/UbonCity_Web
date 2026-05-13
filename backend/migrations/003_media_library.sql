-- 003_media_library.sql
-- Media library and content image usage mapping for uboncity.

CREATE TABLE IF NOT EXISTS media_assets (
  id INT NOT NULL AUTO_INCREMENT,
  asset_uid CHAR(36) NOT NULL,
  source_url VARCHAR(1200) NULL,
  checksum CHAR(64) NULL,
  status ENUM('pending','approved','rejected','archived') NOT NULL DEFAULT 'pending',
  related_type ENUM('place','event','article','other') NOT NULL DEFAULT 'other',
  related_id INT NULL,
  title VARCHAR(255) NULL,
  alt_text VARCHAR(255) NULL,
  credit VARCHAR(255) NULL,
  notes TEXT NULL,
  mime_type VARCHAR(120) NULL,
  size_bytes BIGINT NULL,
  width INT NULL,
  height INT NULL,
  storage_disk ENUM('local','external','nas') NOT NULL DEFAULT 'local',
  storage_path VARCHAR(1200) NULL,
  file_name VARCHAR(255) NULL,
  created_by INT NULL,
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_media_assets_uid (asset_uid),
  KEY idx_media_assets_status (status),
  KEY idx_media_assets_related (related_type, related_id),
  KEY idx_media_assets_checksum (checksum)
);

CREATE TABLE IF NOT EXISTS content_image_usages (
  id INT NOT NULL AUTO_INCREMENT,
  asset_id INT NOT NULL,
  entity_type ENUM('place','event','article') NOT NULL,
  entity_id INT NOT NULL,
  usage_type ENUM('cover','gallery','inline') NOT NULL DEFAULT 'gallery',
  position INT NOT NULL DEFAULT 0,
  caption VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_content_image_usages_entity (entity_type, entity_id),
  KEY idx_content_image_usages_asset (asset_id),
  KEY idx_content_image_usages_usage (usage_type),
  CONSTRAINT fk_content_image_usages_asset FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
);
