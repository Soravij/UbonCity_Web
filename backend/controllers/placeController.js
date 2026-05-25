import pool from "../config/db.js";
import jwt from "jsonwebtoken";
import { validateCreatePlacePayload, validateUpdatePlacePayload } from "../validators/placeValidator.js";
import { LIMITS } from "../validators/inputSanitizer.js";
import { normalizeContentLang } from "../constants/languages.js";
import { markCollectorImportReviewApprovedByEntity } from "../services/collectorImportReviewService.js";
import { assertNoEmerConflictForPublish } from "../services/publishGuardService.js";
import { purgePlace as purgePlaceEntity } from "../services/purgeContentService.js";

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
let ensuredApprovalColumn = false;
const DECISION_COLUMN_DEFINITIONS = [
  "decision_featured_score INT NULL DEFAULT NULL",
  "decision_scenario_tags VARCHAR(500) NULL",
  "decision_trend_flags VARCHAR(500) NULL",
  "decision_moment_tags VARCHAR(500) NULL",
  "decision_insight_flags VARCHAR(500) NULL",
  "decision_cover_image VARCHAR(1200) NULL",
  "decision_thumbnail_image VARCHAR(1200) NULL",
  "latitude DECIMAL(10,7) NULL",
  "longitude DECIMAL(10,7) NULL",
  "map_url VARCHAR(1200) NULL",
  "google_place_id VARCHAR(255) NULL",
  "transport_subtype VARCHAR(64) NULL",
  "transport_contact_name VARCHAR(255) NULL",
  "transport_contact_phone VARCHAR(120) NULL",
  "transport_contact_details TEXT NULL",
  "transport_link_url VARCHAR(1200) NULL",
];

function hasPrivilegedPreviewAccess(req) {
  try {
    const authHeader = String(req.headers?.authorization || "").trim();
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return false;

    const decoded = jwt.verify(match[1], JWT_SECRET);
    const role = String(decoded?.role || "").toLowerCase();
    return role === "owner" || role === "admin";
  } catch {
    return false;
  }
}

function normalizeSlugInput(rawSlug) {
  const value = String(rawSlug || "").trim();
  return value || null;
}

function fallbackSlugById(id) {
  return `place-${Number(id)}`;
}

async function ensureApprovalColumn() {
  if (ensuredApprovalColumn) return;

  const [columns] = await pool.query("SHOW COLUMNS FROM places LIKE 'is_approved'");
  if (columns.length === 0) {
    await pool.query("ALTER TABLE places ADD COLUMN is_approved TINYINT(1) NOT NULL DEFAULT 0");
  }

  for (const definition of DECISION_COLUMN_DEFINITIONS) {
    const name = String(definition).split(/\s+/)[0];
    const [decisionColumns] = await pool.query("SHOW COLUMNS FROM places LIKE ?", [name]);
    if (!decisionColumns.length) {
      await pool.query(`ALTER TABLE places ADD COLUMN ${definition}`);
    }
  }

  ensuredApprovalColumn = true;
}

async function getCategoryIdBySlug(categorySlug) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE slug=? LIMIT 1", [categorySlug]);
  return rows.length ? rows[0].id : null;
}

async function getExistingTranslation(placeId, lang) {
  const [rows] = await pool.query(
    "SELECT id FROM place_translations WHERE place_id=? AND lang=? LIMIT 1",
    [placeId, lang]
  );

  return rows.length ? rows[0].id : null;
}

async function ensureFallbackSlug(placeId) {
  const numericId = Number(placeId);
  if (!Number.isFinite(numericId)) return;

  await pool.query(
    "UPDATE places SET slug=COALESCE(NULLIF(TRIM(slug), ''), ?) WHERE id=?",
    [fallbackSlugById(numericId), numericId]
  );
}

function extractImageMarkdownBlocks(text) {
  const source = String(text || "");
  const regex = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  const blocks = [];

  for (const match of source.matchAll(regex)) {
    const full = String(match?.[0] || "").trim();
    const url = String(match?.[1] || "").trim();
    if (!full || !url) continue;
    blocks.push({ full, url });
  }

  return blocks;
}

function mergeDescriptionWithThaiImages(requestedDescription, thaiDescription, lang) {
  const req = String(requestedDescription || "").trim();
  const th = String(thaiDescription || "").trim();

  if (lang === "th") return req || th;

  const thaiImages = extractImageMarkdownBlocks(th);
  if (!thaiImages.length) return req || th;

  const reqImages = extractImageMarkdownBlocks(req);
  if (reqImages.length >= thaiImages.length) return req || th;

  const reqUrls = new Set(reqImages.map((item) => item.url));
  const missingBlocks = thaiImages
    .filter((item) => !reqUrls.has(item.url))
    .map((item) => item.full);

  if (!missingBlocks.length) return req || th;
  if (!req) return `${th}\n\n${missingBlocks.join("\n\n")}`;

  return `${req}\n\n${missingBlocks.join("\n\n")}`;
}

function extractPlainTextForMeta(value) {
  return String(value || "")
    .replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    const next = line[i + 1];
    if (c === '"' && quoted && next === '"') {
      cur += '"';
      i += 1;
      continue;
    }
    if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function resolveMetaDescription(metaDescription, description) {
  const direct = extractPlainTextForMeta(metaDescription);
  if (direct && direct.length <= 160) return direct;

  const source = extractPlainTextForMeta(description);
  if (!source) return direct ? direct.slice(0, 160) : null;

  if (source.length <= 160) return source;
  const clipped = source.slice(0, 157).trimEnd();
  return `${clipped}...`;
}

function parseTagList(rawValue) {
  const tokens = String(rawValue || "")
    .split(/[,\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, 24);
}

function hasUsableCoordinates(row) {
  return Number.isFinite(Number(row?.latitude)) && Number.isFinite(Number(row?.longitude));
}

function normalizeNearbyLimit(value, fallback = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(12, Math.floor(n)));
}

const NEARBY_RANGE = Object.freeze({
  within10: "within_10km",
  within20: "within_20km",
  none: "none",
});

function hasLocationPatch(latitude, longitude, mapUrl, googlePlaceId) {
  return (
    latitude !== null ||
    longitude !== null ||
    Boolean(String(mapUrl || "").trim()) ||
    Boolean(String(googlePlaceId || "").trim())
  );
}

function buildNearbyDistanceSql() {
  return `
    (
      6371 * ACOS(
        LEAST(
          1,
          GREATEST(
            -1,
            COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * COS(RADIANS(p.longitude) - RADIANS(?)) +
            SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
          )
        )
      )
    )
  `;
}

async function resolveNearbyOrigin(category, slug) {
  const [rows] = await pool.query(
    `SELECT
       p.id,
       p.category_id,
       p.latitude,
       p.longitude
     FROM places p
     JOIN categories c ON c.id = p.category_id
     WHERE c.slug=? AND p.slug=? AND p.is_approved=1
     LIMIT 1`,
    [category, slug]
  );
  if (rows.length) return rows[0];

  const fallbackMatch = String(slug || "").match(/^place-(\d+)$/);
  if (!fallbackMatch) return null;

  const fallbackId = Number(fallbackMatch[1]);
  if (!Number.isFinite(fallbackId) || fallbackId <= 0) return null;

  const [fallbackRows] = await pool.query(
    `SELECT
       p.id,
       p.category_id,
       p.latitude,
       p.longitude
     FROM places p
     JOIN categories c ON c.id = p.category_id
     WHERE c.slug=? AND p.id=? AND p.is_approved=1
     LIMIT 1`,
    [category, fallbackId]
  );
  return fallbackRows.length ? fallbackRows[0] : null;
}

async function fetchNearbyCandidates(req, {
  lang,
  origin,
  limit,
  categoryId = null,
  excludeIds = [],
} = {}) {
  const normalizedExcludeIds = Array.from(
    new Set((Array.isArray(excludeIds) ? excludeIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  const distanceSql = buildNearbyDistanceSql();
  const whereParts = [
    "p.id<>?",
    "p.is_approved=1",
    "p.latitude IS NOT NULL",
    "p.longitude IS NOT NULL",
    "(pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)",
  ];
  const params = [
    lang,
    Number(origin.latitude),
    Number(origin.longitude),
    Number(origin.latitude),
    lang,
    Number(origin.id),
  ];

  if (Number.isFinite(Number(categoryId)) && Number(categoryId) > 0) {
    whereParts.push("p.category_id=?");
    params.push(Number(categoryId));
  }

  if (normalizedExcludeIds.length) {
    whereParts.push(`p.id NOT IN (${normalizedExcludeIds.map(() => "?").join(",")})`);
    params.push(...normalizedExcludeIds);
  }

  params.push(Number(limit));

  const [rows] = await pool.query(
    `SELECT
       p.id,
       c.slug AS category,
       ? AS lang,
       COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
       COALESCE(pt_req.title, pt_th.title) AS title,
       COALESCE(pt_req.description, pt_th.description) AS description,
       pt_req.description AS req_description,
       pt_th.description AS th_description,
       COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
       COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description,
       p.image,
       p.latitude,
       p.longitude,
       p.map_url,
       p.google_place_id,
       p.transport_subtype,
       p.transport_contact_name,
       p.transport_contact_phone,
       p.transport_contact_details,
       p.transport_link_url,
       p.is_approved,
       p.decision_featured_score,
       p.decision_scenario_tags,
       p.decision_trend_flags,
       p.decision_moment_tags,
       p.decision_insight_flags,
       p.decision_cover_image,
       p.decision_thumbnail_image,
       ${distanceSql} AS distance_km
     FROM places p
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
     LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
     WHERE ${whereParts.join(" AND ")}
     ORDER BY distance_km ASC, p.id DESC
     LIMIT ?`,
    params
  );

  const mediaMap = await loadApprovedPlaceMediaMap(req, rows.map((row) => row.id));
  const items = rows.map((row) =>
    normalizePlaceForResponse(
      req,
      {
        ...row,
        description: mergeDescriptionWithThaiImages(row?.req_description, row?.th_description, lang),
        distance_km: Number.isFinite(Number(row?.distance_km)) ? Number(row.distance_km) : null,
      },
      mediaMap.get(Number(row.id))
    )
  );

  for (const item of items) {
    delete item.req_description;
    delete item.th_description;
  }

  return items;
}

function buildMediaPublicUrl(req, asset) {
  const storageDisk = String(asset?.storage_disk || "").trim().toLowerCase();
  const sourceUrl = String(asset?.source_url || "").trim();
  const fileName = String(asset?.file_name || "").trim();
  const storagePath = String(asset?.storage_path || "").trim().replace(/^\/+/, "");
  const configuredBase = String(process.env.BACKEND_PUBLIC_URL || "").trim();
  const base = configuredBase || `${req.protocol}://${req.get("host")}`;

  if (storageDisk === "external") return sourceUrl;
  if (fileName) return `${base}/uploads/${fileName}`;
  if (storagePath) return `${base}/${storagePath}`;
  return sourceUrl || "";
}

function resolveRequestBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function rewriteSelfHostedMediaUrl(req, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\/(?:media\/)?uploads\//i.test(raw)) {
    const normalizedPath = raw.replace(/^\/media\/uploads\//i, "/uploads/");
    return `${resolveRequestBaseUrl(req)}${normalizedPath}`;
  }
  if (/^uploads\//i.test(raw)) {
    return `${resolveRequestBaseUrl(req)}/${raw.replace(/^\/+/, "")}`;
  }
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").trim().toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1") return raw;
    return `${resolveRequestBaseUrl(req)}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

function rewriteSelfHostedHtmlMediaUrls(req, html) {
  const markup = String(html || "").trim();
  if (!markup) return markup;
  return markup.replace(
    /\b(src|href)\s*=\s*(["'])([^"'<>]+)\2/gi,
    (_match, attrName, quote, rawUrl) => {
      const rewritten = rewriteSelfHostedMediaUrl(req, rawUrl) || rawUrl;
      return `${attrName}=${quote}${rewritten}${quote}`;
    }
  );
}

async function loadApprovedPlaceMediaMap(req, placeIds) {
  const normalizedIds = Array.from(
    new Set((Array.isArray(placeIds) ? placeIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (!normalizedIds.length) return new Map();

  const placeholders = normalizedIds.map(() => "?").join(",");
  try {
    const [rows] = await pool.query(
      `SELECT
         ciu.entity_id AS place_id,
         ciu.usage_type,
         ciu.position,
         ma.source_url,
         ma.storage_disk,
         ma.file_name,
         ma.storage_path
       FROM content_image_usages ciu
       JOIN media_assets ma ON ma.id=ciu.asset_id
       WHERE ciu.entity_type='place'
         AND ciu.entity_id IN (${placeholders})
         AND ma.status='approved'
       ORDER BY ciu.entity_id ASC, ciu.usage_type ASC, ciu.position ASC, ciu.id ASC`,
      normalizedIds
    );

    const out = new Map();
    for (const row of rows) {
      const placeId = Number(row?.place_id || 0);
      if (!placeId) continue;

      const mediaUrl = buildMediaPublicUrl(req, row);
      if (!mediaUrl) continue;

      const usageType = String(row?.usage_type || "").trim().toLowerCase();
      const current = out.get(placeId) || { cover: null, gallery: [], inline: [] };

      if (usageType === "cover" && !current.cover) current.cover = mediaUrl;
      if (usageType === "gallery") current.gallery.push(mediaUrl);
      if (usageType === "inline") current.inline.push(mediaUrl);

      out.set(placeId, current);
    }

    return out;
  } catch (err) {
    const code = String(err?.code || "").toUpperCase();
    if (code === "ER_NO_SUCH_TABLE") return new Map();
    throw err;
  }
}

function normalizeDecisionAndMedia(row, media = { cover: null, gallery: [], inline: [] }) {
  const decisionFeaturedScore = Number(row?.decision_featured_score);
  const scenarioList = parseTagList(row?.decision_scenario_tags);
  const trendList = parseTagList(row?.decision_trend_flags);
  const momentList = parseTagList(row?.decision_moment_tags);
  const insightList = parseTagList(row?.decision_insight_flags);

  const mediaCoverImage = media?.cover || null;
  const mediaGalleryImages = Array.isArray(media?.gallery) ? media.gallery : [];
  const mediaInlineImages = Array.isArray(media?.inline) ? media.inline : [];

  const effectiveCover = row?.decision_cover_image || mediaCoverImage || row?.image || null;
  const effectiveThumb =
    row?.decision_thumbnail_image ||
    mediaGalleryImages[0] ||
    effectiveCover ||
    row?.image ||
    null;

  return {
    ...row,
    decision_featured_score: Number.isFinite(decisionFeaturedScore) ? decisionFeaturedScore : null,
    decision_scenario_tags_list: scenarioList,
    decision_trend_flags_list: trendList,
    decision_moment_tags_list: momentList,
    decision_insight_flags_list: insightList,
    media_cover_image: mediaCoverImage,
    media_gallery_images: mediaGalleryImages,
    media_inline_images: mediaInlineImages,
    effective_cover_image: effectiveCover,
    effective_thumbnail_image: effectiveThumb,
    transport_subtype: String(row?.transport_subtype || "").trim() || null,
    transport_contact_name: String(row?.transport_contact_name || "").trim() || null,
    transport_contact_phone: String(row?.transport_contact_phone || "").trim() || null,
    transport_contact_details: String(row?.transport_contact_details || "").trim() || null,
    transport_link_url: String(row?.transport_link_url || "").trim() || null,
  };
}

function normalizePlaceForResponse(req, row, media) {
  const normalized = normalizeDecisionAndMedia(row, media);
  return {
    ...normalized,
    image: rewriteSelfHostedMediaUrl(req, normalized.image),
    description: rewriteSelfHostedHtmlMediaUrls(req, normalized.description),
    decision_cover_image: rewriteSelfHostedMediaUrl(req, normalized.decision_cover_image),
    decision_thumbnail_image: rewriteSelfHostedMediaUrl(req, normalized.decision_thumbnail_image),
    media_cover_image: rewriteSelfHostedMediaUrl(req, normalized.media_cover_image),
    media_gallery_images: (Array.isArray(normalized.media_gallery_images) ? normalized.media_gallery_images : [])
      .map((entry) => rewriteSelfHostedMediaUrl(req, entry))
      .filter(Boolean),
    media_inline_images: (Array.isArray(normalized.media_inline_images) ? normalized.media_inline_images : [])
      .map((entry) => rewriteSelfHostedMediaUrl(req, entry))
      .filter(Boolean),
    effective_cover_image: rewriteSelfHostedMediaUrl(req, normalized.effective_cover_image),
    effective_thumbnail_image: rewriteSelfHostedMediaUrl(req, normalized.effective_thumbnail_image),
  };
}

function parseCsvText(csvText) {
  const raw = String(csvText || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => String(h || "").trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function normalizeImportRow(raw) {
  const row = raw || {};

  const validated = validateCreatePlacePayload({
    group_id: row.group_id,
    category: row.category,
    lang: row.lang || "th",
    slug: row.slug,
    title: row.title,
    description: row.description,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    image: row.image,
    decision_featured_score: row.decision_featured_score,
    decision_scenario_tags: row.decision_scenario_tags,
    decision_trend_flags: row.decision_trend_flags,
    decision_moment_tags: row.decision_moment_tags,
    decision_insight_flags: row.decision_insight_flags,
    decision_cover_image: row.decision_cover_image,
    decision_thumbnail_image: row.decision_thumbnail_image,
  });

  if (!validated.ok) {
    return { ok: false, reason: validated.error };
  }

  return {
    ok: true,
    value: {
      place_id: Number.isFinite(Number(row.place_id)) ? Number(row.place_id) : null,
      ...validated.value,
    },
  };
}

async function upsertPlaceFromSourceThai(row) {
  const normalizedWrap = normalizeImportRow(row);
  if (!normalizedWrap.ok) return { ok: false, reason: normalizedWrap.reason || "invalid row" };

  const normalized = normalizedWrap.value;

  if (normalized.lang !== "th") return { ok: false, reason: "only th source is allowed" };

  const categoryId = await getCategoryIdBySlug(normalized.category);
  if (!categoryId) return { ok: false, reason: `unknown category: ${normalized.category}` };

  let placeId = normalized.place_id || normalized.group_id || null;
  if (placeId) {
    const [existing] = await pool.query("SELECT id FROM places WHERE id=? LIMIT 1", [placeId]);
    if (!existing.length) placeId = null;
  }

  if (!placeId && normalized.slug) {
    const [bySlug] = await pool.query("SELECT id FROM places WHERE slug=? LIMIT 1", [normalized.slug]);
    if (bySlug.length) placeId = Number(bySlug[0].id);
  }

  let mode = "created";
  if (!placeId) {
    const [insertPlace] = await pool.query(
      `INSERT INTO places (
         category_id, slug, image, is_approved,
         decision_featured_score, decision_scenario_tags, decision_trend_flags,
         decision_moment_tags, decision_insight_flags, decision_cover_image, decision_thumbnail_image,
         latitude, longitude, map_url, google_place_id
       ) VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        categoryId,
        normalized.slug,
        normalized.image,
        normalized.decision_featured_score,
        normalized.decision_scenario_tags,
        normalized.decision_trend_flags,
        normalized.decision_moment_tags,
        normalized.decision_insight_flags,
        normalized.decision_cover_image,
        normalized.decision_thumbnail_image,
        normalized.latitude,
        normalized.longitude,
        normalized.map_url,
        normalized.google_place_id,
      ]
    );
    placeId = Number(insertPlace.insertId);
    if (!normalized.slug) await ensureFallbackSlug(placeId);
  } else {
    mode = "updated";
    await pool.query(
      `UPDATE places
       SET category_id=?, slug=COALESCE(?,slug), image=?, is_approved=0,
           decision_featured_score=?, decision_scenario_tags=?, decision_trend_flags=?,
           decision_moment_tags=?, decision_insight_flags=?, decision_cover_image=?, decision_thumbnail_image=?
       WHERE id=?`,
      [
        categoryId,
        normalized.slug,
        normalized.image,
        normalized.decision_featured_score,
        normalized.decision_scenario_tags,
        normalized.decision_trend_flags,
        normalized.decision_moment_tags,
        normalized.decision_insight_flags,
        normalized.decision_cover_image,
        normalized.decision_thumbnail_image,
        placeId,
      ]
    );
    if (hasLocationPatch(normalized.latitude, normalized.longitude, normalized.map_url, normalized.google_place_id)) {
      await pool.query(
        "UPDATE places SET latitude=?, longitude=?, map_url=?, google_place_id=? WHERE id=?",
        [normalized.latitude, normalized.longitude, normalized.map_url, normalized.google_place_id, placeId]
      );
    }
    if (!normalized.slug) await ensureFallbackSlug(placeId);
  }

  const existingTranslationId = await getExistingTranslation(placeId, "th");
  if (existingTranslationId) {
    await pool.query(
      `UPDATE place_translations
       SET title=?, description=?, meta_title=?, meta_description=?
       WHERE id=?`,
      [
        normalized.title,
        normalized.description,
        normalized.meta_title,
        resolveMetaDescription(normalized.meta_description, normalized.description),
        existingTranslationId,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO place_translations (place_id,lang,title,description,meta_title,meta_description)
       VALUES (?,?,?,?,?,?)`,
      [
        placeId,
        "th",
        normalized.title,
        normalized.description,
        normalized.meta_title,
        resolveMetaDescription(normalized.meta_description, normalized.description),
      ]
    );
  }

  return { ok: true, mode, place_id: placeId };
}
export const getPlaces = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const { category, lang, include_unapproved } = req.query;

    if (!category || !lang) {
      return res.json({ items: [] });
    }

    const includeUnapproved = String(include_unapproved || "") === "1" && hasPrivilegedPreviewAccess(req);
    const approvalFilter = includeUnapproved ? "" : "AND p.is_approved=1";
    const emerFilterRaw = String(req.query?.is_emer || "").trim();
    const emerFilter = emerFilterRaw === "1" ? 1 : emerFilterRaw === "0" ? 0 : null;
    const emerFilterClause = emerFilter === null ? "" : "AND p.is_emer=?";
    const queryParams = emerFilter === null ? [lang, lang, category] : [lang, lang, category, emerFilter];

    const [rows] = await pool.query(
      `SELECT
         p.id,
         c.slug AS category,
         ? AS lang,
         COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
         COALESCE(pt_req.title, pt_th.title) AS title,
         COALESCE(pt_req.description, pt_th.description) AS description,
         pt_req.description AS req_description,
         pt_th.description AS th_description,
         COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
         COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description,
         p.image,
       p.latitude,
       p.longitude,
       p.map_url,
       p.google_place_id,
       p.transport_subtype,
       p.transport_contact_name,
       p.transport_contact_phone,
       p.transport_contact_details,
        p.transport_link_url,
        p.is_approved,
        p.is_emer,
          p.decision_featured_score,
         p.decision_scenario_tags,
         p.decision_trend_flags,
         p.decision_moment_tags,
         p.decision_insight_flags,
         p.decision_cover_image,
         p.decision_thumbnail_image
       FROM places p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
       LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
        WHERE c.slug=? ${approvalFilter} ${emerFilterClause}
          AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
        ORDER BY p.id DESC`,
      queryParams
    );
    const mediaMap = await loadApprovedPlaceMediaMap(req, rows.map((row) => row.id));
    const items = rows.map((row) => normalizeDecisionAndMedia(row, mediaMap.get(Number(row.id))));

    res.json({ items });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPlaceDetail = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const { category, slug } = req.params;
    const { lang = "th", include_unapproved } = req.query;

    const includeUnapproved = String(include_unapproved || "") === "1" && hasPrivilegedPreviewAccess(req);

    const [rows] = await pool.query(
      `SELECT
         p.id,
         c.slug AS category,
         COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
         p.image,
         p.is_approved,
         p.decision_featured_score,
         p.decision_scenario_tags,
         p.decision_trend_flags,
         p.decision_moment_tags,
         p.decision_insight_flags,
         p.decision_cover_image,
         p.decision_thumbnail_image,
         ? AS lang,
         COALESCE(pt_req.title, pt_th.title) AS title,
         COALESCE(pt_req.description, pt_th.description) AS description,
         pt_req.description AS req_description,
         pt_th.description AS th_description,
         COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
         COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description
         ,
         p.latitude,
         p.longitude,
         p.map_url,
         p.google_place_id,
         p.transport_subtype,
         p.transport_contact_name,
         p.transport_contact_phone,
         p.transport_contact_details,
         p.transport_link_url
       FROM places p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
       LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
       WHERE c.slug=? AND p.slug=? ${includeUnapproved ? "" : "AND p.is_approved=1"}
         AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
       LIMIT 1`,
      [lang, lang, category, slug]
    );

    if (!rows.length) {
      const fallbackMatch = String(slug || "").match(/^place-(\d+)$/);
      if (fallbackMatch) {
        const fallbackId = Number(fallbackMatch[1]);
        const [fallbackRows] = await pool.query(
          `SELECT
             p.id,
             c.slug AS category,
             COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
             p.image,
             p.is_approved,
             p.decision_featured_score,
             p.decision_scenario_tags,
             p.decision_trend_flags,
             p.decision_moment_tags,
             p.decision_insight_flags,
             p.decision_cover_image,
             p.decision_thumbnail_image,
             ? AS lang,
             COALESCE(pt_req.title, pt_th.title) AS title,
             COALESCE(pt_req.description, pt_th.description) AS description,
         pt_req.description AS req_description,
         pt_th.description AS th_description,
             COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
             COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description,
             p.latitude,
             p.longitude,
             p.map_url,
             p.google_place_id,
             p.transport_subtype,
             p.transport_contact_name,
             p.transport_contact_phone,
             p.transport_contact_details,
             p.transport_link_url
           FROM places p
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
           LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
           WHERE c.slug=? AND p.id=? ${includeUnapproved ? "" : "AND p.is_approved=1"}
             AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
           LIMIT 1`,
          [lang, lang, category, fallbackId]
        );

        if (fallbackRows.length) {
          const mediaMap = await loadApprovedPlaceMediaMap(req, [fallbackRows[0].id]);
          const item = normalizePlaceForResponse(
            req,
            {
              ...fallbackRows[0],
              description: mergeDescriptionWithThaiImages(
                fallbackRows[0]?.req_description,
                fallbackRows[0]?.th_description,
                lang
              ),
            },
            mediaMap.get(Number(fallbackRows[0]?.id))
          );
          delete item.req_description;
          delete item.th_description;
          return res.json({ item });
        }
      }

      return res.status(404).json({ error: "Place not found" });
    }

    const mediaMap = await loadApprovedPlaceMediaMap(req, [rows[0].id]);
    const item = normalizePlaceForResponse(
      req,
      {
        ...rows[0],
        description: mergeDescriptionWithThaiImages(rows[0]?.req_description, rows[0]?.th_description, lang),
      },
      mediaMap.get(Number(rows[0]?.id))
    );
    delete item.req_description;
    delete item.th_description;

    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getNearbyPlaces = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const { category, slug } = req.params;
    const { lang = "th", limit } = req.query;
    const normalizedLimit = normalizeNearbyLimit(limit, 6);
    const origin = await resolveNearbyOrigin(category, slug);
    if (!origin || !hasUsableCoordinates(origin)) {
      return res.json({ items: [], range_key: NEARBY_RANGE.none });
    }

    const candidates = await fetchNearbyCandidates(req, {
      lang,
      origin,
      limit: 24,
    });
    const within10 = candidates.filter((item) => Number(item?.distance_km) <= 10).slice(0, normalizedLimit);
    if (within10.length) {
      return res.json({ items: within10, range_key: NEARBY_RANGE.within10 });
    }

    const within20 = candidates
      .filter((item) => Number(item?.distance_km) > 10 && Number(item?.distance_km) < 20)
      .slice(0, normalizedLimit);
    if (within20.length) {
      return res.json({ items: within20, range_key: NEARBY_RANGE.within20 });
    }

    return res.json({ items: [], range_key: NEARBY_RANGE.none });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const createPlace = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const validated = validateCreatePlacePayload(req.body || {});
    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }

    const {
      group_id,
      category,
      lang,
      slug,
      title,
      description,
      meta_title,
      meta_description,
      image,
      latitude,
      longitude,
      map_url,
      google_place_id,
      decision_featured_score,
      decision_scenario_tags,
      decision_trend_flags,
      decision_moment_tags,
      decision_insight_flags,
      decision_cover_image,
      decision_thumbnail_image,
    } = validated.value;
    const isEmer = Number(req.body?.is_emer || 0) === 1 ? 1 : 0;

    if (normalizeContentLang(lang, "th") !== "th") {
      return res.status(400).json({ error: "Only source language (th) is allowed in main write API" });
    }

    const categoryId = await getCategoryIdBySlug(category);
    if (!categoryId) {
      return res.status(400).json({ error: `Unknown category: ${category}` });
    }

    const normalizedSlug = normalizeSlugInput(slug);
    if (!isEmer) {
      await assertNoEmerConflictForPublish({
        entityType: "place",
        category,
        slug: normalizedSlug,
        title,
      });
    }
    let placeId = null;

    if (group_id && Number.isFinite(Number(group_id))) {
      const [existingPlace] = await pool.query("SELECT id FROM places WHERE id=? LIMIT 1", [Number(group_id)]);
      if (existingPlace.length) {
        placeId = existingPlace[0].id;
      }
    }

    if (!placeId) {
      const [insertPlace] = await pool.query(
        `INSERT INTO places (
           category_id, slug, image, is_approved, is_emer,
           decision_featured_score, decision_scenario_tags, decision_trend_flags,
           decision_moment_tags, decision_insight_flags, decision_cover_image, decision_thumbnail_image,
           latitude, longitude, map_url, google_place_id
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          categoryId,
          normalizedSlug,
          image || null,
          isEmer,
          isEmer ? 1 : 0,
          decision_featured_score,
          decision_scenario_tags,
          decision_trend_flags,
          decision_moment_tags,
          decision_insight_flags,
          decision_cover_image,
          decision_thumbnail_image,
          latitude,
          longitude,
          map_url,
          google_place_id,
        ]
      );
      placeId = insertPlace.insertId;
      if (!normalizedSlug) {
        await ensureFallbackSlug(placeId);
      }
    } else {
      await pool.query(
        `UPDATE places
         SET category_id=?, slug=COALESCE(?,slug), image=?, is_approved=?, is_emer=?,
             decision_featured_score=?, decision_scenario_tags=?, decision_trend_flags=?,
             decision_moment_tags=?, decision_insight_flags=?, decision_cover_image=?, decision_thumbnail_image=?
         WHERE id=?`,
        [
          categoryId,
          normalizedSlug,
          image || null,
          isEmer ? 1 : 0,
          isEmer,
          decision_featured_score,
          decision_scenario_tags,
          decision_trend_flags,
          decision_moment_tags,
          decision_insight_flags,
          decision_cover_image,
          decision_thumbnail_image,
          placeId,
        ]
      );
      if (hasLocationPatch(latitude, longitude, map_url, google_place_id)) {
        await pool.query(
          "UPDATE places SET latitude=?, longitude=?, map_url=?, google_place_id=? WHERE id=?",
          [latitude, longitude, map_url, google_place_id, placeId]
        );
      }
      if (!normalizedSlug) {
        await ensureFallbackSlug(placeId);
      }
    }

    const existingTranslationId = await getExistingTranslation(placeId, "th");

    if (existingTranslationId) {
      await pool.query(
        `UPDATE place_translations
         SET title=?, description=?, meta_title=?, meta_description=?
         WHERE id=?`,
        [title, description, meta_title || null, resolveMetaDescription(meta_description, description), existingTranslationId]
      );
    } else {
      await pool.query(
        `INSERT INTO place_translations
         (place_id,lang,title,description,meta_title,meta_description)
         VALUES (?,?,?,?,?,?)`,
        [placeId, "th", title, description, meta_title || null, resolveMetaDescription(meta_description, description)]
      );
    }

    res.json({ message: "Created", place_id: placeId });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updatePlace = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const placeId = Number(req.params?.id);
    if (!Number.isFinite(placeId) || placeId <= 0) {
      return res.status(400).json({ error: "Invalid place id" });
    }

    const validated = validateUpdatePlacePayload(req.body || {});
    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }

    const {
      lang,
      title,
      description,
      image,
      meta_title,
      meta_description,
      latitude,
      longitude,
      map_url,
      google_place_id,
      decision_featured_score,
      decision_scenario_tags,
      decision_trend_flags,
      decision_moment_tags,
      decision_insight_flags,
      decision_cover_image,
      decision_thumbnail_image,
    } = validated.value;
    const isEmer = Number(req.body?.is_emer || 0) === 1 ? 1 : 0;

    if (normalizeContentLang(lang, "th") !== "th") {
      return res.status(400).json({ error: "Only source language (th) is allowed in main write API" });
    }

    const [identityRows] = await pool.query(
      `SELECT p.id, p.slug, c.slug AS category
       FROM places p
       JOIN categories c ON c.id=p.category_id
       WHERE p.id=? LIMIT 1`,
      [placeId]
    );
    if (!identityRows.length) {
      return res.status(404).json({ error: "Place not found" });
    }

    if (!isEmer) {
      await assertNoEmerConflictForPublish({
        entityType: "place",
        category: String(identityRows[0]?.category || "").trim(),
        slug: String(identityRows[0]?.slug || "").trim(),
        title,
        excludeEntityId: placeId,
      });
    }

    const [placeUpdate] = await pool.query(
      `UPDATE places
       SET image=?, is_approved=?, is_emer=?,
           decision_featured_score=?, decision_scenario_tags=?, decision_trend_flags=?,
           decision_moment_tags=?, decision_insight_flags=?, decision_cover_image=?, decision_thumbnail_image=?
       WHERE id=?`,
      [
        image || null,
        isEmer ? 1 : 0,
        isEmer,
        decision_featured_score,
        decision_scenario_tags,
        decision_trend_flags,
        decision_moment_tags,
        decision_insight_flags,
        decision_cover_image,
        decision_thumbnail_image,
        placeId,
      ]
    );
    if (!placeUpdate.affectedRows) {
      return res.status(404).json({ error: "Place not found" });
    }
    if (hasLocationPatch(latitude, longitude, map_url, google_place_id)) {
      await pool.query(
        "UPDATE places SET latitude=?, longitude=?, map_url=?, google_place_id=? WHERE id=?",
        [latitude, longitude, map_url, google_place_id, placeId]
      );
    }

    await ensureFallbackSlug(placeId);

    const existingTranslationId = await getExistingTranslation(placeId, "th");
    if (!existingTranslationId) {
      return res.status(404).json({ error: "Translation not found for this lang" });
    }

    await pool.query(
      `UPDATE place_translations
       SET title=?, description=?, meta_title=?, meta_description=?
       WHERE id=?`,
      [title, description, meta_title || null, resolveMetaDescription(meta_description, description), existingTranslationId]
    );

    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};
export const approvePlace = async (req, res) => {
  const logs = [];
  try {
    await ensureApprovalColumn();

    const { id } = req.params;
    const placeId = Number(id);
    logs.push(`start approve place_id=${id}`);

    if (!Number.isFinite(placeId)) {
      logs.push("invalid place id");
      return res.status(400).json({ error: "Invalid place id", logs });
    }

    const [thRows] = await pool.query(
      `SELECT title, description, meta_title, meta_description
       FROM place_translations
       WHERE place_id=? AND lang='th'
       LIMIT 1`,
      [placeId]
    );
    logs.push(`loaded thai source rows=${thRows.length}`);

    if (!thRows.length) {
      logs.push("thai source not found");
      return res.status(400).json({ error: "Thai source translation not found", logs });
    }

    const [identityRows] = await pool.query(
      `SELECT p.id, p.slug, p.is_emer, c.slug AS category
       FROM places p
       JOIN categories c ON c.id=p.category_id
       WHERE p.id=? LIMIT 1`,
      [placeId]
    );
    if (!identityRows.length) {
      logs.push("place row not found before approve");
      return res.status(404).json({ error: "Place not found", logs });
    }
    const isEmer = Number(identityRows[0]?.is_emer || 0) === 1;
    if (!isEmer) {
      await assertNoEmerConflictForPublish({
        entityType: "place",
        category: String(identityRows[0]?.category || "").trim(),
        slug: String(identityRows[0]?.slug || "").trim(),
        title: String(thRows[0]?.title || "").trim(),
        excludeEntityId: placeId,
      });
      logs.push("emer conflict guard passed");
    } else {
      logs.push("emer content bypassed conflict guard");
    }

    logs.push("translation side effects skipped (approval is source-only)");

    const [result] = await pool.query("UPDATE places SET is_approved=1 WHERE id=?", [placeId]);
    if (!result.affectedRows) {
      logs.push("place row not found on approve update");
      return res.status(404).json({ error: "Place not found", logs });
    }
    logs.push("approved flag set");
    const reviewerId = Number(req.user?.id || 0) || null;
    if (reviewerId) {
      const linkedReviewRows = await markCollectorImportReviewApprovedByEntity({
        reviewId: req.body?.review_id,
        localEntityType: "place",
        localEntityId: placeId,
        reviewedByUserId: reviewerId,
        reviewNote: req.body?.review_note,
      });
      logs.push(`collector import review rows approved=${linkedReviewRows}`);
    }

    return res.json({ message: "Approved", logs });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    logs.push("fatal: internal error");
    console.error("approval failed", err);
    return res.status(500).json({ error: "Internal server error", logs });
  }
};

export const deletePlace = async (req, res) => {
  try {
    const placeId = Number(req.params?.id || 0) || 0;
    const password = String(req.body?.password || "");
    const purgeNote = req.body?.purge_note ?? null;
    if (!placeId) return res.status(400).json({ error: "Invalid place id" });
    if (!password) return res.status(400).json({ error: "password is required" });

    const result = await purgePlaceEntity({
      placeId,
      actorUserId: Number(req.user?.id || 0) || 0,
      password,
      purgeNote,
    });
    res.json({ message: "Purged", item: result });
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("invalid password")) return res.status(401).json({ error: "Invalid password" });
    if (msg.includes("not found")) return res.status(404).json({ error: "Place not found" });
    if (msg.includes("password is required")) return res.status(400).json({ error: "password is required" });
    res.status(500).json({ error: "Internal server error" });
  }
};

export const importPlaces = async (req, res) => {
  try {
    await ensureApprovalColumn();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: "items array is required" });
    }
    if (items.length > LIMITS.IMPORT_ITEMS_MAX) {
      return res.status(400).json({ error: `items exceeds max size (${LIMITS.IMPORT_ITEMS_MAX})` });
    }

    let created = 0;
    let updated = 0;
    let rejected = 0;
    const errors = [];

    for (let i = 0; i < items.length; i += 1) {
      const result = await upsertPlaceFromSourceThai(items[i]);
      if (!result.ok) {
        rejected += 1;
        errors.push({ index: i, reason: result.reason });
        continue;
      }
      if (result.mode === "created") created += 1;
      else updated += 1;
    }

    return res.json({
      parsed_rows: items.length,
      created,
      updated,
      rejected,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const importPlacesCsv = async (req, res) => {
  try {
    await ensureApprovalColumn();
    const csvText = String(req.body?.csvText || "").trim();
    if (!csvText) {
      return res.status(400).json({ error: "csvText is required" });
    }
    if (Buffer.byteLength(csvText, "utf8") > LIMITS.CSV_TEXT_MAX) {
      return res.status(400).json({ error: "csvText is too large" });
    }

    const rows = parseCsvText(csvText);
    if (rows.length > LIMITS.IMPORT_ITEMS_MAX) {
      return res.status(400).json({ error: `CSV rows exceed max size (${LIMITS.IMPORT_ITEMS_MAX})` });
    }
    if (!rows.length) {
      return res.status(400).json({ error: "CSV has no data rows" });
    }

    let created = 0;
    let updated = 0;
    let rejected = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += 1) {
      const result = await upsertPlaceFromSourceThai(rows[i]);
      if (!result.ok) {
        rejected += 1;
        errors.push({ row: i + 2, reason: result.reason });
        continue;
      }
      if (result.mode === "created") created += 1;
      else updated += 1;
    }

    return res.json({
      parsed_rows: rows.length,
      created,
      updated,
      rejected,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};










