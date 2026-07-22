import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(import.meta.dirname, "..");
const migration = (name) => fs.readFileSync(path.join(backendRoot, "migrations", name), "utf8");
const eventController = fs.readFileSync(path.join(backendRoot, "controllers", "eventController.js"), "utf8");
const importCsv = fs.readFileSync(path.resolve(backendRoot, "..", "admin", "src", "pages", "ImportCsv.jsx"), "utf8");

test("events.is_published drop is guarded and no runtime backfill remains", () => {
  const source = migration("018_drop_events_is_published.sql");
  assert.match(source, /information_schema\.COLUMNS/);
  assert.match(source, /ALTER TABLE events DROP COLUMN is_published/);
  assert.doesNotMatch(eventController, /legacyPublishCol|WHERE is_published=1/);
  assert.doesNotMatch(importCsv, /is_published|"type,/);
});

test("places.lat/lng migration blocks unsafe legacy-only coordinates and is guarded", () => {
  const source = migration("019_drop_places_lat_lng.sql");
  assert.match(source, /IF legacy_columns_present >= 1 THEN/);
  assert.match(source, /lat_present = 1 AND lng_present = 1/);
  assert.match(source, /IF\(lat_present = 1, 'lat IS NOT NULL', 'lng IS NOT NULL'\)/);
  assert.match(source, /SET @assertion_sql = CONCAT\(/);
  assert.match(source, /SIGNAL SQLSTATE '45000'/);
  assert.match(source, /ALTER TABLE places DROP COLUMN lat/);
  assert.match(source, /ALTER TABLE places DROP COLUMN lng/);
  assert.match(source, /information_schema\.COLUMNS/);
  assert.doesNotMatch(source, /DROP COLUMN IF EXISTS/);
});

test("curated taxonomy cleanup is limited to the places projection", () => {
  const source = migration("020_drop_places_curated_taxonomy_json.sql");
  assert.match(source, /ALTER TABLE places DROP COLUMN curated_taxonomy_json/);
  assert.match(source, /information_schema\.COLUMNS/);
  assert.doesNotMatch(source, /field_packs|confirmed_taxonomy_checks|review_payload_json|homepageCurationService/);
});
