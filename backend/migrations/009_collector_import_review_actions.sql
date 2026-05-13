CREATE TABLE IF NOT EXISTS collector_import_review_actions (
  id BIGINT NOT NULL AUTO_INCREMENT,
  review_id BIGINT NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  previous_status VARCHAR(16) NULL,
  next_status VARCHAR(16) NULL,
  actor_user_id BIGINT NULL,
  review_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_collector_review_actions_review_id (review_id, created_at)
);
