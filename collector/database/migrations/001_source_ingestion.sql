CREATE TABLE IF NOT EXISTS source_ingestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL UNIQUE,
  adapter TEXT NOT NULL,
  source_label TEXT,
  status TEXT NOT NULL DEFAULT 'collected',
  item_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS source_raw_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid TEXT NOT NULL,
  source_ref TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'social',
  title_raw TEXT,
  description_raw TEXT,
  payload_json TEXT,
  normalized_json TEXT,
  status TEXT NOT NULL DEFAULT 'raw',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_raw_items_batch ON source_raw_items(batch_uid);
CREATE INDEX IF NOT EXISTS idx_source_raw_items_status ON source_raw_items(status);

CREATE TABLE IF NOT EXISTS source_raw_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_item_id INTEGER NOT NULL,
  media_url TEXT,
  checksum TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'raw',
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(raw_item_id) REFERENCES source_raw_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_raw_media_raw_item ON source_raw_media(raw_item_id);
