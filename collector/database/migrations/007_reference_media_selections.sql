CREATE TABLE IF NOT EXISTS content_reference_media_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id INTEGER NOT NULL,
  reference_media_id TEXT NOT NULL,
  selected_for_ai INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
  UNIQUE(content_item_id, reference_media_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reference_media_selections_item
ON content_reference_media_selections(content_item_id);

CREATE INDEX IF NOT EXISTS idx_content_reference_media_selections_selected
ON content_reference_media_selections(content_item_id, selected_for_ai);
