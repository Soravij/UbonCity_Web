import "dotenv/config";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolvePaths } from "../config/paths.mjs";
import { mapGoogleTypesToCategory } from "../collector/sources/google-category.mjs";

const APPLY = process.argv.includes("--apply");
const ACTOR = "backfill-category-20261008";
const EXPECT_RAW = { cafes: 696, restaurants: 152, hotels: 8 };
const EXPECT_ITEMS = { cafes: 204, restaurants: 97, hotels: 3 };

function abort(msg, extra) {
  console.error("ABORT:", msg, extra ? JSON.stringify(extra) : "");
  process.exit(1);
}
function parse(s) {
  try { return JSON.parse(s || "{}") || {}; } catch { return {}; }
}
function sameCounts(actual, expected) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const k of keys) if ((actual[k] || 0) !== (expected[k] || 0)) return false;
  return true;
}

const paths = resolvePaths(process.cwd());
console.log("dbPath:", paths.dbPath);
const db = openDatabase(paths.dbPath);
const repo = createRepository(db);

const rawRows = db.prepare(
  "SELECT id, payload_json, normalized_json FROM source_raw_items WHERE source_type = 'google_maps' ORDER BY id"
).all();
const rawChanges = [];
const rawCount = {};
const mappedByPlace = new Map();
for (const row of rawRows) {
  const p = parse(row.payload_json);
  const inner = p.payload_json && typeof p.payload_json === "object" ? p.payload_json : {};
  const n = parse(row.normalized_json);
  const mapped = mapGoogleTypesToCategory(inner.primaryType ?? p.primaryType, inner.types ?? p.types ?? n.tags);
  const placeId = String(n.google_place_id || "").trim();
  const current = String(n.category || "").trim().toLowerCase();
  if (placeId && mapped) mappedByPlace.set(placeId, mapped);
  if (mapped && mapped !== current) {
    rawChanges.push({ id: Number(row.id), category: mapped });
    rawCount[mapped] = (rawCount[mapped] || 0) + 1;
  }
}

const items = db.prepare(
  "SELECT id, category, google_place_id FROM content_items WHERE is_deleted = 0 AND TRIM(COALESCE(google_place_id,'')) <> ''"
).all();
const itemIdsByCat = {};
for (const it of items) {
  const mapped = mappedByPlace.get(String(it.google_place_id).trim());
  if (!mapped || it.category !== "attractions" || mapped === "attractions") continue;
  (itemIdsByCat[mapped] ||= []).push(Number(it.id));
}
const itemCount = Object.fromEntries(Object.entries(itemIdsByCat).map(([k, v]) => [k, v.length]));

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", rawCount, itemCount }));
if (!sameCounts(rawCount, EXPECT_RAW)) abort("raw counts differ", rawCount);
if (!sameCounts(itemCount, EXPECT_ITEMS)) abort("item counts differ", itemCount);
if (!APPLY) process.exit(0);

let rawUpdated = 0;
let itemUpdated = 0;
db.exec("BEGIN IMMEDIATE");
try {
  const upd = db.prepare("UPDATE source_raw_items SET normalized_json = json_set(normalized_json, '$.category', ?) WHERE id = ?");
  for (const c of rawChanges) rawUpdated += Number(upd.run(c.category, c.id).changes || 0);
  for (const [cat, ids] of Object.entries(itemIdsByCat)) {
    itemUpdated += Number(repo.updateItemsCategory(ids, cat, ACTOR) || 0);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

const rawAfter = db.prepare(
  "SELECT json_extract(normalized_json, '$.category') AS c, COUNT(*) AS n FROM source_raw_items WHERE source_type = 'google_maps' GROUP BY c"
).all();
const itemAfter = db.prepare(
  "SELECT category AS c, COUNT(*) AS n FROM content_items WHERE is_deleted = 0 AND TRIM(COALESCE(google_place_id,'')) <> '' GROUP BY category"
).all();
console.log(JSON.stringify({ rawUpdated, itemUpdated, rawAfter, itemAfter }));
