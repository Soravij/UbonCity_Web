import crypto from "crypto";
import fs from "fs";
import path from "path";
import pool from "../config/db.js";
import {
  LIMITS,
  cleanPlainText,
  cleanRichText,
  cleanUrl,
  cleanOptionalNumber,
  sanitizeFileName,
  validateBase64ImageInput,
} from "../validators/inputSanitizer.js";

const MAX_FILE_SIZE_BYTES = LIMITS.BASE64_MAX_BYTES_8MB;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function ensureUploadsDir() {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

function safeExtFromMime(mimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

function isSupportedImageSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === "image/gif") {
    const sig = buffer.subarray(0, 6).toString("ascii");
    return sig === "GIF87a" || sig === "GIF89a";
  }

  if (mimeType === "image/webp") {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    return riff === "RIFF" && webp === "WEBP";
  }

  return false;
}

function cleanNullablePlain(value, field, max = LIMITS.SHORT_TEXT_MAX) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return cleanPlainText(raw, { max, field });
}

function cleanStoragePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length > LIMITS.URL_MAX) throw new Error("storage_path is too long");
  if (raw.includes("..") || raw.includes("\\")) throw new Error("storage_path is invalid");
  return raw.replace(/^\/+/, "");
}

function cleanMimeType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (!ALLOWED_MIME.has(raw)) throw new Error("mime_type is unsupported");
  return raw;
}

function cleanSizeBytes(value) {
  const n = cleanOptionalNumber(value, { min: 1, max: MAX_FILE_SIZE_BYTES });
  return n === null ? null : Math.floor(n);
}

function cleanPixelDimension(value, field) {
  const n = cleanOptionalNumber(value, { min: 1, max: 20000 });
  if (n === null) return null;
  const v = Math.floor(n);
  if (v <= 0) throw new Error(`${field} must be positive`);
  return v;
}

function cleanRelatedId(value) {
  const n = cleanOptionalNumber(value, { min: 1, max: Number.MAX_SAFE_INTEGER });
  if (n === null) return null;
  return Math.floor(n);
}

function cleanPosition(value) {
  const n = cleanOptionalNumber(value, { min: 0, max: 10000 });
  if (n === null) return 0;
  return Math.floor(n);
}

function cleanChecksum(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new Error("checksum is invalid");
  return raw;
}

function cleanStorageDisk(value, fallback = "external") {
  const v = String(value || fallback).trim().toLowerCase();
  if (["local", "external", "nas"].includes(v)) return v;
  throw new Error("storage_disk is invalid");
}

function buildPublicUrl(req, fileName) {
  const configuredBase = String(process.env.BACKEND_PUBLIC_URL || "").trim();
  const base = configuredBase || `${req.protocol}://${req.get("host")}`;
  return `${base}/uploads/${fileName}`;
}

function asInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeStatus(value, fallback = "pending") {
  const v = String(value || "").trim().toLowerCase();
  return ["pending", "approved", "rejected", "archived"].includes(v) ? v : fallback;
}

function sanitizeRelatedType(value, fallback = "other") {
  const v = String(value || "").trim().toLowerCase();
  return ["place", "event", "article", "other"].includes(v) ? v : fallback;
}

function sanitizeUsageType(value, fallback = "gallery") {
  const v = String(value || "").trim().toLowerCase();
  return ["cover", "gallery", "inline"].includes(v) ? v : fallback;
}

function sanitizeEntityType(value) {
  const v = String(value || "").trim().toLowerCase();
  return ["place", "event", "article"].includes(v) ? v : "";
}

function isClientInputError(msg) {
  return [
    "required",
    "invalid",
    "unsupported",
    "too long",
    "too large",
    "must",
    "out of range",
    "Target entity not found",
  ].some((key) => msg.includes(key));
}

function extractUploadsFileName(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input) return "";

  try {
    if (/^https?:\/\//i.test(input)) {
      const parsed = new URL(input);
      const pathname = decodeURIComponent(parsed.pathname || "");
      const marker = "/uploads/";
      const idx = pathname.lastIndexOf(marker);
      if (idx === -1) return "";
      const fileName = pathname.slice(idx + marker.length);
      if (!fileName || fileName.includes("/") || fileName.includes("\\")) return "";
      return fileName;
    }

    const normalized = input.replace(/\\/g, "/");
    const marker = "/uploads/";
    const idx = normalized.lastIndexOf(marker);
    if (idx === -1) return "";
    const fileName = normalized.slice(idx + marker.length);
    if (!fileName || fileName.includes("/") || fileName.includes("\\")) return "";
    return fileName;
  } catch {
    return "";
  }
}

async function ensureMediaTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id INT NOT NULL AUTO_INCREMENT,
      asset_uid CHAR(36) NOT NULL,
      source_url VARCHAR(1200) NULL,
      checksum CHAR(64) NULL,
      status ENUM('pending','approved','rejected','archived') NOT NULL DEFAULT 'pending',
      related_type ENUM('place','event','article','other') NOT NULL DEFAULT 'other',
      related_id INT NULL,
      title VARCHAR(255) NULL,
      alt_text VARCHAR(255) NULL,
      credit VARCHAR(255) NULL,
      notes TEXT NULL,
      mime_type VARCHAR(120) NULL,
      size_bytes BIGINT NULL,
      width INT NULL,
      height INT NULL,
      storage_disk ENUM('local','external','nas') NOT NULL DEFAULT 'local',
      storage_path VARCHAR(1200) NULL,
      file_name VARCHAR(255) NULL,
      created_by INT NULL,
      reviewed_by INT NULL,
      reviewed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_media_assets_uid (asset_uid),
      KEY idx_media_assets_status (status),
      KEY idx_media_assets_related (related_type, related_id),
      KEY idx_media_assets_checksum (checksum)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_image_usages (
      id INT NOT NULL AUTO_INCREMENT,
      asset_id INT NOT NULL,
      entity_type ENUM('place','event','article') NOT NULL,
      entity_id INT NOT NULL,
      usage_type ENUM('cover','gallery','inline') NOT NULL DEFAULT 'gallery',
      position INT NOT NULL DEFAULT 0,
      caption VARCHAR(255) NULL,
      created_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_content_image_usages_entity (entity_type, entity_id),
      KEY idx_content_image_usages_asset (asset_id),
      KEY idx_content_image_usages_usage (usage_type),
      CONSTRAINT fk_content_image_usages_asset FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    )
  `);
}

function toAssetPublicUrl(req, row) {
  if (String(row.storage_disk || "") === "external") {
    return String(row.source_url || "").trim();
  }

  const fileName = String(row.file_name || "").trim();
  if (fileName) return buildPublicUrl(req, fileName);

  const storagePath = String(row.storage_path || "").trim();
  if (!storagePath) return "";
  return `${req.protocol}://${req.get("host")}/${storagePath.replace(/^\/+/, "")}`;
}

function sanitizeAssetWriteBody(body, { requireAssetLocation = false } = {}) {
  const storageDisk = cleanStorageDisk(body?.storage_disk, "external");
  const sourceUrl = body?.source_url ? cleanUrl(body.source_url, { field: "source_url" }) : null;
  const storagePath = cleanStoragePath(body?.storage_path);
  const fileName = body?.file_name ? sanitizeFileName(body.file_name) : null;

  if (requireAssetLocation && !sourceUrl && !storagePath && !fileName) {
    throw new Error("source_url or storage_path or file_name is required");
  }

  return {
    source_url: sourceUrl,
    checksum: cleanChecksum(body?.checksum),
    status: sanitizeStatus(body?.status, "pending"),
    related_type: sanitizeRelatedType(body?.related_type, "other"),
    related_id: cleanRelatedId(body?.related_id),
    title: cleanNullablePlain(body?.title, "title", LIMITS.TITLE_MAX),
    alt_text: cleanNullablePlain(body?.alt_text, "alt_text", LIMITS.SHORT_TEXT_MAX),
    credit: cleanNullablePlain(body?.credit, "credit", LIMITS.SHORT_TEXT_MAX),
    notes: body?.notes
      ? cleanRichText(body.notes, { field: "notes", max: LIMITS.NOTE_MAX })
      : null,
    mime_type: cleanMimeType(body?.mime_type),
    size_bytes: cleanSizeBytes(body?.size_bytes),
    width: cleanPixelDimension(body?.width, "width"),
    height: cleanPixelDimension(body?.height, "height"),
    storage_disk: storageDisk,
    storage_path: storagePath,
    file_name: fileName,
  };
}

async function ensureEntityExists(entityType, entityId) {
  if (entityType === "place") {
    const [rows] = await pool.query("SELECT id FROM places WHERE id=? LIMIT 1", [entityId]);
    return rows.length > 0;
  }

  if (entityType === "event") {
    const [rows] = await pool.query("SELECT id FROM events WHERE id=? LIMIT 1", [entityId]);
    return rows.length > 0;
  }

  // article entity is external in this project and cannot be verified against local DB.
  return true;
}

export const listMediaAssets = async (req, res) => {
  try {
    await ensureMediaTables();

    const where = [];
    const params = [];

    const status = sanitizeStatus(req.query?.status, "");
    if (status) {
      where.push("ma.status=?");
      params.push(status);
    }

    const relatedType = sanitizeRelatedType(req.query?.related_type, "");
    if (relatedType) {
      where.push("ma.related_type=?");
      params.push(relatedType);
    }

    const relatedId = asInt(req.query?.related_id);
    if (relatedId) {
      where.push("ma.related_id=?");
      params.push(relatedId);
    }

    const qRaw = String(req.query?.q || "").trim();
    const q = qRaw ? cleanPlainText(qRaw, { field: "q", max: 120 }) : "";
    if (q) {
      where.push("(ma.title LIKE ? OR ma.alt_text LIKE ? OR ma.source_url LIKE ? OR ma.file_name LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    const sql = `
      SELECT
        ma.*,
        COUNT(DISTINCT ciu.id) AS usage_count
      FROM media_assets ma
      LEFT JOIN content_image_usages ciu ON ciu.asset_id = ma.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY ma.id
      ORDER BY ma.id DESC
    `;

    const [rows] = await pool.query(sql, params);

    return res.json({
      items: rows.map((row) => ({
        ...row,
        public_url: toAssetPublicUrl(req, row),
      })),
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("q")) {
      return res.status(400).json({ error: msg });
    }
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getMediaAssetDetail = async (req, res) => {
  try {
    await ensureMediaTables();

    const id = asInt(req.params?.id);
    if (!id) return res.status(400).json({ error: "Invalid media asset id" });

    const [rows] = await pool.query("SELECT * FROM media_assets WHERE id=? LIMIT 1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Media asset not found" });

    const [usages] = await pool.query(
      `SELECT id, asset_id, entity_type, entity_id, usage_type, position, caption, created_by, created_at
       FROM content_image_usages
       WHERE asset_id=?
       ORDER BY entity_type, entity_id, usage_type, position, id`,
      [id]
    );

    return res.json({ item: { ...rows[0], public_url: toAssetPublicUrl(req, rows[0]) }, usages });
  } catch (err) {
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const registerMediaAsset = async (req, res) => {
  try {
    await ensureMediaTables();

    const payload = sanitizeAssetWriteBody(req.body || {}, { requireAssetLocation: true });
    const assetUid = crypto.randomUUID();

    const [result] = await pool.query(
      `INSERT INTO media_assets (
         asset_uid, source_url, checksum, status, related_type, related_id,
         title, alt_text, credit, notes, mime_type, size_bytes, width, height,
         storage_disk, storage_path, file_name, created_by, reviewed_by, reviewed_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        assetUid,
        payload.source_url,
        payload.checksum,
        payload.status,
        payload.related_type,
        payload.related_id,
        payload.title,
        payload.alt_text,
        payload.credit,
        payload.notes,
        payload.mime_type,
        payload.size_bytes,
        payload.width,
        payload.height,
        payload.storage_disk,
        payload.storage_path,
        payload.file_name,
        asInt(req.user?.id),
        payload.status === "pending" ? null : asInt(req.user?.id),
        payload.status === "pending" ? null : new Date(),
      ]
    );

    const id = Number(result.insertId);
    const [rows] = await pool.query("SELECT * FROM media_assets WHERE id=? LIMIT 1", [id]);
    return res.status(201).json({ item: { ...rows[0], public_url: toAssetPublicUrl(req, rows[0]) } });
  } catch (err) {
    const msg = String(err?.message || "");
    if (isClientInputError(msg)) return res.status(400).json({ error: msg });
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const uploadMediaAsset = async (req, res) => {
  try {
    await ensureMediaTables();

    const mimeType = String(req.body?.mimeType || "").trim().toLowerCase();
    const dataBase64 = req.body?.dataBase64;

    if (!dataBase64 || !mimeType) {
      return res.status(400).json({ error: "dataBase64 and mimeType are required" });
    }

    if (!ALLOWED_MIME.has(mimeType)) {
      return res.status(400).json({ error: "Unsupported image type" });
    }

    const normalizedBase64 = validateBase64ImageInput(dataBase64, MAX_FILE_SIZE_BYTES);
    const buffer = Buffer.from(normalizedBase64, "base64");
    if (!buffer.length) return res.status(400).json({ error: "Invalid image data" });
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: "File too large (max 8MB)" });
    }

    if (!isSupportedImageSignature(buffer, mimeType)) {
      return res.status(400).json({ error: "Image signature does not match mimeType" });
    }

    const uploadsDir = ensureUploadsDir();
    const ext = safeExtFromMime(mimeType);
    if (!ext) return res.status(400).json({ error: "Unsupported image type" });

    const fileName = sanitizeFileName(`media-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
    const filePath = path.join(uploadsDir, fileName);
    await fs.promises.writeFile(filePath, buffer);

    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const assetUid = crypto.randomUUID();

    const payload = sanitizeAssetWriteBody(
      {
        ...req.body,
        source_url: null,
        storage_disk: "local",
        storage_path: `uploads/${fileName}`,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: buffer.length,
        checksum,
        status: "pending",
      },
      { requireAssetLocation: true }
    );

    const [result] = await pool.query(
      `INSERT INTO media_assets (
         asset_uid, source_url, checksum, status, related_type, related_id,
         title, alt_text, credit, notes, mime_type, size_bytes, width, height,
         storage_disk, storage_path, file_name, created_by
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        assetUid,
        payload.source_url,
        payload.checksum,
        payload.status,
        payload.related_type,
        payload.related_id,
        payload.title,
        payload.alt_text,
        payload.credit,
        payload.notes,
        payload.mime_type,
        payload.size_bytes,
        payload.width,
        payload.height,
        payload.storage_disk,
        payload.storage_path,
        payload.file_name,
        asInt(req.user?.id),
      ]
    );

    const id = Number(result.insertId);
    const [rows] = await pool.query("SELECT * FROM media_assets WHERE id=? LIMIT 1", [id]);

    return res.status(201).json({
      item: { ...rows[0], public_url: toAssetPublicUrl(req, rows[0]) },
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("dataBase64") || msg.includes("File too large") || isClientInputError(msg)) {
      return res.status(400).json({ error: msg || "Invalid upload payload" });
    }
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateMediaAsset = async (req, res) => {
  try {
    await ensureMediaTables();

    const id = asInt(req.params?.id);
    if (!id) return res.status(400).json({ error: "Invalid media asset id" });

    const [rows] = await pool.query("SELECT * FROM media_assets WHERE id=? LIMIT 1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Media asset not found" });

    const current = rows[0];
    const nextStatus = sanitizeStatus(req.body?.status, current.status);
    const statusChanged = nextStatus !== current.status;

    if (statusChanged && req.user?.role !== "admin" && req.user?.role !== "owner") {
      return res.status(403).json({ error: "Admin or owner only for status review" });
    }

    const mergedPayload = {
      ...current,
      ...req.body,
      status: nextStatus,
    };
    const payload = sanitizeAssetWriteBody(mergedPayload, { requireAssetLocation: false });

    await pool.query(
      `UPDATE media_assets
       SET source_url=?, checksum=?, status=?, related_type=?, related_id=?,
           title=?, alt_text=?, credit=?, notes=?, mime_type=?, size_bytes=?, width=?, height=?,
           storage_disk=?, storage_path=?, file_name=?,
           reviewed_by=?, reviewed_at=?
       WHERE id=?`,
      [
        payload.source_url,
        payload.checksum,
        payload.status,
        payload.related_type,
        payload.related_id,
        payload.title,
        payload.alt_text,
        payload.credit,
        payload.notes,
        payload.mime_type,
        payload.size_bytes,
        payload.width,
        payload.height,
        payload.storage_disk,
        payload.storage_path,
        payload.file_name,
        statusChanged ? asInt(req.user?.id) : current.reviewed_by,
        statusChanged ? new Date() : current.reviewed_at,
        id,
      ]
    );

    const [nextRows] = await pool.query("SELECT * FROM media_assets WHERE id=? LIMIT 1", [id]);
    return res.json({ item: { ...nextRows[0], public_url: toAssetPublicUrl(req, nextRows[0]) } });
  } catch (err) {
    const msg = String(err?.message || "");
    if (isClientInputError(msg)) return res.status(400).json({ error: msg });
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteMediaAsset = async (req, res) => {
  try {
    await ensureMediaTables();

    const id = asInt(req.params?.id);
    if (!id) return res.status(400).json({ error: "Invalid media asset id" });

    const [rows] = await pool.query("SELECT * FROM media_assets WHERE id=? LIMIT 1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Media asset not found" });

    const item = rows[0];
    await pool.query("DELETE FROM media_assets WHERE id=?", [id]);

    if (String(item.storage_disk) === "local") {
      const candidateFile = String(item.file_name || extractUploadsFileName(item.source_url || "") || "").trim();
      if (candidateFile) {
        const filePath = path.join(ensureUploadsDir(), sanitizeFileName(candidateFile));
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      }
    }

    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const listMediaUsages = async (req, res) => {
  try {
    await ensureMediaTables();

    const where = [];
    const params = [];

    const entityType = sanitizeEntityType(req.query?.entity_type);
    if (entityType) {
      where.push("ciu.entity_type=?");
      params.push(entityType);
    }

    const entityId = asInt(req.query?.entity_id);
    if (entityId) {
      where.push("ciu.entity_id=?");
      params.push(entityId);
    }

    const assetId = asInt(req.query?.asset_id);
    if (assetId) {
      where.push("ciu.asset_id=?");
      params.push(assetId);
    }

    const [rows] = await pool.query(
      `SELECT
         ciu.*,
         ma.status AS asset_status,
         ma.title AS asset_title,
         ma.alt_text AS asset_alt_text,
         ma.source_url AS asset_source_url,
         ma.storage_disk AS asset_storage_disk,
         ma.file_name AS asset_file_name,
         ma.storage_path AS asset_storage_path
       FROM content_image_usages ciu
       JOIN media_assets ma ON ma.id=ciu.asset_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ciu.entity_type, ciu.entity_id, ciu.usage_type, ciu.position, ciu.id`,
      params
    );

    return res.json({
      items: rows.map((row) => ({
        ...row,
        public_url: toAssetPublicUrl(req, {
          source_url: row.asset_source_url,
          storage_disk: row.asset_storage_disk,
          file_name: row.asset_file_name,
          storage_path: row.asset_storage_path,
        }),
      })),
    });
  } catch (err) {
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

function buildEntityCoverUrl(req, asset) {
  return toAssetPublicUrl(req, asset);
}

async function applyLegacyCoverIfRequested(req, usageType, entityType, entityId, assetId, applyLegacyCover) {
  if (!applyLegacyCover || usageType !== "cover") return;
  if (!["place", "event"].includes(entityType)) return;

  const [assetRows] = await pool.query("SELECT * FROM media_assets WHERE id=? LIMIT 1", [assetId]);
  if (!assetRows.length) return;
  const coverUrl = buildEntityCoverUrl(req, assetRows[0]);
  if (!coverUrl) return;

  if (entityType === "place") {
    await pool.query("UPDATE places SET image=? WHERE id=?", [coverUrl, entityId]);
    return;
  }

  if (entityType === "event") {
    await pool.query("UPDATE events SET image=? WHERE id=?", [coverUrl, entityId]);
  }
}

export const createMediaUsage = async (req, res) => {
  try {
    await ensureMediaTables();

    if (Object.hasOwn(req.body || {}, "caption")) {
      return res.status(400).json({ error: "caption is managed by Collector release snapshots" });
    }

    const assetId = cleanRelatedId(req.body?.asset_id);
    const entityType = sanitizeEntityType(req.body?.entity_type);
    const entityId = cleanRelatedId(req.body?.entity_id);
    const usageType = sanitizeUsageType(req.body?.usage_type, "gallery");
    const position = cleanPosition(req.body?.position);
    if (!assetId || !entityType || !entityId) {
      return res.status(400).json({ error: "asset_id, entity_type, entity_id are required" });
    }

    const [assetRows] = await pool.query("SELECT id,status FROM media_assets WHERE id=? LIMIT 1", [assetId]);
    if (!assetRows.length) return res.status(404).json({ error: "Media asset not found" });

    const entityExists = await ensureEntityExists(entityType, entityId);
    if (!entityExists) {
      return res.status(404).json({ error: "Target entity not found" });
    }

    await pool.query(
      `INSERT INTO content_image_usages (asset_id, entity_type, entity_id, usage_type, position, caption, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [assetId, entityType, entityId, usageType, position, null, asInt(req.user?.id)]
    );

    await applyLegacyCoverIfRequested(
      req,
      usageType,
      entityType,
      entityId,
      assetId,
      Boolean(req.body?.apply_legacy_cover)
    );

    return res.status(201).json({ message: "Usage created" });
  } catch (err) {
    const msg = String(err?.message || "");
    if (isClientInputError(msg)) return res.status(400).json({ error: msg });
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteMediaUsage = async (req, res) => {
  try {
    await ensureMediaTables();

    const id = asInt(req.params?.id);
    if (!id) return res.status(400).json({ error: "Invalid media usage id" });

    const [result] = await pool.query("DELETE FROM content_image_usages WHERE id=?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Media usage not found" });

    return res.json({ message: "Usage deleted" });
  } catch (err) {
    console.error("mediaController failure", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
