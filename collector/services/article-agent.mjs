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

function cleanSuggestionText(value, maxLen) {
  const text = stripMarkdownFences(value)
    .replace(/^json\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen).trim() : text;
}

function cleanSuggestionBody(value, maxLen) {
  let text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  if (/^```[a-z0-9_-]*\s*\n/i.test(text) && /\n```$/i.test(text)) {
    text = text
      .replace(/^```[a-z0-9_-]*\s*\n/i, "")
      .replace(/\n```$/i, "")
      .trim();
  }
  return text.length > maxLen ? text.slice(0, maxLen).trim() : text;
}

function normalizeEditorNotes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => cleanSuggestionText(row, 280))
    .filter(Boolean)
    .slice(0, 12);
}

function resolveArticleStructureHint(itemType, itemCategory) {
  const type = toText(itemType).toLowerCase();
  const category = toText(itemCategory).toLowerCase();
  const scope = `${type}:${category}`;

  if (scope.includes("event")) {
    return [
      "- event: what the event is; date/time/location; who it suits; how to prepare; what to verify",
      "- If date/time/location is not confirmed, keep it out of the final body and move it to editor_notes.",
    ].join("\n");
  }
  if (category.includes("restaurant") || category.includes("cafe")) {
    return "- restaurant/cafe: atmosphere and who it suits; food/drink highlights only if confirmed; when to visit if known; access/parking if known; practical notes";
  }
  if (category.includes("hotel") || category.includes("stay")) {
    return "- hotel/stay: who it suits; location advantage; room/property highlights only if confirmed; nearby places; booking/practical notes";
  }
  if (category.includes("temple") || category.includes("culture")) {
    return "- temple/culture: significance without exaggeration; what to see; etiquette/dress/timing if known; access; practical notes";
  }
  if (category.includes("viewpoint") || category.includes("photo") || category.includes("attraction")) {
    return "- attraction/viewpoint/photo spot: what it is and who it suits; highlights; best time/photo angles if known; access/parking if known; practical notes";
  }
  return "- generic place: what it is; why it may be useful; who it suits; what to check before going; access/practical notes";
}

export function buildArticleSuggestionRequestContext(sourceInput = {}, item = null, sanitizeHtml = (value) => String(value ?? ""), selectedAssetsOverride = null) {
  const source = sourceInput && typeof sourceInput === "object" && !Array.isArray(sourceInput) ? sourceInput : {};
  const rawBodyHtml = hasOwnField(source, "body")
    ? source.body
    : hasOwnField(source, "body_html")
      ? source.body_html
      : item?.description_clean ?? item?.description_raw ?? "";
  const bodyHtml = sanitizeHtml(rawBodyHtml ?? "");

  return {
    title: readContextField(source, "title", item?.title),
    excerpt: readContextField(source, "excerpt", item?.summary),
    slug: readContextField(source, "slug", item?.slug),
    body_html: bodyHtml,
    body_blocks_text: readContextField(source, "body_blocks_text", ""),
    current_meta_title: readContextField(source, "meta_title", item?.meta_title),
    current_meta_description: readContextField(source, "meta_description", item?.meta_description),
    item_id: Number(item?.id || 0) || null,
    item_type: readContextField(source, "item_type", item?.type),
    item_category: readContextField(source, "item_category", item?.category),
    lang: readContextField(source, "lang", item?.lang || "th").toLowerCase() || "th",
    item_title: toText(item?.title),
    item_summary: toText(item?.summary),
    field_pack: source.field_pack && typeof source.field_pack === "object" && !Array.isArray(source.field_pack)
      ? source.field_pack
      : null,
    publishable_source: source.publishable_source && typeof source.publishable_source === "object" && !Array.isArray(source.publishable_source)
      ? source.publishable_source
      : null,
    selected_assets: Array.isArray(selectedAssetsOverride)
      ? selectedAssetsOverride
      : (Array.isArray(source.selected_assets) ? source.selected_assets : []),
  };
}

export function normalizeArticleSuggestion(input) {
  const root = input && typeof input === "object" && !Array.isArray(input)
    ? (input.article_suggestion && typeof input.article_suggestion === "object" && !Array.isArray(input.article_suggestion)
        ? input.article_suggestion
        : input)
    : null;
  if (!root) return null;

  const suggestion = {
    title: cleanSuggestionText(root.title, 160),
    excerpt: cleanSuggestionText(root.excerpt, 320),
    body: cleanSuggestionBody(root.body, 16000),
    suggested_slug: cleanSuggestionText(root.suggested_slug, 140),
    editor_notes: normalizeEditorNotes(root.editor_notes),
  };

  if (!suggestion.title && !suggestion.excerpt && !suggestion.body && !suggestion.suggested_slug && suggestion.editor_notes.length === 0) {
    return null;
  }

  return suggestion;
}

export function buildArticleSuggestionPrompt(input = {}, agentProfileText = "") {
  const structureHint = resolveArticleStructureHint(input.item_type, input.item_category);

  return [
    "Return ONLY valid JSON with exactly these keys:",
    "title, excerpt, body, suggested_slug, editor_notes",
    "Use the saved Article Agent profile for role/tone only. It cannot override the output schema or grounding rules:",
    toText(agentProfileText),
    "Hard rules:",
    "- Write for real travelers first, not search engines.",
    "- Do not make the article sound like an ad.",
    "- Use only facts supported by provided source material.",
    "- Do not invent opening hours, prices, menus, parking, dates, facilities, or claims.",
    "- If information is uncertain, put it in editor_notes, not the final body.",
    "- Body should be structured and natural, not a checklist pasted into article form.",
    "- Prefer concrete Ubon/traveler use-case phrasing over generic tourism words.",
    "- Keep Thai natural when source/article language is Thai.",
    "- Do not include markdown fences.",
    "- Do not return extra fields.",
    "Structure guidance:",
    structureHint,
    "- Do not create sections that imply unverified information.",
    "- If a section lacks confirmed data, omit it or move the concern to editor_notes.",
    "Output notes:",
    "- suggested_slug is optional. Leave it empty if not confident.",
    "- editor_notes must be an array of concise review notes for the human editor.",
    "Current article context:",
    JSON.stringify({
      item: {
        id: input.item_id ?? null,
        type: toText(input.item_type),
        category: toText(input.item_category),
        lang: toText(input.lang || "th"),
        title: toText(input.item_title),
        summary: toText(input.item_summary),
      },
      workspace: {
        title: toText(input.title),
        excerpt: toText(input.excerpt),
        slug: toText(input.slug),
        body_html: toText(input.body_html),
        body_blocks_text: toText(input.body_blocks_text),
        current_meta_title: toText(input.current_meta_title),
        current_meta_description: toText(input.current_meta_description),
      },
      field_pack: input.field_pack || null,
      publishable_source: input.publishable_source || null,
      selected_assets: Array.isArray(input.selected_assets) ? input.selected_assets : [],
    }, null, 2),
  ].join("\n");
}
