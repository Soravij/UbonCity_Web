// Fixed order: map (highest immediate intent) -> phone -> LINE -> Facebook -> website (lower-intent
// reference links last). Every populated channel shows as an equal peer; there is no "primary" CTA.
export function buildPlaceCtaRows(place, detailCopy) {
  const ctaMapUrl = String(place?.map_url || "").trim();
  const ctaPhone = String(place?.phone || place?.transport_contact_phone || "").trim();
  const ctaLineUrl = String(place?.line_url || "").trim();
  const ctaFacebookUrl = String(place?.facebook_url || "").trim();
  const ctaWebsiteUrl = String(place?.website_url || "").trim();
  return [
    ctaMapUrl ? { key: "map", label: detailCopy.ctaMap, href: ctaMapUrl, eventType: "MAP_CLICK" } : null,
    ctaPhone ? { key: "phone", label: detailCopy.ctaPhone, href: `tel:${ctaPhone}`, eventType: "PHONE_CLICK" } : null,
    ctaLineUrl ? { key: "line", label: detailCopy.ctaLine, href: ctaLineUrl, eventType: "LINE_CLICK" } : null,
    ctaFacebookUrl ? { key: "facebook", label: detailCopy.ctaFacebook, href: ctaFacebookUrl, eventType: "FACEBOOK_CLICK" } : null,
    ctaWebsiteUrl ? { key: "website", label: detailCopy.ctaWebsite, href: ctaWebsiteUrl, eventType: "WEBSITE_CLICK" } : null,
  ].filter(Boolean);
}
