const SITE_NAME = "UBONCITY.COM";
const DEFAULT_DESCRIPTION = "Ubon Ratchathani travel content";
const LANG_TO_LOCALE = {
  en: "en_US",
  th: "th_TH",
  zh: "zh_CN",
  lo: "lo_LA",
};
const TOURIST_ATTRACTION_CATEGORIES = new Set(["attractions", "activities"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function toTrimmedString(value) {
  return String(value || "").trim();
}

export function stripHtmlToPlainText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|figcaption)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildAbsoluteUrl(value, siteUrl = "") {
  const raw = toTrimmedString(value);
  if (!raw) return "";
  if (isValidUrl(raw)) return raw;
  const base = toTrimmedString(siteUrl).replace(/\/+$/, "");
  if (!base || !raw.startsWith("/")) return raw;
  return `${base}${raw}`;
}

export function pickPrimaryImage(entity = {}) {
  const candidates = [
    entity?.effective_cover_image,
    entity?.image,
    entity?.image_url,
    Array.isArray(entity?.media_gallery_images) ? entity.media_gallery_images[0] : "",
  ];
  return candidates.map((value) => toTrimmedString(value)).find(Boolean) || "";
}

function sanitizeDescription(value, maxLength = 160) {
  const plain = stripHtmlToPlainText(value);
  if (!plain) return "";
  return plain.slice(0, maxLength).trim();
}

function compactValue(value) {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const compacted = value.map((entry) => compactValue(entry)).filter((entry) => entry !== undefined);
    return compacted.length ? compacted : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, compactValue(entry)])
      .filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function compactObject(value) {
  return compactValue(value) || {};
}

function pickDescription(entity = {}) {
  return sanitizeDescription(
    entity?.meta_description || entity?.summary || entity?.excerpt || entity?.description || entity?.body || ""
  );
}

function pickSeoTitle(entity = {}, fallback = SITE_NAME) {
  return toTrimmedString(entity?.meta_title || entity?.title || fallback) || fallback;
}

function pickSchemaEntityName(entity = {}, fallback = SITE_NAME) {
  return toTrimmedString(entity?.title || entity?.name || entity?.meta_title || fallback) || fallback;
}

function pickSameAs(entity = {}) {
  const urls = [
    entity?.website_url,
    entity?.facebook_url,
    entity?.line_url,
  ].map((value) => toTrimmedString(value)).filter((value) => isValidUrl(value));
  return Array.from(new Set(urls));
}

export function buildSeoMetadata({ title, description, canonicalPath, lang = "en", siteUrl = "", image = "" }) {
  const safeTitle = pickSeoTitle({ meta_title: title }, SITE_NAME);
  const safeDescription = sanitizeDescription(description || "", 160) || DEFAULT_DESCRIPTION;
  const canonical = toTrimmedString(canonicalPath);
  const absoluteCanonical = buildAbsoluteUrl(canonical, siteUrl);
  const absoluteImage = buildAbsoluteUrl(image, siteUrl);
  const openGraphImages = absoluteImage ? [{ url: absoluteImage }] : undefined;
  const twitterImages = absoluteImage ? [absoluteImage] : undefined;

  return compactObject({
    title: `${safeTitle} | ${SITE_NAME}`,
    description: safeDescription,
    alternates: {
      canonical,
    },
    openGraph: {
      title: safeTitle,
      description: safeDescription,
      url: absoluteCanonical,
      siteName: SITE_NAME,
      images: openGraphImages,
      locale: LANG_TO_LOCALE[lang] || LANG_TO_LOCALE.en,
      type: "website",
    },
    twitter: {
      card: absoluteImage ? "summary_large_image" : "summary",
      title: safeTitle,
      description: safeDescription,
      images: twitterImages,
    },
  });
}

export function buildWebPageJsonLd({ title, description, canonicalUrl }) {
  return compactObject({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: toTrimmedString(title),
    description: sanitizeDescription(description || "", 300),
    url: toTrimmedString(canonicalUrl),
  });
}

export function buildBreadcrumbJsonLd(items = []) {
  const itemListElement = items
    .map((item, index) => {
      const name = toTrimmedString(item?.name);
      const url = toTrimmedString(item?.url);
      if (!name || !url) return null;
      return {
        "@type": "ListItem",
        position: index + 1,
        name,
        item: url,
      };
    })
    .filter(Boolean);

  return compactObject({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  });
}

export function buildPlaceJsonLd({ place = {}, category = "", canonicalUrl = "" }) {
  const latitude = Number(place?.latitude);
  const longitude = Number(place?.longitude);
  const schemaType = TOURIST_ATTRACTION_CATEGORIES.has(toTrimmedString(category).toLowerCase())
    ? "TouristAttraction"
    : "Place";

  return compactObject({
    "@context": "https://schema.org",
    "@type": schemaType,
    name: pickSchemaEntityName(place, "Place"),
    description: pickDescription(place),
    url: toTrimmedString(canonicalUrl),
    image: buildAbsoluteUrl(pickPrimaryImage(place)),
    hasMap: toTrimmedString(place?.map_url),
    telephone: toTrimmedString(place?.phone || place?.transport_contact_phone),
    identifier: toTrimmedString(place?.google_place_id),
    sameAs: pickSameAs(place),
    geo: Number.isFinite(latitude) && Number.isFinite(longitude)
      ? {
          "@type": "GeoCoordinates",
          latitude,
          longitude,
        }
      : undefined,
  });
}

export function buildEventJsonLd({ event = {}, canonicalUrl = "" }) {
  const startDate = toTrimmedString(event?.event_start_at);
  const endDate = toTrimmedString(event?.event_end_at);
  if (!startDate || !endDate) return null;

  return compactObject({
    "@context": "https://schema.org",
    "@type": "Event",
    name: pickSchemaEntityName(event, "Event"),
    description: pickDescription(event),
    url: toTrimmedString(canonicalUrl),
    image: buildAbsoluteUrl(pickPrimaryImage(event)),
    startDate,
    endDate,
    location: toTrimmedString(event?.location_text)
      ? {
          "@type": "Place",
          name: toTrimmedString(event.location_text),
        }
      : undefined,
  });
}
