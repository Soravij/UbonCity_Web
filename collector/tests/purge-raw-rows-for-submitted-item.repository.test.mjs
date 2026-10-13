import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "PurgeRaw!Test1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");

const PHOTO = (name) => `/api/google-maps/photo?name=places%2Fabc%2Fphotos%2F${name}&maxWidthPx=800&maxHeightPx=800`;

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-purge-raw-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), schemaPath);
  const repo = createRepository(db);
  let itemSeq = 0;
  let rawSeq = 0;

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem({ url, placeId, state = "submitted_for_admin_review", deleted = false } = {}) {
    itemSeq += 1;
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "cafes",
      lang: "th",
      title: `Purge Cafe ${itemSeq}`,
      description_raw: "raw",
      description_clean: "",
      image_url: "",
      source_type: "google_maps",
      source_name: "google_maps",
      source_url: url || `https://maps.google.com/?cid=item-${itemSeq}`,
      map_url: url || `https://maps.google.com/?cid=item-${itemSeq}`,
      google_place_id: placeId || `gp-item-${itemSeq}`,
    }).item;
    db.prepare("UPDATE content_workflow_models SET production_state=? WHERE content_item_id=?").run(state, item.id);
    if (deleted) db.prepare("UPDATE content_items SET is_deleted=1 WHERE id=?").run(item.id);
    return item;
  }

  function insertRaw({ sourceUrl = "", placeId = "", media = [] }) {
    rawSeq += 1;
    const rawId = Number(
      db
        .prepare(`
          INSERT INTO source_raw_items (batch_uid, source_ref, source_url, source_type, title_raw, description_raw, payload_json, normalized_json, status)
          VALUES (?, '', ?, 'google_maps', 'raw', 'raw', '{}', ?, 'raw')
        `)
        .run(`purge-batch-${rawSeq}`, sourceUrl, JSON.stringify(placeId ? { google_place_id: placeId } : {})).lastInsertRowid
    );
    media.forEach((url, index) => {
      db.prepare(`
        INSERT INTO source_raw_media (raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json)
        VALUES (?, ?, ?, 'image/jpeg', 800, 600, 'raw', '{}')
      `).run(rawId, url, `purge-sum-${rawSeq}-${index}`);
    });
    return rawId;
  }

  const rawExists = (id) => Boolean(db.prepare("SELECT 1 FROM source_raw_items WHERE id=?").get(id));
  const mediaCount = (id) => Number(db.prepare("SELECT COUNT(*) c FROM source_raw_media WHERE raw_item_id=?").get(id).c);

  return { repo, cleanup, createItem, insertRaw, rawExists, mediaCount };
}

test("purgeRawRowsForSubmittedItem deletes rows owned only by the submitted item", () => {
  const ctx = createTestContext();
  try {
    const x = ctx.createItem({ url: "https://maps.google.com/?cid=x-1", placeId: "gp-x-1" });
    const raw = ctx.insertRaw({ sourceUrl: "https://maps.google.com/?cid=x-1", media: [PHOTO("p1"), PHOTO("p2")] });
    const unrelated = ctx.insertRaw({ sourceUrl: "https://maps.google.com/?cid=other", media: [PHOTO("p9")] });

    const result = ctx.repo.purgeRawRowsForSubmittedItem(x.id);

    assert.deepEqual(result.deleted_raw_ids, [raw]);
    assert.deepEqual([...result.unlink_media_urls].sort(), [PHOTO("p1"), PHOTO("p2")].sort());
    assert.equal(ctx.rawExists(raw), false);
    assert.equal(ctx.mediaCount(raw), 0, "media rows must be removed with the raw row");
    assert.equal(ctx.rawExists(unrelated), true, "unrelated raw rows are untouched");
    assert.equal(ctx.mediaCount(unrelated), 1);
  } finally {
    ctx.cleanup();
  }
});

test("purgeRawRowsForSubmittedItem keeps rows that also match an item not yet submitted", () => {
  const ctx = createTestContext();
  try {
    const x = ctx.createItem({ url: "https://maps.google.com/?cid=x-2", placeId: "gp-x-2" });
    ctx.createItem({ placeId: "gp-shared-2", state: "content_in_progress" });
    const shared = ctx.insertRaw({ sourceUrl: "https://maps.google.com/?cid=x-2", placeId: "gp-shared-2", media: [PHOTO("s1")] });

    const result = ctx.repo.purgeRawRowsForSubmittedItem(x.id);

    assert.deepEqual(result, { deleted_raw_ids: [], unlink_media_urls: [] });
    assert.equal(ctx.rawExists(shared), true);
    assert.equal(ctx.mediaCount(shared), 1);
  } finally {
    ctx.cleanup();
  }
});

test("purgeRawRowsForSubmittedItem deletes rows whose other matching items are deleted or already submitted", () => {
  const ctx = createTestContext();
  try {
    const x = ctx.createItem({ url: "https://maps.google.com/?cid=x-3", placeId: "gp-x-3" });
    ctx.createItem({ placeId: "gp-deleted-3", state: "collected", deleted: true });
    ctx.createItem({ placeId: "gp-sent-3", state: "submitted_for_admin_review" });
    const withDeleted = ctx.insertRaw({ sourceUrl: "https://maps.google.com/?cid=x-3", placeId: "gp-deleted-3", media: [PHOTO("d1")] });
    const withSent = ctx.insertRaw({ sourceUrl: "https://maps.google.com/?cid=x-3", placeId: "gp-sent-3", media: [PHOTO("d2")] });

    const result = ctx.repo.purgeRawRowsForSubmittedItem(x.id);

    assert.deepEqual([...result.deleted_raw_ids].sort((a, b) => a - b), [withDeleted, withSent].sort((a, b) => a - b));
    assert.equal(ctx.rawExists(withDeleted), false);
    assert.equal(ctx.rawExists(withSent), false);
  } finally {
    ctx.cleanup();
  }
});

test("purgeRawRowsForSubmittedItem does not list a proxy URL that a retained raw row still uses", () => {
  const ctx = createTestContext();
  try {
    const x = ctx.createItem({ url: "https://maps.google.com/?cid=x-4", placeId: "gp-x-4" });
    ctx.createItem({ placeId: "gp-open-4", state: "content_in_progress" });
    const owned = ctx.insertRaw({
      sourceUrl: "https://maps.google.com/?cid=x-4",
      media: [PHOTO("only-here"), PHOTO("also-kept")],
    });
    const retained = ctx.insertRaw({
      sourceUrl: "https://maps.google.com/?cid=x-4",
      placeId: "gp-open-4",
      media: [PHOTO("also-kept")],
    });

    const result = ctx.repo.purgeRawRowsForSubmittedItem(x.id);

    assert.deepEqual(result.deleted_raw_ids, [owned]);
    assert.deepEqual(result.unlink_media_urls, [PHOTO("only-here")]);
    assert.equal(ctx.rawExists(retained), true);
    assert.equal(ctx.mediaCount(retained), 1);
  } finally {
    ctx.cleanup();
  }
});
