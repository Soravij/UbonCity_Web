import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "CollectCandidates!Test1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-collect-candidates-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);
  let batchSeq = 0;
  let checksumSeq = 0;

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
      title: "Candidate Cafe",
      description_raw: "raw",
      description_clean: "",
      image_url: "",
      source_type: "google_maps",
      source_name: "google_maps",
      source_url: "https://maps.google.com/?cid=123",
      map_url: "https://maps.google.com/?cid=123",
      google_place_id: "place-123",
      ...overrides,
    }).item;
  }

  function insertRawItem({ sourceRef = "", sourceUrl = "", placeId = "" }) {
    batchSeq += 1;
    const result = db.prepare(`
      INSERT INTO source_raw_items (
        batch_uid, source_ref, source_url, source_type, title_raw, description_raw, payload_json, normalized_json, status
      ) VALUES (?, ?, ?, 'google_maps', 'raw', 'raw', '{}', ?, 'raw')
    `).run(
      `candidates-batch-${batchSeq}`,
      sourceRef,
      sourceUrl,
      JSON.stringify(placeId ? { google_place_id: placeId } : {})
    );
    return Number(result.lastInsertRowid || 0) || 0;
  }

  function insertRawMedia(rawItemId, mediaUrl) {
    checksumSeq += 1;
    db.prepare(`
      INSERT INTO source_raw_media (raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json)
      VALUES (?, ?, ?, 'image/jpeg', 1200, 900, 'raw', '{}')
    `).run(rawItemId, mediaUrl, `candidates-sum-${checksumSeq}`);
  }

  function insertEvidenceMedia(itemId, mediaUrl) {
    db.prepare(`
      INSERT INTO evidence_blocks (
        content_item_id, block_type, source_type, source_label, text_value, payload_json, lang, status
      ) VALUES (?, 'media', 'facebook', 'facebook', ?, ?, 'th', 'active')
    `).run(
      itemId,
      mediaUrl,
      JSON.stringify({ field: "image", media_url: mediaUrl })
    );
  }

  return { db, repo, cleanup, createItem, insertRawItem, insertRawMedia, insertEvidenceMedia };
}

test("collectReferenceMediaCandidatesByItem returns only raw media whose source_url or place id matches the item", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    const matchingRaw = ctx.insertRawItem({
      sourceRef: "place-123",
      sourceUrl: "https://maps.google.com/?cid=123",
      placeId: "place-123",
    });
    ctx.insertRawMedia(matchingRaw, "https://img.wongnai.com/p/1200x0/2024/01/01/match-photo.jpg");

    const otherRaw = ctx.insertRawItem({
      sourceRef: "place-other",
      sourceUrl: "https://maps.google.com/?cid=999",
      placeId: "place-other",
    });
    ctx.insertRawMedia(otherRaw, "https://img.wongnai.com/p/1200x0/2024/01/01/other-photo.jpg");

    const rows = ctx.repo.collectReferenceMediaCandidatesByItem(item.id);

    assert.equal(rows.some((row) => row.url.includes("match-photo.jpg")), true, "matching raw media must be returned");
    assert.equal(rows.some((row) => row.url.includes("other-photo.jpg")), false, "unrelated raw media must not be returned");
    const matched = rows.find((row) => row.url.includes("match-photo.jpg"));
    assert.equal(matched.source_kind, "source_raw_media");
    assert.equal(matched.content_item_id, item.id);
    assert.match(matched.reference_media_id, /^rm:[0-9a-f]{16}$/);
    assert.equal(rows.every((row) => row.content_item_id === item.id), true);
  } finally {
    ctx.cleanup();
  }
});

test("collectReferenceMediaCandidatesByItem matches raw media through normalized_json google_place_id when source_url differs", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    const raw = ctx.insertRawItem({
      sourceRef: "",
      sourceUrl: "https://example.test/unrelated-listing",
      placeId: "place-123",
    });
    ctx.insertRawMedia(raw, "https://img.wongnai.com/p/1200x0/2024/01/01/via-place-id.jpg");

    const rows = ctx.repo.collectReferenceMediaCandidatesByItem(item.id);
    assert.equal(rows.some((row) => row.url.includes("via-place-id.jpg")), true);
  } finally {
    ctx.cleanup();
  }
});

test("collectReferenceMediaCandidatesByItem returns [] when no candidate condition matches", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem({
      source_url: "",
      map_url: "",
      google_place_id: "",
      image_url: "",
    });
    const unrelated = ctx.insertRawItem({
      sourceRef: "place-other",
      sourceUrl: "https://maps.google.com/?cid=999",
      placeId: "place-other",
    });
    ctx.insertRawMedia(unrelated, "https://img.wongnai.com/p/1200x0/2024/01/01/unrelated-photo.jpg");

    assert.deepEqual(ctx.repo.collectReferenceMediaCandidatesByItem(item.id), []);
  } finally {
    ctx.cleanup();
  }
});

test("collectReferenceMediaCandidatesByItem excludes junk URLs even when the raw item matches", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    const raw = ctx.insertRawItem({
      sourceRef: "place-123",
      sourceUrl: "https://maps.google.com/?cid=123",
      placeId: "place-123",
    });
    ctx.insertRawMedia(raw, "https://scontent.fubp1-1.fna.fbcdn.net/junk.jpg");

    const rows = ctx.repo.collectReferenceMediaCandidatesByItem(item.id);
    assert.equal(rows.some((row) => row.url.includes("fbcdn.net")), false);
    assert.equal(rows.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test("collectReferenceMediaCandidatesByItem dedupes by URL and keeps the evidence_block source over source_raw_media", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem({ image_url: "" });
    const sharedUrl = "https://img.wongnai.com/p/1200x0/2024/01/01/shared-photo.jpg";
    ctx.insertEvidenceMedia(item.id, sharedUrl);
    const raw = ctx.insertRawItem({
      sourceRef: "place-123",
      sourceUrl: "https://maps.google.com/?cid=123",
      placeId: "place-123",
    });
    ctx.insertRawMedia(raw, sharedUrl);

    const rows = ctx.repo.collectReferenceMediaCandidatesByItem(item.id).filter((row) => row.url === sharedUrl);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_kind, "evidence_block");
  } finally {
    ctx.cleanup();
  }
});

test("collectReferenceMediaCandidatesByItem rejects invalid and unknown item ids", () => {
  const ctx = createTestContext();
  try {
    assert.throws(() => ctx.repo.collectReferenceMediaCandidatesByItem(0), /invalid content_item_id/);
    assert.throws(() => ctx.repo.collectReferenceMediaCandidatesByItem(999999), /item not found/);
  } finally {
    ctx.cleanup();
  }
});

test("collectReferenceMediaCandidatesByItem matches raw media whose source_url has trailing newline padding", () => {
  const ctx = createTestContext();
  try {
    // Only the item's source_url can match: map_url, place id and entity ids are empty.
    const item = ctx.createItem({
      source_url: "https://example.test/listing-ws",
      map_url: "",
      google_place_id: "",
    });
    const padded = ctx.insertRawItem({
      sourceRef: "",
      sourceUrl: "https://example.test/listing-ws\n",
      placeId: "",
    });
    ctx.insertRawMedia(padded, "https://img.wongnai.com/p/1200x0/2024/01/01/padded-url-photo.jpg");

    const other = ctx.insertRawItem({
      sourceRef: "",
      sourceUrl: "https://example.test/listing-other\n",
      placeId: "",
    });
    ctx.insertRawMedia(other, "https://img.wongnai.com/p/1200x0/2024/01/01/padded-other-photo.jpg");

    const rows = ctx.repo.collectReferenceMediaCandidatesByItem(item.id);
    const matched = rows.find((row) => row.url.includes("padded-url-photo.jpg"));
    assert.ok(matched, "raw media with trailing-newline source_url must be returned");
    assert.equal(matched.source_kind, "source_raw_media");
    assert.equal(rows.some((row) => row.url.includes("padded-other-photo.jpg")), false, "unrelated padded raw media must not be returned");
  } finally {
    ctx.cleanup();
  }
});

test("collectReferenceMediaCandidatesByItem matches raw media whose source_ref has leading NBSP padding", () => {
  const ctx = createTestContext();
  try {
    // Only the source_records.source_entity_id can match source_ref: item place id is empty and
    // the raw source_url / normalized_json place id are unrelated to the item.
    const item = ctx.createItem({
      source_url: "https://example.test/item-ref",
      map_url: "",
      google_place_id: "",
      source_entity_id: "entity-ws-1",
    });
    const padded = ctx.insertRawItem({
      sourceRef: "\u00A0entity-ws-1",
      sourceUrl: "https://example.test/raw-unrelated",
      placeId: "place-unrelated",
    });
    ctx.insertRawMedia(padded, "https://img.wongnai.com/p/1200x0/2024/01/01/padded-ref-photo.jpg");

    const other = ctx.insertRawItem({
      sourceRef: "\u00A0entity-other",
      sourceUrl: "https://example.test/raw-other",
      placeId: "place-other",
    });
    ctx.insertRawMedia(other, "https://img.wongnai.com/p/1200x0/2024/01/01/padded-ref-other.jpg");

    const rows = ctx.repo.collectReferenceMediaCandidatesByItem(item.id);
    const matched = rows.find((row) => row.url.includes("padded-ref-photo.jpg"));
    assert.ok(matched, "raw media with NBSP-padded source_ref must be returned");
    assert.equal(matched.source_kind, "source_raw_media");
    assert.equal(rows.some((row) => row.url.includes("padded-ref-other.jpg")), false, "unrelated padded raw media must not be returned");
  } finally {
    ctx.cleanup();
  }
});
