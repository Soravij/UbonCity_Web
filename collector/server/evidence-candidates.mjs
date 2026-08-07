import { buildFilteredMediaList } from "../collector/sources/media-filter.mjs";
import { hasUsableNormalizedKeys } from "../collector/sources/extracted-payload-normalizer.mjs";

function toFiniteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pushEvidenceCandidate(out, payload = {}) {
  const textValue = String(payload.text_value || "").trim();
  const numericValue = payload.numeric_value == null ? null : toFiniteNumberOrNull(payload.numeric_value);
  const listValue = Array.isArray(payload.list_value) ? payload.list_value.map((x) => String(x)).filter(Boolean) : [];
  if (!textValue && numericValue == null && listValue.length === 0) return;
  out.push({
    ...payload,
    text_value: textValue || null,
    numeric_value: numericValue,
    list_value: listValue,
  });
}

const BOILERPLATE_DESCRIPTIONS = [
  "find local businesses, view maps and get driving directions in google maps.",
  "find local businesses, view maps and get driving directions in google maps",
];

export function isBoilerplateDescription(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return BOILERPLATE_DESCRIPTIONS.some((bp) => lower === bp);
}

export function buildEvidenceCandidatesForNormalized(normalized = {}, base = {}) {
  if (!hasUsableNormalizedKeys(normalized)) return [];
  const out = [];
  const title = String(normalized.title || normalized.name || "").trim();
  const description = String(normalized.description || "").trim();
  const category = String(normalized.category || "").trim();
  const type = String(normalized.type || "").trim();
  const mapUrl = String(normalized.map_url || "").trim();
  const sourceUrl = String(normalized.source_url || base.source_url || "").trim();
  const address = String(
    normalized.formatted_address
    || normalized.short_formatted_address
    || normalized.address
    || normalized.vicinity
    || ""
  ).trim();
  const editorialSummary = String(normalized.editorial_summary || "").trim();
  const businessStatus = String(normalized.business_status || "").trim();
  const website = String(normalized.website_url || "").trim();
  const phone = String(normalized.national_phone_number || normalized.international_phone_number || "").trim();
  const primaryTypeName = String(normalized.primary_type_display_name || "").trim();
  const imageUrl = String(normalized.image || "").trim();
  const rating = toFiniteNumberOrNull(normalized.rating);
  const userRatingCount = toFiniteNumberOrNull(normalized.user_rating_count ?? normalized.review_count);
  const articleBodyText = String(normalized.article_body_text || "").trim();
  const articleSections = Array.isArray(normalized.article_section_texts)
    ? normalized.article_section_texts.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "fact",
    text_value: title ? `Name: ${title}` : null,
    payload_json: { field: "title", value: title || null },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "fact",
    text_value: description && !isBoilerplateDescription(description) ? description : null,
    payload_json: { field: "description", value: description || null },
  });

  if (category || type || primaryTypeName) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "fact",
      text_value: "Place classification",
      list_value: [category && `category=${category}`, type && `type=${type}`, primaryTypeName && `primary_type=${primaryTypeName}`].filter(Boolean),
      payload_json: { field: "classification" },
    });
  }

  if (address || mapUrl || sourceUrl) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "fact",
      text_value: address || "Location link available",
      list_value: [mapUrl && `map_url=${mapUrl}`, sourceUrl && `source_url=${sourceUrl}`].filter(Boolean),
      payload_json: { field: "location" },
    });
  }

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "social_proof",
    text_value: rating == null ? null : "Rating signal",
    numeric_value: rating,
    payload_json: { field: "rating", value: rating },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "social_proof",
    text_value: userRatingCount == null ? null : "Review count signal",
    numeric_value: userRatingCount,
    payload_json: { field: "user_rating_count", value: userRatingCount },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "fact",
    text_value: businessStatus ? `Business status: ${businessStatus}` : null,
    payload_json: { field: "business_status", value: businessStatus || null },
  });

  if (typeof normalized.open_now === "boolean") {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "social_proof",
      text_value: `Open now: ${normalized.open_now ? "yes" : "no"}`,
      list_value: [`open_now=${normalized.open_now ? "true" : "false"}`],
      payload_json: { field: "open_now", value: normalized.open_now },
    });
  }

  if (Array.isArray(normalized.opening_hours_weekday_text) && normalized.opening_hours_weekday_text.length > 0) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "fact",
      text_value: "Opening hours",
      list_value: normalized.opening_hours_weekday_text,
      payload_json: { field: "opening_hours_weekday_text" },
    });
  }

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "mention",
    text_value: editorialSummary || null,
    payload_json: { field: "editorial_summary", value: editorialSummary || null },
  });

  if (Array.isArray(normalized.review_snippets)) {
    for (const snippet of normalized.review_snippets.slice(0, 3)) {
      const text = String(snippet?.text || "").trim();
      if (!text) continue;
      pushEvidenceCandidate(out, {
        ...base,
        block_type: "review_snippet",
        text_value: text,
        numeric_value: toFiniteNumberOrNull(snippet?.rating),
        payload_json: { field: "review_snippet", snippet },
      });
    }
  }

  for (const section of articleSections.slice(0, 5)) {
    const articleBase = base.article_source_record_id ? { ...base, source_record_id: base.article_source_record_id, source_record_type: "source_records" } : base;
    pushEvidenceCandidate(out, {
      ...articleBase,
      block_type: "mention",
      text_value: section,
      payload_json: { field: "article_section", value: section },
    });
  }

  if (!articleSections.length) {
    const articleBase = base.article_source_record_id ? { ...base, source_record_id: base.article_source_record_id, source_record_type: "source_records" } : base;
    pushEvidenceCandidate(out, {
      ...articleBase,
      block_type: "mention",
      text_value: articleBodyText || null,
      payload_json: articleBodyText ? { field: "article_body_text", value: articleBodyText } : null,
    });
  }

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "mention",
    text_value: website && website !== sourceUrl ? `Website: ${website}` : null,
    payload_json: { field: "website_url", value: website || null },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "mention",
    text_value: phone ? `Phone: ${phone}` : null,
    payload_json: { field: "phone", value: phone || null },
  });

  const mediaList = Array.isArray(normalized.media) ? normalized.media : [];
  const filteredMedia = buildFilteredMediaList(mediaList, { fallbackImageUrl: imageUrl, cap: 30 });
  for (const media of filteredMedia) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "media",
      text_value: media.media_url,
      payload_json: { field: "image", media_url: media.media_url, role: media.role, order: media.order },
    });
  }

  // Dedupe: same text must not appear as both fact and mention in same source_record
  const deduped = [];
  const seenTexts = new Map();
  for (const candidate of out) {
    const text = candidate.text_value;
    if (!text) {
      deduped.push(candidate);
      continue;
    }
    if (!seenTexts.has(text)) {
      seenTexts.set(text, candidate);
      deduped.push(candidate);
    } else {
      const existing = seenTexts.get(text);
      if (candidate.block_type === "fact" && existing.block_type !== "fact") {
        const index = deduped.indexOf(existing);
        if (index >= 0) deduped[index] = candidate;
        seenTexts.set(text, candidate);
      }
    }
  }
  return deduped;
}
