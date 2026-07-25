import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Any script that opens a real database connection must call an assertSmoke* guard before opening it.
// Keep connection wrappers as a separate follow-up; importing this helper must remain side-effect free.
const SAFE_TEST_DATABASE_NAMES = new Set([
  "uboncity_test",
  "uboncity_smoke",
  "uboncity_web_test",
]);

function normalize(value) {
  return String(value || "").trim();
}

export function assertSmokeDatabaseAllowed(databaseName, environment = process.env) {
  const database = normalize(databaseName);
  const explicitAllow = normalize(environment?.SMOKE_ALLOW_DB);
  if (!database) throw new Error("smoke safety check failed: DB_NAME is required");
  if (SAFE_TEST_DATABASE_NAMES.has(database.toLowerCase()) || explicitAllow === database) return;
  throw new Error(
    `smoke safety check failed: refusing DB_NAME=${database}. Use a test database (${[...SAFE_TEST_DATABASE_NAMES].join(", ")}) or set SMOKE_ALLOW_DB=${database} exactly.`
  );
}

export function assertSmokeSqliteDatabaseAllowed(databasePath, environment = process.env) {
  const target = resolveRealPathOrParent(databasePath);
  const explicitAllow = normalize(environment?.SMOKE_ALLOW_DB);
  if (!target) throw new Error("smoke safety check failed: DB_PATH is required");
  const tempRoot = resolveRealPathOrParent(os.tmpdir());
  const allowedTarget = explicitAllow ? resolveRealPathOrParent(explicitAllow) : "";
  if (allowedTarget && target === allowedTarget) return;
  const relative = path.relative(tempRoot, target);
  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) return;
  throw new Error(
    `smoke safety check failed: refusing DB_PATH=${target}. Use a database below ${tempRoot} or set SMOKE_ALLOW_DB to the same real path exactly.`
  );
}

function resolveRealPathOrParent(value) {
  const input = normalize(value);
  if (!input) return "";
  const absolute = path.resolve(input);
  let existing = absolute;
  const missingSegments = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...missingSegments);
}
