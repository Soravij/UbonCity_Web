CREATE TABLE IF NOT EXISTS content_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_content_item_id INTEGER NOT NULL,
  source_published_article_id INTEGER NOT NULL,
  source_draft_id INTEGER,
  source_review_report_id INTEGER,
  source_fingerprint TEXT NOT NULL,
  lang TEXT NOT NULL,
  translated_title TEXT,
  translated_excerpt TEXT,
  translated_body TEXT,
  translated_meta_title TEXT,
  translated_meta_description TEXT,
  translation_status TEXT NOT NULL DEFAULT 'pending',
  automatic_check_status TEXT NOT NULL DEFAULT 'pending',
  automatic_check_report_json TEXT,
  stale_flag INTEGER NOT NULL DEFAULT 0,
  translator_engine TEXT,
  translator_model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(source_published_article_id) REFERENCES published_articles(id) ON DELETE CASCADE,
  FOREIGN KEY(source_draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL,
  FOREIGN KEY(source_review_report_id) REFERENCES review_reports(id) ON DELETE SET NULL,
  UNIQUE(source_content_item_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_content_translations_source ON content_translations(source_content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_translations_lang ON content_translations(lang);
CREATE INDEX IF NOT EXISTS idx_content_translations_publishable ON content_translations(automatic_check_status, stale_flag, translation_status);

CREATE TABLE IF NOT EXISTS translation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL DEFAULT 'final-prefrontend',
  status TEXT NOT NULL DEFAULT 'running',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
