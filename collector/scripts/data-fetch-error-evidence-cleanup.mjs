import { DatabaseSync } from "node:sqlite";
const dbPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dbPath) { console.error("usage: <db> [--apply]"); process.exit(1); }
const db = new DatabaseSync(dbPath, apply ? {} : { readOnly: true });
db.exec("PRAGMA foreign_keys=ON");
const TARGET = `SELECT eb.id FROM evidence_blocks eb JOIN source_records sr ON CAST(sr.id AS TEXT) = CAST(eb.source_record_id AS TEXT)
  WHERE TRIM(COALESCE(json_extract(sr.payload_json, '$.metadata_fetch_error'), '')) <> ''`;
const total = db.prepare(`SELECT COUNT(*) AS c FROM (${TARGET})`).get().c;
const refs = db.prepare(`SELECT COUNT(*) AS c FROM approved_context_blocks WHERE evidence_block_id IN (${TARGET})`).get().c;
console.log(JSON.stringify({ target_blocks: total, approved_refs: refs }));
if (apply) {
  if (refs > 0) { console.error("STOP: approved_context_blocks reference target rows"); process.exit(2); }
  db.exec("BEGIN");
  try {
    const del = db.prepare(`DELETE FROM evidence_blocks WHERE id IN (${TARGET})`).run().changes;
    db.exec("COMMIT");
    console.log(JSON.stringify({ deleted: del, after: db.prepare(`SELECT COUNT(*) AS c FROM (${TARGET})`).get().c }));
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("ROLLBACK:", err?.message || err);
    process.exit(3);
  }
}
