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
  pending: false,
  timer: 0,
};

const MODE_LABEL = { points: "ปักจุดเส้นทาง", stops: "ปักป้ายจอด" };
const SNAP_UNITS = 60;
const project = (p) => latLngToViewbox(p.lat, p.lng, state.bundle.bounds, state.bundle.viewbox);
const sameLatLng = (a, b) => Boolean(a && b) && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
const isClosed = () => state.points.length >= 3 && sameLatLng(state.points[0], state.points[state.points.length - 1]);

function drawDraft() {
  if (!state.viewer) return;
  state.viewer.setDraft({
    color: state.route?.color || "#ff6600",
    path: state.pending ? [] : (state.route?.resolved_path || []).map(project),
    points: state.points.map(project),
    stops: state.stops.map(project),
    pointOpacity: state.mode === "points" ? 1 : 0.3,
    stopOpacity: state.mode === "stops" ? 1 : 0.45,
  });
}

function renderSide() {
  const r = state.route;
  qs("route-title").textContent = r ? `สาย ${r.route_number} · ${r.route_name}` : "";
  const distance = r?.resolved_distance_km ? ` · ${Number(r.resolved_distance_km).toFixed(1)} กม.` : "";
  qs("route-meta").textContent = r
    ? `โหมด: ${MODE_LABEL[state.mode]} · routing: ${r.routing_status}${distance}${isClosed() ? " · เส้นทางวน" : ""}${state.pending ? " · กำลังรอคำนวณ..." : ""}`
    : "";
  qs("point-count").textContent = `จุดเส้นทาง ${state.points.length} จุด`;
  qs("stop-list").innerHTML = state.stops.length
    ? state.stops.map((s, i) => `<li>${i + 1}. ${escapeHtml(s.name)}</li>`).join("")
    : `<li class="muted">ยังไม่มีป้ายจอด</li>`;
  for (const mode of ["points", "stops"]) qs(`btn-mode-${mode}`).className = state.mode === mode ? "primary" : "utility-action";
  qs("share-link").value = window.location.href;
}

function refresh() {
  drawDraft();
  renderSide();
}

async function run(label, task) {
  setBanner("workspace-status", label);
  try {
    await task();
    setBanner("workspace-status", "");
  } catch (err) {
    setBanner("workspace-status", err.message || "ทำไม่สำเร็จ", true);
  }
  refresh();
}

async function loadRoute() {
  state.route = await api(`/api/v2/transport/routes/${state.routeId}`);
  state.points = state.route.control_points.map((p) => ({ lat: p.lat, lng: p.lng }));
  state.stops = state.route.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, stop_type: s.stop_type }));
}

const savePoints = () => api(`/api/v2/transport/routes/${state.routeId}/control-points`, { method: "PUT", body: JSON.stringify({ control_points: state.points }) });
const saveStops = () => api(`/api/v2/transport/routes/${state.routeId}/stops`, { method: "PUT", body: JSON.stringify({ stops: state.stops }) });

function scheduleResolve() {
  state.pending = true;
  refresh();
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    run("กำลังคำนวณเส้นทาง...", async () => {
      try {
        await savePoints();
        if (state.points.length >= 2) await api(`/api/v2/transport/routes/${state.routeId}/resolve`, { method: "POST" });
      } finally {
        state.pending = false;
        await loadRoute();
      }
    });
  }, 700);
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function insertIndexFor(at) {
  const pts = state.points.map(project);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const d = distToSegment([at.x, at.y], pts[i], pts[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best + 1;
}

function snapToPath(at) {
  const path = state.route?.resolved_path || [];
  let best = null;
  let bestDist = Infinity;
  for (const q of path) {
    const [x, y] = project(q);
    const d = Math.hypot(x - at.x, y - at.y);
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return best && bestDist <= SNAP_UNITS ? { lat: best.lat, lng: best.lng } : { lat: at.lat, lng: at.lng };
}

function addStopAt(at) {
  const where = snapToPath(at);
  const name = window.prompt("ชื่อป้ายจอด", `ป้าย ${state.stops.length + 1}`);
  if (name == null || !name.trim()) return;
  state.stops.push({ name: name.trim(), lat: where.lat, lng: where.lng, stop_type: "stop" });
  refresh();
  run("กำลังบันทึกป้ายจอด...", saveStops);
}

function onMapClick(at) {
  if (state.mode === "stops") return addStopAt(at);
  const point = { lat: at.lat, lng: at.lng };
  if (isClosed()) state.points.splice(state.points.length - 1, 0, point);
  else state.points.push(point);
  scheduleResolve();
}

function onLineClick(at) {
  if (state.mode === "stops") return addStopAt(at);
  if (state.points.length < 2) return onMapClick(at);
  state.points.splice(insertIndexFor(at), 0, { lat: at.lat, lng: at.lng });
  scheduleResolve();
}

function onPointClick(index) {
  if (state.mode !== "points") return;
  if (index === 0 && state.points.length >= 3 && !isClosed()) state.points.push({ ...state.points[0] });
  else state.points.splice(index, 1);
  scheduleResolve();
}

function onPointDragEnd(index, at) {
  if (state.mode !== "points") {
    refresh();
    return;
  }
  const closed = isClosed();
  const last = state.points.length - 1;
  state.points[index] = { lat: at.lat, lng: at.lng };
  if (closed && index === 0) state.points[last] = { ...state.points[0] };
  if (closed && index === last) state.points[0] = { ...state.points[last] };
  scheduleResolve();
}

function onStopClick(index) {
  const current = state.stops[index];
  const name = window.prompt("แก้ชื่อป้ายจอด (ลบข้อความทั้งหมดเพื่อลบป้าย)", current.name);
  if (name == null) return;
  if (!name.trim()) state.stops.splice(index, 1);
  else current.name = name.trim();
  refresh();
  run("กำลังบันทึกป้ายจอด...", saveStops);
}

function bindControls() {
  qs("btn-back-home").addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home").addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-routes").addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("btn-open-preview").addEventListener("click", () => { window.location.href = "/transport-v2-preview.html"; });
  for (const mode of ["points", "stops"]) {
    qs(`btn-mode-${mode}`).addEventListener("click", () => { state.mode = mode; refresh(); });
  }
  qs("btn-undo").addEventListener("click", () => {
    if (state.mode === "stops") {
      if (!state.stops.length) return;
      state.stops.pop();
      refresh();
      run("กำลังบันทึกป้ายจอด...", saveStops);
      return;
    }
    if (!state.points.length) return;
    state.points.pop();
    scheduleResolve();
  });
  qs("btn-clear").addEventListener("click", () => {
    if (!state.points.length || !window.confirm("ล้างจุดเส้นทางทั้งหมด?")) return;
    state.points = [];
    scheduleResolve();
  });
  qs("btn-fit").addEventListener("click", () => state.viewer?.fitAll());
  qs("btn-resolve").addEventListener("click", () => scheduleResolve());
  window.addEventListener("beforeunload", (e) => {
    if (!state.pending) return;
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
      onLineClick,
      onPointClick,
      onPointDragEnd,
      onStopClick,
      onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
    });
    refresh();
    const focus = (state.route.resolved_path.length >= 2 ? state.route.resolved_path : state.points).map(project);
    state.viewer.focusPoints(focus);
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
