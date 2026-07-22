import pool from "../config/db.js";
import jwt from "jsonwebtoken";
import { SUPPORTED_CONTENT_LANGS, normalizeContentLang } from "../constants/languages.js";
import { validateEventPayload } from "../validators/eventValidator.js";
import { markCollectorImportReviewApprovedByEntity } from "../services/collectorImportReviewService.js";
import { assertNoEmerConflictForPublish } from "../services/publishGuardService.js";
import { purgeEvent as purgeEventEntity } from "../services/purgeContentService.js";

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const EVENT_LANGS = SUPPORTED_CONTENT_LANGS;

let ensuredEventsTable = false;
function extractPlainTextForMeta(value) {
  return String(value || "")
    .replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMetaDescription(description) {
  const source = extractPlainTextForMeta(description);
  if (!source) return null;
  if (source.length <= 160) return source;

  return source.slice(0, 157).trimEnd() + "...";
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

async function loadApprovedEventMediaMap(req, eventIds) {
  const normalizedIds = Array.from(
    new Set((Array.isArray(eventIds) ? eventIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (!normalizedIds.length) return new Map();

  const placeholders = normalizedIds.map(() => "?").join(",");
  try {
    const [rows] = await pool.query(
      `SELECT
         ciu.entity_id AS event_id,
         ciu.usage_type,
         ciu.position,
         ciu.caption,
         ma.source_url,
         ma.storage_disk,
         ma.file_name,
         ma.storage_path
       FROM content_image_usages ciu
       JOIN media_assets ma ON ma.id=ciu.asset_id
       WHERE ciu.entity_type='event'
         AND ciu.entity_id IN (${placeholders})
         AND ma.status='approved'
       ORDER BY ciu.entity_id ASC, ciu.usage_type ASC, ciu.position ASC, ciu.id ASC`,
      normalizedIds
    );

    const out = new Map();
    for (const row of rows) {
      const eventId = Number(row?.event_id || 0);
      if (!eventId) continue;

      const mediaUrl = buildMediaPublicUrl(req, row);
      if (!mediaUrl) continue;

      const usageType = String(row?.usage_type || "").trim().toLowerCase();
      const current = out.get(eventId) || { cover: null, gallery: [], galleryItems: [], inline: [] };

      if (usageType === "cover" && !current.cover) current.cover = mediaUrl;
      if (usageType === "gallery") {
        current.gallery.push(mediaUrl);
        current.galleryItems.push({
          url: mediaUrl,
          caption: String(row?.caption || "").trim() || null,
          width: null,
          height: null,
        });
      }
      if (usageType === "inline") current.inline.push(mediaUrl);

      out.set(eventId, current);
    }

    return out;
  } catch (err) {
    const code = String(err?.code || "").toUpperCase();
    if (code === "ER_NO_SUCH_TABLE") return new Map();
    throw err;
  }
}

function parseTagList(value) {
  return String(value || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeEventDecisionAndMedia(row, media = { cover: null, gallery: [], galleryItems: [], inline: [] }) {
  const decisionFeaturedScore = Number(row?.decision_featured_score);
  const scenarioList = parseTagList(row?.decision_scenario_tags);
  const trendList = parseTagList(row?.decision_trend_flags);
  const momentList = parseTagList(row?.decision_moment_tags);
  const insightList = parseTagList(row?.decision_insight_flags);

  const mediaCoverImage = media?.cover || null;
  const mediaGalleryImages = Array.isArray(media?.gallery) ? media.gallery : [];
  const mediaGalleryItems = Array.isArray(media?.galleryItems) ? media.galleryItems : [];
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
    media_gallery_items: mediaGalleryItems,
    media_inline_images: mediaInlineImages,
    effective_cover_image: effectiveCover,
    effective_thumbnail_image: effectiveThumb,
  };
}

export function serializePublicEventResponse(row) {
  const {
    req_description: _reqDescription,
    th_description: _thDescription,
    is_approved: _isApproved,
    tracking_entity_type: _trackingEntityType,
    tracking_entity_id: _trackingEntityId,
    media_cover_image: _mediaCoverImage,
    media_inline_images: _mediaInlineImages,
    ...publicRow
  } = row || {};
  return publicRow;
}

function normalizeEventForResponse(req, row, media) {
  const normalized = normalizeEventDecisionAndMedia(row, media);
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
    media_gallery_items: (Array.isArray(normalized.media_gallery_items) ? normalized.media_gallery_items : [])
      .map((entry) => ({
        url: rewriteSelfHostedMediaUrl(req, entry?.url),
        caption: String(entry?.caption || "").trim() || null,
        width: null,
        height: null,
      }))
      .filter((entry) => entry.url),
    media_inline_images: (Array.isArray(normalized.media_inline_images) ? normalized.media_inline_images : [])
      .map((entry) => rewriteSelfHostedMediaUrl(req, entry))
      .filter(Boolean),
    effective_cover_image: rewriteSelfHostedMediaUrl(req, normalized.effective_cover_image),
    effective_thumbnail_image: rewriteSelfHostedMediaUrl(req, normalized.effective_thumbnail_image),
  };
}

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

async function upsertEventTranslation(eventId, lang, title, description, metaTitle = null, metaDescription = null) {
  await pool.query(
    `INSERT INTO event_translations (event_id,lang,title,description,meta_title,meta_description)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       title=VALUES(title),
       description=VALUES(description),
       meta_title=VALUES(meta_title),
       meta_description=VALUES(meta_description)`,
    [
      Number(eventId),
      lang,
      String(title || "").trim() || null,
      String(description || "").trim() || null,
      String(metaTitle || "").trim() || null,
      String(metaDescription || "").trim() || null,
    ]
  );
}
async function ensureEventsTable() {
  if (ensuredEventsTable) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id INT NOT NULL AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      image VARCHAR(1024) NULL,
      event_period_text TEXT NULL,
      location_text TEXT NULL,
      map_url VARCHAR(1024) NULL,
      is_approved TINYINT(1) NOT NULL DEFAULT 0,
      approved_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
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

  const [approvedCol] = await pool.query("SHOW COLUMNS FROM events LIKE 'is_approved'");
  if (!approvedCol.length) {
    await pool.query("ALTER TABLE events ADD COLUMN is_approved TINYINT(1) NOT NULL DEFAULT 0");
  }

  const [approvedAtCol] = await pool.query("SHOW COLUMNS FROM events LIKE 'approved_at'");
  if (!approvedAtCol.length) {
    await pool.query("ALTER TABLE events ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL");
  }

  const [metaTitleCol] = await pool.query("SHOW COLUMNS FROM event_translations LIKE 'meta_title'");
  if (!metaTitleCol.length) {
    await pool.query("ALTER TABLE event_translations ADD COLUMN meta_title VARCHAR(255) NULL");
  }

  const [metaDescriptionCol] = await pool.query("SHOW COLUMNS FROM event_translations LIKE 'meta_description'");
  if (!metaDescriptionCol.length) {
    await pool.query("ALTER TABLE event_translations ADD COLUMN meta_description VARCHAR(320) NULL");
  }

  const eventColumns = [
    ["event_period_text", "TEXT NULL"],
    ["location_text", "TEXT NULL"],
    ["map_url", "VARCHAR(1024) NULL"],
  ];
  for (const [name, definition] of eventColumns) {
    const [column] = await pool.query("SHOW COLUMNS FROM events LIKE ?", [name]);
    if (!column.length) {
      await pool.query(`ALTER TABLE events ADD COLUMN ${name} ${definition}`);
    }
  }

  const eventDecisionColumns = [
    ["decision_featured_score", "INT NULL DEFAULT NULL"],
    ["decision_scenario_tags", "VARCHAR(500) NULL"],
    ["decision_trend_flags", "VARCHAR(500) NULL"],
    ["decision_moment_tags", "VARCHAR(500) NULL"],
    ["decision_insight_flags", "VARCHAR(500) NULL"],
    ["decision_cover_image", "VARCHAR(1024) NULL"],
    ["decision_thumbnail_image", "VARCHAR(1024) NULL"],
  ];
  for (const [name, definition] of eventDecisionColumns) {
    const [column] = await pool.query("SHOW COLUMNS FROM events LIKE ?", [name]);
    if (!column.length) {
      await pool.query(`ALTER TABLE events ADD COLUMN ${name} ${definition}`);
    }
  }

  // Backfill TH translation for legacy rows.
  await pool.query(
    `INSERT INTO event_translations (event_id,lang,title,description)
     SELECT e.id, 'th', e.title, e.description
     FROM events e
     LEFT JOIN event_translations et ON et.event_id=e.id AND et.lang='th'
     WHERE et.id IS NULL`
  );

  ensuredEventsTable = true;

}

export const getEvents = async (req, res) => {
  try {
    await ensureEventsTable();

    const lang = normalizeContentLang(req.query?.lang, "th");
    const includeUnapproved =
      String(req.query?.include_unapproved || "") === "1" && hasPrivilegedPreviewAccess(req);
    const emerFilterRaw = String(req.query?.is_emer || "").trim();
    const emerFilter = emerFilterRaw === "1" ? 1 : emerFilterRaw === "0" ? 0 : null;
    const emerWhereClause =
      emerFilter === null ? "" : includeUnapproved ? "WHERE e.is_emer=?" : "AND e.is_emer=?";
    const queryParams = emerFilter === null ? [lang, lang] : [lang, lang, emerFilter];

    const [rows] = await pool.query(
      `SELECT
         e.id,
         e.image,
         e.event_period_text,
         e.location_text,
         e.map_url,
         e.is_approved,
         e.is_emer,
         e.approved_at,
         e.created_at,
         e.updated_at,
         ? AS lang,
         COALESCE(et_req.title, et_th.title, e.title) AS title,
         COALESCE(et_req.description, et_th.description, e.description) AS description,
         COALESCE(et_req.meta_title, et_th.meta_title, COALESCE(et_req.title, et_th.title, e.title)) AS meta_title,
         COALESCE(et_req.meta_description, et_th.meta_description, NULL) AS meta_description,
         e.decision_featured_score,
         e.decision_scenario_tags,
         e.decision_trend_flags,
         e.decision_moment_tags,
         e.decision_insight_flags,
         e.decision_cover_image,
         e.decision_thumbnail_image
       FROM events e
       LEFT JOIN event_translations et_req ON et_req.event_id=e.id AND et_req.lang=?
       LEFT JOIN event_translations et_th ON et_th.event_id=e.id AND et_th.lang='th'
        ${includeUnapproved ? "" : "WHERE e.is_approved=1"}
        ${emerWhereClause}
       ORDER BY COALESCE(e.approved_at, e.updated_at) DESC, e.id DESC`,
      queryParams
    );

    const mediaMap = await loadApprovedEventMediaMap(req, rows.map((row) => Number(row.id)));
    return res.json({
      items: rows.map((row) => {
        const normalized = normalizeEventForResponse(req, row, mediaMap.get(Number(row.id)));
        const { media_gallery_items: _mediaGalleryItems, ...listRow } = normalized;
        return includeUnapproved ? listRow : serializePublicEventResponse(listRow);
      }),
    });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getEventDetail = async (req, res) => {
  try {
    await ensureEventsTable();

    const includeUnapproved =
      String(req.query?.include_unapproved || "") === "1" && hasPrivilegedPreviewAccess(req);

    const eventId = Number(req.params?.id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return res.status(400).json({ error: "Invalid event id" });
    }

    const lang = normalizeContentLang(req.query?.lang, "th");

    const [rows] = await pool.query(
      `SELECT
         e.id,
         e.image,
         e.event_period_text,
         e.location_text,
         e.map_url,
         e.is_approved,
         e.approved_at,
         e.created_at,
         e.updated_at,
         ? AS lang,
         COALESCE(et_req.title, et_th.title, e.title) AS title,
         COALESCE(et_req.description, et_th.description, e.description) AS description,
         COALESCE(et_req.meta_title, et_th.meta_title, COALESCE(et_req.title, et_th.title, e.title)) AS meta_title,
         COALESCE(et_req.meta_description, et_th.meta_description, NULL) AS meta_description,
         e.decision_featured_score,
         e.decision_scenario_tags,
         e.decision_trend_flags,
         e.decision_moment_tags,
         e.decision_insight_flags,
         e.decision_cover_image,
         e.decision_thumbnail_image
       FROM events e
       LEFT JOIN event_translations et_req ON et_req.event_id=e.id AND et_req.lang=?
       LEFT JOIN event_translations et_th ON et_th.event_id=e.id AND et_th.lang='th'
       WHERE e.id=? ${includeUnapproved ? "" : "AND e.is_approved=1"}
       LIMIT 1`,
      [lang, lang, eventId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Event not found" });
    }

    const mediaMap = await loadApprovedEventMediaMap(req, [eventId]);
    const item = normalizeEventForResponse(req, rows[0], mediaMap.get(eventId));
    return res.json({ item: includeUnapproved ? item : serializePublicEventResponse(item) });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};
export const createEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const validated = validateEventPayload(req.body || {});

    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }

    const cleanTitle = validated.value.title;
    const cleanDescription = validated.value.description;
    const cleanImage = validated.value.image;
    const metaTitle = validated.value.meta_title || cleanTitle;
    const metaDescription = validated.value.meta_description || resolveMetaDescription(cleanDescription);
    const isEmer = Number(req.body?.is_emer || 0) === 1 ? 1 : 0;
    if (!isEmer) {
      await assertNoEmerConflictForPublish({
        entityType: "event",
        title: cleanTitle,
      });
    }

    const [result] = await pool.query(
       `INSERT INTO events (
         title, description, image, event_period_text, location_text, map_url, is_approved, approved_at, is_emer,
         decision_featured_score, decision_scenario_tags, decision_trend_flags,
         decision_moment_tags, decision_insight_flags, decision_cover_image, decision_thumbnail_image
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        cleanTitle,
        cleanDescription || null,
        cleanImage || null,
        validated.value.event_period_text || null,
        validated.value.location_text || null,
        validated.value.map_url || null,
        isEmer ? 1 : 0,
        isEmer ? new Date() : null,
        isEmer,
        validated.value.decision_featured_score,
        validated.value.decision_scenario_tags || null,
        validated.value.decision_trend_flags || null,
        validated.value.decision_moment_tags || null,
        validated.value.decision_insight_flags || null,
        validated.value.decision_cover_image || null,
        validated.value.decision_thumbnail_image || null,
      ]
    );

    await upsertEventTranslation(result.insertId, "th", cleanTitle, cleanDescription, metaTitle, metaDescription);

    return res.json({ message: isEmer ? "Created" : "Created (pending approval)", id: result.insertId });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const eventId = Number(req.params?.id);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return res.status(400).json({ error: "Invalid event id" });
    }

    const validated = validateEventPayload(req.body || {});

    if (!validated.ok) {
      return res.status(400).json({ error: validated.error });
    }

    const cleanTitle = validated.value.title;
    const cleanDescription = validated.value.description;
    const cleanImage = validated.value.image;
    const metaTitle = validated.value.meta_title || cleanTitle;
    const metaDescription = validated.value.meta_description || resolveMetaDescription(cleanDescription);
    const isEmer = Number(req.body?.is_emer || 0) === 1 ? 1 : 0;
    if (!isEmer) {
      await assertNoEmerConflictForPublish({
        entityType: "event",
        title: cleanTitle,
        excludeEntityId: eventId,
      });
    }

    const [result] = await pool.query(
      `UPDATE events
       SET title=?, description=?, image=?, event_period_text=?, location_text=?, map_url=?, is_approved=?, approved_at=?, is_emer=?,
           decision_featured_score=?, decision_scenario_tags=?, decision_trend_flags=?,
           decision_moment_tags=?, decision_insight_flags=?, decision_cover_image=?, decision_thumbnail_image=?
       WHERE id=?`,
      [
        cleanTitle,
        cleanDescription || null,
        cleanImage || null,
        validated.value.event_period_text || null,
        validated.value.location_text || null,
        validated.value.map_url || null,
        isEmer ? 1 : 0,
        isEmer ? new Date() : null,
        isEmer,
        validated.value.decision_featured_score,
        validated.value.decision_scenario_tags || null,
        validated.value.decision_trend_flags || null,
        validated.value.decision_moment_tags || null,
        validated.value.decision_insight_flags || null,
        validated.value.decision_cover_image || null,
        validated.value.decision_thumbnail_image || null,
        eventId,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Event not found" });
    }

    await upsertEventTranslation(
      eventId,
      "th",
      cleanTitle,
      cleanDescription,
      metaTitle,
      metaDescription
    );

    return res.json({ message: isEmer ? "Updated" : "Updated (pending approval)" });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};
export const approveEvent = async (req, res) => {
  const logs = [];
  try {
    await ensureEventsTable();

    const { id } = req.params;
    const eventId = Number(id);
    logs.push(`start approve event_id=${id}`);

    const [rows] = await pool.query(
      `SELECT title, description FROM event_translations WHERE event_id=? AND lang='th' LIMIT 1`,
      [eventId]
    );
    logs.push(`loaded thai source rows=${rows.length}`);

    if (!rows.length) {
      logs.push("thai source not found");
      return res.status(404).json({ error: "Event not found", logs });
    }

    const [identityRows] = await pool.query("SELECT is_emer FROM events WHERE id=? LIMIT 1", [eventId]);
    if (!identityRows.length) {
      logs.push("event row not found before approve");
      return res.status(404).json({ error: "Event not found", logs });
    }
    const isEmer = Number(identityRows[0]?.is_emer || 0) === 1;
    if (!isEmer) {
      await assertNoEmerConflictForPublish({
        entityType: "event",
        title: String(rows[0]?.title || "").trim(),
        excludeEntityId: eventId,
      });
      logs.push("emer conflict guard passed");
    } else {
      logs.push("emer content bypassed conflict guard");
    }

    logs.push("translation side effects skipped (approval is source-only)");

    const [result] = await pool.query(
      "UPDATE events SET is_approved=1, approved_at=CURRENT_TIMESTAMP WHERE id=?",
      [eventId]
    );

    if (!result.affectedRows) {
      logs.push("event row not found on approve update");
      return res.status(404).json({ error: "Event not found", logs });
    }

    logs.push("approved flag set");
    const reviewerId = Number(req.user?.id || 0) || null;
    if (reviewerId) {
      const linkedReviewRows = await markCollectorImportReviewApprovedByEntity({
        reviewId: req.body?.review_id,
        localEntityType: "event",
        localEntityId: eventId,
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

export const deleteEvent = async (req, res) => {
  try {
    await ensureEventsTable();

    const eventId = Number(req.params?.id || 0) || 0;
    const password = String(req.body?.password || "");
    const purgeNote = req.body?.purge_note ?? null;
    if (!eventId) return res.status(400).json({ error: "Invalid event id" });
    if (!password) return res.status(400).json({ error: "password is required" });

    const item = await purgeEventEntity({
      eventId,
      actorUserId: Number(req.user?.id || 0) || 0,
      password,
      purgeNote,
    });

    return res.json({ message: "Purged", item });
  } catch (err) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("invalid password")) return res.status(401).json({ error: "Invalid password" });
    if (msg.includes("not found")) return res.status(404).json({ error: "Event not found" });
    if (msg.includes("password is required")) return res.status(400).json({ error: "password is required" });
    return res.status(500).json({ error: "Internal server error" });
  }
};
























