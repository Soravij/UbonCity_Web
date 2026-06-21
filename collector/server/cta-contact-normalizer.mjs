function toText(value) {
  return String(value ?? "").trim();
}

function normalizeHost(value) {
  return toText(value).toLowerCase().replace(/^www\./, "");
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]}]+/gi;
const CTA_KEYS = ["phone", "line_url", "facebook_url", "website_url", "primary_cta"];
const PRIMARY_CTA_VALUES = new Set(["phone", "line", "map"]);
const FACEBOOK_HOSTS = new Set(["facebook.com", "m.facebook.com", "mbasic.facebook.com", "fb.com"]);
const LINE_HOSTS = new Set(["line.me", "lin.ee", "liff.line.me"]);
const PHONE_ALLOWED_PATTERN = /^\+?[0-9\s\-()]+$/;
const PHONE_LABELS = [
  "phone",
  "tel",
  "telephone",
  "mobile",
  "contact number",
  "phone number",
  "โทร",
  "โทรศัพท์",
  "เบอร์โทร",
  "เบอร์โทรศัพท์",
  "ติดต่อ",
];
const SUPPORTED_PHONE_LABEL_EXAMPLES = [
  "โทร:",
  "โทรศัพท์:",
  "เบอร์โทร:",
  "เบอร์โทรศัพท์:",
  "ติดต่อ:",
  "Phone:",
  "Tel:",
  "Telephone:",
  "Mobile:",
  "Contact number:",
  "Phone number:",
];
const URL_LABELS = [
  "website",
  "website url",
  "facebook",
  "facebook url",
  "line",
  "line url",
  "contact",
  "contact url",
  "เว็บไซต์",
  "เว็บ",
  "เพจ",
  "เฟซบุ๊ก",
  "ไลน์",
  "ลิงก์ติดต่อ",
];
const SUPPORTED_URL_LABEL_EXAMPLES = [
  "Website:",
  "Website URL:",
  "Facebook:",
  "Facebook URL:",
  "LINE:",
  "LINE URL:",
  "Contact:",
  "Contact URL:",
  "เว็บไซต์:",
  "เว็บ:",
  "เพจ:",
  "เฟซบุ๊ก:",
  "ไลน์:",
  "ลิงก์ติดต่อ:",
];
const URL_LIST_KEYS = new Set([
  "website",
  "website_url",
  "facebook",
  "facebook_url",
  "line",
  "line_url",
  "contact_url",
]);
const REJECTED_WEBSITE_HOSTS = new Set([
  "maps.google.com",
  "google.com",
  "maps.app.goo.gl",
  "g.page",
  "lh3.googleusercontent.com",
  "streetviewpixels-pa.googleapis.com",
  "api.mapbox.com",
]);

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createLabelRegex(labels, capturePattern) {
  const labelPattern = labels.map(escapeRegex).join("|");
  return new RegExp(`(?:^|[\\s|,;([{"'\`])(?:${labelPattern})\\s*[:：-]\\s*(${capturePattern})`, "iu");
}

const PHONE_LABEL_PATTERN = createLabelRegex(PHONE_LABELS, "[+0-9][0-9\\s\\-()]{7,}");
const URL_TEXT_CAPTURE_PATTERN = String.raw`https?:\/\/[^\s<>"')\]}|,;]+(?=$|[\s<>"')\]}]|[|,;](?=$|[\s<>"')\]}]|[^|,;]{1,40}\s*[:：-]))`;
const URL_TEXT_LABEL_PATTERN = new RegExp(
  `(?:^|[\\s|,;([{"'\`])(?:${URL_LABELS.map(escapeRegex).join("|")})\\s*[:：-]\\s*(${URL_TEXT_CAPTURE_PATTERN})`,
  "giu"
);
const TRAILING_URL_PUNCTUATION_PATTERN = /[.,;!?:。ฯ،]+$/u;

function normalizeUrlValue(value) {
  const raw = toText(value).replace(TRAILING_URL_PUNCTUATION_PATTERN, "");
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeThaiPhoneValue(value) {
  const raw = toText(value);
  if (!raw) return null;
  if (!PHONE_ALLOWED_PATTERN.test(raw)) return null;
  const plusCount = (raw.match(/\+/g) || []).length;
  if (plusCount > 1 || (plusCount === 1 && !raw.startsWith("+"))) return null;
  const compact = raw.replace(/[\s\-()]/g, "");
  if (!compact) return null;
  let localNumber = compact;
  if (compact.startsWith("+66")) {
    const nationalNumber = compact.slice(3);
    if (!nationalNumber || nationalNumber.startsWith("0")) return null;
    localNumber = `0${nationalNumber}`;
  } else if (compact.startsWith("66")) {
    const nationalNumber = compact.slice(2);
    if (!nationalNumber || nationalNumber.startsWith("0")) return null;
    localNumber = `0${nationalNumber}`;
  } else if (compact.startsWith("+")) {
    return null;
  }
  return /^0\d{8,9}$/.test(localNumber) ? localNumber : null;
}

function extractPhoneFromLabeledText(value) {
  const text = toText(value);
  if (!text) return null;
  const pattern = new RegExp(PHONE_LABEL_PATTERN.source, "giu");
  for (const match of text.matchAll(pattern)) {
    const normalized = normalizeThaiPhoneValue(match?.[1]);
    if (normalized) return normalized;
  }
  return null;
}

function extractUrls(value) {
  const text = toText(value);
  return text.match(URL_PATTERN) || [];
}

function extractLabeledTextUrls(value) {
  const text = toText(value);
  if (!text) return [];
  return Array.from(text.matchAll(URL_TEXT_LABEL_PATTERN))
    .map((match) => normalizeUrlValue(match?.[1]))
    .filter(Boolean);
}

function extractExplicitListUrls(list = []) {
  const accepted = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const raw = String(entry || "").trim();
    if (!raw) continue;
    const separatorIndex = raw.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = raw.slice(0, separatorIndex).trim().toLowerCase();
    const value = raw.slice(separatorIndex + 1).trim();
    if (!URL_LIST_KEYS.has(key) || !value) continue;
    const url = normalizeUrlValue(value);
    if (url) accepted.push(url);
  }
  return accepted;
}

function buildUrlIdentity(url) {
  const normalized = normalizeUrlValue(url);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${parsed.protocol}//${normalizeHost(parsed.hostname)}${normalizedPath}?${parsed.searchParams.toString()}`;
}

function findMatchingProvenanceUrl(url, sources = []) {
  const targetIdentity = buildUrlIdentity(url);
  if (!targetIdentity) return null;
  return sources.some((value) => buildUrlIdentity(value) === targetIdentity)
    ? normalizeUrlValue(url)
    : null;
}

function getStructuredContextRecords(structuredContext = {}) {
  const approved = Array.isArray(structuredContext?.approved_context) ? structuredContext.approved_context : [];
  const evidence = Array.isArray(structuredContext?.evidence_blocks) ? structuredContext.evidence_blocks : [];
  return [
    ...approved.map((row) => ({
      text: row?.selected_text,
      list: row?.selected_list,
      source_url: row?.provenance?.evidence_source_url,
    })),
    ...evidence.map((row) => ({
      text: row?.text_value,
      list: row?.list_value,
      source_url: row?.source_url,
    })),
  ];
}

function isRejectedWebsiteUrl(url) {
  const normalized = normalizeUrlValue(url);
  if (!normalized) return true;
  const parsed = new URL(normalized);
  const host = normalizeHost(parsed.hostname);
  const path = parsed.pathname.toLowerCase();
  const fullPath = `${host}${path}`;

  if (FACEBOOK_HOSTS.has(host) || host.endsWith(".facebook.com")) return true;
  if (host.endsWith(".googleusercontent.com")) return true;
  if (host.endsWith(".fbcdn.net") || host.startsWith("scontent.")) return true;
  if (LINE_HOSTS.has(host) || host.endsWith(".line.me")) return true;
  if (REJECTED_WEBSITE_HOSTS.has(host)) return true;
  if (host.endsWith("wongnai.com")) return true;
  if (host === "goo.gl" && path.startsWith("/maps")) return true;
  if (host.startsWith("maps.google.")) return true;
  if (host.includes("google.") && (parsed.searchParams.has("cid") || path.includes("/maps") || path.includes("/place/"))) return true;
  if (/\.(jpg|jpeg|png|webp|gif|svg|mp4)$/i.test(path)) return true;
  return false;
}

function classifyUrl(url) {
  const normalized = normalizeUrlValue(url);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  const host = normalizeHost(parsed.hostname);
  if (FACEBOOK_HOSTS.has(host) || host.endsWith(".facebook.com")) {
    return { key: "facebook_url", value: normalized };
  }
  if (LINE_HOSTS.has(host) || host.endsWith(".line.me")) {
    return { key: "line_url", value: normalized };
  }
  if (isRejectedWebsiteUrl(normalized)) return null;
  return { key: "website_url", value: normalized };
}

export function normalizePrimaryCtaSuggestion(value) {
  const normalized = toText(value).toLowerCase();
  return PRIMARY_CTA_VALUES.has(normalized) ? normalized : null;
}

export function normalizePhoneSuggestion(value) {
  return normalizeThaiPhoneValue(value);
}

export function normalizeFacebookUrlSuggestion(value) {
  const classified = classifyUrl(value);
  return classified?.key === "facebook_url" ? classified.value : null;
}

export function normalizeLineUrlSuggestion(value) {
  const classified = classifyUrl(value);
  return classified?.key === "line_url" ? classified.value : null;
}

export function normalizeWebsiteUrlSuggestion(value) {
  const classified = classifyUrl(value);
  return classified?.key === "website_url" ? classified.value : null;
}

export function normalizeAiCtaContactJson(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  const phone = normalizePhoneSuggestion(source.phone);
  const lineUrl = normalizeLineUrlSuggestion(source.line_url);
  const facebookUrl = normalizeFacebookUrlSuggestion(source.facebook_url);
  const websiteUrl = normalizeWebsiteUrlSuggestion(source.website_url);
  const primaryCta = normalizePrimaryCtaSuggestion(source.primary_cta);
  if (phone) out.phone = phone;
  if (lineUrl) out.line_url = lineUrl;
  if (facebookUrl) out.facebook_url = facebookUrl;
  if (websiteUrl) out.website_url = websiteUrl;
  if (primaryCta) out.primary_cta = primaryCta;
  return out;
}

export function deriveCtaContactCandidatesFromStructuredContext(structuredContext = {}) {
  const records = getStructuredContextRecords(structuredContext);
  const candidates = {};
  const seenUrls = new Set();

  for (const record of records) {
    if (!candidates.phone) {
      const phone = extractPhoneFromLabeledText(record.text);
      if (phone) candidates.phone = phone;
    }

    const explicitTextUrls = extractLabeledTextUrls(record.text);
    const explicitListUrls = extractExplicitListUrls(record.list);
    const matchedProvenanceUrl = explicitTextUrls.length
      ? findMatchingProvenanceUrl(record.source_url, explicitTextUrls)
      : null;
    const urlValues = [
      ...(matchedProvenanceUrl ? [matchedProvenanceUrl] : []),
      ...explicitTextUrls,
      ...explicitListUrls,
    ].filter(Boolean);

    for (const rawUrl of urlValues) {
      const classified = classifyUrl(rawUrl);
      if (!classified) continue;
      const dedupeKey = `${classified.key}:${classified.value}`;
      if (seenUrls.has(dedupeKey)) continue;
      seenUrls.add(dedupeKey);
      if (!candidates[classified.key]) {
        candidates[classified.key] = classified.value;
      }
    }
  }

  return candidates;
}

export function mergeAiCtaWithDeterministicCandidates(aiValue = {}, structuredContext = {}) {
  const normalizedAi = normalizeAiCtaContactJson(aiValue);
  const deterministic = deriveCtaContactCandidatesFromStructuredContext(structuredContext);
  const out = { ...normalizedAi };
  for (const key of ["phone", "line_url", "facebook_url", "website_url"]) {
    if (deterministic[key]) out[key] = deterministic[key];
  }
  return out;
}

export function getValidCtaSuggestedValue(key, value) {
  switch (toText(key).toLowerCase()) {
    case "phone":
      return normalizePhoneSuggestion(value);
    case "line_url":
      return normalizeLineUrlSuggestion(value);
    case "facebook_url":
      return normalizeFacebookUrlSuggestion(value);
    case "website_url":
      return normalizeWebsiteUrlSuggestion(value);
    case "primary_cta":
      return normalizePrimaryCtaSuggestion(value);
    default:
      return null;
  }
}

export function hasCompactCtaCandidates(value = {}) {
  return CTA_KEYS.some((key) => toText(value?.[key]));
}
