import pool from "../config/db.js";
import { cleanPlainText } from "../validators/inputSanitizer.js";

const ALLOWED_EVENT_TYPES = new Set(["MAP_CLICK", "PHONE_CLICK", "LINE_CLICK"]);
const ALLOWED_ENTITY_TYPES = new Set(["place", "event", "review_content"]);
const METADATA_MAX_BYTES = 2048;

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
