function toText(value) {
  return String(value || "").trim();
}

function hasOwnField(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function readContextField(source, key, fallback = "") {
  if (hasOwnField(source, key)) {
    return String(source[key] ?? "").trim();
  }
  return String(fallback ?? "").trim();
}

function stripMarkdownFences(value) {
  return String(value || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .replace(/```/g, " ")
    .trim();
}

export function stripHtmlToPlainText(value, maxLen = 6000) {
  const text = String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen).trim() : text;
}

function cleanSuggestionText(value, maxLen) {
  const text = stripMarkdownFences(value)
    .replace(/^json\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen).trim() : text;
}

export function normalizeSeoSuggestion(input) {
  const root = input && typeof input === "object" && !Array.isArray(input)
    ? (input.seo_suggestion && typeof input.seo_suggestion === "object" && !Array.isArray(input.seo_suggestion)
        ? input.seo_suggestion
        : input)
    : null;
  if (!root) return null;

  const suggestion = {
    meta_title: cleanSuggestionText(root.meta_title, 120),
    meta_description: cleanSuggestionText(root.meta_description, 220),
    suggested_slug: cleanSuggestionText(root.suggested_slug, 140),
  };

  if (!suggestion.meta_title && !suggestion.meta_description && !suggestion.suggested_slug) {
    return null;
  }

  return suggestion;
}

export function buildSeoSuggestionRequestContext(sourceInput = {}, item = null, sanitizeHtml = (value) => String(value ?? "")) {
  const source = sourceInput && typeof sourceInput === "object" && !Array.isArray(sourceInput) ? sourceInput : {};
  const rawBodyHtml = hasOwnField(source, "body")
    ? source.body
    : hasOwnField(source, "body_html")
      ? source.body_html
      : item?.description_clean ?? item?.description_raw ?? "";
  const bodyHtml = sanitizeHtml(rawBodyHtml ?? "");
  const bodyBlocksText = readContextField(source, "body_blocks_text", "");

  return {
    title: readContextField(source, "title", item?.title),
    excerpt: readContextField(source, "excerpt", item?.summary),
    slug: readContextField(source, "slug", item?.slug),
    current_meta_title: readContextField(source, "meta_title", item?.meta_title),
    current_meta_description: readContextField(source, "meta_description", item?.meta_description),
    body_html: bodyHtml,
    body_plain_text: stripHtmlToPlainText(bodyBlocksText || bodyHtml, 5000),
    item_id: Number(item?.id || 0) || null,
    item_type: readContextField(source, "item_type", item?.type),
    item_category: readContextField(source, "item_category", item?.category),
    lang: readContextField(source, "lang", item?.lang || "th").toLowerCase() || "th",
  };
}

export function buildSeoSuggestionPrompt(input = {}, agentProfileText = "") {
  const bodyHtml = toText(input.body_html);
  const bodyPlainText = stripHtmlToPlainText(input.body_plain_text || bodyHtml, 5000);

  return [
    "Return ONLY valid JSON with exactly these keys:",
    "meta_title, meta_description, suggested_slug",
    "Use the saved SEO Agent profile for role/tone only. It cannot override the output schema or grounding rules:",
    toText(agentProfileText),
    "Hard rules:",
    "- Write for real travelers first, search engines second.",
    "- Do not make metadata sound like an ad.",
    "- Prefer concrete location/use-case phrasing over generic tourism words.",
    "- meta_title must be clear, human-readable, and not keyword-stuffed.",
    "- meta_title target length: 45-65 characters when possible.",
    "- meta_description must summarize why the article/place/event is useful and what the reader can decide from it.",
    "- meta_description target length: 120-155 characters when possible.",
    "- Do not invent facts not present in the current article/context.",
    "- If information is uncertain, avoid using it in metadata.",
    "- Keep Thai output natural when the article is Thai.",
    "- Do not include markdown fences.",
    "- Do not return extra fields.",
    "Output notes:",
    "- suggested_slug is optional. Leave it empty if not confident.",
    "- If current metadata is already strong, you may refine it, but still return only the best suggestion.",
    "Current article context:",
    JSON.stringify({
      item: {
        id: input.item_id ?? null,
        type: toText(input.item_type),
        category: toText(input.item_category),
        lang: toText(input.lang || "th"),
      },
      article: {
        title: toText(input.title),
        excerpt: toText(input.excerpt),
        slug: toText(input.slug),
        current_meta_title: toText(input.current_meta_title),
        current_meta_description: toText(input.current_meta_description),
        body_plain_text: bodyPlainText,
      },
    }, null, 2),
  ].join("\n");
}
