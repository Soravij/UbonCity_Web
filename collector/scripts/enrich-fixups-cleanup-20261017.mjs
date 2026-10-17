import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { resolvePaths } from "../config/paths.mjs";

// Removes the wrong-place source_records listed in audit/enrich-fixups.md and archives their evidence.
// Default is dry-run; pass --apply to write.
const TARGETS = [
  { item_id: 433, url_contains: "416740aE" }, // source_record 798
  { item_id: 520, url_contains: "300866KJ" }, // source_record 881
  { item_id: 85, url_contains: "482352dC" },
  { item_id: 110, url_contains: "691384Vf" },
];
const APPLY = process.argv.includes("--apply");

const paths = resolvePaths(process.cwd());
console.log("dbPath:", paths.dbPath);
const db = new DatabaseSync(paths.dbPath, { readOnly: !APPLY });

const findSources = db.prepare("SELECT id FROM source_records WHERE content_item_id=? AND source_url LIKE ?");
const evidenceWhere = `status <> 'archived' AND content_item_id=@item AND (source_record_id=@sr OR source_url LIKE @like)`;
const countEvidence = db.prepare(`SELECT COUNT(*) AS c FROM evidence_blocks WHERE ${evidenceWhere}`);
const archiveEvidence = APPLY ? db.prepare(`UPDATE evidence_blocks SET status='archived', updated_at=CURRENT_TIMESTAMP WHERE ${evidenceWhere}`) : null;
const deleteSource = APPLY ? db.prepare("DELETE FROM source_records WHERE id=?") : null;

let totalSource = 0;
let totalEvidence = 0;
if (APPLY) db.exec("BEGIN");
try {
  for (const t of TARGETS) {
    const like = `%${t.url_contains}%`;
    const rows = findSources.all(t.item_id, like);
    if (rows.length !== 1) {
      console.log(`item=${t.item_id} sr=MISMATCH source_delete=0 evidence_archive=0 (found ${rows.length})`);
      continue;
    }
    const sr = Number(rows[0].id);
    const params = { item: t.item_id, sr, like };
    const evidence = Number(countEvidence.get(params).c);
    if (APPLY) {
      archiveEvidence.run(params);
      deleteSource.run(sr);
    }
    totalSource += 1;
    totalEvidence += evidence;
    console.log(`item=${t.item_id} sr=${sr} source_delete=1 evidence_archive=${evidence}`);
  }
  if (APPLY) db.exec("COMMIT");
} catch (err) {
  if (APPLY) db.exec("ROLLBACK");
  throw err;
}
console.log(`TOTAL source_delete=${totalSource} evidence_archive=${totalEvidence} mode=${APPLY ? "apply" : "dry-run"}`);
