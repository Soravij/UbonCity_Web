import {
  canApproveArticle,
  getArticleStatus,
  latestDraft,
  loadWorkspace,
  currentRole,
  qs,
  renderPreview,
  setBanner,
  state,
  eventWorkspaceUrl,
} from "./article-workflow-core.js";

function eventFallbackUrl() {
  const role = String(state.user?.role || "").trim().toLowerCase();
  const normalizedItemId = Number(state.itemId || 0) || 0;
  if (role === "editor") {
    return normalizedItemId > 0 ? `/editor-home.html?item_id=${normalizedItemId}` : "/editor-home.html";
  }
  if (role !== "freelance") return "/events-manager.html";
  if (role === "freelance") return "/?tab=work";
  return "/events-manager.html";
}

function ensureEventItem() {
  if (String(state.item?.type || "").trim().toLowerCase() === "event") return true;
  window.location.replace(eventFallbackUrl());
  return false;
}

function applyPreviewMode(mode) {
  state.previewMode = mode === "mobile" ? "mobile" : "desktop";
  qs("btn-preview-page-desktop")?.classList.toggle("active", state.previewMode === "desktop");
  qs("btn-preview-page-mobile")?.classList.toggle("active", state.previewMode === "mobile");
  renderPreview();
}

function renderPreviewHeader() {
  const title = String(latestDraft()?.draft_title || state.item?.title || "").trim() || "ไม่มีชื่อ Event";
  document.title = `Collector - Event Review Preview - ${title}`;
}

function wire() {
  qs("btn-preview-page-desktop")?.addEventListener("click", () => {
    applyPreviewMode("desktop");
  });
  qs("btn-preview-page-mobile")?.addEventListener("click", () => {
    applyPreviewMode("mobile");
  });
}

async function init() {
  wire();
  if (currentRole() === "editor") {
    window.location.replace(eventWorkspaceUrl(state.itemId));
    return;
  }
  try {
    await loadWorkspace();
    if (!ensureEventItem()) return;
    if (!canApproveArticle()) {
      window.location.replace(eventFallbackUrl());
      return;
    }
    renderPreviewHeader();
    applyPreviewMode(getArticleStatus() === "ready_for_review" ? "desktop" : state.previewMode);
  } catch (err) {
    const role = currentRole();
    if (role === "editor" || role === "freelance" || /forbidden|ไม่มีสิทธิ์/i.test(String(err?.message || ""))) {
      window.location.replace(eventFallbackUrl());
      return;
    }
    setBanner(String(err?.message || "ไม่สามารถเปิดหน้า preview ได้"), "error");
  }
}

init();

