const CTA_KEYS = ["phone", "line_url", "facebook_url", "website_url"];
const FACEBOOK_HOSTS = new Set(["facebook.com", "m.facebook.com", "mbasic.facebook.com", "fb.com"]);
const LINE_HOSTS = new Set(["line.me", "lin.ee", "liff.line.me"]);
const REJECTED_WEBSITE_HOSTS = new Set(["maps.google.com", "google.com", "maps.app.goo.gl", "g.page", "lh3.googleusercontent.com", "streetviewpixels-pa.googleapis.com", "api.mapbox.com"]);
const PHONE_LABELS = ["phone", "tel", "telephone", "mobile", "contact number", "phone number", "โทร", "โทรศัพท์", "เบอร์โทร", "เบอร์โทรศัพท์", "ติดต่อ"];
const URL_LABELS = ["website", "website url", "facebook", "facebook url", "line", "line url", "contact", "contact url", "เว็บไซต์", "เว็บ", "เพจ", "เฟซบุ๊ก", "ไลน์", "ลิงก์ติดต่อ"];
const URL_LIST_KEYS = new Set(["website", "website_url", "facebook", "facebook_url", "line", "line_url", "contact_url"]);

function text(value) {
  return String(value ?? "").trim();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUrl(value) {
  const raw = text(value).replace(/[.,;!?:ฯ،]+$/u, "");
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hostname(value) {
  return text(value).toLowerCase().replace(/^www\./, "");
}

// Shared with extractCandidates: a host CTA refuses to call a "website" must also never be cited as
// CTA provenance, or the provenance list ends up naming a source that looks like a rejected suggestion.
function isRejectedWebsiteHost(parsed) {
  const host = hostname(parsed.hostname);
  const path = parsed.pathname.toLowerCase();
  return REJECTED_WEBSITE_HOSTS.has(host)
    || host.startsWith("maps.google.")
    || (host.includes("google.") && (parsed.searchParams.has("cid") || path.includes("/maps") || path.includes("/place/")))
    || host.endsWith("googleusercontent.com")
    || host.endsWith("fbcdn.net")
    || host.startsWith("scontent.")
    || host.endsWith("wongnai.com")
    || (host === "goo.gl" && path.startsWith("/maps"))
    || /\.(jpg|jpeg|png|webp|gif|svg|mp4)$/i.test(path);
}

function classifyUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  const host = hostname(parsed.hostname);
  if (FACEBOOK_HOSTS.has(host) || host.endsWith(".facebook.com")) return { key: "facebook_url", value: normalized };
  if (LINE_HOSTS.has(host) || host.endsWith(".line.me")) return { key: "line_url", value: normalized };
  return isRejectedWebsiteHost(parsed) ? null : { key: "website_url", value: normalized };
}

export function normalizePhoneSuggestion(value) {
  const raw = text(value);
  if (!raw || !/^\+?[0-9\s\-()]+$/.test(raw)) return null;
  const compact = raw.replace(/[\s\-()]/g, "");
  if ((compact.match(/\+/g) || []).length > 1 || (compact.includes("+") && !compact.startsWith("+"))) return null;
  let local = compact;
  if (compact.startsWith("+66") || compact.startsWith("66")) {
    const national = compact.replace(/^\+?66/, "");
    if (!national || national.startsWith("0")) return null;
    local = `0${national}`;
  } else if (compact.startsWith("+")) {
    return null;
  }
  return /^0\d{8,9}$/.test(local) ? local : null;
}

export function getValidCtaSuggestedValue(key, value) {
  const normalizedKey = text(key).toLowerCase();
  if (normalizedKey === "phone") return normalizePhoneSuggestion(value);
  const classified = classifyUrl(value);
  return classified?.key === normalizedKey ? classified.value : null;
}

export function normalizeAiCtaContactJson(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of CTA_KEYS) {
    const normalized = getValidCtaSuggestedValue(key, source[key]);
    if (normalized) result[key] = normalized;
  }
  return result;
}

function recordsFromCleanContext(context = {}) {
  const approved = Array.isArray(context.approved_context) ? context.approved_context : [];
  return approved.map((row) => ({
    text: row?.selected_text,
    list: row?.selected_list,
    source: row?.provenance?.evidence_source_url,
  }));
}

function extractCandidates(context = {}) {
  const result = {};
  const sources = [];
  const phonePattern = new RegExp("(?:^|[\\s|,;([{])(?:" + PHONE_LABELS.map(escapeRegex).join("|") + ")\\s*[:：-]\\s*([+0-9][0-9\\s\\-()]{7,})", "giu");
  const urlPattern = new RegExp("(?:^|[\\s|,;([{])(?:" + URL_LABELS.map(escapeRegex).join("|") + ")\\s*[:：-]\\s*(https?:\\/\\/[^\\s<>\\])}|,;]+)", "giu");
  for (const record of recordsFromCleanContext(context)) {
    let used = false;
    for (const match of text(record.text).matchAll(phonePattern)) {
      if (!result.phone) {
        const phone = normalizePhoneSuggestion(match[1]);
        if (phone) {
          result.phone = phone;
          used = true;
        }
      }
    }
    const urls = [...text(record.text).matchAll(urlPattern)].map((match) => match[1]);
    for (const entry of Array.isArray(record.list) ? record.list : []) {
      const raw = text(entry);
      const separator = raw.indexOf("=");
      if (separator > 0 && URL_LIST_KEYS.has(raw.slice(0, separator).trim().toLowerCase())) urls.push(raw.slice(separator + 1));
    }
    for (const url of urls) {
      const classified = classifyUrl(url);
      if (classified && !result[classified.key]) {
        result[classified.key] = classified.value;
        used = true;
      }
    }
    const provenance = normalizeUrl(record.source);
    if (used && provenance && !isRejectedWebsiteHost(new URL(provenance))) sources.push(provenance);
  }
  if (sources.length) result.source = [...new Set(sources)];
  return result;
}

export function deriveCtaContactCandidatesFromStructuredContext(context = {}) {
  return extractCandidates(context);
}

function normalizeApprovedCtaContactCandidates(value) {
  const normalized = normalizeAiCtaContactJson(value);
  const source = Array.isArray(value?.source) ? value.source.map(normalizeUrl).filter(Boolean) : [];
  return source.length ? { ...normalized, source: [...new Set(source)] } : normalized;
}

export function mergeAiCtaWithDeterministicCandidates(aiValue = {}, structuredContext = {}) {
  const ai = normalizeAiCtaContactJson(aiValue);
  // The default parameter only covers `undefined`, and callers pass an explicit null when the item has
  // no structured context yet. An item with no context has no deterministic candidates, not a crash.
  const deterministic = normalizeApprovedCtaContactCandidates(extractCandidates(structuredContext || {}));
  const result = { ...ai };
  for (const key of ["phone", "line_url", "facebook_url", "website_url"]) {
    if (deterministic[key]) result[key] = deterministic[key];
  }
  if (deterministic.source?.length) result.source = deterministic.source;
  return result;
}

// §7A: CTA/contact is place-only. Every other CTA surface gates on this (requested-check rendering,
// accepted-metadata mapping), so suggestion generation must gate on it too.
export function isCtaEligibleItem(item) {
  return String(item?.type || "").trim().toLowerCase() === "place";
}