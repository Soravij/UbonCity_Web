import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "ImportedMedia!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-imported-media-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve(import.meta.dirname, "..", "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem() {
    return repo.createItemWithWorkflowHead({
      type: "place",
      category: "cafes",
      lang: "th",
      title: "Imported Media Cafe",
      description_raw: "raw",
      description_clean: "",
      image_url: "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fcover-photo",
      source_type: "google_maps",
      source_name: "google_maps",
      source_url: "https://maps.google.com/?cid=123",
      map_url: "https://maps.google.com/?cid=123",
      google_place_id: "place-123",
    }).item;
  }

  return { db, repo, cleanup, createItem };
}

test("repairImportedReferenceAssetsForItem promotes raw and source-record media into remote content assets", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();

    ctx.db.prepare(`
      INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
      VALUES (?, 'google_maps', 'google_maps', ?, ?, ?)
    `).run(
      item.id,
      "https://maps.google.com/?cid=123&view=photos",
      "place-123",
      JSON.stringify({
        extracted_metadata_photos: [
          { url: "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fcover-photo", width: 1600, height: 1200, role: "cover" },
          { url: "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fgallery-photo", width: 1400, height: 900 },
        ],
      })
    );
    ctx.db.prepare(`
      INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
      VALUES (?, 'wongnai', 'wongnai.com', ?, ?, ?)
    `).run(
      item.id,
      "https://www.wongnai.com/restaurants/test",
      null,
      JSON.stringify({
        extracted_metadata_image: {
          image_url: "https://img.wongnai.com/p/800x0/2024/01/01/test-photo.jpg",
          width: 800,
          height: 600,
        },
      })
    );

    const rawItemResult = ctx.db.prepare(`
      INSERT INTO source_raw_items (
        batch_uid, source_ref, source_url, source_type, title_raw, description_raw, payload_json, normalized_json, status
      ) VALUES ('batch-1', 'place-123', 'https://www.wongnai.com/restaurants/test', 'wongnai', 'raw', 'raw', '{}', ?, 'raw')
    `).run(JSON.stringify({ google_place_id: "place-123" }));
    const rawItemId = Number(rawItemResult.lastInsertRowid || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO source_raw_media (raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json)
      VALUES (?, ?, 'sum-1', 'image/jpeg', 1200, 900, 'raw', '{}')
    `).run(rawItemId, "https://img.wongnai.com/p/1200x0/2024/01/01/raw-photo.jpg");

    const diagnostics = ctx.repo.repairImportedReferenceAssetsForItem(item.id, {
      apply: true,
      actorEmail: "tester@local",
      limit: 25,
    });

    const importedAssets = ctx.repo.listImportedReferenceAssetsByItem(item.id);
    assert.equal(diagnostics.raw_media_count, 1);
    assert.equal(diagnostics.imported_asset_count_before, 0);
    assert.equal(diagnostics.added_count, 4);
    assert.equal(importedAssets.length, 4);
    assert.ok(importedAssets.some((row) => row.role === "cover" && row.public_url.includes("cover-photo")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("gallery-photo")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("test-photo.jpg")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("raw-photo.jpg")));
    assert.equal(
      importedAssets.every((row) => Number(row.selected_in_clean || 0) === 1),
      true
    );
  } finally {
    ctx.cleanup();
  }
});

test("repairImportedReferenceAssetsForItem supports runtime extracted_metadata image and google photo_name shapes", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();

    ctx.db.prepare(`
      INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
      VALUES (?, 'wongnai', 'wongnai.com', ?, ?, ?)
    `).run(
      item.id,
      "https://www.wongnai.com/restaurants/runtime-shape",
      null,
      JSON.stringify({
        extracted_metadata: {
          image: "https://img.wongnai.com/p/800x0/2024/01/01/runtime-image.jpg",
          photos: [
            {
              photo_name: "places/abc/photos/runtime-photo",
              width_px: 1080,
              height_px: 810,
            },
          ],
        },
      })
    );

    const diagnostics = ctx.repo.repairImportedReferenceAssetsForItem(item.id, {
      apply: true,
      actorEmail: "tester@local",
      limit: 25,
    });

    const importedAssets = ctx.repo.listImportedReferenceAssetsByItem(item.id);
    assert.equal(diagnostics.added_count, 3);
    assert.ok(importedAssets.some((row) => row.public_url.includes("runtime-image.jpg")));
    assert.ok(
      importedAssets.some((row) => row.public_url === "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fruntime-photo&maxWidthPx=1400&maxHeightPx=1400")
    );
  } finally {
    ctx.cleanup();
  }
});

test("repairImportedReferenceAssetsForItem dry run reports skips for existing imported assets", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();

    ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES ('remote-1', 'remote', ?, 'cover.jpg', 'image/jpeg', NULL, 'sum-cover')
    `).run("/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fcover-photo");
    const assetId = Number(ctx.db.prepare("SELECT id FROM assets WHERE asset_uid='remote-1'").get()?.id || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'cover', 1, 1, 'gallery', 0)
    `).run(item.id, assetId);

    ctx.db.prepare(`
      INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
      VALUES (?, 'google_maps', 'google_maps', ?, ?, ?)
    `).run(
      item.id,
      "https://maps.google.com/?cid=123&view=photos",
      "place-123",
      JSON.stringify({
        extracted_metadata_photos: [
          { url: "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fcover-photo", width: 1600, height: 1200, role: "cover" },
        ],
      })
    );

    const diagnostics = ctx.repo.repairImportedReferenceAssetsForItem(item.id, {
      apply: false,
      actorEmail: "tester@local",
    });

    assert.equal(diagnostics.added_count, 0);
    assert.equal(diagnostics.imported_asset_count_before, 1);
    assert.equal(diagnostics.imported_asset_count, 1);
    assert.ok(diagnostics.skipped_media.some((row) => row.reason === "existing_asset"));
  } finally {
    ctx.cleanup();
  }
});
