import "dotenv/config";
import { openDatabase } from "../db/client.mjs";
import { resolvePaths } from "../config/paths.mjs";
import { pruneGooglePhotoEvidence } from "../server/evidence-media-prune.mjs";

const APPLY = process.argv.includes("--apply");
const EXPECTED_DELETED = 4414;

const paths = resolvePaths(process.cwd());
console.log("dbPath:", paths.dbPath);
const db = openDatabase(paths.dbPath);

const countMedia = () => Number(db.prepare(
  "SELECT COUNT(*) AS c FROM evidence_blocks WHERE block_type = 'media' AND text_value LIKE '%places%2F%'"
).get().c);
const itemIds = db.prepare(
  "SELECT DISTINCT content_item_id AS id FROM evidence_blocks WHERE block_type = 'media' AND text_value LIKE '%places%2F%'"
).all().map((r) => Number(r.id));

const before = countMedia();
let deleted = 0;
const perItem = [];
db.exec("BEGIN IMMEDIATE");
try {
  for (const id of itemIds) {
    const r = pruneGooglePhotoEvidence(db, id);
    if (r.deleted) perItem.push([id, r.deleted]);
    deleted += r.deleted;
  }
  const after = countMedia();
  const emptied = db.prepare(`
    SELECT c.id FROM content_items c
    WHERE c.id IN (${itemIds.map(() => "?").join(",") || "NULL"})
      AND NOT EXISTS (SELECT 1 FROM evidence_blocks e WHERE e.content_item_id = c.id AND e.block_type = 'media' AND e.text_value LIKE '%places%2F%')
  `).all(...itemIds).map((r) => Number(r.id));
  perItem.sort((a, b) => b[1] - a[1]);
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", items: itemIds.length, before, deleted, after, emptied, top5: perItem.slice(0, 5) }));
  if (!APPLY || deleted !== EXPECTED_DELETED || emptied.length) {
    db.exec("ROLLBACK");
    if (APPLY) console.error("ABORT: rolled back", JSON.stringify({ deleted, expected: EXPECTED_DELETED, emptied }));
    process.exit(APPLY ? 1 : 0);
  }
  db.exec("COMMIT");
  console.log("COMMITTED");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
