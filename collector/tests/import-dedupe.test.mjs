import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { findLiveItemByGooglePlaceId } from "../server/import-dedupe.mjs";

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE content_items(id INTEGER PRIMARY KEY, title TEXT, google_place_id TEXT, is_deleted INTEGER NOT NULL DEFAULT 0)");
  return db;
}

test("empty or blank place id returns null", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items(title, google_place_id) VALUES ('a', '')").run();
  assert.equal(findLiveItemByGooglePlaceId(db, ""), null);
  assert.equal(findLiveItemByGooglePlaceId(db, "  "), null);
  assert.equal(findLiveItemByGooglePlaceId(db, null), null);
});

test("two live rows with same place id returns the higher id", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items(title, google_place_id) VALUES ('old', 'P1')").run();
  db.prepare("INSERT INTO content_items(title, google_place_id) VALUES ('new', 'P1')").run();
  const row = findLiveItemByGooglePlaceId(db, " P1 ");
  assert.equal(row.id, 2);
  assert.equal(row.title, "new");
});

test("only deleted rows returns null", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items(title, google_place_id, is_deleted) VALUES ('gone', 'P2', 1)").run();
  assert.equal(findLiveItemByGooglePlaceId(db, "P2"), null);
});

test("unknown place id returns null", () => {
  const db = makeDb();
  db.prepare("INSERT INTO content_items(title, google_place_id) VALUES ('a', 'P3')").run();
  assert.equal(findLiveItemByGooglePlaceId(db, "NOPE"), null);
});
