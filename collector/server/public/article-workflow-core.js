export const ARTICLE_STEPS = [
  { key: "intake", label: "รับงาน" },
  { key: "drafting", label: "เตรียมเนื้อหา" },
  { key: "review", label: "ตรวจและอนุมัติ" },
];

export const state = {
  token: (
    (typeof sessionStorage !== "undefined" && sessionStorage.getItem("collector_token"))
    || (typeof localStorage !== "undefined" && localStorage.getItem("collector_token"))
    || ""
  ),
  user: null,
  itemId: Number(new URLSearchParams(window.location.search).get("id") || 0),
  item: null,
  articleProcess: null,
  fieldPack: null,
  assets: [],
  translations: [],
  readiness: null,
  selectedAssetId: 0,
  previewMode: "desktop",
  busy: false,
};

function mirrorCollectorTokenToLocalStorage() {
  if (typeof localStorage === "undefined") return;
  const token = String(state.token || "").trim();
  if (!token) return;
  localStorage.setItem("collector_token", token);
}

export function selectedWorkspaceAssets() {
  return (Array.isArray(state.assets) ? state.assets : []).filter((row) => {
    return Number(row?.selected_in_clean || 0) === 1 && String(row?.role || "").trim().toLowerCase() !== "unused";
  });
}

const OTHER_TRANSPORT_SUBTYPES = Object.freeze({
  taxi: "Taxi",
  rental: "Rental",
  shuttle: "Shuttle",
  other: "Other",
});

const PREVIEW_ALLOWED_TAGS = new Set([
  "p",
  "br",
  "h2",
  "h3",
  "blockquote",
  "ul",
  "ol",
  "li",
  "figure",
  "figcaption",
  "img",
  "iframe",
  "strong",
  "em",
  "b",
  "i",
  "a",
]);

export function workspaceUrl(itemId = state.itemId) {
  return `/article-workspace.html?id=${Number(itemId || 0) || 0}`;
}

export function reviewUrl(itemId = state.itemId) {
  return currentRole() === "editor"
    ? workspaceUrl(itemId)
    : `/article-submit.html?id=${Number(itemId || 0) || 0}`;
}

export function reviewPreviewUrl(itemId = state.itemId) {
  return `/article-preview.html?id=${Number(itemId || 0) || 0}`;
}

export function eventWorkspaceUrl(itemId = state.itemId) {
  return `/event-workspace.html?id=${Number(itemId || 0) || 0}`;
}

export function eventReviewUrl(itemId = state.itemId) {
  return currentRole() === "editor"
    ? eventWorkspaceUrl(itemId)
    : `/event-submit.html?id=${Number(itemId || 0) || 0}`;
}

export function eventReviewPreviewUrl(itemId = state.itemId) {
  return `/event-preview.html?id=${Number(itemId || 0) || 0}`;
}

export function intakeUrl(itemId = state.itemId) {
  const role = currentRole();
  const normalizedItemId = Number(itemId || 0) || 0;
  if (role === "editor") {
    return normalizedItemId > 0 ? `/editor-home.html?item_id=${normalizedItemId}` : "/editor-home.html";
  }
  if (role === "freelance") {
    return assignmentsUrl(normalizedItemId);
  }
  return `/article-intake.html?id=${Number(itemId || 0) || 0}`;
}

export function assignmentsUrl(itemId = 0, assignmentId = 0) {
  const params = new URLSearchParams();
  params.set("tab", "work");
  const normalizedItemId = Number(itemId || 0) || 0;
  const normalizedAssignmentId = Number(assignmentId || 0) || 0;
  if (normalizedItemId > 0) params.set("item_id", String(normalizedItemId));
  if (normalizedAssignmentId > 0) params.set("assignment_id", String(normalizedAssignmentId));
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function roleArticleFallbackUrl(itemId = state.itemId) {
  const role = currentRole();
  const normalizedItemId = Number(itemId || 0) || 0;
  if (role === "editor") {
    return normalizedItemId > 0 ? `/editor-home.html?item_id=${normalizedItemId}` : "/editor-home.html";
  }
  if (role === "freelance") {
    return assignmentsUrl(normalizedItemId);
  }
  return "/";
}

export function qs(id) {
  return document.getElementById(id);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
}

export function normalizeEmbedUrl(value) {
  const raw = sanitizeUrl(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname.startsWith("/embed/")) return `https://www.youtube.com${url.pathname}`;
      if (url.pathname.startsWith("/shorts/")) {
        const videoId = url.pathname.replace(/^\/shorts\//, "").split("/")[0] || "";
        return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
      }
      const videoId = url.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }
    if (host === "youtu.be") {
      const videoId = url.pathname.replace(/^\/+/, "").split("/")[0] || "";
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }
    if (host === "youtube-nocookie.com") {
      return url.pathname.startsWith("/embed/") ? `https://www.youtube-nocookie.com${url.pathname}` : "";
    }
    if (host === "vimeo.com") {
      const videoId = url.pathname.replace(/^\/+/, "").split("/")[0] || "";
      return videoId ? `https://player.vimeo.com/video/${videoId}` : "";
    }
    if (host === "player.vimeo.com") {
      return url.pathname.startsWith("/video/") ? `https://player.vimeo.com${url.pathname}` : "";
    }
    if (host === "tiktok.com" || host === "m.tiktok.com") {
      if (url.pathname.startsWith("/embed/v2/")) return `https://www.tiktok.com${url.pathname}`;
      const match = url.pathname.match(/\/@[^/]+\/video\/(\d+)/i);
      return match?.[1] ? `https://www.tiktok.com/embed/v2/${match[1]}` : "";
    }
    if (host === "facebook.com" || host === "m.facebook.com" || host === "web.facebook.com") {
      if (url.pathname.startsWith("/plugins/video.php")) {
        const href = url.searchParams.get("href");
        return href
          ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`
          : "";
      }
      const isVideoPath = url.pathname.startsWith("/watch")
        || url.pathname.startsWith("/reel/")
        || /\/videos\//i.test(url.pathname)
        || url.pathname.startsWith("/share/v/");
      if (isVideoPath) {
        const href = `${url.origin}${url.pathname}${url.search}`;
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`;
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function embedOrientation(value) {
  const raw = sanitizeUrl(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === "tiktok.com" || host === "m.tiktok.com") return "vertical";
    if ((host === "youtube.com" || host === "m.youtube.com") && path.startsWith("/shorts/")) return "vertical";
    if (host === "facebook.com" || host === "m.facebook.com" || host === "web.facebook.com") {
      if (path.startsWith("/reel/") || path.startsWith("/reels/")) return "vertical";
      if (path.startsWith("/plugins/video.php")) {
        const href = decodeURIComponent(url.searchParams.get("href") || "");
        if (/\/reel\//i.test(href)) return "vertical";
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function sanitizePreviewFragment(rawHtml) {
  const html = String(rawHtml || "").trim();
  if (!html || typeof DOMParser !== "function") return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  const unwrapNode = (node) => {
    const parent = node?.parentNode;
    if (!parent) return;
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node);
    }
    parent.removeChild(node);
  };

  const nodes = Array.from(body.querySelectorAll("*"));
  for (const node of nodes) {
    const tag = String(node.tagName || "").trim().toLowerCase();
    if (!PREVIEW_ALLOWED_TAGS.has(tag)) {
      unwrapNode(node);
      continue;
    }

    const rawSrc = String(node.getAttribute("src") || "").trim();
    const rawAlt = String(node.getAttribute("alt") || "").trim();
    const rawHref = String(node.getAttribute("href") || "").trim();
    const rawOrientation = String(node.getAttribute("data-orientation") || "").trim().toLowerCase();

    for (const attr of Array.from(node.attributes || [])) {
      node.removeAttribute(attr.name);
    }

    if (tag === "img") {
      const src = sanitizeUrl(rawSrc);
      if (!src) {
        node.remove();
        continue;
      }
      node.setAttribute("src", src);
      if (rawAlt) node.setAttribute("alt", rawAlt);
      continue;
    }

    if (tag === "iframe") {
      const src = normalizeEmbedUrl(rawSrc);
      if (!src) {
        node.remove();
        continue;
      }
      const orientation = rawOrientation || embedOrientation(rawSrc) || embedOrientation(src);
      node.setAttribute("src", src);
      node.setAttribute("loading", "lazy");
      node.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
      node.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      node.setAttribute("allowfullscreen", "");
      if (orientation === "vertical") node.setAttribute("data-orientation", "vertical");
      continue;
    }

    if (tag === "a") {
      const href = sanitizeUrl(rawHref);
      if (!href) {
        unwrapNode(node);
        continue;
      }
      node.setAttribute("href", href);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }

  return body.innerHTML.trim();
}

function decodeRoleFromJwtToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  const parts = raw.split(".");
  if (parts.length < 2) return "";
  try {
    const payloadRaw = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadRaw);
    return String(payload?.role || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export function currentRole() {
  const role = String(state.user?.role || "").trim().toLowerCase();
  if (role) return role;
  const token = String(
    state.token
    || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("collector_token") : "")
    || (typeof localStorage !== "undefined" ? localStorage.getItem("collector_token") : "")
    || ""
  ).trim();
  return decodeRoleFromJwtToken(token);
}

export function isOtherTransportItem(item = state.item) {
  return String(item?.type || "").trim().toLowerCase() === "other_transport";
}

export function otherTransportSubtypeLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  return OTHER_TRANSPORT_SUBTYPES[key] || OTHER_TRANSPORT_SUBTYPES.other;
}

export function currentOtherTransportMeta() {
  const itemMeta = state.item?.other_transport_meta;
  const source = itemMeta && typeof itemMeta === "object" ? itemMeta : {};
  return {
    subtype: String(source.subtype || state.item?.source_entity_id || "other").trim().toLowerCase() || "other",
    contact_name: String(source.contact_name || "").trim(),
    contact_details: String(source.contact_details || "").trim(),
    phone: String(source.phone || "").trim(),
    link_url: sanitizeUrl(String(source.link_url || "").trim()),
    thumbnail_mode: String(source.thumbnail_mode || "cover_asset").trim().toLowerCase() || "cover_asset",
  };
}

export function canApproveArticle() {
  const role = currentRole();
  return role === "owner" || role === "admin";
}

export function canSyncArticle() {
  const role = currentRole();
  return role === "owner" || role === "admin";
}

export function canManageTranslations() {
  const role = currentRole();
  return role === "owner" || role === "admin";
}

export function canEditArticle() {
  const role = currentRole();
  return role === "owner" || role === "admin" || role === "editor" || role === "user";
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export function normalizeWorkspaceSlug(rawValue, fallbackKey = "item") {
  const candidate = slugify(rawValue);
  if (candidate && candidate.length >= 3 && !/^\d+$/.test(candidate)) return candidate;
  return slugify(fallbackKey) || "item";
}

export function formatDateTime(value) {
  const iso = String(value || "").trim();
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

export function getArticleStatus() {
  return String(state.articleProcess?.status || "").trim().toLowerCase() || "drafting";
}

export function hasPublishableSourceReady() {
  return Boolean(state.articleProcess?.publishable_source_ready);
}

export function articleStatusLabel(status = getArticleStatus()) {
  if (status === "revision_requested") return "ต้องแก้ไข";
  if (status === "ready_for_review") return "รอตรวจและอนุมัติ";
  if (status === "ready_for_sync") return "พร้อมส่งตรวจ";
  if (status === "submitted_for_admin_review") return "ส่งเข้า Admin Review แล้ว";
  if (status === "synced_to_admin") return "เผยแพร่แล้ว";
  return hasPublishableSourceReady() ? "มีเนื้อหาพร้อมตรวจ" : "กำลังเตรียมเนื้อหา";
}

export function processIndex(status = getArticleStatus()) {
  if (status === "ready_for_review" || status === "ready_for_sync" || status === "submitted_for_admin_review" || status === "synced_to_admin") return 3;
  return 2;
}

export function latestDraft() {
  return state.articleProcess?.latest_draft || null;
}

export function currentAssignments() {
  return Array.isArray(state.articleProcess?.editorial_assignments) ? state.articleProcess.editorial_assignments : [];
}

export function primaryAssignment() {
  return state.articleProcess?.active_editorial_assignment || currentAssignments()[0] || null;
}

export function currentAssignmentState(assignment = primaryAssignment()) {
  return String(assignment?.state || "").trim().toLowerCase();
}

export function workflowTransitions() {
  return Array.isArray(state.articleProcess?.workflow_transitions) ? state.articleProcess.workflow_transitions : [];
}

export function selectedAsset() {
  const assetId = Number(state.selectedAssetId || 0);
  if (!assetId) return null;
  return (Array.isArray(state.assets) ? state.assets : []).find((row) => Number(row.id || 0) === assetId) || null;
}

export function isImageAsset(asset) {
  const mimeType = String(asset?.mime_type || "").trim().toLowerCase();
  const publicUrl = String(asset?.public_url || "").trim().toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(publicUrl);
}

export function ensureSelectedAssetId() {
  const current = selectedAsset();
  if (current) return;
  const assets = Array.isArray(state.assets) ? [...state.assets] : [];
  const firstImage = assets.find((row) => isImageAsset(row)) || assets[0] || null;
  state.selectedAssetId = Number(firstImage?.id || 0) || 0;
}

export function fillField(id, value) {
  const node = qs(id);
  if (node) node.value = String(value ?? "");
}

export function collectWorkspacePayload() {
  const draft = latestDraft();
  const item = state.item || {};
  const title = String(qs("article-title")?.value || draft?.draft_title || item.title || "").trim();
  const excerpt = String(qs("article-excerpt")?.value || draft?.excerpt || item.summary || "").trim();
  const slug = normalizeWorkspaceSlug(
    String(qs("article-slug")?.value || item.slug || title || "").trim(),
    `item-${Number(item?.id || 0) || "workspace"}`
  );
  const metaTitle = String(qs("article-meta-title")?.value || draft?.meta_title || item.meta_title || "").trim();
  const metaDescription = String(qs("article-meta-description")?.value || draft?.meta_description || item.meta_description || "").trim();
  const body = String(qs("article-body")?.value || draft?.body || item.description_clean || item.description_raw || "").trim();
  const currentOtherTransport = currentOtherTransportMeta();
  const otherTransportMeta = isOtherTransportItem(item)
    ? {
        subtype: String(qs("other-transport-type")?.value || currentOtherTransport.subtype || item.source_entity_id || "other").trim().toLowerCase() || "other",
        contact_name: String(qs("other-transport-contact-name")?.value || currentOtherTransport.contact_name || "").trim(),
        contact_details: String(qs("other-transport-contact-details")?.value || currentOtherTransport.contact_details || "").trim(),
        phone: String(qs("other-transport-phone")?.value || currentOtherTransport.phone || "").trim(),
        link_url: sanitizeUrl(String(qs("other-transport-link")?.value || currentOtherTransport.link_url || "").trim()),
        thumbnail_mode: "cover_asset",
      }
    : null;
  return {
    item: {
      title,
      summary: excerpt,
      slug,
      meta_title: metaTitle,
      meta_description: metaDescription,
      description_clean: body,
      description_raw: body,
      ...(otherTransportMeta ? { other_transport_meta: otherTransportMeta, source_entity_id: otherTransportMeta.subtype } : {}),
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

export function currentReviewNote() {
  return String(qs("review-note")?.value || "").trim();
}

export function validateWorkspace() {
  const payload = collectWorkspacePayload();
  const missing = [];
  if (!payload.item.title) missing.push("title");
  if (!payload.item.summary) missing.push("summary");
  if (!payload.item.slug) missing.push("slug");
  if (!payload.item.meta_title) missing.push("meta title");
  if (!payload.item.meta_description) missing.push("meta description");
  if (!payload.item.description_clean) missing.push("body");
  const hasCover = selectedWorkspaceAssets().some((row) => Number(row.is_cover || 0) === 1 || String(row.role || "") === "cover");
  if (!hasCover) missing.push("cover image");
  if (isOtherTransportItem()) {
    const meta = payload.item.other_transport_meta || {};
    if (!meta.subtype) missing.push("transport subtype");
    if (!meta.contact_name) missing.push("contact name");
    if (!meta.phone && !meta.link_url && !meta.contact_details) missing.push("contact channel");
  }
  return { ok: missing.length === 0, missing };
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : null;
}

export function setBanner(message, kind = "success") {
  const node = qs("workspace-status");
  if (!node) return;
  const text = String(message || "").trim();
  if (!text) {
    node.textContent = "";
    node.classList.add("hidden");
    node.classList.remove("is-loading", "is-success", "is-error");
    return;
  }
  node.textContent = text;
  node.classList.remove("hidden", "is-loading", "is-success", "is-error");
  if (kind === "loading") node.classList.add("is-loading");
  else if (kind === "error") node.classList.add("is-error");
  else node.classList.add("is-success");
}

export function setInlineStatus(id, message, kind = "success") {
  const node = qs(id);
  if (!node) return;
  const text = String(message || "").trim();
  node.textContent = text;
  node.className = text ? `status ${kind === "error" ? "error" : kind === "loading" ? "muted" : "ok"}` : "status";
}

export function renderProcessBar() {
  const root = qs("article-process-bar");
  if (!root) return;
  const status = getArticleStatus();
  const index = processIndex(status);
  root.innerHTML = ARTICLE_STEPS.map((step, stepIndex) => {
    const uiIndex = stepIndex + 1;
    const completed = uiIndex < index;
    const active = uiIndex === index;
    return `
      <div class="step${completed ? " completed" : ""}${active ? " active" : ""}">
        <div class="dot">${uiIndex}</div>
        <div class="label">${escapeHtml(step.label)}</div>
      </div>
    `;
  }).join("");
}

export function renderAuthStatus() {
  const authNode = qs("workspace-auth-status");
  if (!authNode) return;
  authNode.textContent = "";
}

export function renderStatusChip() {
  const chip = qs("article-status-chip");
  if (!chip) return;
  chip.textContent = articleStatusLabel();
  chip.className = `workflow-badge ${getArticleStatus() === "ready_for_sync" || getArticleStatus() === "submitted_for_admin_review" || getArticleStatus() === "synced_to_admin" ? "workflow-badge-sent" : "workflow-badge-cleaned"}`;
}

export function renderActivityLog() {
  const root = qs("article-activity-log");
  if (!root) return;
  const rows = [];
  const assignment = primaryAssignment();
  if (assignment?.internal_note) {
    rows.push({
      title: "โน้ตการมอบหมาย",
      note: String(assignment.internal_note || "").trim(),
      meta: `${assignment.assignee_display_name || assignment.assignee_email || "editor"} Â· ${formatDateTime(assignment.updated_at || assignment.created_at)}`,
    });
  }
  for (const transition of workflowTransitions()) {
    const fromState = String(transition?.from_state || "").trim() || "-";
    const toState = String(transition?.to_state || "").trim() || "-";
    const reason = String(transition?.reason_code || "").trim() || "workflow";
    rows.push({
      title: `${fromState} -> ${toState}`,
      note: String(transition?.note || "").trim() || "ไม่มีโน้ต",
      meta: `${transition?.actor_email || "-"} Â· ${reason} Â· ${formatDateTime(transition?.created_at)}`,
    });
  }
  if (!rows.length) {
    root.innerHTML = '<p class="muted">ยังไม่มี activity ล่าสุด</p>';
    return;
  }
  root.innerHTML = rows.slice(0, 10).map((row) => `
    <div class="article-activity-row">
      <strong>${escapeHtml(row.title)}</strong>
      <span>${escapeHtml(row.meta)}</span>
      <p>${escapeHtml(row.note)}</p>
    </div>
  `).join("");
}

export function bodyToPreviewHtml(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return '<p class="muted">ยังไม่มีเนื้อหาบทความ</p>';
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    const sanitized = sanitizePreviewFragment(raw);
    return sanitized || '<p class="muted">ยังไม่มีเนื้อหาที่แสดงตัวอย่างได้</p>';
  }
  return raw
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

let previewGalleryLightboxBound = false;
let previewGalleryItems = [];
let previewGalleryIndex = -1;

function previewGalleryLightboxElements() {
  return {
    shell: qs("preview-gallery-lightbox"),
    stage: qs("preview-gallery-lightbox-image"),
    counter: qs("preview-gallery-lightbox-counter"),
  };
}

function ensurePreviewGalleryLightbox() {
  if (!qs("preview-gallery-lightbox")) {
    const shell = document.createElement("div");
    shell.id = "preview-gallery-lightbox";
    shell.className = "preview-gallery-lightbox hidden";
    shell.innerHTML = `
      <button type="button" class="preview-gallery-lightbox-backdrop" data-preview-gallery-close="1" aria-label="Close gallery"></button>
      <div class="preview-gallery-lightbox-shell">
        <div class="preview-gallery-lightbox-toolbar">
          <span id="preview-gallery-lightbox-counter" class="preview-gallery-lightbox-counter"></span>
          <button type="button" class="preview-gallery-lightbox-close" data-preview-gallery-close="1">ปิด</button>
        </div>
        <div class="preview-gallery-lightbox-stage">
          <button type="button" class="preview-gallery-lightbox-nav is-prev" data-preview-gallery-nav="-1" aria-label="Previous image">‹</button>
          <figure class="preview-gallery-lightbox-figure">
            <img id="preview-gallery-lightbox-image" class="preview-gallery-lightbox-image" alt="" />
          </figure>
          <button type="button" class="preview-gallery-lightbox-nav is-next" data-preview-gallery-nav="1" aria-label="Next image">›</button>
        </div>
      </div>
    `;
    document.body.appendChild(shell);
  }

  if (previewGalleryLightboxBound) return;
  previewGalleryLightboxBound = true;

  document.addEventListener("click", (event) => {
    const openNode = event.target.closest(".preview-gallery-item");
    if (openNode) {
      const galleryNode = openNode.closest(".preview-gallery");
      const itemNodes = galleryNode ? Array.from(galleryNode.querySelectorAll(".preview-gallery-item")) : [];
      previewGalleryItems = itemNodes.map((node) => ({
        url: String(node.dataset.fullUrl || "").trim(),
        alt: String(node.dataset.alt || "").trim(),
      })).filter((row) => Boolean(row.url));
      previewGalleryIndex = Math.max(0, itemNodes.indexOf(openNode));
      renderPreviewGalleryLightboxState();
      return;
    }

    const closeNode = event.target.closest("[data-preview-gallery-close]");
    if (closeNode) {
      closePreviewGalleryLightbox();
      return;
    }

    const navNode = event.target.closest("[data-preview-gallery-nav]");
    if (navNode) {
      const delta = Number(navNode.dataset.previewGalleryNav || 0);
      if (!Number.isFinite(delta) || !previewGalleryItems.length) return;
      previewGalleryIndex = (previewGalleryIndex + delta + previewGalleryItems.length) % previewGalleryItems.length;
      renderPreviewGalleryLightboxState();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (previewGalleryIndex < 0 || !previewGalleryItems.length) return;
    if (event.key === "Escape") {
      closePreviewGalleryLightbox();
    } else if (event.key === "ArrowRight") {
      previewGalleryIndex = (previewGalleryIndex + 1) % previewGalleryItems.length;
      renderPreviewGalleryLightboxState();
    } else if (event.key === "ArrowLeft") {
      previewGalleryIndex = (previewGalleryIndex - 1 + previewGalleryItems.length) % previewGalleryItems.length;
      renderPreviewGalleryLightboxState();
    }
  });
}

function closePreviewGalleryLightbox() {
  previewGalleryIndex = -1;
  renderPreviewGalleryLightboxState();
}

function renderPreviewGalleryLightboxState() {
  const { shell, stage, counter } = previewGalleryLightboxElements();
  if (!shell || !stage || !counter) return;

  const active = previewGalleryIndex >= 0 && previewGalleryItems[previewGalleryIndex];
  shell.classList.toggle("hidden", !active);
  document.body.classList.toggle("preview-gallery-lightbox-open", Boolean(active));
  if (!active) {
    stage.removeAttribute("src");
    stage.setAttribute("alt", "");
    counter.textContent = "";
    return;
  }

  stage.src = active.url;
  stage.alt = active.alt || "Gallery image";
  counter.textContent = `${previewGalleryIndex + 1} / ${previewGalleryItems.length}`;
}

function resolvePreviewMediaAssets(rows = [], fallbackHero = "") {
  const assets = Array.isArray(rows) ? rows : [];
  const explicitCover = assets.find((row) => {
    const role = String(row?.role || "").trim().toLowerCase();
    return Number(row?.is_cover || 0) === 1 || role === "cover";
  });
  const galleryRows = assets.filter((row) => {
    const role = String(row?.role || "").trim().toLowerCase();
    return role === "gallery";
  });

  const explicitCoverUrl = sanitizeUrl(explicitCover?.public_url || "");
  const hero = explicitCoverUrl || sanitizeUrl(galleryRows[0]?.public_url || "") || sanitizeUrl(fallbackHero || "");
  const seen = new Set();
  const gallery = galleryRows
    .map((row) => sanitizeUrl(row?.public_url || ""))
    .filter(Boolean)
    .filter((url) => url !== hero)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });

  return { hero, gallery };
}

export function renderPreview() {
  const shell = qs("article-preview-shell");
  const root = qs("article-preview");
  if (!shell || !root) return;
  shell.classList.toggle("is-mobile", state.previewMode === "mobile");

  const title = String(qs("article-title")?.value || state.item?.title || "").trim() || "(untitled)";
  const excerpt = String(qs("article-excerpt")?.value || state.item?.summary || "").trim();
  const assets = selectedWorkspaceAssets();
  const previewMedia = resolvePreviewMediaAssets(assets, state.item?.image_url || "");
  const hero = previewMedia.hero;
  const galleryAssets = previewMedia.gallery;
  const body = bodyToPreviewHtml(qs("article-body")?.value || latestDraft()?.body || state.item?.description_clean || "");
  const otherTransportMeta = currentOtherTransportMeta();
  const contactRows = isOtherTransportItem()
    ? [
        { label: "ประเภท", value: otherTransportSubtypeLabel(otherTransportMeta.subtype) },
        { label: "ผู้ติดต่อ", value: otherTransportMeta.contact_name },
        { label: "เบอร์โทร", value: otherTransportMeta.phone },
        { label: "ลิงก์", value: otherTransportMeta.link_url },
        { label: "ช่องทางติดต่อ", value: otherTransportMeta.contact_details },
      ].filter((row) => Boolean(String(row.value || "").trim()))
    : [];

  root.innerHTML = `
    ${hero ? `<img class="preview-cover" src="${escapeHtml(hero)}" alt="preview hero" />` : ""}
    <h2 class="preview-title">${escapeHtml(title)}</h2>
    ${excerpt ? `<p class="preview-excerpt">${escapeHtml(excerpt)}</p>` : ""}
    ${contactRows.length ? `
      <div class="readiness-summary">
        ${contactRows.map((row) => `
          <div class="summary-row">
            <strong>${escapeHtml(row.label)}</strong>
            <span>${escapeHtml(row.value)}</span>
          </div>
        `).join("")}
      </div>
    ` : ""}
    <div class="preview-body">${body}</div>
    ${galleryAssets.length ? `
      <section class="preview-gallery-section">
        <h3 class="preview-gallery-title">ภาพเพิ่มเติม</h3>
        <div class="preview-gallery">
          ${galleryAssets.map((url, index) => `
            <button type="button" class="preview-gallery-item${index === 0 ? " is-featured" : ""}${index % 5 === 2 ? " is-tall" : ""}" data-full-url="${escapeHtml(url)}" data-alt="gallery image ${index + 1}">
              <span class="preview-gallery-item-frame">
                <img src="${escapeHtml(url)}" alt="gallery image ${index + 1}" />
              </span>
            </button>
          `).join("")}
        </div>
      </section>
    ` : ""}
  `;
  ensurePreviewGalleryLightbox();
}

export async function loadTranslations() {
  const rows = await api(`/api/translations?content_item_id=${state.itemId}`);
  state.translations = Array.isArray(rows) ? rows : [];
  return state.translations;
}

export async function loadWorkspace() {
  if (!state.itemId) throw new Error("Missing content item id");
  ensurePreviewGalleryLightbox();
  mirrorCollectorTokenToLocalStorage();
  const me = await api("/api/auth/me");
  state.user = me?.user || null;
  const [item, processPayload, fieldPackPayload, assets, translations] = await Promise.all([
    api(`/api/items/${state.itemId}`),
    api(`/api/items/${state.itemId}/article-process`),
    api(`/api/items/${state.itemId}/field-pack/current`),
    api(`/api/assets?content_item_id=${state.itemId}`),
    api(`/api/translations?content_item_id=${state.itemId}`),
  ]);
  state.item = item || null;
  state.articleProcess = processPayload || null;
  state.fieldPack = fieldPackPayload?.field_pack || null;
  state.assets = Array.isArray(assets) ? assets : [];
  ensureSelectedAssetId();
  state.translations = Array.isArray(translations) ? translations : [];
}






