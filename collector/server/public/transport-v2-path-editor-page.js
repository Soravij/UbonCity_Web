import { api, escapeHtml, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer, latLngToViewbox } from "./transport-map-viewer.js";

const state = {
  routeId: Number(new URLSearchParams(window.location.search).get("id") || 0) || 0,
  route: null,
  bundle: null,
  viewer: null,
  step: 1,
  points: [],
  stops: [],
  warnings: [],
  bearingsUsed: true,
  dirty: false,
  pending: false,
  timer: 0,
  pseudoFull: false,
  wakeLock: null,
};

const STEP_HELP = {
  1: "ขั้น 1 ปักจุด: แตะแผนที่ = เพิ่มจุดตามลำดับ · แตะจุด = ลบ · แตะจุดแรก = วนกลับจุดเริ่ม · เสร็จแล้วกด \"คำนวณเส้นทาง\"",
  2: "ขั้น 2 ปรับเส้นทาง: ลากจุด = ย้าย · ลากเส้นสีส้ม = ดึงเส้นผ่านจุดใหม่ · แตะบนเส้น = แทรกจุด · แตะจุด = ลบ · ระบบคำนวณใหม่ให้อัตโนมัติ",
  3: "ขั้น 3 ปักป้าย: แตะแผนที่หรือเส้น = เพิ่มป้าย (เกาะเส้นทางอัตโนมัติ) · แตะป้าย = แก้ชื่อหรือลบ",
};
const STEP_LABELS = { 1: "1 · ปักจุด", 2: "2 · ปรับเส้นทาง", 3: "3 · ปักป้าย" };
const SNAP_UNITS = 60;
const project = (p) => latLngToViewbox(p.lat, p.lng, state.bundle.bounds, state.bundle.viewbox);
const sameLatLng = (a, b) => Boolean(a && b) && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
const isClosed = () => state.points.length >= 3 && sameLatLng(state.points[0], state.points[state.points.length - 1]);
const hasPath = () => !state.dirty && !state.pending && (state.route?.resolved_path || []).length >= 2 && state.route?.routing_status === "fresh";

function warnPointIndexes() {
  const idx = new Set();
  for (const w of state.warnings || []) {
    idx.add(w.from);
    idx.add(w.to);
  }
  return [...idx];
}

function drawDraft() {
  if (!state.viewer) return;
  const showPath = !state.dirty && !state.pending;
  state.viewer.setDraft({
    color: state.route?.color || "#ff6600",
    path: showPath ? (state.route?.resolved_path || []).map(project) : [],
    points: state.points.map(project),
    stops: state.stops.map(project),
    pointOpacity: state.step === 3 ? 0.3 : 1,
    stopOpacity: state.step === 3 ? 1 : 0.45,
    warnPoints: warnPointIndexes(),
  });
}

function stepActionButtons(s) {
  if (s === 1) return [qs("btn-undo-point"), qs("btn-clear"), qs("btn-compute")];
  if (s === 2) return [qs("btn-resolve")];
  if (s === 3) return [qs("btn-undo-stop")];
  return [];
}

function allStepActionButtons() {
  return [1, 2, 3].flatMap(stepActionButtons);
}

function renderStepList() {
  const list = qs("step-list");
  const pool = qs("step-actions-pool");
  for (const b of allStepActionButtons()) pool.append(b);
  const nodes = [];
  for (const s of [1, 2, 3]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = STEP_LABELS[s];
    btn.className = state.step === s ? "primary" : "utility-action";
    btn.disabled = s > 1 && state.step !== s && !hasPath();
    btn.addEventListener("click", () => setStep(s));
    Object.assign(btn.style, { width: "100%", textAlign: "left" });
    nodes.push(btn);
    if (s === state.step) {
      const box = document.createElement("div");
      Object.assign(box.style, { display: "flex", flexDirection: "column", gap: "4px",
        margin: "0 0 4px 12px", paddingLeft: "8px", borderLeft: "2px solid var(--line)" });
      for (const b of stepActionButtons(s)) {
        Object.assign(b.style, { width: "100%", textAlign: "left", fontSize: "0.88em", padding: "6px 10px" });
        box.append(b);
      }
      if (box.childElementCount) nodes.push(box);
    }
  }
  list.replaceChildren(...nodes);
}

function renderSide() {
  const r = state.route;
  qs("route-title").textContent = r ? `สาย ${r.route_number} · ${r.route_name}` : "";
  const distance = r?.resolved_distance_km ? ` · ${Number(r.resolved_distance_km).toFixed(1)} กม.` : "";
  qs("route-meta").textContent = r
    ? `routing: ${r.routing_status}${distance}${isClosed() ? " · เส้นทางวน" : ""}${state.dirty ? " · ยังไม่ได้คำนวณเส้นทาง" : ""}${state.pending ? " · กำลังคำนวณ..." : ""}`
    : "";
  qs("step-help").textContent = STEP_HELP[state.step];
  renderStepList();
  qs("point-count").textContent = `จุดเส้นทาง ${state.points.length} จุด`;
  qs("stop-list").innerHTML = state.stops.length
    ? state.stops.map((s, i) => `<li>${i + 1}. ${escapeHtml(s.name)}</li>`).join("")
    : `<li class="muted">ยังไม่มีป้ายจอด</li>`;
  qs("share-link").value = window.location.href;
  const helpEl = qs("step-help");
  if (isFull() && helpEl && !collapsed) {
    helpEl.style.display = "";
    clearTimeout(helpTimer);
    helpTimer = setTimeout(() => { if (isFull()) helpEl.style.display = "none"; }, 2000);
  }
}

function refresh() {
  drawDraft();
  renderSide();
  renderControls();
}

function stageStatus(text, isError = false) {
  const node = qs("stage-status");
  node.textContent = text || "";
  node.style.color = isError ? "#dc2626" : "";
}

function warningsText() {
  const lines = (state.warnings || []).map((w) =>
    `⚠ ช่วงจุด ${w.from + 1}→${w.to + 1} อ้อม ${w.ratio} เท่า (+${w.extra_m} ม.) — ตรวจว่าจุดอยู่ถูกฝั่งถนน`);
  if (state.bearingsUsed === false) lines.push("ⓘ คำนวณแบบไม่ใช้ทิศทาง (OSRM หาเส้นตามทิศไม่ได้)");
  return lines.join("\n");
}

function isFull() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement) || state.pseudoFull;
}

const LIGHT_VARS = {
  "--card": "#ffffff", "--line": "#cbd5e1", "--text": "#0f172a", "--muted": "#64748b",
  "--accent": "#3b82f6", "--accent-2": "#2563eb", "--theme-surface-soft": "#f8fafc",
};
const controls = qs("stage-controls");
const btnCollapse = qs("btn-collapse");
const compactEls = ["route-title", "route-meta", "step-help", "stage-status"]
  .map((id) => qs(id)).filter(Boolean);
let collapsed = false;
let helpTimer = null;

function routeLabel() {
  return (qs("route-title")?.textContent || "").trim();
}

function renderControls() {
  const full = isFull();
  btnCollapse.hidden = !full;
  btnCollapse.textContent = collapsed ? "☰ " + routeLabel() : "– " + routeLabel();
  const statusEl = qs("stage-status");
  const keepStatus = (state.warnings || []).length > 0;
  for (const el of controls.children) {
    if (el === btnCollapse || el.id === "step-actions-pool") continue;
    const exempt = el === statusEl && keepStatus;
    const hide = full && (collapsed || (compactEls.includes(el) && !exempt));
    el.style.display = hide ? "none" : "";
  }
  for (const el of compactEls) {
    const exempt = el === statusEl && keepStatus;
    if ((!controls.contains(el) || el.parentElement !== controls) && !exempt) el.style.display = full ? "none" : "";
  }
}

function applyCompact(full) {
  if (!full) collapsed = false;
  renderControls();
}

btnCollapse.addEventListener("click", () => { collapsed = !collapsed; renderControls(); });

let savedStyles = null;

function applyStageLayout() {
  const full = isFull();
  const stage = qs("path-editor-stage");
  const map = qs("path-editor-map");
  if (full) {
    if (!savedStyles) savedStyles = { stage: stage.style.cssText, map: map.style.cssText, controls: controls.style.cssText };
    Object.assign(stage.style, {
      position: state.pseudoFull ? "fixed" : "relative", inset: "0", width: "100vw", height: "100dvh",
      margin: "0", padding: "0", overflow: "hidden", display: "block", zIndex: state.pseudoFull ? "1000" : "",
    });
    stage.style.background = "var(--theme-bg-gradient)";
    Object.assign(map.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%", minHeight: "0", borderRadius: "0", margin: "0",
    });
    Object.assign(controls.style, {
      position: "absolute", top: "12px", left: "12px", zIndex: "10",
      maxHeight: "calc(100% - 24px)", overflow: "auto",
      boxShadow: "0 4px 16px rgba(15, 23, 42, 0.18)", color: "var(--text)",
    });
    for (const [k, v] of Object.entries(LIGHT_VARS)) controls.style.setProperty(k, v);
  } else if (savedStyles) {
    stage.style.cssText = savedStyles.stage;
    map.style.cssText = savedStyles.map;
    controls.style.cssText = savedStyles.controls;
    savedStyles = null;
  }
  qs("btn-fullscreen").textContent = full ? "ออกจากเต็มจอ" : "เต็มจอ";
  applyCompact(full);
}

function enterPseudo() {
  state.pseudoFull = true;
  applyStageLayout();
}

async function toggleFullscreen() {
  if (isFull()) {
    if (state.pseudoFull) state.pseudoFull = false;
    else await (document.exitFullscreen?.call(document) || document.webkitExitFullscreen?.call(document));
    try { await state.wakeLock?.release(); } catch { /* ignore */ }
    state.wakeLock = null;
  } else {
    const stage = qs("path-editor-stage");
    const canNative = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (!canNative || !req) {
      enterPseudo();
    } else {
      try {
        const p = req.call(stage);
        if (p && typeof p.catch === "function") p.catch(() => enterPseudo());
      } catch {
        enterPseudo();
      }
    }
    try { state.wakeLock = await navigator.wakeLock?.request("screen"); } catch { state.wakeLock = null; }
  }
  applyStageLayout();
}

async function run(label, task) {
  setBanner("workspace-status", label);
  stageStatus(label);
  try {
    await task();
    setBanner("workspace-status", "");
    stageStatus("");
  } catch (err) {
    setBanner("workspace-status", err.message || "ทำไม่สำเร็จ", true);
    stageStatus(err.message || "ทำไม่สำเร็จ", true);
  }
  refresh();
}

async function loadRoute() {
  state.route = await api(`/api/v2/transport/routes/${state.routeId}`);
  state.points = state.route.control_points.map((p) => ({ lat: p.lat, lng: p.lng }));
  state.stops = state.route.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, stop_type: s.stop_type }));
  state.dirty = false;
}

const savePoints = () => api(`/api/v2/transport/routes/${state.routeId}/control-points`, { method: "PUT", body: JSON.stringify({ control_points: state.points }) });
const saveStops = () => api(`/api/v2/transport/routes/${state.routeId}/stops`, { method: "PUT", body: JSON.stringify({ stops: state.stops }) });

async function resolveNow() {
  clearTimeout(state.timer);
  state.pending = true;
  refresh();
  let resolved = false;
  await run("กำลังคำนวณเส้นทาง...", async () => {
    try {
      await savePoints();
      if (state.points.length >= 2) {
        const result = await api(`/api/v2/transport/routes/${state.routeId}/resolve`, { method: "POST" });
        state.warnings = Array.isArray(result?.warnings) ? result.warnings : [];
        state.bearingsUsed = result?.bearings_used;
        resolved = true;
      }
    } finally {
      state.pending = false;
      await loadRoute();
    }
  });
  if (resolved && (state.warnings.length || state.bearingsUsed === false)) stageStatus(warningsText());
  refresh();
}

function scheduleResolve() {
  state.pending = true;
  refresh();
  clearTimeout(state.timer);
  state.timer = setTimeout(resolveNow, 700);
}

function pointsChanged() {
  if (state.step === 2) {
    scheduleResolve();
    return;
  }
  state.dirty = true;
  refresh();
}

function setStep(step) {
  if (step > 1 && !hasPath()) return;
  state.step = step;
  refresh();
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function nearestIndex(pathPts, p, from = 0) {
  let best = from;
  let bestDist = Infinity;
  for (let i = from; i < pathPts.length; i += 1) {
    const d = Math.hypot(pathPts[i][0] - p[0], pathPts[i][1] - p[1]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function insertIndexFor(at) {
  const path = hasPath() ? state.route.resolved_path.map(project) : [];
  if (path.length < 2) {
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
  const target = nearestIndex(path, [at.x, at.y]);
  let from = 0;
  for (let i = 0; i < state.points.length; i += 1) {
    const idx = nearestIndex(path, project(state.points[i]), from);
    if (idx > target) return Math.max(1, i);
    from = idx;
  }
  return isClosed() ? state.points.length - 1 : state.points.length;
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
  if (state.step === 3) return addStopAt(at);
  if (state.step !== 1) return;
  const point = { lat: at.lat, lng: at.lng };
  if (isClosed()) state.points.splice(state.points.length - 1, 0, point);
  else state.points.push(point);
  pointsChanged();
}

function onLineClick(at) {
  if (state.step === 3) return addStopAt(at);
  if (state.points.length < 2) return onMapClick(at);
  state.points.splice(insertIndexFor(at), 0, { lat: at.lat, lng: at.lng });
  pointsChanged();
}

function onLineDragEnd(from, to) {
  if (state.step !== 2) {
    refresh();
    return;
  }
  state.points.splice(insertIndexFor(from), 0, { lat: to.lat, lng: to.lng });
  pointsChanged();
}

function onPointClick(index) {
  if (state.step === 3) return;
  if (index === 0 && state.points.length >= 3 && !isClosed()) state.points.push({ ...state.points[0] });
  else state.points.splice(index, 1);
  pointsChanged();
}

function onPointDragEnd(index, at) {
  if (state.step === 3) {
    refresh();
    return;
  }
  const closed = isClosed();
  const last = state.points.length - 1;
  state.points[index] = { lat: at.lat, lng: at.lng };
  if (closed && index === 0) state.points[last] = { ...state.points[0] };
  if (closed && index === last) state.points[0] = { ...state.points[last] };
  pointsChanged();
}

function onStopClick(index) {
  if (state.step !== 3) return;
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
  qs("btn-fit").addEventListener("click", () => state.viewer?.fitAll());
  qs("btn-fullscreen").addEventListener("click", () => toggleFullscreen());
  document.addEventListener("fullscreenchange", applyStageLayout);
  document.addEventListener("webkitfullscreenchange", applyStageLayout);
  qs("btn-undo-point").addEventListener("click", () => {
    if (!state.points.length) return;
    state.points.pop();
    pointsChanged();
  });
  qs("btn-clear").addEventListener("click", () => {
    if (!state.points.length || !window.confirm("ล้างจุดเส้นทางทั้งหมด?")) return;
    state.points = [];
    state.warnings = [];
    pointsChanged();
  });
  qs("btn-compute").addEventListener("click", async () => {
    if (state.points.length < 2) {
      setBanner("workspace-status", "ต้องมีอย่างน้อย 2 จุด", true);
      return;
    }
    await resolveNow();
    if (hasPath()) setStep(2);
  });
  qs("btn-resolve").addEventListener("click", () => resolveNow());
  qs("btn-undo-stop").addEventListener("click", () => {
    if (!state.stops.length) return;
    state.stops.pop();
    refresh();
    run("กำลังบันทึกป้ายจอด...", saveStops);
  });
  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty && !state.pending) return;
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
      onLineDragEnd,
      onPointClick,
      onPointDragEnd,
      onStopClick,
      onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
    });
    state.step = hasPath() ? 2 : 1;
    refresh();
    const focus = (state.route.resolved_path.length >= 2 ? state.route.resolved_path : state.points).map(project);
    state.viewer.focusPoints(focus);
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
