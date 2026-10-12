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

const URL = "https://example.test/preserve-1";

function call(db, { type, name, entity, payload }) {
  return upsertSourceRecordForItem(db, {
    content_item_id: 1,
    source_type: type,
    source_name: name,
    source_url: URL,
    source_entity_id: entity,
    payload_json: payload,
  });
}

function readRows(db) {
  return db.prepare("SELECT source_type, source_name, source_entity_id, payload_json FROM source_records WHERE content_item_id = 1").all();
}

const GMAPS = { type: "google_maps", name: "google-maps", entity: "E1", payload: '{"a":1}' };
const DEFAULTS = { type: "manual", name: "manual", entity: null, payload: null };

test("A: defaults/null from caller do not overwrite existing type/name/entity/payload", () => {
  const db = makeDb();
  assert.equal(call(db, GMAPS).status, "inserted");
  const r = call(db, DEFAULTS);
  assert.equal(r.status, "updated");
  const rows = readRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_type, "google_maps");
  assert.equal(rows[0].source_name, "google-maps");
  assert.equal(rows[0].source_entity_id, "E1");
  assert.equal(rows[0].payload_json, '{"a":1}');
});

test("B: real values from caller still overwrite entity/payload", () => {
  const db = makeDb();
  call(db, GMAPS);
  const r = call(db, { type: "google_maps", name: "google-maps", entity: "E2", payload: '{"b":2}' });
  assert.equal(r.status, "updated");
  const rows = readRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_entity_id, "E2");
  assert.equal(rows[0].payload_json, '{"b":2}');
});

test("C: manual type with real name keeps name and payload when caller sends defaults", () => {
  const db = makeDb();
  call(db, { type: "manual", name: "wongnai.com", entity: null, payload: '{"w":1}' });
  const r = call(db, DEFAULTS);
  assert.equal(r.status, "updated");
  const rows = readRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_name, "wongnai.com");
  assert.equal(rows[0].payload_json, '{"w":1}');
});
