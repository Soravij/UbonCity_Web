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

async function cleanupReplacedMediaAssets(executor, oldRows = [], excludedStoragePaths = []) {
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
  const excluded = new Set(
    (Array.isArray(excludedStoragePaths) ? excludedStoragePaths : [])
      .map((value) => String(value || "").trim().replace(/\\/g, "/"))
      .filter(Boolean)
  );
  const filteredCleanupFilePaths = cleanupFilePaths.filter((diskPath) => {
    const normalizedDiskPath = String(diskPath || "").trim();
    const relativePath = normalizedDiskPath.startsWith(BACKEND_UPLOADS_DIR)
      ? `uploads/${path.relative(BACKEND_UPLOADS_DIR, normalizedDiskPath).replace(/\\/g, "/")}`
      : "";
    return !excluded.has(relativePath);
  });

  const removablePlaceholders = removableIds.map(() => "?").join(",");
  await executor.query(`DELETE FROM media_assets WHERE id IN (${removablePlaceholders})`, removableIds);
  return Array.from(new Set(filteredCleanupFilePaths));
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

function normalizeUploadRelativePath(storagePath, fileName) {
  const normalizedStoragePath = String(storagePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (/^uploads\//i.test(normalizedStoragePath)) {
    return normalizedStoragePath.replace(/^\/+/, "");
  }
  const normalizedFileName = String(fileName || "").trim().replace(/^\/+/, "");
  if (!normalizedFileName) return "";
  return `uploads/${normalizedFileName}`;
}

function buildAssetPublicUrl(asset) {
  const relativePath = normalizeUploadRelativePath(asset?.storage_path, asset?.file_name);
  if (!relativePath) return null;
  const base = String(process.env.BACKEND_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/${relativePath}` : `/${relativePath}`;
}

function sanitizePublishedFileName(input, fallback = "asset") {
  const normalized = String(input || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function splitFileStemAndExt(fileName, fallbackStem) {
  const normalized = sanitizePublishedFileName(fileName, fallbackStem);
  const ext = path.extname(normalized);
  const stem = ext ? normalized.slice(0, -ext.length) : normalized;
  return { stem: stem || fallbackStem, ext };
}

function buildPublishedStoragePath({ entityType, entityId, reviewContentId, batchUid, usageType, asset }) {
  const entityFolder = entityType === "event" ? "events" : "places";
  const relativePath = normalizeUploadRelativePath(asset?.storage_path, asset?.file_name);
  const { ext } = splitFileStemAndExt(relativePath || asset?.file_name, `${usageType}-asset`);
  const safeBatchUid = sanitizePublishedFileName(batchUid, "batch");
  const publishedFileName = sanitizePublishedFileName(
    `${Number(reviewContentId)}-${safeBatchUid}-${usageType}-${Number(asset?.position || 0)}-${Number(asset?.id || 0) || "asset"}${ext}`,
    `${usageType}-asset${ext}`
  );
  return {
    storage_path: `uploads/published/${entityFolder}/${Number(entityId)}/${publishedFileName}`,
    file_name: publishedFileName,
  };
}

async function resolveUniquePublishedAssetTarget(publishedAsset) {
  const initialStoragePath = String(publishedAsset?.storage_path || "").trim();
  const initialFileName = String(publishedAsset?.file_name || "").trim();
  const diskPath = toUploadDiskPath(initialStoragePath);
  if (!diskPath) throw new Error("invalid published storage path");
  const { stem, ext } = splitFileStemAndExt(initialFileName, "asset");

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const fileName = `${stem}${suffix}${ext}`;
    const storage_path = initialStoragePath.replace(/[^/]+$/, fileName);
    const candidateDiskPath = toUploadDiskPath(storage_path);
    try {
      await fs.access(candidateDiskPath);
    } catch (error) {
      if (String(error?.code || "").toUpperCase() === "ENOENT") {
        return { storage_path, file_name: fileName };
      }
      throw error;
    }
  }
  throw new Error(`unable to allocate unique published storage path for ${initialStoragePath}`);
}

async function promoteReviewAssetFile(asset, publishedAsset) {
  const sourcePath = toUploadDiskPath(asset?.storage_path || (asset?.file_name ? `uploads/${asset.file_name}` : ""));
  const allocatedAsset = await resolveUniquePublishedAssetTarget(publishedAsset);
  const targetPath = toUploadDiskPath(allocatedAsset?.storage_path || "");
  if (!sourcePath || !targetPath) throw new Error("missing media path for promotion copy");
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return {
    ...allocatedAsset,
    disk_path: targetPath,
  };
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
    `SELECT id, usage_type, position, source_url, resolved_source_url, storage_path, file_name, mime_type, size_bytes, checksum, caption
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
  const published = {
    cover_url: null,
    thumbnail_url: null,
    gallery_urls: [],
    inline_urls: [],
    cleanup_file_paths: [],
    url_rewrites: [],
    promoted_storage_paths: [],
    promoted_file_paths: [],
  };

  try {
    for (const asset of rows) {
      const usageType = String(asset?.usage_type || "").trim().toLowerCase();
      if (!["cover", "gallery", "inline"].includes(usageType)) continue;
      const promotedAsset = buildPublishedStoragePath({
        entityType: normalizedEntityType,
        entityId,
        reviewContentId,
        batchUid,
        usageType,
        asset,
      });
      const copiedAsset = await promoteReviewAssetFile(asset, promotedAsset);
      published.promoted_storage_paths.push(copiedAsset.storage_path);
      published.promoted_file_paths.push(copiedAsset.disk_path);

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
          copiedAsset.storage_path,
          copiedAsset.file_name,
          actorUserId == null ? null : Number(actorUserId) || null,
          actorUserId == null ? null : Number(actorUserId) || null,
        ]
      );
      const mediaAssetId = Number(assetInsert.insertId || 0) || 0;
      await executor.query(
        `INSERT INTO content_image_usages (asset_id, entity_type, entity_id, usage_type, position, caption, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [
          mediaAssetId,
          normalizedEntityType,
          Number(entityId),
          usageType,
          positionByUsage[usageType] || 0,
          String(asset?.caption || "").trim() || null,
          actorUserId == null ? null : Number(actorUserId) || null,
        ]
      );
      positionByUsage[usageType] += 1;

      const publicUrl = buildAssetPublicUrl(copiedAsset);
      if (!publicUrl) continue;
      if (usageType === "cover" && !published.cover_url) published.cover_url = publicUrl;
      if (usageType === "gallery") published.gallery_urls.push(publicUrl);
      if (usageType === "inline") published.inline_urls.push(publicUrl);

      const sourceCandidates = [
        String(asset?.resolved_source_url || "").trim(),
        String(asset?.source_url || "").trim(),
        buildAssetPublicUrl(asset),
        (() => {
          const relative = normalizeUploadRelativePath(asset?.storage_path, asset?.file_name);
          return relative ? `/${relative}` : "";
        })(),
      ].filter(Boolean);
      for (const from of sourceCandidates) {
        published.url_rewrites.push({ from, to: publicUrl });
      }
    }
  } catch (error) {
    await cleanupPublishedMediaFilesBestEffort(published.promoted_file_paths);
    throw error;
  }

  published.thumbnail_url = published.gallery_urls[0] || published.cover_url || null;

  published.cleanup_file_paths = await cleanupReplacedMediaAssets(executor, oldRows, published.promoted_storage_paths);
  return published;
}
