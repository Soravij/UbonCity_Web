-- Baseline schema for a blank MySQL 8.0 database.
--
-- Scope: only backend tables that have no CREATE TABLE creator elsewhere:
-- users, categories, places, and analytics_events.
--
-- This baseline incorporates migrations 015 and 016. For a blank database,
-- do not run migrations 001-023 after this file: they are upgrade patches for
-- existing databases; runtime boot and lazy creators provide the remaining schema.
--
-- This file includes users.role/users.managed_by_user_id, runtime-required
-- places columns, and the 015/016 CTA and analytics schema. Do not use ADD
-- COLUMN IF NOT EXISTS: MySQL 8.0.46 rejects it.

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  managed_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_managed_by_user_id (managed_by_user_id),
  CONSTRAINT fk_users_managed_by_user
    FOREIGN KEY (managed_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS places (
  id INT NOT NULL AUTO_INCREMENT,
  category_id INT NULL,
  slug VARCHAR(255) NULL,
  image VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_approved TINYINT(1) NOT NULL DEFAULT 0,
  transport_subtype VARCHAR(64) NULL,
  transport_contact_name VARCHAR(255) NULL,
  transport_contact_phone VARCHAR(120) NULL,
  phone VARCHAR(120) NULL,
  line_url VARCHAR(1200) NULL,
  facebook_url VARCHAR(1200) NULL,
  website_url VARCHAR(1200) NULL,
  primary_cta ENUM('map', 'phone', 'line') NULL,
  tracking_entity_type ENUM('place', 'event', 'review_content') NULL,
  tracking_entity_id BIGINT NULL,
  transport_contact_details TEXT NULL,
  transport_link_url VARCHAR(1200) NULL,
  is_emer TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_places_slug (slug),
  KEY idx_places_category_slug (category_id, slug),
  KEY idx_places_approved (is_approved),
  KEY idx_places_is_emer (is_emer),
  UNIQUE KEY uq_places_category_slug (category_id, slug),
  CONSTRAINT fk_places_category
    FOREIGN KEY (category_id) REFERENCES categories(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_type ENUM(
    'MAP_CLICK',
    'PHONE_CLICK',
    'LINE_CLICK',
    'FACEBOOK_CLICK',
    'WEBSITE_CLICK'
  ) NOT NULL,
  source_path VARCHAR(1024) NOT NULL,
  entity_type ENUM('place', 'event', 'review_content') NULL,
  entity_id BIGINT NULL,
  referrer_path VARCHAR(1024) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_analytics_event_type_created (event_type, created_at),
  KEY idx_analytics_entity (entity_type, entity_id, created_at),
  KEY idx_analytics_source_path (source_path(255), created_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
