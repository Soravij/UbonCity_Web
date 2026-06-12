import {
  api,
  canEditArticle,
  collectWorkspacePayload,
  currentOtherTransportMeta,
  currentAssignmentState,
  currentReviewNote,
  canApplyFieldReturnEvidenceToConfirmedCta,
  defaultConfirmedCtaContact,
  defaultConfirmedTaxonomy,
  fieldReturnEvidence,
  applyArticleSuggestionFieldValues,
  applyFieldReturnEvidenceToConfirmedCta,
  applySeoSuggestionFieldValues,
  embedOrientation,
  ensureSelectedAssetId,
  escapeHtml,
  formatDateTime,
  fillField,
  getArticleStatus,
  intakeUrl,
  isImageAsset,
  latestDraft,
  loadWorkspace,
  normalizeCommaSeparatedTags,
  normalizeEmbedUrl,
  otherTransportSubtypeLabel,
  primaryAssignment,
  qs,
  renderActivityLog,
  renderAuthStatus,
  renderPreview,
  renderProcessBar,
  renderStatusChip,
  reviewUrl,
  roleArticleFallbackUrl,
  sanitizeUrl,
  selectedWorkspaceAssets,
  setBanner,
  setInlineStatus,
  slugify,
  isPlaceItem,
  isOtherTransportItem,
  state,
  validateWorkspace,
} from "./article-workflow-core.js";

const workspaceState = {
  bodyBlocks: [],
  nextBlockId: 1,
  mediaCollapsed: true,
  systemInfoCollapsed: true,
  confirmedMetaCollapsed: true,
  dirty: false,
  articleSuggestionBusy: false,
  seoSuggestionBusy: false,
};

function nextBlockId() {
  const id = workspaceState.nextBlockId;
  workspaceState.nextBlockId += 1;
  return id;
}

function createBlock(type, payload = {}) {
  return {
    id: nextBlockId(),
    type,
    text: String(payload.text || ""),
    url: String(payload.url || ""),
    caption: String(payload.caption || ""),
    alt: String(payload.alt || ""),
    list_style: String(payload.list_style || "unordered"),
    asset_id: Number(payload.asset_id || 0) || 0,
    content_asset_id: Number(payload.content_asset_id || 0) || 0,
  };
}

function hideArticleAssetHoverPreview() {
  const preview = qs("article-asset-hover-preview");
  const image = qs("article-asset-hover-preview-image");
  const video = qs("article-asset-hover-preview-video");
  if (!preview || !image || !video) return;
  preview.classList.add("hidden");
  image.classList.add("hidden");
  video.classList.add("hidden");
  image.removeAttribute("src");
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function positionArticleAssetHoverPreview(event) {
  const preview = qs("article-asset-hover-preview");
  if (!preview || !event) return;
  const maxLeft = Math.max(12, window.innerWidth - preview.offsetWidth - 16);
  const maxTop = Math.max(12, window.innerHeight - preview.offsetHeight - 16);
  const left = Math.max(12, Math.min(Number(event.clientX || 0) + 20, maxLeft));
  const top = Math.max(12, Math.min(Number(event.clientY || 0) + 20, maxTop));
  preview.style.transform = `translate(${left}px, ${top}px)`;
}

function showArticleAssetHoverPreview(url, mimeType, event) {
  const preview = qs("article-asset-hover-preview");
  const image = qs("article-asset-hover-preview-image");
  const video = qs("article-asset-hover-preview-video");
  if (!preview || !image || !video || !url) return;
  const normalizedMime = String(mimeType || "").trim().toLowerCase();
  const isVideo = normalizedMime.startsWith("video/") || /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(String(url || ""));
  image.classList.add("hidden");
  video.classList.add("hidden");
  image.removeAttribute("src");
  video.pause();
  video.removeAttribute("src");
  if (isVideo) {
    video.src = url;
    video.classList.remove("hidden");
    void video.play().catch(() => {});
  } else {
    image.src = url;
    image.classList.remove("hidden");
  }
  preview.classList.remove("hidden");
  positionArticleAssetHoverPreview(event);
}

function figureToBlock(element) {
  const images = Array.from(element.querySelectorAll("img"));
  if (images.length > 1) {
    return createBlock("html", { text: element.outerHTML || "" });
  }
  const image = images[0] || null;
  if (image) {
    return createBlock("image", {
      url: sanitizeUrl(image.getAttribute("src") || ""),
      alt: image.getAttribute("alt") || "",
      caption: element.querySelector("figcaption")?.textContent || "",
      asset_id: Number(image.getAttribute("data-asset-id") || 0) || 0,
      content_asset_id: Number(image.getAttribute("data-content-asset-id") || 0) || 0,
    });
  }
  const frame = element.querySelector("iframe, video");
  if (frame) {
    return createBlock("video", {
      url: normalizeEmbedUrl(frame.getAttribute("src") || ""),
      caption: element.querySelector("figcaption")?.textContent || "",
    });
  }
  return createBlock("html", { text: element.outerHTML || "" });
}

function htmlNodeToBlock(node) {
  if (!node || node.nodeType !== 1) return null;
  const tag = String(node.tagName || "").trim().toLowerCase();
  if (tag === "h2" || tag === "h3") return createBlock("heading", { text: node.textContent || "" });
  if (tag === "p") return createBlock("paragraph", { text: node.textContent || "" });
  if (tag === "blockquote") return createBlock("quote", { text: node.textContent || "" });
  if (tag === "ul" || tag === "ol") {
    const items = Array.from(node.querySelectorAll(":scope > li")).map((item) => String(item.textContent || "").trim()).filter(Boolean);
    return createBlock("list", {
      text: items.join("\n"),
      list_style: tag === "ol" ? "ordered" : "unordered",
    });
  }
  if (tag === "figure") return figureToBlock(node);
  if (tag === "img") {
    return createBlock("image", {
      url: sanitizeUrl(node.getAttribute("src") || ""),
      alt: node.getAttribute("alt") || "",
      caption: "",
      asset_id: Number(node.getAttribute("data-asset-id") || 0) || 0,
      content_asset_id: Number(node.getAttribute("data-content-asset-id") || 0) || 0,
    });
  }
  if (tag === "iframe" || tag === "video") {
    return createBlock("video", {
      url: normalizeEmbedUrl(node.getAttribute("src") || ""),
      caption: "",
    });
  }
  if (tag === "div" && node.classList.contains("preview-gallery")) {
    return createBlock("html", { text: node.outerHTML || "" });
  }
  return createBlock("html", { text: node.outerHTML || "" });
}

function parseHtmlToBlocks(rawHtml) {
  const html = String(rawHtml || "").trim();
  if (!html || typeof DOMParser !== "function") {
    return [createBlock("html", { text: html })].filter((block) => String(block.text || "").trim());
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const nodes = Array.from(doc.body.childNodes || []);
  const blocks = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      const text = String(node.textContent || "").trim();
      if (text) blocks.push(createBlock("paragraph", { text }));
      continue;
    }
    const block = htmlNodeToBlock(node);
    if (block) blocks.push(block);
  }
  return blocks.filter((block) => {
    if (block.type === "image" || block.type === "video") return Boolean(block.url);
    return Boolean(String(block.text || "").trim() || String(block.caption || "").trim());
  });
}

function buildBlocksFromBody(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return [];
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    const parsed = parseHtmlToBlocks(raw);
    return parsed.length ? parsed : [createBlock("html", { text: raw })];
  }
  return raw
    .split(/\n{2,}/)
    .map((paragraph) => String(paragraph || "").trim())
    .filter(Boolean)
    .map((paragraph) => createBlock("paragraph", { text: paragraph }));
}

function serializeBlock(block) {
  const type = String(block?.type || "").trim().toLowerCase();
  if (type === "heading") return `<h2>${escapeHtml(String(block?.text || "").trim())}</h2>`;
  if (type === "quote") return `<blockquote>${escapeHtml(String(block?.text || "").trim()).replace(/\n/g, "<br>")}</blockquote>`;
  if (type === "list") {
    const items = String(block?.text || "")
      .split(/\n+/)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!items.length) return "";
    const tag = String(block?.list_style || "unordered") === "ordered" ? "ol" : "ul";
    return `<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
  }
  if (type === "image") {
    const url = sanitizeUrl(block?.url || "");
    if (!url) return "";
    const alt = escapeHtml(String(block?.alt || block?.caption || "image").trim());
    const caption = escapeHtml(String(block?.caption || "").trim());
    const assetId = Number(block?.asset_id || 0) || 0;
    const contentAssetId = Number(block?.content_asset_id || 0) || 0;
    const assetAttrs = [
      assetId > 0 ? `data-asset-id="${assetId}"` : "",
      contentAssetId > 0 ? `data-content-asset-id="${contentAssetId}"` : "",
    ].filter(Boolean).join(" ");
    return `<figure>\n  <img src="${url}" alt="${alt}" ${assetAttrs} />\n  ${caption ? `<figcaption>${caption}</figcaption>` : ""}\n</figure>`;
  }
  if (type === "video") {
    const rawUrl = sanitizeUrl(block?.url || "");
    const url = normalizeEmbedUrl(rawUrl);
    const caption = escapeHtml(String(block?.caption || "").trim());
    const orientation = embedOrientation(rawUrl);
    if (!url) {
      return rawUrl
        ? `<p><a href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener noreferrer">เปิดวิดีโอในแท็บใหม่</a></p>`
        : "";
    }
    return `<figure class="embedded-video">\n  <iframe src="${url}" loading="lazy" ${orientation === "vertical" ? 'data-orientation="vertical" ' : ""}allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>\n  ${caption ? `<figcaption>${caption}</figcaption>` : ""}\n</figure>`;
  }
  if (type === "html") return String(block?.text || "").trim();
  return `<p>${escapeHtml(String(block?.text || "").trim()).replace(/\n/g, "<br>")}</p>`;
}

function serializeBlocks() {
  return workspaceState.bodyBlocks
    .map((block) => serializeBlock(block))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function syncBodyFromBlocks() {
  const body = qs("article-body");
  if (!body) return;
  body.value = serializeBlocks();
}

function renderWorkspaceSaveState() {
  const node = qs("workspace-save-state");
  const bodyNote = qs("body-composer-dirty-note");
  const previewNote = qs("preview-dirty-note");
  if (node) {
    node.classList.remove("is-dirty", "is-saving");
    if (state.busy) {
      node.textContent = "กำลังบันทึก...";
      node.classList.add("is-saving");
    } else if (workspaceState.dirty) {
      node.textContent = "มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก";
      node.classList.add("is-dirty");
    } else {
      node.textContent = "บันทึกแล้ว";
    }
  }
  const showDirty = !state.busy && workspaceState.dirty;
  if (bodyNote) bodyNote.classList.toggle("hidden", !showDirty);
  if (previewNote) previewNote.classList.toggle("hidden", !showDirty);
}

function setWorkspaceDirty(nextDirty = true) {
  workspaceState.dirty = nextDirty === true;
  renderWorkspaceSaveState();
}

function setArticleSuggestionBusy(isBusy) {
  workspaceState.articleSuggestionBusy = isBusy === true;
  const button = qs("btn-generate-article-draft");
  if (button) {
    button.disabled = state.busy || workspaceState.articleSuggestionBusy || !canEditArticle();
    button.textContent = workspaceState.articleSuggestionBusy ? "Generating..." : "Generate Article Draft";
  }
}

function setSeoSuggestionBusy(isBusy) {
  workspaceState.seoSuggestionBusy = isBusy === true;
  const button = qs("btn-generate-seo-metadata");
  if (button) {
    button.disabled = state.busy || workspaceState.seoSuggestionBusy || !canEditArticle();
    button.textContent = workspaceState.seoSuggestionBusy ? "Generating..." : "Generate SEO Metadata";
  }
}

function setBusy(isBusy, label = "Save") {
  state.busy = Boolean(isBusy);
  const saveBtn = qs("btn-save-workspace");
  if (saveBtn) saveBtn.textContent = state.busy ? "Saving..." : label;
  const reviewSaveBtn = qs("btn-save-before-review");
  if (reviewSaveBtn) reviewSaveBtn.textContent = state.busy ? "Saving..." : "บันทึก";
  [
    "btn-save-workspace",
    "btn-save-before-review",
    "btn-submit-review",
    "btn-insert-heading",
    "btn-insert-paragraph",
    "btn-insert-selected-image",
    "btn-insert-quote",
    "btn-insert-list",
    "btn-insert-video",
    "btn-preview-desktop",
    "btn-preview-mobile",
    "btn-generate-article-draft",
    "btn-generate-seo-metadata",
  ].forEach((id) => {
    const node = qs(id);
    if (node) node.disabled = state.busy;
  });
  setArticleSuggestionBusy(workspaceState.articleSuggestionBusy);
  setSeoSuggestionBusy(workspaceState.seoSuggestionBusy);
  renderWorkspaceSaveState();
}

function stripHtmlToPlainText(value, maxLen = 5000) {
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

function collectSeoSuggestionPayload() {
  const item = state.item || {};
  const draft = latestDraft();
  const titleInput = qs("article-title");
  const excerptInput = qs("article-excerpt");
  const slugInput = qs("article-slug");
  const bodyInput = qs("article-body");
  const metaTitleInput = qs("article-meta-title");
  const metaDescriptionInput = qs("article-meta-description");
  const title = String(titleInput ? (titleInput.value ?? "") : (draft?.draft_title ?? item.title ?? "")).trim();
  const excerpt = String(excerptInput ? (excerptInput.value ?? "") : (draft?.excerpt ?? item.summary ?? "")).trim();
  const slug = String(slugInput ? (slugInput.value ?? "") : (item.slug ?? "")).trim();
  const bodyHtml = String(bodyInput ? (bodyInput.value ?? "") : (draft?.body ?? item.description_clean ?? item.description_raw ?? "")).trim();
  const bodyBlocksText = (Array.isArray(workspaceState.bodyBlocks) ? workspaceState.bodyBlocks : [])
    .map((block) => {
      const parts = [
        String(block?.text || "").trim(),
        String(block?.caption || "").trim(),
        String(block?.alt || "").trim(),
      ].filter(Boolean);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return {
    title,
    excerpt,
    slug,
    body: bodyHtml,
    body_blocks_text: stripHtmlToPlainText(bodyBlocksText || bodyHtml, 5000),
    meta_title: String(metaTitleInput ? (metaTitleInput.value ?? "") : (draft?.meta_title ?? item.meta_title ?? "")).trim(),
    meta_description: String(metaDescriptionInput ? (metaDescriptionInput.value ?? "") : (draft?.meta_description ?? item.meta_description ?? "")).trim(),
    item_type: String(item.type || "").trim(),
    item_category: String(item.category || "").trim(),
    lang: String(item.lang || "th").trim().toLowerCase() || "th",
  };
}

function collectArticleSuggestionPayload() {
  const item = state.item || {};
  const draft = latestDraft();
  const titleInput = qs("article-title");
  const excerptInput = qs("article-excerpt");
  const slugInput = qs("article-slug");
  const bodyInput = qs("article-body");
  const title = String(titleInput ? (titleInput.value ?? "") : (draft?.draft_title ?? item.title ?? "")).trim();
  const excerpt = String(excerptInput ? (excerptInput.value ?? "") : (draft?.excerpt ?? item.summary ?? "")).trim();
  const slug = String(slugInput ? (slugInput.value ?? "") : (item.slug ?? "")).trim();
  const bodyHtml = String(bodyInput ? (bodyInput.value ?? "") : (draft?.body ?? item.description_clean ?? item.description_raw ?? "")).trim();
  const bodyBlocksText = (Array.isArray(workspaceState.bodyBlocks) ? workspaceState.bodyBlocks : [])
    .map((block) => {
      const parts = [
        String(block?.text || "").trim(),
        String(block?.caption || "").trim(),
        String(block?.alt || "").trim(),
      ].filter(Boolean);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return {
    title,
    excerpt,
    slug,
    body: bodyHtml,
    body_blocks_text: stripHtmlToPlainText(bodyBlocksText || bodyHtml, 5000),
    meta_title: String(qs("article-meta-title")?.value ?? draft?.meta_title ?? item.meta_title ?? "").trim(),
    meta_description: String(qs("article-meta-description")?.value ?? draft?.meta_description ?? item.meta_description ?? "").trim(),
    item_type: String(item.type || "").trim(),
    item_category: String(item.category || "").trim(),
    lang: String(item.lang || "th").trim().toLowerCase() || "th",
    field_pack: state.fieldPack && typeof state.fieldPack === "object" ? state.fieldPack : null,
    publishable_source: state.articleProcess?.publishable_source && typeof state.articleProcess.publishable_source === "object"
      ? state.articleProcess.publishable_source
      : null,
  };
}

function normalizeArticleSuggestionBodyValue(value, maxLen) {
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

function normalizeArticleSuggestionPayload(payload = {}) {
  const editorNotes = Array.isArray(payload?.editor_notes)
    ? payload.editor_notes
      .map((row) => normalizeSeoSuggestionValue(row, 280))
      .filter(Boolean)
      .slice(0, 12)
    : [];
  return {
    title: normalizeSeoSuggestionValue(payload?.title, 160),
    excerpt: normalizeSeoSuggestionValue(payload?.excerpt, 320),
    body: normalizeArticleSuggestionBodyValue(payload?.body, 16000),
    suggested_slug: normalizeSeoSuggestionValue(payload?.suggested_slug, 140),
    editor_notes: editorNotes,
  };
}

function normalizeSeoSuggestionValue(value, maxLen) {
  const text = String(value || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen).trim() : text;
}

function normalizeSeoSuggestionPayload(payload = {}) {
  return {
    meta_title: normalizeSeoSuggestionValue(payload?.meta_title, 120),
    meta_description: normalizeSeoSuggestionValue(payload?.meta_description, 220),
    suggested_slug: normalizeSeoSuggestionValue(payload?.suggested_slug, 140),
  };
}

function parseObjectJson(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function collectReferenceRows(payload = {}) {
  const sources = [
    payload.references,
    payload.writer_references,
    payload.evidence_summary?.references,
  ];
  const rows = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const row of source) {
      const url = sanitizeUrl(row?.url || row?.source_url || "");
      if (!url) continue;
      rows.push({
        url,
        label: String(row?.label || row?.source_label || row?.title || "reference").trim() || "reference",
      });
    }
  }
  return rows
    .filter((row, index, list) => list.findIndex((item) => item.url === row.url) === index)
    .slice(0, 8);
}

function summarizeDraftLead(value, maxLen = 260) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const text = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|figcaption)>/gi, " ")
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
  return text.length > maxLen ? `${text.slice(0, maxLen).trim()}...` : text;
}

function pickWriterSubmissionRows(payload = {}) {
  const rows = [];
  const groups = [
    { key: "verified_answers", label: "ยืนยันข้อมูล" },
    { key: "question_answers", label: "คำตอบภาคสนาม" },
    { key: "capture_answers", label: "สิ่งที่ถ่าย/เก็บมา" },
    { key: "direction_answers", label: "แนวเล่า" },
    { key: "source_answers", label: "ข้อมูลจากแหล่งอ้างอิง" },
  ];
  groups.forEach((group) => {
    const items = Array.isArray(payload[group.key]) ? payload[group.key] : [];
    items.forEach((item) => {
      const prompt = String(item?.prompt || "").trim();
      const answer = summarizeDraftLead(item?.answer || "", 220);
      if (!answer) return;
      rows.push({
        group: group.label,
        prompt,
        answer,
      });
    });
  });
  const additional = summarizeDraftLead(payload.additional_text || "", 360);
  if (additional) {
    rows.push({
      group: "หมายเหตุเพิ่มเติม",
      prompt: "",
      answer: additional,
    });
  }
  return rows.slice(0, 24);
}

function splitWriterAngles(value) {
  if (Array.isArray(value)) {
    return value
      .map((row) => String(row || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  const text = String(value || "").trim();
  if (!text) return [];
  return text
    .split(/,(?=\s*[^,:]+:)/)
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function renderWriterBrief() {
  const statusNode = qs("writer-brief-status");
  const angleSectionNode = qs("writer-brief-angle-section");
  const angleNode = qs("writer-brief-angle");
  const summaryNode = qs("writer-brief-summary");
  const submissionNode = qs("writer-brief-submission");
  const cautionsNode = qs("writer-brief-cautions");
  const referencesNode = qs("writer-brief-references");
  if (!statusNode || !angleSectionNode || !angleNode || !summaryNode || !submissionNode || !cautionsNode || !referencesNode) return;

  const process = state.articleProcess || {};
  const fieldPack = state.fieldPack && typeof state.fieldPack === "object"
    ? state.fieldPack
    : {};
  const source = process.publishable_source && typeof process.publishable_source === "object"
    ? process.publishable_source
    : {};
  const draft = process.latest_draft && typeof process.latest_draft === "object"
    ? process.latest_draft
    : {};
  const issues = Array.isArray(process.publishable_source_issues)
    ? process.publishable_source_issues.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  const payload = parseObjectJson(source.article_payload_json);
  const references = collectReferenceRows(payload);
  const submissionRows = pickWriterSubmissionRows(payload);
  const storyAngles = splitWriterAngles(fieldPack.writer_angle || fieldPack.story_angle || "");

  const lead = summarizeDraftLead(draft.excerpt || "", 320)
    || summarizeDraftLead(draft.body || "", 320)
    || summarizeDraftLead(state.item?.summary || "", 320);
  const draftUpdated = formatDateTime(draft.updated_at || draft.created_at || "");
  const draftTitle = String(draft.draft_title || state.item?.title || "").trim();
  const summaryRows = [
    draftTitle ? `หัวข้อร่าง: ${draftTitle}` : "",
    draftUpdated !== "-" ? `อัปเดตล่าสุด: ${draftUpdated}` : "",
  ].filter(Boolean);

  const writerCautions = [];
  if (!process.publishable_source_ready) {
    writerCautions.push("ข้อมูลต้นทางยังไม่สมบูรณ์ ควรเช็กประเด็นที่ยังค้างก่อนสรุปเป็นข้อเท็จจริง");
  }
  if (!lead) {
    writerCautions.push("ยังไม่มีสรุปเนื้อหาตั้งต้นที่ชัดเจน ควรเพิ่ม lead หรือ excerpt ก่อนส่งตรวจ");
  }
  if (!submissionRows.length) {
    writerCautions.push("ยังไม่พบข้อมูลส่งกลับที่พร้อมใช้งานในเอกสารนี้");
  }
  const cautionRows = [
    ...writerCautions,
    ...(issues.length ? ["มีประเด็นค้างจากกระบวนการจัดทำบทความ ควรตรวจรายละเอียดในข้อมูลระบบ"] : []),
  ].filter(Boolean);

  statusNode.className = `status ${process.publishable_source_ready ? "ok" : "warn"}`;
  statusNode.textContent = process.publishable_source_ready
    ? "พร้อมใช้งาน: ข้อมูลตั้งต้นพร้อมสำหรับเขียน/ทวนแก้"
    : "ยังมีข้อค้าง: อ่านข้อควรระวังก่อนลงมือเขียน";

  angleSectionNode.classList.toggle("hidden", storyAngles.length === 0);
  angleNode.innerHTML = storyAngles.length
    ? `<ul>${storyAngles.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`
    : "";

  summaryNode.innerHTML = `
    ${lead ? `<p>${escapeHtml(lead)}</p>` : '<p class="muted">ยังไม่มีสรุปเนื้อหาตั้งต้นที่พร้อมใช้งาน</p>'}
    ${summaryRows.length ? `<ul>${summaryRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>` : ""}
  `;

  submissionNode.innerHTML = submissionRows.length
    ? `<ol>${submissionRows.map((row) => `<li>${row.prompt ? `<strong>${escapeHtml(row.prompt)}</strong>: ` : ""}${escapeHtml(row.answer)}${row.group ? ` <span class="muted">(${escapeHtml(row.group)})</span>` : ""}</li>`).join("")}</ol>`
    : '<p class="muted">ยังไม่มีข้อมูลส่งกลับที่คัดไว้สำหรับงานเขียน</p>';

  cautionsNode.innerHTML = cautionRows.length
    ? `<ul>${cautionRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`
    : '<p class="muted">ไม่พบประเด็นค้างที่ต้องระวัง</p>';

  referencesNode.innerHTML = references.length
    ? `<ul>${references.map((row) => `<li><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.label)}</a></li>`).join("")}</ul>`
    : '<p class="muted">ยังไม่มี reference ที่คัดไว้สำหรับงานเขียน</p>';
}

function renderWriterSystemInfo() {
  const root = qs("writer-system-info");
  const statusNode = qs("writer-system-status");
  const contentNode = qs("writer-system-content");
  const button = qs("btn-toggle-writer-system-info");
  if (!root || !statusNode || !contentNode || !button) return;

  root.classList.toggle("hidden", workspaceState.systemInfoCollapsed);
  button.setAttribute("aria-expanded", workspaceState.systemInfoCollapsed ? "false" : "true");
  button.textContent = workspaceState.systemInfoCollapsed ? "แสดงข้อมูลระบบ" : "ซ่อนข้อมูลระบบ";
  if (workspaceState.systemInfoCollapsed) return;

  const process = state.articleProcess || {};
  const source = process.publishable_source && typeof process.publishable_source === "object"
    ? process.publishable_source
    : {};
  const issues = Array.isArray(process.publishable_source_issues)
    ? process.publishable_source_issues.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  const reasonCodes = Array.isArray(source.reason_codes)
    ? source.reason_codes.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  const detailRows = [
    ["source kind", String(source.source_kind || "-").trim() || "-"],
    ["assignment id", Number(source.assignment_id || 0) || "-"],
    ["assignment state", String(source.assignment_state || "-").trim() || "-"],
    ["submission id", Number(source.latest_submission_id || 0) || "-"],
    ["field pack id", Number(source.field_pack_id || 0) || "-"],
    ["draft deliverable id", Number(source.article_draft_deliverable_id || 0) || "-"],
    ["draft language", String(source.article_draft_lang || "-").trim() || "-"],
    ["draft body length", Number(source.article_draft_body_length || 0) || 0],
  ];

  statusNode.className = `status ${process.publishable_source_ready ? "ok" : "warn"}`;
  statusNode.textContent = process.publishable_source_ready
    ? "ระบบต้นทางพร้อมใช้งาน"
    : "ระบบต้นทางยังไม่พร้อมใช้งาน";

  const issueHtml = issues.length
    ? `<ul>${issues.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`
    : '<p class="muted">ไม่มี issue จาก publishable source</p>';
  const reasonHtml = reasonCodes.length
    ? `<ul>${reasonCodes.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`
    : '<p class="muted">ไม่มี reason code</p>';
  contentNode.innerHTML = `
    <div class="article-system-grid">
      ${detailRows.map(([label, value]) => `<div class="summary-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(String(value))}</span></div>`).join("")}
    </div>
    <div class="article-system-subsection">
      <h4>Issues</h4>
      ${issueHtml}
    </div>
    <div class="article-system-subsection">
      <h4>Reason Codes</h4>
      ${reasonHtml}
    </div>
  `;
}

function toReviewList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => String(row || "").trim()).filter(Boolean);
}

function parseFieldPackContractFromWriterNotes(writerNotes) {
  const raw = String(writerNotes || "").trim();
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const topLevelVersion = String(parsed.contract_version || "").trim();
  const provenanceVersion = String(parsed?.provenance?.contract_version || "").trim();
  const resolvedVersion = topLevelVersion || provenanceVersion;
  if (!resolvedVersion) return null;
  return {
    ...parsed,
    contract_version: resolvedVersion,
  };
}

function buildContractFactRows(coreFacts = {}) {
  if (!coreFacts || typeof coreFacts !== "object" || Array.isArray(coreFacts)) return [];
  const rows = [];
  for (const [key, value] of Object.entries(coreFacts)) {
    if (value == null) continue;
    const text = Array.isArray(value) ? value.join(", ") : String(value).trim();
    if (!text) continue;
    rows.push({ key, value: text });
  }
  return rows;
}

function parseTaxonomyContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return null;
  return String(contract.taxonomy_version || "").trim() === "page_curation_taxonomy_v1" ? contract : null;
}

function taxonomyFieldLabel(key) {
  return String(key || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function taxonomyBadge(label, tone = "neutral") {
  const className = tone === "warning"
    ? "workflow-badge workflow-badge-generated"
    : tone === "danger"
      ? "workflow-badge workflow-badge-sent"
      : "workflow-badge workflow-badge-raw";
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

function isLikelyUrl(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.startsWith("http://")
    || text.startsWith("https://")
    || text.startsWith("/api/")
    || text.startsWith("/uploads/")
    || text.startsWith("/collector/");
}

function normalizeTaxonomyItems(items = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(items) ? items : []) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function renderPreviewText(text, previewLimit = 200) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  if (isLikelyUrl(normalized)) {
    return `<a href="${escapeHtml(normalized)}" target="_blank" rel="noreferrer">open link</a>`;
  }
  if (normalized.length <= previewLimit) return escapeHtml(normalized);
  const preview = `${normalized.slice(0, previewLimit).trimEnd()}...`;
  return `${escapeHtml(preview)}<details><summary>show more</summary><div>${escapeHtml(normalized)}</div></details>`;
}

function taxonomyListValue(items = [], options = {}) {
  const tone = options.tone || "neutral";
  const list = normalizeTaxonomyItems(items);
  if (!list.length) return "";
  const visibleItems = list.slice(0, 5);
  const hiddenItems = list.slice(5);
  const visibleHtml = visibleItems.map((item) => `<li>${tone === "normal" ? renderPreviewText(item) : taxonomyBadge(item, tone)}</li>`).join("");
  const hiddenHtml = hiddenItems.length
    ? `<details><summary>show ${hiddenItems.length} more</summary><ul>${hiddenItems.map((item) => `<li>${tone === "normal" ? renderPreviewText(item) : taxonomyBadge(item, tone)}</li>`).join("")}</ul></details>`
    : "";
  return `<ul>${visibleHtml}</ul>${hiddenHtml}`;
}

function taxonomyScalarValue(value, options = {}) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (text === "unknown") return taxonomyBadge("unknown", "neutral");
  if (options.warning) return taxonomyBadge(text, "warning");
  return escapeHtml(text);
}

function renderTaxonomyStatusBadges(field, needsVerificationSet, publishBlockerSet) {
  const badges = [];
  if (publishBlockerSet.has(field)) badges.push(taxonomyBadge("publish blocker", "danger"));
  if (needsVerificationSet.has(field)) badges.push(taxonomyBadge("needs verification", "warning"));
  return badges.join(" ");
}

function renderTaxonomyFieldHtml(field, value, needsVerificationSet, publishBlockerSet) {
  const isPublishBlocker = publishBlockerSet.has(field);
  const isNeedsVerification = needsVerificationSet.has(field);
  const statusBadges = renderTaxonomyStatusBadges(field, needsVerificationSet, publishBlockerSet);

  if (Array.isArray(value)) {
    const normalized = normalizeTaxonomyItems(value);
    if (!normalized.length && !isPublishBlocker && !isNeedsVerification) return "";
    if (!normalized.length) return statusBadges;
    const listHtml = taxonomyListValue(normalized, { tone: "normal" });
    return statusBadges ? `<div>${listHtml}</div><div>${statusBadges}</div>` : listHtml;
  }

  const scalar = String(value == null ? "" : value).trim();
  if (!scalar && !isPublishBlocker && !isNeedsVerification) return "";
  if (!scalar) return statusBadges;
  if (scalar === "unknown" && !isPublishBlocker && !isNeedsVerification) return "";

  const valueHtml = scalar === "unknown"
    ? taxonomyScalarValue(scalar, { warning: false })
    : renderPreviewText(scalar);
  return statusBadges ? `<div>${valueHtml}</div><div>${statusBadges}</div>` : valueHtml;
}

function buildTaxonomySections(contract) {
  const verification = contract.verification && typeof contract.verification === "object" ? contract.verification : {};
  const needsVerificationSet = new Set(toReviewList(verification.needs_verification));
  const publishBlockers = toReviewList(verification.publish_blockers);
  const publishBlockerSet = new Set(publishBlockers);
  const sectionConfigs = [
    {
      title: "Universal Curation",
      key: "universal_curation_profile",
      fields: ["highlights", "good_to_know", "why_visit", "recommended_for", "best_for", "nearby", "local_notes"],
    },
    {
      title: "Practical Profile",
      key: "practical_profile",
      fields: ["price_range", "parking", "pet_friendly", "family_friendly", "accessibility", "opening_hours_note", "reservation_needed"],
    },
    {
      title: "Place Profile",
      key: "place_profile",
      fields: ["view_type", "atmosphere", "photo_spots", "visit_duration", "best_time_to_visit"],
    },
    {
      title: "Restaurant Profile",
      key: "restaurant_profile",
      fields: ["restaurant_features", "signature_menu", "cuisine_type", "price_signals", "service_style", "seating_vibe"],
    },
    {
      title: "Hotel Profile",
      key: "hotel_profile",
      fields: ["hotel_amenities", "room_type_hints", "checkin_checkout", "booking_channels", "nearby_landmarks", "stay_best_for"],
    },
    {
      title: "Event Profile",
      key: "event_profile",
      fields: ["event_date_hints", "schedule_hints", "ticket_hints", "venue_notes", "event_best_for"],
    },
  ];

  const sections = [];
  for (const config of sectionConfigs) {
    const source = contract[config.key] && typeof contract[config.key] === "object" ? contract[config.key] : {};
    const rows = [];
    for (const field of config.fields) {
      const html = renderTaxonomyFieldHtml(field, source[field], needsVerificationSet, publishBlockerSet);
      if (!html) continue;
      rows.push({
        label: taxonomyFieldLabel(field),
        html,
      });
    }
    if (rows.length) sections.push({ title: config.title, rows });
  }

  const verificationRows = [];
  const verifiedFacts = normalizeTaxonomyItems(verification.verified_facts);
  if (verifiedFacts.length) {
    verificationRows.push({ label: "Verified Facts", html: taxonomyListValue(verifiedFacts, { tone: "normal" }) });
  }
  const needsVerification = normalizeTaxonomyItems(verification.needs_verification);
  if (needsVerification.length) {
    verificationRows.push({ label: "Needs Verification", html: taxonomyListValue(needsVerification, { tone: "warning" }) });
  }
  if (publishBlockers.length) {
    verificationRows.push({ label: "Publish Blockers", html: taxonomyListValue(publishBlockers, { tone: "danger" }) });
  }
  if (verificationRows.length) sections.push({ title: "Verification", rows: verificationRows });

  return sections;
}

function renderTaxonomyReviewPanel() {
  const statusNode = qs("taxonomy-review-status");
  const root = qs("taxonomy-review-panel");
  if (!statusNode || !root) return;

  const fieldPack = state.fieldPack && typeof state.fieldPack === "object" ? state.fieldPack : {};
  const contract = parseFieldPackContractFromWriterNotes(fieldPack.writer_notes);
  const taxonomyContract = parseTaxonomyContract(contract);

  if (!contract) {
    statusNode.className = "status";
    statusNode.textContent = "No contract JSON found in writer notes.";
    root.innerHTML = '<p class="muted">Taxonomy Review appears when writer_notes contains field pack contract JSON.</p>';
    return;
  }

  if (!taxonomyContract) {
    statusNode.className = "status";
    statusNode.textContent = "No page_curation_taxonomy_v1 contract found.";
    root.innerHTML = '<p class="muted">Taxonomy Review stays empty until writer_notes contains a contract with taxonomy_version set to page_curation_taxonomy_v1.</p>';
    return;
  }

  const sections = buildTaxonomySections(taxonomyContract);
  const publishBlockers = toReviewList(taxonomyContract?.verification?.publish_blockers);
  const needsVerification = toReviewList(taxonomyContract?.verification?.needs_verification);

  statusNode.className = `status ${publishBlockers.length > 0 || needsVerification.length > 0 ? "warn" : "ok"}`;
  statusNode.textContent = publishBlockers.length > 0
    ? "Warning: taxonomy review found publish blockers."
    : needsVerification.length > 0
      ? "Taxonomy review found unresolved verification items."
      : "Taxonomy review is available for curation.";

  if (!sections.length) {
    root.innerHTML = '<p class="muted">No taxonomy groups with usable values were found in this contract.</p>';
    return;
  }

  root.innerHTML = `
    <section class="article-brief-section">
      <h3>Taxonomy Meta</h3>
      <div class="readiness-summary">
        <div class="summary-row"><strong>contract_version</strong><span>${escapeHtml(String(taxonomyContract.contract_version || "-"))}</span></div>
        <div class="summary-row"><strong>taxonomy_version</strong><span>${escapeHtml(String(taxonomyContract.taxonomy_version || "-"))}</span></div>
      </div>
    </section>
    ${sections.map((section) => `
      <section class="article-brief-section">
        <h3>${escapeHtml(section.title)}</h3>
        <ul>
          ${section.rows.map((row) => `<li><strong>${escapeHtml(row.label)}:</strong> ${row.html}</li>`).join("")}
        </ul>
      </section>
    `).join("")}
    <details>
      <summary>Debug: taxonomy contract JSON</summary>
      <pre>${escapeHtml(JSON.stringify(taxonomyContract, null, 2))}</pre>
    </details>
  `;
}

function renderFieldPackEvidencePanel() {
  const statusNode = qs("field-pack-evidence-status");
  const root = qs("field-pack-evidence-panel");
  if (!statusNode || !root) return;

  const fieldPack = state.fieldPack && typeof state.fieldPack === "object" ? state.fieldPack : {};
  const contract = parseFieldPackContractFromWriterNotes(fieldPack.writer_notes);
  if (!contract) {
    statusNode.className = "status";
    statusNode.textContent = "No contract JSON found in writer notes.";
    root.innerHTML = '<p class="muted">Panel stays empty until writer_notes includes field pack contract JSON.</p>';
    return;
  }

  const curationSignals = contract.curation_signals && typeof contract.curation_signals === "object"
    ? contract.curation_signals
    : {};
  const checklists = contract.checklists && typeof contract.checklists === "object"
    ? contract.checklists
    : {};
  const missingFields = toReviewList(curationSignals.missing_fields || checklists.missing_data);
  const verifyRequired = toReviewList(curationSignals.verify_required || checklists.verify_required);
  const risks = toReviewList(curationSignals.content_risks || checklists.quality_gaps);
  const suggestedBlocks = toReviewList(curationSignals.suggested_page_blocks);
  const coreFacts = buildContractFactRows(contract.core_factual_fields);
  const verifiedFacts = toReviewList(fieldPack.verified_facts || fieldPack.verified_facts_json);
  const uncertainFacts = toReviewList(fieldPack.uncertain_facts || fieldPack.uncertain_facts_json);
  const hasRiskWarning = missingFields.length > 0 || verifyRequired.length > 0;

  statusNode.className = `status ${hasRiskWarning ? "warn" : "ok"}`;
  statusNode.textContent = hasRiskWarning
    ? "Warning: ข้อมูลนี้ยังไม่ควรถือเป็น publish-ready"
    : "Grounded checks available for review.";

  const renderList = (items, emptyText = "none") => items.length
    ? `<ul>${items.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`
    : `<p class="muted">${escapeHtml(emptyText)}</p>`;

  root.innerHTML = `
    <section class="article-brief-section">
      <h3>Contract Meta</h3>
      <div class="readiness-summary">
        <div class="summary-row"><strong>contract_version</strong><span>${escapeHtml(String(contract.contract_version || "-"))}</span></div>
        <div class="summary-row"><strong>field_pack_id</strong><span>${escapeHtml(String(Number(fieldPack.id || 0) || "-"))}</span></div>
        <div class="summary-row"><strong>source_draft_input_snapshot_id</strong><span>${escapeHtml(String(Number(fieldPack.source_draft_input_snapshot_id || 0) || "-"))}</span></div>
        <div class="summary-row"><strong>priority_cta</strong><span>${escapeHtml(String(curationSignals.priority_cta || "-"))}</span></div>
      </div>
    </section>
    <section class="article-brief-section"><h3>Core Facts</h3>${coreFacts.length ? `<ul>${coreFacts.map((row) => `<li><strong>${escapeHtml(row.key)}:</strong> ${escapeHtml(row.value)}</li>`).join("")}</ul>` : '<p class="muted">No core facts in contract.</p>'}</section>
    <section class="article-brief-section"><h3>Verified / Grounded Facts</h3>${renderList(verifiedFacts, "No verified facts yet.")}</section>
    <section class="article-brief-section"><h3>Uncertain / Needs Review</h3>${renderList(uncertainFacts, "No uncertain facts listed.")}</section>
    <section class="article-brief-section"><h3>Missing Data</h3>${renderList(missingFields, "No missing_fields.")}</section>
    <section class="article-brief-section"><h3>Verify Required</h3>${renderList(verifyRequired, "No verify_required.")}</section>
    <section class="article-brief-section"><h3>Suggested Page Blocks</h3>${renderList(suggestedBlocks, "No suggested blocks.")}</section>
    <section class="article-brief-section"><h3>Content Risks</h3>${renderList(risks, "No content risks.")}</section>
    <details>
      <summary>Debug: raw contract JSON</summary>
      <pre>${escapeHtml(JSON.stringify(contract, null, 2))}</pre>
    </details>
  `;
}

function renderMediaLibraryVisibility() {
  const content = qs("article-media-library-content");
  const button = qs("btn-toggle-media-library");
  if (!content || !button) return;
  content.classList.toggle("hidden", workspaceState.mediaCollapsed);
  button.setAttribute("aria-expanded", workspaceState.mediaCollapsed ? "false" : "true");
  button.textContent = workspaceState.mediaCollapsed ? "แสดงคลังรูป" : "ซ่อนคลังรูป";
  if (workspaceState.mediaCollapsed) hideArticleAssetHoverPreview();
}

function renderConfirmedMetaVisibility() {
  const content = qs("confirmed-meta-section");
  const button = qs("btn-toggle-confirmed-meta");
  if (!content || !button) return;
  content.classList.toggle("hidden", workspaceState.confirmedMetaCollapsed);
  button.setAttribute("aria-expanded", workspaceState.confirmedMetaCollapsed ? "false" : "true");
  button.textContent = workspaceState.confirmedMetaCollapsed ? "แสดงข้อมูลยืนยัน" : "ซ่อนข้อมูลยืนยัน";
}

function fieldReturnEvidenceGroupLabel(groupKey) {
  if (groupKey === "cta_contact") return "CTA / ช่องทางติดต่อ";
  if (groupKey === "taxonomy") return "หมวดหมู่";
  return "เช็กอื่น ๆ";
}

function renderFieldReturnEvidenceValue(value) {
  if (Array.isArray(value)) {
    const rows = value.map((entry) => String(entry || "").trim()).filter(Boolean);
    return rows.length ? rows.map((entry) => escapeHtml(entry)).join(", ") : "-";
  }
  if (value && typeof value === "object") {
    return escapeHtml(JSON.stringify(value));
  }
  const text = String(value ?? "").trim();
  return text ? escapeHtml(text) : "-";
}

function renderFieldReturnEvidencePanel() {
  const root = qs("field-return-evidence-panel");
  if (!root) return;
  const evidence = fieldReturnEvidence();
  const items = (Array.isArray(evidence?.items) ? evidence.items : []).filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if (String(item.group_key || "").trim().toLowerCase() === "cta_contact" && !isPlaceItem(state.item)) {
      return false;
    }
    return true;
  });
  if (!items.length) {
    root.innerHTML = '<p class="muted">ยังไม่มีข้อมูลที่คนเช็กส่งกลับ</p>';
    setInlineStatus("field-return-evidence-status", "");
    return;
  }
  const grouped = new Map([
    ["cta_contact", []],
    ["taxonomy", []],
    ["other", []],
  ]);
  for (const item of items) {
    const groupKey = item.group_key === "cta_contact" || item.group_key === "taxonomy" ? item.group_key : "other";
    grouped.get(groupKey).push(item);
  }
  root.innerHTML = Array.from(grouped.entries())
    .filter(([, rows]) => rows.length > 0)
    .map(([groupKey, rows]) => `
      <section class="article-brief-section">
        <h3>${escapeHtml(fieldReturnEvidenceGroupLabel(groupKey))}</h3>
        <ul>
          ${rows.map((item) => {
            const canApply = canApplyFieldReturnEvidenceToConfirmedCta(item, state.item);
            const submittedMeta = [item.submitted_at ? formatDateTime(item.submitted_at) : "", item.submitted_by || ""].filter(Boolean).join(" · ");
            return `
              <li>
                <strong>${escapeHtml(item.label || item.key)}</strong>
                <div class="summary-row"><strong>คีย์</strong><span>${escapeHtml(item.key)}</span></div>
                <div class="summary-row"><strong>ตรวจแล้ว</strong><span>${item.checked ? "ใช่" : "ไม่ใช่"}</span></div>
                <div class="summary-row"><strong>${item.found ? "พบข้อมูล" : "ไม่พบข้อมูล"}</strong><span>${item.found ? "ใช่" : "ไม่ใช่"}</span></div>
                <div class="summary-row"><strong>ค่าที่พบ</strong><span>${renderFieldReturnEvidenceValue(item.value)}</span></div>
                <div class="summary-row"><strong>เงื่อนไข/ข้อจำกัด</strong><span>${escapeHtml(item.condition_note || "-")}</span></div>
                <div class="summary-row"><strong>หลักฐาน/แหล่งที่มา</strong><span>${escapeHtml(item.evidence || "-")}</span></div>
                <div class="summary-row"><strong>หมายเหตุ</strong><span>${escapeHtml(item.note || "-")}</span></div>
                <div class="summary-row"><strong>ส่งกลับเมื่อ</strong><span>${escapeHtml(submittedMeta || "-")}</span></div>
                ${canApply ? `<div class="toolbar compact-toolbar"><button type="button" class="utility-action" data-action="apply-field-return-evidence" data-field-return-key="${escapeHtml(item.key)}">ใช้ค่านี้</button></div>` : ""}
              </li>
            `;
          }).join("")}
        </ul>
      </section>
    `)
    .join("");
  setInlineStatus("field-return-evidence-status", "แสดงข้อมูลที่คนเช็กส่งกลับแบบอ่านอย่างเดียว");
}

function renderWorkspaceFields() {
  const item = state.item || {};
  const draft = latestDraft();
  const confirmedCtaContact = draft?.confirmed_cta_contact_json && typeof draft.confirmed_cta_contact_json === "object"
    ? draft.confirmed_cta_contact_json
    : defaultConfirmedCtaContact();
  const confirmedTaxonomy = draft?.confirmed_taxonomy_json && typeof draft.confirmed_taxonomy_json === "object"
    ? draft.confirmed_taxonomy_json
    : defaultConfirmedTaxonomy();
  const bodyValue = draft?.body || item.description_clean || item.description_raw || "";
  fillField("article-title", draft?.draft_title || item.title || "");
  fillField("article-excerpt", draft?.excerpt || item.summary || "");
  fillField("article-slug", item.slug || "");
  fillField("article-meta-title", draft?.meta_title || item.meta_title || "");
  fillField("article-meta-description", draft?.meta_description || item.meta_description || "");
  fillField("confirmed-phone", confirmedCtaContact.phone || "");
  fillField("confirmed-line-url", confirmedCtaContact.line_url || "");
  fillField("confirmed-facebook-url", confirmedCtaContact.facebook_url || "");
  fillField("confirmed-website-url", confirmedCtaContact.website_url || "");
  fillField("confirmed-primary-cta", confirmedCtaContact.primary_cta || "");
  fillField("confirmed-category", confirmedTaxonomy.category || "");
  fillField("confirmed-subtype", confirmedTaxonomy.subtype || "");
  fillField("confirmed-tags", Array.isArray(confirmedTaxonomy.tags) ? confirmedTaxonomy.tags.join(", ") : "");
  fillField("confirmed-meta-status", draft?.confirmed_meta_status || "not_started");
  fillField("confirmed-note", draft?.confirmed_note || "");
  fillField("article-body", bodyValue);
  if (isOtherTransportItem(item)) {
    const meta = currentOtherTransportMeta();
    fillField("other-transport-type", meta.subtype || item.source_entity_id || "other");
    fillField("other-transport-contact-name", meta.contact_name || "");
    fillField("other-transport-contact-details", meta.contact_details || "");
    fillField("other-transport-phone", meta.phone || "");
    fillField("other-transport-link", meta.link_url || "");
  }
  workspaceState.bodyBlocks = buildBlocksFromBody(bodyValue);
}

function renderOtherTransportPanel() {
  const section = qs("other-transport-section");
  if (!section) return;
  const enabled = isOtherTransportItem();
  section.classList.toggle("hidden", !enabled);
  if (!enabled) return;

  const assets = selectedWorkspaceAssets();
  const cover = assets.find((row) => Number(row.is_cover || 0) === 1 || String(row.role || "").trim().toLowerCase() === "cover") || null;
  const summary = qs("other-transport-thumbnail-summary");
  const block = qs("other-transport-thumbnail-block");

  if (summary) {
    summary.className = `status ${cover ? "ok" : "error"}`;
    summary.textContent = cover ? `พร้อมใช้: ${cover.file_name || "cover asset"}` : "ยังไม่มี cover image";
  }

  if (block) {
    const previewUrl = sanitizeUrl(cover?.public_url || "");
    const subtypeLabel = otherTransportSubtypeLabel(currentOtherTransportMeta().subtype);
    block.innerHTML = previewUrl
      ? `
        <div class="summary-row"><strong>Thumbnail source</strong><span>cover asset</span></div>
        <div class="summary-row"><strong>ประเภท</strong><span>${escapeHtml(subtypeLabel)}</span></div>
        <img src="${escapeHtml(previewUrl)}" alt="other transport thumbnail" style="max-width:220px;border-radius:12px;display:block;margin-top:12px;" />
      `
      : `
        <div class="summary-row"><strong>Thumbnail source</strong><span>cover asset</span></div>
        <p class="muted">ตั้งรูป cover จาก Media Library เพื่อให้รายการนี้มี thumbnail บนหน้า public</p>
      `;
  }
}

function renderBlocks() {
  const root = qs("article-blocks");
  if (!root) return;
  if (!workspaceState.bodyBlocks.length) {
    root.innerHTML = '<p class="muted">No blocks yet</p>';
    return;
  }
  root.innerHTML = workspaceState.bodyBlocks.map((block, index) => {
    const type = String(block?.type || "paragraph");
    const title =
      type === "heading" ? "Heading"
        : type === "image" ? "Image"
          : type === "video" ? "Video"
            : type === "quote" ? "Quote"
              : type === "list" ? "List"
                : type === "html" ? "Raw HTML"
                  : "Paragraph";
    const textField = type === "image" || type === "video"
      ? `
        <div class="grid">
          <div class="full-span">
            <label>URL</label>
            <input data-block-field="url" data-block-id="${block.id}" value="${escapeHtml(block.url || "")}" />
          </div>
          <div>
            <label>Caption</label>
            <input data-block-field="caption" data-block-id="${block.id}" value="${escapeHtml(block.caption || "")}" />
          </div>
          <div>
            <label>Alt</label>
            <input data-block-field="alt" data-block-id="${block.id}" value="${escapeHtml(block.alt || "")}" />
          </div>
        </div>
      `
        : type === "list"
          ? `
            <div class="grid">
              <div>
                <label>List Style</label>
                <select data-block-field="list_style" data-block-id="${block.id}">
                  <option value="unordered" ${String(block.list_style || "unordered") === "unordered" ? "selected" : ""}>unordered</option>
                  <option value="ordered" ${String(block.list_style || "unordered") === "ordered" ? "selected" : ""}>ordered</option>
                </select>
              </div>
              <div class="full-span">
                <label>Items (1 per line)</label>
                <textarea data-block-field="text" data-block-id="${block.id}" rows="5">${escapeHtml(block.text || "")}</textarea>
              </div>
            </div>
          `
          : `
            <label>${escapeHtml(title)}</label>
            <textarea data-block-field="text" data-block-id="${block.id}" rows="${type === "html" ? 8 : 4}">${escapeHtml(block.text || "")}</textarea>
          `;
    return `
      <article class="article-block-card">
        <div class="article-block-head">
          <strong>${escapeHtml(title)} #${index + 1}</strong>
          <div class="toolbar compact-toolbar">
            <button type="button" data-block-action="move-up" data-block-id="${block.id}" ${index === 0 ? "disabled" : ""}>Up</button>
            <button type="button" data-block-action="move-down" data-block-id="${block.id}" ${index === workspaceState.bodyBlocks.length - 1 ? "disabled" : ""}>Down</button>
            <button type="button" data-block-action="delete" data-block-id="${block.id}">Delete</button>
          </div>
        </div>
        ${textField}
      </article>
    `;
  }).join("");
}

function refreshComposerFromBlocks() {
  syncBodyFromBlocks();
  renderBlocks();
  renderPreview();
  renderReviewChecklist();
  renderStatusChip();
  applyActionGuards();
}

function refreshComposerDerivedState() {
  syncBodyFromBlocks();
  renderPreview();
  renderReviewChecklist();
  renderStatusChip();
  applyActionGuards();
}

function addBlock(type, payload = {}) {
  workspaceState.bodyBlocks.push(createBlock(type, payload));
  setWorkspaceDirty(true);
  refreshComposerFromBlocks();
}

function updateBlock(blockId, field, value) {
  const target = workspaceState.bodyBlocks.find((block) => Number(block.id || 0) === Number(blockId || 0));
  if (!target) return;
  target[field] = String(value || "");
  setWorkspaceDirty(true);
  refreshComposerDerivedState();
}

function moveBlock(blockId, direction) {
  const index = workspaceState.bodyBlocks.findIndex((block) => Number(block.id || 0) === Number(blockId || 0));
  if (index < 0) return;
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= workspaceState.bodyBlocks.length) return;
  const [block] = workspaceState.bodyBlocks.splice(index, 1);
  workspaceState.bodyBlocks.splice(nextIndex, 0, block);
  setWorkspaceDirty(true);
  refreshComposerFromBlocks();
}

function deleteBlock(blockId) {
  workspaceState.bodyBlocks = workspaceState.bodyBlocks.filter((block) => Number(block.id || 0) !== Number(blockId || 0));
  setWorkspaceDirty(true);
  refreshComposerFromBlocks();
}

function applyGeneratedArticleDraft(suggestion) {
  const titleNode = qs("article-title");
  const excerptNode = qs("article-excerpt");
  const bodyNode = qs("article-body");
  if (!titleNode || !excerptNode || !bodyNode) {
    throw new Error("Article workspace fields are not ready");
  }
  const nextValues = applyArticleSuggestionFieldValues({
    title: titleNode.value,
    excerpt: excerptNode.value,
    body: bodyNode.value,
  }, suggestion);
  titleNode.value = nextValues.title;
  excerptNode.value = nextValues.excerpt;
  bodyNode.value = nextValues.body;
  workspaceState.bodyBlocks = buildBlocksFromBody(suggestion.body);
  renderBlocks();
  setWorkspaceDirty(true);
  renderPreview();
  renderReviewChecklist();
  renderStatusChip();
  applyActionGuards();
}

function renderHeroAndAssets() {
  const assets = Array.isArray(state.assets) ? state.assets : [];
  ensureSelectedAssetId();

  const library = qs("asset-library");
  if (!library) return;
  if (!assets.length) {
    library.innerHTML = '<p class="muted">No assets found</p>';
    return;
  }
  library.innerHTML = [...assets].sort((left, right) => {
    const leftCover = Number(left?.is_cover || 0) === 1 || String(left?.role || "").trim().toLowerCase() === "cover";
    const rightCover = Number(right?.is_cover || 0) === 1 || String(right?.role || "").trim().toLowerCase() === "cover";
    if (leftCover !== rightCover) return leftCover ? -1 : 1;
    const leftInArticle = Number(left?.selected_in_clean || 0) === 1 && String(left?.role || "").trim().toLowerCase() !== "unused";
    const rightInArticle = Number(right?.selected_in_clean || 0) === 1 && String(right?.role || "").trim().toLowerCase() !== "unused";
    if (leftInArticle !== rightInArticle) return leftInArticle ? -1 : 1;
    return Number(left?.id || 0) - Number(right?.id || 0);
  }).map((row) => {
    const id = Number(row.id || 0);
    const url = sanitizeUrl(row.public_url || "");
    const role = String(row.role || "unused").trim().toLowerCase() || "unused";
    const isCover = Number(row.is_cover || 0) === 1 || role === "cover";
    const inArticle = Number(row.selected_in_clean || 0) === 1 && role !== "unused";
    const isUnused = !inArticle;
    const selected = Number(state.selectedAssetId || 0) === id;
    const roleLabel = isCover ? "cover" : role;
    const presenceLabel = inArticle ? "อยู่ในบทความ" : "ยังไม่ใช้";
    const galleryActive = role === "gallery" && !isCover;
    const galleryTitle = galleryActive ? "Remove from gallery" : "Add to gallery";
    return `
      <article class="article-asset-card${selected ? " is-selected" : ""}${isUnused ? " is-unused" : ""}">
        <button type="button" class="article-asset-select" data-action="select-asset" data-id="${id}" data-preview-url="${escapeHtml(url)}" data-preview-type="${escapeHtml(String(row.mime_type || ""))}" title="${escapeHtml(row.file_name || `asset #${id}`)}">
          ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(row.file_name || "asset")}" />` : `<div class="article-asset-fallback">${escapeHtml(row.file_name || "asset")}</div>`}
        </button>
        <div class="article-asset-meta">
          <strong title="${escapeHtml(row.file_name || `asset #${id}`)}">${escapeHtml(row.file_name || `asset #${id}`)}</strong>
          <span class="article-asset-role">
            <span class="article-asset-badge${isUnused ? " is-unused" : ""}">${escapeHtml(roleLabel)}</span>
            <span class="article-asset-presence${inArticle ? " is-active" : ""}">${presenceLabel}</span>
            ${selected ? '<span class="article-asset-selected">selected</span>' : ""}
          </span>
        </div>
        <div class="toolbar compact-toolbar">
          <button type="button" data-action="insert-image" data-id="${id}" ${isImageAsset(row) ? "" : "disabled"} title="Insert image">Ins</button>
          <button type="button" data-action="set-cover" data-id="${id}" title="Set cover">Cov</button>
          <button type="button" data-action="set-gallery" data-id="${id}" data-active="${galleryActive ? "1" : "0"}" title="${galleryTitle}">Gal</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderReviewChecklist() {
  const root = qs("review-checklist");
  if (!root) return;
  const body = String(qs("article-body")?.value || "").trim();
  const metaTitle = String(qs("article-meta-title")?.value || "").trim();
  const metaDescription = String(qs("article-meta-description")?.value || "").trim();
  const metaDescriptionLength = [...metaDescription].length;
  const slug = String(qs("article-slug")?.value || "").trim();
  const assets = Array.isArray(state.assets) ? state.assets : [];
  const hasCover = assets.some((row) => Number(row.is_cover || 0) === 1 || String(row.role || "") === "cover");
  const hasInlineMediaFromBlocks = (Array.isArray(workspaceState.bodyBlocks) ? workspaceState.bodyBlocks : []).some((block) => {
    const type = String(block?.type || "").trim().toLowerCase();
    if (type === "image") return Boolean(sanitizeUrl(block?.url || ""));
    return false;
  });
  const hasInlineMediaFromBody = /<img\b/i.test(body);
  const hasInlineMedia = hasInlineMediaFromBlocks || hasInlineMediaFromBody;
  const hasVideo = /<(iframe|video)\b/i.test(body) || /youtu\.be|youtube\.com|vimeo\.com/i.test(body);
  const otherTransportMeta = currentOtherTransportMeta();
  const checks = [
    { label: "Title ready", pass: Boolean(String(qs("article-title")?.value || "").trim()) },
    { label: "Summary ready", pass: Boolean(String(qs("article-excerpt")?.value || "").trim()) },
    { label: "Hero image ready", pass: hasCover },
    { label: "Body ready", pass: Boolean(body) },
    { label: "Inline media ready", pass: hasInlineMedia },
    { label: "Slug ready", pass: Boolean(slug) },
    { label: "Meta title ready", pass: Boolean(metaTitle) },
    { label: "Meta description ready", pass: Boolean(metaDescription) },
    { label: "Meta description length recommended (50-180 chars)", pass: !metaDescription || (metaDescriptionLength >= 50 && metaDescriptionLength <= 180) },
    { label: "Video embed valid", pass: hasVideo || !String(qs("video-embed-url")?.value || "").trim() },
  ];
  if (isOtherTransportItem()) {
    checks.push(
      { label: "Transport subtype ready", pass: Boolean(otherTransportMeta.subtype) },
      { label: "Contact name ready", pass: Boolean(otherTransportMeta.contact_name) },
      { label: "Phone or contact channel ready", pass: Boolean(otherTransportMeta.phone || otherTransportMeta.contact_details || otherTransportMeta.link_url) },
      { label: "Thumbnail cover ready", pass: hasCover },
    );
  }
  root.innerHTML = checks.map((row) => `
    <label class="article-check-item">
      <input type="checkbox" disabled ${row.pass ? "checked" : ""} />
      <span>${escapeHtml(row.label)}</span>
    </label>
  `).join("");
}

function renderMetaDescriptionGuidance() {
  const node = qs("meta-description-guidance");
  if (!node) return;
  const metaDescription = String(qs("article-meta-description")?.value || "").trim();
  const length = [...metaDescription].length;
  if (!metaDescription) {
    node.classList.remove("is-warning");
    node.textContent = "ควรอ่านง่าย กระชับ และสอดคล้องเนื้อหา (คำแนะนำ ไม่บล็อกการส่ง)";
    return;
  }
  if (length < 50 || length > 180) {
    node.classList.add("is-warning");
    node.textContent = `ความยาวปัจจุบัน ${length} ตัวอักษร (แนะนำ 50-180 ตัวอักษร, ยังส่งได้ปกติ)`;
    return;
  }
  node.classList.remove("is-warning");
  node.textContent = `ความยาวปัจจุบัน ${length} ตัวอักษร (อยู่ในช่วงแนะนำ)`;
}

function applyActionGuards() {
  const status = getArticleStatus();
  const editable = canEditArticle();
  const validation = validateWorkspace();

  const submitBtn = qs("btn-submit-review");
  if (submitBtn) submitBtn.disabled = state.busy || !editable || (!["drafting", "revision_requested"].includes(status)) || !validation.ok;

  const saveBtn = qs("btn-save-workspace");
  if (saveBtn) saveBtn.disabled = state.busy || !editable;
  const reviewSaveBtn = qs("btn-save-before-review");
  if (reviewSaveBtn) reviewSaveBtn.disabled = state.busy || !editable;
  const articleBtn = qs("btn-generate-article-draft");
  if (articleBtn) articleBtn.disabled = state.busy || workspaceState.articleSuggestionBusy || !editable;
  const seoBtn = qs("btn-generate-seo-metadata");
  if (seoBtn) seoBtn.disabled = state.busy || workspaceState.seoSuggestionBusy || !editable;
}

function isEditorWorkspaceUser() {
  return String(state.user?.role || "").trim().toLowerCase() === "editor";
}

function setWorkspaceBanner(message, kind = "success", options = {}) {
  const text = String(message || "").trim();
  const hard = options?.hard === true;
  if (!isEditorWorkspaceUser()) {
    setBanner(text, kind);
    return;
  }
  const authOnly = /backend authentication is required|ยังไม่ได้ล็อกอิน|authentication/i.test(text);
  if (!text || (!hard && (kind !== "error" || authOnly))) {
    setBanner("", "success");
    return;
  }
  setBanner(text, kind);
}

function applyEditorWorkspaceView() {
  if (!isEditorWorkspaceUser()) return;
  document.title = "Collector - \u0e40\u0e02\u0e35\u0e22\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21";
  const heading = document.querySelector(".header .auth-row h1");
  if (heading) heading.textContent = "\u0e40\u0e02\u0e35\u0e22\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21";
  const subheading = document.querySelector(".header .auth-row p");
  if (subheading) subheading.textContent = "\u0e41\u0e01\u0e49\u0e44\u0e02\u0e41\u0e25\u0e30\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e07\u0e32\u0e19\u0e40\u0e02\u0e35\u0e22\u0e19\u0e02\u0e2d\u0e07\u0e04\u0e38\u0e13";
  const processBar = qs("article-process-bar");
  if (processBar) processBar.classList.add("hidden");
  const authStatus = qs("workspace-auth-status");
  if (authStatus) authStatus.classList.add("hidden");
  const banner = qs("workspace-status");
  if (banner && !banner.classList.contains("is-error")) {
    banner.classList.add("hidden");
    banner.textContent = "";
    banner.classList.remove("is-loading", "is-success");
  }
  const activityCard = qs("article-activity-log")?.closest(".article-card-activity") || null;
  if (activityCard) activityCard.classList.add("hidden");
  const statusChip = qs("article-status-chip");
  if (statusChip) statusChip.classList.add("hidden");
  const backHomeBtn = qs("btn-back-home");
  if (backHomeBtn) backHomeBtn.textContent = "\u0e42\u0e2e\u0e21";
  const openIntakeBtn = qs("btn-open-intake");
  if (openIntakeBtn) openIntakeBtn.textContent = "\u0e01\u0e25\u0e31\u0e1a\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e23\u0e01";
  const saveBtn = qs("btn-save-workspace");
  if (saveBtn && !state.busy) saveBtn.textContent = "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e07\u0e32\u0e19\u0e40\u0e02\u0e35\u0e22\u0e19";
  const reviewSaveBtn = qs("btn-save-before-review");
  if (reviewSaveBtn && !state.busy) reviewSaveBtn.textContent = "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01";
  const mainTitle = document.querySelector(".article-card-meta .section-title");
  if (mainTitle) mainTitle.textContent = "\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21";
  const mainHelp = document.querySelector(".article-card-meta .muted");
  if (mainHelp) mainHelp.textContent = "\u0e41\u0e01\u0e49\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e2b\u0e25\u0e31\u0e01\u0e02\u0e2d\u0e07\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e43\u0e2b\u0e49\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e2a\u0e48\u0e07\u0e15\u0e23\u0e27\u0e08";
  const mediaTitle = document.querySelector(".article-card-media .section-title");
  if (mediaTitle) mediaTitle.textContent = "\u0e23\u0e39\u0e1b\u0e41\u0e25\u0e30\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d";
  const mediaHelp = document.querySelector(".article-card-media .muted");
  if (mediaHelp) mediaHelp.textContent = "\u0e08\u0e31\u0e14\u0e23\u0e39\u0e1b\u0e41\u0e25\u0e30\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d\u0e17\u0e35\u0e48\u0e43\u0e0a\u0e49\u0e43\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e08\u0e32\u0e01\u0e2b\u0e19\u0e49\u0e32\u0e19\u0e35\u0e49";
  const briefTitle = document.querySelector(".article-card-brief .section-title");
  if (briefTitle) briefTitle.textContent = "\u0e42\u0e08\u0e17\u0e22\u0e4c\u0e07\u0e32\u0e19\u0e40\u0e02\u0e35\u0e22\u0e19";
  const briefHelp = document.querySelector(".article-card-brief .muted");
  if (briefHelp) briefHelp.textContent = "\u0e2a\u0e23\u0e38\u0e1b\u0e42\u0e08\u0e17\u0e22\u0e4c \u0e02\u0e49\u0e2d\u0e04\u0e27\u0e23\u0e23\u0e30\u0e27\u0e31\u0e07 \u0e41\u0e25\u0e30\u0e2d\u0e49\u0e32\u0e07\u0e2d\u0e34\u0e07\u0e01\u0e48\u0e2d\u0e19\u0e40\u0e02\u0e35\u0e22\u0e19";
  const bodyTitle = document.querySelector(".article-card-body .section-title");
  if (bodyTitle) bodyTitle.textContent = "\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e2b\u0e32\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21";
  const bodyHelp = document.querySelector(".article-card-body .muted");
  if (bodyHelp) bodyHelp.textContent = "\u0e40\u0e02\u0e35\u0e22\u0e19\u0e41\u0e25\u0e30\u0e08\u0e31\u0e14\u0e27\u0e32\u0e07\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e2b\u0e32\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32\u0e04\u0e34\u0e27\u0e15\u0e23\u0e27\u0e08";
  const previewTitle = document.querySelector(".article-card-preview .section-title");
  if (previewTitle) previewTitle.textContent = "\u0e15\u0e31\u0e27\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21";
  const previewHelp = document.querySelector(".article-card-preview .muted");
  if (previewHelp) previewHelp.textContent = "\u0e15\u0e23\u0e27\u0e08\u0e04\u0e27\u0e32\u0e21\u0e40\u0e23\u0e35\u0e22\u0e1a\u0e23\u0e49\u0e2d\u0e22\u0e02\u0e2d\u0e07\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32\u0e04\u0e34\u0e27\u0e15\u0e23\u0e27\u0e08";
  const labels = [
    ["article-title", "\u0e0a\u0e37\u0e48\u0e2d\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21"],
    ["article-excerpt", "\u0e04\u0e33\u0e40\u0e01\u0e23\u0e34\u0e48\u0e19\u0e22\u0e48\u0e2d"],
    ["article-slug", "Slug"],
    ["article-meta-title", "Meta Title"],
    ["article-meta-description", "Meta Description"],
    ["confirmed-phone", "\u0e40\u0e1a\u0e2d\u0e23\u0e4c\u0e42\u0e17\u0e23"],
    ["confirmed-line-url", "\u0e25\u0e34\u0e07\u0e01\u0e4c LINE"],
    ["confirmed-facebook-url", "\u0e25\u0e34\u0e07\u0e01\u0e4c Facebook"],
    ["confirmed-website-url", "\u0e25\u0e34\u0e07\u0e01\u0e4c\u0e40\u0e27\u0e47\u0e1a\u0e44\u0e0b\u0e15\u0e4c"],
    ["confirmed-primary-cta", "\u0e1b\u0e38\u0e48\u0e21\u0e2b\u0e25\u0e31\u0e01"],
    ["confirmed-category", "\u0e2b\u0e21\u0e27\u0e14\u0e2b\u0e25\u0e31\u0e01"],
    ["confirmed-subtype", "\u0e2b\u0e21\u0e27\u0e14\u0e22\u0e48\u0e2d"],
    ["confirmed-tags", "\u0e41\u0e17\u0e47\u0e01"],
    ["confirmed-meta-status", "\u0e2a\u0e16\u0e32\u0e19\u0e30"],
    ["confirmed-note", "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e1b\u0e23\u0e30\u0e01\u0e2d\u0e1a"],
  ];
  labels.forEach(([id, text]) => {
    const label = qs(id)?.closest("div")?.querySelector("label");
    if (label) label.textContent = text;
  });
  const insertHeading = qs("btn-insert-heading");
  if (insertHeading) insertHeading.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d";
  const insertParagraph = qs("btn-insert-paragraph");
  if (insertParagraph) insertParagraph.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e22\u0e48\u0e2d\u0e2b\u0e19\u0e49\u0e32";
  const insertImage = qs("btn-insert-selected-image");
  if (insertImage) insertImage.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e23\u0e39\u0e1b\u0e17\u0e35\u0e48\u0e40\u0e25\u0e37\u0e2d\u0e01";
  const insertQuote = qs("btn-insert-quote");
  if (insertQuote) insertQuote.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e04\u0e33\u0e1e\u0e39\u0e14";
  const insertList = qs("btn-insert-list");
  if (insertList) insertList.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23";
  const videoInput = qs("video-embed-url");
  if (videoInput) videoInput.placeholder = "\u0e27\u0e32\u0e07\u0e25\u0e34\u0e07\u0e01\u0e4c YouTube/Vimeo \u0e41\u0e25\u0e49\u0e27\u0e01\u0e14\u0e41\u0e17\u0e23\u0e01\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d";
  const insertVideo = qs("btn-insert-video");
  if (insertVideo) insertVideo.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d";
  setArticleSuggestionBusy(workspaceState.articleSuggestionBusy);
  setSeoSuggestionBusy(workspaceState.seoSuggestionBusy);
  const previewDesktop = qs("btn-preview-desktop");
  if (previewDesktop) previewDesktop.textContent = "\u0e40\u0e14\u0e2a\u0e01\u0e4c\u0e17\u0e47\u0e2d\u0e1b";
  const previewMobile = qs("btn-preview-mobile");
  if (previewMobile) previewMobile.textContent = "\u0e21\u0e37\u0e2d\u0e16\u0e37\u0e2d";
  const mediaToggle = qs("btn-toggle-media-library");
  if (mediaToggle) mediaToggle.textContent = workspaceState.mediaCollapsed ? "\u0e41\u0e2a\u0e14\u0e07\u0e04\u0e25\u0e31\u0e07\u0e23\u0e39\u0e1b" : "\u0e0b\u0e48\u0e2d\u0e19\u0e04\u0e25\u0e31\u0e07\u0e23\u0e39\u0e1b";
  const confirmedMetaToggle = qs("btn-toggle-confirmed-meta");
  if (confirmedMetaToggle) confirmedMetaToggle.textContent = workspaceState.confirmedMetaCollapsed ? "\u0e41\u0e2a\u0e14\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19" : "\u0e0b\u0e48\u0e2d\u0e19\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19";
  const systemToggle = qs("btn-toggle-writer-system-info");
  if (systemToggle) systemToggle.textContent = workspaceState.systemInfoCollapsed ? "\u0e41\u0e2a\u0e14\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e23\u0e30\u0e1a\u0e1a" : "\u0e0b\u0e48\u0e2d\u0e19\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e23\u0e30\u0e1a\u0e1a";
  const selfCheckCard = qs("review-checklist")?.closest(".article-preview-review-card") || null;
  if (selfCheckCard) {
    const title = selfCheckCard.querySelector(".section-title");
    const help = selfCheckCard.querySelector(".muted");
    if (title) title.textContent = "\u0e15\u0e23\u0e27\u0e08\u0e40\u0e2d\u0e07\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07";
    if (help) help.textContent = "\u0e40\u0e0a\u0e47\u0e01\u0e04\u0e27\u0e32\u0e21\u0e04\u0e23\u0e1a\u0e02\u0e2d\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25 \u0e40\u0e19\u0e37\u0e49\u0e2d\u0e2b\u0e32 \u0e41\u0e25\u0e30\u0e23\u0e39\u0e1b\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32\u0e04\u0e34\u0e27\u0e15\u0e23\u0e27\u0e08";
  }
  const submitCard = qs("review-status")?.closest(".article-preview-review-card") || null;
  if (submitCard) {
    const title = submitCard.querySelector(".section-title");
    const help = submitCard.querySelector(".muted");
    if (title) title.textContent = "\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32\u0e04\u0e34\u0e27\u0e15\u0e23\u0e27\u0e08";
    if (help) help.textContent = "\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e41\u0e25\u0e49\u0e27 \u0e04\u0e48\u0e2d\u0e22\u0e2a\u0e48\u0e07\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e40\u0e02\u0e49\u0e32\u0e04\u0e34\u0e27\u0e15\u0e23\u0e27\u0e08\u0e08\u0e32\u0e01\u0e2a\u0e48\u0e27\u0e19\u0e19\u0e35\u0e49";
  }
  const submitBtn = qs("btn-submit-review");
  if (submitBtn) submitBtn.textContent = "\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32\u0e04\u0e34\u0e27\u0e15\u0e23\u0e27\u0e08";
}

function renderAll(options = {}) {
  if (options.syncFields === true) {
    renderWorkspaceFields();
  }
  renderProcessBar();
  renderAuthStatus();
  renderStatusChip();
  renderActivityLog();
  renderWriterBrief();
  renderFieldPackEvidencePanel();
  renderTaxonomyReviewPanel();
  renderFieldReturnEvidencePanel();
  renderWriterSystemInfo();
  renderBlocks();
  renderHeroAndAssets();
  renderMediaLibraryVisibility();
  renderConfirmedMetaVisibility();
  renderOtherTransportPanel();
  renderPreview();
  renderReviewChecklist();
  renderMetaDescriptionGuidance();
  applyEditorWorkspaceView();
  applyActionGuards();
}

async function refreshArticleProcess() {
  state.articleProcess = await api(`/api/items/${state.itemId}/article-process`);
}

async function refreshFieldPack() {
  const payload = await api(`/api/items/${state.itemId}/field-pack/current`);
  state.fieldPack = payload?.field_pack || null;
}

async function refreshAssets() {
  state.assets = await api(`/api/assets?content_item_id=${state.itemId}&local_only=1`);
  ensureSelectedAssetId();
  renderHeroAndAssets();
  renderMediaLibraryVisibility();
  renderOtherTransportPanel();
  renderPreview();
  renderReviewChecklist();
  applyEditorWorkspaceView();
  applyActionGuards();
  renderWorkspaceSaveState();
}

async function saveWorkspace() {
  setBusy(true);
  setWorkspaceBanner("Saving article...", "loading");
  try {
    const payload = collectWorkspacePayload();
    const result = await api(`/api/items/${state.itemId}/editor-work`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.item = result?.item || state.item;
    await refreshArticleProcess();
    await refreshFieldPack();
    setWorkspaceDirty(false);
    renderAll();
    setWorkspaceBanner("Article saved");
  } finally {
    setBusy(false);
    applyActionGuards();
  }
}

async function generateSeoMetadataSuggestion() {
  setSeoSuggestionBusy(true);
  setInlineStatus("seo-metadata-status", "Generating SEO metadata...", "loading");
  try {
    const payload = collectSeoSuggestionPayload();
    if (!payload.title && !payload.excerpt && !payload.body && !payload.body_blocks_text) {
      throw new Error("Please add title, excerpt, or body before generating SEO metadata");
    }

    const result = await api(`/api/items/${state.itemId}/seo-suggestion`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const suggestion = normalizeSeoSuggestionPayload(result?.suggestion || {});
    if (!suggestion.meta_title && !suggestion.meta_description) {
      throw new Error("SEO Agent returned no usable meta suggestions");
    }

    const currentMetaTitle = String(qs("article-meta-title")?.value || "").trim();
    const currentMetaDescription = String(qs("article-meta-description")?.value || "").trim();
    const nextMetaTitle = suggestion.meta_title;
    const nextMetaDescription = suggestion.meta_description;
    const hasExistingMeta = Boolean(currentMetaTitle || currentMetaDescription);

    if (hasExistingMeta) {
      const confirmed = window.confirm("Replace existing Meta Title / Meta Description with SEO Agent suggestions?");
      if (!confirmed) {
        setInlineStatus("seo-metadata-status", "Kept existing metadata");
        return;
      }
    }

    const metaTitleNode = qs("article-meta-title");
    const metaDescriptionNode = qs("article-meta-description");
    const nextValues = applySeoSuggestionFieldValues({
      meta_title: String(metaTitleNode?.value || ""),
      meta_description: String(metaDescriptionNode?.value || ""),
    }, {
      meta_title: nextMetaTitle,
      meta_description: nextMetaDescription,
    });

    let applied = false;
    if (nextMetaTitle && metaTitleNode) {
      metaTitleNode.value = nextValues.meta_title;
      applied = true;
    }
    if (nextMetaDescription && metaDescriptionNode) {
      metaDescriptionNode.value = nextValues.meta_description;
      applied = true;
    }
    if (!applied) {
      throw new Error("SEO Agent returned no usable meta suggestions");
    }

    setWorkspaceDirty(true);
    renderPreview();
    renderReviewChecklist();
    renderMetaDescriptionGuidance();
    renderStatusChip();
    applyActionGuards();
    setInlineStatus("seo-metadata-status", "SEO metadata applied locally");
  } finally {
    setSeoSuggestionBusy(false);
    applyActionGuards();
  }
}

async function generateArticleDraftSuggestion() {
  setArticleSuggestionBusy(true);
  setInlineStatus("article-draft-status", "Generating article draft...", "loading");
  try {
    const payload = collectArticleSuggestionPayload();
    if (!payload.title && !payload.excerpt && !payload.body && !payload.body_blocks_text && !payload.field_pack && !payload.publishable_source) {
      throw new Error("Please add source material before generating an article draft");
    }

    const result = await api(`/api/items/${state.itemId}/article-suggestion`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const suggestion = normalizeArticleSuggestionPayload(result?.suggestion || {});
    if (!suggestion.title || !suggestion.excerpt || !suggestion.body) {
      throw new Error("Article Agent returned no usable draft content");
    }

    const currentTitle = String(qs("article-title")?.value || "").trim();
    const currentExcerpt = String(qs("article-excerpt")?.value || "").trim();
    const currentBody = String(qs("article-body")?.value || "").trim();
    const hasExistingContent = Boolean(currentTitle || currentExcerpt || currentBody);
    if (hasExistingContent) {
      const confirmed = window.confirm("Replace existing Title / Excerpt / Body with Article Agent draft? This may replace body content.");
      if (!confirmed) {
        setInlineStatus("article-draft-status", "Kept existing article content");
        return;
      }
    }

    applyGeneratedArticleDraft(suggestion);
    setInlineStatus(
      "article-draft-status",
      suggestion.editor_notes.length > 0
        ? `Article draft applied locally. Notes: ${suggestion.editor_notes.join(" | ")}`
        : "Article draft applied locally"
    );
  } finally {
    setArticleSuggestionBusy(false);
    applyActionGuards();
  }
}

async function transitionArticle(status, note = "") {
  setBusy(true);
  setWorkspaceBanner("Updating workflow...", "loading");
  try {
    await api(`/api/items/${state.itemId}/article-process/transition`, {
      method: "POST",
      body: JSON.stringify({ status, note }),
    });
    await refreshArticleProcess();
    await refreshFieldPack();
    renderAll();
    setWorkspaceBanner("Workflow updated");
  } finally {
    setBusy(false);
    applyActionGuards();
  }
}

async function submitWorkspaceForReview(note = "") {
  setBusy(true);
  setWorkspaceBanner("Submitting for review...", "loading");
  try {
    await api(`/api/items/${state.itemId}/article-process/submit-review`, {
      method: "POST",
      body: JSON.stringify({
        note: String(note || "").trim() || null,
        reason_code: "article_process_ready_for_review",
      }),
    });
    await refreshArticleProcess();
    await refreshFieldPack();
    renderAll();
    setWorkspaceBanner("Submitted for review");
  } finally {
    setBusy(false);
    applyActionGuards();
  }
}

async function updateAssetRole(assetId, role) {
  await api(`/api/items/${state.itemId}/assets/${assetId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  await refreshAssets();
}

function currentAssetRole(assetId) {
  const id = Number(assetId || 0);
  if (!id) return "unused";
  const row = (Array.isArray(state.assets) ? state.assets : []).find((entry) => Number(entry?.id || 0) === id);
  if (!row) return "unused";
  const role = String(row.role || "unused").trim().toLowerCase() || "unused";
  const isCover = Number(row.is_cover || 0) === 1 || role === "cover";
  return isCover ? "cover" : role;
}

function insertImageByAssetId(assetId) {
  state.selectedAssetId = Number(assetId || 0) || 0;
  const asset = (Array.isArray(state.assets) ? state.assets : []).find((row) => Number(row.id || 0) === state.selectedAssetId) || null;
  if (!asset) throw new Error("Please select an asset first");
  if (!isImageAsset(asset)) throw new Error("Selected asset is not an image");
  const url = sanitizeUrl(asset.public_url || "");
  if (!url) throw new Error("Selected asset has no public URL");
  addBlock("image", {
    url,
    caption: "",
    alt: "",
    asset_id: Number(asset?.asset_id || 0) || 0,
    content_asset_id: Number(asset?.id || 0) || 0,
  });
  setInlineStatus("asset-status", "Image inserted");
}

function insertVideoEmbed() {
  const input = qs("video-embed-url");
  const url = normalizeEmbedUrl(input?.value || "");
  if (!url) throw new Error("Please provide a valid YouTube/Vimeo URL");
  addBlock("video", { url, caption: "" });
  input.value = "";
}

function applyFieldReturnEvidenceByKey(key) {
  const evidence = fieldReturnEvidence();
  const item = (Array.isArray(evidence?.items) ? evidence.items : []).find((row) => String(row?.key || "").trim().toLowerCase() === String(key || "").trim().toLowerCase()) || null;
  if (!canApplyFieldReturnEvidenceToConfirmedCta(item, state.item)) return false;
  const currentValues = {
    phone: String(qs("confirmed-phone")?.value || ""),
    line_url: String(qs("confirmed-line-url")?.value || ""),
    facebook_url: String(qs("confirmed-facebook-url")?.value || ""),
    website_url: String(qs("confirmed-website-url")?.value || ""),
    primary_cta: String(qs("confirmed-primary-cta")?.value || ""),
  };
  const nextValues = applyFieldReturnEvidenceToConfirmedCta(currentValues, item, state.item);
  const nextFieldName = String(item.key || "").trim().toLowerCase().split(".")[1] || "";
  const currentValue = String(currentValues[nextFieldName] || "").trim();
  const nextValue = String(nextValues[nextFieldName] || "").trim();
  if (currentValue && currentValue !== nextValue) {
    const confirmed = window.confirm("มีค่าที่ยืนยันไว้แล้ว ต้องการแทนที่ด้วยค่าที่คนเช็กส่งกลับหรือไม่?");
    if (!confirmed) return false;
  }
  fillField("confirmed-phone", nextValues.phone || "");
  fillField("confirmed-line-url", nextValues.line_url || "");
  fillField("confirmed-facebook-url", nextValues.facebook_url || "");
  fillField("confirmed-website-url", nextValues.website_url || "");
  fillField("confirmed-primary-cta", nextValues.primary_cta || "");
  setWorkspaceDirty(true);
  renderStatusChip();
  applyActionGuards();
  setInlineStatus("field-return-evidence-status", "คัดลอกค่ามาไว้ในข้อมูลยืนยันแล้ว กรุณากดบันทึก");
  return true;
}

function handleFieldReturnEvidencePanelClick(event) {
  const actionNode = event?.target?.closest?.("[data-action='apply-field-return-evidence']");
  if (!actionNode) return false;
  try {
    return applyFieldReturnEvidenceByKey(actionNode.dataset.fieldReturnKey || "");
  } catch (err) {
    setInlineStatus("field-return-evidence-status", err.message, "error");
    return false;
  }
}

function wire() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-intake")?.addEventListener("click", () => {
    window.location.href = intakeUrl();
  });
  qs("btn-save-workspace")?.addEventListener("click", async () => {
    try {
      await saveWorkspace();
    } catch (err) {
      setWorkspaceBanner(err.message, "error");
    }
  });
  qs("btn-save-before-review")?.addEventListener("click", async () => {
    try {
      await saveWorkspace();
      setInlineStatus("review-status", "บันทึกแล้ว");
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
    }
  });
  qs("btn-generate-article-draft")?.addEventListener("click", async () => {
    try {
      await generateArticleDraftSuggestion();
    } catch (err) {
      setInlineStatus("article-draft-status", err.message, "error");
    }
  });
  qs("btn-generate-seo-metadata")?.addEventListener("click", async () => {
    try {
      await generateSeoMetadataSuggestion();
    } catch (err) {
      setInlineStatus("seo-metadata-status", err.message, "error");
    }
  });
  qs("article-title")?.addEventListener("input", () => {
    setWorkspaceDirty(true);
    const slugNode = qs("article-slug");
    if (slugNode && !String(slugNode.value || "").trim()) {
      slugNode.value = slugify(qs("article-title")?.value || "") || `item-${Number(state.item?.id || 0) || "workspace"}`;
    }
    renderPreview();
    renderReviewChecklist();
  });
  ["article-excerpt", "article-slug", "article-meta-title", "article-meta-description"].forEach((id) => {
    qs(id)?.addEventListener("input", () => {
      setWorkspaceDirty(true);
      renderPreview();
      renderReviewChecklist();
      renderMetaDescriptionGuidance();
      renderStatusChip();
      applyActionGuards();
    });
  });
  ["confirmed-phone", "confirmed-line-url", "confirmed-facebook-url", "confirmed-website-url", "confirmed-category", "confirmed-subtype", "confirmed-note"].forEach((id) => {
    qs(id)?.addEventListener("input", () => {
      setWorkspaceDirty(true);
      renderStatusChip();
      applyActionGuards();
    });
  });
  qs("confirmed-tags")?.addEventListener("change", () => {
    fillField("confirmed-tags", normalizeCommaSeparatedTags(qs("confirmed-tags")?.value || "").join(", "));
    setWorkspaceDirty(true);
    renderStatusChip();
    applyActionGuards();
  });
  qs("confirmed-tags")?.addEventListener("input", () => {
    setWorkspaceDirty(true);
    renderStatusChip();
    applyActionGuards();
  });
  ["confirmed-primary-cta", "confirmed-meta-status"].forEach((id) => {
    qs(id)?.addEventListener("change", () => {
      setWorkspaceDirty(true);
      renderStatusChip();
      applyActionGuards();
    });
  });
  ["other-transport-type", "other-transport-contact-name", "other-transport-contact-details", "other-transport-phone", "other-transport-link"].forEach((id) => {
    ["input", "change"].forEach((eventName) => {
      qs(id)?.addEventListener(eventName, () => {
        setWorkspaceDirty(true);
        renderOtherTransportPanel();
        renderPreview();
        renderReviewChecklist();
        renderStatusChip();
        applyActionGuards();
      });
    });
  });
  qs("article-body")?.addEventListener("input", () => {
    setWorkspaceDirty(true);
    workspaceState.bodyBlocks = [createBlock("html", { text: qs("article-body")?.value || "" })];
    renderBlocks();
    renderPreview();
    renderReviewChecklist();
    renderStatusChip();
    applyActionGuards();
  });
  qs("btn-preview-desktop")?.addEventListener("click", () => {
    state.previewMode = "desktop";
    qs("btn-preview-desktop")?.classList.add("active");
    qs("btn-preview-mobile")?.classList.remove("active");
    renderPreview();
  });
  qs("btn-preview-mobile")?.addEventListener("click", () => {
    state.previewMode = "mobile";
    qs("btn-preview-mobile")?.classList.add("active");
    qs("btn-preview-desktop")?.classList.remove("active");
    renderPreview();
  });
  qs("btn-insert-heading")?.addEventListener("click", () => addBlock("heading", { text: "New heading" }));
  qs("btn-insert-paragraph")?.addEventListener("click", () => addBlock("paragraph", { text: "New paragraph" }));
  qs("btn-insert-quote")?.addEventListener("click", () => addBlock("quote", { text: "Quote text" }));
  qs("btn-insert-list")?.addEventListener("click", () => addBlock("list", { text: "Item 1\nItem 2", list_style: "unordered" }));
  qs("btn-insert-selected-image")?.addEventListener("click", () => {
    try {
      insertImageByAssetId(state.selectedAssetId);
    } catch (err) {
      setInlineStatus("asset-status", err.message, "error");
    }
  });
  qs("btn-insert-video")?.addEventListener("click", () => {
    try {
      insertVideoEmbed();
    } catch (err) {
      setInlineStatus("asset-status", err.message, "error");
    }
  });
  qs("btn-toggle-media-library")?.addEventListener("click", () => {
    workspaceState.mediaCollapsed = !workspaceState.mediaCollapsed;
    renderMediaLibraryVisibility();
  });
  qs("btn-toggle-confirmed-meta")?.addEventListener("click", () => {
    workspaceState.confirmedMetaCollapsed = !workspaceState.confirmedMetaCollapsed;
    renderConfirmedMetaVisibility();
  });
  qs("btn-toggle-writer-system-info")?.addEventListener("click", () => {
    workspaceState.systemInfoCollapsed = !workspaceState.systemInfoCollapsed;
    renderWriterSystemInfo();
  });
  qs("field-return-evidence-panel")?.addEventListener("click", handleFieldReturnEvidencePanelClick);
  qs("asset-library")?.addEventListener("click", async (event) => {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = String(actionNode.dataset.action || "").trim();
    const assetId = Number(actionNode.dataset.id || 0);
    if (!assetId) return;
    try {
      if (action === "select-asset") {
        state.selectedAssetId = assetId;
        renderHeroAndAssets();
        setInlineStatus("asset-status", "Asset selected");
        return;
      }
      if (action === "insert-image") {
        insertImageByAssetId(assetId);
        return;
      }
      if (action === "set-cover") {
        await updateAssetRole(assetId, "cover");
        setInlineStatus("asset-status", "Cover updated");
        return;
      }
      if (action === "set-gallery") {
        const nextRole = currentAssetRole(assetId) === "gallery" ? "unused" : "gallery";
        await updateAssetRole(assetId, nextRole);
        setInlineStatus("asset-status", nextRole === "gallery" ? "Added to gallery" : "Removed from gallery");
        return;
      }
      if (action === "set-inline") {
        await updateAssetRole(assetId, "inline");
        setInlineStatus("asset-status", "Inline role updated");
      }
    } catch (err) {
      setInlineStatus("asset-status", err.message, "error");
    }
  });
  qs("asset-library")?.addEventListener("mousemove", (event) => {
    const previewNode = event.target.closest("[data-preview-url]");
    if (!previewNode) {
      hideArticleAssetHoverPreview();
      return;
    }
    const url = String(previewNode.dataset.previewUrl || "").trim();
    if (!url) {
      hideArticleAssetHoverPreview();
      return;
    }
    positionArticleAssetHoverPreview(event);
  });
  qs("asset-library")?.addEventListener("mouseover", (event) => {
    const previewNode = event.target.closest("[data-preview-url]");
    if (!previewNode) return;
    const url = String(previewNode.dataset.previewUrl || "").trim();
    const mimeType = String(previewNode.dataset.previewType || "").trim();
    if (!url) return;
    showArticleAssetHoverPreview(url, mimeType, event);
  });
  qs("asset-library")?.addEventListener("mouseleave", () => {
    hideArticleAssetHoverPreview();
  });
  qs("article-blocks")?.addEventListener("input", (event) => {
    const fieldNode = event.target.closest("[data-block-field]");
    if (!fieldNode) return;
    updateBlock(fieldNode.dataset.blockId, fieldNode.dataset.blockField, fieldNode.value);
  });
  qs("article-blocks")?.addEventListener("click", (event) => {
    const actionNode = event.target.closest("[data-block-action]");
    if (!actionNode) return;
    const blockId = Number(actionNode.dataset.blockId || 0);
    const action = String(actionNode.dataset.blockAction || "");
    if (!blockId) return;
    if (action === "move-up") moveBlock(blockId, "up");
    else if (action === "move-down") moveBlock(blockId, "down");
    else if (action === "delete") deleteBlock(blockId);
  });
  window.addEventListener("beforeunload", (event) => {
    if (!workspaceState.dirty || state.busy) return;
    event.preventDefault();
    event.returnValue = "";
  });
  qs("btn-submit-review")?.addEventListener("click", async () => {
    try {
      const validation = validateWorkspace();
      if (!validation.ok) throw new Error(`Missing: ${validation.missing.join(", ")}`);
      const note = currentReviewNote() || "submitted from article workspace";
      await saveWorkspace();
      await submitWorkspaceForReview(note);
      window.location.href = reviewUrl();
      setInlineStatus("review-status", "Submitted for review");
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
    }
  });
}

async function init() {
  wire();
  try {
    await loadWorkspace();
    if (!canEditArticle()) {
      window.location.replace(roleArticleFallbackUrl());
      return;
    }
    renderAll({ syncFields: true });
  } catch (err) {
    const role = currentRole();
    if (/forbidden|ไม่มีสิทธิ์/i.test(String(err?.message || "")) || role === "editor" || role === "freelance") {
      window.location.replace(roleArticleFallbackUrl());
      return;
    }
    const hardMessage = /backend authentication is required|authentication/i.test(String(err?.message || ""))
      ? "\u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e40\u0e1b\u0e34\u0e14\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e02\u0e35\u0e22\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e44\u0e14\u0e49 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a\u0e43\u0e2b\u0e21\u0e48"
      : String(err?.message || "\u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e40\u0e1b\u0e34\u0e14\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e02\u0e35\u0e22\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e44\u0e14\u0e49");
    setWorkspaceBanner(hardMessage, "error", { hard: true });
  }
}

init();



