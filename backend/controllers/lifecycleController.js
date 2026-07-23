import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import pool from "../config/db.js";
import { normalizeContentLang } from "../constants/languages.js";
import { LIMITS, cleanPlainText, cleanRichText, cleanSlug, cleanUrl } from "../validators/inputSanitizer.js";
import {
  upsertCollectorImportReviewFromImport,
} from "../services/collectorImportReviewService.js";
import { assertBackendIntegrationReadiness } from "../services/integrationReadinessService.js";

const LIFECYCLE_SYNC_TOKEN = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
const LIFECYCLE_PUBLISHED_MAX = LIMITS.IMPORT_ITEMS_MAX;
const LIFECYCLE_TRANSLATIONS_MAX = LIMITS.IMPORT_ITEMS_MAX * 4;
const LIFECYCLE_MEDIA_ENTRY_MAX = 40;
const LIFECYCLE_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_COLLECTOR_SOURCE_BASE = String(process.env.COLLECTOR_PUBLIC_BASE_URL || process.env.COLLECTOR_PUBLIC_URL || "").trim();
const BACKEND_UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
let ensuredPlaceLocationColumns = false;
let lifecycleInfrastructureReady = false;

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function cleanLifecycleCoordinate(value, { min, max, field }) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return n;
}

async function ensurePlaceLocationColumns() {
  if (ensuredPlaceLocationColumns) return;
  const definitions = [
    ["latitude", "DECIMAL(10,7) NULL"],
    ["longitude", "DECIMAL(10,7) NULL"],
    ["map_url", "VARCHAR(1200) NULL"],
    ["google_place_id", "VARCHAR(255) NULL"],
    ["transport_subtype", "VARCHAR(64) NULL"],
    ["transport_contact_name", "VARCHAR(255) NULL"],
    ["transport_contact_phone", "VARCHAR(120) NULL"],
    ["transport_contact_details", "TEXT NULL"],
    ["transport_link_url", "VARCHAR(1200) NULL"],
  ];

  for (const [name, definition] of definitions) {
    const [rows] = await pool.query("SHOW COLUMNS FROM places LIKE ?", [name]);
    if (!rows.length) {
      await pool.query(`ALTER TABLE places ADD COLUMN ${name} ${definition}`);
    }
  }

  ensuredPlaceLocationColumns = true;
}

function normalizeSourceType(value) {
  const v = String(value || "place").trim().toLowerCase();
  return ["place", "event"].includes(v) ? v : "";
}

function cleanLifecycleLang(value, fallback = "th") {
  return normalizeContentLang(value, fallback);
}

function resolveMetaDescription(metaDescription, description) {
  const direct = String(metaDescription || "").trim();
  if (direct && direct.length <= 160) return direct;

  const source = String(description || "").replace(/\s+/g, " ").trim();
  if (!source) return direct ? direct.slice(0, 160) : null;
  if (source.length <= 160) return source;
  return `${source.slice(0, 157).trimEnd()}...`;
}

function normalizeBaseUrl(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return fallback;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function resolveCollectorSourceBaseUrl(rawValue) {
  const normalized = normalizeBaseUrl(rawValue, normalizeBaseUrl(DEFAULT_COLLECTOR_SOURCE_BASE, ""));
  if (!normalized) {
    throw new Error("collector source base URL is required");
  }
  return normalized;
}

function toBackendUploadUrl(fileName) {
  const safeFileName = String(fileName || "").trim();
  if (!safeFileName) return null;
  const base = String(process.env.BACKEND_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (base) return `${base}/uploads/${safeFileName}`;
  return `/uploads/${safeFileName}`;
}

function sanitizeFileName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extFromContentType(contentType, fallback = ".jpg") {
  const normalized = String(contentType || "").trim().toLowerCase();
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/webp")) return ".webp";
  if (normalized.includes("image/gif")) return ".gif";
  if (normalized.includes("image/avif")) return ".avif";
  return fallback;
}

function extFromUrl(rawUrl, fallback = ".jpg") {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    const ext = path.extname(parsed.pathname || "").trim().toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function normalizeUsageType(value) {
  const usage = String(value || "").trim().toLowerCase();
  if (usage === "cover") return "cover";
  if (usage === "inline") return "inline";
  return "gallery";
}

function normalizeLifecycleMediaEntry(rawEntry, fallbackUsage = "gallery") {
  if (!rawEntry || typeof rawEntry !== "object") return null;
  const sourceUrl = cleanUrl(rawEntry?.source_url, { required: true, field: "media_manifest.source_url" });
  const selected = rawEntry?.selected == null ? true : Boolean(rawEntry.selected);
  if (!selected) return null;
  const usageType = normalizeUsageType(rawEntry?.role || fallbackUsage);
  const caption = rawEntry?.caption == null
    ? null
    : cleanPlainText(rawEntry.caption, { required: false, max: LIMITS.SHORT_TEXT_MAX, field: "media_manifest.caption" }) || null;
  return {
    kind: "image",
    source_url: sourceUrl,
    role: usageType,
    selected: true,
    usage_type: usageType,
    caption,
  };
}

function sanitizeMediaManifest(rawManifest, index) {
  const base = rawManifest && typeof rawManifest === "object" ? rawManifest : {};
  const authority = String(base.authority || "release_main_selected_assets").trim() || "release_main_selected_assets";
  const cover = base.cover ? normalizeLifecycleMediaEntry(base.cover, "cover") : null;
  const galleryRows = Array.isArray(base.gallery) ? base.gallery.slice(0, LIFECYCLE_MEDIA_ENTRY_MAX) : [];
  const inlineRows = Array.isArray(base.inline) ? base.inline.slice(0, LIFECYCLE_MEDIA_ENTRY_MAX) : [];

  const gallery = galleryRows
    .map((entry) => normalizeLifecycleMediaEntry(entry, "gallery"))
    .filter(Boolean);
  const inline = inlineRows
    .map((entry) => normalizeLifecycleMediaEntry(entry, "inline"))
    .filter(Boolean);

  let normalizedCover = cover;
  if (!normalizedCover && gallery.length > 0) {
    normalizedCover = { ...gallery[0], role: "cover", usage_type: "cover" };
  }

  const dedupe = new Set();
  const keepUnique = (entry) => {
    const key = `${entry.usage_type}:${entry.source_url}`;
    if (dedupe.has(key)) return false;
    dedupe.add(key);
    return true;
  };

  const dedupedGallery = gallery
    .filter((entry) => entry.source_url !== String(normalizedCover?.source_url || ""))
    .filter(keepUnique);
  const dedupedInline = inline.filter(keepUnique);

  return {
    authority,
    cover: normalizedCover,
    gallery: dedupedGallery,
    inline: dedupedInline,
    video: [],
    _source_index: index,
  };
}

function resolveMediaSourceUrl(sourceUrl, sourceBaseUrl) {
  const raw = String(sourceUrl || "").trim();
  if (!raw) throw new Error("media source_url is required");
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = resolveCollectorSourceBaseUrl(sourceBaseUrl);
  const normalizedPath = raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  return new URL(normalizedPath, `${base}/`).toString();
}

async function ensureUploadsDir() {
  await fs.mkdir(BACKEND_UPLOADS_DIR, { recursive: true });
}

async function mirrorImageToBackendStorage(sourceUrl, sourceBaseUrl) {
  const resolvedSourceUrl = resolveMediaSourceUrl(sourceUrl, sourceBaseUrl);
  const response = await fetch(resolvedSourceUrl);
  if (!response.ok) {
    throw new Error(`cannot fetch media (${response.status})`);
  }

  const contentType = String(response.headers.get("content-type") || "").trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`unsupported media content-type: ${contentType || "unknown"}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("empty media payload");
  if (buffer.length > LIFECYCLE_MEDIA_MAX_BYTES) throw new Error("media payload too large");

  await ensureUploadsDir();

  const ext = extFromContentType(contentType, extFromUrl(resolvedSourceUrl, ".jpg"));
  const fileName = sanitizeFileName(`lifecycle-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  const diskPath = path.join(BACKEND_UPLOADS_DIR, fileName);
  await fs.writeFile(diskPath, buffer);

  return {
    source_url: String(sourceUrl || "").trim(),
    resolved_source_url: resolvedSourceUrl,
    backend_url: toBackendUploadUrl(fileName),
    file_name: fileName,
    storage_path: `uploads/${fileName}`,
    mime_type: contentType,
    size_bytes: buffer.length,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

async function removeMirroredFiles(entries = []) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    const storagePath = String(entry?.storage_path || "").trim();
    if (!storagePath) continue;
    const diskPath = path.resolve(process.cwd(), storagePath);
    try {
      await fs.unlink(diskPath);
    } catch {
      // Best-effort cleanup for temp mirrored files.
    }
  }
}

async function persistMediaUsageRecord(executor, entityType, entityId, usageType, position, mirrored, { snapshotApproved = false, caption = null } = {}) {
  const [assetInsert] = await executor.query(
    `INSERT INTO media_assets (
       asset_uid, source_url, checksum, status, related_type, related_id,
       mime_type, size_bytes, storage_disk, storage_path, file_name
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      crypto.randomUUID(),
      mirrored.resolved_source_url,
      mirrored.checksum,
      snapshotApproved ? "approved" : "pending",
      entityType,
      Number(entityId),
      mirrored.mime_type,
      mirrored.size_bytes,
      "local",
      mirrored.storage_path,
      mirrored.file_name,
    ]
  );

  const assetId = Number(assetInsert.insertId || 0) || 0;
  await executor.query(
    `INSERT INTO content_image_usages (asset_id, entity_type, entity_id, usage_type, position, caption)
     VALUES (?,?,?,?,?,?)`,
    [assetId, entityType, Number(entityId), usageType, Number(position || 0), caption]
  );

  return {
    ...mirrored,
    asset_id: assetId,
    role: usageType,
    selected: true,
    caption,
  };
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

async function cleanupReplacedMediaAssets(oldRows = []) {
  const assetIds = Array.from(
    new Set(
      (Array.isArray(oldRows) ? oldRows : [])
        .map((row) => Number(row?.asset_id || 0) || 0)
        .filter(Boolean)
    )
  );
  if (!assetIds.length) return;

  const placeholders = assetIds.map(() => "?").join(",");
  const [inUseRows] = await pool.query(
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
  if (!removableIds.length) return;

  const removableRows = (Array.isArray(oldRows) ? oldRows : []).filter((row) => {
    const assetId = Number(row?.asset_id || 0) || 0;
    return removableIds.includes(assetId);
  });

  for (const row of removableRows) {
    const storagePath = String(row?.storage_path || "").trim();
    const fileName = String(row?.file_name || "").trim();
    const relativePath = storagePath || (fileName ? `uploads/${fileName}` : "");
    if (!relativePath || !/^uploads\//i.test(relativePath.replace(/\\/g, "/"))) continue;
    const diskPath = path.resolve(process.cwd(), relativePath);
    try {
      await fs.unlink(diskPath);
    } catch {
      // Best-effort cleanup for superseded backend assets.
    }
  }

  const removablePlaceholders = removableIds.map(() => "?").join(",");
  await pool.query(`DELETE FROM media_assets WHERE id IN (${removablePlaceholders})`, removableIds);
}

async function applyMediaManifestForEntity(entityType, entityId, mediaManifest, sourceBaseUrl, { snapshotApproved = false } = {}) {
  const manifest = sanitizeMediaManifest(mediaManifest, 0);
  const resultManifest = {
    authority: String(manifest.authority || "release_main_selected_assets"),
    cover: null,
    gallery: [],
    inline: [],
    video: [],
  };

  const importQueue = [];
  if (manifest.cover) importQueue.push({ usage_type: "cover", entry: manifest.cover });
  for (const entry of manifest.gallery) importQueue.push({ usage_type: "gallery", entry });
  for (const entry of manifest.inline) importQueue.push({ usage_type: "inline", entry });

  if (!importQueue.length) {
    return {
      cover_url: null,
      media_manifest: resultManifest,
    };
  }

  const mirroredQueue = [];
  const handoffFailures = [];
  for (const row of importQueue) {
    try {
      const mirrored = await mirrorImageToBackendStorage(row.entry.source_url, sourceBaseUrl);
      mirroredQueue.push({
        usage_type: row.usage_type,
        entry: row.entry,
        mirrored,
      });
    } catch (err) {
      handoffFailures.push({
        usage_type: row.usage_type,
        source_url: row.entry.source_url,
        reason: String(err?.message || "unknown_error"),
      });
    }
  }

  if (handoffFailures.length) {
    await removeMirroredFiles(mirroredQueue.map((row) => row.mirrored));
    throw new Error(`media handoff failed: ${handoffFailures[0].reason}`);
  }

  const connection = await pool.getConnection();
  const positionByUsage = { cover: 0, gallery: 0, inline: 0 };
  let oldRows = [];
  try {
    await connection.beginTransaction();
    oldRows = await listExistingMediaUsageRows(connection, entityType, entityId);
    await connection.query(
      `DELETE FROM content_image_usages
       WHERE entity_type=? AND entity_id=? AND usage_type IN ('cover','gallery','inline')`,
      [entityType, Number(entityId)]
    );

    for (const row of mirroredQueue) {
      const persisted = await persistMediaUsageRecord(
        connection,
        entityType,
        entityId,
        row.usage_type,
        positionByUsage[row.usage_type] || 0,
        row.mirrored,
        { snapshotApproved, caption: row.caption }
      );
      positionByUsage[row.usage_type] += 1;

      if (row.usage_type === "cover") {
        resultManifest.cover = persisted;
      } else if (row.usage_type === "gallery") {
        resultManifest.gallery.push(persisted);
      } else if (row.usage_type === "inline") {
        resultManifest.inline.push(persisted);
      }
    }

    await connection.commit();
  } catch (err) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failure and preserve original error.
    }
    await removeMirroredFiles(mirroredQueue.map((row) => row.mirrored));
    throw err;
  } finally {
    connection.release();
  }

  await cleanupReplacedMediaAssets(oldRows);

  const coverUrl = String(resultManifest.cover?.backend_url || "").trim()
    || String(resultManifest.gallery?.[0]?.backend_url || "").trim()
    || String(resultManifest.inline?.[0]?.backend_url || "").trim()
    || null;

  return {
    cover_url: coverUrl,
    media_manifest: resultManifest,
  };
}

function sanitizePublishedRow(row, index) {
  const sourceContentItemId = toPositiveInt(row?.source_content_item_id);
  if (!sourceContentItemId) {
    throw new Error(`published[${index}].source_content_item_id is required`);
  }

  const type = normalizeSourceType(row?.type);
  if (!type) {
    throw new Error(`published[${index}].type is invalid`);
  }

  const sourceLang = cleanLifecycleLang(row?.source_lang, "th");
  if (sourceLang !== "th") {
    throw new Error(`published[${index}].source_lang must be th`);
  }

  const title = cleanPlainText(row?.title, { required: true, max: LIMITS.TITLE_MAX, field: `published[${index}].title` });
  const body = cleanRichText(row?.body, {
    required: true,
    max: LIMITS.DESCRIPTION_MAX,
    field: `published[${index}].body`,
  });
  const publishedAt = String(row?.published_at || "").trim();
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error(`published[${index}].published_at must be a valid datetime`);
  }

  let category = "attractions";
  if (type === "place") {
    category = cleanSlug(row?.category || "attractions", { field: `published[${index}].category` });
  }

  const mediaManifest = sanitizeMediaManifest(row?.media_manifest, index);
  const coverImageFromManifest = String(mediaManifest?.cover?.source_url || "").trim();
  const releaseId = String(row?.release_id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(releaseId)) {
    throw new Error(`published[${index}].release_id must be a UUID`);
  }
  const manifestHash = String(row?.manifest_hash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(manifestHash)) {
    throw new Error(`published[${index}].manifest_hash must be a SHA-256 hex digest`);
  }

  return {
    source_content_item_id: sourceContentItemId,
    type,
    source_lang: sourceLang,
    category,
    slug: cleanSlug(row?.slug, { required: true, field: `published[${index}].slug` }),
    title,
    excerpt: (() => {
      const value = cleanPlainText(row?.excerpt, {
        required: false,
        max: LIMITS.DESCRIPTION_MAX,
        field: `published[${index}].excerpt`,
      });
      return value || null;
    })(),
    body,
    meta_title: row?.meta_title
      ? cleanPlainText(row.meta_title, { max: LIMITS.META_TITLE_MAX, field: `published[${index}].meta_title` })
      : null,
    meta_description: row?.meta_description
      ? cleanPlainText(row.meta_description, {
          max: LIMITS.META_DESC_MAX,
          field: `published[${index}].meta_description`,
        })
      : null,
    event_period_text: row?.event_period_text
      ? cleanPlainText(row.event_period_text, {
          required: false,
          max: LIMITS.DESCRIPTION_MAX,
          field: `published[${index}].event_period_text`,
        })
      : null,
    location_text: row?.location_text
      ? cleanPlainText(row.location_text, {
          required: false,
          max: LIMITS.DESCRIPTION_MAX,
          field: `published[${index}].location_text`,
        })
      : null,
    latitude: type === "place"
      ? cleanLifecycleCoordinate(row?.latitude, { min: -90, max: 90, field: `published[${index}].latitude` })
      : null,
    longitude: type === "place"
      ? cleanLifecycleCoordinate(row?.longitude, { min: -180, max: 180, field: `published[${index}].longitude` })
      : null,
    map_url: row?.map_url ? cleanUrl(row.map_url, { field: `published[${index}].map_url` }) : null,
    google_place_id: row?.google_place_id
      ? cleanPlainText(row.google_place_id, { max: 255, field: `published[${index}].google_place_id` })
      : null,
    transport_subtype: row?.transport_subtype
      ? cleanSlug(row.transport_subtype, { required: false, field: `published[${index}].transport_subtype` })
      : null,
    transport_contact_name: row?.transport_contact_name
      ? cleanPlainText(row.transport_contact_name, { max: 255, field: `published[${index}].transport_contact_name` })
      : null,
    transport_contact_phone: row?.transport_contact_phone
      ? cleanPlainText(row.transport_contact_phone, { max: 120, field: `published[${index}].transport_contact_phone` })
      : null,
    transport_contact_details: row?.transport_contact_details
      ? cleanPlainText(row.transport_contact_details, { max: LIMITS.DESCRIPTION_MAX, field: `published[${index}].transport_contact_details` })
      : null,
    transport_link_url: row?.transport_link_url
      ? cleanUrl(row.transport_link_url, { field: `published[${index}].transport_link_url` })
      : null,
    image: coverImageFromManifest || null,
    media_manifest: mediaManifest,
    release_id: releaseId,
    manifest_hash: manifestHash,
    published_at: publishedAt,
  };
}

function sanitizeTranslationRow(row, index) {
  const sourceContentItemId = toPositiveInt(row?.source_content_item_id);
  if (!sourceContentItemId) {
    throw new Error(`translations[${index}].source_content_item_id is required`);
  }

  const lang = cleanLifecycleLang(row?.lang, "");
  if (!lang) {
    throw new Error(`translations[${index}].lang is invalid`);
  }

  const titleValue = cleanPlainText(row?.title, {
    required: false,
    max: LIMITS.TITLE_MAX,
    field: `translations[${index}].title`,
  });
  const excerptValue = cleanPlainText(row?.excerpt, {
    required: false,
    max: LIMITS.DESCRIPTION_MAX,
    field: `translations[${index}].excerpt`,
  });
  const bodyValue = cleanRichText(row?.body, {
    required: false,
    max: LIMITS.DESCRIPTION_MAX,
    field: `translations[${index}].body`,
  });

  return {
    source_content_item_id: sourceContentItemId,
    lang,
    title: titleValue || null,
    excerpt: excerptValue || null,
    body: bodyValue || null,
    meta_title: row?.meta_title
      ? cleanPlainText(row.meta_title, { max: LIMITS.META_TITLE_MAX, field: `translations[${index}].meta_title` })
      : null,
    meta_description: row?.meta_description
      ? cleanPlainText(row.meta_description, {
          max: LIMITS.META_DESC_MAX,
          field: `translations[${index}].meta_description`,
        })
      : null,
  };
}

async function ensureLifecycleSyncTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lifecycle_content_map (
      id INT NOT NULL AUTO_INCREMENT,
      source_system VARCHAR(64) NOT NULL,
      source_content_type VARCHAR(32) NOT NULL,
      source_content_item_id BIGINT NOT NULL,
      local_entity_type VARCHAR(32) NOT NULL,
      local_entity_id BIGINT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_source_entity (source_system, source_content_type, source_content_item_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS place_translations (
      id INT NOT NULL AUTO_INCREMENT,
      place_id INT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      meta_title VARCHAR(255) NULL,
      meta_description VARCHAR(320) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_place_lang (place_id, lang)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_translations (
      id INT NOT NULL AUTO_INCREMENT,
      event_id INT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      meta_title VARCHAR(255) NULL,
      meta_description VARCHAR(320) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_event_lang (event_id, lang)
    )
  `);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lifecycle_release_imports (
      id BIGINT NOT NULL AUTO_INCREMENT,
      source_system VARCHAR(64) NOT NULL,
      source_release_id CHAR(36) NOT NULL,
      manifest_hash CHAR(64) NOT NULL,
      source_content_type VARCHAR(32) NOT NULL,
      source_content_item_id BIGINT NOT NULL,
      local_entity_type VARCHAR(32) NULL,
      local_entity_id BIGINT NULL,
      status ENUM('processing','succeeded','failed') NOT NULL DEFAULT 'processing',
      result_json JSON NULL,
      failure_reason TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_lifecycle_release_manifest (source_system, source_release_id, manifest_hash),
      KEY idx_lifecycle_release_import_item (source_system, source_content_type, source_content_item_id),
      KEY idx_lifecycle_release_import_status (status, updated_at)
    )
  `);

  const [placeMetaTitleCol] = await pool.query("SHOW COLUMNS FROM place_translations LIKE 'meta_title'");
  if (!placeMetaTitleCol.length) {
    await pool.query("ALTER TABLE place_translations ADD COLUMN meta_title VARCHAR(255) NULL");
  }

  const [placeMetaDescriptionCol] = await pool.query("SHOW COLUMNS FROM place_translations LIKE 'meta_description'");
  if (!placeMetaDescriptionCol.length) {
    await pool.query("ALTER TABLE place_translations ADD COLUMN meta_description VARCHAR(320) NULL");
  }

  const [eventMetaTitleCol] = await pool.query("SHOW COLUMNS FROM event_translations LIKE 'meta_title'");
  if (!eventMetaTitleCol.length) {
    await pool.query("ALTER TABLE event_translations ADD COLUMN meta_title VARCHAR(255) NULL");
  }

  const [eventMetaDescriptionCol] = await pool.query("SHOW COLUMNS FROM event_translations LIKE 'meta_description'");
  if (!eventMetaDescriptionCol.length) {
    await pool.query("ALTER TABLE event_translations ADD COLUMN meta_description VARCHAR(320) NULL");
  }

  await pool.query(`
    DELETE older
    FROM place_translations older
    INNER JOIN place_translations newer
      ON newer.place_id = older.place_id
     AND newer.lang = older.lang
     AND newer.id > older.id
  `);
  const [placeLangIndex] = await pool.query("SHOW INDEX FROM place_translations WHERE Key_name='uq_place_lang'");
  if (!placeLangIndex.length) {
    await pool.query("ALTER TABLE place_translations ADD UNIQUE KEY uq_place_lang (place_id, lang)");
  }

  await pool.query(`
    DELETE older
    FROM event_translations older
    INNER JOIN event_translations newer
      ON newer.event_id = older.event_id
     AND newer.lang = older.lang
     AND newer.id > older.id
  `);
  const [eventLangIndex] = await pool.query("SHOW INDEX FROM event_translations WHERE Key_name='uq_event_lang'");
  if (!eventLangIndex.length) {
    await pool.query("ALTER TABLE event_translations ADD UNIQUE KEY uq_event_lang (event_id, lang)");
  }
}

export function assertLifecycleInfrastructureReady() {
  if (!lifecycleInfrastructureReady) {
    throw new Error("Lifecycle infrastructure is not initialized");
  }
}

export async function initializeLifecycleInfrastructure() {
  await ensureLifecycleSyncTables();
  lifecycleInfrastructureReady = true;
}

async function getMappedLocalEntity(sourceSystem, sourceContentType, sourceContentItemId) {
  const [rows] = await pool.query(
    `SELECT local_entity_type, local_entity_id
     FROM lifecycle_content_map
     WHERE source_system=? AND source_content_type=? AND source_content_item_id=?
     LIMIT 1`,
    [sourceSystem, sourceContentType, Number(sourceContentItemId)]
  );

  return rows.length ? rows[0] : null;
}

async function upsertMapping(sourceSystem, sourceContentType, sourceContentItemId, localEntityType, localEntityId) {
  await pool.query(
    `INSERT INTO lifecycle_content_map
      (source_system, source_content_type, source_content_item_id, local_entity_type, local_entity_id)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
      local_entity_type=VALUES(local_entity_type),
      local_entity_id=VALUES(local_entity_id)`,
    [sourceSystem, sourceContentType, Number(sourceContentItemId), localEntityType, Number(localEntityId)]
  );
}

function parseLifecycleImportResult(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

async function claimLifecycleReleaseImport(sourceSystem, article) {
  const [insertResult] = await pool.query(
    `INSERT IGNORE INTO lifecycle_release_imports
      (source_system, source_release_id, manifest_hash, source_content_type, source_content_item_id, status)
     VALUES (?,?,?,?,?, 'processing')`,
    [sourceSystem, article.release_id, article.manifest_hash, article.type, Number(article.source_content_item_id)]
  );
  const [rows] = await pool.query(
    `SELECT * FROM lifecycle_release_imports
     WHERE source_system=? AND source_release_id=? AND manifest_hash=?
     LIMIT 1`,
    [sourceSystem, article.release_id, article.manifest_hash]
  );
  const row = rows[0] || null;
  if (!row) throw new Error("could not claim lifecycle release import");
  if (
    String(row.source_content_type || "") !== article.type
    || Number(row.source_content_item_id || 0) !== Number(article.source_content_item_id || 0)
  ) {
    throw new Error("release_id and manifest_hash are already bound to a different content item");
  }
  if (Number(insertResult.affectedRows || 0) === 1) {
    return { ...row, claimed: true };
  }
  if (String(row.status || "") === "failed") {
    const [retryResult] = await pool.query(
      `UPDATE lifecycle_release_imports
       SET status='processing', failure_reason=NULL
       WHERE id=? AND status='failed'`,
      [Number(row.id)]
    );
    if (Number(retryResult.affectedRows || 0) === 1) {
      return { ...row, status: "processing", claimed: true };
    }
  }
  return { ...row, claimed: false };
}

async function completeLifecycleReleaseImport(importId, result) {
  await pool.query(
    `UPDATE lifecycle_release_imports
     SET status='succeeded', local_entity_type=?, local_entity_id=?, result_json=?, failure_reason=NULL
     WHERE id=?`,
    [result.entity_type, Number(result.local_entity_id), JSON.stringify(result), Number(importId)]
  );
}

async function failLifecycleReleaseImport(importId, reason) {
  await pool.query(
    `UPDATE lifecycle_release_imports
     SET status='failed', failure_reason=?
     WHERE id=?`,
    [String(reason || "lifecycle import failed").slice(0, 4000), Number(importId)]
  );
}

async function getCategoryIdBySlug(categorySlug) {
  const slug = cleanSlug(categorySlug || "attractions", { field: "category" });
  const [rows] = await pool.query("SELECT id FROM categories WHERE slug=? LIMIT 1", [slug]);
  if (rows.length) return rows[0].id;

  const [fallback] = await pool.query("SELECT id FROM categories WHERE slug='attractions' LIMIT 1");
  return fallback.length ? fallback[0].id : null;
}

async function upsertPlaceTranslation(placeId, lang, title, description, metaTitle, metaDescription) {
  await pool.query(
    `INSERT INTO place_translations
      (place_id, lang, title, description, meta_title, meta_description)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
      title=VALUES(title),
      description=VALUES(description),
      meta_title=VALUES(meta_title),
      meta_description=VALUES(meta_description)`,
    [
      Number(placeId),
      cleanLifecycleLang(lang, "th"),
      title,
      description || null,
      metaTitle || null,
      resolveMetaDescription(metaDescription, description),
    ]
  );
}

async function upsertEventTranslation(eventId, lang, title, description, metaTitle, metaDescription) {
  await pool.query(
    `INSERT INTO event_translations
      (event_id, lang, title, description, meta_title, meta_description)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
      title=VALUES(title),
      description=VALUES(description),
      meta_title=VALUES(meta_title),
      meta_description=VALUES(meta_description)`,
    [
      Number(eventId),
      cleanLifecycleLang(lang, "th"),
      title,
      description || null,
      metaTitle || null,
      resolveMetaDescription(metaDescription, description),
    ]
  );
}

async function upsertPlaceFromLifecycle(sourceSystem, article, translationsBySource, options = {}) {
  const sourceId = Number(article.source_content_item_id || 0);
  await ensurePlaceLocationColumns();
  const categoryId = await getCategoryIdBySlug(article.category);
  if (!categoryId) {
    return { ok: false, reason: "missing category", source_content_item_id: sourceId };
  }

  const mapped = await getMappedLocalEntity(sourceSystem, "place", sourceId);
  let placeId = mapped?.local_entity_type === "place" ? Number(mapped.local_entity_id) : null;

  if (!placeId && article.slug) {
    const [bySlug] = await pool.query("SELECT id FROM places WHERE slug=? LIMIT 1", [article.slug]);
    if (bySlug.length) placeId = Number(bySlug[0].id);
  }

  if (!placeId) {
    const [insertPlace] = await pool.query(
      `INSERT INTO places (
        category_id, slug, image, is_approved, latitude, longitude, map_url, google_place_id,
        transport_subtype, transport_contact_name, transport_contact_phone, transport_contact_details, transport_link_url
      ) VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?)`,
      [
        categoryId,
        article.slug || null,
        null,
        article.latitude,
        article.longitude,
        article.map_url,
        article.google_place_id,
        article.transport_subtype,
        article.transport_contact_name,
        article.transport_contact_phone,
        article.transport_contact_details,
        article.transport_link_url,
      ]
    );
    placeId = Number(insertPlace.insertId);
  } else {
    await pool.query(
      `UPDATE places
       SET category_id=?, slug=COALESCE(?,slug), image=?, is_approved=0, latitude=?, longitude=?, map_url=?, google_place_id=?,
           transport_subtype=?, transport_contact_name=?, transport_contact_phone=?, transport_contact_details=?, transport_link_url=?
       WHERE id=?`,
      [
        categoryId,
        article.slug || null,
        null,
        article.latitude,
        article.longitude,
        article.map_url,
        article.google_place_id,
        article.transport_subtype,
        article.transport_contact_name,
        article.transport_contact_phone,
        article.transport_contact_details,
        article.transport_link_url,
        placeId,
      ]
    );
  }

  const mediaSync = await applyMediaManifestForEntity(
    "place",
    placeId,
    article.media_manifest,
    options?.sourceBaseUrl,
    { snapshotApproved: options?.snapshotApproved === true }
  );
  const normalizedCover = String(mediaSync?.cover_url || "").trim() || null;
  if (normalizedCover) {
    await pool.query("UPDATE places SET image=? WHERE id=?", [normalizedCover, placeId]);
  }

  await upsertPlaceTranslation(placeId, "th", article.title, article.body, article.meta_title, article.meta_description);

  const translations = Array.isArray(translationsBySource[sourceId]) ? translationsBySource[sourceId] : [];
  for (const t of translations) {
    if (cleanLifecycleLang(t?.lang, "") === "th") continue;
    const translatedTitle = String(t?.title || "").trim() || article.title;
    await upsertPlaceTranslation(
      placeId,
      t.lang,
      translatedTitle,
      t.body || null,
      t.meta_title || null,
      t.meta_description || null
    );
  }

  await upsertMapping(sourceSystem, "place", sourceId, "place", placeId);
  return {
    ok: true,
    entity_type: "place",
    local_entity_id: placeId,
    review_article: {
      ...article,
      image: normalizedCover,
      media_manifest: {
        ...(mediaSync?.media_manifest || sanitizeMediaManifest(article.media_manifest, 0)),
        source_manifest: sanitizeMediaManifest(article.media_manifest, 0),
      },
    },
  };
}

async function upsertEventFromLifecycle(sourceSystem, article, translationsBySource, options = {}) {
  const sourceId = Number(article.source_content_item_id || 0);
  const mapped = await getMappedLocalEntity(sourceSystem, "event", sourceId);
  let eventId = mapped?.local_entity_type === "event" ? Number(mapped.local_entity_id) : null;

  if (!eventId) {
    const [insertEvent] = await pool.query(
      "INSERT INTO events (title, description, image, is_approved, approved_at) VALUES (?,?,?,?,?)",
      [article.title, article.body || null, null, 0, null]
    );
    eventId = Number(insertEvent.insertId);
    await pool.query(
      "UPDATE events SET event_period_text=?, location_text=?, map_url=? WHERE id=?",
      [article.event_period_text || null, article.location_text || null, article.map_url || null, eventId]
    );
  } else {
    await pool.query(
      "UPDATE events SET title=?, description=?, image=?, event_period_text=?, location_text=?, map_url=?, is_approved=0, approved_at=NULL WHERE id=?",
      [article.title, article.body || null, null, article.event_period_text || null, article.location_text || null, article.map_url || null, eventId]
    );
  }

  const mediaSync = await applyMediaManifestForEntity(
    "event",
    eventId,
    article.media_manifest,
    options?.sourceBaseUrl,
    { snapshotApproved: options?.snapshotApproved === true }
  );
  const normalizedCover = String(mediaSync?.cover_url || "").trim() || null;
  if (normalizedCover) {
    await pool.query("UPDATE events SET image=? WHERE id=?", [normalizedCover, eventId]);
  }

  await upsertEventTranslation(eventId, "th", article.title, article.body, article.meta_title, article.meta_description);

  const translations = Array.isArray(translationsBySource[sourceId]) ? translationsBySource[sourceId] : [];
  for (const t of translations) {
    if (cleanLifecycleLang(t?.lang, "") === "th") continue;
    const translatedTitle = String(t?.title || "").trim() || article.title;
    await upsertEventTranslation(
      eventId,
      t.lang,
      translatedTitle,
      t.body || null,
      t.meta_title || null,
      t.meta_description || null
    );
  }

  await upsertMapping(sourceSystem, "event", sourceId, "event", eventId);
  return {
    ok: true,
    entity_type: "event",
    local_entity_id: eventId,
    review_article: {
      ...article,
      image: normalizedCover,
      media_manifest: {
        ...(mediaSync?.media_manifest || sanitizeMediaManifest(article.media_manifest, 0)),
        source_manifest: sanitizeMediaManifest(article.media_manifest, 0),
      },
    },
  };
}

export const importPublishedLifecycleBundle = async (req, res) => {
  try {
    assertBackendIntegrationReadiness(["collector_lifecycle_import"]);

    const providedToken = String(req.headers["x-lifecycle-token"] || "").trim();
    const expected = Buffer.from(LIFECYCLE_SYNC_TOKEN);
    const received = Buffer.from(providedToken);
    const valid = received.length === expected.length && crypto.timingSafeEqual(received, expected);
    if (!providedToken || !valid) {
      return res.status(401).json({ error: "Invalid lifecycle sync token" });
    }

    assertLifecycleInfrastructureReady();

    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "source_system")) {
      return res.status(400).json({ error: "source_system is required" });
    }
    const sourceSystem = cleanPlainText(req.body?.source_system, { field: "source_system", max: 64 }).toLowerCase();
    if (sourceSystem !== "collector-app") {
      return res.status(400).json({ error: "source_system must be collector-app" });
    }
    const sourceBaseUrl = resolveCollectorSourceBaseUrl(req.body?.source_base_url);

    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "content_item_id")) {
      return res.status(400).json({ error: "content_item_id is required (nullable)" });
    }
    const contentItemIdRaw = req.body?.content_item_id;
    const contentItemId = contentItemIdRaw === null ? null : toPositiveInt(contentItemIdRaw);
    if (contentItemIdRaw !== null && !contentItemId) {
      return res.status(400).json({ error: "content_item_id must be a positive integer or null" });
    }

    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "published") || !Array.isArray(req.body?.published)) {
      return res.status(400).json({ error: "published must be an array" });
    }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "translations") || !Array.isArray(req.body?.translations)) {
      return res.status(400).json({ error: "translations must be an array" });
    }
    const publishedRaw = req.body.published;
    const translationsRaw = req.body.translations;

    if (publishedRaw.length > LIFECYCLE_PUBLISHED_MAX) {
      return res.status(400).json({ error: `published exceeds max size (${LIFECYCLE_PUBLISHED_MAX})` });
    }
    if (translationsRaw.length > LIFECYCLE_TRANSLATIONS_MAX) {
      return res.status(400).json({ error: `translations exceeds max size (${LIFECYCLE_TRANSLATIONS_MAX})` });
    }

    const published = publishedRaw.map((row, i) => sanitizePublishedRow(row, i));
    const translations = translationsRaw.map((row, i) => sanitizeTranslationRow(row, i));

    const translationsBySource = {};
    for (const t of translations) {
      const key = Number(t.source_content_item_id || 0);
      if (!key) continue;
      if (!translationsBySource[key]) translationsBySource[key] = [];
      translationsBySource[key].push(t);
    }

    let synced = 0;
    let skipped = 0;
    let rejected = 0;
    let reviewResets = 0;
    const errors = [];
    const skippedResults = [];

    for (let i = 0; i < published.length; i += 1) {
      const article = published[i];
      const sourceId = Number(article.source_content_item_id || 0);
      const sourceType = article.type;

      const releaseImport = await claimLifecycleReleaseImport(sourceSystem, article);
      if (!releaseImport.claimed && String(releaseImport.status || "") === "succeeded") {
        skipped += 1;
        skippedResults.push({
          index: i,
          source_content_item_id: sourceId,
          release_id: article.release_id,
          manifest_hash: article.manifest_hash,
          result: parseLifecycleImportResult(releaseImport.result_json),
        });
        continue;
      }
      if (!releaseImport.claimed) {
        rejected += 1;
        errors.push({ index: i, source_content_item_id: sourceId, reason: "release import is already processing" });
        continue;
      }

      try {
        let result;
        if (sourceType === "event") {
          result = await upsertEventFromLifecycle(sourceSystem, article, translationsBySource, { sourceBaseUrl, snapshotApproved: true });
        } else {
          result = await upsertPlaceFromLifecycle(sourceSystem, article, translationsBySource, { sourceBaseUrl, snapshotApproved: true });
        }

        if (!result.ok) {
          await failLifecycleReleaseImport(releaseImport.id, result.reason || "sync failed");
          rejected += 1;
          errors.push({ index: i, source_content_item_id: sourceId, reason: result.reason || "sync failed" });
          continue;
        }

        const importReview = await upsertCollectorImportReviewFromImport({
          sourceSystem,
          sourceContentType: sourceType,
          sourceContentItemId: sourceId,
          localEntityType: result.entity_type,
          localEntityId: result.local_entity_id,
          publishedAt: article.published_at,
          article: result.review_article || article,
          translations: translationsBySource[sourceId] || [],
        });
        if (importReview.review_reset) {
          reviewResets += 1;
        }

        const storedResult = {
          entity_type: result.entity_type,
          local_entity_id: result.local_entity_id,
          import_review_id: Number(importReview?.review?.id || 0) || null,
          review_reset: Boolean(importReview.review_reset),
        };
        await completeLifecycleReleaseImport(releaseImport.id, storedResult);
        synced += 1;
      } catch (err) {
        const reason = String(err?.message || "sync failed");
        await failLifecycleReleaseImport(releaseImport.id, reason);
        rejected += 1;
        errors.push({ index: i, source_content_item_id: sourceId, reason });
      }
    }

    console.info("[lifecycle.import_published]", {
      source_system: sourceSystem,
      content_item_id: contentItemId,
      received: published.length,
      synced,
      skipped,
      rejected,
      review_resets: reviewResets,
      at: new Date().toISOString(),
    });

    return res.json({
      source_system: sourceSystem,
      content_item_id: contentItemId,
      payload_summary: {
        published: published.length,
        translations: translations.length,
      },
      received: published.length,
      synced,
      skipped,
      rejected,
      review_resets: reviewResets,
      errors,
      skipped_results: skippedResults,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("Lifecycle infrastructure is not initialized")) {
      return res.status(503).json({ error: "Lifecycle infrastructure is not initialized" });
    }
    if (msg.includes("published[") || msg.includes("translations[") || msg.includes("exceeds max size") || msg.includes("source_system")) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

