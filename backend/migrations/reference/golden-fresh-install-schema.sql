-- Fresh-install golden schema reference.
-- Generated from MySQL SHOW CREATE TABLE on 2026-07-27 for uboncity_golden.
-- Reference only: do not run as a migration.

-- Table: analytics_events
CREATE TABLE `analytics_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `event_type` enum('MAP_CLICK','PHONE_CLICK','LINE_CLICK','FACEBOOK_CLICK','WEBSITE_CLICK') COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_path` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` enum('place','event','review_content') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entity_id` bigint DEFAULT NULL,
  `referrer_path` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata_json` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_analytics_event_type_created` (`event_type`,`created_at`),
  KEY `idx_analytics_entity` (`entity_type`,`entity_id`,`created_at`),
  KEY `idx_analytics_source_path` (`source_path`(255),`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: categories
CREATE TABLE `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: category_translations
CREATE TABLE `category_translations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_category_lang` (`category_id`,`lang`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: collector_import_review_actions
CREATE TABLE `collector_import_review_actions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `review_id` bigint NOT NULL,
  `action_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `previous_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `next_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_user_id` bigint DEFAULT NULL,
  `review_note` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_collector_review_actions_review_id` (`review_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: collector_import_reviews
CREATE TABLE `collector_import_reviews` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `source_system` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_content_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_content_item_id` bigint NOT NULL,
  `local_entity_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `local_entity_id` bigint NOT NULL,
  `payload_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `article_snapshot_json` longtext COLLATE utf8mb4_unicode_ci,
  `translations_snapshot_json` longtext COLLATE utf8mb4_unicode_ci,
  `published_at` datetime DEFAULT NULL,
  `imported_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `translation_count` int NOT NULL DEFAULT '0',
  `translation_langs_json` text COLLATE utf8mb4_unicode_ci,
  `review_status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewed_by_user_id` bigint DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_note` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_collector_import_source` (`source_system`,`source_content_type`,`source_content_item_id`),
  KEY `idx_collector_import_review_status` (`review_status`,`imported_at`),
  KEY `idx_collector_import_local_entity` (`local_entity_type`,`local_entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: content_image_usages
CREATE TABLE `content_image_usages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `asset_id` int NOT NULL,
  `entity_type` enum('place','event','article') COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int NOT NULL,
  `usage_type` enum('cover','gallery','inline') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'gallery',
  `position` int NOT NULL DEFAULT '0',
  `caption` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_content_image_usages_entity` (`entity_type`,`entity_id`),
  KEY `idx_content_image_usages_asset` (`asset_id`),
  KEY `idx_content_image_usages_usage` (`usage_type`),
  CONSTRAINT `fk_content_image_usages_asset` FOREIGN KEY (`asset_id`) REFERENCES `media_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: content_purge_audit
CREATE TABLE `content_purge_audit` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `entity_type` enum('place','event') COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` bigint NOT NULL,
  `category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title_snapshot` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_emer` tinyint(1) NOT NULL DEFAULT '0',
  `purged_by_user_id` bigint DEFAULT NULL,
  `purge_note` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_content_purge_audit_created_at` (`created_at`),
  KEY `idx_content_purge_audit_entity` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: events
CREATE TABLE `events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `image` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_period_text` text COLLATE utf8mb4_unicode_ci,
  `location_text` text COLLATE utf8mb4_unicode_ci,
  `map_url` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_approved` tinyint(1) NOT NULL DEFAULT '0',
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `decision_featured_score` int DEFAULT NULL,
  `decision_scenario_tags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_trend_flags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_moment_tags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_insight_flags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_cover_image` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_thumbnail_image` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_emer` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_events_is_emer` (`is_emer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: event_translations
CREATE TABLE `event_translations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `meta_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_lang` (`event_id`,`lang`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: homepage_curation_layouts
CREATE TABLE `homepage_curation_layouts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `layout_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `draft_blocks_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `published_blocks_json` longtext COLLATE utf8mb4_unicode_ci,
  `updated_by` bigint DEFAULT NULL,
  `published_by` bigint DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_homepage_curation_layout` (`layout_key`,`lang`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: media_assets
CREATE TABLE `media_assets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `asset_uid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `checksum` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `related_type` enum('place','event','article','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `related_id` int DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `alt_text` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `credit` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `mime_type` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size_bytes` bigint DEFAULT NULL,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `storage_disk` enum('local','external','nas') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'local',
  `storage_path` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_media_assets_uid` (`asset_uid`),
  KEY `idx_media_assets_status` (`status`),
  KEY `idx_media_assets_related` (`related_type`,`related_id`),
  KEY `idx_media_assets_checksum` (`checksum`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: places
CREATE TABLE `places` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int DEFAULT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_approved` tinyint(1) NOT NULL DEFAULT '0',
  `transport_subtype` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport_contact_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport_contact_phone` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `line_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `facebook_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `website_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `primary_cta` enum('map','phone','line') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tracking_entity_type` enum('place','event','review_content') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tracking_entity_id` bigint DEFAULT NULL,
  `transport_contact_details` text COLLATE utf8mb4_unicode_ci,
  `transport_link_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_emer` tinyint(1) NOT NULL DEFAULT '0',
  `decision_featured_score` int DEFAULT NULL,
  `decision_scenario_tags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_trend_flags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_moment_tags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_insight_flags` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_cover_image` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decision_thumbnail_image` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `map_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `google_place_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_places_category_slug` (`category_id`,`slug`),
  KEY `idx_places_slug` (`slug`),
  KEY `idx_places_category_slug` (`category_id`,`slug`),
  KEY `idx_places_approved` (`is_approved`),
  KEY `idx_places_is_emer` (`is_emer`),
  CONSTRAINT `fk_places_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: place_translations
CREATE TABLE `place_translations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `place_id` int NOT NULL,
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `meta_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_place_lang` (`place_id`,`lang`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: review_actions
CREATE TABLE `review_actions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `review_content_id` bigint NOT NULL,
  `batch_uid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action_type` enum('ingested','approved','needs_revision','rejected','reingested') COLLATE utf8mb4_unicode_ci NOT NULL,
  `previous_status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `next_status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_user_id` bigint DEFAULT NULL,
  `review_note` text COLLATE utf8mb4_unicode_ci,
  `payload_snapshot_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_review_actions_content` (`review_content_id`,`created_at`),
  KEY `idx_review_actions_batch` (`batch_uid`),
  CONSTRAINT `fk_review_actions_content` FOREIGN KEY (`review_content_id`) REFERENCES `review_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: review_content_assets
CREATE TABLE `review_content_assets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `review_content_id` bigint NOT NULL,
  `batch_uid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `usage_type` enum('cover','gallery','inline') COLLATE utf8mb4_unicode_ci NOT NULL,
  `position` int NOT NULL DEFAULT '0',
  `source_url` varchar(1200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `resolved_source_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `backend_url` varchar(1200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storage_disk` enum('local') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'local',
  `storage_path` varchar(1200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size_bytes` bigint DEFAULT NULL,
  `checksum` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `caption` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_asset_id` bigint DEFAULT NULL,
  `source_submission_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('review_ready','published','deleted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'review_ready',
  `asset_origin` enum('collector_import') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'collector_import',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_review_content_assets_batch` (`review_content_id`,`batch_uid`),
  KEY `idx_review_content_assets_status` (`status`),
  KEY `idx_review_content_assets_checksum` (`checksum`),
  CONSTRAINT `fk_review_content_assets_content` FOREIGN KEY (`review_content_id`) REFERENCES `review_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: review_contents
CREATE TABLE `review_contents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `source_system` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_content_item_id` bigint NOT NULL,
  `source_submission_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_manifest_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content_type` enum('place','event') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','pending_review','needs_revision','rejected','published') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'th',
  `category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `excerpt` text COLLATE utf8mb4_unicode_ci,
  `meta_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_period_text` text COLLATE utf8mb4_unicode_ci,
  `location_text` text COLLATE utf8mb4_unicode_ci,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `map_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `google_place_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport_subtype` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport_contact_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport_contact_phone` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `line_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `facebook_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `website_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `primary_cta` enum('map','phone','line') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tracking_entity_type` enum('place','event','review_content') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tracking_entity_id` bigint DEFAULT NULL,
  `transport_contact_details` text COLLATE utf8mb4_unicode_ci,
  `transport_link_url` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `slug` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `slug_locked` tinyint(1) NOT NULL DEFAULT '0',
  `public_entity_type` enum('place','event') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `public_entity_id` bigint DEFAULT NULL,
  `current_batch_uid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `review_payload_json` longtext COLLATE utf8mb4_unicode_ci,
  `published_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_review_contents_source` (`source_system`,`source_content_item_id`,`content_type`),
  KEY `idx_review_contents_status` (`status`,`updated_at`),
  KEY `idx_review_contents_public_entity` (`public_entity_type`,`public_entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: review_content_translations
CREATE TABLE `review_content_translations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `review_content_id` bigint NOT NULL,
  `batch_uid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `excerpt` text COLLATE utf8mb4_unicode_ci,
  `body` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `meta_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_description` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_submission_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('review_ready','published','deleted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'review_ready',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_review_content_translations_batch_lang` (`review_content_id`,`batch_uid`,`lang`),
  KEY `idx_review_content_translations_batch_status` (`review_content_id`,`batch_uid`,`status`),
  CONSTRAINT `fk_review_content_translations_content` FOREIGN KEY (`review_content_id`) REFERENCES `review_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: transport_add_line_request_audit_logs
CREATE TABLE `transport_add_line_request_audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `request_id` bigint unsigned NOT NULL,
  `action` enum('submit','approve','reject','apply') COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_user_id` bigint unsigned DEFAULT NULL,
  `actor_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip_address` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transport_add_line_audit_request` (`request_id`),
  KEY `idx_transport_add_line_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: transport_add_line_requests
CREATE TABLE `transport_add_line_requests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `payload_json` json NOT NULL,
  `submitted_by_user_id` bigint unsigned DEFAULT NULL,
  `submitted_by_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_by_user_id` bigint unsigned DEFAULT NULL,
  `reviewed_by_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `review_note` text COLLATE utf8mb4_unicode_ci,
  `applied_route_id` bigint unsigned DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `applied_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transport_add_line_status_created` (`status`,`created_at`),
  KEY `idx_transport_add_line_submitted_by` (`submitted_by_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: transport_route_audit_logs
CREATE TABLE `transport_route_audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `route_id` bigint unsigned DEFAULT NULL,
  `action` enum('create','update','delete','import_geojson','export') COLLATE utf8mb4_unicode_ci NOT NULL,
  `admin_user_id` bigint unsigned DEFAULT NULL,
  `admin_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip_address` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `before_data` json DEFAULT NULL,
  `after_data` json DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transport_audit_route` (`route_id`),
  KEY `idx_transport_audit_admin` (`admin_user_id`),
  KEY `idx_transport_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: transport_route_points
CREATE TABLE `transport_route_points` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `route_id` bigint unsigned NOT NULL,
  `lat` decimal(10,7) NOT NULL,
  `lng` decimal(10,7) NOT NULL,
  `point_order` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transport_points_order` (`route_id`,`point_order`),
  CONSTRAINT `fk_transport_points_route` FOREIGN KEY (`route_id`) REFERENCES `transport_routes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: transport_routes
CREATE TABLE `transport_routes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `route_code` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `route_number` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `route_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `route_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vehicle_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vehicle_image` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `color` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#ff6600',
  `description` text COLLATE utf8mb4_unicode_ci,
  `start_stop` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `end_stop` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_points` json DEFAULT NULL,
  `collector_source_item_id` bigint unsigned DEFAULT NULL,
  `sync_source_system` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sync_updated_at` timestamp NULL DEFAULT NULL,
  `distance_km` decimal(8,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_transport_route_code` (`route_code`),
  UNIQUE KEY `uq_transport_collector_source_item_id` (`collector_source_item_id`),
  KEY `idx_transport_route_type_created` (`route_type`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: transport_route_stops
CREATE TABLE `transport_route_stops` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `route_id` bigint unsigned NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lat` decimal(10,7) NOT NULL,
  `lng` decimal(10,7) NOT NULL,
  `stop_order` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transport_stops_order` (`route_id`,`stop_order`),
  CONSTRAINT `fk_transport_stops_route` FOREIGN KEY (`route_id`) REFERENCES `transport_routes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: users
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `managed_by_user_id` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `profile_json` json DEFAULT NULL,
  `avatar_path` varchar(1200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar_updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_managed_by_user_id` (`managed_by_user_id`),
  CONSTRAINT `fk_users_managed_by_user` FOREIGN KEY (`managed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
