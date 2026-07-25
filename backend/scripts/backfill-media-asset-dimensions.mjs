import fs from "fs/promises";
import pool from "../config/db.js";
import { toUploadDiskPath } from "../services/publishedMediaService.js";
import { readImageDimensionsFromDiskPath } from "../services/imageDimensionsService.js";

function resolveDiskPath(row) {
  const fromStoragePath = toUploadDiskPath(row?.storage_path || "");
  if (fromStoragePath) return fromStoragePath;

  const fileName = String(row?.file_name || "").trim();
  if (!fileName) return "";
  return toUploadDiskPath(`uploads/${fileName}`);
}

async function main() {
  const connection = await pool.getConnection();
  let updated = 0;
  let skippedExternal = 0;
  let skippedMissingFile = 0;
  let failedUnreadable = 0;

  try {
    const [rows] = await connection.query(
      `SELECT id, storage_disk, storage_path, file_name
       FROM media_assets
       WHERE width IS NULL OR height IS NULL`
    );

    for (const row of rows) {
      const id = Number(row?.id || 0) || 0;
      if (!id) continue;

      if (String(row?.storage_disk || "").trim().toLowerCase() === "external") {
        skippedExternal += 1;
        continue;
      }

      const diskPath = resolveDiskPath(row);
      if (!diskPath) {
        skippedMissingFile += 1;
        console.log(`media_asset ${id}: no resolvable local file, leaving NULL`);
        continue;
      }

      try {
        await fs.access(diskPath);
      } catch {
        skippedMissingFile += 1;
        console.log(`media_asset ${id}: file missing at ${diskPath}, leaving NULL`);
        continue;
      }

      const { width, height } = await readImageDimensionsFromDiskPath(diskPath);
      if (width == null || height == null) {
        failedUnreadable += 1;
        console.log(`media_asset ${id}: could not read dimensions from ${diskPath}, leaving NULL`);
        continue;
      }

      await connection.query("UPDATE media_assets SET width=?, height=? WHERE id=?", [width, height, id]);
      updated += 1;
      console.log(`media_asset ${id}: width=${width} height=${height}`);
    }

    console.log(
      `done: total_candidates=${rows.length} updated=${updated} skipped_external=${skippedExternal} skipped_missing_file=${skippedMissingFile} failed_unreadable=${failedUnreadable}`
    );
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
