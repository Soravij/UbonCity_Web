const JUNK_MEDIA_EXTENSION_PATTERN = /\.(?:svg|ico)$/i;

const JUNK_MEDIA_FILENAME_KEYWORDS = [
  "logo",
  "favicon",
  "icon",
  "sprite",
  "placeholder",
  "avatar",
  "default",
  "blank",
  "spacer",
];

// Word-boundary match: keyword must be delimited by - _ . / or string boundary
// so "chome" does not match "home", and "banner-shot" still matches "banner".
function hasBoundedKeyword(filename, keyword) {
  const re = new RegExp(`(?:^|[-_./])${keyword}(?:[-_./]|$)`, "i");
  return re.test(filename);
}

const JUNK_MEDIA_PATH_SEGMENTS = [
  "/icons/",
  "/logos/",
  "/static/",
  "/static2/images/",
  "/assets/ui/",
  "/rsrc.php",
  "/images/menu/",
];

const DEFAULT_MEDIA_CAP = 30;

function toText(value) {
  return String(value ?? "").trim();
}

function resolveUrlPath(value) {
  try {
    return new URL(value).pathname || value;
  } catch {
    return value;
  }
}

// The crawler never downloads image bytes, so junk is classified from the URL
// shape alone (extension / filename / path), not from fetched content.
export function isJunkMediaUrl(value) {
  const raw = toText(value);
  if (!raw) return true;
  if (/^data:/i.test(raw)) return true;

  const path = resolveUrlPath(raw).toLowerCase();
  if (JUNK_MEDIA_EXTENSION_PATTERN.test(path)) return true;

  const filename = path.split("/").pop() || "";
  if (JUNK_MEDIA_FILENAME_KEYWORDS.some((keyword) => hasBoundedKeyword(filename, keyword))) return true;
  if (JUNK_MEDIA_PATH_SEGMENTS.some((segment) => path.includes(segment))) return true;

  return false;
}

// mediaList entries follow the source_raw_media shape: {media_url, metadata_json}.
// metadata_json varies by adapter — e.g. google-search stores the raw pagemap object,
// not a normalized {source, role, order} structure.
// Fallback to a single legacy image URL only applies when mediaList itself was empty from the start
// (never when filtering removed every entry) and the fallback URL must clear the junk filter too.
export function buildFilteredMediaList(mediaList = [], options = {}) {
  const fallbackImageUrl = toText(options.fallbackImageUrl);
  const cap = Math.max(1, Number(options.cap) || DEFAULT_MEDIA_CAP);

  const entries = (Array.isArray(mediaList) ? mediaList : [])
    .map((entry, index) => {
      const mediaUrl = toText(entry?.media_url || entry?.url);
      if (!mediaUrl) return null;
      const metadata = entry?.metadata_json && typeof entry.metadata_json === "object" ? entry.metadata_json : {};
      const orderRaw = metadata.order ?? entry?.order;
      const order = Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : index;
      const role = toText(metadata.role ?? entry?.role) || null;
      return { media_url: mediaUrl, role, order };
    })
    .filter(Boolean);

  if (!entries.length) {
    if (fallbackImageUrl && !isJunkMediaUrl(fallbackImageUrl)) {
      return [{ media_url: fallbackImageUrl, role: "hero", order: 0 }];
    }
    return [];
  }

  entries.sort((a, b) => a.order - b.order);

  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (isJunkMediaUrl(entry.media_url)) continue;
    if (seen.has(entry.media_url)) continue;
    seen.add(entry.media_url);
    out.push(entry);
    if (out.length >= cap) break;
  }
  return out;
}
