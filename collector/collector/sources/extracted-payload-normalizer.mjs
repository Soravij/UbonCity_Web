import { resolveExtractedArticle } from "./extracted-article.mjs";

function parseObjectCandidate(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

function toFiniteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildNormalizedFromExtractedPayload(payload = {}, sourceRecord = null) {
  const extractedMetadata = parseObjectCandidate(payload?.extracted_metadata)
    || parseObjectCandidate(payload?.payload_json?.extracted_metadata)
    || {};
  const extractedArticle = resolveExtractedArticle(payload);
  const extractedReviews = parseObjectCandidate(payload?.extracted_reviews)
    || parseObjectCandidate(payload?.payload_json?.extracted_reviews)
    || {};

  const sectionTexts = Array.isArray(extractedArticle?.section_texts)
    ? extractedArticle.section_texts.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const reviewItems = Array.isArray(extractedReviews?.items)
    ? extractedReviews.items
    : [];
  const reviewSnippets = reviewItems
    .map((row) => ({
      text: String(row?.text || "").trim(),
      rating: toFiniteNumberOrNull(row?.rating),
      author: String(row?.author || "").trim() || null,
      relative_time: String(row?.relative_time || "").trim() || null,
    }))
    .filter((row) => row.text)
    .slice(0, 5);

  const rawMedia = Array.isArray(payload?.media) ? payload.media : [];
  const media = rawMedia
    .map((m) => ({
      media_url: String(m?.media_url || m?.url || "").trim(),
      mime_type: String(m?.mime_type || "").trim() || null,
      width: Number(m?.width) || null,
      height: Number(m?.height) || null,
      metadata_json: (m?.metadata_json && typeof m.metadata_json === "object") ? m.metadata_json : (m || null),
    }))
    .filter((m) => m.media_url);

  const openingHours = Array.isArray(extractedMetadata?.opening_hours)
    ? extractedMetadata.opening_hours.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const sourceUrl = String(payload?.submitted_url || payload?.fetched_url || sourceRecord?.source_url || "").trim();
  const sourceName = String(extractedMetadata?.source_name || payload?.hostname || sourceRecord?.source_name || "").trim();
  const excerpt = String(extractedArticle?.excerpt || extractedMetadata?.description || "").trim();
  const bodyText = String(extractedArticle?.body_text || "").trim();

  const candidate = {
    type: "place",
    category: String(extractedMetadata?.category || "").trim(),
    lang: "th",
    title: String(extractedMetadata?.title || extractedArticle?.headline || "").trim(),
    description: excerpt || "",
    source_url: sourceUrl,
    source_name: sourceName,
    image: String(extractedMetadata?.image || "").trim(),
    address: String(extractedMetadata?.address || "").trim(),
    latitude: extractedMetadata?.latitude ?? null,
    longitude: extractedMetadata?.longitude ?? null,
    rating: extractedMetadata?.rating ?? null,
    review_count: extractedMetadata?.review_count ?? null,
    opening_hours_weekday_text: openingHours,
    service_facts: Array.isArray(extractedMetadata?.service_facts) ? extractedMetadata.service_facts : [],
    price_signals: Array.isArray(extractedMetadata?.price_signals) ? extractedMetadata.price_signals : [],
    menu_sections: Array.isArray(extractedMetadata?.menu_sections) ? extractedMetadata.menu_sections : [],
    menu_highlights: Array.isArray(extractedMetadata?.menu_highlights) ? extractedMetadata.menu_highlights : [],
    editorial_summary: excerpt || "",
    review_snippets: reviewSnippets,
    article_body_text: bodyText,
    article_section_texts: sectionTexts,
    article_page_title: String(extractedArticle?.page_title || "").trim(),
    media,
  };

  if (
    !candidate.title &&
    !candidate.description &&
    !candidate.image &&
    !candidate.address &&
    !candidate.article_body_text &&
    !candidate.article_section_texts.length &&
    !candidate.review_snippets.length
  ) {
    return null;
  }
  return candidate;
}

export function pickNormalizedFromSourceRecords(sourceRecords = []) {
  for (const row of sourceRecords) {
    const payload = parseObjectCandidate(row?.payload_json);
    if (!payload) continue;
    const normalized = parseObjectCandidate(payload?.normalized_json)
      || parseObjectCandidate(payload?.payload_json?.normalized_json);
    if (normalized) {
      const hasBodyText = typeof normalized.article_body_text === "string" && normalized.article_body_text.trim();
      const hasSectionTexts = Array.isArray(normalized.article_section_texts) && normalized.article_section_texts.length > 0;
      if (hasBodyText && hasSectionTexts) return normalized;
      const extracted = buildNormalizedFromExtractedPayload(payload, row);
      if (!extracted) return normalized;
      if (!hasBodyText && extracted.article_body_text) normalized.article_body_text = extracted.article_body_text;
      if (!hasSectionTexts && extracted.article_section_texts?.length) normalized.article_section_texts = extracted.article_section_texts;
      if (!normalized.article_page_title && extracted.article_page_title) normalized.article_page_title = extracted.article_page_title;
      return normalized;
    }
    const extractedNormalized = buildNormalizedFromExtractedPayload(payload, row);
    if (extractedNormalized) return extractedNormalized;
  }
  return null;
}
