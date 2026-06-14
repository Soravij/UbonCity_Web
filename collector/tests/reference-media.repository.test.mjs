import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "ReferenceMedia!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-reference-media-"));
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

  function createItem(overrides = {}) {
    return repo.createItemWithWorkflowHead({
      type: "place",
      category: "cafes",
      lang: "th",
      title: "Reference Media Cafe",
      description_raw: "raw",
      description_clean: "",
      image_url: "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fcover-photo&maxWidthPx=800&maxHeightPx=800",
      source_type: "google_maps",
      source_name: "google_maps",
      source_url: "https://maps.google.com/?cid=123",
      map_url: "https://maps.google.com/?cid=123",
      google_place_id: "place-123",
      ...overrides,
    }).item;
  }

  function createLocalPublishAsset(itemId, overrides = {}) {
    const assetUid = String(overrides.asset_uid || `local-asset-${itemId}-${Date.now()}`);
    const storagePath = String(overrides.storage_path || "uploads/reference-media/local-cover.jpg");
    const fileName = String(overrides.file_name || "local-cover.jpg");
    const mimeType = String(overrides.mime_type || "image/jpeg");
    const role = String(overrides.role || "gallery");
    const selectedInClean = overrides.selected_in_clean ?? 1;
    const isCover = overrides.is_cover ?? (role === "cover" ? 1 : 0);
    const placementType = String(overrides.placement_type || (role === "inline" ? "inline" : "gallery"));
    const sortOrder = overrides.sort_order ?? 1;

    const assetResult = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, 'local', ?, ?, ?, 1234, 'checksum-local')
    `).run(assetUid, storagePath, fileName, mimeType);
    const assetId = Number(assetResult.lastInsertRowid || 0) || 0;
    db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, assetId, role, selectedInClean, isCover, placementType, sortOrder);
    return {
      asset_id: assetId,
      asset_uid: assetUid,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      public_url: `/media/${storagePath}`,
      role,
      selected_in_clean: selectedInClean,
      is_cover: isCover,
    };
  }

  return { db, repo, cleanup, createItem, createLocalPublishAsset };
}

test("listReferenceMediaByItem returns deduped read-only candidates without materializing assets", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    ctx.db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_label, text_value, payload_json, lang, status
      ) VALUES (?, 'media', 'facebook', 'facebook', ?, ?, 'th', 'active')
    `).run(
      item.id,
      "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
      JSON.stringify({
        field: "image",
        media_url: "/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fcover-photo&maxWidthPx=1400&maxHeightPx=1400",
      })
    );

    const rawItemResult = ctx.db.prepare(`
      INSERT INTO source_raw_items (
        batch_uid, source_ref, source_url, source_type, title_raw, description_raw, payload_json, normalized_json, status
      ) VALUES ('batch-1', 'place-123', 'https://maps.google.com/?cid=123', 'google_maps', 'raw', 'raw', '{}', ?, 'raw')
    `).run(JSON.stringify({ google_place_id: "place-123" }));
    const rawItemId = Number(rawItemResult.lastInsertRowid || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO source_raw_media (raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json)
      VALUES (?, ?, 'sum-1', 'image/jpeg', 1200, 900, 'raw', '{}')
    `).run(rawItemId, "https://img.wongnai.com/p/1200x0/2024/01/01/raw-photo.jpg");

    const otherRawItemResult = ctx.db.prepare(`
      INSERT INTO source_raw_items (
        batch_uid, source_ref, source_url, source_type, title_raw, description_raw, payload_json, normalized_json, status
      ) VALUES ('batch-2', 'place-other', 'https://maps.google.com/?cid=999', 'google_maps', 'raw', 'raw', '{}', ?, 'raw')
    `).run(JSON.stringify({ google_place_id: "place-other" }));
    const otherRawItemId = Number(otherRawItemResult.lastInsertRowid || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO source_raw_media (raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json)
      VALUES (?, ?, 'sum-2', 'image/jpeg', 1200, 900, 'raw', '{}')
    `).run(otherRawItemId, "https://img.wongnai.com/p/1200x0/2024/01/01/other-photo.jpg");

    const rows = ctx.repo.listReferenceMediaByItem(item.id);
    const coverRows = rows.filter((row) => row.url.includes("/api/google-maps/photo?name=places%2Fabc%2Fphotos%2Fcover-photo"));

    assert.equal(rows.some((row) => row.url.includes("raw-photo.jpg")), true);
    assert.equal(rows.some((row) => row.url.includes("example.jpg")), true);
    assert.equal(rows.some((row) => row.url.includes("other-photo.jpg")), false);
    assert.equal(coverRows.length, 1);
    assert.match(String(coverRows[0]?.reference_media_id || ""), /^rm:[0-9a-f]{16}$/);
    assert.equal(rows.every((row) => row.is_external === true), true);
    assert.equal(
      Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE content_item_id=?").get(item.id)?.c || 0),
      0
    );
  } finally {
    ctx.cleanup();
  }
});

test("setReferenceMediaSelected upserts and preserves selection across source survivor changes", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    const evidenceInsert = ctx.db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_label, text_value, payload_json, lang, status
      ) VALUES (?, 'media', 'facebook', 'facebook', ?, ?, 'th', 'active')
    `);
    const evidenceResult = evidenceInsert.run(
      item.id,
      "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
      JSON.stringify({ field: "image", media_url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg" })
    );
    const evidenceId = Number(evidenceResult.lastInsertRowid || 0) || 0;

    const rawItemResult = ctx.db.prepare(`
      INSERT INTO source_raw_items (
        batch_uid, source_ref, source_url, source_type, title_raw, description_raw, payload_json, normalized_json, status
      ) VALUES ('batch-1', 'place-123', 'https://maps.google.com/?cid=123', 'google_maps', 'raw', 'raw', '{}', ?, 'raw')
    `).run(JSON.stringify({ google_place_id: "place-123" }));
    const rawItemId = Number(rawItemResult.lastInsertRowid || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO source_raw_media (raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json)
      VALUES (?, ?, 'sum-1', 'image/jpeg', 1200, 900, 'raw', '{}')
    `).run(rawItemId, "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg");

    const before = ctx.repo.listReferenceMediaByItem(item.id);
    const target = before.find((row) => row.url.includes("example.jpg"));
    assert.ok(target);

    ctx.repo.setReferenceMediaSelected(item.id, target.reference_media_id, true);
    const selectedRow = ctx.repo.listReferenceMediaByItem(item.id).find((row) => row.reference_media_id === target.reference_media_id);
    assert.equal(selectedRow?.selected_for_ai, true);

    ctx.db.prepare("DELETE FROM evidence_blocks WHERE id=?").run(evidenceId);
    const afterDelete = ctx.repo.listReferenceMediaByItem(item.id).find((row) => row.reference_media_id === target.reference_media_id);
    assert.ok(afterDelete);
    assert.equal(afterDelete?.selected_for_ai, true);

    ctx.repo.setReferenceMediaSelected(item.id, target.reference_media_id, false);
    const unselectedRow = ctx.repo.listReferenceMediaByItem(item.id).find((row) => row.reference_media_id === target.reference_media_id);
    assert.equal(unselectedRow?.selected_for_ai, false);
    assert.equal(
      Number(ctx.db.prepare("SELECT selected_for_ai FROM content_reference_media_selections WHERE content_item_id=? AND reference_media_id=?").get(item.id, target.reference_media_id)?.selected_for_ai || 0),
      0
    );
  } finally {
    ctx.cleanup();
  }
});

test("setReferenceMediaSelected rejects ids outside the current candidate set", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    assert.throws(
      () => ctx.repo.setReferenceMediaSelected(item.id, "rm:deadbeefdeadbeef", true),
      /reference media/i
    );
  } finally {
    ctx.cleanup();
  }
});

test("getImageWorkflowStatus counts reference media for AI readiness but not publish readiness", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem({ image_url: "" });
    ctx.db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_label, text_value, payload_json, lang, status
      ) VALUES (?, 'media', 'facebook', 'facebook', ?, ?, 'th', 'active')
    `).run(
      item.id,
      "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
      JSON.stringify({ field: "image", media_url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg" })
    );

    const target = ctx.repo.listReferenceMediaByItem(item.id)[0];
    ctx.repo.setReferenceMediaSelected(item.id, target.reference_media_id, true);

    const status = ctx.repo.getImageWorkflowStatus(item.id);
    assert.equal(status.ai_reference_selected_count, 1);
    assert.equal(status.local_selected_count, 0);
    assert.equal(status.local_cover_count, 0);
    assert.equal(status.is_ready_for_ai_draft, true);
    assert.equal(status.is_ready_for_publish, false);
    assert.ok(status.missing_local_requirements.length > 0);
  } finally {
    ctx.cleanup();
  }
});

test("buildDraftInputPreview includes selected reference media and excludes it from image context", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem({ image_url: "" });
    ctx.db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_label, text_value, payload_json, lang, status
      ) VALUES (?, 'media', 'facebook', 'facebook', ?, ?, 'th', 'active')
    `).run(
      item.id,
      "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
      JSON.stringify({ field: "image", media_url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg" })
    );

    const target = ctx.repo.listReferenceMediaByItem(item.id)[0];
    assert.ok(target);
    ctx.repo.setReferenceMediaSelected(item.id, target.reference_media_id, true);

    const preview = ctx.repo.buildDraftInputPreview(item.id);
    assert.equal(preview.reference_media_context.selected_count, 1);
    assert.deepEqual(preview.reference_media_context.selected_urls, ["https://scontent.fubp1-1.fna.fbcdn.net/example.jpg"]);
    assert.equal(preview.image_context.selected_urls.includes("https://scontent.fubp1-1.fna.fbcdn.net/example.jpg"), false);
    assert.equal(preview.reference_media_context.selected_urls.includes("https://scontent.fubp1-1.fna.fbcdn.net/example.jpg"), true);
    assert.equal(preview.image_context.cover_url, null);
  } finally {
    ctx.cleanup();
  }
});

test("buildDraftInputPreview keeps local publish assets in image context without polluted external rows", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem({ image_url: "" });
    const localCover = ctx.createLocalPublishAsset(item.id, {
      role: "cover",
      storage_path: "uploads/local-cover.jpg",
      file_name: "local-cover.jpg",
      mime_type: "image/jpeg",
      selected_in_clean: 1,
      is_cover: 1,
    });
    const localGallery = ctx.createLocalPublishAsset(item.id, {
      role: "gallery",
      storage_path: "uploads/local-gallery.jpg",
      file_name: "local-gallery.jpg",
      mime_type: "image/jpeg",
      selected_in_clean: 1,
      is_cover: 0,
      sort_order: 2,
    });
    ctx.db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_label, text_value, payload_json, lang, status
      ) VALUES (?, 'media', 'facebook', 'facebook', ?, ?, 'th', 'active')
    `).run(
      item.id,
      "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
      JSON.stringify({ field: "image", media_url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg" })
    );
    const refTarget = ctx.repo.listReferenceMediaByItem(item.id)[0];
    ctx.repo.setReferenceMediaSelected(item.id, refTarget.reference_media_id, true);

    const preview = ctx.repo.buildDraftInputPreview(item.id);
    assert.deepEqual(preview.image_context.selected_urls.sort(), [localCover.public_url, localGallery.public_url].sort());
    assert.equal(preview.image_context.selected_urls.includes("https://scontent.fubp1-1.fna.fbcdn.net/example.jpg"), false);
    assert.equal(preview.reference_media_context.selected_count, 1);
    assert.deepEqual(preview.reference_media_context.selected_urls, ["https://scontent.fubp1-1.fna.fbcdn.net/example.jpg"]);
  } finally {
    ctx.cleanup();
  }
});
