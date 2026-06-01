import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.resolve(scriptDir, "..");
const dirs = resolvePaths(collectorRoot);
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
const db = openDatabase(dirs.dbPath, schemaPath);

try {
  const repo = createRepository(db);
  const items = repo.listItems();
  const drifts = items
    .map((item) => repo.getWorkflowStateDriftByItem(item.id))
    .filter((row) => row?.has_drift);

  console.log(JSON.stringify({
    total_items: items.length,
    drift_count: drifts.length,
    drifts,
  }, null, 2));
} finally {
  db.close();
}
