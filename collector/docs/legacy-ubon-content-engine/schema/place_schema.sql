CREATE TABLE IF NOT EXISTS places_master (
  place_id CHAR(36) PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE,
  primary_name VARCHAR(255) NOT NULL,
  category ENUM('attractions','activities','hotels','cafes','restaurants','transport','temple','market') NOT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  address TEXT NULL,
  district VARCHAR(128) NULL,
  province VARCHAR(128) NULL,
  status ENUM('draft','pending','approved','archived') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS place_sources (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  place_id CHAR(36) NOT NULL,
  source_type ENUM('google_maps','facebook','tiktok','review_site','manual') NOT NULL,
  source_entity_id VARCHAR(255) NULL,
  source_url VARCHAR(1024) NOT NULL,
  source_name VARCHAR(255) NULL,
  raw_payload_json JSON NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_url (source_url),
  KEY idx_place_id (place_id)
);

CREATE TABLE IF NOT EXISTS place_content (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  place_id CHAR(36) NOT NULL,
  lang ENUM('th','en','zh','lo') NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary TEXT NULL,
  description LONGTEXT NOT NULL,
  highlights_json JSON NULL,
  meta_title VARCHAR(255) NULL,
  meta_description VARCHAR(255) NULL,
  cover_image_url VARCHAR(1024) NULL,
  images_json JSON NULL,
  version INT NOT NULL DEFAULT 1,
  is_ai_generated TINYINT(1) NOT NULL DEFAULT 0,
  approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  approved_by VARCHAR(255) NULL,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_place_lang_version (place_id, lang, version),
  KEY idx_place_lang (place_id, lang)
);

CREATE TABLE IF NOT EXISTS place_tags (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  place_id CHAR(36) NOT NULL,
  tag VARCHAR(64) NOT NULL,
  KEY idx_place_tag (place_id, tag)
);
