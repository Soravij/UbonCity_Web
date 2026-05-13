import {
  canApproveArticle,
  getArticleStatus,
  latestDraft,
  loadWorkspace,
  currentRole,
  qs,
  renderPreview,
  roleArticleFallbackUrl,
  setBanner,
  state,
  workspaceUrl,
} from "./article-workflow-core.js";

function applyPreviewMode(mode) {
  state.previewMode = mode === "mobile" ? "mobile" : "desktop";
  qs("btn-preview-page-desktop")?.classList.toggle("active", state.previewMode === "desktop");
  qs("btn-preview-page-mobile")?.classList.toggle("active", state.previewMode === "mobile");
  renderPreview();
}

function renderPreviewHeader() {
  const title = String(latestDraft()?.draft_title || state.item?.title || "").trim() || "ไม่มีชื่อบทความ";
  document.title = `Collector - Review Preview - ${title}`;
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
    window.location.replace(workspaceUrl(state.itemId));
    return;
  }
  try {
    await loadWorkspace();
    if (!canApproveArticle()) {
      window.location.replace(roleArticleFallbackUrl());
      return;
    }
    renderPreviewHeader();
    applyPreviewMode(getArticleStatus() === "ready_for_review" ? "desktop" : state.previewMode);
  } catch (err) {
    const role = currentRole();
    if (role === "editor" || role === "freelance" || /forbidden|ไม่มีสิทธิ์/i.test(String(err?.message || ""))) {
      window.location.replace(roleArticleFallbackUrl());
      return;
    }
    setBanner(String(err?.message || "ไม่สามารถเปิดหน้า preview ได้"), "error");
  }
}

init();
