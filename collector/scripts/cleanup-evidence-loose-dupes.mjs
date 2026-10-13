import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Loose-duplicate cleanup for fact evidence blocks.
// Loose duplicate = same content_item_id + same payload field + same normalized text_value
// + same numeric_value + same normalized list_value_json (NFKC, lower-case, punctuation/space stripped).
// source_record_id / source_url are ignored on purpose. list_value_json is part of the key because
// placeholder texts ("Opening hours", "Place classification") carry the real value there.
// Keep rule: a referenced row first (lowest referenced id), otherwise the lowest id.
const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.resolve(here, "../data/collector.db");
const APPLY = process.argv.includes("--apply");
const BLOCK_TYPE = "fact";

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const ph = (n) => Array(n).fill("?").join(",");
const chunks = (arr, size = 500) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");

q("PRAGMA foreign_keys");
const qc = q("PRAGMA quick_check")[0]?.quick_check;
if (qc !== "ok") { console.error("ABORT: quick_check =", qc); process.exit(1); }

const rows = q(`
  SELECT id, content_item_id, json_extract(payload_json,'$.field') AS field,
         text_value, numeric_value, list_value_json
  FROM evidence_blocks
  WHERE block_type = ? AND json_valid(payload_json)
  ORDER BY id`, BLOCK_TYPE);

const groups = new Map();
for (const r of rows) {
  const text = norm(r.text_value);
  const list = norm(r.list_value_json);
  const num = r.numeric_value == null ? "" : String(r.numeric_value);
  if (!text && !list && !num) continue;
  const k = [r.content_item_id, r.field ?? "", text, num, list].join("|");
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const dupGroups = [...groups.values()].filter((g) => g.length > 1);
const memberIds = dupGroups.flatMap((g) => g.map((r) => Number(r.id)));

// ทุกตาราง/คอลัมน์ที่อ้าง evidence_blocks
const tables = q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
const refCols = new Map();
for (const t of tables) {
  if (t === "evidence_blocks") continue;
  for (const fk of q(`PRAGMA foreign_key_list("${t}")`)) {
    if (fk.table === "evidence_blocks") refCols.set(`${t}.${fk.from}`, { t, c: fk.from });
  }
  for (const col of q(`PRAGMA table_info("${t}")`)) {
    if (col.name === "evidence_block_id") refCols.set(`${t}.${col.name}`, { t, c: col.name });
  }
}
const referenced = new Map(); // id -> ["table.col", ...]
for (const { t, c } of refCols.values()) {
  for (const chunk of chunks(memberIds)) {
    for (const r of q(`SELECT DISTINCT "${c}" AS id FROM "${t}" WHERE "${c}" IN (${ph(chunk.length)})`, ...chunk)) {
      const id = Number(r.id);
      if (!referenced.has(id)) referenced.set(id, []);
      referenced.get(id).push(`${t}.${c}`);
    }
  }
}

const delRows = [];
const pairs = [];
for (const g of dupGroups) {
  const sorted = [...g].sort((a, b) => Number(a.id) - Number(b.id));
  const keep = sorted.find((r) => referenced.has(Number(r.id))) || sorted[0];
  for (const r of sorted) {
    if (r === keep) continue;
    delRows.push({ id: Number(r.id), content_item_id: r.content_item_id, field: r.field, keep_id: Number(keep.id) });
  }
  pairs.push({ item: keep.content_item_id, field: keep.field, keep_id: Number(keep.id), delete_ids: sorted.filter((r) => r !== keep).map((r) => Number(r.id)), text: String(keep.text_value ?? "").slice(0, 60) });
}
delRows.sort((a, b) => a.id - b.id);
const targetIds = delRows.map((r) => r.id);
const targetReferenced = targetIds.filter((id) => referenced.has(id)).map((id) => ({ id, refs: referenced.get(id) }));

const byItem = {};
const byField = {};
for (const r of delRows) {
  const e = (byItem[r.content_item_id] ||= { count: 0, ids: [] });
  e.count += 1;
  e.ids.push(r.id);
  byField[r.field] = (byField[r.field] || 0) + 1;
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run", db: DB_PATH, block_type: BLOCK_TYPE,
  scanned: rows.length, dup_groups: dupGroups.length, delete_total: targetIds.length,
  delete_by_item: byItem, delete_by_field: byField,
  ref_columns: [...refCols.keys()], referenced_keep_groups: dupGroups.filter((g) => g.some((r) => referenced.has(Number(r.id)))).length,
  delete_ids_referenced: targetReferenced,
  groups: pairs,
}, null, 2));

if (!APPLY) process.exit(0);
if (targetReferenced.length) { console.error("ABORT: target ids are referenced"); process.exit(1); }

db.exec("BEGIN IMMEDIATE");
try {
  let deleted = 0;
  for (const chunk of chunks(targetIds)) {
    deleted += Number(db.prepare(`DELETE FROM evidence_blocks WHERE id IN (${ph(chunk.length)})`).run(...chunk).changes);
  }
  if (deleted !== targetIds.length) throw new Error(`deleted ${deleted} != ${targetIds.length}`);
  db.exec("COMMIT");
  console.log(`DELETED ${deleted}`);
} catch (e) {
  db.exec("ROLLBACK");
  console.error("ROLLBACK:", e.message);
  process.exit(1);
}
