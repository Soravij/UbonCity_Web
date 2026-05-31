import pool from "../config/db.js";
import { cleanPlainText } from "../validators/inputSanitizer.js";

const ALLOWED_EVENT_TYPES = new Set(["MAP_CLICK", "PHONE_CLICK", "LINE_CLICK"]);
const ALLOWED_ENTITY_TYPES = new Set(["place", "event", "review_content"]);
const METADATA_MAX_BYTES = 2048;
const ALLOWED_RANGE_DAYS = new Set([7, 30, 90]);

function normalizeEventType(value) {
  const eventType = cleanPlainText(value, { required: true, max: 32, field: "event_type" }).toUpperCase();
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new Error("event_type is not supported");
  }
  return eventType;
}

function normalizeRelativePath(value, field) {
  const raw = cleanPlainText(value, { required: true, max: 1024, field });
  if (!raw.startsWith("/")) throw new Error(`${field} must be a relative path`);
  if (raw.startsWith("//")) throw new Error(`${field} must be a relative path`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error(`${field} must be a relative path`);
  if (raw.includes("..")) throw new Error(`${field} is invalid`);
  return raw;
}

function normalizeOptionalRelativePath(value, field) {
  if (value == null || value === "") return null;
  return normalizeRelativePath(value, field);
}

function normalizeEntityType(value) {
  if (value == null || value === "") return null;
  const normalized = cleanPlainText(value, { required: true, max: 32, field: "entity_type" }).toLowerCase();
  if (!ALLOWED_ENTITY_TYPES.has(normalized)) throw new Error("entity_type is invalid");
  return normalized;
}

function normalizeEntityId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error("entity_id must be a positive integer");
  return Math.floor(n);
}

function normalizeMetadataObject(value) {
  if (value == null) return null;
  if (Array.isArray(value) || typeof value !== "object") {
    throw new Error("metadata_json must be an object");
  }
  const out = {};
  for (const [keyRaw, valRaw] of Object.entries(value)) {
    const key = cleanPlainText(keyRaw, { required: true, max: 64, field: "metadata_json.key" });
    if (valRaw == null) continue;
    const valueType = typeof valRaw;
    if (valueType === "string") {
      out[key] = cleanPlainText(valRaw, { required: false, max: 255, field: `metadata_json.${key}` });
      continue;
    }
    if (valueType === "number") {
      if (!Number.isFinite(valRaw)) throw new Error(`metadata_json.${key} is invalid`);
      out[key] = valRaw;
      continue;
    }
    if (valueType === "boolean") {
      out[key] = valRaw;
      continue;
    }
    throw new Error(`metadata_json.${key} type is not supported`);
  }
  const text = JSON.stringify(out);
  if (Buffer.byteLength(text, "utf8") > METADATA_MAX_BYTES) {
    throw new Error("metadata_json is too large");
  }
  return out;
}

function normalizeRangeDays(value, fallback = 30) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("range_days is invalid");
  const normalized = Math.floor(n);
  if (!ALLOWED_RANGE_DAYS.has(normalized)) throw new Error("range_days must be one of 7, 30, 90");
  return normalized;
}

function normalizeLimit(value, fallback, min, max) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("limit is invalid");
  const normalized = Math.floor(n);
  if (normalized < min || normalized > max) throw new Error(`limit must be between ${min} and ${max}`);
  return normalized;
}

function safeParseJsonObject(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    if (Array.isArray(value)) return null;
    return value;
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function createAnalyticsEvent(req, res) {
  try {
    const body = req.body || {};
    const eventType = normalizeEventType(body.event_type);
    const sourcePath = normalizeRelativePath(body.source_path, "source_path");
    const entityType = normalizeEntityType(body.entity_type);
    const entityId = normalizeEntityId(body.entity_id);
    const referrerPath = normalizeOptionalRelativePath(body.referrer_path, "referrer_path");
    const metadata = normalizeMetadataObject(body.metadata_json);
    if (entityType && !entityId) throw new Error("entity_id is required when entity_type is present");
    if (!entityType && entityId) throw new Error("entity_type is required when entity_id is present");

    await pool.query(
      `INSERT INTO analytics_events
       (event_type, source_path, entity_type, entity_id, referrer_path, metadata_json)
       VALUES (?,?,?,?,?,?)`,
      [eventType, sourcePath, entityType, entityId, referrerPath, metadata ? JSON.stringify(metadata) : null]
    );
    return res.status(202).json({ ok: true });
  } catch (err) {
    const msg = String(err?.message || "invalid payload");
    if (/required|invalid|must be|too large|not supported/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getCtaSummary(req, res) {
  try {
    const rangeDays = normalizeRangeDays(req.query?.range_days, 30);
    const [rows] = await pool.query(
      `SELECT
         SUM(CASE WHEN created_at >= (NOW() - INTERVAL ? DAY) THEN 1 ELSE 0 END) AS total_clicks,
         SUM(CASE WHEN event_type='MAP_CLICK' AND created_at >= (NOW() - INTERVAL ? DAY) THEN 1 ELSE 0 END) AS map_clicks,
         SUM(CASE WHEN event_type='PHONE_CLICK' AND created_at >= (NOW() - INTERVAL ? DAY) THEN 1 ELSE 0 END) AS phone_clicks,
         SUM(CASE WHEN event_type='LINE_CLICK' AND created_at >= (NOW() - INTERVAL ? DAY) THEN 1 ELSE 0 END) AS line_clicks,
         SUM(CASE WHEN created_at >= (NOW() - INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS last_7_days,
         SUM(CASE WHEN created_at >= (NOW() - INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS last_30_days
       FROM analytics_events
       WHERE event_type IN ('MAP_CLICK','PHONE_CLICK','LINE_CLICK')`,
      [rangeDays, rangeDays, rangeDays, rangeDays]
    );
    const row = rows?.[0] || {};
    return res.json({
      range_days: rangeDays,
      total_clicks: Number(row.total_clicks || 0),
      by_type: {
        MAP_CLICK: Number(row.map_clicks || 0),
        PHONE_CLICK: Number(row.phone_clicks || 0),
        LINE_CLICK: Number(row.line_clicks || 0),
      },
      last_7_days: Number(row.last_7_days || 0),
      last_30_days: Number(row.last_30_days || 0),
    });
  } catch (err) {
    const msg = String(err?.message || "invalid query");
    if (/range_days|invalid|must be/i.test(msg)) return res.status(400).json({ error: msg });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getTopEntities(req, res) {
  try {
    const rangeDays = normalizeRangeDays(req.query?.range_days, 30);
    const limit = normalizeLimit(req.query?.limit, 10, 5, 50);
    const [rows] = await pool.query(
      `SELECT
         a.entity_type,
         a.entity_id,
         pt.title AS title,
         c.slug AS category,
         p.slug AS slug,
         COUNT(*) AS total_clicks,
         SUM(CASE WHEN a.event_type='MAP_CLICK' THEN 1 ELSE 0 END) AS map_clicks,
         SUM(CASE WHEN a.event_type='PHONE_CLICK' THEN 1 ELSE 0 END) AS phone_clicks,
         SUM(CASE WHEN a.event_type='LINE_CLICK' THEN 1 ELSE 0 END) AS line_clicks,
         MAX(a.created_at) AS latest_click_at
       FROM analytics_events a
       LEFT JOIN places p
         ON a.entity_type='place' AND a.entity_id=p.id
       LEFT JOIN categories c
         ON p.category_id=c.id
       LEFT JOIN place_translations pt
         ON pt.place_id=p.id AND pt.lang='th'
       WHERE a.event_type IN ('MAP_CLICK','PHONE_CLICK','LINE_CLICK')
         AND a.created_at >= (NOW() - INTERVAL ? DAY)
         AND a.entity_type='place'
         AND a.entity_id IS NOT NULL
       GROUP BY a.entity_type, a.entity_id, pt.title, c.slug, p.slug
       ORDER BY total_clicks DESC, latest_click_at DESC
       LIMIT ?`,
      [rangeDays, limit]
    );

    return res.json({
      items: (Array.isArray(rows) ? rows : []).map((row) => ({
        entity_type: row.entity_type || null,
        entity_id: row.entity_id == null ? null : Number(row.entity_id || 0) || null,
        title: row.title == null ? null : String(row.title || "") || null,
        category: row.category == null ? null : String(row.category || "") || null,
        slug: row.slug == null ? null : String(row.slug || "") || null,
        total_clicks: Number(row.total_clicks || 0),
        map_clicks: Number(row.map_clicks || 0),
        phone_clicks: Number(row.phone_clicks || 0),
        line_clicks: Number(row.line_clicks || 0),
        latest_click_at: row.latest_click_at || null,
      })),
    });
  } catch (err) {
    const msg = String(err?.message || "invalid query");
    if (/limit|range_days|invalid|must be/i.test(msg)) return res.status(400).json({ error: msg });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getRecentAnalyticsEvents(req, res) {
  try {
    const limit = normalizeLimit(req.query?.limit, 50, 10, 100);
    const [rows] = await pool.query(
      `SELECT id, event_type, entity_type, entity_id, source_path, referrer_path, metadata_json, created_at
       FROM analytics_events
       WHERE event_type IN ('MAP_CLICK','PHONE_CLICK','LINE_CLICK')
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [limit]
    );

    return res.json({
      items: (Array.isArray(rows) ? rows : []).map((row) => ({
        id: Number(row.id || 0) || 0,
        event_type: String(row.event_type || "").trim(),
        entity_type: row.entity_type == null ? null : String(row.entity_type || "").trim() || null,
        entity_id: row.entity_id == null ? null : Number(row.entity_id || 0) || null,
        source_path: String(row.source_path || "").trim(),
        referrer_path: row.referrer_path == null ? null : String(row.referrer_path || "").trim() || null,
        metadata_json: safeParseJsonObject(row.metadata_json),
        created_at: row.created_at || null,
      })),
    });
  } catch (err) {
    const msg = String(err?.message || "invalid query");
    if (/limit|invalid|must be/i.test(msg)) return res.status(400).json({ error: msg });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getMissingCtaPlaces(req, res) {
  try {
    const limit = normalizeLimit(req.query?.limit, 50, 10, 100);
    const [rows] = await pool.query(
      `SELECT
         p.id,
         pt.title AS title,
         c.slug AS category,
         p.slug,
         p.map_url,
         p.phone,
         p.transport_contact_phone,
         p.line_url
       FROM places p
       LEFT JOIN categories c ON c.id=p.category_id
       LEFT JOIN place_translations pt ON pt.place_id=p.id AND pt.lang='th'
       WHERE p.is_approved=1
         AND (
           NULLIF(TRIM(COALESCE(p.map_url,'')), '') IS NULL
           OR (
             NULLIF(TRIM(COALESCE(p.phone,'')), '') IS NULL
             AND NULLIF(TRIM(COALESCE(p.transport_contact_phone,'')), '') IS NULL
           )
           OR NULLIF(TRIM(COALESCE(p.line_url,'')), '') IS NULL
         )
       ORDER BY p.id DESC
       LIMIT ?`,
      [limit]
    );

    const items = (Array.isArray(rows) ? rows : []).map((row) => {
      const mapUrl = String(row.map_url || "").trim() || null;
      const phone = String(row.phone || "").trim() || null;
      const transportContactPhone = String(row.transport_contact_phone || "").trim() || null;
      const lineUrl = String(row.line_url || "").trim() || null;
      const missing = [];
      if (!mapUrl) missing.push("map");
      if (!phone && !transportContactPhone) missing.push("phone");
      if (!lineUrl) missing.push("line");
      return {
        id: Number(row.id || 0) || 0,
        title: row.title == null ? null : String(row.title || "") || null,
        category: row.category == null ? null : String(row.category || "") || null,
        slug: row.slug == null ? null : String(row.slug || "") || null,
        map_url: mapUrl,
        phone,
        transport_contact_phone: transportContactPhone,
        line_url: lineUrl,
        missing,
      };
    });
    return res.json({ items });
  } catch (err) {
    const msg = String(err?.message || "invalid query");
    if (/limit|invalid|must be/i.test(msg)) return res.status(400).json({ error: msg });
    return res.status(500).json({ error: "Internal server error" });
  }
}
