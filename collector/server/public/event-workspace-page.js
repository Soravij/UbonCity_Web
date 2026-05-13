import {
  api,
  canEditArticle,
  currentRole,
  ensureSelectedAssetId,
  escapeHtml,
  fillField,
  getArticleStatus,
  intakeUrl,
  isImageAsset,
  latestDraft,
  loadWorkspace,
  normalizeEmbedUrl,
  qs,
  renderActivityLog,
  renderAuthStatus,
  renderPreview,
  renderProcessBar,
  renderStatusChip,
  eventReviewUrl,
  sanitizeUrl,
  setBanner,
  setInlineStatus,
  slugify,
  state,
} from "./article-workflow-core.js";

const workspaceState = {
  bodyBlocks: [],
  nextBlockId: 1,
  dirty: false,
};

const SUPPORTED_EVENT_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_EVENT_UPLOAD_BYTES = 20 * 1024 * 1024;

function setText(selector, text) {
  const node = document.querySelector(selector);
  if (node) node.textContent = text;
}

function setPlaceholder(id, text) {
  const node = qs(id);
  if (node) node.placeholder = text;
}

function setLabel(forId, text) {
  const input = qs(forId);
  const label = input?.closest("div")?.querySelector("label");
  if (label) label.textContent = text;
}

function applyStaticEventCopy() {
  setText(".header .auth-row h1", "ระบบจัดการคอนเทนต์ UbonCity.com");
  setText(".header .auth-row p", "หน้าทำงาน Event สำหรับเขียน event editorial ด้วย composer เดิมในฟอร์มเฉพาะ event");
  setText("#btn-back-home", "โฮม");
  setText("#btn-open-events", "กลับหน้าแรก");
  setText("#btn-open-intake", "กลับหน้ารับงาน");
  if (!state.busy) setText("#btn-save-workspace", "บันทึก");

  setText(".article-card-meta .section-title", "ข้อมูลหลักของ Event");
  setText(".article-card-meta .muted", "ฟิลด์ที่จำเป็นสำหรับ event editorial");
  setLabel("article-title", "Title");
  setLabel("article-excerpt", "Summary");
  setLabel("article-slug", "Slug");
  setLabel("article-meta-title", "Meta Title");
  setLabel("article-meta-description", "Meta Description");
  setLabel("event-period-text", "Event Period");
  setLabel("event-location-text", "Location");
  setLabel("event-map-url", "Map URL");
  setPlaceholder("event-period-text", "เช่น 17-21 เม.ย. 2569");
  setPlaceholder("event-location-text", "เช่น ทุ่งศรีเมือง อุบลราชธานี");
  setPlaceholder("event-map-url", "https://maps.google.com/...");

  setText(".article-card-media .section-title", "Media Library");
  setText(".article-card-media .muted", "มี cover image 1 รูป และแทรกรูปในเนื้อหาได้");
  setText("#btn-upload-assets", "อัปโหลดรูป");

  setText(".article-card-body .section-title", "Body Composer");
  setText(".article-card-body .muted", "ใช้ composer เดิมและรองรับ inline images");
  setText("#btn-insert-heading", "แทรกหัวข้อ");
  setText("#btn-insert-paragraph", "แทรกย่อหน้า");
  setText("#btn-insert-selected-image", "แทรกรูปที่เลือก");
  setText("#btn-insert-quote", "Quote");
  setText("#btn-insert-list", "List");
  setPlaceholder("video-embed-url", "วางลิงก์ YouTube/Vimeo แล้วกดแทรกวิดีโอ");
  setText("#btn-insert-video", "แทรกวิดีโอ");
  setText(".article-block-tools .muted", "บันทึก body ลง storage เดิมของ composer");

  setText(".article-card-preview .section-title", "Preview");
  setText(".article-card-preview .muted", "ตรวจ event ก่อนส่ง review");
  setText("#btn-preview-desktop", "Desktop");
  setText("#btn-preview-mobile", "Mobile");

  const previewCards = document.querySelectorAll(".article-preview-review-card");
  if (previewCards[0]) {
    const title = previewCards[0].querySelector(".section-title");
    const help = previewCards[0].querySelector(".muted");
    if (title) title.textContent = "Self-check";
    if (help) help.textContent = "ตรวจความครบถ้วนก่อนส่ง review";
  }
  if (previewCards[1]) {
    const title = previewCards[1].querySelector(".section-title");
    const help = previewCards[1].querySelector(".muted");
    if (title) title.textContent = "ส่งตรวจ";
    if (help) help.textContent = "บันทึกงานแล้วส่งเข้า review";
  }
  setText("#btn-submit-review", "ส่งตรวจ");

  setText(".article-card-activity .section-title", "Recent Activity");
  setText(".article-card-activity .muted", "ดูโน้ตและ workflow ล่าสุด");
}

function eventFallbackUrl() {
  const role = String(currentRole() || "").trim().toLowerCase();
  if (role === "editor") {
    return "/event-workspace.html";
  }
  const normalizedItemId = Number(state.itemId || 0) || 0;
  if (role === "owner" || role === "admin") return "/events-manager.html";
  if (role === "freelance") return "/?tab=work";
  return intakeUrl(state.itemId);
}

function formatDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

async function loadEditorEventAssignments() {
  const mine = await api("/api/assignments/mine");
  const rows = Array.isArray(mine) ? mine : [];
  const editorialRows = rows.filter((row) => String(row?.assignment_kind || "").trim().toLowerCase() === "editorial");
  const itemIds = Array.from(
    new Set(
      editorialRows
        .map((row) => Number(row?.content_item_id || 0) || 0)
        .filter((itemId) => itemId > 0)
    )
  );
  if (!itemIds.length) return [];
  const items = await Promise.all(
    itemIds.map(async (itemId) => {
      try {
        const item = await api(`/api/items/${itemId}`);
        return item || null;
      } catch {
        return null;
      }
    })
  );
  const eventItemIds = new Set(
    items
      .filter((item) => String(item?.type || "").trim().toLowerCase() === "event")
      .map((item) => Number(item?.id || 0) || 0)
      .filter((itemId) => itemId > 0)
  );
  return editorialRows
    .filter((row) => eventItemIds.has(Number(row?.content_item_id || 0) || 0))
    .sort((left, right) => {
      const leftTime = new Date(left?.updated_at || left?.created_at || 0).getTime() || 0;
      const rightTime = new Date(right?.updated_at || right?.created_at || 0).getTime() || 0;
      return rightTime - leftTime;
    });
}

function renderEditorEventAssignmentPicker(rows) {
  const grid = document.querySelector(".article-workspace-grid");
  if (!grid) return;
  const existing = qs("event-workspace-picker");
  if (existing) existing.remove();
  const picker = document.createElement("section");
  picker.id = "event-workspace-picker";
  picker.className = "card article-work-card";
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    picker.innerHTML = `
      <div class="article-section-head">
        <div>
          <h2 class="section-title">ตารางงานเขียน Event</h2>
          <p class="muted">ยังไม่พบงาน Event editorial ในคิวของคุณ</p>
        </div>
      </div>
    `;
    grid.prepend(picker);
    return;
  }
  picker.innerHTML = `
    <div class="article-section-head">
      <div>
        <h2 class="section-title">ตารางงานเขียน Event</h2>
        <p class="muted">เลือกงานเพื่อเปิด Event Workspace</p>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Assignment</th>
            <th>Item</th>
            <th>สถานะ</th>
            <th>อัปเดตล่าสุด</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((row) => {
              const assignmentId = Number(row?.id || 0) || 0;
              const itemId = Number(row?.content_item_id || 0) || 0;
              const status = escapeHtml(String(row?.status || "-"));
              const updated = escapeHtml(formatDateTime(row?.updated_at || row?.created_at || ""));
              return `
                <tr>
                  <td>#${assignmentId || "-"}</td>
                  <td>#${itemId || "-"}</td>
                  <td>${status}</td>
                  <td>${updated}</td>
                  <td><button type="button" class="utility-action" data-action="open-event-item" data-item-id="${itemId}">เปิดงาน</button></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  picker.addEventListener("click", (event) => {
    const button = event.target.closest('button[data-action="open-event-item"]');
    if (!button) return;
    const itemId = Number(button.getAttribute("data-item-id") || 0) || 0;
    if (!itemId) return;
    window.location.assign(`/event-workspace.html?id=${itemId}`);
  });
  grid.prepend(picker);
}

function ensureEventItem() {
  if (String(state.item?.type || "").trim().toLowerCase() === "event") return true;
  window.location.replace(eventFallbackUrl());
  return false;
}

function validateEventUploadFile(file) {
  const mimeType = String(file?.type || "").trim().toLowerCase();
  if (!SUPPORTED_EVENT_UPLOAD_MIME_TYPES.has(mimeType)) {
    throw new Error("รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ GIF");
  }
  const size = Number(file?.size || 0);
  if (size > MAX_EVENT_UPLOAD_BYTES) {
    throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 20MB");
  }
}

function collectEventWorkspacePayload() {
  const draft = latestDraft();
  const item = state.item || {};
  const title = String(qs("article-title")?.value || draft?.draft_title || item.title || "").trim();
  const excerpt = String(qs("article-excerpt")?.value || draft?.excerpt || item.summary || "").trim();
  const slug = slugify(String(qs("article-slug")?.value || item.slug || title || "").trim()) || `event-${Number(item?.id || 0) || "workspace"}`;
  const metaTitle = String(qs("article-meta-title")?.value || draft?.meta_title || item.meta_title || "").trim();
  const metaDescription = String(qs("article-meta-description")?.value || draft?.meta_description || item.meta_description || "").trim();
  const eventPeriodText = String(qs("event-period-text")?.value || item.event_period_text || "").trim();
  const locationText = String(qs("event-location-text")?.value || item.location_text || "").trim();
  const mapUrl = String(qs("event-map-url")?.value || item.map_url || "").trim();
  const body = String(qs("article-body")?.value || draft?.body || item.description_clean || item.description_raw || "").trim();
  return {
    item: {
      title,
      summary: excerpt,
      slug,
      meta_title: metaTitle,
      meta_description: metaDescription,
      event_period_text: eventPeriodText,
      location_text: locationText,
      map_url: mapUrl,
      description_clean: body,
      description_raw: body,
    },
    draft: {
      draft_title: title,
      excerpt,
      body,
      meta_title: metaTitle,
      meta_description: metaDescription,
      status: "generated",
    },
  };
}

function validateEventWorkspace() {
  const payload = collectEventWorkspacePayload();
  const missing = [];
  if (!payload.item.title) missing.push("title");
  if (!payload.item.summary) missing.push("summary");
  if (!payload.item.slug) missing.push("slug");
  if (!payload.item.meta_title) missing.push("meta title");
  if (!payload.item.meta_description) missing.push("meta description");
  if (!payload.item.event_period_text) missing.push("event period");
  if (!payload.item.location_text) missing.push("location");
  if (!payload.item.description_clean) missing.push("body");
  const hasCover = (Array.isArray(state.assets) ? state.assets : []).some((row) => Number(row.is_cover || 0) === 1 || String(row.role || "") === "cover");
  if (!hasCover) missing.push("cover image");
  return { ok: missing.length === 0, missing };
}

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
    return createBlock("gallery", {
      text: images.map((image) => sanitizeUrl(image.getAttribute("src") || "")).filter(Boolean).join("\n"),
      caption: element.querySelector("figcaption")?.textContent || "",
    });
  }
  const image = images[0] || null;
  if (image) {
    return createBlock("image", {
      url: sanitizeUrl(image.getAttribute("src") || ""),
      alt: image.getAttribute("alt") || "",
      caption: element.querySelector("figcaption")?.textContent || "",
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
    });
  }
  if (tag === "iframe" || tag === "video") {
    return createBlock("video", {
      url: normalizeEmbedUrl(node.getAttribute("src") || ""),
      caption: "",
    });
  }
  if (tag === "div" && node.classList.contains("preview-gallery")) {
    const images = Array.from(node.querySelectorAll(":scope > img"));
    return createBlock("gallery", {
      text: images.map((image) => sanitizeUrl(image.getAttribute("src") || "")).filter(Boolean).join("\n"),
      caption: "",
    });
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
    if (block.type === "gallery") return Boolean(String(block.text || "").trim());
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
    return `<figure>\n  <img src="${url}" alt="${alt}" />\n  ${caption ? `<figcaption>${caption}</figcaption>` : ""}\n</figure>`;
  }
  if (type === "gallery") {
    const urls = String(block?.text || "")
      .split(/\n+/)
      .map((item) => sanitizeUrl(item))
      .filter(Boolean);
    if (!urls.length) return "";
    const caption = escapeHtml(String(block?.caption || "").trim());
    return `<figure class="gallery-block">\n  ${urls.map((url) => `<img src="${url}" alt="gallery image" />`).join("\n  ")}\n  ${caption ? `<figcaption>${caption}</figcaption>` : ""}\n</figure>`;
  }
  if (type === "video") {
    const url = normalizeEmbedUrl(block?.url || "");
    if (!url) return "";
    const caption = escapeHtml(String(block?.caption || "").trim() || "Embedded video");
    return `<figure class="embedded-video">\n  <iframe src="${url}" loading="lazy" allowfullscreen></iframe>\n  <figcaption>${caption}</figcaption>\n</figure>`;
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
  const previewNote = qs("preview-dirty-note");
  if (previewNote) {
    previewNote.classList.toggle("hidden", state.busy || !workspaceState.dirty);
  }
}

function setWorkspaceDirty(nextDirty = true) {
  workspaceState.dirty = nextDirty === true;
  renderWorkspaceSaveState();
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
  ].forEach((id) => {
    const node = qs(id);
    if (node) node.disabled = state.busy;
  });
  renderWorkspaceSaveState();
}

function renderWorkspaceFields() {
  const item = state.item || {};
  const draft = latestDraft();
  const bodyValue = draft?.body || item.description_clean || item.description_raw || "";
  fillField("article-title", draft?.draft_title || item.title || "");
  fillField("article-excerpt", draft?.excerpt || item.summary || "");
  fillField("article-slug", item.slug || "");
  fillField("article-meta-title", draft?.meta_title || item.meta_title || "");
  fillField("article-meta-description", draft?.meta_description || item.meta_description || "");
  fillField("event-period-text", item.event_period_text || "");
  fillField("event-location-text", item.location_text || "");
  fillField("event-map-url", item.map_url || "");
  fillField("article-body", bodyValue);
  workspaceState.bodyBlocks = buildBlocksFromBody(bodyValue);
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

function renderHeroAndAssets() {
  const assets = Array.isArray(state.assets) ? state.assets : [];
  ensureSelectedAssetId();

  const library = qs("asset-library");
  if (!library) return;
  if (!assets.length) {
    library.innerHTML = '<p class="muted">No assets found</p>';
    return;
  }
  library.innerHTML = `
    <div class="article-asset-table-head">
      <span>Preview</span>
      <span>File</span>
      <span>Actions</span>
    </div>
  ` + [...assets].sort((left, right) => {
    const leftCover = Number(left?.is_cover || 0) === 1 || String(left?.role || "").trim().toLowerCase() === "cover";
    const rightCover = Number(right?.is_cover || 0) === 1 || String(right?.role || "").trim().toLowerCase() === "cover";
    if (leftCover !== rightCover) return leftCover ? -1 : 1;
    return Number(left?.id || 0) - Number(right?.id || 0);
  }).map((row) => {
    const id = Number(row.id || 0);
    const url = sanitizeUrl(row.public_url || "");
    const role = String(row.role || "unused").trim().toLowerCase() || "unused";
    const isCover = Number(row.is_cover || 0) === 1 || role === "cover";
    const selected = Number(state.selectedAssetId || 0) === id;
    return `
      <article class="article-asset-card${selected ? " is-selected" : ""}">
        <button type="button" class="article-asset-select" data-action="select-asset" data-id="${id}" data-preview-url="${escapeHtml(url)}" data-preview-type="${escapeHtml(String(row.mime_type || ""))}">
          ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(row.file_name || "asset")}" />` : `<div class="article-asset-fallback">${escapeHtml(row.file_name || "asset")}</div>`}
        </button>
        <div class="article-asset-meta">
          <strong title="${escapeHtml(row.file_name || `asset #${id}`)}">${escapeHtml(row.file_name || `asset #${id}`)}</strong>
          <span>${escapeHtml(role)}${isCover ? ' <span class="article-asset-badge">cover</span>' : ""}</span>
        </div>
        <div class="toolbar compact-toolbar">
          <button type="button" data-action="insert-image" data-id="${id}" ${isImageAsset(row) ? "" : "disabled"}>Insert</button>
          <button type="button" data-action="set-cover" data-id="${id}">Cover</button>
          <button type="button" data-action="set-inline" data-id="${id}">Inline</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderReviewChecklist() {
  const root = qs("review-checklist");
  if (!root) return;
  const validation = validateEventWorkspace();
  const body = String(qs("article-body")?.value || "").trim();
  const metaDescription = String(qs("article-meta-description")?.value || "").trim();
  const metaDescriptionLength = [...metaDescription].length;
  const hasInlineMediaFromBlocks = (Array.isArray(workspaceState.bodyBlocks) ? workspaceState.bodyBlocks : []).some((block) => {
    const type = String(block?.type || "").trim().toLowerCase();
    if (type === "image") return Boolean(sanitizeUrl(block?.url || ""));
    if (type === "gallery") return Boolean(String(block?.text || "").trim());
    return false;
  });
  const hasInlineMediaFromBody = /<img\b/i.test(body);
  const hasInlineMedia = hasInlineMediaFromBlocks || hasInlineMediaFromBody;
  const hasVideo = /<(iframe|video)\b/i.test(body) || /youtu\.be|youtube\.com|vimeo\.com/i.test(body);
  const checks = [
    { label: "Title ready", pass: !validation.missing.includes("title") },
    { label: "Summary ready", pass: !validation.missing.includes("summary") },
    { label: "Hero image ready", pass: !validation.missing.includes("cover image") },
    { label: "Body ready", pass: !validation.missing.includes("body") },
    { label: "Inline media ready", pass: hasInlineMedia },
    { label: "Event period ready", pass: !validation.missing.includes("event period") },
    { label: "Location ready", pass: !validation.missing.includes("location") },
    { label: "Slug ready", pass: !validation.missing.includes("slug") },
    { label: "Meta title ready", pass: !validation.missing.includes("meta title") },
    { label: "Meta description ready", pass: !validation.missing.includes("meta description") },
    { label: "Meta description length recommended (50-180 chars)", pass: !metaDescription || (metaDescriptionLength >= 50 && metaDescriptionLength <= 180) },
    { label: "Video embed valid", pass: hasVideo || !String(qs("video-embed-url")?.value || "").trim() },
  ];
  root.innerHTML = checks.map((row) => `
    <label class="article-check-item">
      <input type="checkbox" disabled ${row.pass ? "checked" : ""} />
      <span>${escapeHtml(row.label)}</span>
    </label>
  `).join("");
}

function applyActionGuards() {
  const status = getArticleStatus();
  const editable = canEditArticle();
  const validation = validateEventWorkspace();

  const submitBtn = qs("btn-submit-review");
  if (submitBtn) submitBtn.disabled = state.busy || !editable || (!["drafting", "revision_requested"].includes(status)) || !validation.ok;

  const saveBtn = qs("btn-save-workspace");
  if (saveBtn) saveBtn.disabled = state.busy || !editable;
  const reviewSaveBtn = qs("btn-save-before-review");
  if (reviewSaveBtn) reviewSaveBtn.disabled = state.busy || !editable;
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
  const openEventsBtn = qs("btn-open-events");
  if (openEventsBtn) openEventsBtn.textContent = "\u0e01\u0e25\u0e31\u0e1a\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e23\u0e01";
  const openIntakeBtn = qs("btn-open-intake");
  if (openIntakeBtn) openIntakeBtn.textContent = "\u0e01\u0e25\u0e31\u0e1a\u0e15\u0e32\u0e23\u0e32\u0e07\u0e07\u0e32\u0e19\u0e40\u0e02\u0e35\u0e22\u0e19";
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
  const insertGallery = qs("btn-insert-gallery");
  if (insertGallery) insertGallery.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e41\u0e01\u0e25\u0e40\u0e25\u0e2d\u0e23\u0e35";
  const insertQuote = qs("btn-insert-quote");
  if (insertQuote) insertQuote.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e04\u0e33\u0e1e\u0e39\u0e14";
  const insertList = qs("btn-insert-list");
  if (insertList) insertList.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23";
  const videoInput = qs("video-embed-url");
  if (videoInput) videoInput.placeholder = "\u0e27\u0e32\u0e07\u0e25\u0e34\u0e07\u0e01\u0e4c YouTube/Vimeo \u0e41\u0e25\u0e49\u0e27\u0e01\u0e14\u0e41\u0e17\u0e23\u0e01\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d";
  const insertVideo = qs("btn-insert-video");
  if (insertVideo) insertVideo.textContent = "\u0e41\u0e17\u0e23\u0e01\u0e27\u0e34\u0e14\u0e35\u0e42\u0e2d";
  const previewDesktop = qs("btn-preview-desktop");
  if (previewDesktop) previewDesktop.textContent = "\u0e40\u0e14\u0e2a\u0e01\u0e4c\u0e17\u0e47\u0e2d\u0e1b";
  const previewMobile = qs("btn-preview-mobile");
  if (previewMobile) previewMobile.textContent = "\u0e21\u0e37\u0e2d\u0e16\u0e37\u0e2d";
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
  applyStaticEventCopy();
  renderProcessBar();
  renderAuthStatus();
  renderStatusChip();
  renderActivityLog();
  renderBlocks();
  renderHeroAndAssets();
  renderPreview();
  renderReviewChecklist();
  applyEditorWorkspaceView();
  applyActionGuards();
  renderWorkspaceSaveState();
}

async function refreshArticleProcess() {
  state.articleProcess = await api(`/api/items/${state.itemId}/article-process`);
}

async function refreshAssets() {
  state.assets = await api(`/api/assets?content_item_id=${state.itemId}`);
  ensureSelectedAssetId();
  renderHeroAndAssets();
  renderPreview();
  renderReviewChecklist();
  applyEditorWorkspaceView();
  applyActionGuards();
}

async function saveWorkspace() {
  setBusy(true);
  setWorkspaceBanner("Saving event...", "loading");
  try {
    const payload = collectEventWorkspacePayload();
    const result = await api(`/api/items/${state.itemId}/editor-work`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.item = result?.item || state.item;
    await refreshArticleProcess();
    setWorkspaceDirty(false);
    renderAll();
    setWorkspaceBanner("Event saved");
  } finally {
    setBusy(false);
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
    }),
    await refreshArticleProcess();
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

async function uploadAssets() {
  const input = qs("event-asset-upload");
  const files = Array.from(input?.files || []);
  if (!files.length) throw new Error("เลือกไฟล์ก่อนอัปโหลด");
  files.forEach(validateEventUploadFile);
  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("content_item_id", String(state.itemId));
    formData.append("role", "unused");
    await api("/api/assets/upload", {
      method: "POST",
      body: formData,
      headers: {},
    });
  }
  if (input) input.value = "";
  await refreshAssets();
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
    caption: String(asset.file_name || "").trim(),
    alt: String(asset.file_name || "image").trim(),
  });
  setInlineStatus("asset-status", "Image inserted");
}

function insertVideoEmbed() {
  const input = qs("video-embed-url");
  const url = normalizeEmbedUrl(input?.value || "");
  if (!url) throw new Error("Please provide a valid YouTube/Vimeo URL");
  addBlock("video", { url, caption: "Embedded video" });
  input.value = "";
}

function wire() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-events")?.addEventListener("click", () => {
    window.location.href = "/events.html";
  });
  qs("btn-open-intake")?.addEventListener("click", () => {
    window.location.href = eventFallbackUrl();
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
  qs("article-title")?.addEventListener("input", () => {
    setWorkspaceDirty(true);
    const slugNode = qs("article-slug");
    if (slugNode && !String(slugNode.value || "").trim()) {
      slugNode.value = slugify(qs("article-title")?.value || "") || `item-${Number(state.item?.id || 0) || "workspace"}`;
    }
    renderPreview();
    renderReviewChecklist();
  });
  ["article-excerpt", "article-slug", "article-meta-title", "article-meta-description", "event-period-text", "event-location-text", "event-map-url"].forEach((id) => {
    qs(id)?.addEventListener("input", () => {
      setWorkspaceDirty(true);
      renderPreview();
      renderReviewChecklist();
      renderStatusChip();
      applyActionGuards();
    });
  });
  qs("article-body")?.addEventListener("input", () => {
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
  qs("btn-upload-assets")?.addEventListener("click", async () => {
    try {
      setInlineStatus("asset-status", "กำลังอัปโหลด...", "loading");
      await uploadAssets();
      setInlineStatus("asset-status", "อัปโหลดแล้ว เลือก Cover หรือ Inline เพื่อใช้งาน");
    } catch (err) {
      setInlineStatus("asset-status", err.message, "error");
    }
  });
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
    if (!previewNode) return;
    const url = String(previewNode.dataset.previewUrl || "").trim();
    if (!url) return;
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
  qs("btn-submit-review")?.addEventListener("click", async () => {
    try {
      const validation = validateEventWorkspace();
      if (!validation.ok) throw new Error(`Missing: ${validation.missing.join(", ")}`);
      await saveWorkspace();
      await submitWorkspaceForReview("submitted from event workspace");
      window.location.href = eventReviewUrl();
      setInlineStatus("review-status", "Submitted for review");
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
    }
  });
}

async function init() {
  wire();
  if (currentRole() === "freelance") {
    window.location.replace(eventFallbackUrl());
    return;
  }
  try {
    if (!state.itemId) {
      const me = await api("/api/auth/me");
      state.user = me?.user || null;
      if (currentRole() === "editor") {
        const assignments = await loadEditorEventAssignments();
        renderEditorEventAssignmentPicker(assignments);
        setWorkspaceBanner("", "success");
        return;
      }
    }
    await loadWorkspace();
    if (!ensureEventItem()) return;
    if (!canEditArticle()) {
      window.location.replace(eventFallbackUrl());
      return;
    }
    renderAll({ syncFields: true });
  } catch (err) {
    const role = currentRole();
    const message = String(err?.message || "");
    const isForbidden = /forbidden|ไม่มีสิทธิ์/i.test(message);
    if (role === "freelance" || isForbidden) {
      window.location.replace(eventFallbackUrl());
      return;
    }
    const hardMessage = /backend authentication is required|authentication/i.test(message)
      ? "\u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e40\u0e1b\u0e34\u0e14\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e02\u0e35\u0e22\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e44\u0e14\u0e49 \u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a\u0e43\u0e2b\u0e21\u0e48"
      : String(message || "\u0e44\u0e21\u0e48\u0e2a\u0e32\u0e21\u0e32\u0e23\u0e16\u0e40\u0e1b\u0e34\u0e14\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e02\u0e35\u0e22\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21\u0e44\u0e14\u0e49");
    setWorkspaceBanner(hardMessage, "error", { hard: true });
  }
}

init();



