import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.COLLECTOR_DB || path.resolve(here, "../data/collector.db");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ""; };
const ITEM_ID = Number(argVal("--item") || 0);
const IDS = String(argVal("--ids") || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
if (!ITEM_ID || !IDS.length) { console.error("usage: --item <id> --ids <id,id> [--apply]"); process.exit(1); }

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const ph = (n) => Array(n).fill("?").join(",");
const idText = IDS.map(String);

const rows = q(`SELECT id, content_item_id, source_type, source_name, source_url FROM source_records WHERE id IN (${ph(IDS.length)})`, ...IDS);
const wrongItem = rows.filter((r) => Number(r.content_item_id) !== ITEM_ID).map((r) => r.id);
const missing = IDS.filter((id) => !rows.some((r) => Number(r.id) === id));

const evidenceIds = q(
  `SELECT id FROM evidence_blocks WHERE source_record_type='source_records' AND CAST(source_record_id AS TEXT) IN (${ph(idText.length)})`,
  ...idText,
).map((r) => Number(r.id));

// ตารางอื่นที่อ้าง source_records หรือ evidence_blocks ที่จะลบ
const tables = q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
const refs = [];
for (const t of tables) {
  for (const col of q(`PRAGMA table_info("${t}")`)) {
    let targets = null;
    if (t !== "evidence_blocks" && t !== "source_records" && col.name === "source_record_id") targets = idText;
    if (t !== "evidence_blocks" && col.name === "evidence_block_id") targets = evidenceIds.map(String);
    if (!targets || !targets.length) continue;
    const n = Number(q(`SELECT COUNT(*) AS n FROM "${t}" WHERE CAST("${col.name}" AS TEXT) IN (${ph(targets.length)})`, ...targets)[0].n);
    refs.push({ ref: `${t}.${col.name}`, n });
  }
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run", db: DB_PATH, item: ITEM_ID,
  source_records: rows, wrong_item: wrongItem, missing,
  evidence_block_ids: evidenceIds, refs,
}, null, 2));

if (!APPLY) process.exit(0);
if (wrongItem.length || missing.length) { console.error("ABORT: ids not all owned by item"); process.exit(1); }
if (refs.some((r) => r.n > 0)) { console.error("ABORT: referenced by other tables"); process.exit(1); }

db.exec("BEGIN");
try {
  let ev = 0;
  if (evidenceIds.length) ev = Number(db.prepare(`DELETE FROM evidence_blocks WHERE id IN (${ph(evidenceIds.length)})`).run(...evidenceIds).changes);
  const sr = Number(db.prepare(`DELETE FROM source_records WHERE id IN (${ph(IDS.length)}) AND content_item_id = ?`).run(...IDS, ITEM_ID).changes);
  if (ev !== evidenceIds.length || sr !== IDS.length) throw new Error(`deleted ev=${ev}/${evidenceIds.length} sr=${sr}/${IDS.length}`);
  db.exec("COMMIT");
  console.log(`DELETED evidence=${ev} source_records=${sr}`);
} catch (e) {
  db.exec("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}
