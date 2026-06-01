ALTER TABLE places
  ADD COLUMN phone VARCHAR(120) NULL AFTER transport_contact_phone,
  ADD COLUMN line_url VARCHAR(1200) NULL AFTER phone,
  ADD COLUMN facebook_url VARCHAR(1200) NULL AFTER line_url,
  ADD COLUMN website_url VARCHAR(1200) NULL AFTER facebook_url,
  ADD COLUMN primary_cta ENUM('map','phone','line') NULL AFTER website_url,
  ADD COLUMN tracking_entity_type ENUM('place','event','review_content') NULL AFTER primary_cta,
  ADD COLUMN tracking_entity_id BIGINT NULL AFTER tracking_entity_type;

ALTER TABLE review_contents
  ADD COLUMN phone VARCHAR(120) NULL AFTER transport_contact_phone,
  ADD COLUMN line_url VARCHAR(1200) NULL AFTER phone,
  ADD COLUMN facebook_url VARCHAR(1200) NULL AFTER line_url,
  ADD COLUMN website_url VARCHAR(1200) NULL AFTER facebook_url,
  ADD COLUMN primary_cta ENUM('map','phone','line') NULL AFTER website_url,
  ADD COLUMN tracking_entity_type ENUM('place','event','review_content') NULL AFTER primary_cta,
  ADD COLUMN tracking_entity_id BIGINT NULL AFTER tracking_entity_type;

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_type ENUM('MAP_CLICK','PHONE_CLICK','LINE_CLICK') NOT NULL,
  source_path VARCHAR(1024) NOT NULL,
  entity_type ENUM('place','event','review_content') NULL,
  entity_id BIGINT NULL,
  referrer_path VARCHAR(1024) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_analytics_event_type_created (event_type, created_at),
  KEY idx_analytics_entity (entity_type, entity_id, created_at),
  KEY idx_analytics_source_path (source_path(255), created_at)
);
