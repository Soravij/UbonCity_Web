import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "ImportedMedia!Test1";
const indexServer = fs.readFileSync(path.resolve(import.meta.dirname, "..", "server", "index.mjs"), "utf8");

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
    assert.ok(importedAssets.some((row) => row.public_url.includes("cover-photo")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("gallery-photo")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("test-photo.jpg")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("raw-photo.jpg")));
    assert.equal(
      importedAssets.every((row) => Number(row.selected_in_clean || 0) === 0),
      true
    );
    assert.equal(
      importedAssets.every((row) => String(row.role || "") === "unused"),
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

test("repairImportedReferenceAssetsForItem materializes evidence block media without promoting publish state", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    ctx.db.prepare("UPDATE content_items SET image_url='' WHERE id=?").run(item.id);
    ctx.db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(item.id);

    const insertEvidence = ctx.db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_url, source_label, attribution_text,
        text_value, numeric_value, list_value_json, payload_json, lang, status
      ) VALUES (?, ?, ?, ?, ?, '', ?, NULL, NULL, ?, 'th', 'active')
    `);

    insertEvidence.run(
      item.id,
      "media",
      "google_maps",
      null,
      "google_maps",
      "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fevidence-photo",
      JSON.stringify({ field: "image", media_url: "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fevidence-photo" })
    );
    insertEvidence.run(
      item.id,
      "media",
      "wongnai",
      null,
      "wongnai.com",
      "https://static2.wongnai.com/static2/images/XWU7FL1.png",
      JSON.stringify({ field: "image", media_url: "https://static2.wongnai.com/static2/images/XWU7FL1.png" })
    );
    insertEvidence.run(
      item.id,
      "media",
      "facebook",
      null,
      "facebook",
      "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
      JSON.stringify({ field: "image", media_url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg" })
    );
    insertEvidence.run(
      item.id,
      "media",
      "facebook",
      null,
      "facebook",
      "https://www.facebook.com/p/example-post",
      JSON.stringify({ field: "image", media_url: "https://www.facebook.com/p/example-post" })
    );
    insertEvidence.run(
      item.id,
      "media",
      "wongnai",
      null,
      "wongnai.com",
      "https://www.wongnai.com/restaurants/example",
      JSON.stringify({ field: "image", media_url: "https://www.wongnai.com/restaurants/example" })
    );
    insertEvidence.run(
      item.id,
      "media",
      "google_maps",
      null,
      "google_maps",
      "https://maps.google.com/?cid=123",
      JSON.stringify({ field: "image", media_url: "https://maps.google.com/?cid=123" })
    );
    insertEvidence.run(
      item.id,
      "media",
      "wongnai",
      null,
      "wongnai.com",
      "https://www.wongnai.com/restaurants/2447403Vt-test",
      JSON.stringify({ field: "image", media_url: "https://static2.wongnai.com/static2/images/XWU7FL1.png" })
    );
    insertEvidence.run(
      item.id,
      "media",
      "facebook",
      null,
      "facebook",
      "https://www.facebook.com/p/some-page",
      JSON.stringify({
        field: "image",
        media_url: "https://static2.wongnai.com/static2/images/XWU7FL1-extra.png",
        mime_type: "image/png",
      })
    );

    const diagnostics = ctx.repo.repairImportedReferenceAssetsForItem(item.id, {
      apply: true,
      actorEmail: "tester@local",
      limit: 25,
    });

    const importedAssets = ctx.repo.listImportedReferenceAssetsByItem(item.id);
    const itemAfter = ctx.repo.getItem(item.id);

    assert.equal(diagnostics.added_count, 4);
    assert.equal(importedAssets.length, 4);
    assert.ok(importedAssets.some((row) => row.public_url.includes("/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fevidence-photo")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("XWU7FL1.png")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("XWU7FL1-extra.png")));
    assert.ok(importedAssets.some((row) => row.public_url.includes("fbcdn.net/example.jpg")));
    assert.equal(importedAssets.some((row) => row.public_url.includes("facebook.com/p/example-post")), false);
    assert.equal(importedAssets.some((row) => row.public_url.includes("facebook.com/p/some-page")), false);
    assert.equal(importedAssets.some((row) => row.public_url.includes("wongnai.com/restaurants/example")), false);
    assert.equal(importedAssets.some((row) => row.public_url.includes("wongnai.com/restaurants/2447403Vt-test")), false);
    assert.equal(importedAssets.some((row) => row.public_url.includes("maps.google.com/?cid=123")), false);
    assert.equal(diagnostics.skipped_media.some((row) => row.reason === "non_image_url"), true);
    assert.equal(importedAssets.every((row) => String(row.role || "") === "unused"), true);
    assert.equal(importedAssets.every((row) => Number(row.selected_in_clean || 0) === 0), true);
    assert.equal(importedAssets.every((row) => Number(row.is_cover || 0) === 0), true);
    assert.equal(importedAssets.every((row) => String(row.placement_type || "") === "unused"), true);
    assert.equal(String(itemAfter?.image_url || "").trim(), "");

    const rerun = ctx.repo.repairImportedReferenceAssetsForItem(item.id, {
      apply: true,
      actorEmail: "tester@local",
      limit: 25,
    });
    assert.equal(rerun.added_count, 0);
    assert.equal(ctx.repo.listImportedReferenceAssetsByItem(item.id).length, importedAssets.length);
  } finally {
    ctx.cleanup();
  }
});

test("setContentAssetSelected keeps imported external assets as reference-only while allowing clean selection", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();

    ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES ('remote-selected-1', 'remote', ?, 'reference.jpg', 'image/jpeg', NULL, 'sum-reference')
    `).run("https://img.wongnai.com/p/800x0/2024/01/01/reference.jpg");
    const assetId = Number(ctx.db.prepare("SELECT id FROM assets WHERE asset_uid='remote-selected-1'").get()?.id || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'unused', 0, 0, 'unused', 0)
    `).run(item.id, assetId);

    ctx.repo.setContentAssetSelected(item.id, assetId, true);

    const selected = ctx.repo.listContentAssetsByItem(item.id, { onlySelected: false }).find((row) => Number(row.asset_id || 0) === assetId);
    assert.equal(Number(selected?.selected_in_clean || 0), 1);
    assert.equal(String(selected?.role || ""), "unused");
    assert.equal(Number(selected?.is_cover || 0), 0);
    assert.equal(String(selected?.placement_type || ""), "unused");

    const usableSelected = ctx.repo.listContentAssetsByItem(item.id, { onlySelected: true });
    assert.equal(usableSelected.some((row) => Number(row.asset_id || 0) === assetId), false);

    const referenceSelected = ctx.repo.listContentAssetsByItem(item.id, { selectedReferenceMedia: true });
    assert.equal(referenceSelected.some((row) => Number(row.asset_id || 0) === assetId), true);
  } finally {
    ctx.cleanup();
  }
});

test("selectedReferenceMedia excludes local usable selected assets", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();

    ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES ('local-selected-1', 'local', 'uploads/local-selected-1.jpg', 'local-selected-1.jpg', 'image/jpeg', NULL, 'sum-local-selected-1')
    `).run();
    const assetId = Number(ctx.db.prepare("SELECT id FROM assets WHERE asset_uid='local-selected-1'").get()?.id || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'gallery', 1, 0, 'gallery', 0)
    `).run(item.id, assetId);

    const usableSelected = ctx.repo.listContentAssetsByItem(item.id, { onlySelected: true });
    assert.equal(usableSelected.some((row) => Number(row.asset_id || 0) === assetId), true);

    const referenceSelected = ctx.repo.listContentAssetsByItem(item.id, { selectedReferenceMedia: true });
    assert.equal(referenceSelected.some((row) => Number(row.asset_id || 0) === assetId), false);
  } finally {
    ctx.cleanup();
  }
});

test("repository onlySelected contract excludes external reference assets", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();

    ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES ('local-api-selected-1', 'local', 'uploads/local-api-selected-1.jpg', 'local-api-selected-1.jpg', 'image/jpeg', NULL, 'sum-local-api-selected-1')
    `).run();
    const localAssetId = Number(ctx.db.prepare("SELECT id FROM assets WHERE asset_uid='local-api-selected-1'").get()?.id || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'gallery', 1, 0, 'gallery', 0)
    `).run(item.id, localAssetId);

    ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES ('remote-api-selected-1', 'remote', ?, 'remote-api-selected-1.jpg', 'image/jpeg', NULL, 'sum-remote-api-selected-1')
    `).run("https://img.wongnai.com/p/800x0/2024/01/01/remote-api-selected-1.jpg");
    const remoteAssetId = Number(ctx.db.prepare("SELECT id FROM assets WHERE asset_uid='remote-api-selected-1'").get()?.id || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'reference', 1, 0, 'unused', 1)
    `).run(item.id, remoteAssetId);

    const onlySelectedRows = ctx.repo.listContentAssetsByItem(item.id, { onlySelected: true });

    assert.deepEqual(
      onlySelectedRows.map((row) => Number(row.asset_id || 0)),
      [localAssetId]
    );
    assert.equal(
      onlySelectedRows.some((row) => Number(row.asset_id || 0) === remoteAssetId),
      false
    );
  } finally {
    ctx.cleanup();
  }
});

test("api assets route only_selected branch delegates to repository source contract", () => {
  // TODO: replace this with a true route integration test once collector exposes
  // a reusable Express app/server harness for GET /api/assets.
  const requiredSnippets = [
    "if (contentItemId > 0 && onlySelected) {",
    ".listContentAssetsByItem(contentItemId, { onlySelected: true })",
    "res.json(rows);",
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(indexServer.includes(snippet), true, `expected index.mjs to delegate only_selected route snippet: ${snippet}`);
  }

  const forbiddenSnippets = [
    '.filter((row) => (onlySelected ? row.selected_in_clean === 1 && row.role !== "unused" : true));',
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(indexServer.includes(snippet), false, `expected index.mjs to drop legacy only_selected route filter: ${snippet}`);
  }
});

test("api assets route non-only-selected branch triggers imported reference lazy repair", () => {
  const requiredSnippets = [
    "repo.repairImportedReferenceAssetsForItem(contentItemId, {",
    "apply: true,",
    "limit: 50,",
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(indexServer.includes(snippet), true, `expected index.mjs to lazily repair imported reference assets snippet: ${snippet}`);
  }
});
