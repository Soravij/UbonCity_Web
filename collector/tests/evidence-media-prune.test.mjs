import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pruneGooglePhotoEvidence } from "../server/evidence-media-prune.mjs";

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE content_items (id INTEGER PRIMARY KEY, google_place_id TEXT);
    CREATE TABLE source_records (id INTEGER PRIMARY KEY, content_item_id INTEGER, source_entity_id TEXT);
    CREATE TABLE evidence_blocks (id INTEGER PRIMARY KEY, content_item_id INTEGER, block_type TEXT, text_value TEXT, created_at TEXT);
    CREATE TABLE approved_context_blocks (id INTEGER PRIMARY KEY, evidence_block_id INTEGER);
  `);
  return db;
}

const photo = (place, token) => `/api/google-maps/photo?name=places%2F${place}%2Fphotos%2F${token}&maxWidthPx=1400`;

function addMedia(db, id, text, createdAt, itemId = 1) {
  db.prepare("INSERT INTO evidence_blocks (id, content_item_id, block_type, text_value, created_at) VALUES (?, ?, 'media', ?, ?)")
    .run(id, itemId, text, createdAt);
}

function remaining(db) {
  return db.prepare("SELECT id FROM evidence_blocks ORDER BY id").all().map((r) => r.id);
}

test("own place with two batches 1 minute apart: old batch deleted, latest kept", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items (id, google_place_id) VALUES (1, 'PLACE_A')").run();
  addMedia(db, 1, photo("PLACE_A", "t1"), "2026-10-01 10:00:00");
  addMedia(db, 2, photo("PLACE_A", "t2"), "2026-10-01 10:00:01");
  addMedia(db, 3, photo("PLACE_A", "t3"), "2026-10-01 10:01:00");
  addMedia(db, 4, photo("PLACE_A", "t4"), "2026-10-01 10:01:01");
  const res = pruneGooglePhotoEvidence(db, 1);
  assert.equal(res.deleted, 2);
  assert.deepEqual(remaining(db), [3, 4]);
});

test("rows in the same batch within 5 seconds are not deleted", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items (id, google_place_id) VALUES (1, 'PLACE_A')").run();
  addMedia(db, 1, photo("PLACE_A", "t1"), "2026-10-01 10:00:00");
  addMedia(db, 2, photo("PLACE_A", "t2"), "2026-10-01 10:00:03");
  addMedia(db, 3, photo("PLACE_A", "t3"), "2026-10-01 10:00:05");
  const res = pruneGooglePhotoEvidence(db, 1);
  assert.equal(res.deleted, 0);
  assert.deepEqual(remaining(db), [1, 2, 3]);
});

test("photos of another place are deleted", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items (id, google_place_id) VALUES (1, 'PLACE_A')").run();
  addMedia(db, 1, photo("PLACE_A", "t1"), "2026-10-01 10:00:00");
  addMedia(db, 2, photo("PLACE_OTHER", "t2"), "2026-10-01 10:00:00");
  const res = pruneGooglePhotoEvidence(db, 1);
  assert.equal(res.deleted, 1);
  assert.deepEqual(remaining(db), [1]);
});

test("old row referenced by approved_context_blocks is kept", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items (id, google_place_id) VALUES (1, 'PLACE_A')").run();
  addMedia(db, 1, photo("PLACE_A", "t1"), "2026-10-01 10:00:00");
  addMedia(db, 2, photo("PLACE_A", "t2"), "2026-10-01 10:01:00");
  addMedia(db, 3, photo("PLACE_OTHER", "t3"), "2026-10-01 10:01:00");
  db.prepare("INSERT INTO approved_context_blocks (id, evidence_block_id) VALUES (1, 1)").run();
  db.prepare("INSERT INTO approved_context_blocks (id, evidence_block_id) VALUES (2, 3)").run();
  const res = pruneGooglePhotoEvidence(db, 1);
  assert.equal(res.deleted, 0);
  assert.deepEqual(remaining(db), [1, 2, 3]);
});

test("item without google_place_id and source_records deletes nothing", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items (id, google_place_id) VALUES (1, NULL)").run();
  addMedia(db, 1, photo("PLACE_A", "t1"), "2026-10-01 10:00:00");
  addMedia(db, 2, photo("PLACE_A", "t2"), "2026-10-01 10:01:00");
  const res = pruneGooglePhotoEvidence(db, 1);
  assert.equal(res.deleted, 0);
  assert.deepEqual(remaining(db), [1, 2]);
});

test("media without places%2F (e.g. Wongnai) is untouched", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items (id, google_place_id) VALUES (1, 'PLACE_A')").run();
  addMedia(db, 1, "https://img.wongnai.com/photo/abc.jpg", "2026-10-01 10:00:00");
  addMedia(db, 2, photo("PLACE_A", "t2"), "2026-10-01 10:01:00");
  const res = pruneGooglePhotoEvidence(db, 1);
  assert.equal(res.deleted, 0);
  assert.deepEqual(remaining(db), [1, 2]);
});

test("place matching source_records.source_entity_id counts as own, latest batch kept", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items (id, google_place_id) VALUES (1, NULL)").run();
  db.prepare("INSERT INTO source_records (id, content_item_id, source_entity_id) VALUES (1, 1, 'PLACE_S')").run();
  addMedia(db, 1, photo("PLACE_S", "t1"), "2026-10-01 10:00:00");
  addMedia(db, 2, photo("PLACE_S", "t2"), "2026-10-01 10:01:00");
  addMedia(db, 3, photo("PLACE_S", "t3"), "2026-10-01 10:01:02");
  addMedia(db, 4, photo("PLACE_OTHER", "t4"), "2026-10-01 10:01:00");
  const res = pruneGooglePhotoEvidence(db, 1);
  assert.equal(res.deleted, 2);
  assert.deepEqual(remaining(db), [2, 3]);
});
