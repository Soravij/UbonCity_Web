import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));

  if (typeof db.close === "function") {
    db.close();
  }
  console.log("ensure-owner-login: no-op (collector local owner bootstrap removed; backend auth is authoritative)");
}

main();
