import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-release-snapshot-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), path.resolve(import.meta.dirname, "..", "database", "schema.sql"));
  const repo = createRepository(db);
  const item = repo.saveItem({
    type: "place", category: "attractions", lang: "th", title: "Snapshot item", slug: "snapshot-item",
    description_raw: "raw", description_clean: "clean", summary: "summary", meta_title: "meta", meta_description: "meta description",
    source_type: "manual", source_name: "manual", source_url: "https://snapshot.example",
  });
  return { db, repo, item, cleanup: () => { try { db.close(); } catch {}; fs.rmSync(tempDir, { recursive: true, force: true }); } };
}

test("content asset captions are contextual and update only the item asset link", () => {
  const ctx = createContext();
  try {
    const assetId = Number(ctx.db.prepare(
      "INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, checksum) VALUES (?,?,?,?,?,?)"
    ).run("caption-asset", "local", "uploads/caption.jpg", "caption.jpg", "image/jpeg", "a".repeat(64)).lastInsertRowid);
    ctx.db.prepare(
      "INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order) VALUES (?,?, 'gallery', 1, 0, 'gallery', 0)"
    ).run(ctx.item.id, assetId);

    const updated = ctx.repo.setContentAssetCaption(ctx.item.id, assetId, "Collector caption");
    assert.equal(updated.caption, "Collector caption");
    assert.equal(ctx.repo.listContentAssetsByItem(ctx.item.id, { onlySelected: true })[0].caption, "Collector caption");
  } finally {
    ctx.cleanup();
  }
});
