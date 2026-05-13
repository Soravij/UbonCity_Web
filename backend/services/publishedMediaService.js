import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");

function toUploadDiskPath(relativePath) {
  const normalized = String(relativePath || "").trim().replace(/\\/g, "/");
  if (!normalized || !normalized.startsWith("uploads/")) return "";
  return path.join(BACKEND_UPLOADS_DIR, normalized.slice("uploads/".length));
}

async function listExistingMediaUsageRows(executor, entityType, entityId) {
  const [rows] = await executor.query(
    `SELECT ciu.id, ciu.asset_id, ciu.usage_type, ma.storage_path, ma.file_name
     FROM content_image_usages ciu
     JOIN media_assets ma ON ma.id = ciu.asset_id
     WHERE ciu.entity_type=? AND ciu.entity_id=? AND ciu.usage_type IN ('cover','gallery','inline')
     ORDER BY ciu.id ASC`,
    [entityType, Number(entityId)]
  );
  return Array.isArray(rows) ? rows : [];
}

async function cleanupReplacedMediaAssets(executor, oldRows = []) {
  const assetIds = Array.from(
    new Set(
      (Array.isArray(oldRows) ? oldRows : [])
        .map((row) => Number(row?.asset_id || 0) || 0)
        .filter(Boolean)
    )
  );
  if (!assetIds.length) return;

  const placeholders = assetIds.map(() => "?").join(",");
  const [inUseRows] = await executor.query(
    `SELECT asset_id, COUNT(*) AS ref_count
     FROM content_image_usages
     WHERE asset_id IN (${placeholders})
     GROUP BY asset_id`,
    assetIds
  );
  const inUseIds = new Set(
    (Array.isArray(inUseRows) ? inUseRows : [])
      .map((row) => Number(row?.asset_id || 0) || 0)
      .filter(Boolean)
  );
  const removableIds = assetIds.filter((id) => !inUseIds.has(id));
  if (!removableIds.length) return [];

  const removableRows = (Array.isArray(oldRows) ? oldRows : []).filter((row) => {
    const assetId = Number(row?.asset_id || 0) || 0;
    return removableIds.includes(assetId);
  });
  const cleanupFilePaths = removableRows
    .map((row) => toUploadDiskPath(row?.storage_path || (row?.file_name ? `uploads/${row.file_name}` : "")))
    .filter(Boolean);

  const removablePlaceholders = removableIds.map(() => "?").join(",");
  await executor.query(`DELETE FROM media_assets WHERE id IN (${removablePlaceholders})`, removableIds);
  return Array.from(new Set(cleanupFilePaths));
}

export async function cleanupPublishedMediaFilesBestEffort(filePaths = []) {
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    const normalizedPath = String(filePath || "").trim();
    if (!normalizedPath) continue;
    try {
      await fs.unlink(normalizedPath);
    } catch {
      // Best-effort cleanup after the publish transaction has committed.
    }
  }
}

function buildAssetPublicUrl(fileName) {
  const name = String(fileName || "").trim();
  if (!name) return null;
  const base = String(process.env.BACKEND_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/uploads/${name}` : `/uploads/${name}`;
}

export async function replaceEntityMediaWithReviewBatch(executor, {
  entityType,
  entityId,
  reviewContentId,
  batchUid,
  actorUserId = null,
}) {
  const normalizedEntityType = String(entityType || "").trim().toLowerCase();
  if (normalizedEntityType !== "place" && normalizedEntityType !== "event") {
    throw new Error("invalid entity type for published media replacement");
  }

  const [reviewAssets] = await executor.query(
    `SELECT id, usage_type, position, source_url, resolved_source_url, storage_path, file_name, mime_type, size_bytes, checksum
     FROM review_content_assets
     WHERE review_content_id=? AND batch_uid=? AND status='review_ready'
     ORDER BY usage_type ASC, position ASC, id ASC`,
    [Number(reviewContentId), String(batchUid || "").trim()]
  );

  const rows = Array.isArray(reviewAssets) ? reviewAssets : [];
  const oldRows = await listExistingMediaUsageRows(executor, normalizedEntityType, entityId);
  await executor.query(
    `DELETE FROM content_image_usages
     WHERE entity_type=? AND entity_id=? AND usage_type IN ('cover','gallery','inline')`,
    [normalizedEntityType, Number(entityId)]
  );

  const positionByUsage = { cover: 0, gallery: 0, inline: 0 };
  const published = { cover_url: null, thumbnail_url: null, gallery_urls: [], inline_urls: [], cleanup_file_paths: [] };

  for (const asset of rows) {
    const usageType = String(asset?.usage_type || "").trim().toLowerCase();
    if (!["cover", "gallery", "inline"].includes(usageType)) continue;

    const [assetInsert] = await executor.query(
      `INSERT INTO media_assets (
         asset_uid, source_url, checksum, status, related_type, related_id,
         mime_type, size_bytes, storage_disk, storage_path, file_name, created_by, reviewed_by, reviewed_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [
        crypto.randomUUID(),
        String(asset?.resolved_source_url || asset?.source_url || "").trim() || null,
        asset?.checksum || null,
        "approved",
        normalizedEntityType,
        Number(entityId),
        asset?.mime_type || null,
        asset?.size_bytes == null ? null : Number(asset.size_bytes) || null,
        "local",
        String(asset?.storage_path || "").trim() || null,
        String(asset?.file_name || "").trim() || null,
        actorUserId == null ? null : Number(actorUserId) || null,
        actorUserId == null ? null : Number(actorUserId) || null,
      ]
    );
    const mediaAssetId = Number(assetInsert.insertId || 0) || 0;
    await executor.query(
      `INSERT INTO content_image_usages (asset_id, entity_type, entity_id, usage_type, position, created_by)
       VALUES (?,?,?,?,?,?)`,
      [
        mediaAssetId,
        normalizedEntityType,
        Number(entityId),
        usageType,
        positionByUsage[usageType] || 0,
        actorUserId == null ? null : Number(actorUserId) || null,
      ]
    );
    positionByUsage[usageType] += 1;

    const publicUrl = buildAssetPublicUrl(asset?.file_name);
    if (!publicUrl) continue;
    if (usageType === "cover" && !published.cover_url) published.cover_url = publicUrl;
    if (usageType === "gallery") published.gallery_urls.push(publicUrl);
    if (usageType === "inline") published.inline_urls.push(publicUrl);
  }

  published.thumbnail_url = published.gallery_urls[0] || published.cover_url || null;

  published.cleanup_file_paths = await cleanupReplacedMediaAssets(executor, oldRows);
  return published;
}
