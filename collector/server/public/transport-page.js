import { initAuthBox } from "./auth-box.js";
import { api } from "./transport-v2-common.js";

const READY_BASE_MAP_STATUSES = new Set(["ready", "active", "published", "reviewed"]);

function qs(id) {
  return document.getElementById(id);
}

function currentRole(user) {
  return String(user?.role || "").trim().toLowerCase();
}

function setText(id, text) {
  const el = qs(id);
  if (el) el.textContent = text;
}

async function loadStepStatus() {
  try {
    const [baseMaps, routes] = await Promise.all([
      api("/api/v2/transport/base-maps"),
      api("/api/v2/transport/routes"),
    ]);
    const maps = Array.isArray(baseMaps?.items) ? baseMaps.items : [];
    const bm = maps.find((m) => READY_BASE_MAP_STATUSES.has(String(m.status || ""))) || maps[0] || null;
    setText("step-base-map-status", bm ? `${bm.name || `#${bm.id}`} · ${bm.status || "draft"}` : "ยังไม่มี base map");
    setText("step-landmarks-status", bm ? `${Array.isArray(bm.labels) ? bm.labels.length : 0} จุด · หน้าแก้กำลังทำ` : "ต้องมี base map ก่อน");
    const list = Array.isArray(routes?.items) ? routes.items : [];
    const pending = list.filter((r) => r.routing_status !== "fresh").length;
    setText("step-routes-status", pending ? `${list.length} สาย · ยังไม่คำนวณ ${pending}` : `${list.length} สาย`);
    setText("step-publish-status", pending ? `มี ${pending} สายที่ยังไม่คำนวณ` : "พร้อมตรวจ");
  } catch {
    for (const id of ["step-base-map-status", "step-landmarks-status", "step-routes-status", "step-publish-status"]) {
      setText(id, "โหลดสถานะไม่ได้");
    }
  }
}

async function init() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-other-transport-manager")?.addEventListener("click", () => {
    window.location.href = "/other-transport.html";
  });

  const user = await initAuthBox({ allowRoles: ["owner", "admin", "user"] });
  if (!user) return;
  if (currentRole(user) === "owner") {
    qs("transport-steps")?.classList.remove("hidden");
    loadStepStatus();
  }
}

init();
