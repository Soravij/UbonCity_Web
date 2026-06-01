CREATE TABLE IF NOT EXISTS review_actions (
  id BIGINT NOT NULL AUTO_INCREMENT,
  review_content_id BIGINT NOT NULL,
  batch_uid CHAR(36) NOT NULL,
  action_type ENUM('ingested','approved','needs_revision','reingested') NOT NULL,
  previous_status VARCHAR(32) NULL,
  next_status VARCHAR(32) NULL,
  actor_user_id BIGINT NULL,
  review_note TEXT NULL,
  payload_snapshot_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_review_actions_content (review_content_id, created_at),
  KEY idx_review_actions_batch (batch_uid),
  CONSTRAINT fk_review_actions_content FOREIGN KEY (review_content_id) REFERENCES review_contents(id) ON DELETE CASCADE
);
