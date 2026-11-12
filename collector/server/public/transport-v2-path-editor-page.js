import { api, escapeHtml, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer, latLngToViewbox } from "./transport-map-viewer.js";

const state = {
  routeId: Number(new URLSearchParams(window.location.search).get("id") || 0) || 0,
  route: null,
  bundle: null,
  viewer: null,
  mode: "points",
  points: [],
  stops: [],
  dirty: false,
};

const MODE_LABEL = { points: "ปักจุดเส้นทาง", stops: "ปักป้ายจอด" };
const project = (p) => latLngToViewbox(p.lat, p.lng, state.bundle.bounds, state.bundle.viewbox);

function drawDraft() {
  if (!state.viewer) return;
  state.viewer.setDraft({
    color: state.route?.color || "#ff6600",
    path: state.dirty ? [] : (state.route?.resolved_path || []).map(project),
    points: state.points.map(project),
    stops: state.stops.map(project),
  });
}

function renderSide() {
  const r = state.route;
  qs("route-title").textContent = r ? `สาย ${r.route_number} · ${r.route_name}` : "";
  const distance = r?.resolved_distance_km ? ` · ${Number(r.resolved_distance_km).toFixed(1)} กม.` : "";
  qs("route-meta").textContent = r
    ? `โหมด: ${MODE_LABEL[state.mode]} · routing: ${r.routing_status}${distance}${state.dirty ? " · มีการแก้ไขที่ยังไม่บันทึก" : ""}`
    : "";
  qs("point-count").textContent = `จุดเส้นทาง ${state.points.length} จุด`;
  qs("stop-list").innerHTML = state.stops.length
    ? state.stops.map((s, i) => `<li>${i + 1}. ${escapeHtml(s.name)}</li>`).join("")
    : `<li class="muted">ยังไม่มีป้ายจอด</li>`;
  for (const mode of ["points", "stops"]) qs(`btn-mode-${mode}`).setAttribute("aria-pressed", String(state.mode === mode));
  qs("share-link").value = window.location.href;
}

function changed() {
  state.dirty = true;
  drawDraft();
  renderSide();
}

function onMapClick(p) {
  if (state.mode === "points") {
    state.points.push({ lat: p.lat, lng: p.lng });
    changed();
    return;
  }
  const name = window.prompt("ชื่อป้ายจอด", `ป้าย ${state.stops.length + 1}`);
  if (name == null || !name.trim()) return;
  state.stops.push({ name: name.trim(), lat: p.lat, lng: p.lng, stop_type: "stop" });
  changed();
}

function onPointClick(index) {
  state.points.splice(index, 1);
  changed();
}

function onStopClick(index) {
  const current = state.stops[index];
  const name = window.prompt("แก้ชื่อป้ายจอด (ลบข้อความทั้งหมดเพื่อลบป้าย)", current.name);
  if (name == null) return;
  if (!name.trim()) state.stops.splice(index, 1);
  else current.name = name.trim();
  changed();
}

async function loadRoute() {
  state.route = await api(`/api/v2/transport/routes/${state.routeId}`);
  state.points = state.route.control_points.map((p) => ({ lat: p.lat, lng: p.lng }));
  state.stops = state.route.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, stop_type: s.stop_type }));
  state.dirty = false;
}

async function save() {
  await api(`/api/v2/transport/routes/${state.routeId}/control-points`, { method: "PUT", body: JSON.stringify({ control_points: state.points }) });
  await api(`/api/v2/transport/routes/${state.routeId}/stops`, { method: "PUT", body: JSON.stringify({ stops: state.stops }) });
}

async function run(label, task) {
  setBanner("workspace-status", label);
  try {
    await task();
    setBanner("workspace-status", "");
  } catch (err) {
    setBanner("workspace-status", err.message || "ทำไม่สำเร็จ", true);
  }
  drawDraft();
  renderSide();
}

function bindControls() {
  qs("btn-back-home").addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home").addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-routes").addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("btn-open-preview").addEventListener("click", () => { window.location.href = "/transport-v2-preview.html"; });
  for (const mode of ["points", "stops"]) {
    qs(`btn-mode-${mode}`).addEventListener("click", () => { state.mode = mode; renderSide(); });
  }
  qs("btn-undo").addEventListener("click", () => {
    const list = state.mode === "points" ? state.points : state.stops;
    if (!list.length) return;
    list.pop();
    changed();
  });
  qs("btn-clear").addEventListener("click", () => {
    if (!state.points.length || !window.confirm("ล้างจุดเส้นทางทั้งหมด?")) return;
    state.points = [];
    changed();
  });
  qs("btn-fit").addEventListener("click", () => state.viewer?.fitAll());
  qs("btn-save").addEventListener("click", () => run("กำลังบันทึก...", async () => {
    await save();
    await loadRoute();
  }));
  qs("btn-resolve").addEventListener("click", () => run("กำลังบันทึกและคำนวณเส้นทาง...", async () => {
    await save();
    await api(`/api/v2/transport/routes/${state.routeId}/resolve`, { method: "POST" });
    await loadRoute();
  }));
  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

async function init() {
  const user = await initAuthBox({ allowRoles: ["owner"] });
  if (!user) return;
  bindControls();
  if (!state.routeId) {
    setBanner("workspace-status", "ไม่ได้ระบุสาย (ต้องเปิดจากหน้า Routes หรือใส่ ?id=)", true);
    return;
  }
  try {
    await loadRoute();
    const preview = await api(`/api/v2/transport/base-maps/${state.route.base_map_id}/preview-bundle`);
    state.bundle = { ...preview.bundle, routes: [] };
    state.viewer = createTransportMapViewer(qs("path-editor-map"), {
      bundle: state.bundle,
      onMapClick,
      onPointClick,
      onStopClick,
      onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
    });
    drawDraft();
    renderSide();
    const focus = (state.route.resolved_path.length >= 2 ? state.route.resolved_path : state.points).map(project);
    state.viewer.focusPoints(focus);
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
