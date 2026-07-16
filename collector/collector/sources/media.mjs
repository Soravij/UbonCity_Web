import { decodeUrlEntities } from "../../lib/decode-url-entities.mjs";

function toText(value) {
  return String(value ?? "").trim();
}

function isLikelyImageUrl(parsedUrl) {
  const pathname = String(parsedUrl?.pathname || "").toLowerCase();
  const host = String(parsedUrl?.hostname || "").toLowerCase();
  if (/\.(?:jpg|jpeg|png|webp|gif|avif|bmp|svg)$/i.test(pathname)) return true;
  if (host.includes("wongnai.com") || host.includes("ggpht.com")) return true;
  if (host.includes("googleapis.com") && pathname.includes("/media")) return true;
  return false;
}

function normalizeWongnaiImagePath(parsedUrl) {
  const host = String(parsedUrl?.hostname || "").toLowerCase();
  const pathname = String(parsedUrl?.pathname || "");
  if (!host.includes("img.wongnai.com")) return pathname;
  const match = pathname.match(/^\/p\/[^/]+\/(\d{4}\/\d{2}\/\d{2}\/[a-f0-9]{32}\.(?:jpg|jpeg|png|webp))$/i);
  if (!match?.[1]) return pathname;
  return `/p/__dedupe__/${match[1]}`;
}

function parseWongnaiVariantInfo(value) {
  const raw = toText(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").toLowerCase();
    if (!host.includes("img.wongnai.com")) return null;
    const match = String(parsed.pathname || "").match(/^\/p\/(\d+)x(\d+)\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]{32}\.(?:jpg|jpeg|png|webp)$/i);
    if (!match) return null;
    const width = Number(match[1] || 0);
    const height = Number(match[2] || 0);
    if (!Number.isFinite(width) || width <= 0) return null;
    return {
      width,
      height: Number.isFinite(height) && height > 0 ? height : null,
    };
  } catch {
    return null;
  }
}

function parseWongnaiVariantScore(value) {
  const info = parseWongnaiVariantInfo(value);
  if (!info) return 0;
  const effectiveHeight = Number.isFinite(info.height) && info.height > 0 ? info.height : info.width;
  return (info.width * 100000) + effectiveHeight;
}

function shouldReplaceMediaVariant(currentValue, nextValue) {
  const currentScore = parseWongnaiVariantScore(currentValue);
  const nextScore = parseWongnaiVariantScore(nextValue);
  return nextScore > currentScore;
}

function isAcceptableMediaUrl(value) {
  const wongnai = parseWongnaiVariantInfo(value);
  if (!wongnai) return true;
  return wongnai.width >= 400;
}

function stripTrackingParams(parsedUrl) {
  const removable = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "ved",
    "feature",
  ];
  for (const key of removable) {
    parsedUrl.searchParams.delete(key);
  }
}

export function normalizeMediaUrl(value) {
  const raw = decodeUrlEntities(toText(value));
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return raw;
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";
    if (isLikelyImageUrl(parsed)) {
      parsed.search = "";
    } else {
      stripTrackingParams(parsed);
      const nextSearch = new URLSearchParams();
      for (const [key, entryValue] of [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        nextSearch.append(key, entryValue);
      }
      parsed.search = nextSearch.toString() ? `?${nextSearch.toString()}` : "";
    }
    parsed.pathname = normalizeWongnaiImagePath(parsed);
    const normalized = parsed.toString();
    return normalized.endsWith("/") && parsed.pathname !== "/" ? normalized.slice(0, -1) : normalized;
  } catch {
    return raw;
  }
}

export function dedupeMediaUrls(values = [], limit = Number.POSITIVE_INFINITY) {
  const out = [];
  const indexByKey = new Map();
  const maxItems = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : Number.POSITIVE_INFINITY;
  for (const value of Array.isArray(values) ? values : []) {
    const raw = toText(value);
    if (!raw) continue;
    if (!isAcceptableMediaUrl(raw)) continue;
    const key = normalizeMediaUrl(raw) || raw;
    if (!key) continue;
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      const current = out[index];
      if (shouldReplaceMediaVariant(current, raw)) {
        out[index] = raw;
      }
      continue;
    }
    indexByKey.set(key, out.length);
    out.push(raw);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function dedupeMediaEntries(entries = [], getUrl = (entry) => entry?.url || entry?.media_url, limit = Number.POSITIVE_INFINITY) {
  const out = [];
  const indexByKey = new Map();
  const maxItems = Number.isFinite(Number(limit)) ? Math.max(1, Math.floor(Number(limit))) : Number.POSITIVE_INFINITY;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const raw = toText(getUrl(entry));
    if (!raw) continue;
    if (!isAcceptableMediaUrl(raw)) continue;
    const key = normalizeMediaUrl(raw) || raw;
    if (!key) continue;
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      const current = out[index];
      if (shouldReplaceMediaVariant(getUrl(current), raw)) {
        out[index] = entry;
      }
      continue;
    }
    indexByKey.set(key, out.length);
    out.push(entry);
    if (out.length >= maxItems) break;
  }
  return out;
}
