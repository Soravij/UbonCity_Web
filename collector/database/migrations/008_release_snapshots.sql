CREATE TABLE IF NOT EXISTS release_snapshots (
  release_id TEXT PRIMARY KEY,
  content_item_id INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_release_snapshots_item
ON release_snapshots(content_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_release_snapshots_item_hash
ON release_snapshots(content_item_id, manifest_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_release_snapshots_active_item
ON release_snapshots(content_item_id)
WHERE superseded_at IS NULL;
