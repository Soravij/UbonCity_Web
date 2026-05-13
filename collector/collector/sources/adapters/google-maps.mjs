import { dedupeMediaEntries } from "../media.mjs";
import { normalizeRawItem } from "../normalize.mjs";

const FETCH_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.COLLECTOR_SOURCE_FETCH_TIMEOUT_MS || process.env.COLLECTOR_FETCH_TIMEOUT_MS || 15_000) || 15_000
);

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return [];
}

async function fetchWithTimeout(url, options = {}, contextLabel = "external request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${contextLabel} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    const message = String(error?.message || "fetch failed").trim() || "fetch failed";
    throw new Error(`${contextLabel} failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

function toQueries(payload) {
  if (Array.isArray(payload?.queries)) {
    return payload.queries.map((q) => String(q || "").trim()).filter(Boolean);
  }
  if (typeof payload?.query === "string" && payload.query.trim()) {
    return [payload.query.trim()];
  }
  return [];
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toLimitedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseRelativeReviewAgeDays(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return Number.MAX_SAFE_INTEGER;

  const th = text.match(/(\d+)\s*(นาที|ชั่วโมง|วัน|สัปดาห์|เดือน|ปี)ที่แล้ว/);
  if (th) {
    const amount = Number(th[1]);
    const unit = th[2];
    if (!Number.isFinite(amount)) return Number.MAX_SAFE_INTEGER;
    if (unit === "นาที") return amount / (60 * 24);
    if (unit === "ชั่วโมง") return amount / 24;
    if (unit === "วัน") return amount;
    if (unit === "สัปดาห์") return amount * 7;
    if (unit === "เดือน") return amount * 30;
    if (unit === "ปี") return amount * 365;
  }

  const en = text.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/);
  if (en) {
    const amount = Number(en[1]);
    const unit = en[2];
    if (!Number.isFinite(amount)) return Number.MAX_SAFE_INTEGER;
    if (unit === "minute") return amount / (60 * 24);
    if (unit === "hour") return amount / 24;
    if (unit === "day") return amount;
    if (unit === "week") return amount * 7;
    if (unit === "month") return amount * 30;
    if (unit === "year") return amount * 365;
  }

  if (text.includes("วันนี้") || text.includes("today")) return 0;
  if (text.includes("เมื่อวาน") || text.includes("yesterday")) return 1;
  return Number.MAX_SAFE_INTEGER;
}

function mapReviewItem(review, index = 0) {
  const text = String(review?.text?.text || "").trim();
  if (!text) return null;
  const relativeTime = String(review?.relativePublishTimeDescription || "").trim() || null;
  return {
    text,
    rating: toNumber(review?.rating),
    relative_time: relativeTime,
    author: String(review?.authorAttribution?.displayName || "").trim() || null,
    sort_age_days: parseRelativeReviewAgeDays(relativeTime),
    source_index: Number(index) || 0,
  };
}

const BASIC_FIELD_MASK = [
  "places.id",
  "places.photos.name",
  "places.photos.widthPx",
  "places.photos.heightPx",
  "places.photos.authorAttributions.displayName",
  "places.photos.authorAttributions.uri",
  "places.photos.authorAttributions.photoUri",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.types",
  "places.googleMapsUri",
  "places.websiteUri",
];

const RICH_FIELD_MASK = [
  ...BASIC_FIELD_MASK,
  "places.primaryTypeDisplayName",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.currentOpeningHours.weekdayDescriptions",
  "places.currentOpeningHours.openNow",
  "places.editorialSummary.text",
  "places.reviews.rating",
  "places.reviews.relativePublishTimeDescription",
  "places.reviews.text.text",
  "places.reviews.authorAttribution.displayName",
];

const PLACE_DETAILS_FIELD_MASK = [
  "id",
  "photos.name",
  "photos.widthPx",
  "photos.heightPx",
  "photos.authorAttributions.displayName",
  "photos.authorAttributions.uri",
  "photos.authorAttributions.photoUri",
  "displayName",
  "formattedAddress",
  "location",
  "primaryType",
  "types",
  "googleMapsUri",
  "websiteUri",
  "primaryTypeDisplayName",
  "rating",
  "userRatingCount",
  "businessStatus",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "regularOpeningHours.weekdayDescriptions",
  "currentOpeningHours.weekdayDescriptions",
  "currentOpeningHours.openNow",
  "editorialSummary.text",
  "reviews.rating",
  "reviews.relativePublishTimeDescription",
  "reviews.text.text",
  "reviews.authorAttribution.displayName",
].join(",");

function mapPhotoAttributions(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const displayName = String(entry?.displayName || "").trim();
      const uri = String(entry?.uri || "").trim();
      const photoUri = String(entry?.photoUri || "").trim();
      if (!displayName && !uri && !photoUri) return null;
      return {
        display_name: displayName || null,
        uri: uri || null,
        photo_uri: photoUri || null,
      };
    })
    .filter(Boolean);
}

function mapPhotoMetadata(photo, index = 0) {
  const photoName = String(photo?.name || "").trim();
  if (!photoName) return null;
  return {
    photo_name: photoName,
    width_px: toNumber(photo?.widthPx),
    height_px: toNumber(photo?.heightPx),
    author_attributions: mapPhotoAttributions(photo?.authorAttributions),
    role: index === 0 ? "hero" : "gallery",
    order: Number(index) || 0,
  };
}

function extractGoogleErrorMessage(payload, fallback = "Unknown error") {
  return String(payload?.error?.message || fallback || "Unknown error").trim();
}

function isLikelyFieldMaskError(payload = {}) {
  const msg = extractGoogleErrorMessage(payload, "").toLowerCase();
  return msg.includes("field mask") || msg.includes("fieldmask") || msg.includes("cannot find field") || msg.includes("invalid");
}

function mergePlaceData(base = {}, details = {}) {
  if (!details || typeof details !== "object") return base;
  const merged = { ...base };

  const detailPhotos = Array.isArray(details.photos) ? details.photos : [];
  if (detailPhotos.length > 0) {
    merged.photos = detailPhotos;
  }

  const detailReviews = Array.isArray(details.reviews) ? details.reviews : [];
  if (detailReviews.length > 0) {
    merged.reviews = detailReviews;
  }

  for (const key of [
    "primaryTypeDisplayName",
    "rating",
    "userRatingCount",
    "businessStatus",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "regularOpeningHours",
    "currentOpeningHours",
    "editorialSummary",
    "websiteUri",
    "googleMapsUri",
    "formattedAddress",
    "location",
    "displayName",
  ]) {
    if (merged[key] == null && details[key] != null) {
      merged[key] = details[key];
    }
  }

  return merged;
}

function toPlaceResourceName(place) {
  const id = String(place?.id || "").trim();
  if (!id) return "";
  if (/^places\//i.test(id)) return id;
  return `places/${id}`;
}

async function fetchPlaceDetails(place, options) {
  const placeName = toPlaceResourceName(place);
  if (!placeName) return null;

  const url = new URL(`https://places.googleapis.com/v1/${placeName}`);
  if (options.language) url.searchParams.set("languageCode", options.language);
  if (options.region) url.searchParams.set("regionCode", options.region);

  const response = await fetchWithTimeout(url, {
    headers: {
      "X-Goog-Api-Key": options.apiKey,
      "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
    },
  }, "Google Places details request");

  if (!response.ok) {
    return null;
  }

  return response.json().catch(() => null);
}

async function fetchTextSearchNew(query, options) {
  const body = {
    textQuery: query,
    languageCode: options.language,
    regionCode: options.region,
    maxResultCount: options.maxResultsPerQuery,
  };

  if (options.location && Number.isFinite(options.location.lat) && Number.isFinite(options.location.lng) && options.radius > 0) {
    body.locationBias = {
      circle: {
        center: {
          latitude: options.location.lat,
          longitude: options.location.lng,
        },
        radius: options.radius,
      },
    };
  }

  let response = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": options.apiKey,
      "X-Goog-FieldMask": RICH_FIELD_MASK.join(","),
    },
    body: JSON.stringify(body),
  }, "Google Places search request");

  let payload = await response.json().catch(() => ({}));

  if (!response.ok && isLikelyFieldMaskError(payload)) {
    response = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": options.apiKey,
        "X-Goog-FieldMask": BASIC_FIELD_MASK.join(","),
      },
      body: JSON.stringify(body),
    }, "Google Places search fallback request");
    payload = await response.json().catch(() => ({}));
  }

  if (!response.ok) {
    const message = extractGoogleErrorMessage(payload, response.statusText || "Unknown error");
    throw new Error(`Google Places (New) error: ${message}`);
  }

  const places = Array.isArray(payload?.places) ? payload.places : [];
  const enriched = [];

  // Enrich per-place details to increase photos/review material when available.
  for (const place of places) {
    const details = await fetchPlaceDetails(place, options);
    enriched.push(mergePlaceData(place, details || null));
  }

  return enriched;
}

function buildPhotoUrl(photoName) {
  const name = String(photoName || "").trim();
  if (!name) return "";
  return `/api/google-maps/photo?name=${encodeURIComponent(name)}&maxWidthPx=1400&maxHeightPx=1400`;
}

function mapResultToRawItem(result, apiKey, maxImagesPerPlace = 25, maxReviewSnippetsPerPlace = 100) {
  const placeId = String(result?.id || "").trim();
  const name = String(result?.displayName?.text || "").trim();
  const editorialSummary = String(result?.editorialSummary?.text || "").trim();
  const address = String(result?.formattedAddress || "").trim();
  const desc = editorialSummary || address;
  const lat = toNumber(result?.location?.latitude);
  const lng = toNumber(result?.location?.longitude);
  const rating = toNumber(result?.rating);
  const userRatingCount = Number.isFinite(Number(result?.userRatingCount)) ? Number(result.userRatingCount) : null;
  const businessStatus = String(result?.businessStatus || "").trim();
  const nationalPhoneNumber = String(result?.nationalPhoneNumber || "").trim();
  const internationalPhoneNumber = String(result?.internationalPhoneNumber || "").trim();
  const primaryTypeDisplayName = String(result?.primaryTypeDisplayName?.text || "").trim();
  const weekdayDescriptions = Array.isArray(result?.regularOpeningHours?.weekdayDescriptions)
    ? result.regularOpeningHours.weekdayDescriptions
    : Array.isArray(result?.currentOpeningHours?.weekdayDescriptions)
      ? result.currentOpeningHours.weekdayDescriptions
      : [];
  const openNow = typeof result?.currentOpeningHours?.openNow === "boolean" ? result.currentOpeningHours.openNow : null;
  const reviews = Array.isArray(result?.reviews) ? result.reviews : [];
  const reviewItems = reviews
    .map((r, index) => mapReviewItem(r, index))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.sort_age_days !== b.sort_age_days) return a.sort_age_days - b.sort_age_days;
      return a.source_index - b.source_index;
    })
    .slice(0, Math.max(1, Math.min(100, Number(maxReviewSnippetsPerPlace || 100))));
  const reviewSnippets = reviewItems.slice(0, 12).map((review) => ({
    text: review.text,
    rating: review.rating,
    relative_time: review.relative_time,
    author: review.author,
  }));
  const reviewItemsCount = reviewItems.length;
  const articleSections = [];
  if (editorialSummary) articleSections.push(editorialSummary);
  if (address) articleSections.push(address);
  if (weekdayDescriptions.length) articleSections.push(weekdayDescriptions.join("\n"));
  const articleBody = articleSections.join("\n\n").trim();
  const extractedMetadata = {
    title: name || null,
    description: desc || null,
    address: address || null,
    phone: nationalPhoneNumber || internationalPhoneNumber || null,
    national_phone_number: nationalPhoneNumber || null,
    international_phone_number: internationalPhoneNumber || null,
    rating,
    user_rating_count: userRatingCount,
    review_count: reviewItemsCount,
    primary_type: String(result?.primaryType || "").trim() || null,
    primary_type_display_name: primaryTypeDisplayName || null,
    types: Array.isArray(result?.types) ? result.types.filter(Boolean) : [],
    website_url: String(result?.websiteUri || "").trim() || null,
    google_maps_url: String(result?.googleMapsUri || "").trim() || null,
    business_status: businessStatus || null,
    opening_hours: weekdayDescriptions,
    open_now: openNow,
    latitude: lat,
    longitude: lng,
    google_place_id: placeId || null,
    source_name: "google-maps",
  };
  const extractedArticle = {
    headline: name || null,
    excerpt: editorialSummary || address || null,
    body_text: articleBody || null,
    section_texts: articleSections,
    page_title: name || null,
  };

  const photoItems = Array.isArray(result?.photos)
    ? result.photos
        .map((photo, index) => mapPhotoMetadata(photo, index))
        .filter(Boolean)
    : [];
  extractedMetadata.photos = photoItems.map((photo) => ({
    photo_name: photo.photo_name,
    width_px: photo.width_px,
    height_px: photo.height_px,
    author_attributions: photo.author_attributions,
  }));
  const media = dedupeMediaEntries(
    photoItems
      .map((photo) => {
        const url = buildPhotoUrl(photo.photo_name);
        if (!url) return null;
        return {
          url,
          mime_type: "image/jpeg",
          width: photo.width_px,
          height: photo.height_px,
          metadata: {
            photo_name: photo.photo_name,
            width_px: photo.width_px,
            height_px: photo.height_px,
            author_attributions: photo.author_attributions,
            role: photo.role,
            order: photo.order,
          },
        };
      })
      .filter(Boolean),
    (entry) => entry?.url,
    Math.max(1, Math.min(25, Number(maxImagesPerPlace || 25)))
  );
  const photoUrl = media[0]?.url || "";

  return normalizeRawItem(
    {
      id: placeId,
      source_ref: placeId,
      source_url: String(result?.googleMapsUri || "").trim() || (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : ""),
      website_url: String(result?.websiteUri || "").trim(),
      name,
      title: name,
      description: desc,
      address,
      lat,
      lng,
      google_place_id: placeId,
      image_url: photoUrl,
      rating,
      user_rating_count: userRatingCount,
      review_count: reviewItemsCount,
      business_status: businessStatus,
      opening_hours_weekday_text: weekdayDescriptions,
      open_now: openNow,
      editorial_summary: editorialSummary,
      review_snippets: reviewSnippets,
      national_phone_number: nationalPhoneNumber,
      international_phone_number: internationalPhoneNumber,
      primary_type_display_name: primaryTypeDisplayName,
      source_name: "google-maps",
      tags: Array.isArray(result?.types) ? result.types.slice(0, 5) : result?.primaryType ? [result.primaryType] : [],
      media,
      photos_count_collected: media.length,
      review_snippets_count_collected: reviewSnippets.length,
      review_items_count_collected: reviewItemsCount,
      payload_json: {
        ...result,
        extracted_metadata: extractedMetadata,
        extracted_article: extractedArticle,
        extracted_reviews: {
          count_found: reviewItemsCount,
          items: reviewItems.map((review) => ({
            text: review.text,
            rating: review.rating,
            author: review.author,
            relative_time: review.relative_time,
          })),
        },
      },
    },
    "google_maps"
  );
}

async function collectFromGoogleMapsQueryPayload(payload = {}) {
  const apiKey = String(payload?.api_key || process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is missing");
  }

  const queries = toQueries(payload);
  if (!queries.length) {
    throw new Error("google_maps payload requires query or queries[]");
  }

  const maxResultsPerQuery = Math.max(1, Math.min(20, Number(payload?.max_results_per_query || 10)));
  const maxImagesPerPlace = toLimitedInt(payload?.max_images_per_place, 25, 1, 25);
  const maxReviewSnippetsPerPlace = toLimitedInt(payload?.max_review_snippets_per_place, 100, 1, 100);
  const options = {
    apiKey,
    language: String(payload?.language || "th").trim() || "th",
    region: String(payload?.region || "TH").trim().toUpperCase() || "TH",
    radius: Math.max(0, Number(payload?.radius || 0)),
    maxResultsPerQuery,
    location:
      payload?.location && Number.isFinite(Number(payload.location.lat)) && Number.isFinite(Number(payload.location.lng))
        ? { lat: Number(payload.location.lat), lng: Number(payload.location.lng) }
        : null,
  };

  const dedupe = new Set();
  const out = [];

  for (const query of queries) {
    const places = await fetchTextSearchNew(query, options);
    for (const place of places) {
      const raw = mapResultToRawItem(place, apiKey, maxImagesPerPlace, maxReviewSnippetsPerPlace);
      const key = raw.source_ref || raw.source_url || raw.normalized_json?.title;
      if (!key || dedupe.has(key)) continue;
      dedupe.add(key);
      out.push(raw);
    }
  }

  return out;
}

export async function collectFromGoogleMapsPayload(payload = []) {
  const rows = toArray(payload);
  if (rows.length) {
    return rows.map((row) => normalizeRawItem({ ...row, source_name: row.source_name || "google-maps" }, "google_maps"));
  }

  if (payload && typeof payload === "object") {
    return collectFromGoogleMapsQueryPayload(payload);
  }

  return [];
}
