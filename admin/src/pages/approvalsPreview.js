const TH_EMPTY = "ยังไม่ได้ระบุ";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeUrlList(values) {
  const seen = new Set();
  const urls = [];
  for (const value of Array.isArray(values) ? values : []) {
    const url = normalizeString(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function mediaGalleryFromSnapshot(snapshot) {
  const galleryEntries = Array.isArray(snapshot?.media_manifest?.gallery) ? snapshot.media_manifest.gallery : [];
  return galleryEntries
    .map((entry) => normalizeString(entry?.backend_url || entry?.source_url || entry?.url))
    .filter(Boolean);
}

function toSafeBodyHtml(value) {
  const raw = String(value || "").trim();
  if (!raw) return `<p class="approvals-preview-paragraph">${TH_EMPTY}</p>`;
  const neutralized = raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
  return neutralized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p class="approvals-preview-paragraph">${escapeHtml(paragraph)}</p>`)
    .join("");
}

export function valueOrFallbackTh(value) {
  const normalized = normalizeString(value);
  return normalized || TH_EMPTY;
}

export function primaryCtaLabelTh(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "map") return "แผนที่";
  if (normalized === "phone") return "โทร";
  if (normalized === "line") return "LINE";
  return TH_EMPTY;
}

export function buildApprovalsReviewIngestPayload(item = {}) {
  const snapshot = item?.article_snapshot || {};
  const media = snapshot?.media_manifest || {};
  const gallery = Array.isArray(media?.gallery) ? media.gallery : [];
  const inline = Array.isArray(media?.inline) ? media.inline : [];
  const cover = media?.cover?.source_url || media?.cover?.backend_url || media?.cover?.url || null;
  const sourceBaseUrl = normalizeString(snapshot?.source_base_url || item?.source_base_url);
  return {
    source_system: "collector-app",
    source_content_item_id: Number(item?.source_content_item_id || 0) || 0,
    source_base_url: sourceBaseUrl,
    content: {
      content_type: item?.source_content_type === "event" ? "event" : "place",
      lang: normalizeString(item?.source_lang || "th").toLowerCase() || "th",
      category: item?.source_content_type === "event" ? "event" : (snapshot?.category || item?.category || "attractions"),
      slug: snapshot?.slug || item?.slug || null,
      title: snapshot?.title || item?.title || "",
      body: snapshot?.description || item?.description || "",
      excerpt: snapshot?.excerpt || null,
      meta_title: snapshot?.meta_title || item?.meta_title || null,
      meta_description: snapshot?.meta_description || item?.meta_description || null,
      event_period_text: snapshot?.event_period_text || null,
      location_text: snapshot?.location_text || null,
      latitude: snapshot?.latitude ?? null,
      longitude: snapshot?.longitude ?? null,
      map_url: snapshot?.map_url || null,
      google_place_id: snapshot?.google_place_id || null,
      transport_subtype: snapshot?.transport_subtype || null,
      transport_contact_name: snapshot?.transport_contact_name || null,
      transport_contact_phone: snapshot?.transport_contact_phone || null,
      transport_contact_details: snapshot?.transport_contact_details || null,
      transport_link_url: snapshot?.transport_link_url || null,
      public_entity_type: item?.source_content_type === "event" ? "event" : "place",
      public_entity_id: Number(item?.entity_id || item?.local_entity_id || 0) || null,
      translation_langs: Array.isArray(item?.translation_langs) ? item.translation_langs : [],
    },
    media_manifest: {
      cover: cover ? { source_url: cover, role: "cover", selected: true } : null,
      gallery: gallery
        .map((entry) => entry?.source_url || entry?.backend_url || entry?.url)
        .filter(Boolean)
        .map((source_url) => ({ source_url, role: "gallery", selected: true })),
      inline: inline
        .map((entry) => entry?.source_url || entry?.backend_url || entry?.url)
        .filter(Boolean)
        .map((source_url) => ({ source_url, role: "inline", selected: true })),
    },
  };
}

export function buildApprovalContentPreviewModel(detail = {}) {
  const snapshot = detail?.article_snapshot && typeof detail.article_snapshot === "object" ? detail.article_snapshot : {};
  const coverUrl = normalizeString(detail?.effective_cover_image || detail?.image || snapshot?.image);
  const galleryUrls = normalizeUrlList([
    ...(Array.isArray(detail?.media_gallery_images) ? detail.media_gallery_images : []),
    ...mediaGalleryFromSnapshot(snapshot),
  ]).filter((url) => url !== coverUrl);

  return {
    article: {
      title: valueOrFallbackTh(detail?.title || snapshot?.title),
      excerpt: valueOrFallbackTh(detail?.excerpt || snapshot?.excerpt),
      slug: valueOrFallbackTh(detail?.slug || snapshot?.slug),
      bodyHtml: toSafeBodyHtml(detail?.description || detail?.body || snapshot?.description),
    },
    seo: [
      { label: "ชื่อ SEO", value: valueOrFallbackTh(detail?.meta_title || snapshot?.meta_title) },
      { label: "คำอธิบาย SEO", value: valueOrFallbackTh(detail?.meta_description || snapshot?.meta_description) },
    ],
    media: {
      coverUrl,
      galleryUrls,
    },
    cta: [
      { label: "ปุ่ม CTA หลัก", value: primaryCtaLabelTh(detail?.primary_cta || snapshot?.primary_cta) },
      { label: "เบอร์โทร", value: valueOrFallbackTh(detail?.phone || snapshot?.phone) },
      { label: "ลิงก์ LINE", value: valueOrFallbackTh(detail?.line_url || snapshot?.line_url), href: normalizeString(detail?.line_url || snapshot?.line_url) || "" },
      { label: "ลิงก์ Facebook", value: valueOrFallbackTh(detail?.facebook_url || snapshot?.facebook_url), href: normalizeString(detail?.facebook_url || snapshot?.facebook_url) || "" },
      { label: "ลิงก์เว็บไซต์", value: valueOrFallbackTh(detail?.website_url || snapshot?.website_url), href: normalizeString(detail?.website_url || snapshot?.website_url) || "" },
    ],
    hasEditableContentInputs: false,
  };
}
