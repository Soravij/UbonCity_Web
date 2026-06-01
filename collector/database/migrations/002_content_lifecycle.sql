CREATE TABLE IF NOT EXISTS generation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'deterministic',
  model TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS content_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  generation_run_uid TEXT NOT NULL,
  draft_title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  suggested_related_json TEXT,
  ai_quality_score INTEGER,
  status TEXT NOT NULL DEFAULT 'generated',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  UNIQUE(content_item_id, generation_run_uid)
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_item ON content_drafts(content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status ON content_drafts(status);

CREATE TABLE IF NOT EXISTS review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  draft_id INTEGER,
  duplication_score INTEGER NOT NULL DEFAULT 0,
  seo_risk_score INTEGER NOT NULL DEFAULT 0,
  metadata_score INTEGER NOT NULL DEFAULT 0,
  grounding_score INTEGER NOT NULL DEFAULT 0,
  ai_quality_score INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  issues_json TEXT,
  report_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_review_reports_item ON review_reports(content_item_id);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status);

CREATE TABLE IF NOT EXISTS review_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  report_id INTEGER,
  action TEXT NOT NULL,
  reviewer_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(report_id) REFERENCES review_reports(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS internal_link_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  target_content_item_id INTEGER NOT NULL,
  anchor_text TEXT NOT NULL,
  relevance_score INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewer_email TEXT,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(target_content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_internal_link_suggestions_item ON internal_link_suggestions(content_item_id, status);

CREATE TABLE IF NOT EXISTS publish_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'running',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS published_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL UNIQUE,
  draft_id INTEGER,
  review_report_id INTEGER,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  related_json TEXT,
  internal_links_json TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  FOREIGN KEY(draft_id) REFERENCES content_drafts(id) ON DELETE SET NULL,
  FOREIGN KEY(review_report_id) REFERENCES review_reports(id) ON DELETE SET NULL
);
