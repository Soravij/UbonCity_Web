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
  const missing = items
    .filter((item) => !repo.getWorkflowHeadByItem(item.id))
    .map((item) => ({
      id: Number(item?.id || 0) || 0,
      title: String(item?.title || "").trim() || null,
      type: String(item?.type || "").trim() || null,
      category: String(item?.category || "").trim() || null,
      legacy_workflow_status: String(item?.workflow_status || "").trim().toLowerCase() || "raw",
    }));

  console.log(JSON.stringify({
    total_items: items.length,
    missing_head_count: missing.length,
    missing,
  }, null, 2));
} finally {
  db.close();
}
