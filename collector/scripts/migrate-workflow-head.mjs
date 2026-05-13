import "dotenv/config";
import path from "path";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const dirs = resolvePaths(path.resolve(process.cwd()));
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
const db = openDatabase(dirs.dbPath, schemaPath);

try {
  const repo = createRepository(db);
  const result = repo.backfillWorkflowHeads("system@local");
  console.log(`Workflow head migration ready: ${dirs.dbPath}`);
  console.log(`Workflow head rows backfilled: ${Number(result?.count || 0)}`);
} catch (err) {
  console.error("Workflow head migration failed:", err?.message || err);
  process.exitCode = 1;
} finally {
  try {
    db.close();
  } catch {}
}
