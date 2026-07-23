import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";
import { SUPPORTED_CONTENT_LANGS } from "../constants/languages.js";
import { cleanPlainText, cleanRichText, cleanSlug, cleanUrl } from "../validators/inputSanitizer.js";
import { appendReviewAction } from "./reviewContentService.js";
import { cleanupUnpublishedBatchAssets, cleanupUnpublishedBatchTranslations } from "./reviewCleanupService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const PUBLIC_TRANSLATION_TEXT_MAX_BYTES = 65535;
const PUBLIC_TRANSLATION_META_DESCRIPTION_MAX_BYTES = 320 * 4;

function isDebugDiagnosticsEnabled() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
}

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

function buildClientError(message, diagnostics = null) {
  const error = new Error(message);
  error.is_client_error = true;
  if (diagnostics && typeof diagnostics === "object") error.diagnostics = diagnostics;
  return error;
}

function sanitizeFileNameSegment(value, fallback = "media") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || fallback;
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
  if (!contentType.startsWith("image/")) {
    const diagnostics = {
      sourceUrl: String(sourceUrl || "").trim() || null,
      resolvedSourceUrl,
      responseStatus: Number(response.status || 0) || null,
      responseUrl: String(response.url || "").trim() || null,
      contentType: contentType || "unknown",
    };
    if (isDebugDiagnosticsEnabled()) {
      try {
        console.error("review-content media ingest unsupported content-type", diagnostics);
      } catch {
        console.error("review-content media ingest unsupported content-type");
      }
      throw new Error(`unsupported media content-type: ${contentType || "unknown"} ${JSON.stringify(diagnostics)}`);
    }
    throw new Error(`unsupported media content-type: ${contentType || "unknown"}`);
  }

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

function isCollectorHostedMediaUrl(sourceUrl, sourceBaseUrl) {
  try {
    const resolvedSourceUrl = resolveMediaSourceUrl(sourceUrl, sourceBaseUrl);
    return new URL(resolvedSourceUrl).origin === new URL(sourceBaseUrl).origin;
  } catch {
    return false;
  }
}

function normalizeClientMediaUid(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildMediaIndexLookup(mediaIndex) {
  const byFieldName = new Map();
  const byOriginalName = new Map();
  const items = Array.isArray(mediaIndex)
    ? mediaIndex
    : Array.isArray(mediaIndex?.files)
      ? mediaIndex.files
      : [];
  items.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const clientMediaUid = normalizeClientMediaUid(entry.client_media_uid || entry.clientMediaUid);
    if (!clientMediaUid) return;
    const fieldName = String(entry.field_name || entry.fieldName || "").trim();
    const originalName = String(entry.original_name || entry.originalName || "").trim();
    if (fieldName) byFieldName.set(fieldName, clientMediaUid);
    if (originalName) byOriginalName.set(originalName, clientMediaUid);
    byFieldName.set(`media_files[]:${index}`, clientMediaUid);
  });
  return { byFieldName, byOriginalName };
}

function buildUploadedFileMap(uploadedFiles = [], mediaIndex = null) {
  const directMap = new Map();
  const indexedMap = buildMediaIndexLookup(mediaIndex);
  uploadedFiles.forEach((file, index) => {
    const fieldName = String(file?.fieldname || "").trim();
    let clientMediaUid = fieldName.startsWith("media_") && fieldName !== "media_files[]"
      ? normalizeClientMediaUid(fieldName.slice("media_".length))
      : null;
    if (!clientMediaUid && indexedMap.byFieldName.has(fieldName)) {
      clientMediaUid = indexedMap.byFieldName.get(fieldName);
    }
    if (!clientMediaUid && indexedMap.byFieldName.has(`${fieldName}:${index}`)) {
      clientMediaUid = indexedMap.byFieldName.get(`${fieldName}:${index}`);
    }
    if (!clientMediaUid) {
      const originalName = String(file?.originalname || "").trim();
      if (originalName && indexedMap.byOriginalName.has(originalName)) {
        clientMediaUid = indexedMap.byOriginalName.get(originalName);
      }
    }
    if (!clientMediaUid) return;
    directMap.set(clientMediaUid, file);
  });
  return directMap;
}

async function storeUploadedImageToBackendStorage(file, sourceUrl, sourceBaseUrl, clientMediaUid) {
  const mimeType = String(file?.mimetype || "").trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw buildClientError("unsupported media upload content-type", {
      client_media_uid: clientMediaUid || null,
      source_url: String(sourceUrl || "").trim() || null,
      failure_reason: "unsupported_upload_content_type",
      upload_content_type: mimeType || "unknown",
    });
  }
  const buffer = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || "");
  if (!buffer.length) {
    throw buildClientError("empty uploaded media payload", {
      client_media_uid: clientMediaUid || null,
      source_url: String(sourceUrl || "").trim() || null,
      failure_reason: "empty_upload_payload",
    });
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw buildClientError("uploaded media payload too large", {
      client_media_uid: clientMediaUid || null,
      source_url: String(sourceUrl || "").trim() || null,
      failure_reason: "upload_too_large",
      size_bytes: buffer.length,
    });
  }

  await ensureUploadsDir();
  const ext = extFromContentType(mimeType);
  const namePrefix = sanitizeFileNameSegment(clientMediaUid || file?.originalname || "review-media", "review-media");
  const fileName = `review-${namePrefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
  const storagePath = `uploads/${fileName}`;
  const diskPath = path.join(BACKEND_UPLOADS_DIR, fileName);
  await fs.writeFile(diskPath, buffer);

  return {
    source_url: String(sourceUrl || "").trim(),
    resolved_source_url: resolveMediaSourceUrl(sourceUrl, sourceBaseUrl),
    backend_url: toBackendUploadUrl(fileName),
    storage_disk: "local",
    storage_path: storagePath,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: buffer.length,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

export function sanitizeContentPayload(payload = {}) {
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
    // Curation signal only (not a public fact, never shown on the public site) — trusted as-is since
    // this is the same token-authenticated collector-to-backend sync boundary CTA already crosses;
    // shape is already validated upstream against the taxonomy catalog before it reaches here.
    confirmed_taxonomy_checks: payload.confirmed_taxonomy_checks && typeof payload.confirmed_taxonomy_checks === "object" && !Array.isArray(payload.confirmed_taxonomy_checks)
      ? payload.confirmed_taxonomy_checks
      : null,
  };
}

function assertUtf8ByteLength(value, maxBytes, field) {
  const byteLength = Buffer.byteLength(String(value || ""), "utf8");
  if (byteLength > maxBytes) {
    throw new Error(`${field} is too large (${byteLength} bytes; max ${maxBytes})`);
  }
}

export function sanitizeReviewTranslations(rawTranslations, sourceLang) {
  if (rawTranslations == null) return [];
  if (!Array.isArray(rawTranslations)) throw new Error("translations must be an array");

  const normalizedSourceLang = String(sourceLang || "th").trim().toLowerCase() || "th";
  const seenLangs = new Set();
  return rawTranslations.map((rawRow, index) => {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      throw new Error(`translations[${index}] must be an object`);
    }
    const lang = String(rawRow.lang || "").trim().toLowerCase();
    if (!SUPPORTED_CONTENT_LANGS.includes(lang)) {
      throw new Error(`translations[${index}].lang must be one of: ${SUPPORTED_CONTENT_LANGS.join(", ")}`);
    }
    if (lang === normalizedSourceLang) {
      throw new Error(`translations[${index}].lang must not match content.lang (${normalizedSourceLang})`);
    }
    if (seenLangs.has(lang)) throw new Error(`translations contains duplicate lang: ${lang}`);
    seenLangs.add(lang);

    const fieldPrefix = `translations[${lang}]`;
    const title = cleanPlainText(rawRow.title, { required: true, max: 255, field: `${fieldPrefix}.title` });
    const excerpt = cleanPlainText(rawRow.excerpt, { required: false, max: 40000, field: `${fieldPrefix}.excerpt` }) || null;
    const body = cleanRichText(rawRow.body, { required: true, max: 40000, field: `${fieldPrefix}.body` });
    const metaTitle = cleanPlainText(rawRow.meta_title, { required: false, max: 255, field: `${fieldPrefix}.meta_title` }) || null;
    const metaDescription = cleanPlainText(rawRow.meta_description, { required: false, max: 320, field: `${fieldPrefix}.meta_description` }) || null;

    assertUtf8ByteLength(excerpt, PUBLIC_TRANSLATION_TEXT_MAX_BYTES, `${fieldPrefix}.excerpt`);
    assertUtf8ByteLength(body, PUBLIC_TRANSLATION_TEXT_MAX_BYTES, `${fieldPrefix}.body`);
    assertUtf8ByteLength(metaDescription, PUBLIC_TRANSLATION_META_DESCRIPTION_MAX_BYTES, `${fieldPrefix}.meta_description`);

    return {
      lang,
      title,
      excerpt,
      body,
      meta_title: metaTitle,
      meta_description: metaDescription,
    };
  });
}

function hasOwnContentField(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

export function mergeExistingReviewContentCtaFields(existingRow = {}, content = {}, rawContentPayload = {}) {
  const existing = existingRow && typeof existingRow === "object" ? existingRow : {};
  const raw = rawContentPayload && typeof rawContentPayload === "object" ? rawContentPayload : {};
  return {
    phone: hasOwnContentField(raw, "phone") ? content.phone : (existing.phone ?? null),
    line_url: hasOwnContentField(raw, "line_url") ? content.line_url : (existing.line_url ?? null),
    facebook_url: hasOwnContentField(raw, "facebook_url") ? content.facebook_url : (existing.facebook_url ?? null),
    website_url: hasOwnContentField(raw, "website_url") ? content.website_url : (existing.website_url ?? null),
    primary_cta: hasOwnContentField(raw, "primary_cta") ? content.primary_cta : (existing.primary_cta ?? null),
  };
}

export function mergeExistingReviewContentPublicEntityIdentity(existingRow = {}, content = {}) {
  const nextType = String(content?.public_entity_type || "").trim().toLowerCase();
  const nextId = Number(content?.public_entity_id || 0) || 0;
  if (nextType === content?.content_type && nextId > 0) {
    return { public_entity_type: nextType, public_entity_id: nextId };
  }

  const existingType = String(existingRow?.public_entity_type || "").trim().toLowerCase();
  const existingId = Number(existingRow?.public_entity_id || 0) || 0;
  if (existingType === content?.content_type && existingId > 0) {
    return { public_entity_type: existingType, public_entity_id: existingId };
  }

  return { public_entity_type: null, public_entity_id: null };
}

function parseExistingReviewPayload(reviewPayloadJson) {
  try {
    const parsed = JSON.parse(reviewPayloadJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Same omit-vs-clear contract as mergeExistingReviewContentCtaFields: an ingest that never sent
// confirmed_taxonomy_checks at all (draft not yet reviewer-confirmed, or an event item) must not
// wipe out what a previous accepted round already stored in review_payload_json.
export function mergeExistingReviewContentTaxonomyChecks(existingRow = {}, content = {}, rawContentPayload = {}) {
  const raw = rawContentPayload && typeof rawContentPayload === "object" ? rawContentPayload : {};
  if (hasOwnContentField(raw, "confirmed_taxonomy_checks")) {
    return content.confirmed_taxonomy_checks && typeof content.confirmed_taxonomy_checks === "object"
      ? content.confirmed_taxonomy_checks
      : {};
  }
  const existingPayload = parseExistingReviewPayload(existingRow?.review_payload_json);
  return existingPayload.confirmed_taxonomy_checks && typeof existingPayload.confirmed_taxonomy_checks === "object"
    ? existingPayload.confirmed_taxonomy_checks
    : {};
}

function buildReviewPayloadJson(content, confirmedTaxonomyChecks) {
  const payload = { snapshot_meta: { translation_langs: content.translation_langs } };
  if (confirmedTaxonomyChecks && Object.keys(confirmedTaxonomyChecks).length) {
    payload.confirmed_taxonomy_checks = confirmedTaxonomyChecks;
  }
  return JSON.stringify(payload);
}

export function buildReviewContentInsertParams({
  sourceSystem,
  sourceContentItemId,
  sourceSubmissionId = null,
  sourceManifestHash = null,
  content,
  currentBatchUid,
} = {}) {
  return [
    sourceSystem, sourceContentItemId, sourceSubmissionId, sourceManifestHash, content.content_type, "pending_review", content.lang, content.category,
    content.title, content.body, content.excerpt, content.meta_title, content.meta_description,
    content.event_period_text, content.location_text, content.latitude, content.longitude, content.map_url,
    content.google_place_id, content.transport_subtype, content.transport_contact_name, content.transport_contact_phone,
    content.phone, content.line_url, content.facebook_url, content.website_url, content.primary_cta, content.tracking_entity_type, content.tracking_entity_id,
    content.transport_contact_details, content.transport_link_url, content.slug, content.slug ? 1 : 0,
    content.public_entity_type, content.public_entity_id, currentBatchUid,
    buildReviewPayloadJson(content, content.confirmed_taxonomy_checks),
  ];
}

export function buildReviewContentUpdateParams({
  existing = null,
  content,
  rawContentPayload,
  currentBatchUid,
  reviewContentId,
  sourceSubmissionId = null,
  sourceManifestHash = null,
} = {}) {
  const preservedCtaFields = mergeExistingReviewContentCtaFields(existing, content, rawContentPayload);
  const confirmedTaxonomyChecks = mergeExistingReviewContentTaxonomyChecks(existing, content, rawContentPayload);
  const publicEntityIdentity = mergeExistingReviewContentPublicEntityIdentity(existing, content);
  return [
    sourceSubmissionId, sourceManifestHash, content.lang, content.category, content.title, content.body, content.excerpt, content.meta_title, content.meta_description,
    content.event_period_text, content.location_text, content.latitude, content.longitude, content.map_url, content.google_place_id,
    content.transport_subtype, content.transport_contact_name, content.transport_contact_phone, preservedCtaFields.phone, preservedCtaFields.line_url, preservedCtaFields.facebook_url, preservedCtaFields.website_url,
    preservedCtaFields.primary_cta, content.tracking_entity_type, content.tracking_entity_id, content.transport_contact_details,
    content.transport_link_url, content.slug, content.slug ? 1 : 0, publicEntityIdentity.public_entity_type, publicEntityIdentity.public_entity_id,
    currentBatchUid, buildReviewPayloadJson(content, confirmedTaxonomyChecks),
    reviewContentId,
  ];
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

export function isRetryableReviewSubmission(
  existing = {},
  sourceSubmissionId = null,
  sourceManifestHash = null,
  reviewReadyAssetCount = 0,
  expectedTranslations = [],
  reviewReadyTranslations = [],
) {
  const currentSubmissionId = String(existing?.source_submission_id || "").trim();
  const currentManifestHash = String(existing?.source_manifest_hash || "").trim().toLowerCase();
  const expectedLangs = [...new Set((Array.isArray(expectedTranslations) ? expectedTranslations : [])
    .map((row) => String(row?.lang || row || "").trim().toLowerCase())
    .filter(Boolean))].sort();
  const readyLangs = [...new Set((Array.isArray(reviewReadyTranslations) ? reviewReadyTranslations : [])
    .map((row) => String(row?.lang || row || "").trim().toLowerCase())
    .filter(Boolean))].sort();
  return Boolean(
    sourceSubmissionId
    && sourceManifestHash
    && currentSubmissionId === String(sourceSubmissionId).trim()
    && currentManifestHash === String(sourceManifestHash).trim().toLowerCase()
    && Number(reviewReadyAssetCount || 0) > 0
    && JSON.stringify(expectedLangs) === JSON.stringify(readyLangs)
  );
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectBodyMediaRewriteCandidates(row = {}, sourceBaseUrl) {
  const candidates = new Set();
  const sourceUrl = String(row?.source_url || "").trim();
  const resolvedSourceUrl = String(row?.resolved_source_url || "").trim();
  const backendUrl = String(row?.backend_url || "").trim();

  const push = (value) => {
    const text = String(value || "").trim();
    if (!text || text === backendUrl) return;
    candidates.add(text);
  };

  const pushUploadPathAliases = (pathname, origin = "") => {
    const rawPath = String(pathname || "").trim();
    if (!rawPath) return;
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath.replace(/^\/+/, "")}`;
    let uploadsPath = "";
    let mediaUploadsPath = "";
    if (/^\/uploads\//i.test(normalizedPath)) {
      uploadsPath = normalizedPath;
      mediaUploadsPath = `/media${normalizedPath}`;
    } else if (/^\/media\/uploads\//i.test(normalizedPath)) {
      mediaUploadsPath = normalizedPath;
      uploadsPath = normalizedPath.replace(/^\/media/i, "");
    } else {
      return;
    }

    push(uploadsPath);
    push(mediaUploadsPath);
    const normalizedOrigin = String(origin || "").trim().replace(/\/+$/, "");
    if (normalizedOrigin) {
      push(`${normalizedOrigin}${uploadsPath}`);
      push(`${normalizedOrigin}${mediaUploadsPath}`);
    }
  };

  const pushUploadsAliases = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      const parsed = new URL(text);
      push(parsed.toString());
      pushUploadPathAliases(parsed.pathname, parsed.origin);
    } catch {
      pushUploadPathAliases(text, "");
    }
  };

  push(sourceUrl);
  push(resolvedSourceUrl);
  pushUploadsAliases(sourceUrl);
  pushUploadsAliases(resolvedSourceUrl);
  if (sourceUrl && sourceBaseUrl) {
    try {
      const normalizedPath = sourceUrl.startsWith("/") ? sourceUrl : `/${sourceUrl.replace(/^\/+/, "")}`;
      push(new URL(normalizedPath, `${sourceBaseUrl}/`).toString());
    } catch {
      // Ignore invalid URL reconstruction.
    }
  }
  return [...candidates];
}

function rewriteImgTagSrcByAssetIdentity(html, mirroredRows = []) {
  const markup = String(html || "");
  if (!markup || !Array.isArray(mirroredRows) || !mirroredRows.length) return markup;

  const byAssetId = new Map();
  const byClientMediaUid = new Map();
  for (const row of mirroredRows) {
    const backendUrl = String(row?.backend_url || "").trim();
    if (!backendUrl) continue;
    const sourceAssetId = Number(row?.source_asset_id || 0) || 0;
    const clientMediaUid = String(row?.client_media_uid || "").trim();
    if (sourceAssetId > 0 && !byAssetId.has(String(sourceAssetId))) byAssetId.set(String(sourceAssetId), backendUrl);
    if (clientMediaUid && !byClientMediaUid.has(clientMediaUid)) byClientMediaUid.set(clientMediaUid, backendUrl);
  }

  return markup.replace(/<img\b[^>]*>/gi, (tag) => {
    const assetIdMatch = tag.match(/\bdata-asset-id\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const uidMatch = tag.match(/\bdata-client-media-uid\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const srcMatch = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!srcMatch) return tag;

    const assetId = String(assetIdMatch?.[2] || assetIdMatch?.[3] || assetIdMatch?.[4] || "").trim();
    const clientMediaUid = String(uidMatch?.[2] || uidMatch?.[3] || uidMatch?.[4] || "").trim();
    const backendUrl = (assetId && byAssetId.get(assetId)) || (clientMediaUid && byClientMediaUid.get(clientMediaUid)) || "";
    if (!backendUrl) return tag;

    return tag.replace(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i, `src="${backendUrl}"`);
  });
}

export function rewriteBodyMediaToBackendUrls(html, mirroredRows = [], sourceBaseUrl) {
  let output = rewriteImgTagSrcByAssetIdentity(html, mirroredRows);
  if (!output || !mirroredRows.length) return output;
  for (const row of mirroredRows) {
    const backendUrl = String(row?.backend_url || "").trim();
    if (!backendUrl) continue;
    const sortedCandidates = collectBodyMediaRewriteCandidates(row, sourceBaseUrl)
      .sort((left, right) => String(right || "").length - String(left || "").length);
    for (const candidate of sortedCandidates) {
      output = output.replace(new RegExp(escapeRegExp(candidate), "g"), backendUrl);
    }
  }
  return output;
}

export async function ingestReviewContent(payload, options = {}) {
  const sourceSystem = cleanPlainText(payload?.source_system, { required: true, field: "source_system", max: 64 }).toLowerCase();
  const sourceContentItemId = Number(payload?.source_content_item_id || 0);
  if (!Number.isFinite(sourceContentItemId) || sourceContentItemId <= 0) {
    throw new Error("source_content_item_id must be positive");
  }
  const sourceBaseUrl = normalizeBaseUrl(payload?.source_base_url);
  const sourceSubmissionId = String(payload?.source_submission_id || "").trim() || null;
  const sourceManifestHash = String(payload?.source_manifest_hash || "").trim().toLowerCase() || null;
  if ((sourceSubmissionId && !/^[a-f0-9-]{36}$/i.test(sourceSubmissionId)) || (sourceManifestHash && !/^[a-f0-9]{64}$/.test(sourceManifestHash))) {
    throw new Error("invalid review submission snapshot provenance");
  }
  const rawContentPayload = payload?.content && typeof payload.content === "object" ? payload.content : {};
  const content = sanitizeContentPayload(rawContentPayload);
  const translations = sanitizeReviewTranslations(payload?.translations, content.lang);
  const mediaQueue = flattenMediaManifest(payload?.media_manifest || {});
  const uploadedFiles = Array.isArray(options?.uploadedFiles) ? options.uploadedFiles : [];
  const uploadedFileMap = buildUploadedFileMap(uploadedFiles, options?.mediaIndex || null);
  const multipartMode = Boolean(options?.multipart);
  const currentBatchUid = crypto.randomUUID();

  const [existingRows] = await pool.query(
    `SELECT id, status, current_batch_uid, review_payload_json, source_submission_id, source_manifest_hash,
            public_entity_type, public_entity_id,
            phone, line_url, facebook_url, website_url, primary_cta
     FROM review_contents
     WHERE source_system=? AND source_content_item_id=? AND content_type=?
     LIMIT 1`,
    [sourceSystem, sourceContentItemId, content.content_type]
  );
  const existing = existingRows.length ? existingRows[0] : null;

  if (existing && sourceSubmissionId && sourceManifestHash) {
    const [readyAssetRows] = await pool.query(
      `SELECT usage_type, COUNT(*) AS count
       FROM review_content_assets
       WHERE review_content_id=? AND batch_uid=? AND status='review_ready'
       GROUP BY usage_type`,
      [Number(existing.id || 0), String(existing.current_batch_uid || "").trim()]
    );
    const readyAssetCount = (Array.isArray(readyAssetRows) ? readyAssetRows : [])
      .reduce((total, row) => total + (Number(row?.count || 0) || 0), 0);
    const [readyTranslationRows] = await pool.query(
      `SELECT lang
       FROM review_content_translations
       WHERE review_content_id=? AND batch_uid=? AND status='review_ready'`,
      [Number(existing.id || 0), String(existing.current_batch_uid || "").trim()]
    );
    if (isRetryableReviewSubmission(
      existing,
      sourceSubmissionId,
      sourceManifestHash,
      readyAssetCount,
      translations,
      readyTranslationRows,
    )) {
      const counts = { cover: 0, gallery: 0, inline: 0 };
      for (const row of readyAssetRows) {
        const usageType = normalizeRole(row?.usage_type, "gallery");
        counts[usageType] = Number(row?.count || 0) || 0;
      }
      return {
        id: Number(existing.id || 0) || 0,
        status: String(existing.status || "pending_review").trim().toLowerCase() || "pending_review",
        content_type: content.content_type,
        source_content_item_id: sourceContentItemId,
        current_batch_uid: String(existing.current_batch_uid || "").trim(),
        asset_counts: counts,
        retry: true,
      };
    }
  }

  const connection = await pool.getConnection();
  const mirroredRows = [];
  const mediaDiagnostics = [];
  try {
    await connection.beginTransaction();

    let reviewContentId;
    if (!existing) {
      const [insertResult] = await connection.query(
        `INSERT INTO review_contents (
          source_system, source_content_item_id, source_submission_id, source_manifest_hash, content_type, status, lang, category, title, body, excerpt,
          meta_title, meta_description, event_period_text, location_text, latitude, longitude, map_url,
          google_place_id, transport_subtype, transport_contact_name, transport_contact_phone, phone, line_url, facebook_url, website_url, primary_cta,
          tracking_entity_type, tracking_entity_id,
          transport_contact_details, transport_link_url, slug, slug_locked, public_entity_type, public_entity_id,
          current_batch_uid, review_payload_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        buildReviewContentInsertParams({
          sourceSystem,
          sourceContentItemId,
          sourceSubmissionId,
          sourceManifestHash,
          content,
          currentBatchUid,
        })
      );
      reviewContentId = Number(insertResult.insertId || 0) || 0;
    } else {
      reviewContentId = Number(existing.id || 0) || 0;
      await cleanupUnpublishedBatchAssets(reviewContentId, existing.current_batch_uid, connection);
      await cleanupUnpublishedBatchTranslations(reviewContentId, existing.current_batch_uid, connection);
      await connection.query(
        `UPDATE review_contents
          SET status='pending_review', source_submission_id=?, source_manifest_hash=?, lang=?, category=?, title=?, body=?, excerpt=?, meta_title=?, meta_description=?,
             event_period_text=?, location_text=?, latitude=?, longitude=?, map_url=?, google_place_id=?,
             transport_subtype=?, transport_contact_name=?, transport_contact_phone=?, phone=?, line_url=?, facebook_url=?, website_url=?, primary_cta=?,
             tracking_entity_type=?, tracking_entity_id=?, transport_contact_details=?,
             transport_link_url=?, slug=?, slug_locked=?, public_entity_type=?, public_entity_id=?,
             current_batch_uid=?, review_payload_json=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        buildReviewContentUpdateParams({
          existing,
          content,
          rawContentPayload,
            currentBatchUid,
            reviewContentId,
            sourceSubmissionId,
            sourceManifestHash,
        })
      );
    }

    for (const mediaRow of mediaQueue) {
      const sourceUrl = cleanUrl(mediaRow?.entry?.source_url, { required: true, field: "media_manifest.source_url" });
      const usageType = normalizeRole(mediaRow.usage_type, "gallery");
      const clientMediaUid = normalizeClientMediaUid(mediaRow?.entry?.client_media_uid || mediaRow?.entry?.clientMediaUid);
      const upload = clientMediaUid ? uploadedFileMap.get(clientMediaUid) : null;
      const diagnosticsRow = {
        client_media_uid: clientMediaUid,
        source_url: sourceUrl,
        has_upload: Boolean(upload),
        stored_backend_url: null,
        failure_reason: null,
      };
      let mirrored;
      if (upload) {
        mirrored = await storeUploadedImageToBackendStorage(upload, sourceUrl, sourceBaseUrl, clientMediaUid);
      } else if (multipartMode) {
        const failureReason = isCollectorHostedMediaUrl(sourceUrl, sourceBaseUrl)
          ? "collector_media_requires_binary_upload"
          : "multipart_media_requires_binary_upload";
        diagnosticsRow.failure_reason = failureReason;
        mediaDiagnostics.push(diagnosticsRow);
        throw buildClientError(
          failureReason === "collector_media_requires_binary_upload"
            ? "collector media requires binary upload"
            : "external media requires binary upload in multipart ingest",
          {
            media_entry_count: mediaQueue.length,
            media_entries: mediaDiagnostics,
          }
        );
      } else {
        mirrored = await mirrorImageToBackendStorage(sourceUrl, sourceBaseUrl);
      }
      mirrored.source_asset_id = Number(mediaRow?.entry?.source_asset_id || 0) || null;
      mirrored.client_media_uid = clientMediaUid || null;
      mirroredRows.push(mirrored);
      diagnosticsRow.stored_backend_url = String(mirrored?.backend_url || "").trim() || null;
      mediaDiagnostics.push(diagnosticsRow);
      await connection.query(
        `INSERT INTO review_content_assets (
          review_content_id, batch_uid, usage_type, position, source_url, resolved_source_url, backend_url,
          storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, caption, source_asset_id, source_submission_id, status, asset_origin
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          reviewContentId, currentBatchUid, usageType, Number(mediaRow.position || 0),
          mirrored.source_url, mirrored.resolved_source_url, mirrored.backend_url,
          mirrored.storage_disk, mirrored.storage_path, mirrored.file_name, mirrored.mime_type,
          mirrored.size_bytes, mirrored.checksum, String(mediaRow?.entry?.caption || "").trim() || null,
          mirrored.source_asset_id, sourceSubmissionId, "review_ready", "collector_import",
        ]
      );
    }

    for (const translation of translations) {
      await connection.query(
        `INSERT INTO review_content_translations (
          review_content_id, batch_uid, lang, title, excerpt, body, meta_title, meta_description,
          source_submission_id, status
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          reviewContentId,
          currentBatchUid,
          translation.lang,
          translation.title,
          translation.excerpt,
          translation.body,
          translation.meta_title,
          translation.meta_description,
          sourceSubmissionId,
          "review_ready",
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
        source_submission_id: sourceSubmissionId,
        source_manifest_hash: sourceManifestHash,
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
      ...(isDebugDiagnosticsEnabled() ? {
        media_diagnostics: {
          media_entry_count: mediaQueue.length,
          media_entries: mediaDiagnostics,
        },
      } : {}),
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
    if (isDebugDiagnosticsEnabled() && (!err.diagnostics || typeof err.diagnostics !== "object")) {
      err.diagnostics = {
        media_entry_count: mediaQueue.length,
        media_entries: mediaDiagnostics,
      };
    }
    throw err;
  } finally {
    connection.release();
  }
}
