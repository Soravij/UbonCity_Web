import "dotenv/config";
import path from "path";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";

const dirs = resolvePaths(path.resolve(process.cwd()));
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");

openDatabase(dirs.dbPath, schemaPath);
console.log(`Database initialized: ${dirs.dbPath}`);

