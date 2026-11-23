import { api, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer } from "./transport-map-viewer.js";
import { createStage } from "./transport-v2-stage.js";

const READY_BASE_MAP_STATUSES = new Set(["ready", "active", "published", "reviewed"]);
const state = { viewer: null };
createStage({ stage: qs("basemap-stage"), collapseBtn: qs("btn-collapse"), fullscreenBtn: qs("btn-fullscreen"), title: () => "Base Map" });

function fmt(n) {
  return Number.isFinite(Number(n)) ? Number(n).toFixed(4) : "?";
}

function bind() {
  qs("btn-back-home")?.addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home")?.addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-routes")?.addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("btn-open-preview")?.addEventListener("click", () => { window.location.href = "/transport-v2-preview.html"; });
  qs("btn-next").addEventListener("click", () => { window.location.href = "/transport-v2-landmarks.html"; });
  qs("btn-fit").addEventListener("click", () => state.viewer?.fitAll());
}

async function init() {
  const user = await initAuthBox({ allowRoles: ["owner"] });
  if (!user) return;
  bind();
  try {
    const maps = (await api("/api/v2/transport/base-maps"))?.items || [];
    const bm = maps.find((m) => READY_BASE_MAP_STATUSES.has(String(m.status || ""))) || maps[0] || null;
    if (!bm) {
      setBanner("workspace-status", "ยังไม่มี base map — สร้างด้วยสคริปต์ generate/register", true);
      return;
    }
    const preview = await api(`/api/v2/transport/base-maps/${bm.id}/preview-bundle`);
    const b = preview?.bundle?.bounds || {};
    qs("bm-title").textContent = bm.title || `#${bm.id}`;
    qs("bm-status").textContent = bm.status || "draft";
    qs("bm-bounds").textContent = `S ${fmt(b.min_lat)} · W ${fmt(b.min_lng)} · N ${fmt(b.max_lat)} · E ${fmt(b.max_lng)}`;
    qs("bm-landmarks").textContent = `${Array.isArray(bm.labels) ? bm.labels.length : 0} จุด`;
    state.viewer = createTransportMapViewer(qs("basemap-map"), {
      bundle: { ...preview.bundle, routes: [] },
      onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
    });
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
