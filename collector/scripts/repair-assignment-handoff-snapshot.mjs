import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const assignmentId = Number(readCliOption("--assignment-id") || 0) || 0;
  const fieldPackId = Number(readCliOption("--field-pack-id") || 0) || 0;
  if (!assignmentId || !fieldPackId) {
    throw new Error("Usage: node collector/scripts/repair-assignment-handoff-snapshot.mjs --assignment-id <id> --field-pack-id <id> [--apply]");
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const collectorRoot = path.resolve(scriptDir, "..");
  const dirs = resolvePaths(collectorRoot);
  const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
  const db = openDatabase(dirs.dbPath, schemaPath);

  try {
    const repo = createRepository(db);
    const diagnostics = repo.repairAssignmentHandoffSnapshotForAssignment(assignmentId, fieldPackId, {
      apply: hasFlag("--apply"),
      actorEmail: String(process.env.COLLECTOR_REPAIR_ACTOR || "script:repair-assignment-handoff-snapshot").trim(),
    });
    console.log(JSON.stringify(diagnostics, null, 2)); 
    
    if (diagnostics?.ok === false) { 
      process.exitCode = 1; 
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exitCode = 1;
});
