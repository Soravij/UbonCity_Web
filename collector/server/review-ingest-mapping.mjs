function hasOwnField(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeStringOrNull(value) {
  if (value == null) return null;
  const text = String(value || "").trim();
  return text || null;
}

export function buildConfirmedCtaContactReviewFields(confirmedCtaContact = null) {
  const source = confirmedCtaContact && typeof confirmedCtaContact === "object" && !Array.isArray(confirmedCtaContact)
    ? confirmedCtaContact
    : null;
  if (!source) return {};
  const primaryCta = normalizeStringOrNull(source.primary_cta);
  return {
    phone: normalizeStringOrNull(source.phone),
    line_url: normalizeStringOrNull(source.line_url),
    facebook_url: normalizeStringOrNull(source.facebook_url),
    website_url: normalizeStringOrNull(source.website_url),
    primary_cta: ["map", "phone", "line"].includes(primaryCta) ? primaryCta : null,
  };
}

export function pickReviewIngestConfirmedCtaContact({
  latestDraft = null,
  aiCtaContact = null,
  curatedCtaContact = null,
  fieldReturnPayload = null,
} = {}) {
  void aiCtaContact;
  void curatedCtaContact;
  void fieldReturnPayload;
  // Explicit nulls clear stored CTA on the backend, so only a reviewer-confirmed draft may send
  // the five keys. An unconfirmed draft omits them and the backend preserves what it already has.
  const isConfirmed = String(latestDraft?.confirmed_meta_status || "").trim().toLowerCase() === "confirmed";
  if (!isConfirmed) return {};
  return buildConfirmedCtaContactReviewFields(latestDraft?.confirmed_cta_contact_json);
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
