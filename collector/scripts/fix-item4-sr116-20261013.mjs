import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const ITEM_ID = 4;
const FROM_SR = "116";
const TO_SR = "4";

function abort(msg, extra) {
  console.error("ABORT:", msg, extra ? JSON.stringify(extra) : "");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.resolve(here, "../data/collector.db");
console.log("dbPath:", DB_PATH);
const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });

const rows = db
  .prepare("SELECT id, block_type FROM evidence_blocks WHERE content_item_id = ? AND source_record_id = ?")
  .all(ITEM_ID, FROM_SR);

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", matched: rows.length, ids: rows.map((r) => r.id) }));
if (!APPLY) process.exit(0);

db.exec("BEGIN IMMEDIATE");
try {
  const target = db.prepare("SELECT id FROM source_records WHERE id = ? AND content_item_id = ?").get(Number(TO_SR), ITEM_ID);
  if (!target) throw new Error(`source_records id=${TO_SR} content_item_id=${ITEM_ID} not found`);
  const res = db
    .prepare("UPDATE evidence_blocks SET source_record_id = ? WHERE content_item_id = ? AND source_record_id = ?")
    .run(TO_SR, ITEM_ID, FROM_SR);
  console.log(JSON.stringify({ changes: Number(res.changes) }));
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
