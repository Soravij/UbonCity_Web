import "dotenv/config";
import { openDatabase } from "../db/client.mjs";
import { resolvePaths } from "../config/paths.mjs";

const APPLY = process.argv.includes("--apply");
const ITEM_ID = 4;
const YUU_CID = "496552753485033332";
const YUU_PLACE = "ChIJbRiAFC2GFjERdK-3Mxkc5AY";
const IMP_CID = "11274180913010047858";
const IMP_PLACE = "ChIJkbkrTTOHFjERcvtzpc7vdZw";

function abort(msg, extra) {
  console.error("ABORT:", msg, extra ? JSON.stringify(extra) : "");
  process.exit(1);
}

const paths = resolvePaths(process.cwd());
console.log("dbPath:", paths.dbPath);
const db = openDatabase(paths.dbPath);

const WHERE = "content_item_id = ? AND (COALESCE(source_url,'') LIKE ? OR COALESCE(text_value,'') LIKE ?)";
const args = [ITEM_ID, `%${YUU_CID}%`, `%${YUU_PLACE}%`];

const rows = db.prepare(`SELECT id, source_type, source_url, text_value FROM evidence_blocks WHERE ${WHERE}`).all(...args);
const leak = rows.filter((r) => `${r.source_url || ""} ${r.text_value || ""}`.includes(IMP_CID) || `${r.source_url || ""} ${r.text_value || ""}`.includes(IMP_PLACE));
const nonGoogle = rows.filter((r) => String(r.source_type || "").toLowerCase() !== "google_maps");
const total = Number(db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id = ?").get(ITEM_ID).c);

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", matched: rows.length, leak: leak.length, nonGoogle: nonGoogle.length, totalBefore: total }));
if (leak.length) abort("matched rows also reference Impression Sunrise", leak.map((r) => r.id));
if (nonGoogle.length) abort("matched non google_maps rows", nonGoogle.map((r) => [r.id, r.source_type]));
if (rows.length < 50 || rows.length > 60) abort("matched count outside expected 50-60", { matched: rows.length });
if (!APPLY) process.exit(0);

db.exec("BEGIN IMMEDIATE");
try {
  const res = db.prepare(`DELETE FROM evidence_blocks WHERE ${WHERE}`).run(...args);
  if (Number(res.changes) !== rows.length) throw new Error(`deleted ${res.changes} != matched ${rows.length}`);
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
const after = Number(db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id = ?").get(ITEM_ID).c);
console.log(JSON.stringify({ deleted: rows.length, totalBefore: total, totalAfter: after }));
