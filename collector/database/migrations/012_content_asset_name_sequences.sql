CREATE TABLE IF NOT EXISTS content_asset_name_sequences (
  content_item_id INTEGER PRIMARY KEY,
  next_sequence INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
);
