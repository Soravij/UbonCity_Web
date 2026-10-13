// Proposed location: collector/scripts/fix-evidence-owner-mismatch-20261013.mjs
// ลอกโครงจาก fix-item4-sr116-20261013.mjs: dry-run เป็นค่าเริ่มต้น, --apply เปิดฐานแบบเขียน + BEGIN IMMEDIATE
//
// ปัญหา: evidence_blocks.source_record_id ชี้ไปที่ source_records ที่ content_item_id ไม่ตรงกับ evidence แถวนั้น
// (วัดบน Runtime 2026-10-13 = 48 แถว: item 76 -> sr320 (owner 271), 107 -> sr476 (owner 516),
//  271 -> sr343 (owner 328), 318 -> sr475 (owner 515))
// แก้ตามเจ้าของ record (เนื้อหา evidence เป็นของสถานที่ใน record นั้น ไม่ใช่ของ item ที่ถือแถวอยู่):
//   - มี "แฝด" ที่ owner อยู่แล้ว (source_record_id + block_type + text_value + numeric_value เท่ากัน) -> DELETE แถวซ้ำ
//   - ไม่มีแฝด -> UPDATE content_item_id = owner
// ยกเลิก (abort) ถ้ามีตารางอื่น (เช่น approved_context_blocks) อ้างถึง evidence id ที่จะแตะ
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const EXPECTED = 48; // จำนวนแถวที่ตรวจพบตอน audit; ถ้าไม่ตรง = ข้อมูลเปลี่ยน ให้หยุดแล้วตรวจใหม่

function abort(msg, extra) {
  console.error("ABORT:", msg, extra ? JSON.stringify(extra) : "");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.COLLECTOR_DB || path.resolve(here, "../data/collector.db");
console.log("dbPath:", DB_PATH);
const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });

const rows = db
  .prepare(
    `SELECT eb.id AS evidence_id,
            eb.content_item_id AS ev_item,
            CAST(sr.id AS INTEGER) AS sr_id,
            sr.content_item_id AS owner_item,
            EXISTS (
              SELECT 1 FROM evidence_blocks o
              WHERE o.content_item_id = sr.content_item_id
                AND TRIM(o.source_record_id) = TRIM(eb.source_record_id)
                AND o.block_type = eb.block_type
                AND COALESCE(o.text_value, '') = COALESCE(eb.text_value, '')
                AND COALESCE(o.numeric_value, -1) = COALESCE(eb.numeric_value, -1)
            ) AS has_twin
     FROM evidence_blocks eb
     JOIN source_records sr ON CAST(sr.id AS TEXT) = TRIM(eb.source_record_id)
     WHERE eb.source_record_id IS NOT NULL
       AND sr.content_item_id <> eb.content_item_id
     ORDER BY eb.id`
  )
  .all();

const toDelete = rows.filter((r) => Number(r.has_twin) === 1);
const toRepoint = rows.filter((r) => Number(r.has_twin) !== 1);

// ตารางอื่นที่มี FK ไป evidence_blocks (เช่น approved_context_blocks.evidence_block_id)
const refCols = [];
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
  if (name === "evidence_blocks") continue;
  for (const fk of db.prepare(`PRAGMA foreign_key_list("${name}")`).all()) {
    if (fk.table === "evidence_blocks") refCols.push({ table: name, column: fk.from });
  }
}
const ids = rows.map((r) => r.evidence_id);
const referenced = [];
for (const { table, column } of refCols) {
  for (const id of ids) {
    const c = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE "${column}" = ?`).get(id).c);
    if (c > 0) referenced.push({ table, column, evidence_id: id, count: c });
  }
}

const perItem = {};
for (const r of rows) perItem[r.ev_item] = (perItem[r.ev_item] || 0) + 1;
console.log(
  JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    matched: rows.length,
    expected: EXPECTED,
    by_item: perItem,
    delete_twins: toDelete.length,
    repoint_to_owner: toRepoint.length,
    referenced_by_other_tables: referenced.length,
    sample: rows.slice(0, 5),
  })
);
if (!APPLY) process.exit(0);

if (rows.length !== EXPECTED) abort(`matched ${rows.length} rows, expected ${EXPECTED}`);
if (referenced.length) abort("evidence rows are referenced by other tables", referenced.slice(0, 10));

db.exec("BEGIN IMMEDIATE");
try {
  const del = db.prepare("DELETE FROM evidence_blocks WHERE id = ?");
  const upd = db.prepare("UPDATE evidence_blocks SET content_item_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  let deleted = 0;
  let repointed = 0;
  for (const r of toDelete) deleted += Number(del.run(r.evidence_id).changes);
  for (const r of toRepoint) repointed += Number(upd.run(r.owner_item, r.evidence_id).changes);
  if (deleted + repointed !== EXPECTED) throw new Error(`changed ${deleted + repointed}, expected ${EXPECTED}`);
  db.exec("COMMIT");
  console.log(JSON.stringify({ deleted, repointed }));
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
