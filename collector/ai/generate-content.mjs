function toStr(value) {
  return String(value ?? "").trim();
}

function slugify(value) {
  const text = toStr(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u0E80-\u0EFF\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return text || "item";
}

function clip(value, max) {
  const s = toStr(value).replace(/\s+/g, " ");
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max - 3).trimEnd()}...`;
}

function firstParagraph(description) {
  const clean = toStr(description).replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.split(/\n{2,}/)[0] || clean;
}

function buildBody(item) {
  const parts = [];
  const intro = clip(firstParagraph(item.description), 320);
  if (intro) parts.push(intro);

  if (item.category) {
    parts.push(`Category: ${item.category}`);
  }

  if (item.latitude != null && item.longitude != null) {
    parts.push(`Coordinates: ${item.latitude}, ${item.longitude}`);
  }

  if (item.map_url) {
    parts.push(`Map: ${item.map_url}`);
  }

  if (item.source_name || item.source_url) {
    const sourceLine = [item.source_name, item.source_url].filter(Boolean).join(" - ");
    parts.push(`Source: ${sourceLine}`);
  }

  return parts.join("\n\n");
}

function scoreDraftQuality(item) {
  let score = 60;
  if (toStr(item.title).length >= 8) score += 10;
  if (toStr(item.description).length >= 100) score += 15;
  if (toStr(item.meta_title).length >= 20) score += 5;
  if (toStr(item.meta_description).length >= 60) score += 5;
  if (Array.isArray(item.tags) && item.tags.length >= 2) score += 5;
  return Math.max(0, Math.min(100, score));
}

function buildSuggestedRelated(item, allItems) {
  const tags = new Set((Array.isArray(item.tags) ? item.tags : []).map((t) => String(t).toLowerCase()));

  const candidates = allItems
    .filter((x) => x.id !== item.id)
    .map((x) => {
      const xTags = new Set((Array.isArray(x.tags) ? x.tags : []).map((t) => String(t).toLowerCase()));
      let relevance = 0;

      if (x.category && item.category && x.category === item.category) relevance += 30;
      for (const t of tags) {
        if (xTags.has(t)) relevance += 15;
      }

      const titleTokens = new Set(String(x.title || "").toLowerCase().split(/\s+/).filter(Boolean));
      for (const token of String(item.title || "").toLowerCase().split(/\s+/)) {
        if (token && titleTokens.has(token)) relevance += 5;
      }

      return {
        content_item_id: x.id,
        title: x.title,
        slug: x.slug || slugify(x.title),
        category: x.category || "",
        relevance,
      };
    })
    .filter((x) => x.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);

  return candidates;
}

export function generateContentDrafts(items) {
  const normalized = Array.isArray(items) ? items : [];

  return normalized.map((item) => {
    const draftTitle = clip(item.title, 120);
    const excerpt = clip(firstParagraph(item.description), 180);
    const body = buildBody(item) || excerpt || draftTitle;
    const metaTitle = clip(item.meta_title || draftTitle, 70);
    const metaDescription = clip(item.meta_description || excerpt || body, 160);
    const slug = item.slug || slugify(draftTitle);
    const suggestedRelated = buildSuggestedRelated(item, normalized);

    const qualityScore = scoreDraftQuality({
      ...item,
      meta_title: metaTitle,
      meta_description: metaDescription,
    });

    return {
      ...item,
      slug,
      draft_title: draftTitle,
      excerpt,
      body,
      meta_title: metaTitle,
      meta_description: metaDescription,
      suggested_related: suggestedRelated,
      ai_quality_score: qualityScore,
      summary: item.summary || excerpt,
    };
  });
}

export function generateContentFields(items) {
  return generateContentDrafts(items).map((item) => ({
    ...item,
    summary: item.summary || item.excerpt,
  }));
}

