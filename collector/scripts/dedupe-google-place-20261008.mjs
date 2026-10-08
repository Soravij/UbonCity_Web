import "dotenv/config";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolvePaths } from "../config/paths.mjs";
import { planBulkItemDelete, getNeverOverrideBlockersForItem } from "../services/raw-delete.mjs";

const EXPECTED_IDS = [324,325,326,327,330,331,332,333,334,335,336,337,338,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,467,468,469,470,471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502];
const APPLY = process.argv.includes("--apply");
const ACTOR = "dedupe-script-20261008";

function abort(msg, extra) {
  console.error("ABORT:", msg, extra ? JSON.stringify(extra) : "");
  process.exit(1);
}

const paths = resolvePaths(process.cwd());
console.log("dbPath:", paths.dbPath);
const db = openDatabase(paths.dbPath);
const repo = createRepository(db);

const ids = db.prepare(`
  SELECT c.id FROM content_items c
  WHERE c.is_deleted = 0 AND TRIM(COALESCE(c.google_place_id,'')) <> ''
    AND c.id < (SELECT MAX(c2.id) FROM content_items c2
                WHERE c2.is_deleted = 0 AND c2.google_place_id = c.google_place_id)
  ORDER BY c.id
`).all().map((r) => Number(r.id));

if (ids.length !== EXPECTED_IDS.length || !ids.every((id, i) => id === EXPECTED_IDS[i])) {
  abort("candidate ids differ from expected", { count: ids.length, ids });
}

const items = ids.map((id) => repo.getItem(id));
if (items.some((r) => !r)) abort("missing item", { ids });

const plan = planBulkItemDelete(items, {
  getRawOnlyHardDeleteEligibility: (id) => repo.getRawOnlyHardDeleteEligibility(id),
  getNeverOverrideBlockersForItem: (id) => getNeverOverrideBlockersForItem(db, id),
});
const hard = plan.actions.filter((a) => a.mode === "hard").map((a) => a.item_id);
const soft = plan.actions.filter((a) => a.mode !== "hard").map((a) => a.item_id);
if (hard.length !== ids.length || soft.length || plan.blocked_rows.length) {
  abort("not all candidates are raw-only hard-deletable", { hard: hard.length, soft, blocked: plan.blocked_rows });
}

const countAll = () => Number(db.prepare("SELECT COUNT(*) AS c FROM content_items").get().c);
const dupGroups = () => Number(db.prepare(`
  SELECT COUNT(*) AS c FROM (
    SELECT google_place_id FROM content_items
    WHERE is_deleted = 0 AND TRIM(COALESCE(google_place_id,'')) <> ''
    GROUP BY google_place_id HAVING COUNT(*) > 1)
`).get().c);

const before = countAll();
console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", candidates: ids.length, hard: hard.length, before, dupGroups: dupGroups() }));
if (!APPLY) process.exit(0);

const result = repo.bulkDeleteItems(hard, [], ACTOR, { softDeleteAuditDetailsById: {} });
console.log(JSON.stringify({
  deleted: Array.isArray(result?.deleted_ids) ? result.deleted_ids.length : null,
  deleted_asset_ids: Array.isArray(result?.deleted_asset_ids) ? result.deleted_asset_ids.length : 0,
  before,
  after: countAll(),
  dupGroups: dupGroups(),
}));
