-- 035_transport_map_publications.sql
-- Transport v2: published map bundles (append-only history, latest row per map_key is live).
CREATE TABLE IF NOT EXISTS transport_map_publications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  map_key VARCHAR(80) NOT NULL,
  revision BIGINT NOT NULL,
  bundle_json LONGTEXT NOT NULL,
  published_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tmp_map_revision (map_key, revision),
  KEY idx_tmp_map_id (map_key, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
