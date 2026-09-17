import { api, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
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
  const user = await initAuthBox({
    allowRoles: ["owner", "admin", "user"],
    statusId: "path-editor-status",
    bannerId: "path-editor-status",
  });
  if (!user) {
    window.location.replace("/transport-v2-routes.html");
    return;
  }
  try {
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
