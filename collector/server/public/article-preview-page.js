import {
  getArticleStatus,
  latestDraft,
  loadWorkspace,
  qs,
  renderPreview,
  setBanner,
  state,
  workspaceUrl,
} from "./article-workflow-core.js";
import { initAuthBox } from "./auth-box.js";

function redirectForRole(role) {
  const id = Number(state.itemId || 0) || 0;
  if (role === "editor") return workspaceUrl(id);
  if (role === "freelance") return id > 0 ? `/?tab=work&item_id=${id}` : "/?tab=work";
  return "/";
}

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
  const user = await initAuthBox({
    allowRoles: ["owner", "admin"],
    redirectFor: redirectForRole,
    statusId: "workspace-auth-status",
    bannerId: "workspace-status",
  });
  if (!user) return;
  state.user = user;
  wire();
  try {
    await loadWorkspace();
    renderPreviewHeader();
    applyPreviewMode(getArticleStatus() === "ready_for_review" ? "desktop" : state.previewMode);
  } catch (err) {
    setBanner(String(err?.message || "ไม่สามารถเปิดหน้า preview ได้"), "error");
  }
}

init();
