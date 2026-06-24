function toStringValue(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function toBooleanOrNull(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!toStringValue(value)) return [];
  return toStringValue(value)
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toStringArray(value, limit = 7) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => toStringValue(x)).filter(Boolean).slice(0, Math.max(1, Number(limit || 7)));
}

function isBlankCoordinateValue(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function selectCoordinateInput(primary, fallback) {
  return isBlankCoordinateValue(primary) ? fallback : primary;
}

function toCoordinateNumber(primary, fallback) {
  const selected = selectCoordinateInput(primary, fallback);
  if (selected == null) return null;
  const text = String(selected).replace(/,/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function toLooseStringArray(value, limit = 7) {
  if (Array.isArray(value)) {
    return toStringArray(value, limit);
  }
  const text = toStringValue(value);
  if (!text) return [];
  return text
    .split("|")
    .map((x) => toStringValue(x))
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit || 7)));
}

function toReviewSnippets(value, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const text = toStringValue(row?.text || row?.snippet || row?.content);
      if (!text) return null;
      return {
        text,
        rating: toNumber(row?.rating),
        relative_time: toStringValue(row?.relative_time || row?.relativePublishTimeDescription) || null,
        author: toStringValue(row?.author || row?.author_name || row?.display_name) || null,
      };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Number(limit || 3)));
}

export function normalizeRawItem(input = {}, sourceType = "social") {
  return {
    source_ref: toStringValue(input.source_ref || input.id || input.post_id),
    source_url: toStringValue(input.source_url || input.url),
    source_type: sourceType,
    title_raw: toStringValue(input.title || input.name),
    description_raw: toStringValue(input.description || input.caption || input.review_text),
    payload_json: input,
    normalized_json: {
      type: toStringValue(input.type || "place").toLowerCase() || "place",
      category: toStringValue(input.category || "attractions").toLowerCase(),
      lang: toStringValue(input.lang || "th").toLowerCase(),
      title: toStringValue(input.title || input.name),
      description: toStringValue(input.description || input.caption || input.review_text),
      image: toStringValue(input.image || input.image_url || input.thumbnail_url),
      latitude: toCoordinateNumber(input.latitude, input.lat),
      longitude: toCoordinateNumber(input.longitude, input.lng),
      map_url: toStringValue(input.map_url),
      google_place_id: toStringValue(input.google_place_id),
      source_name: toStringValue(input.source_name || sourceType),
      source_url: toStringValue(input.source_url || input.url),
      tags: toArray(input.tags),
      website_url: toStringValue(input.website_url),
      rating: toNumber(input.rating),
      user_rating_count: toNumber(input.user_rating_count || input.userRatingCount),
      review_count: toNumber(input.review_count),
      business_status: toStringValue(input.business_status),
      open_now: toBooleanOrNull(input.open_now),
      opening_hours_weekday_text: toStringArray(input.opening_hours_weekday_text, 7),
      editorial_summary: toStringValue(input.editorial_summary),
      review_snippets: toReviewSnippets(input.review_snippets, 5),
      national_phone_number: toStringValue(input.national_phone_number),
      international_phone_number: toStringValue(input.international_phone_number),
      alternate_titles: toLooseStringArray(input.alternate_titles, 5),
      full_address_normalized: toStringValue(input.full_address_normalized),
      phone_normalized: toStringValue(input.phone_normalized),
      primary_type_display_name: toStringValue(input.primary_type_display_name),
    },
    media: Array.isArray(input.media)
      ? input.media
          .map((m) => ({
            media_url: toStringValue(m?.media_url || m?.url),
            mime_type: toStringValue(m?.mime_type),
            width: toNumber(m?.width),
            height: toNumber(m?.height),
            metadata_json: m || null,
          }))
          .filter((m) => m.media_url)
      : [],
  };
}
