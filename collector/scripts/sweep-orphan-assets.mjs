import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";

const commit = process.argv.includes("--commit");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dirs = resolvePaths(path.resolve(scriptDir, ".."));
const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));

function storageFilePath(storagePath) {
  const value = String(storagePath || "").trim();
  return path.isAbsolute(value) ? value : path.join(dirs.mediaDir, value);
}

try {
  const rows = db.prepare(`
    SELECT a.id, a.storage_disk, a.storage_path
    FROM assets a
    WHERE NOT EXISTS (SELECT 1 FROM content_assets ca WHERE ca.asset_id=a.id)
      AND NOT EXISTS (SELECT 1 FROM content_assignment_submission_deliverables d WHERE d.source_asset_id=a.id)
    ORDER BY a.id ASC
  `).all();
  const report = rows.map((row) => {
    const local = ["local", "nas"].includes(String(row?.storage_disk || ""));
    const storagePath = String(row?.storage_path || "").trim();
    const filePath = local && storagePath && !/^https?:\/\//i.test(storagePath) ? storageFilePath(storagePath) : null;
    return {
      asset_id: Number(row?.id || 0) || 0,
      storage_disk: row?.storage_disk || null,
      storage_path: storagePath || null,
      file_exists: filePath ? fs.existsSync(filePath) : null,
    };
  });
  const result = { dry_run: !commit, assets: report, deleted: [], failures: [] };
  if (commit) {
    for (const asset of report) {
      try {
        const stillUnused = db.prepare(`
          SELECT NOT EXISTS (SELECT 1 FROM content_assets WHERE asset_id=?)
             AND NOT EXISTS (SELECT 1 FROM content_assignment_submission_deliverables WHERE source_asset_id=?) AS ok
        `).get(asset.asset_id, asset.asset_id)?.ok;
        if (!stillUnused) continue;
        if (asset.file_exists && asset.storage_path) fs.unlinkSync(storageFilePath(asset.storage_path));
        db.prepare("DELETE FROM assets WHERE id=?").run(asset.asset_id);
        result.deleted.push(asset.asset_id);
      } catch (error) {
        result.failures.push({ asset_id: asset.asset_id, error: String(error?.message || error) });
      }
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  db.close();
}
