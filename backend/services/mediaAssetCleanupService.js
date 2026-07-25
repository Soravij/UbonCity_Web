import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");

export function toMediaUploadDiskPath(storagePath, fileName = "") {
  const normalizedPath = String(storagePath || "").trim().replace(/\\/g, "/");
  if (normalizedPath.startsWith("uploads/")) {
    return path.join(BACKEND_UPLOADS_DIR, normalizedPath.slice("uploads/".length));
  }
  const normalizedFileName = String(fileName || "").trim();
  return normalizedFileName ? path.join(BACKEND_UPLOADS_DIR, normalizedFileName) : "";
}

export async function cleanupUnreferencedMediaAssets(executor, assetIds = []) {
  const uniqueAssetIds = Array.from(new Set((assetIds || []).map((value) => Number(value || 0)).filter(Boolean)));
  if (!uniqueAssetIds.length) return [];

  const placeholders = uniqueAssetIds.map(() => "?").join(",");
  const [usageRows] = await executor.query(
    `SELECT asset_id
     FROM content_image_usages
     WHERE asset_id IN (${placeholders})
     GROUP BY asset_id`,
    uniqueAssetIds
  );
  const referencedAssetIds = new Set((Array.isArray(usageRows) ? usageRows : []).map((row) => Number(row.asset_id || 0)).filter(Boolean));
  const removableAssetIds = uniqueAssetIds.filter((assetId) => !referencedAssetIds.has(assetId));
  if (!removableAssetIds.length) return [];

  const removablePlaceholders = removableAssetIds.map(() => "?").join(",");
  const [assetRows] = await executor.query(
    `SELECT id, storage_path, file_name
     FROM media_assets
     WHERE id IN (${removablePlaceholders})`,
    removableAssetIds
  );
  await executor.query(`DELETE FROM media_assets WHERE id IN (${removablePlaceholders})`, removableAssetIds);
  return Array.from(new Set((Array.isArray(assetRows) ? assetRows : [])
    .map((row) => toMediaUploadDiskPath(row.storage_path, row.file_name))
    .filter(Boolean)));
}
