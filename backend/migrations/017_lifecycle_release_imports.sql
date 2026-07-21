CREATE TABLE IF NOT EXISTS lifecycle_release_imports (
  id BIGINT NOT NULL AUTO_INCREMENT,
  source_system VARCHAR(64) NOT NULL,
  source_release_id CHAR(36) NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  source_content_type VARCHAR(32) NOT NULL,
  source_content_item_id BIGINT NOT NULL,
  local_entity_type VARCHAR(32) NULL,
  local_entity_id BIGINT NULL,
  status ENUM('processing','succeeded','failed') NOT NULL DEFAULT 'processing',
  result_json JSON NULL,
  failure_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lifecycle_release_manifest (source_system, source_release_id, manifest_hash),
  KEY idx_lifecycle_release_import_item (source_system, source_content_type, source_content_item_id),
  KEY idx_lifecycle_release_import_status (status, updated_at)
);
