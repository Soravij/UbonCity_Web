function hasOwnField(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeStringOrNull(value) {
  if (value == null) return null;
  const text = String(value || "").trim();
  return text || null;
}

export function buildConfirmedCtaContactReviewFields(confirmedCtaContact = {}) {
  const source = confirmedCtaContact && typeof confirmedCtaContact === "object"
    ? confirmedCtaContact
    : {};
  const mapped = {
    phone: normalizeStringOrNull(source.phone),
    line_url: normalizeStringOrNull(source.line_url),
    facebook_url: normalizeStringOrNull(source.facebook_url),
    website_url: normalizeStringOrNull(source.website_url),
    primary_cta: normalizeStringOrNull(source.primary_cta),
  };

  const result = {};
  if (mapped.phone) result.phone = mapped.phone;
  if (mapped.line_url) result.line_url = mapped.line_url;
  if (mapped.facebook_url) result.facebook_url = mapped.facebook_url;
  if (mapped.website_url) result.website_url = mapped.website_url;
  if (mapped.primary_cta && ["map", "phone", "line"].includes(mapped.primary_cta)) {
    result.primary_cta = mapped.primary_cta;
  }
  return result;
}

export function pickReviewIngestConfirmedCtaContact({
  latestDraft = null,
  aiCtaContact = null,
  curatedCtaContact = null,
  fieldReturnPayload = null,
} = {}) {
  const result = buildConfirmedCtaContactReviewFields(latestDraft?.confirmed_cta_contact_json || {});
  if (hasOwnField(result, "phone")) return result;
  if (hasOwnField(result, "line_url")) return result;
  if (hasOwnField(result, "facebook_url")) return result;
  if (hasOwnField(result, "website_url")) return result;
  if (hasOwnField(result, "primary_cta")) return result;
  void aiCtaContact;
  void curatedCtaContact;
  void fieldReturnPayload;
  return result;
}

export function buildReviewIngestContentPayload({
  contentType = "place",
  sourceLang = "th",
  item = null,
  latestDraft = null,
  title = "",
  excerpt = "",
  rewrittenBody = "",
  metaTitle = "",
  metaDescription = "",
  otherTransportMeta = null,
  translationLangs = [],
} = {}) {
  const normalizedContentType = String(contentType || "").trim().toLowerCase() === "event" ? "event" : "place";
  const confirmedCtaContact =
    normalizedContentType === "place"
      ? pickReviewIngestConfirmedCtaContact({ latestDraft })
      : {};

  return {
    content_type: normalizedContentType,
    lang: sourceLang,
    category: normalizedContentType === "event" ? "event" : (String(item?.category || "").trim().toLowerCase() || "attractions"),
    slug: item?.slug,
    title,
    excerpt,
    body: rewrittenBody,
    meta_title: metaTitle,
    meta_description: metaDescription,
    event_period_text: normalizedContentType === "event" ? String(item?.event_period_text || "").trim() || null : null,
    location_text: normalizedContentType === "event" ? String(item?.location_text || "").trim() || null : null,
    latitude: Number.isFinite(Number(item?.latitude)) ? Number(item.latitude) : null,
    longitude: Number.isFinite(Number(item?.longitude)) ? Number(item.longitude) : null,
    map_url: String(item?.map_url || "").trim() || null,
    google_place_id: String(item?.google_place_id || "").trim() || null,
    transport_subtype: otherTransportMeta?.subtype || null,
    transport_contact_name: otherTransportMeta?.contact_name || null,
    transport_contact_phone: otherTransportMeta?.phone || null,
    transport_contact_details: otherTransportMeta?.contact_details || null,
    transport_link_url: otherTransportMeta?.link_url || null,
    ...confirmedCtaContact,
    translation_langs: Array.isArray(translationLangs) ? translationLangs : [],
  };
}
