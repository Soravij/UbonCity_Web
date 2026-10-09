import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { upsertSourceRecordForItem } from "../db/source-record-upsert.mjs";

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE source_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      source_type TEXT,
      source_name TEXT,
      source_url TEXT,
      source_entity_id TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_source_records_url ON source_records(source_url) WHERE source_url IS NOT NULL;
  `);
  return db;
}

function params(over = {}) {
  return {
    content_item_id: 1,
    source_type: "google_maps",
    source_name: "Google Maps",
    source_url: "https://maps.example/p1",
    source_entity_id: "place-1",
    payload_json: '{"v":1}',
    ...over,
  };
}

test("new url inserts one row", () => {
  const db = makeDb();
  const r = upsertSourceRecordForItem(db, params());
  assert.equal(r.status, "inserted");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_records").get().n, 1);
});

test("same url, same item updates payload and keeps owner", () => {
  const db = makeDb();
  upsertSourceRecordForItem(db, params());
  const r = upsertSourceRecordForItem(db, params({ payload_json: '{"v":2}' }));
  assert.equal(r.status, "updated");
  const rows = db.prepare("SELECT content_item_id, payload_json FROM source_records").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload_json, '{"v":2}');
  assert.equal(Number(rows[0].content_item_id), 1);
});

test("same url, other item is skipped and owner/payload unchanged", () => {
  const db = makeDb();
  upsertSourceRecordForItem(db, params());
  const origWarn = console.warn;
  console.warn = () => {};
  let r;
  try {
    r = upsertSourceRecordForItem(db, params({ content_item_id: 2, payload_json: '{"v":9}' }));
  } finally {
    console.warn = origWarn;
  }
  assert.equal(r.status, "skipped_owned_by_other");
  assert.equal(r.owner_item_id, 1);
  const rows = db.prepare("SELECT content_item_id, payload_json FROM source_records").all();
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].content_item_id), 1);
  assert.equal(rows[0].payload_json, '{"v":1}');
});

test("no source_url inserts every time", () => {
  const db = makeDb();
  upsertSourceRecordForItem(db, params({ source_url: null }));
  upsertSourceRecordForItem(db, params({ source_url: null }));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_records").get().n, 2);
});
