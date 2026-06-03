import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";
import { cleanPlainText, cleanRichText, cleanSlug, cleanUrl } from "../validators/inputSanitizer.js";
import { appendReviewAction } from "./reviewContentService.js";
import { cleanupUnpublishedBatchAssets } from "./reviewCleanupService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

function normalizeContentType(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "place" || v === "event") return v;
  throw new Error("content.content_type must be place or event");
}

function normalizeRole(value, fallback = "gallery") {
  const role = String(value || fallback).trim().toLowerCase();
  if (role === "cover" || role === "gallery" || role === "inline") return role;
  return fallback;
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("source_base_url is required");
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("source_base_url must be http/https");
  return parsed.toString().replace(/\/+$/, "");
}

function resolveMediaSourceUrl(rawSourceUrl, baseUrl) {
  const sourceUrl = cleanUrl(rawSourceUrl, { required: true, field: "media_manifest.source_url" });
  if (/^https?:\/\//i.test(sourceUrl)) return sourceUrl;
  const normalizedPath = sourceUrl.startsWith("/") ? sourceUrl : `/${sourceUrl.replace(/^\/+/, "")}`;
  return new URL(normalizedPath, `${baseUrl}/`).toString();
}

async function ensureUploadsDir() {
  await fs.mkdir(BACKEND_UPLOADS_DIR, { recursive: true });
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

function toBackendUploadUrl(fileName) {
  const base = String(process.env.BACKEND_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (base) return `${base}/uploads/${fileName}`;
  return `/uploads/${fileName}`;
}

async function mirrorImageToBackendStorage(sourceUrl, sourceBaseUrl) {
  const resolvedSourceUrl = resolveMediaSourceUrl(sourceUrl, sourceBaseUrl);
  let response;
  try {
    response = await fetch(resolvedSourceUrl);
  } catch (error) {
    throw new Error(`cannot fetch media request failed: ${resolvedSourceUrl}`);
  }
  if (!response.ok) throw new Error(`cannot fetch media (${response.status})`);

  const contentType = String(response.headers.get("content-type") || "").trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error(`unsupported media content-type: ${contentType || "unknown"}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("empty media payload");
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error("media payload too large");

  await ensureUploadsDir();
  const ext = extFromContentType(contentType);
  const fileName = `review-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const storagePath = `uploads/${fileName}`;
  const diskPath = path.join(BACKEND_UPLOADS_DIR, fileName);
  await fs.writeFile(diskPath, buffer);

  return {
    source_url: String(sourceUrl || "").trim(),
    resolved_source_url: resolvedSourceUrl,
    backend_url: toBackendUploadUrl(fileName),
    storage_disk: "local",
    storage_path: storagePath,
    file_name: fileName,
    mime_type: contentType,
    size_bytes: buffer.length,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function sanitizeContentPayload(payload = {}) {
  const contentType = normalizeContentType(payload.content_type);
  const publicEntityType =
    payload.public_entity_type == null || payload.public_entity_type === ""
      ? null
      : normalizeContentType(payload.public_entity_type);
  const publicEntityId =
    payload.public_entity_id == null || payload.public_entity_id === ""
      ? null
      : Number(payload.public_entity_id);

  return {
    content_type: contentType,
    lang: cleanPlainText(payload.lang || "th", { field: "content.lang", max: 8 }) || "th",
    category: contentType === "place"
      ? cleanSlug(payload.category || "attractions", { field: "content.category" })
      : "event",
    slug: cleanSlug(payload.slug, { required: false, field: "content.slug" }) || null,
    title: cleanPlainText(payload.title, { required: true, max: 255, field: "content.title" }),
    body: cleanRichText(payload.body, { required: true, max: 40000, field: "content.body" }),
    excerpt: cleanPlainText(payload.excerpt, { required: false, max: 40000, field: "content.excerpt" }) || null,
    meta_title: cleanPlainText(payload.meta_title, { required: false, max: 255, field: "content.meta_title" }) || null,
    meta_description: cleanPlainText(payload.meta_description, { required: false, max: 320, field: "content.meta_description" }) || null,
    event_period_text: cleanPlainText(payload.event_period_text, { required: false, max: 40000, field: "content.event_period_text" }) || null,
    location_text: cleanPlainText(payload.location_text, { required: false, max: 40000, field: "content.location_text" }) || null,
    latitude: payload.latitude == null || payload.latitude === "" ? null : Number(payload.latitude),
    longitude: payload.longitude == null || payload.longitude === "" ? null : Number(payload.longitude),
    map_url: payload.map_url ? cleanUrl(payload.map_url, { field: "content.map_url" }) : null,
    google_place_id: cleanPlainText(payload.google_place_id, { required: false, max: 255, field: "content.google_place_id" }) || null,
    transport_subtype: cleanSlug(payload.transport_subtype, { required: false, field: "content.transport_subtype" }) || null,
    transport_contact_name: cleanPlainText(payload.transport_contact_name, { required: false, max: 255, field: "content.transport_contact_name" }) || null,
    transport_contact_phone: cleanPlainText(payload.transport_contact_phone, { required: false, max: 120, field: "content.transport_contact_phone" }) || null,
    phone: cleanPlainText(payload.phone, { required: false, max: 120, field: "content.phone" }) || null,
    line_url: payload.line_url ? cleanUrl(payload.line_url, { field: "content.line_url" }) : null,
    facebook_url: payload.facebook_url ? cleanUrl(payload.facebook_url, { field: "content.facebook_url" }) : null,
    website_url: payload.website_url ? cleanUrl(payload.website_url, { field: "content.website_url" }) : null,
    primary_cta: ["map", "phone", "line"].includes(String(payload.primary_cta || "").trim().toLowerCase())
      ? String(payload.primary_cta || "").trim().toLowerCase()
      : null,
    tracking_entity_type: ["place", "event", "review_content"].includes(String(payload.tracking_entity_type || "").trim().toLowerCase())
      ? String(payload.tracking_entity_type || "").trim().toLowerCase()
      : null,
    tracking_entity_id:
      payload.tracking_entity_id == null || payload.tracking_entity_id === ""
        ? null
        : (Number.isFinite(Number(payload.tracking_entity_id)) && Number(payload.tracking_entity_id) > 0
          ? Math.floor(Number(payload.tracking_entity_id))
          : null),
    transport_contact_details: cleanPlainText(payload.transport_contact_details, { required: false, max: 40000, field: "content.transport_contact_details" }) || null,
    transport_link_url: payload.transport_link_url ? cleanUrl(payload.transport_link_url, { field: "content.transport_link_url" }) : null,
    public_entity_type: publicEntityType === contentType ? publicEntityType : null,
    public_entity_id: Number.isFinite(publicEntityId) && publicEntityId > 0 ? Math.floor(publicEntityId) : null,
    translation_langs: Array.isArray(payload.translation_langs)
      ? payload.translation_langs.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

function flattenMediaManifest(manifest = {}) {
  const queue = [];
  if (manifest?.cover) queue.push({ usage_type: "cover", entry: manifest.cover, position: 0 });
  const gallery = Array.isArray(manifest?.gallery) ? manifest.gallery : [];
  const inline = Array.isArray(manifest?.inline) ? manifest.inline : [];
  gallery.forEach((entry, index) => queue.push({ usage_type: "gallery", entry, position: index }));
  inline.forEach((entry, index) => queue.push({ usage_type: "inline", entry, position: index }));
  return queue;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteBodyMediaToBackendUrls(html, mirroredRows = [], sourceBaseUrl) {
  let output = String(html || "");
  if (!output || !mirroredRows.length) return output;
  const replacements = [];
  for (const row of mirroredRows) {
    const backendUrl = String(row?.backend_url || "").trim();
    if (!backendUrl) continue;
    const sourceUrl = String(row?.source_url || "").trim();
    const resolvedSourceUrl = String(row?.resolved_source_url || "").trim();
    if (sourceUrl) replacements.push(sourceUrl);
    if (resolvedSourceUrl && resolvedSourceUrl !== sourceUrl) replacements.push(resolvedSourceUrl);
    if (sourceUrl && sourceBaseUrl) {
      try {
        const normalizedPath = sourceUrl.startsWith("/") ? sourceUrl : `/${sourceUrl.replace(/^\/+/, "")}`;
        const absoluteSourceUrl = new URL(normalizedPath, `${sourceBaseUrl}/`).toString();
        if (absoluteSourceUrl !== sourceUrl && absoluteSourceUrl !== resolvedSourceUrl) replacements.push(absoluteSourceUrl);
      } catch {
        // Ignore invalid URL reconstruction.
      }
    }
    for (const candidate of replacements) {
      if (!candidate || candidate === backendUrl) continue;
      output = output.replace(new RegExp(escapeRegExp(candidate), "g"), backendUrl);
    }
    replacements.length = 0;
  }
  return output;
}

export async function ingestReviewContent(payload) {
  const sourceSystem = cleanPlainText(payload?.source_system, { required: true, field: "source_system", max: 64 }).toLowerCase();
  const sourceContentItemId = Number(payload?.source_content_item_id || 0);
  if (!Number.isFinite(sourceContentItemId) || sourceContentItemId <= 0) {
    throw new Error("source_content_item_id must be positive");
  }
  const sourceBaseUrl = normalizeBaseUrl(payload?.source_base_url);
  const content = sanitizeContentPayload(payload?.content || {});
  const mediaQueue = flattenMediaManifest(payload?.media_manifest || {});
  const currentBatchUid = crypto.randomUUID();

  const [existingRows] = await pool.query(
    `SELECT id, status, current_batch_uid
     FROM review_contents
     WHERE source_system=? AND source_content_item_id=? AND content_type=?
     LIMIT 1`,
    [sourceSystem, sourceContentItemId, content.content_type]
  );
  const existing = existingRows.length ? existingRows[0] : null;

  const connection = await pool.getConnection();
  const mirroredRows = [];
  try {
    await connection.beginTransaction();

    let reviewContentId;
    if (!existing) {
      const [insertResult] = await connection.query(
        `INSERT INTO review_contents (
          source_system, source_content_item_id, content_type, status, lang, category, title, body, excerpt,
          meta_title, meta_description, event_period_text, location_text, latitude, longitude, map_url,
          google_place_id, transport_subtype, transport_contact_name, transport_contact_phone, phone, line_url, facebook_url, website_url, primary_cta,
          tracking_entity_type, tracking_entity_id,
          transport_contact_details, transport_link_url, slug, slug_locked, public_entity_type, public_entity_id,
          current_batch_uid, review_payload_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sourceSystem, sourceContentItemId, content.content_type, "pending_review", content.lang, content.category,
          content.title, content.body, content.excerpt, content.meta_title, content.meta_description,
          content.event_period_text, content.location_text, content.latitude, content.longitude, content.map_url,
          content.google_place_id, content.transport_subtype, content.transport_contact_name, content.transport_contact_phone,
          content.phone, content.line_url, content.facebook_url, content.website_url, content.primary_cta, content.tracking_entity_type, content.tracking_entity_id,
          content.transport_contact_details, content.transport_link_url, content.slug, content.slug ? 1 : 0,
          content.public_entity_type, content.public_entity_id, currentBatchUid,
          JSON.stringify({ snapshot_meta: { translation_langs: content.translation_langs } }),
        ]
      );
      reviewContentId = Number(insertResult.insertId || 0) || 0;
    } else {
      reviewContentId = Number(existing.id || 0) || 0;
      await cleanupUnpublishedBatchAssets(reviewContentId, existing.current_batch_uid, connection);
      await connection.query(
        `UPDATE review_contents
         SET status='pending_review', lang=?, category=?, title=?, body=?, excerpt=?, meta_title=?, meta_description=?,
             event_period_text=?, location_text=?, latitude=?, longitude=?, map_url=?, google_place_id=?,
             transport_subtype=?, transport_contact_name=?, transport_contact_phone=?, phone=?, line_url=?, facebook_url=?, website_url=?, primary_cta=?,
             tracking_entity_type=?, tracking_entity_id=?, transport_contact_details=?,
             transport_link_url=?, slug=?, slug_locked=?, public_entity_type=?, public_entity_id=?,
             current_batch_uid=?, review_payload_json=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [
          content.lang, content.category, content.title, content.body, content.excerpt, content.meta_title, content.meta_description,
          content.event_period_text, content.location_text, content.latitude, content.longitude, content.map_url, content.google_place_id,
          content.transport_subtype, content.transport_contact_name, content.transport_contact_phone, content.phone, content.line_url, content.facebook_url, content.website_url,
          content.primary_cta, content.tracking_entity_type, content.tracking_entity_id, content.transport_contact_details,
          content.transport_link_url, content.slug, content.slug ? 1 : 0, content.public_entity_type, content.public_entity_id,
          currentBatchUid, JSON.stringify({ snapshot_meta: { translation_langs: content.translation_langs } }),
          reviewContentId,
        ]
      );
    }

    for (const mediaRow of mediaQueue) {
      const sourceUrl = cleanUrl(mediaRow?.entry?.source_url, { required: true, field: "media_manifest.source_url" });
      const usageType = normalizeRole(mediaRow.usage_type, "gallery");
      const mirrored = await mirrorImageToBackendStorage(sourceUrl, sourceBaseUrl);
      mirroredRows.push(mirrored);
      await connection.query(
        `INSERT INTO review_content_assets (
          review_content_id, batch_uid, usage_type, position, source_url, resolved_source_url, backend_url,
          storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, status, asset_origin
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          reviewContentId, currentBatchUid, usageType, Number(mediaRow.position || 0),
          mirrored.source_url, mirrored.resolved_source_url, mirrored.backend_url,
          mirrored.storage_disk, mirrored.storage_path, mirrored.file_name, mirrored.mime_type,
          mirrored.size_bytes, mirrored.checksum, "review_ready", "collector_import",
        ]
      );
    }

    const rewrittenBody = rewriteBodyMediaToBackendUrls(content.body, mirroredRows, sourceBaseUrl);
    if (rewrittenBody !== content.body) {
      content.body = rewrittenBody;
      await connection.query(
        `UPDATE review_contents
         SET body=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [content.body, reviewContentId]
      );
    }

    const previousStatus = existing ? String(existing.status || "draft").toLowerCase() : "draft";
    await appendReviewAction({
      reviewContentId,
      batchUid: currentBatchUid,
      actionType: existing ? "reingested" : "ingested",
      previousStatus,
      nextStatus: "pending_review",
      payloadSnapshot: {
        source_system: sourceSystem,
        source_content_item_id: sourceContentItemId,
        content_type: content.content_type,
        slug: content.slug,
        public_entity_id: content.public_entity_id,
        public_entity_type: content.public_entity_type,
        title: content.title,
      },
      executor: connection,
    });

    await connection.commit();
    return {
      id: reviewContentId,
      status: "pending_review",
      content_type: content.content_type,
      source_content_item_id: sourceContentItemId,
      current_batch_uid: currentBatchUid,
      asset_counts: {
        cover: mediaQueue.filter((row) => normalizeRole(row.usage_type) === "cover").length,
        gallery: mediaQueue.filter((row) => normalizeRole(row.usage_type) === "gallery").length,
        inline: mediaQueue.filter((row) => normalizeRole(row.usage_type) === "inline").length,
      },
    };
  } catch (err) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback failure.
    }
    for (const mirrored of mirroredRows) {
      try {
        const relative = String(mirrored.storage_path || "").trim().replace(/\\/g, "/");
        if (relative.startsWith("uploads/")) {
          const localName = relative.slice("uploads/".length);
          await fs.unlink(path.join(BACKEND_UPLOADS_DIR, localName));
        }
      } catch {
        // Ignore cleanup failure.
      }
    }
    throw err;
  } finally {
    connection.release();
  }
}
