ALTER TABLE review_contents
  ADD COLUMN IF NOT EXISTS source_submission_id CHAR(36) NULL AFTER source_content_item_id,
  ADD COLUMN IF NOT EXISTS source_manifest_hash CHAR(64) NULL AFTER source_submission_id;

ALTER TABLE review_content_assets
  ADD COLUMN IF NOT EXISTS caption VARCHAR(255) NULL AFTER checksum,
  ADD COLUMN IF NOT EXISTS source_asset_id BIGINT NULL AFTER caption,
  ADD COLUMN IF NOT EXISTS source_submission_id CHAR(36) NULL AFTER source_asset_id;
