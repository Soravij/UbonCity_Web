import { api, requireAdminShell, setBanner } from "./transport-v2-common.js";
import { mountPathEditor } from "./transport-v2-path-editor.js";

const state = {
  baseMaps: [],
  routeId: Number(new URLSearchParams(window.location.search).get("id") || 0) || 0,
};

async function loadBaseMaps() {
  const baseMaps = await api("/api/v2/transport/base-maps");
  state.baseMaps = Array.isArray(baseMaps?.items) ? baseMaps.items : [];
}

async function render() {
  await mountPathEditor({
    routeId: state.routeId,
    baseMaps: state.baseMaps,
  });
}

async function init() {
  try {
    await requireAdminShell("path-editor-status", "");
    await loadBaseMaps();
    await render();
  } catch (error) {
    setBanner("path-editor-status", error.message || "Failed to load path editor", true);
    return;
  }
  document.getElementById("btn-back-routes")?.addEventListener("click", () => {
    window.location.href = "/transport-v2-routes.html";
  });
}

init();
