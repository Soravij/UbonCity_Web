import { dedupeMediaUrls, normalizeMediaUrl } from "../media.mjs";
import { normalizeRawItem } from "../normalize.mjs";

const FETCH_TIMEOUT_MS = 8000;
const ENRICH_ROW_TIMEOUT_MS = Math.max(
  FETCH_TIMEOUT_MS + 2000,
  Number(process.env.COLLECTOR_MANUAL_ROW_TIMEOUT_MS || process.env.COLLECTOR_SOURCE_FETCH_TIMEOUT_MS || 12000) || 12000
);
const MAX_HTML_CHARS = 250000;
const MAX_WONGNAI_PHOTOS_HTML_CHARS = 750000;
const MAX_MEDIA_ITEMS = 10;
const MAX_WONGNAI_MEDIA_ITEMS = 20;
const MAX_REVIEW_ITEMS = 50;
const MAX_ARTICLE_SECTION_ITEMS = 10;
const MAX_FACT_ITEMS = 10;
const MAX_MENU_SECTION_ITEMS = 8;
const MAX_MENU_HIGHLIGHT_ITEMS = 10;
const MAX_PRICE_SIGNAL_ITEMS = 8;
const MAX_WONGNAI_GALLERY_PROBE_ITEMS = 120;
const MAX_WONGNAI_COMMENT_PROBE_ITEMS = 120;
const PAGE_PROFILE_BUSINESS = "business";
const PAGE_PROFILE_INSTITUTIONAL = "institutional";

function toText(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function uniqueTextList(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => toText(value)).filter(Boolean)));
}

function normalizePhoneValue(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "").trim();
  if (!digits) return "";
  if (digits.startsWith("+66")) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("66") && digits.length >= 9) {
    return `0${digits.slice(2)}`;
  }
  return digits.replace(/^\+/, "");
}

function normalizeAddressValue(value) {
  const text = String(value || "")
    .replace(/ประเทศไทย/g, " ")
    .replace(/หมู่ที่/gi, "หมู่ ")
    .replace(/ตำบล|แขวง/gi, " ")
    .replace(/อำเภอ|เขต/gi, " ")
    .replace(/จังหวัด/gi, " ")
    .replace(/\|/g, " ")
    .replace(/[,:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || "";
}

function extractAlternateTitles(...values) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const matches = text.matchAll(/\(([^()]{4,120})\)/g);
    for (const match of matches) {
      const candidate = String(match?.[1] || "").trim();
      if (!candidate) continue;
      if (!/[a-z]/i.test(candidate) && !/[ก-๙]/.test(candidate)) continue;
      const key = candidate.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
    }
  }
  return out;
}

function normalizeAliasText(value) {
  return toText(value)
    .replace(/^ร้าน\s*/i, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPlaceTypeSuffix(value) {
  const text = normalizeAliasText(value);
  if (!text) return "";
  return text
    .replace(/\b(cafe|café|coffee|restaurant|studio|roastery|bar)\b/gi, " ")
    .replace(/(?:คาเฟ่|ร้านกาแฟ|สตูดิโอ|โรสเตอรี|บาร์)\s*$/gi, " ")
    .replace(/[&/|,-]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectAlias(value, out = []) {
  const text = normalizeAliasText(value);
  if (!text) return out;
  out.push(text);
  const reduced = stripPlaceTypeSuffix(text);
  if (reduced && reduced !== text) out.push(reduced);
  return out;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function extractCharsetFromContentType(contentType) {
  const match = String(contentType || "").match(/charset=([^\s;]+)/i);
  return toText(match?.[1] || "").replace(/^["']|["']$/g, "").toLowerCase();
}

function extractCharsetFromHtmlHint(text) {
  const metaCharset = String(text || "").match(/<meta[^>]+charset=["']?\s*([a-z0-9._-]+)/i);
  if (metaCharset?.[1]) return toText(metaCharset[1]).toLowerCase();
  const metaContentType = String(text || "").match(/<meta[^>]+content=["'][^"']*charset=([a-z0-9._-]+)/i);
  return toText(metaContentType?.[1] || "").toLowerCase();
}

function normalizeCharset(charset) {
  const raw = toText(charset).toLowerCase();
  if (!raw) return "";
  if (raw === "tis-620") return "windows-874";
  return raw;
}

function decodeHtmlBuffer(buffer, contentType, maxChars = MAX_HTML_CHARS) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || new ArrayBuffer(0));
  const hintedAscii = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const charset = normalizeCharset(extractCharsetFromContentType(contentType) || extractCharsetFromHtmlHint(hintedAscii) || "utf-8");
  try {
    return new TextDecoder(charset).decode(bytes).slice(0, Math.max(1, Number(maxChars || MAX_HTML_CHARS)));
  } catch {
    return new TextDecoder("utf-8").decode(bytes).slice(0, Math.max(1, Number(maxChars || MAX_HTML_CHARS)));
  }
}

function looksLikeThaiMojibake(value) {
  const text = String(value || "");
  return text.includes("Ã Â¸") || text.includes("Ã Â¹") || text.includes("Ã¯Â¿Â½");
}

function cleanExtractedText(value) {
  const text = decodeHtmlEntities(value);
  return looksLikeThaiMojibake(text) ? "" : text;
}

function stripHtmlTags(value) {
  return cleanExtractedText(String(value || "").replace(/<[^>]+>/g, " "));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return "";
}

function absolutizeUrl(value, baseUrl) {
  const raw = toText(value);
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function toHostLabel(value) {
  return toText(value).replace(/^www\./i, "");
}

const GOOGLE_MAPS_HOSTS = new Set([
  "google.com",
  "google.co.th",
  "maps.google.com",
  "maps.google.co.th",
  "maps.app.goo.gl",
  "goo.gl",
]);

function getRecognizedGoogleMapsKind(value) {
  try {
    const parsed = new URL(toText(value));
    const host = toHostLabel(parsed.hostname).toLowerCase();
    const path = String(parsed.pathname || "");
    if (!GOOGLE_MAPS_HOSTS.has(host)) return "";
    if ((host === "google.com" || host === "google.co.th") && !/^\/maps(?:\/|$)/i.test(path)) return "";
    if (host === "goo.gl" && !/^\/maps(?:\/|$)/i.test(path)) return "";
    return host;
  } catch {
    return "";
  }
}

function isRecognizedGoogleMapsUrl(value) {
  return Boolean(getRecognizedGoogleMapsKind(value));
}

function extractGoogleMapsPlaceTitle(value) {
  try {
    const parsed = new URL(toText(value));
    if (!isRecognizedGoogleMapsUrl(parsed.toString())) return "";
    const match = String(parsed.pathname || "").match(/\/maps\/place\/([^/?#]+)/i);
    if (!match?.[1]) return "";
    return safeDecodeURIComponent(String(match[1]).replace(/\+/g, " ")).trim();
  } catch {
    return "";
  }
}

function parseGoogleMapsCoordinatePair(value) {
  const text = toText(value);
  const match = text.match(/^\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*$/);
  if (!match) return { matched: false, value: null };
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { matched: true, value: null };
  if (latitude < -90 || latitude > 90) return { matched: true, value: null };
  if (longitude < -180 || longitude > 180) return { matched: true, value: null };
  return { matched: true, value: { latitude, longitude } };
}

function extractGoogleMapsUrlDetails(value) {
  const text = toText(value);
  if (!text || !isRecognizedGoogleMapsUrl(text)) return null;

  const pinMatch = text.match(/!3d([-+]?\d+(?:\.\d+)?)!4d([-+]?\d+(?:\.\d+)?)/i);
  if (pinMatch?.[1] && pinMatch?.[2]) {
    const parsed = parseGoogleMapsCoordinatePair(`${pinMatch[1]},${pinMatch[2]}`);
    if (!parsed.value) return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: null, tier: "pin" };
    return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: parsed.value, tier: "pin" };
  }

  try {
    const parsedUrl = new URL(text);
    for (const key of ["q", "query"]) {
      for (const rawValue of parsedUrl.searchParams.getAll(key)) {
        const parsed = parseGoogleMapsCoordinatePair(rawValue);
        if (parsed.matched) {
          if (!parsed.value) return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: null, tier: "query" };
          return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: parsed.value, tier: "query" };
        }
      }
    }
  } catch {
    return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: null, tier: null };
  }

  const viewportMatch = text.match(/@([-+]?\d+(?:\.\d+)?),\s*([-+]?\d+(?:\.\d+)?)/i);
  if (viewportMatch?.[1] && viewportMatch?.[2]) {
    const parsed = parseGoogleMapsCoordinatePair(`${viewportMatch[1]},${viewportMatch[2]}`);
    if (!parsed.value) return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: null, tier: "viewport" };
    return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: parsed.value, tier: "viewport" };
  }

  return { recognized: true, mapUrl: text, title: extractGoogleMapsPlaceTitle(text), coordinate: null, tier: null };
}

function selectManualGoogleMapsDetails(...values) {
  const candidates = [];
  for (const rawValue of values) {
    const value = toText(rawValue);
    const details = extractGoogleMapsUrlDetails(value);
    if (details) candidates.push(details);
  }

  const mapUrl = toText(candidates.find((candidate) => candidate?.mapUrl)?.mapUrl);
  const title = firstNonEmpty(...candidates.map((candidate) => candidate?.title));
  for (const tier of ["pin", "query", "viewport"]) {
    const selected = candidates.find((candidate) => candidate?.tier === tier && candidate?.coordinate);
    if (selected) {
      return {
        title,
        mapUrl,
        latitude: selected.coordinate.latitude,
        longitude: selected.coordinate.longitude,
      };
    }
  }
  return mapUrl
    ? {
        title,
        mapUrl,
        latitude: null,
        longitude: null,
      }
    : null;
}

function buildFallbackTitle(sourceUrl) {
  const googleMapsTitle = extractGoogleMapsPlaceTitle(sourceUrl);
  if (googleMapsTitle) return googleMapsTitle;
  try {
    const parsed = new URL(sourceUrl);
    const host = toHostLabel(parsed.hostname);
    const path = toText(parsed.pathname).replace(/\/+/g, "/");
    return path && path !== "/" ? `${host}${path}` : host;
  } catch {
    return sourceUrl;
  }
}

function deriveHostName(value) {
  try {
    return toHostLabel(new URL(value).hostname);
  } catch {
    return "";
  }
}

function isGeneratedManualTitle(value, sourceUrl) {
  const text = toText(value);
  if (!text) return false;
  return text === buildFallbackTitle(sourceUrl);
}

function isGeneratedManualDescription(value) {
  const text = toText(value);
  return Boolean(text) && /^นำเข้าจากลิงก์ที่ผู้ใช้วาง:/i.test(text);
}

function isGeneratedManualEditorial(value) {
  return toText(value) === "นำเข้าจาก URL ที่ผู้ใช้วางเข้าระบบ";
}

function isGenericGoogleMapsFetchedTitle(value) {
  const text = toText(value).toLowerCase();
  return text === "google maps" || text === "google" || text === "maps";
}

function extractMetaContent(html, key, attr = "name") {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]+${attr}=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escapedKey}["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return cleanExtractedText(match?.[1] || match?.[2] || "");
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanExtractedText(match?.[1] || "");
}

function extractCanonical(html) {
  const match = html.match(
    /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>|<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i
  );
  return toText(match?.[1] || match?.[2] || "");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
    return out;
  }
  if (typeof value !== "object") return out;
  out.push(value);
  if (Array.isArray(value["@graph"])) {
    flattenJsonLd(value["@graph"], out);
  }
  return out;
}

function extractJsonLdObjects(html) {
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let match;
  while ((match = pattern.exec(html))) {
    const parsed = safeJsonParse(match[1]);
    if (!parsed) continue;
    flattenJsonLd(parsed, out);
  }
  return out;
}

function extractWongnaiStructuredState(html) {
  const match = String(html || "").match(/<script>\s*window\._wn\s*=\s*([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  const raw = String(match[1]).trim().replace(/;\s*$/, "");
  return safeJsonParse(raw);
}

function collectImageUrlsFromStructuredValue(value, baseUrl, hostHint = "", out = []) {
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (typeof current === "string") {
      const abs = absolutizeUrl(current, baseUrl);
      if (!abs || !/^https?:\/\//i.test(abs)) continue;
      if (hostHint && !abs.toLowerCase().includes(hostHint.toLowerCase())) continue;
      out.push(abs);
      continue;
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const entryValue of Object.values(current)) {
      stack.push(entryValue);
    }
  }
  return out;
}

function extractImageUrlsFromStructuredState(html, baseUrl, hostHint = "", limit = MAX_MEDIA_ITEMS) {
  const state = extractWongnaiStructuredState(html);
  if (!state) return [];
  return dedupeMediaUrls(
    collectImageUrlsFromStructuredValue(state, baseUrl, hostHint, []),
    limit
  );
}

function collectImageMatches(html, baseUrl, hostHint = "") {
  const out = [];
  const pushMatch = (rawValue, index = 0) => {
    const candidates = String(rawValue || "")
      .split(",")
      .map((part) => toText(part).split(/\s+/)[0])
      .filter(Boolean);
    for (const candidate of candidates) {
      const abs = absolutizeUrl(candidate, baseUrl);
      if (!abs) continue;
      if (!/^https?:\/\//i.test(abs)) continue;
      if (hostHint && !abs.toLowerCase().includes(hostHint.toLowerCase())) continue;
      out.push({ url: abs, index: index || 0 });
    }
  };
  const patterns = [
    /(https?:\/\/[^"'\\\s>]+?\.(?:jpg|jpeg|png|webp))/gi,
    /(?:src|data-src|data-original|srcset|data-srcset)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi,
    /(?:content|href)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      pushMatch(match[1] || match[0], match.index || 0);
    }
  }
  return out;
}

function extractImageUrlsFromHtml(html, baseUrl, hostHint = "", limit = MAX_MEDIA_ITEMS) {
  const out = [];
  for (const match of collectImageMatches(html, baseUrl, hostHint)) {
    const abs = match?.url;
    if (!abs) continue;
    out.push(abs);
    if (out.length >= limit * 6) break;
  }
  return dedupeMediaUrls(out, limit);
}

function isLikelyGenericContentImageUrl(value, baseUrl = "", pageProfile = PAGE_PROFILE_BUSINESS) {
  const raw = toText(value);
  if (!raw) return false;
  if (isMalformedObjectMediaUrl(raw)) return false;
  try {
    const parsed = new URL(raw, baseUrl || undefined);
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
    const decodedPath = safeDecodeURIComponent(path);
    if (!/\.(?:jpg|jpeg|png|webp|avif|gif)$/i.test(parsed.pathname || "")) return false;
    if (/\[object\s+object\]/i.test(decodedPath)) return false;
    if (/(?:^|[\\/._-])(logo|icon|favicon|avatar|sprite|loader|loading|placeholder|blank)(?:[\\/._-]|$)/i.test(path)) return false;
    if (/(?:apple-touch-icon|android-chrome|mstile|site-logo|brand-logo|social-share)/i.test(path)) return false;
    if (
      pageProfile === PAGE_PROFILE_INSTITUTIONAL &&
      (
        /\/layout\//i.test(path) ||
        /\/themes?\d*\//i.test(path) ||
        /\/images\/decorations\//i.test(path) ||
        /valid-xhtml|webaccessibility|black_ribbon|icon-rss/i.test(path) ||
        /(?:^|[\\/._-])wc\d+(?:[\\/._-]|$)/i.test(path) ||
        (/\/layout\//i.test(path) && /page\.(?:jpg|jpeg|png|webp|gif)$/i.test(path))
      )
    ) return false;
    const dimensionMatch = String(parsed.pathname || "").match(/-(\d{2,4})x(\d{2,4})\.(?:jpg|jpeg|png|webp|avif|gif)$/i);
    if (dimensionMatch) {
      const width = Number(dimensionMatch[1] || 0);
      const height = Number(dimensionMatch[2] || 0);
      if ((Number.isFinite(width) && width > 0 && width < 320) || (Number.isFinite(height) && height > 0 && height < 320)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function isMalformedObjectMediaUrl(value) {
  const raw = toText(value);
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (/\[object(?:\s|%20)+object\]/i.test(lower)) return true;
  const decoded = safeDecodeURIComponent(lower);
  return /\[object\s+object\]/i.test(decoded);
}

function extractGenericContentImageUrls(html, baseUrl, limit = MAX_MEDIA_ITEMS, pageProfile = PAGE_PROFILE_BUSINESS) {
  const ranked = [];
  for (const match of collectImageMatches(html, baseUrl, "")) {
    const abs = toText(match?.url);
    if (!abs || !isLikelyGenericContentImageUrl(abs, baseUrl, pageProfile)) continue;
    ranked.push({
      url: abs,
      index: Number(match?.index || 0),
      score: scoreGenericContentImage(abs, Number(match?.index || 0), baseUrl, pageProfile),
    });
    if (ranked.length >= limit * 12) break;
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  return dedupeMediaUrls(ranked.map((entry) => entry.url), limit);
}

function rankGenericContentImageUrls(values = [], baseUrl = "", options = {}) {
  const ranked = [];
  const startIndex = Number(options.startIndex || 0) || 0;
  const step = Math.max(1, Number(options.step || 1000));
  const pageProfile = toText(options.pageProfile || PAGE_PROFILE_BUSINESS) || PAGE_PROFILE_BUSINESS;
  for (const [offset, rawValue] of (Array.isArray(values) ? values : []).entries()) {
    const abs = toText(rawValue);
    if (!abs || !isLikelyGenericContentImageUrl(abs, baseUrl, pageProfile)) continue;
    ranked.push({
      url: abs,
      index: startIndex + (offset * step),
      score: scoreGenericContentImage(abs, startIndex + (offset * step), baseUrl, pageProfile),
    });
  }
  return ranked;
}

function scoreGenericContentImage(value, index = 0, baseUrl = "", pageProfile = PAGE_PROFILE_BUSINESS) {
  const raw = toText(value);
  if (!raw) return -10000;
  try {
    const parsed = new URL(raw, baseUrl || undefined);
    const path = safeDecodeURIComponent(`${parsed.pathname}${parsed.search}`.toLowerCase());
    let score = 0;
    if (/\.(?:jpe?g|webp)$/i.test(parsed.pathname || "")) score += 40;
    if (/\/(?:uploads|wp-content|images?|media|gallery|photos?)\//i.test(path)) score += 60;
    if (/(hero|cover|gallery|photo|interior|exterior|room|villa|suite|cafe|coffee|restaurant|hotel|lobby|dining|bar|bakery|matcha)/i.test(path)) score += 120;
    if (/(promo|campaign|ads?|share|social|thumb|thumbnail|qr|map|banner)/i.test(path)) score -= 160;
    if (/(logo|icon|avatar|placeholder|blank|sprite)/i.test(path)) score -= 300;
    if (pageProfile === PAGE_PROFILE_INSTITUTIONAL) {
      if (/\/uploads\/tinymce\/source\//i.test(path)) score += 120;
      if (/\/(?:layout|themes?)\//i.test(path)) score -= 320;
      if (/\/images\/decorations\//i.test(path)) score -= 360;
      if (/valid-xhtml|webaccessibility|black_ribbon|icon-rss/i.test(path)) score -= 400;
      if (/page\.(?:jpg|jpeg|png|webp|gif)$/i.test(path)) score -= 220;
    }
    const dimensionMatch = String(parsed.pathname || "").match(/-(\d{2,4})x(\d{2,4})\.(?:jpg|jpeg|png|webp|avif|gif)$/i);
    if (dimensionMatch) {
      const width = Number(dimensionMatch[1] || 0);
      const height = Number(dimensionMatch[2] || 0);
      const area = (Number.isFinite(width) ? width : 0) * (Number.isFinite(height) ? height : 0);
      if (area >= 800 * 800) score += 100;
      else if (area >= 500 * 500) score += 40;
      else score -= 80;
    }
    score += Math.max(0, 240 - Math.floor(Math.max(0, Number(index || 0)) / 2500));
    return score;
  } catch {
    return -10000;
  }
}

function extractImageUrlsNearKeywords(html, baseUrl, keywords = [], hostHint = "", limit = MAX_MEDIA_ITEMS) {
  const safeKeywords = (Array.isArray(keywords) ? keywords : []).map((value) => toText(value).toLowerCase()).filter(Boolean);
  if (!safeKeywords.length) return [];
  const lowerHtml = String(html || "").toLowerCase();
  const out = [];
  for (const match of collectImageMatches(html, baseUrl, hostHint)) {
    const abs = match?.url;
    const matchIndex = Number(match?.index || 0);
    const context = lowerHtml.slice(Math.max(0, matchIndex - 320), Math.min(lowerHtml.length, matchIndex + 320));
    if (!safeKeywords.some((keyword) => context.includes(keyword))) continue;
    if (!abs) continue;
    out.push(abs);
    if (out.length >= limit * 6) break;
  }
  return dedupeMediaUrls(out, limit);
}

function buildWongnaiPhotosUrl(finalUrl) {
  const raw = toText(finalUrl);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.search = "";
    const pathname = String(parsed.pathname || "").replace(/\/+$/, "");
    if (!pathname) return "";
    parsed.pathname = pathname.endsWith("/photos") ? pathname : `${pathname}/photos`;
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractTextBlocksFromHtml(html, limit = 8, options = {}) {
  const safeHtml = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const tagPattern = toText(options.tagPattern || "h1|h2|h3|p|li");
  const minLength = Math.max(1, Number(options.minLength || 25));
  const maxLength = Math.max(minLength, Number(options.maxLength || 600));
  const pattern = new RegExp(`<(${tagPattern})[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  const out = [];
  const seen = new Set();
  let match;
  while ((match = pattern.exec(safeHtml))) {
    const text = stripHtmlTags(match[2]).replace(/\s+/g, " ").trim();
    if (!text || text.length < minLength || text.length > maxLength) continue;
    if (options.filterBoilerplate && isLikelyBoilerplateArticleText(text)) continue;
    if (typeof options.filterFn === "function" && options.filterFn(text)) continue;
    const key = normalizeFactKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function extractFactBlocksFromHtml(html, limit = 40) {
  return extractTextBlocksFromHtml(html, limit, {
    tagPattern: "h1|h2|h3|h4|p|li|td",
    minLength: 8,
    maxLength: 220,
  });
}

function buildAddressText(value) {
  if (!value || typeof value !== "object") return "";
  return uniqueTextList([
    value.streetAddress,
    value.addressLocality,
    value.addressRegion,
    value.postalCode,
    value.addressCountry,
  ]).join(" ");
}

function extractSchemaAmenityFacts(value) {
  const rows = Array.isArray(value) ? value : [value];
  const out = [];
  for (const entry of rows) {
    if (!entry) continue;
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (typeof entry !== "object") continue;
    const name = firstNonEmpty(entry.name, entry.value);
    const enabled = entry.value === true || entry.value === "true" || entry.value == null;
    if (!name || enabled === false) continue;
    out.push(name);
  }
  return dedupeFactList(out, MAX_FACT_ITEMS);
}

function extractOpeningHoursFromTextBlocks(blocks = []) {
  return dedupeFactList(
    (Array.isArray(blocks) ? blocks : []).filter((text) => {
      if (!text) return false;
      const hasKeyword = /(opening|open|hours|daily|every day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|เวลา|เปิด|ทุกวัน|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)/i.test(text);
      const hasTime = /(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to|ถึง)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)|(?:\d{1,2}\s*(?:am|pm)\s*(?:-|–|to)\s*\d{1,2}\s*(?:am|pm))/i.test(text);
      return hasKeyword && hasTime;
    }),
    7
  );
}

function extractServiceFactsFromTextBlocks(blocks = []) {
  return dedupeFactList(
    (Array.isArray(blocks) ? blocks : []).filter((text) =>
      /(wifi|wi-fi|parking|car park|pet|pet-friendly|delivery|takeaway|take away|reservation|booking|private room|meeting room|pool|spa|fitness|gym|shuttle|accessible|wheelchair|outdoor seating|ที่จอดรถ|ไวไฟ|wi fi|รับจอง|จองโต๊ะ|เดลิเวอรี|สั่งกลับบ้าน|ห้องประชุม|สระว่ายน้ำ|ฟิตเนส|สปา|บริการรับส่ง|สัตว์เลี้ยง)/i.test(text)
    ),
    MAX_FACT_ITEMS
  );
}

function extractPriceSignalsFromTextBlocks(blocks = [], fallbackPriceRange = "") {
  return dedupeFactList(
    [
      toText(fallbackPriceRange),
      ...(Array.isArray(blocks) ? blocks : []).filter((text) =>
        /(฿|\bbaht\b|บาท|ราคา|price|เริ่มต้น|starting at|starting from|from\s+\d)/i.test(text)
      ),
    ],
    MAX_PRICE_SIGNAL_ITEMS
  );
}

function extractInstitutionalPriceSignalsFromTextBlocks(blocks = [], fallbackPriceRange = "") {
  return dedupeFactList(
    [
      toText(fallbackPriceRange),
      ...(Array.isArray(blocks) ? blocks : []).filter((text) =>
        /(ค่าธรรมเนียม|ค่าเข้าชม|อัตราค่าเข้าชม|admission|ticket|entrance fee|ค่าใช้จ่าย|เปิดให้เข้าชมฟรี|free entry)/i.test(text)
      ),
    ],
    MAX_PRICE_SIGNAL_ITEMS
  );
}

function extractInstitutionalFactBlocks(html, limit = 60) {
  const maxItems = Math.max(1, Number(limit || 60));
  const blocks = [];
  const seen = new Set();
  const pushBlocks = (values = []) => {
    for (const raw of Array.isArray(values) ? values : []) {
      const text = toText(raw);
      if (!text) continue;
      const key = normalizeFactKey(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      blocks.push(text);
      if (blocks.length >= maxItems) break;
    }
  };

  const filterFn = (text) => {
    if (isLikelyInstitutionalBoilerplateText(text)) return true;
    if (
      text.length <= 120
      && /(หน้าแรก|frontpage|about us|service|ติดต่อเรา|แผนที่|การเดินทาง|ข่าวประชาสัมพันธ์|คลังวิชาการ|ความรู้ทั่วไป|ประชาชนควรรู้|เมนูหลัก)/i.test(text)
    ) {
      return true;
    }
    return false;
  };

  for (const candidate of extractInstitutionalContainerCandidates(html, 4)) {
    pushBlocks(extractTextBlocksFromHtml(candidate.html, maxItems, {
      tagPattern: "p|li|td|div",
      minLength: 8,
      maxLength: 260,
      filterFn,
    }));
    if (blocks.length >= maxItems) break;
  }

  if (blocks.length < maxItems) {
    pushBlocks(extractTextBlocksFromHtml(html, maxItems, {
      tagPattern: "p|li|td",
      minLength: 8,
      maxLength: 220,
      filterFn,
    }));
  }

  return blocks.slice(0, maxItems);
}

function extractInstitutionalAddressFromTextBlocks(blocks = []) {
  const matches = dedupeFactList(
    (Array.isArray(blocks) ? blocks : []).filter((text) =>
      /(ถนน|ถ\.)/.test(text)
      || /(ตำบล|แขวง|อำเภอ|เขต|จังหวัด|รหัสไปรษณีย์|อุบลราชธานี)/i.test(text)
      || /\b\d{5}\b/.test(text)
    ),
    3
  );
  return matches[0] || "";
}

function extractInstitutionalPhoneFromTextBlocks(blocks = []) {
  for (const text of Array.isArray(blocks) ? blocks : []) {
    if (!/(โทร|โทรศัพท์|phone|tel)/i.test(text)) continue;
    const match = text.match(/(\+?[0-9][0-9\s-]{7,})/);
    const value = cleanExtractedText(match?.[1] || "");
    if (normalizePhoneValue(value)) return value;
  }
  return "";
}

function extractEmailFromHtml(html) {
  const mailto = html.match(/href=["']mailto:([^"']+)["']/i);
  if (mailto?.[1]) return cleanExtractedText(mailto[1]);
  const visible = html.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return cleanExtractedText(visible?.[0] || "");
}

function looksLikeFoodPlace(...values) {
  return values.some((value) =>
    /(cafe|café|coffee|restaurant|food|bakery|dessert|brunch|bistro|bar|kitchen|tea|matcha|คาเฟ่|กาแฟ|ร้านอาหาร|อาหาร|เบเกอรี่|เบเกอรี|ของหวาน|ชา|มัทฉะ)/i.test(
      toText(value)
    )
  );
}

function extractMenuFactsFromTextBlocks(blocks = [], hints = {}) {
  if (!looksLikeFoodPlace(hints.category, hints.title, hints.description)) {
    return {
      menuSections: [],
      menuHighlights: [],
    };
  }

  const sourceBlocks = Array.isArray(blocks) ? blocks : [];
  const isMarketingLine = (text) =>
    /(ยินดีต้อนรับ|พักผ่อน|เติมพลัง|ศาสตร์และศิลป์|หัวใจสำคัญ|จาก\s+ร้าน|welcome|our story|discover|experience|ครบวงจร|ใส่ใจคุณที่สุด|คาเฟ่ใกล้ฉัน|ร้านนมอุบลปิดดึก)/i.test(text);
  const menuSections = dedupeFactList(
    sourceBlocks.filter((text) => {
      const hasKeyword = /(menu|drinks?|beverages?|coffee|non-coffee|tea|matcha|bakery|cake|dessert|pastry|brunch|breakfast|lunch|dinner|เครื่องดื่ม|เมนู|ไม่ใช่กาแฟ|ชา|มัทฉะ|เบเกอรี่|เค้ก|ของหวาน|บรันช์|อาหารเช้า|อาหารกลางวัน|อาหารเย็น)/i.test(text);
      const looksLikeSection = text.length <= 48 && text.split(/\s+/).length <= 6 && !/(฿|\bbaht\b|บาท)/i.test(text);
      return hasKeyword && looksLikeSection && !isMarketingLine(text);
    }),
    MAX_MENU_SECTION_ITEMS
  );

  const menuHighlights = dedupeFactList(
    sourceBlocks.filter((text) => {
      const hasPrice = /(฿|\bbaht\b|บาท)/i.test(text);
      const hasMenuSignal = /(signature|recommended|popular|best seller|chef'?s special|เมนูแนะนำ|ขายดี|ซิกเนเจอร์)/i.test(text);
      const hasFoodKeyword = /(coffee|matcha|tea|latte|espresso|americano|dessert|cake|pastry|croissant|toast|brunch|breakfast|lunch|dinner|เมนู|มัทฉะ|ชา|ลาเต้|เอสเปรสโซ|อเมริกาโน|เค้ก|ครัวซองต์|ขนมปัง|ของหวาน|อาหารเช้า|อาหารกลางวัน|อาหารเย็น)/i.test(text);
      const looksLikeConcreteItem = /[:\-–•]|(?:\d+\s*(?:฿|บาท|baht))|(?:จาก\s*\d+)/i.test(text);
      return text.length >= 8
        && text.length <= 140
        && !isMarketingLine(text)
        && ((hasPrice && hasFoodKeyword) || (hasMenuSignal && hasFoodKeyword && looksLikeConcreteItem));
    }),
    MAX_MENU_HIGHLIGHT_ITEMS
  );

  return {
    menuSections,
    menuHighlights,
  };
}

function extractReviewCountFromHtml(html) {
  const patterns = [
    /"reviewCount"\s*:\s*"?(?<value>\d[\d,]*)"?/i,
    /"ratingCount"\s*:\s*"?(?<value>\d[\d,]*)"?/i,
    /(?<value>\d[\d,]*)\s*รีวิว/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const n = toNumber(match?.groups?.value || "");
    if (n != null) return n;
  }
  return null;
}

function extractRatingFromHtml(html) {
  const patterns = [
    /"ratingValue"\s*:\s*"?(?<value>\d+(?:\.\d+)?)"?/i,
    /"rating"\s*:\s*"?(?<value>\d+(?:\.\d+)?)"?/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const n = toNumber(match?.groups?.value || "");
    if (n != null) return n;
  }
  return null;
}

function extractPhoneFromHtml(html) {
  const telLink = html.match(/href=["']tel:([^"']+)["']/i);
  if (telLink?.[1]) return cleanExtractedText(telLink[1]);
  const visible = html.match(/(?:โทร|phone|tel)[^0-9+]*(\+?[0-9][0-9\s-]{7,})/i);
  return cleanExtractedText(visible?.[1] || "");
}

function extractWongnaiReviewCount(html, generic = {}) {
  const patterns = [
    /อ่าน\s*(?<value>\d[\d,]*)\s*รีวิว/i,
    /(?<value>\d[\d,]*)\s*รีวิว/i,
    /"reviewCount"\s*:\s*"?(?<value>\d[\d,]*)"?/i,
    /"reviewsCount"\s*:\s*"?(?<value>\d[\d,]*)"?/i,
    /"numberOfReviews"\s*:\s*"?(?<value>\d[\d,]*)"?/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const n = toNumber(match?.groups?.value || "");
    if (n != null && n > 0) return n;
  }
  return generic.reviewCount != null ? generic.reviewCount : null;
}

function extractWongnaiRating(html, generic = {}) {
  const patterns = [
    /"ratingValue"\s*:\s*"?(?<value>[1-5](?:\.\d+)?)"?/i,
    /"averageRating"\s*:\s*"?(?<value>[1-5](?:\.\d+)?)"?/i,
    /"rating"\s*:\s*"?(?<value>[1-5](?:\.\d+)?)"?/i,
    /(?<value>[1-5](?:\.\d+)?)\s*\/\s*5/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const n = toNumber(match?.groups?.value || "");
    if (n != null && n > 0 && n <= 5) return n;
  }
  return generic.rating != null && generic.rating > 0 ? generic.rating : null;
}

function extractWongnaiPhone(html, generic = {}) {
  const patterns = [
    /"telephone"\s*:\s*"(?<value>[^"]+)"/i,
    /"phone(?:Number)?"\s*:\s*"(?<value>[^"]+)"/i,
    /(?:โทร|call|phone)[^0-9+]{0,40}(?<value>(?:\+66|0)[0-9\s-]{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = cleanExtractedText(match?.groups?.value || "");
    if (normalizePhoneValue(value)) return value;
  }
  return generic.phone || "";
}

function extractWongnaiAddress(html, generic = {}) {
  const patterns = [
    /"formattedAddress"\s*:\s*"(?<value>[^"]+)"/i,
    /"streetAddress"\s*:\s*"(?<value>[^"]+)"/i,
    /"address"\s*:\s*"(?<value>[^"]*อุบลราชธานี[^"]*)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = cleanExtractedText(match?.groups?.value || "");
    if (value) return value;
  }
  const description = String(generic.description || "");
  const afterPipe = description.split("|").map((part) => toText(part)).filter(Boolean).pop() || "";
  return afterPipe || generic.address || "";
}

function extractWongnaiAlternateTitles(title, description) {
  const out = [];
  const withParens = [...extractAlternateTitles(title, description)];
  for (const value of withParens) {
    collectAlias(value, out);
  }

  const baseTitle = normalizeAliasText(String(title || "").split("|")[0]);
  if (baseTitle) {
    const parenMatch = baseTitle.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (parenMatch) {
      collectAlias(parenMatch[1], out);
      collectAlias(parenMatch[2], out);
    } else {
      collectAlias(baseTitle, out);
    }
  }

  const descriptionMatches = String(description || "").matchAll(/จากร้าน\s+([^|]+?)(?:\s+-|\s+\||$)/gi);
  for (const match of descriptionMatches) {
    collectAlias(match?.[1] || "", out);
  }

  return uniqueTextList(out);
}

function normalizeArticleSectionKey(value) {
  return toText(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFactKey(value) {
  return toText(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s:%฿-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeFactList(values = [], limit = MAX_FACT_ITEMS) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const text = toText(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = normalizeFactKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= Math.max(1, Number(limit || MAX_FACT_ITEMS))) break;
  }
  return out;
}

function isLikelyBoilerplateArticleText(value) {
  const text = toText(value);
  if (!text) return true;
  if (/target\s*=\s*"_blank"|click to|best rate guarantee|special offers?/i.test(text)) return true;
  if (/^period\s*:/i.test(text)) return true;
  if (/copyright|all rights reserved|website design|booking engine/i.test(text)) return true;
  if (/-->|<--|&gt;|&lt;/.test(text)) return true;
  if (/^(rooms?|villas?|forest wing|indigo wing|dining|local attractions?)\b/i.test(text)) return true;
  if (/^(home|about|contact|book now|reservation|offers?)\b/i.test(text)) return true;
  if (/[A-Za-z]/.test(text) && text.split(/\s+/).length <= 4 && /room|suite|wing|offer|dining|attraction/i.test(text)) return true;
  return false;
}

function isLikelyInstitutionalBoilerplateText(value) {
  const text = toText(value);
  if (!text) return true;
  if (isLikelyBoilerplateArticleText(text)) return true;
  if (looksLikeInstitutionalNavigationLine(text)) return true;
  if (text.length <= 80 && /(ข่าวประชาสัมพันธ์|คลังวิชาการ|ความรู้ทั่วไป|ประชาชนควรรู้|กฎหมายและระเบียบ|เมนูหลัก|หน้าหลัก|แผนผังเว็บไซต์|ติดต่อเรา)/i.test(text)) {
    return true;
  }
  if (text.length <= 60 && /(skip to|rss|accessibility|xhtml|copyright|all rights reserved)/i.test(text)) {
    return true;
  }
  return false;
}

function looksLikeInstitutionalNavigationLine(value) {
  const text = toText(value);
  if (!text) return false;
  const navMatches = text.match(/(หน้าหลัก|frontpage|เกี่ยวกับหน่วยงาน|เกี่ยวกับด่าน|ติดต่อเรา|แผนผังเว็บไซต์|วิสัยทัศน์|พันธกิจ|ยุทธศาสตร์|หน่วยงานกรมศุลกากร|ภารกิจและพื้นที่รับผิดชอบ|โครงสร้าง\/อัตรากำลัง|ทำเนียบนายด่าน|ข่าวประชาสัมพันธ์|คลังวิชาการ|ความรู้ทั่วไป|การบริการ|service|แผนที่|การเดินทาง)/gi) || [];
  if (navMatches.length >= 3 && text.length <= 260) return true;
  if (/^(หน้าหลัก|frontpage)\b/i.test(text)) return true;
  if (/^(เกี่ยวกับหน่วยงาน|เกี่ยวกับด่าน|วิสัยทัศน์\/พันธกิจ\/ยุทธศาสตร์|ทำเนียบนายด่าน|โครงสร้าง\/อัตรากำลัง|ภารกิจและพื้นที่รับผิดชอบ)\b/i.test(text)) return true;
  if (/(หน้าหลัก|frontpage).*(ติดต่อเรา|แผนผังเว็บไซต์|วิสัยทัศน์|พันธกิจ|ยุทธศาสตร์)/i.test(text)) return true;
  if (/^(ประวัติ.*?หน้าหลัก\s+)/i.test(text)) return true;
  return false;
}

function extractInstitutionalContainerCandidates(html, limit = 6) {
  const safeHtml = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const pattern = /<(article|main|section|div|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const positivePattern = /(content|article|entry|post|detail|maincontent|main-content|page-content|detail-content|article-detail|post-content|entry-content|news-detail|box[_-]?detail|contentdetail|moduletable|museum|about|history)/i;
  const negativePattern = /(nav|menu|breadcrumb|sidebar|side-bar|footer|header|banner|comment|social|share|widget|toolbar|copyright)/i;
  const out = [];
  const seen = new Set();
  let match;
  while ((match = pattern.exec(safeHtml))) {
    const attrs = String(match[2] || "");
    const innerHtml = String(match[3] || "");
    const attrCorpus = safeDecodeURIComponent(attrs.toLowerCase());
    const text = stripHtmlTags(innerHtml).replace(/\s+/g, " ").trim();
    if (!text || text.length < 160) continue;
    if (negativePattern.test(attrCorpus)) continue;
    let score = 0;
    if (match[1] === "article" || match[1] === "main") score += 4;
    if (positivePattern.test(attrCorpus)) score += 6;
    if (/(พิพิธภัณฑ|museum|history|about|ประวัติ|ข้อมูลทั่วไป)/i.test(text.slice(0, 240))) score += 2;
    if (text.length >= 1200) score += 3;
    else if (text.length >= 600) score += 2;
    if (score <= 0) continue;
    const key = normalizeFactKey(text.slice(0, 400));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      html: innerHtml,
      score,
      length: text.length,
      index: Number(match.index || 0),
    });
    if (out.length >= Math.max(1, Number(limit || 6)) * 4) break;
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.length !== a.length) return b.length - a.length;
    return a.index - b.index;
  });
  return out.slice(0, Math.max(1, Number(limit || 6)));
}

function extractInstitutionalArticleSections(html, limit = MAX_ARTICLE_SECTION_ITEMS) {
  const maxItems = Math.max(1, Number(limit || MAX_ARTICLE_SECTION_ITEMS));
  const sections = [];
  const seen = new Set();
  const pushSections = (values = []) => {
    for (const raw of Array.isArray(values) ? values : []) {
      const text = toText(raw);
      if (!text) continue;
      const key = normalizeArticleSectionKey(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sections.push(text);
      if (sections.length >= maxItems) break;
    }
  };

  const containerCandidates = extractInstitutionalContainerCandidates(html, 4);
  for (const candidate of containerCandidates) {
    pushSections(extractTextBlocksFromHtml(candidate.html, maxItems, {
      tagPattern: "h1|h2|h3|h4|p|li|td|div",
      minLength: 35,
      maxLength: Number.POSITIVE_INFINITY,
      filterFn: isLikelyInstitutionalBoilerplateText,
    }));
    if (sections.length >= maxItems) break;
  }

  if (sections.length < maxItems) {
    pushSections(extractTextBlocksFromHtml(html, maxItems, {
      tagPattern: "h1|h2|h3|h4|p|td|div",
      minLength: 35,
      maxLength: Number.POSITIVE_INFINITY,
      filterFn: isLikelyInstitutionalBoilerplateText,
    }));
  }

  return sections.slice(0, maxItems);
}

function isUsefulArticleSection(value, options = {}) {
  const text = toText(value);
  if (text.length < 35) return false;
  if (/^(โทร|phone|tel|อ่าน|รีวิว|rating|open|ปิดทุกวัน)/i.test(text)) return false;
  if (looksLikeInstitutionalNavigationLine(text)) return false;
  const key = normalizeArticleSectionKey(text);
  if (!key || key.length < 20) return false;
  const headlineKey = normalizeArticleSectionKey(options.headline);
  const excerptKey = normalizeArticleSectionKey(options.excerpt);
  if (headlineKey && key === headlineKey) return false;
  if (excerptKey && key === excerptKey) return false;
  return true;
}

function mergeArticleData(baseArticle, extraSections = [], fallbackHeadline = "", options = {}) {
  const base = baseArticle && typeof baseArticle === "object" ? baseArticle : {};
  const headline = toText(base.headline || fallbackHeadline);
  const excerpt = toText(base.excerpt);
  const limit = Math.max(1, Number(options.limit || MAX_ARTICLE_SECTION_ITEMS));
  const sectionTexts = uniqueTextList([
    ...(Array.isArray(base.section_texts) ? base.section_texts : []),
    ...(Array.isArray(extraSections) ? extraSections : []),
  ])
    .filter((text) => isUsefulArticleSection(text, { headline, excerpt }))
    .slice(0, limit);

  return {
    headline,
    excerpt,
    body_text: sectionTexts.join("\n\n"),
    section_texts: sectionTexts,
    page_title: toText(base.page_title || fallbackHeadline || headline),
  };
}

function inferGenericPageProfile(sourceUrl, finalUrl, hints = {}) {
  const targetUrl = firstNonEmpty(finalUrl, sourceUrl);
  const host = deriveHostName(targetUrl);
  if (/\.go\.th$/i.test(host)) {
    return PAGE_PROFILE_INSTITUTIONAL;
  }
  const path = (() => {
    try {
      return String(new URL(targetUrl).pathname || "").toLowerCase();
    } catch {
      return "";
    }
  })();
  const corpus = [
    host,
    path,
    toText(hints.title),
    toText(hints.description),
    toText(hints.category),
  ].join(" ");

  let institutionalScore = 0;
  if (/\.(?:go\.th|ac\.th|or\.th|gov|edu)$/i.test(host)) institutionalScore += 4;
  if (/(กรม|กระทรวง|สำนักงาน|สำนัก|เทศบาล|องค์การบริหาร|มหาวิทยาลัย|วิทยาลัย|พิพิธภัณฑ|museum|fine arts|national museum|province|จังหวัด|tourism authority)/i.test(corpus)) {
    institutionalScore += 2;
  }
  if (/(?:\/|^)(about|history|museum|tourism|travel|categorie|category)(?:\/|$)/i.test(path)) {
    institutionalScore += 1;
  }
  if (looksLikeFoodPlace(hints.category, hints.title, hints.description, path)) {
    institutionalScore -= 4;
  }
  if (/(hotel|resort|villa|restaurant|cafe|coffee|roastery|bakery|menu|booking|reserve)/i.test(corpus)) {
    institutionalScore -= 2;
  }
  return institutionalScore >= 3 ? PAGE_PROFILE_INSTITUTIONAL : PAGE_PROFILE_BUSINESS;
}

function extractSchemaPlaceData(html, finalUrl) {
  const objects = extractJsonLdObjects(html);
  const scoreType = (entry) => {
    const types = uniqueTextList([entry?.["@type"]].flat()).map((value) => value.toLowerCase());
    if (types.some((type) => type.includes("restaurant") || type.includes("cafe") || type.includes("foodestablishment"))) return 4;
    if (types.some((type) => type.includes("localbusiness") || type.includes("place") || type.includes("touristattraction") || type.includes("lodgingbusiness"))) return 3;
    if (types.some((type) => type.includes("organization") || type.includes("webpage"))) return 1;
    return 0;
  };
  const best = [...objects].sort((a, b) => scoreType(b) - scoreType(a))[0] || null;
  if (!best) {
    return {
      title: "",
      description: "",
      image: "",
      address: "",
      phone: "",
      rating: null,
      reviewCount: null,
      category: "",
      openingHours: [],
      latitude: null,
      longitude: null,
      menuUrl: "",
      priceRange: "",
      serviceFacts: [],
      sourceName: "",
      websiteUrl: "",
      reviewSnippets: [],
    };
  }

  const imageValue = Array.isArray(best.image) ? best.image[0] : best.image?.url || best.image;
  const imageGallery = (Array.isArray(best.image) ? best.image : [best.image])
    .map((value) => absolutizeUrl(value?.url || value, finalUrl))
    .filter(Boolean)
    .slice(0, MAX_MEDIA_ITEMS);
  const aggregate = best.aggregateRating && typeof best.aggregateRating === "object" ? best.aggregateRating : {};
  const geo = best.geo && typeof best.geo === "object" ? best.geo : {};
  const reviews = Array.isArray(best.review) ? best.review : [];
  const reviewItems = reviews.map((review) => ({
    text: firstNonEmpty(review?.reviewBody, review?.description),
    rating: toNumber(review?.reviewRating?.ratingValue),
    author: firstNonEmpty(review?.author?.name, review?.author),
    relative_time: firstNonEmpty(review?.datePublished),
  })).filter((row) => row.text).slice(0, MAX_REVIEW_ITEMS);
  return {
    title: firstNonEmpty(best.name, best.headline),
    description: firstNonEmpty(best.description, best.disambiguatingDescription),
    image: absolutizeUrl(imageValue, finalUrl),
    imageGallery,
    address: buildAddressText(best.address),
    phone: firstNonEmpty(best.telephone, best.contactPoint?.telephone),
    rating: toNumber(aggregate.ratingValue),
    reviewCount: toNumber(aggregate.reviewCount || aggregate.ratingCount),
    category: firstNonEmpty(best.servesCuisine, best.category, Array.isArray(best["@type"]) ? best["@type"][0] : best["@type"]),
    openingHours: Array.isArray(best.openingHours) ? best.openingHours.map((row) => toText(row)).filter(Boolean) : [],
    latitude: toNumber(geo.latitude),
    longitude: toNumber(geo.longitude),
    menuUrl: absolutizeUrl(firstNonEmpty(best.hasMenu?.url, best.hasMenu, best.menu?.url, best.menu), finalUrl),
    priceRange: toText(best.priceRange),
    serviceFacts: extractSchemaAmenityFacts(best.amenityFeature),
    sourceName: firstNonEmpty(best.publisher?.name, best.author?.name),
    websiteUrl: toText(best.url),
    reviewSnippets: reviewItems.slice(0, 3),
    reviewItems: reviewItems.slice(0, MAX_REVIEW_ITEMS),
  };
}

function extractGenericMetadata(html, sourceUrl, finalUrl) {
  const schema = extractSchemaPlaceData(html, finalUrl);
  const title = firstNonEmpty(
    extractMetaContent(html, "og:title", "property"),
    extractMetaContent(html, "twitter:title"),
    schema.title,
    extractTitle(html)
  );
  const description = firstNonEmpty(
    extractMetaContent(html, "og:description", "property"),
    extractMetaContent(html, "description"),
    extractMetaContent(html, "twitter:description"),
    schema.description
  );
  const pageProfile = inferGenericPageProfile(sourceUrl, finalUrl, {
    title,
    description,
    category: schema.category,
  });
  const textBlocks = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? extractInstitutionalArticleSections(html, 8)
    : extractTextBlocksFromHtml(html, 8, {
        tagPattern: "h1|h2|h3|p",
        minLength: 35,
        maxLength: 500,
        filterBoilerplate: true,
      });
  const factBlocks = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? extractInstitutionalFactBlocks(html, 80)
    : extractFactBlocksFromHtml(html, 80);
  const address = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? firstNonEmpty(schema.address, extractInstitutionalAddressFromTextBlocks(factBlocks))
    : schema.address;
  const phone = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? firstNonEmpty(schema.phone, extractInstitutionalPhoneFromTextBlocks(factBlocks), extractPhoneFromHtml(html))
    : firstNonEmpty(schema.phone, extractPhoneFromHtml(html));
  const contactEmail = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? extractEmailFromHtml(html)
    : "";
  const openingHours = Array.isArray(schema.openingHours) && schema.openingHours.length
    ? schema.openingHours
    : extractOpeningHoursFromTextBlocks(factBlocks);
  const serviceFacts = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? dedupeFactList(Array.isArray(schema.serviceFacts) ? schema.serviceFacts : [], MAX_FACT_ITEMS)
    : dedupeFactList([
        ...(Array.isArray(schema.serviceFacts) ? schema.serviceFacts : []),
        ...extractServiceFactsFromTextBlocks(factBlocks),
      ], MAX_FACT_ITEMS);
  const priceSignals = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? extractInstitutionalPriceSignalsFromTextBlocks(factBlocks, schema.priceRange)
    : extractPriceSignalsFromTextBlocks(factBlocks, schema.priceRange);
  const menuFacts = pageProfile === PAGE_PROFILE_INSTITUTIONAL
    ? { menuSections: [], menuHighlights: [] }
    : extractMenuFactsFromTextBlocks(factBlocks, {
        category: schema.category,
        title,
        description,
      });
  const baseImageCandidates = [
    firstNonEmpty(
      absolutizeUrl(extractMetaContent(html, "og:image", "property"), finalUrl || sourceUrl),
      absolutizeUrl(extractMetaContent(html, "twitter:image"), finalUrl || sourceUrl),
      schema.image
    ),
    ...(Array.isArray(schema.imageGallery) ? schema.imageGallery : []),
  ].filter((url) => !isMalformedObjectMediaUrl(url));
  const genericRanked = rankGenericContentImageUrls(
    extractGenericContentImageUrls(html, finalUrl || sourceUrl, MAX_MEDIA_ITEMS * 2, pageProfile),
    finalUrl || sourceUrl,
    { startIndex: 10000, step: 500, pageProfile }
  );
  const allRankedImages = [
    ...rankGenericContentImageUrls(baseImageCandidates, finalUrl || sourceUrl, { startIndex: 0, step: 500, pageProfile }),
    ...genericRanked,
  ].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  const mediaUrls = dedupeMediaUrls(allRankedImages.map((entry) => entry.url), MAX_MEDIA_ITEMS);
  return {
    title,
    description,
    image: mediaUrls[0] || "",
    mediaUrls,
    canonical: firstNonEmpty(absolutizeUrl(extractCanonical(html), finalUrl || sourceUrl), schema.websiteUrl),
    address,
    phone,
    contactEmail,
    latitude: schema.latitude,
    longitude: schema.longitude,
    rating: schema.rating ?? extractRatingFromHtml(html),
    reviewCount: schema.reviewCount ?? extractReviewCountFromHtml(html),
    category: schema.category,
    openingHours,
    serviceFacts,
    priceSignals,
    menuUrl: schema.menuUrl,
    menuSections: menuFacts.menuSections,
    menuHighlights: menuFacts.menuHighlights,
    pageProfile,
    sourceName: schema.sourceName,
    reviewSnippets: schema.reviewSnippets,
    reviewItems: Array.isArray(schema.reviewItems) ? schema.reviewItems.slice(0, MAX_REVIEW_ITEMS) : [],
    article: {
      headline: title,
      excerpt: description,
      body_text: textBlocks.join("\n\n"),
      section_texts: textBlocks,
      page_title: extractTitle(html),
    },
    alternateTitles: extractAlternateTitles(title, description),
    fullAddressNormalized: normalizeAddressValue(schema.address),
    phoneNormalized: normalizePhoneValue(firstNonEmpty(schema.phone, extractPhoneFromHtml(html))),
  };
}

function extractWongnaiEnrichment(html, finalUrl, generic, options = {}) {
  const title = normalizeAliasText(
    firstNonEmpty(
      generic.title.split("|")[0],
      generic.title,
      extractMetaContent(html, "og:title", "property")
    )
  );
  const description = firstNonEmpty(generic.description, extractMetaContent(html, "og:description", "property"));
  const address = extractWongnaiAddress(html, { ...generic, description });
  const phone = extractWongnaiPhone(html, generic);
  const reviewCount = extractWongnaiReviewCount(html, generic);
  const rating = extractWongnaiRating(html, generic);
  const alternateTitles = extractWongnaiAlternateTitles(title, description);
  const photosHtml = toText(options.photosHtml || "");
  const photosUrl = toText(options.photosUrl || "");
  const galleryMediaUrls = dedupeMediaUrls([
    ...extractImageUrlsFromStructuredState(photosHtml, photosUrl || finalUrl, "img.wongnai.com", MAX_WONGNAI_GALLERY_PROBE_ITEMS),
    ...extractImageUrlsFromStructuredState(html, finalUrl, "img.wongnai.com", MAX_WONGNAI_GALLERY_PROBE_ITEMS),
    ...extractImageUrlsFromHtml(photosHtml, photosUrl || finalUrl, "img.wongnai.com", MAX_WONGNAI_GALLERY_PROBE_ITEMS),
    ...extractImageUrlsFromHtml(html, finalUrl, "img.wongnai.com", MAX_WONGNAI_GALLERY_PROBE_ITEMS),
  ], MAX_WONGNAI_GALLERY_PROBE_ITEMS);
  let mediaUrls = dedupeMediaUrls([
    ...(Array.isArray(generic.mediaUrls) ? generic.mediaUrls : []),
    ...galleryMediaUrls,
  ], MAX_WONGNAI_MEDIA_ITEMS);
  if (mediaUrls.length < MAX_WONGNAI_MEDIA_ITEMS) {
    const reviewCommentMediaUrls = extractImageUrlsNearKeywords(
      html,
      finalUrl,
      ["review", "reviews", "comment", "comments", "รีวิว"],
      "img.wongnai.com",
      MAX_WONGNAI_COMMENT_PROBE_ITEMS
    );
    mediaUrls = dedupeMediaUrls([...mediaUrls, ...reviewCommentMediaUrls], MAX_WONGNAI_MEDIA_ITEMS);
  }
  const reviewItems = Array.isArray(generic.reviewItems) ? generic.reviewItems.slice(0, MAX_REVIEW_ITEMS) : [];
  const articleSections = uniqueTextList([
    description,
    ...reviewItems.map((row) => toText(row?.text)).filter((text) => text.length >= 50),
  ]).slice(0, MAX_ARTICLE_SECTION_ITEMS);
  return {
    ...generic,
    title,
    description,
    sourceName: "wongnai.com",
    category: firstNonEmpty(generic.category, "restaurant"),
    address,
    phone,
    rating,
    reviewCount,
    alternateTitles,
    mediaUrls,
    reviewItems,
    article: mergeArticleData(
      {
        ...(generic.article && typeof generic.article === "object" ? generic.article : {}),
        headline: firstNonEmpty(generic.article?.headline, title),
        excerpt: firstNonEmpty(generic.article?.excerpt, description),
        page_title: firstNonEmpty(generic.article?.page_title, title),
      },
      articleSections,
      title,
      { limit: MAX_ARTICLE_SECTION_ITEMS }
    ),
    fullAddressNormalized: normalizeAddressValue(address),
    phoneNormalized: normalizePhoneValue(phone),
  };
}

function extractGoogleMapsLinkEnrichment(finalUrl, generic) {
  try {
    const parsed = new URL(finalUrl);
    const queryName = firstNonEmpty(parsed.searchParams.get("q"), parsed.searchParams.get("query"));
    return {
      ...generic,
      title: firstNonEmpty(generic.title, queryName),
      canonical: finalUrl,
      sourceName: "google_maps_link",
    };
  } catch {
    return {
      ...generic,
      canonical: finalUrl,
      sourceName: "google_maps_link",
    };
  }
}

function extractFacebookEnrichment(html, generic) {
  return {
    ...generic,
    title: firstNonEmpty(generic.title, extractMetaContent(html, "og:title", "property")),
    description: firstNonEmpty(generic.description, extractMetaContent(html, "og:description", "property")),
    image: firstNonEmpty(generic.image, extractMetaContent(html, "og:image", "property")),
    sourceName: "facebook.com",
    category: firstNonEmpty(generic.category, "social_page"),
  };
}

function extractTikTokEnrichment(html, generic) {
  return {
    ...generic,
    title: firstNonEmpty(generic.title, extractMetaContent(html, "og:title", "property")),
    description: firstNonEmpty(generic.description, extractMetaContent(html, "og:description", "property")),
    image: firstNonEmpty(generic.image, extractMetaContent(html, "og:image", "property")),
    sourceName: "tiktok.com",
    category: firstNonEmpty(generic.category, "social_video"),
  };
}

function resolveDomainMetadata(html, finalUrl, sourceUrl, options = {}) {
  const host = (() => {
    try {
      return toHostLabel(new URL(finalUrl || sourceUrl).hostname);
    } catch {
      return "";
    }
  })();
  const generic = extractGenericMetadata(html, sourceUrl, finalUrl);
  if (host.includes("wongnai.com")) return extractWongnaiEnrichment(html, finalUrl, generic, options);
  if (isRecognizedGoogleMapsUrl(finalUrl || sourceUrl) || isRecognizedGoogleMapsUrl(sourceUrl)) {
    return extractGoogleMapsLinkEnrichment(finalUrl || sourceUrl, generic);
  }
  if (host.includes("facebook.com") || host.includes("fb.com")) return extractFacebookEnrichment(html, generic);
  if (host.includes("tiktok.com")) return extractTikTokEnrichment(html, generic);
  return generic;
}

async function fetchHtmlDocument(sourceUrl, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "UbonCityCollector/1.0 (+manual-url-intake)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const finalUrl = toText(response.url || sourceUrl);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return { finalUrl, contentType, html: "" };
    }
    return {
      finalUrl,
      contentType,
      html: decodeHtmlBuffer(await response.arrayBuffer(), contentType, options.maxHtmlChars),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUrlMetadata(sourceUrl) {
  const mainDoc = await fetchHtmlDocument(sourceUrl);
  const finalUrl = toText(mainDoc.finalUrl || sourceUrl);
  const contentType = String(mainDoc.contentType || "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    return {
      finalUrl,
      metadata: {
        title: "",
        description: "",
        image: "",
        mediaUrls: [],
        canonical: "",
        address: "",
        phone: "",
        rating: null,
        reviewCount: null,
        category: "",
        openingHours: [],
        sourceName: "",
        reviewSnippets: [],
        reviewItems: [],
        article: null,
      },
      contentType,
    };
  }

  const html = mainDoc.html || "";
  let photosHtml = "";
  let photosUrl = "";
  try {
    const host = toHostLabel(new URL(finalUrl).hostname);
    if (host.includes("wongnai.com")) {
      const targetPhotosUrl = buildWongnaiPhotosUrl(finalUrl);
      if (targetPhotosUrl) {
        const photosDoc = await fetchHtmlDocument(targetPhotosUrl, { maxHtmlChars: MAX_WONGNAI_PHOTOS_HTML_CHARS });
        if (String(photosDoc.contentType || "").includes("text/html") || String(photosDoc.contentType || "").includes("application/xhtml+xml")) {
          photosHtml = toText(photosDoc.html);
          photosUrl = toText(photosDoc.finalUrl || targetPhotosUrl);
        }
      }
    }
  } catch {
    photosHtml = "";
    photosUrl = "";
  }
  return {
    finalUrl,
    metadata: resolveDomainMetadata(html, finalUrl, sourceUrl, { photosHtml, photosUrl }),
    contentType,
  };
}

function buildManualFallbackRow(row = {}, errorMessage = "", manualUrlDetails = null) {
  const sourceUrl = toText(row.source_url || row.url || row.website_url);
  const mapUrl = toText(manualUrlDetails?.mapUrl);
  const parsedLatitude = manualUrlDetails?.latitude ?? null;
  const parsedLongitude = manualUrlDetails?.longitude ?? null;
  const fallbackTitle = firstNonEmpty(manualUrlDetails?.title, buildFallbackTitle(sourceUrl));
  return normalizeRawItem(
    {
      ...row,
      type: toText(row.type || "place") || "place",
      category: toText(row.category || "attractions") || "attractions",
      lang: toText(row.lang || "th") || "th",
      title: toText(row.title || row.name || fallbackTitle),
      description: toText(row.description || row.caption || row.review_text || "Imported from pasted URL"),
      source_name: toText(row.source_name || "manual-url"),
      source_url: sourceUrl,
      website_url: sourceUrl,
      source_ref: toText(row.source_ref || sourceUrl),
      map_url: mapUrl,
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      payload_json: {
        ...(row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}),
        submitted_url: sourceUrl,
        fetched_url: sourceUrl,
        metadata_fetch_error: toText(errorMessage || "manual_url enrichment failed"),
      },
    },
    "manual"
  );
}

async function enrichManualRow(row = {}) {
  try {
    const sourceUrl = toText(row.source_url || row.url || row.website_url);
    if (!sourceUrl) {
      return normalizeRawItem(row, "manual");
    }

    const sourceManualUrlDetails = selectManualGoogleMapsDetails(sourceUrl);

    let fetchResult = null;
    let fetchError = "";
    try {
      fetchResult = await fetchUrlMetadata(sourceUrl);
    } catch (error) {
      fetchError = toText(error?.message || "metadata fetch failed");
    }

    const finalUrl = toText(fetchResult?.finalUrl || sourceUrl);
    const metadata = fetchResult?.metadata || {};
    const resolvedManualUrlDetails = selectManualGoogleMapsDetails(finalUrl, sourceUrl) || sourceManualUrlDetails;
    const host = (() => {
      try {
        return toHostLabel(new URL(finalUrl).hostname);
      } catch {
        return toHostLabel(sourceUrl);
      }
    })();

    const addressText = toText(metadata.address);
    const fullAddressNormalized = toText(metadata.fullAddressNormalized || normalizeAddressValue(addressText));
    const openingHours = Array.isArray(metadata.openingHours) ? metadata.openingHours.map((row) => toText(row)).filter(Boolean) : [];
    const reviewSnippets = Array.isArray(metadata.reviewSnippets) ? metadata.reviewSnippets : [];
    const reviewItems = Array.isArray(metadata.reviewItems) ? metadata.reviewItems.slice(0, MAX_REVIEW_ITEMS) : [];
    const mediaLimit = metadata.sourceName === "wongnai.com" || host.includes("wongnai.com") ? MAX_WONGNAI_MEDIA_ITEMS : MAX_MEDIA_ITEMS;
    const mediaUrls = dedupeMediaUrls(Array.isArray(metadata.mediaUrls) ? metadata.mediaUrls : [], mediaLimit);
    const article = metadata.article && typeof metadata.article === "object" ? metadata.article : null;
    const alternateTitles = uniqueTextList(Array.isArray(metadata.alternateTitles) ? metadata.alternateTitles : []);
    const phoneNormalized = toText(metadata.phoneNormalized || normalizePhoneValue(metadata.phone));
    const rowTitle = toText(row.title || row.name);
    const rowDescription = toText(row.description || row.caption || row.review_text);
    const rowEditorial = toText(row.editorial_summary);
    const rowCategory = toText(row.category);
    const safeRowTitle = isGeneratedManualTitle(rowTitle, sourceUrl) ? "" : rowTitle;
    const safeRowDescription = isGeneratedManualDescription(rowDescription) ? "" : rowDescription;
    const safeRowEditorial = isGeneratedManualEditorial(rowEditorial) ? "" : rowEditorial;
    const preferredCategory = rowCategory && rowCategory !== "attractions" ? rowCategory : "";
    const description = uniqueTextList([
      safeRowDescription,
      metadata.description,
      addressText,
      openingHours[0] || "",
    ]).join(" | ") || (host ? `Imported from pasted URL: ${host}` : "Imported from pasted URL");
    const isGoogleMapsPlaceUrl = isRecognizedGoogleMapsUrl(finalUrl) || isRecognizedGoogleMapsUrl(sourceUrl);
    const reliableMetadataTitle = isGoogleMapsPlaceUrl && isGenericGoogleMapsFetchedTitle(metadata.title) ? "" : metadata.title;
    const googleMapsFallbackTitle = firstNonEmpty(resolvedManualUrlDetails?.title, buildFallbackTitle(finalUrl));
    const title = isGoogleMapsPlaceUrl
      ? firstNonEmpty(safeRowTitle, reliableMetadataTitle, googleMapsFallbackTitle)
      : firstNonEmpty(reliableMetadataTitle, safeRowTitle, buildFallbackTitle(finalUrl));
    const imageUrl = firstNonEmpty(row.image, row.image_url, metadata.image, mediaUrls[0]);
    const canonicalUrl = firstNonEmpty(metadata.canonical, finalUrl);
    const resolvedCategory = firstNonEmpty(preferredCategory, metadata.category, rowCategory, "attractions");
    const tags = uniqueTextList(["manual-url", host, resolvedCategory, metadata.category]);

    return normalizeRawItem(
      {
        ...row,
        type: toText(row.type || "place") || "place",
        category: resolvedCategory,
        lang: toText(row.lang || "th") || "th",
        title: firstNonEmpty(title, resolvedManualUrlDetails?.title),
        description,
        image: imageUrl,
        source_name: firstNonEmpty(row.source_name, metadata.sourceName, host, "manual-url"),
        source_url: sourceUrl,
        website_url: canonicalUrl,
        editorial_summary: firstNonEmpty(metadata.description, safeRowEditorial, description),
        tags,
        source_ref: firstNonEmpty(row.source_ref, canonicalUrl, finalUrl),
        map_url: toText(resolvedManualUrlDetails?.mapUrl),
        latitude: resolvedManualUrlDetails?.latitude ?? metadata.latitude,
        longitude: resolvedManualUrlDetails?.longitude ?? metadata.longitude,
        rating: metadata.rating,
        user_rating_count: metadata.reviewCount,
        review_count: metadata.reviewCount,
        national_phone_number: metadata.phone,
        alternate_titles: alternateTitles,
        full_address_normalized: fullAddressNormalized,
        phone_normalized: phoneNormalized,
        opening_hours_weekday_text: openingHours,
        primary_type_display_name: metadata.category,
        review_snippets: reviewSnippets,
        payload_json: {
          ...(row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}),
          submitted_url: sourceUrl,
          fetched_url: finalUrl,
          fetched_content_type: toText(fetchResult?.contentType),
          metadata_fetch_error: fetchError || null,
          extracted_metadata: {
            title: toText(metadata.title),
            description: toText(metadata.description),
            image: toText(metadata.image),
            canonical: toText(metadata.canonical),
            address: addressText,
            full_address_normalized: fullAddressNormalized,
            phone: toText(metadata.phone),
            contact_email: toText(metadata.contactEmail),
            phone_normalized: phoneNormalized,
            alternate_titles: alternateTitles,
            latitude: metadata.latitude,
            longitude: metadata.longitude,
            rating: metadata.rating,
            review_count: metadata.reviewCount,
            category: toText(metadata.category),
            page_profile: toText(metadata.pageProfile),
            opening_hours: openingHours,
            service_facts: dedupeFactList(metadata.serviceFacts, MAX_FACT_ITEMS),
            price_signals: dedupeFactList(metadata.priceSignals, MAX_PRICE_SIGNAL_ITEMS),
            menu_url: toText(metadata.menuUrl),
            menu_sections: dedupeFactList(metadata.menuSections, MAX_MENU_SECTION_ITEMS),
            menu_highlights: dedupeFactList(metadata.menuHighlights, MAX_MENU_HIGHLIGHT_ITEMS),
          },
          extracted_article: article
            ? {
                headline: toText(article.headline),
                excerpt: toText(article.excerpt),
                body_text: toText(article.body_text),
                section_texts: Array.isArray(article.section_texts) ? article.section_texts.map((part) => toText(part)).filter(Boolean) : [],
                page_title: toText(article.page_title),
              }
            : null,
          extracted_reviews: {
            count_found: reviewItems.length,
            items: reviewItems
              .map((row) => ({
                text: toText(row?.text),
                rating: toNumber(row?.rating),
                author: toText(row?.author),
                relative_time: toText(row?.relative_time),
              }))
              .filter((row) => row.text),
          },
        },
        media: mediaUrls.length
          ? mediaUrls.map((mediaUrl, index) => ({
              media_url: mediaUrl,
              metadata_json: {
                source: "manual_url_metadata",
                role: index === 0 ? "hero" : "gallery",
                order: index,
              },
            }))
          : (imageUrl ? [{ media_url: imageUrl, metadata_json: { source: "manual_url_metadata", role: "hero", order: 0 } }] : []),
      },
      "manual"
    );
  } catch (error) {
    const sourceUrl = toText(row.source_url || row.url || row.website_url);
    return buildManualFallbackRow(row, error?.message, selectManualGoogleMapsDetails(sourceUrl));
  }
}

async function enrichManualRowWithTimeout(row = {}) {
  let timer = null;
  try {
    return await Promise.race([
      enrichManualRow(row),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`manual_url enrichment timed out after ${ENRICH_ROW_TIMEOUT_MS}ms`));
        }, ENRICH_ROW_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const sourceUrl = toText(row.source_url || row.url || row.website_url);
    return buildManualFallbackRow(row, error?.message, selectManualGoogleMapsDetails(sourceUrl));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function collectFromManualPayload(payload = []) {
  const rows = Array.isArray(payload) ? payload : [];
  const out = [];
  for (const row of rows) {
    out.push(await enrichManualRowWithTimeout(row));
  }
  return out;
}

