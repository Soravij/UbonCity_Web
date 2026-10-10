import { DatabaseSync } from "node:sqlite";
const dbPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dbPath) { console.error("usage: <db> [--apply]"); process.exit(1); }
const db = new DatabaseSync(dbPath, apply ? {} : { readOnly: true });
db.exec("PRAGMA foreign_keys=ON");
const W_SIGNAL = `block_type='social_proof' AND numeric_value=0 AND text_value IN ('Rating signal','Review count signal')`;
const W_SNIPPET = `block_type='review_snippet' AND numeric_value=0`;
const count = (w) => db.prepare(`SELECT COUNT(*) AS c FROM evidence_blocks WHERE ${w}`).get().c;
console.log(JSON.stringify({ signal_zero: count(W_SIGNAL), snippet_zero: count(W_SNIPPET) }));
const refs = [];
for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all()) {
  for (const fk of db.prepare(`PRAGMA foreign_key_list("${name}")`).all()) {
    if (fk.table !== "evidence_blocks") continue;
    const c = db.prepare(`SELECT COUNT(*) AS c FROM "${name}" WHERE "${fk.from}" IN (SELECT id FROM evidence_blocks WHERE ${W_SIGNAL})`).get().c;
    refs.push({ table: name, column: fk.from, on_delete: fk.on_delete, refs: c });
  }
}
console.log(JSON.stringify({ fk_refs_to_signal_rows: refs }));
if (apply) {
  if (refs.some((r) => r.refs > 0)) { console.error("STOP: signal rows are referenced"); process.exit(2); }
  db.exec("BEGIN");
  const del = db.prepare(`DELETE FROM evidence_blocks WHERE ${W_SIGNAL}`).run().changes;
  const upd = db.prepare(`UPDATE evidence_blocks SET numeric_value=NULL WHERE ${W_SNIPPET}`).run().changes;
  db.exec("COMMIT");
  console.log(JSON.stringify({ deleted: del, updated: upd, after: { signal_zero: count(W_SIGNAL), snippet_zero: count(W_SNIPPET) } }));
}
