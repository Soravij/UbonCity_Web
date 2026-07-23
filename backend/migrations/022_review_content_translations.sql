CREATE TABLE IF NOT EXISTS review_content_translations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  review_content_id BIGINT NOT NULL,
  batch_uid CHAR(36) NOT NULL,
  lang VARCHAR(8) NOT NULL,
  title VARCHAR(255) NOT NULL,
  excerpt TEXT NULL,
  body LONGTEXT NOT NULL,
  meta_title VARCHAR(255) NULL,
  meta_description VARCHAR(320) NULL,
  source_submission_id CHAR(36) NULL,
  status ENUM('review_ready','published','deleted') NOT NULL DEFAULT 'review_ready',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_review_content_translations_batch_lang (review_content_id, batch_uid, lang),
  KEY idx_review_content_translations_batch_status (review_content_id, batch_uid, status),
  CONSTRAINT fk_review_content_translations_content FOREIGN KEY (review_content_id) REFERENCES review_contents(id) ON DELETE CASCADE
);
