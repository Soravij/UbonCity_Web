import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");
export const REVIEW_ASSET_LIFECYCLE_POLICY = Object.freeze({
  mirror_timing: "submit_admin_review_ingest",
  review_asset_owner: "backend",
  needs_revision_cleanup: "delete_unpublished_review_batch_assets",
  reject_cleanup: "delete_unpublished_review_batch_assets",
  publish_promotion: "replace_entity_media_with_review_batch",
});

function toDiskPath(storagePath) {
  const normalized = String(storagePath || "").trim().replace(/\\/g, "/");
  if (!normalized) return "";
  if (!normalized.toLowerCase().startsWith("uploads/")) return "";
  const fileName = normalized.slice("uploads/".length);
  return path.join(BACKEND_UPLOADS_DIR, fileName);
}

export async function cleanupUnpublishedBatchAssets(reviewContentId, batchUid, executor = pool) {
  const [rows] = await executor.query(
    `SELECT id, storage_path
     FROM review_content_assets
     WHERE review_content_id=? AND batch_uid=? AND status='review_ready'`,
    [Number(reviewContentId), String(batchUid || "").trim()]
  );
  const cleanupFilePaths = (Array.isArray(rows) ? rows : [])
    .map((row) => toDiskPath(row.storage_path))
    .filter(Boolean);

  await executor.query(
    `UPDATE review_content_assets
     SET status='deleted'
     WHERE review_content_id=? AND batch_uid=? AND status='review_ready'`,
    [Number(reviewContentId), String(batchUid || "").trim()]
  );
  return Array.from(new Set(cleanupFilePaths));
}

export async function cleanupUnpublishedBatchTranslations(reviewContentId, batchUid, executor = pool) {
  await executor.query(
    `UPDATE review_content_translations
     SET status='deleted', updated_at=CURRENT_TIMESTAMP
     WHERE review_content_id=? AND batch_uid=? AND status='review_ready'`,
    [Number(reviewContentId), String(batchUid || "").trim()]
  );
}

export async function cleanupReviewAssetFilesBestEffort(filePaths = []) {
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    const normalizedPath = String(filePath || "").trim();
    if (!normalizedPath) continue;
    try {
      await fs.unlink(normalizedPath);
    } catch {
      // Best-effort file cleanup after transaction commit.
    }
  }
}
