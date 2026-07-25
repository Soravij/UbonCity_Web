import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import {
  allocateAssignmentAssetSequence,
  assignmentAssetSlotFromOriginalName,
  formatAssignmentAssetFileName,
} from "../server/assignment-asset-naming.mjs";

const collectorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createTestDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-asset-name-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), path.join(collectorRoot, "database", "schema.sql"));
  const itemId = Number(db.prepare(`
    INSERT INTO content_items (item_uid, type, title, description_raw)
    VALUES ('asset-name-test-item', 'place', 'Asset name test', 'Asset name test')
  `).run().lastInsertRowid || 0);
  return {
    db,
    itemId,
    cleanup() {
      try { db.close(); } catch {}
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("handoff filename retains the slot prefix and formats validated image/video names", () => {
  assert.equal(assignmentAssetSlotFromOriginalName("Shot A__original.jpeg"), "shot-a");
  assert.equal(
    formatAssignmentAssetFileName({
      originalName: "Shot A__original.jpeg",
      mimeType: "image/jpeg",
      contentItemId: 42,
      sequence: 1,
      now: new Date(2026, 6, 25),
    }),
    "shot-a__pic-item42-01-20260725.jpg"
  );
  assert.equal(
    formatAssignmentAssetFileName({
      originalName: "video-shot__original.mov",
      mimeType: "video/quicktime",
      contentItemId: 42,
      sequence: 100,
      now: new Date(2026, 6, 25),
    }),
    "video-shot__vid-item42-100-20260725.mov"
  );
});

test("handoff sequence is monotonic per item and is not reused after linked assets are deleted", () => {
  const ctx = createTestDatabase();
  try {
    assert.equal(allocateAssignmentAssetSequence(ctx.db, ctx.itemId), 1);
    const assetId = Number(ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name)
      VALUES ('asset-name-test-1', 'local', 'uploads/test.jpg', 'shot-a__pic-item1-01-20260725.jpg')
    `).run().lastInsertRowid || 0);
    ctx.db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'unused', 0, 0, 'unused', 0)
    `).run(ctx.itemId, assetId);
    ctx.db.prepare("DELETE FROM content_assets WHERE asset_id=?").run(assetId);
    ctx.db.prepare("DELETE FROM assets WHERE id=?").run(assetId);
    assert.equal(allocateAssignmentAssetSequence(ctx.db, ctx.itemId), 2);
    assert.equal(allocateAssignmentAssetSequence(ctx.db, ctx.itemId), 3);
  } finally {
    ctx.cleanup();
  }
});
