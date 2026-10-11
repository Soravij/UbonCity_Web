import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.COLLECTOR_DB || path.resolve(here, "../data/collector.db");
const APPLY = process.argv.includes("--apply");
const SINGLETON_FIELDS = ["classification", "location", "opening_hours_weekday_text", "user_rating_count"];
const SHELL_TITLES = ["Name: Google Maps", "Name: google แผนที่"];

const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });
const q = (sql, ...a) => db.prepare(sql).all(...a);
const ph = (n) => Array(n).fill("?").join(",");

const KEEP_NEWEST = new Set(["opening_hours_weekday_text", "user_rating_count"]);
const LINK_TEXT = "Location link available";

const rows = q(`
  SELECT id, content_item_id, block_type,
         COALESCE(source_record_type,'') AS srt, COALESCE(CAST(source_record_id AS TEXT),'') AS sri,
         json_extract(payload_json,'$.field') AS field, TRIM(COALESCE(text_value,'')) AS txt
  FROM evidence_blocks
  WHERE json_valid(payload_json) AND json_extract(payload_json,'$.field') IN (${ph(SINGLETON_FIELDS.length)})
  ORDER BY id`, ...SINGLETON_FIELDS);

const recKey = (r) => [r.content_item_id, r.block_type, r.srt, r.sri].join("|");
const groups = new Map();
for (const r of rows) {
  const k = r.field === "location" ? `${recKey(r)}|location|${r.txt}` : `${recKey(r)}|${r.field}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const dupRows = [];
for (const g of groups.values()) {
  if (g.length < 2) continue;
  const keep = KEEP_NEWEST.has(g[0].field) ? g[g.length - 1] : g[0];
  for (const r of g) if (r !== keep) dupRows.push({ ...r, keep_id: keep.id, reason: "dup" });
}
// location: ถ้า record เดียวกันมีที่อยู่แล้ว ให้ลบ block "Location link available"
const recHasAddress = new Set(
  rows.filter((r) => r.field === "location" && r.txt && r.txt !== LINK_TEXT).map(recKey),
);
const already = new Set(dupRows.map((r) => Number(r.id)));
for (const r of rows) {
  if (r.field !== "location" || r.txt !== LINK_TEXT) continue;
  if (!recHasAddress.has(recKey(r)) || already.has(Number(r.id))) continue;
  dupRows.push({ ...r, keep_id: null, reason: "link_superseded_by_address" });
}
dupRows.sort((a, b) => Number(a.id) - Number(b.id));

const shellRows = q(`
  SELECT id, content_item_id, text_value FROM evidence_blocks
  WHERE text_value IN (${ph(SHELL_TITLES.length)})
    AND json_valid(payload_json) AND json_extract(payload_json,'$.field') = 'title'
  ORDER BY id`, ...SHELL_TITLES);

const targetIds = [...new Set([...dupRows, ...shellRows].map((r) => Number(r.id)))];

// หาทุกตาราง/คอลัมน์ที่อ้าง evidence_blocks
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
const refs = [];
for (const { t, c } of refCols.values()) {
  let n = 0;
  for (let i = 0; i < targetIds.length; i += 500) {
    const chunk = targetIds.slice(i, i + 500);
    if (!chunk.length) continue;
    n += Number(q(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" IN (${ph(chunk.length)})`, ...chunk)[0].n);
  }
  refs.push({ ref: `${t}.${c}`, n });
}

const byField = {};
for (const r of dupRows) byField[r.field] = (byField[r.field] || 0) + 1;
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run", db: DB_PATH,
  dup_excess_by_field: byField, dup_excess_total: dupRows.length,
  shell_title_total: shellRows.length, target_total: targetIds.length,
  refs, shell_ids: shellRows.map((r) => r.id), dup_ids: dupRows.map((r) => r.id),
  location_rows: dupRows.filter((r) => r.field === "location").map((r) => ({ id: r.id, keep_id: r.keep_id, reason: r.reason })),
}, null, 2));

if (!APPLY) process.exit(0);
if (refs.some((r) => r.n > 0)) { console.error("ABORT: target ids are referenced"); process.exit(1); }

db.exec("BEGIN");
try {
  let deleted = 0;
  for (let i = 0; i < targetIds.length; i += 500) {
    const chunk = targetIds.slice(i, i + 500);
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
