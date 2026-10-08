import "dotenv/config";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolvePaths } from "../config/paths.mjs";
import { planBulkItemDelete, getNeverOverrideBlockersForItem } from "../services/raw-delete.mjs";

const APPLY = process.argv.includes("--apply");
const ACTOR = "fix-cross-merge-20261008";
const DELETE_IDS = [49, 53, 60, 64, 87, 90, 99, 248];
const IMPORTS = {
  "3117638a-39fb-427c-ac2e-9769e2a9b24f": [185],
  "d03e3834-97d0-49c4-a62e-10544367ddaf": [190, 193],
  "6872e682-ba9d-44ab-80c3-2ab3c3384f1c": [585, 591, 598, 604, 614],
  "e9d90a35-85eb-4fec-b237-0c4e3cdb4613": [689, 700],
  "8d978489-8cfd-4e7b-a924-67c4a6a353bb": [633, 660],
  "68bd7cfc-c43a-439d-9a47-a3fda5db4085": [475],
  "fa3ce0da-b5e1-44c1-8353-8125e0d92bf9": [983],
  "efb99ad2-497b-43c0-868d-35c3296d60e3": [997, 998, 1009, 1028],
  "45d1009c-84b1-426e-8288-96c11058d82e": [839],
};
const EXPECTED_IMPORTS = 19;

function abort(msg, extra) {
  console.error("ABORT:", msg, extra ? JSON.stringify(extra) : "");
  process.exit(1);
}

const paths = resolvePaths(process.cwd());
console.log("dbPath:", paths.dbPath);
const db = openDatabase(paths.dbPath);
const repo = createRepository(db);

// 1) items to delete must all be raw-only hard-deletable
const items = DELETE_IDS.map((id) => repo.getItem(id));
if (items.some((r) => !r || Number(r.is_deleted || 0) !== 0)) abort("delete target missing or already deleted");
const plan = planBulkItemDelete(items, {
  getRawOnlyHardDeleteEligibility: (id) => repo.getRawOnlyHardDeleteEligibility(id),
  getNeverOverrideBlockersForItem: (id) => getNeverOverrideBlockersForItem(db, id),
});
const hard = plan.actions.filter((a) => a.mode === "hard").map((a) => a.item_id);
if (hard.length !== DELETE_IDS.length || plan.blocked_rows.length) {
  abort("not all delete targets are hard-deletable", { hard, blocked: plan.blocked_rows });
}

// 2) every raw's place must have no live item, except the ones we are deleting
const rawIds = Object.values(IMPORTS).flat();
if (rawIds.length !== EXPECTED_IMPORTS) abort("import list size", { n: rawIds.length });
const placeStmt = db.prepare("SELECT json_extract(normalized_json, '$.google_place_id') AS p FROM source_raw_items WHERE id = ?");
const liveStmt = db.prepare("SELECT id FROM content_items WHERE is_deleted = 0 AND google_place_id = ?");
const liveConflicts = [];
for (const rid of rawIds) {
  const place = String(placeStmt.get(rid)?.p || "").trim();
  if (!place) abort("raw without place id", { rid });
  for (const row of liveStmt.all(place)) {
    if (!DELETE_IDS.includes(Number(row.id))) liveConflicts.push({ rid, place, item: row.id });
  }
}
if (liveConflicts.length) abort("live item already exists for raw place", liveConflicts);

// 3) hydrate every raw BEFORE deleting anything
process.env.DB_PATH = paths.dbPath;
process.env.COLLECTOR_DISABLE_LISTEN = "1";
const server = await import("../server/index.mjs");
const payloads = [];
for (const [batch, ids] of Object.entries(IMPORTS)) {
  const rows = server.hydrateRawSourceItems(batch, ids);
  const got = rows.map((r) => Number(r.id)).sort((a, b) => a - b);
  const want = [...ids].sort((a, b) => a - b);
  if (got.length !== want.length || got.some((v, i) => v !== want[i])) abort("hydrate mismatch", { batch, want, got });
  for (const rawItem of rows) {
    payloads.push({ rawItem, mode: "new", targetItemId: 0, adapter: "google_maps", actor: ACTOR });
  }
}

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", deleteHard: hard.length, hydrated: payloads.length }));
if (!APPLY) process.exit(0);

// 4) delete, then import
const del = repo.bulkDeleteItems(hard, [], ACTOR, { softDeleteAuditDetailsById: {} });
const deleted = Array.isArray(del?.deleted_ids) ? del.deleted_ids.length : 0;
if (deleted !== DELETE_IDS.length) abort("delete count", { deleted });
const summary = server.importCollectedRawItemsTxn(payloads);
console.log(JSON.stringify({
  deleted,
  new_count: summary.new_count,
  skipped_count: summary.skipped_count,
  results: summary.results.map((r) => [r.raw_item_id, r.decision, r.item_id]),
}));
process.exit(0);
