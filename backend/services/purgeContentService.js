import bcrypt from "bcryptjs";
import fs from "fs/promises";
import path from "path";
import pool from "../config/db.js";
import { appendContentPurgeAudit } from "./contentGovernanceService.js";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

function toUploadDiskPath(storagePath, fileName) {
  const rawPath = String(storagePath || "").trim().replace(/\\/g, "/");
  if (rawPath && rawPath.startsWith("uploads/")) {
    return path.join(UPLOADS_DIR, rawPath.slice("uploads/".length));
  }
  const safeName = String(fileName || "").trim();
  if (safeName) return path.join(UPLOADS_DIR, safeName);
  return "";
}

async function verifyOwnerPassword(actorUserId, password, executor) {
  const userId = Number(actorUserId || 0) || 0;
  const plain = String(password || "");
  if (!userId || !plain) throw new Error("password is required");
  const [rows] = await executor.query("SELECT password FROM users WHERE id=? LIMIT 1", [userId]);
  if (!Array.isArray(rows) || !rows.length) throw new Error("actor user not found");
  const hash = String(rows[0]?.password || "");
  const ok = await bcrypt.compare(plain, hash);
  if (!ok) throw new Error("invalid password");
}

async function listEntityMediaRows(executor, entityType, entityId) {
  const [rows] = await executor.query(
    `SELECT ciu.asset_id, ma.storage_path, ma.file_name
     FROM content_image_usages ciu
     JOIN media_assets ma ON ma.id=ciu.asset_id
     WHERE ciu.entity_type=? AND ciu.entity_id=?`,
    [entityType, Number(entityId)]
  );
  return Array.isArray(rows) ? rows : [];
}

async function cleanupOrphanMediaAssets(executor, assetIds = []) {
  const uniqueAssetIds = Array.from(new Set((assetIds || []).map((v) => Number(v || 0)).filter(Boolean)));
  if (!uniqueAssetIds.length) return [];
  const placeholders = uniqueAssetIds.map(() => "?").join(",");
  const [usageRows] = await executor.query(
    `SELECT asset_id, COUNT(*) AS refs
     FROM content_image_usages
     WHERE asset_id IN (${placeholders})
     GROUP BY asset_id`,
    uniqueAssetIds
  );
  const inUse = new Set((Array.isArray(usageRows) ? usageRows : []).map((r) => Number(r.asset_id || 0)).filter(Boolean));
  const removable = uniqueAssetIds.filter((id) => !inUse.has(id));
  if (!removable.length) return [];

  const [assetRows] = await executor.query(
    `SELECT storage_path, file_name
     FROM media_assets
     WHERE id IN (${removable.map(() => "?").join(",")})`,
    removable
  );
  await executor.query(`DELETE FROM media_assets WHERE id IN (${removable.map(() => "?").join(",")})`, removable);
  return (Array.isArray(assetRows) ? assetRows : [])
    .map((r) => toUploadDiskPath(r.storage_path, r.file_name))
    .filter(Boolean);
}

async function deleteFilesBestEffort(paths = []) {
  for (const target of Array.isArray(paths) ? paths : []) {
    const normalized = String(target || "").trim();
    if (!normalized) continue;
    try {
      await fs.unlink(normalized);
    } catch {}
  }
}

async function cleanupCommonMappings(executor, entityType, entityId) {
  await executor.query("DELETE FROM collector_import_reviews WHERE local_entity_type=? AND local_entity_id=?", [entityType, Number(entityId)]);
  await executor.query("DELETE FROM lifecycle_content_map WHERE local_entity_type=? AND local_entity_id=?", [entityType, Number(entityId)]);
  await executor.query("DELETE FROM review_contents WHERE public_entity_type=? AND public_entity_id=?", [entityType, Number(entityId)]);
}

async function loadPlaceSnapshot(executor, placeId) {
  const [rows] = await executor.query(
    `SELECT p.id, p.slug, p.is_emer, c.slug AS category, COALESCE(pt.title, '') AS title
     FROM places p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN place_translations pt ON pt.place_id=p.id AND pt.lang='th'
     WHERE p.id=? LIMIT 1`,
    [Number(placeId)]
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadEventSnapshot(executor, eventId) {
  const [rows] = await executor.query(
    `SELECT e.id, e.is_emer, COALESCE(et.title, e.title, '') AS title
     FROM events e
     LEFT JOIN event_translations et ON et.event_id=e.id AND et.lang='th'
     WHERE e.id=? LIMIT 1`,
    [Number(eventId)]
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function purgePlace({
  placeId,
  actorUserId,
  password,
  purgeNote = null,
}) {
  const targetId = Number(placeId || 0) || 0;
  if (!targetId) throw new Error("invalid place id");

  const connection = await pool.getConnection();
  let filePaths = [];
  let snapshot = null;
  try {
    await connection.beginTransaction();
    await verifyOwnerPassword(actorUserId, password, connection);
    snapshot = await loadPlaceSnapshot(connection, targetId);
    if (!snapshot) throw new Error("place not found");

    const mediaRows = await listEntityMediaRows(connection, "place", targetId);
    const assetIds = mediaRows.map((row) => Number(row.asset_id || 0)).filter(Boolean);
    await connection.query("DELETE FROM content_image_usages WHERE entity_type='place' AND entity_id=?", [targetId]);
    const orphanPaths = await cleanupOrphanMediaAssets(connection, assetIds);
    filePaths = [...filePaths, ...orphanPaths];

    await connection.query("DELETE FROM place_translations WHERE place_id=?", [targetId]);
    await cleanupCommonMappings(connection, "place", targetId);
    await connection.query("DELETE FROM places WHERE id=?", [targetId]);

    await appendContentPurgeAudit({
      entityType: "place",
      entityId: targetId,
      category: snapshot?.category || null,
      slug: snapshot?.slug || null,
      titleSnapshot: snapshot?.title || null,
      isEmer: Number(snapshot?.is_emer || 0) === 1 ? 1 : 0,
      purgedByUserId: Number(actorUserId || 0) || null,
      purgeNote,
      executor: connection,
    });
    await connection.commit();
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
    throw err;
  } finally {
    connection.release();
  }
  await deleteFilesBestEffort(filePaths);
  return {
    entity_type: "place",
    entity_id: targetId,
    title: String(snapshot?.title || "").trim() || null,
  };
}

export async function purgeEvent({
  eventId,
  actorUserId,
  password,
  purgeNote = null,
}) {
  const targetId = Number(eventId || 0) || 0;
  if (!targetId) throw new Error("invalid event id");

  const connection = await pool.getConnection();
  let filePaths = [];
  let snapshot = null;
  try {
    await connection.beginTransaction();
    await verifyOwnerPassword(actorUserId, password, connection);
    snapshot = await loadEventSnapshot(connection, targetId);
    if (!snapshot) throw new Error("event not found");

    const mediaRows = await listEntityMediaRows(connection, "event", targetId);
    const assetIds = mediaRows.map((row) => Number(row.asset_id || 0)).filter(Boolean);
    await connection.query("DELETE FROM content_image_usages WHERE entity_type='event' AND entity_id=?", [targetId]);
    const orphanPaths = await cleanupOrphanMediaAssets(connection, assetIds);
    filePaths = [...filePaths, ...orphanPaths];

    await connection.query("DELETE FROM event_translations WHERE event_id=?", [targetId]);
    await cleanupCommonMappings(connection, "event", targetId);
    await connection.query("DELETE FROM events WHERE id=?", [targetId]);

    await appendContentPurgeAudit({
      entityType: "event",
      entityId: targetId,
      category: "event",
      slug: null,
      titleSnapshot: snapshot?.title || null,
      isEmer: Number(snapshot?.is_emer || 0) === 1 ? 1 : 0,
      purgedByUserId: Number(actorUserId || 0) || null,
      purgeNote,
      executor: connection,
    });
    await connection.commit();
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
    throw err;
  } finally {
    connection.release();
  }
  await deleteFilesBestEffort(filePaths);
  return {
    entity_type: "event",
    entity_id: targetId,
    title: String(snapshot?.title || "").trim() || null,
  };
}
