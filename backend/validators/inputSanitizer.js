const HTML_TAG_RE = /<[^>]*>/;

export const LIMITS = {
  TITLE_MAX: 160,
  DESCRIPTION_MAX: 40000,
  SHORT_TEXT_MAX: 255,
  META_TITLE_MAX: 255,
  META_DESC_MAX: 320,
  SLUG_MAX: 120,
  URL_MAX: 1200,
  NOTE_MAX: 5000,
  CSV_TEXT_MAX: 2 * 1024 * 1024,
  IMPORT_ITEMS_MAX: 500,
  BASE64_MAX_BYTES_5MB: 5 * 1024 * 1024,
  BASE64_MAX_BYTES_8MB: 8 * 1024 * 1024,
  ROUTE_POINTS_MAX: 5000,
  ROUTE_STOPS_MAX: 200,
};

function normalizeControlChars(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function cleanPlainText(value, { max = LIMITS.SHORT_TEXT_MAX, required = false, field = "field" } = {}) {
  const cleaned = normalizeControlChars(value).trim();
  if (!cleaned) {
    if (required) throw new Error(`${field} is required`);
    return "";
  }

  if (cleaned.length > max) {
    throw new Error(`${field} is too long (max ${max})`);
  }

  if (HTML_TAG_RE.test(cleaned)) {
    throw new Error(`${field} must not contain HTML`);
  }

  return cleaned;
}

export function cleanRichText(value, { max = LIMITS.DESCRIPTION_MAX, required = false, field = "field" } = {}) {
  const raw = normalizeControlChars(value).trim();
  if (!raw) {
    if (required) throw new Error(`${field} is required`);
    return "";
  }

  if (raw.length > max) {
    throw new Error(`${field} is too long (max ${max})`);
  }

  // Keep content readable while blocking high-risk script vectors.
  const stripped = raw
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "");

  return stripped;
}

export function cleanSlug(value, { required = false, field = "slug" } = {}) {
  const raw = normalizeControlChars(value).trim().toLowerCase();
  if (!raw) {
    if (required) throw new Error(`${field} is required`);
    return "";
  }

  if (raw.length > LIMITS.SLUG_MAX) {
    throw new Error(`${field} is too long (max ${LIMITS.SLUG_MAX})`);
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw)) {
    throw new Error(`${field} format is invalid`);
  }

  return raw;
}

export function cleanUrl(value, { required = false, field = "url" } = {}) {
  const raw = normalizeControlChars(value).trim();
  if (!raw) {
    if (required) throw new Error(`${field} is required`);
    return "";
  }

  if (raw.length > LIMITS.URL_MAX) {
    throw new Error(`${field} is too long (max ${LIMITS.URL_MAX})`);
  }

  if (raw.startsWith("/")) {
    if (raw.includes("..")) throw new Error(`${field} path is invalid`);
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`${field} must be http/https URL`);
    }
    return parsed.toString();
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
}

export function cleanOptionalNumber(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("invalid number");
  if (n < min || n > max) throw new Error("number out of range");
  return n;
}

export function ensureMaxArray(items, max, field = "items") {
  if (!Array.isArray(items)) throw new Error(`${field} must be an array`);
  if (items.length > max) throw new Error(`${field} exceeds max size (${max})`);
  return items;
}

export function sanitizeFileName(value) {
  const name = String(value || "").trim();
  if (!name) return "";

  const base = name.split(/[\\/]/).pop() || "";
  if (!base || base.length > LIMITS.SHORT_TEXT_MAX) {
    throw new Error("file_name is invalid");
  }

  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new Error("file_name is invalid");
  }

  return safe;
}

export function validateBase64ImageInput(dataBase64, maxBytes) {
  const raw = String(dataBase64 || "").trim();
  if (!raw) throw new Error("dataBase64 is required");

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
    throw new Error("dataBase64 is invalid");
  }

  const normalized = raw.replace(/\s+/g, "");
  const approxBytes = Math.floor((normalized.length * 3) / 4);
  if (approxBytes > maxBytes) {
    throw new Error(`File too large (max ${Math.floor(maxBytes / (1024 * 1024))}MB)`);
  }

  return normalized;
}
