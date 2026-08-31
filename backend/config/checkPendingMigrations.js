import pool from "./db.js";
import { classify } from "../scripts/migrate.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

export function computePending(files, ledgerFilenames) {
  const ledgerSet = new Set(ledgerFilenames);
  return files.filter((f) => !ledgerSet.has(f) && classify(f) === "runner");
}

export async function checkPendingMigrations() {
  try {
    const [rows] = await pool.query("SHOW TABLES LIKE ?", ["schema_migrations"]);
    if (!Array.isArray(rows) || rows.length === 0) {
      return { hasLedger: false, pending: [] };
    }

    const [ledgerRows] = await pool.query("SELECT filename FROM schema_migrations");
    const ledgerFilenames = ledgerRows.map((r) => r.filename);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"));

    const pending = computePending(files, ledgerFilenames);

    return { hasLedger: true, pending };
  } catch (err) {
    return { hasLedger: false, pending: [], error: err.message };
  }
}
