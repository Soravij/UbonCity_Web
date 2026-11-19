import { api, escapeHtml, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer, latLngToViewbox, viewboxToLatLng } from "./transport-map-viewer.js";
import { SNAP_ROAD_GROUPS, parsePathD, buildRoadIndex, nearestOnRoads } from "./transport-v2-road-snap.js";
import { normalizeLegPoints, legRange, nearestIndex, splitPathAtTurn, buildBackFromOut, activeStopIndexes } from "./transport-v2-legs-editor.js";
import { offsetPolylineLeft, arrowPositionsInRect, chevronPolylinePoints } from "./transport-v2-leg-decor.js";

const state = {
  routeId: Number(new URLSearchParams(window.location.search).get("id") || 0) || 0,
  route: null,
  bundle: null,
  viewer: null,
  step: 1,
  routeKind: "loop",
  leg: "out",
  points: [],
  stops: [],
  warnings: [],
  bearingsUsed: true,
  history: [],
  legCache: null,
  dirty: false,
  pending: false,
  timer: 0,
  pseudoFull: false,
  wakeLock: null,
};

const STEP_HELP = {
  1: "ขั้น 1 ปักจุด: แตะแผนที่ = เพิ่มจุดตามลำดับ · แตะจุด = ลบ · กด เลิกทำ เพื่อย้อน · แตะจุดแรก = วนกลับจุดเริ่ม · เสร็จแล้วกด \"คำนวณเส้นทาง\" · วางจุดกลางช่วงถนนตรง เลี่ยงมุมเลี้ยว/ทางแยก",
  2: "ขั้น 2 ปรับเส้นทาง: ลากจุด = ย้าย · ลากเส้นสีส้ม = ดึงเส้นผ่านจุดใหม่ · แตะบนเส้น = แทรกจุด · แตะจุด = ลบ · กด เลิกทำ เพื่อย้อน · ระบบคำนวณใหม่ให้อัตโนมัติ",
  3: "ขั้น 3 ปักป้าย: แตะแผนที่หรือเส้น = เพิ่มป้าย (เกาะเส้นทางอัตโนมัติ) · แตะป้าย = แก้ชื่อหรือลบ",
};
const STEP_LABELS = { 1: "1 · ปักจุด", 2: "2 · ปรับเส้นทาง", 3: "3 · ปักป้าย" };
const SNAP_UNITS = 60;
const SNAP_MAX_M = 12;
const SNAP_CELL_M = 50;
const SNAP_PX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 28 : 16;
let roadIndex = null;

function metersPerUnit() {
  const b = state.bundle.bounds;
  return ((b.max_lat - b.min_lat) * 111320) / state.bundle.viewbox.height;
}

function buildRoadSnap() {
  try {
    const outer = qs("path-editor-map").querySelector("svg");
    const base = outer?.querySelector("svg");
    if (!base) return;
    const full = state.bundle.viewbox;
    const vb = base.viewBox?.baseVal;
    const sx = vb && vb.width ? full.width / vb.width : 1;
    const sy = vb && vb.height ? full.height / vb.height : 1;
    const ox = vb ? vb.x : 0, oy = vb ? vb.y : 0;
    const lines = [];
    for (const id of SNAP_ROAD_GROUPS) {
      const g = base.querySelector(`[id="${id}"]`);
      if (!g) continue;
      for (const p of g.querySelectorAll("path")) {
        for (const line of parsePathD(p.getAttribute("d"))) {
          lines.push(line.map(([x, y]) => [full.x + (x - ox) * sx, full.y + (y - oy) * sy]));
        }
      }
    }
    roadIndex = buildRoadIndex(lines, SNAP_CELL_M / metersPerUnit());
    console.info(`[road-snap] segments=${roadIndex.segs.length}`);
  } catch (err) {
    roadIndex = null;
    console.warn("[road-snap] disabled", err);
  }
}

function snapToRoad(at) {
  const plain = { lat: at.lat, lng: at.lng };
  if (!roadIndex) return plain;
  const outer = qs("path-editor-map").querySelector("svg");
  const r = qs("path-editor-map").getBoundingClientRect();
  const v = outer?.viewBox?.baseVal;
  const upp = v && r.width > 0 && r.height > 0 ? Math.max(v.width / r.width, v.height / r.height) : 1;
  const maxDist = Math.min(SNAP_MAX_M / metersPerUnit(), SNAP_PX * upp);
  const hit = nearestOnRoads(roadIndex, at.x, at.y, maxDist);
  return hit ? viewboxToLatLng(hit.x, hit.y, state.bundle.bounds, state.bundle.viewbox) : plain;
}
const project = (p) => latLngToViewbox(p.lat, p.lng, state.bundle.bounds, state.bundle.viewbox);
const sameLatLng = (a, b) => Boolean(a && b) && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
const isOutBack = () => state.routeKind === "out_back";
const isClosed = () => !isOutBack() && state.points.length >= 3 && sameLatLng(state.points[0], state.points[state.points.length - 1]);
const range = () => legRange(state.points, state.routeKind, state.leg);
const withLeg = (p) => (isOutBack() ? { ...p, leg: state.leg } : p);
const activeStops = () => activeStopIndexes(state.stops, state.routeKind, state.leg);
function legPaths() {
  const path = (state.route?.resolved_path || []).map(project);
  if (!isOutBack()) return { active: path, ghost: [] };
  const outEnd = legRange(state.points, "out_back", "out").end;
  const { out, back } = splitPathAtTurn(path, outEnd > 0 ? project(state.points[outEnd - 1]) : null);
  return state.leg === "back" ? { active: back, ghost: out } : { active: out, ghost: back };
}
function updateLegCache() {
  if (!state.bundle || !isOutBack() || !hasPath()) return;
  const { active, ghost } = legPaths();
  state.legCache = state.leg === "back" ? { out: ghost, back: active } : { out: active, back: ghost };
}
const hasPath = () => !state.dirty && !state.pending && (state.route?.resolved_path || []).length >= 2 && state.route?.routing_status === "fresh";

function warnPointIndexes() {
  const idx = new Set();
  for (const w of state.warnings || []) {
    idx.add(w.from);
    idx.add(w.to);
  }
  return [...idx];
}

const SVG_NS = "http://www.w3.org/2000/svg";
const DECOR = {
  minBandPx: 3, maxBandPx: 8, bandK: 2, gapRatio: 0.25,
  bandOpacity: 0.85, chevronOpacity: 0.6, ghostMul: 0.35,
  chevronW: 0.7, chevronD: 0.35, chevronStroke: 0.18,
  maxChevronNodes: 1000,
};
let legDecorG = null;
let lastLegPaths = null;
let lastLegColor = null;

function viewerSvg() {
  return qs("path-editor-map").querySelector("svg");
}

function editorUnitsPerPx(svg) {
  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const rect = svg.getBoundingClientRect();
  if (vb.length !== 4 || !(rect.width > 0) || !(rect.height > 0)) return 0;
  return Math.max(vb[2] / rect.width, vb[3] / rect.height);
}

function ensureLegDecor() {
  const svg = viewerSvg();
  if (!svg) return null;
  if (!legDecorG) {
    legDecorG = document.createElementNS(SVG_NS, "g");
    legDecorG.setAttribute("data-leg-decor", "1");
    legDecorG.setAttribute("pointer-events", "none");
  }
  const draftLine = svg.querySelector('[data-draft-line="1"]');
  const draftG = draftLine ? draftLine.parentNode : null;
  if (draftG && draftG.parentNode) {
    if (legDecorG.nextSibling !== draftG) draftG.parentNode.insertBefore(legDecorG, draftG);
  } else if (!legDecorG.isConnected) {
    svg.appendChild(legDecorG);
  }
  return svg;
}

function viewRect(svg) {
  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !vb.every(Number.isFinite)) return null;
  return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
}

function visibleRect(svg, upp) {
  const r = viewRect(svg);
  const b = svg.getBoundingClientRect();
  if (!r || !(b.width > 0) || !(b.height > 0)) return r;
  const w = b.width * upp, h = b.height * upp;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

function bandPx(rect) {
  const fullH = state.bundle?.viewbox?.height;
  const zoom = rect && fullH > 0 && rect.h > 0 ? fullH / rect.h : 1;
  return Math.min(DECOR.maxBandPx, Math.max(DECOR.minBandPx, DECOR.bandK * Math.sqrt(Math.max(1, zoom))));
}

let draftGRef = null;
function hideViewerDraftLines(svg) {
  const hit = svg.querySelector('[data-draft-line="1"]');
  const g = hit ? hit.parentNode : draftGRef;
  if (!g) return;
  draftGRef = g;
  for (const el of g.querySelectorAll("polyline:not([data-draft-line])")) el.setAttribute("stroke-opacity", "0");
}

function addBand(pts, color, upp, rect, bp, outBack, mul) {
  if (!Array.isArray(pts) || pts.length < 2) return;
  const bandU = bp * upp;
  const gapU = Math.max(1, bp * DECOR.gapRatio) * upp;
  const center = offsetPolylineLeft(pts, outBack ? bandU / 2 + gapU / 2 : 0);
  const band = document.createElementNS(SVG_NS, "polyline");
  band.setAttribute("points", center.map((p) => `${p[0]},${p[1]}`).join(" "));
  band.setAttribute("fill", "none");
  band.setAttribute("stroke", color);
  band.setAttribute("stroke-width", String(bandU));
  band.setAttribute("stroke-linejoin", "round");
  band.setAttribute("stroke-linecap", "butt");
  band.setAttribute("opacity", String(DECOR.bandOpacity * mul));
  legDecorG.appendChild(band);
  const pad = bandU;
  const cullRect = { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad };
  for (const a of arrowPositionsInRect(center, bandU, cullRect, DECOR.maxChevronNodes)) {
    const ch = document.createElementNS(SVG_NS, "polyline");
    ch.setAttribute("points", chevronPolylinePoints(a.x, a.y, a.angleDeg, bandU * DECOR.chevronW, bandU * DECOR.chevronD));
    ch.setAttribute("fill", "none");
    ch.setAttribute("stroke", "#fff");
    ch.setAttribute("stroke-width", String(bandU * DECOR.chevronStroke));
    ch.setAttribute("stroke-linecap", "round");
    ch.setAttribute("stroke-linejoin", "round");
    ch.setAttribute("opacity", String(DECOR.chevronOpacity * mul));
    legDecorG.appendChild(ch);
  }
}

function drawLegDecor(lp, color) {
  lastLegPaths = lp;
  lastLegColor = color;
  const svg = ensureLegDecor();
  if (!svg) return;
  if ((lp?.active || []).length >= 2 || (lp?.ghost || []).length) hideViewerDraftLines(svg);
  legDecorG.replaceChildren();
  if (!lp) return;
  const upp = editorUnitsPerPx(svg);
  const rect = viewRect(svg);
  if (!(upp > 0) || !rect) return;
  const bp = bandPx(rect);
  const cull = visibleRect(svg, upp);
  const outBack = state.route?.route_kind === "out_back";
  const ghost = lp.ghost || [];
  const ghostPaths = Array.isArray(ghost[0]?.[0]) ? ghost : (ghost.length ? [ghost] : []);
  for (const g of ghostPaths) addBand(g, color, upp, cull, bp, outBack, DECOR.ghostMul);
  addBand(lp.active, color, upp, cull, bp, outBack, 1);
}

function drawDraft() {
  if (!state.viewer) return;
  const showPath = !state.dirty && !state.pending;
  const { start, end } = range();
  const all = state.points.map(project);
  const lp = showPath ? legPaths() : { active: [], ghost: (isOutBack() && state.legCache?.[state.leg === "back" ? "out" : "back"]) || [] };
  const stopIdx = activeStops();
  const stopSet = new Set(stopIdx);
  state.viewer.setDraft({
    color: state.route?.color || "#ff6600",
    path: lp.active,
    points: all.slice(start, end),
    stops: stopIdx.map((i) => project(state.stops[i])),
    ghostPath: lp.ghost,
    ghostPoints: [...all.slice(0, start), ...all.slice(end)],
    ghostStops: state.stops.filter((_, i) => !stopSet.has(i)).map(project),
    pointOpacity: state.step === 3 ? 0.3 : 1,
    stopOpacity: state.step === 3 ? 1 : 0.45,
    warnPoints: warnPointIndexes().filter((i) => i >= start && i < end).map((i) => i - start),
  });
  drawLegDecor(lp, state.route?.color || "#ff6600");
}

const HISTORY_MAX = 50;
function pushHistory() {
  state.history.push(JSON.stringify(state.points));
  if (state.history.length > HISTORY_MAX) state.history.shift();
}
function undo() {
  const s = state.history.pop();
  if (!s) return;
  state.points = JSON.parse(s);
  pointsChanged();
}

function stepActionButtons(s) {
  if (s === 1) return [qs("tip-placement"), qs("btn-undo-point"), qs("btn-clear"), qs("btn-compute")];
  if (s === 2) return [qs("btn-undo-point"), qs("btn-resolve")];
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
  const undoBtn = qs("btn-undo-point");
  undoBtn.textContent = "เลิกทำ";
  undoBtn.disabled = state.history.length === 0;
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
        if (b.tagName === "BUTTON") Object.assign(b.style, { width: "100%", textAlign: "left", fontSize: "0.88em", padding: "6px 10px" });
        box.append(b);
      }
      if (box.childElementCount) nodes.push(box);
    }
  }
  list.replaceChildren(...nodes);
}

function renderKind() {
  const ob = isOutBack();
  qs("btn-kind-loop").className = ob ? "utility-action" : "primary";
  qs("btn-kind-outback").className = ob ? "primary" : "utility-action";
  qs("leg-switch").style.display = ob ? "flex" : "none";
  qs("btn-leg-out").className = state.leg === "out" ? "primary" : "utility-action";
  qs("btn-leg-back").className = state.leg === "back" ? "primary" : "utility-action";
  qs("btn-build-back").style.display = ob && state.step !== 3 ? "" : "none";
  for (const id of ["btn-kind-loop", "btn-kind-outback", "btn-build-back"]) qs(id).disabled = state.pending;
}

function renderSide() {
  renderKind();
  const r = state.route;
  qs("route-title").textContent = r ? `สาย ${r.route_number} · ${r.route_name}` : "";
  const distance = r?.resolved_distance_km ? ` · ${Number(r.resolved_distance_km).toFixed(1)} กม.` : "";
  qs("route-meta").textContent = r
    ? `routing: ${r.routing_status}${distance}${isClosed() ? " · เส้นทางวน" : ""}${isOutBack() ? " · ไป-กลับ" : ""}${state.dirty ? " · ยังไม่ได้คำนวณเส้นทาง" : ""}${state.pending ? " · กำลังคำนวณ..." : ""}`
    : "";
  qs("step-help").textContent = STEP_HELP[state.step];
  renderStepList();
  qs("point-count").textContent = `จุดเส้นทาง ${state.points.length} จุด`;
  qs("stop-list").innerHTML = state.stops.length
    ? state.stops.map((s, i) => `<li>${i + 1}. ${escapeHtml(s.name)}${s.leg === "back" ? " (ขากลับ)" : s.leg === "out" ? " (ขาไป)" : ""}</li>`).join("")
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

function renderWarningsStatus() {
  const node = qs("stage-status");
  node.replaceChildren();
  node.style.color = "";
  for (const w of state.warnings || []) {
    const row = document.createElement("div");
    row.textContent = `⚠ จุด ${w.from + 1}→${w.to + 1} อ้อม ${w.ratio}× (+${w.extra_m} ม.)`;
    node.append(row);
  }
  if ((state.warnings || []).length) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.textContent = "ตรวจว่าจุดอยู่บนถนนเส้นที่ถูก แล้วลากแก้";
    node.append(hint);
  }
  if (state.bearingsUsed === false) {
    const info = document.createElement("div");
    info.className = "muted";
    info.textContent = "ⓘ คำนวณแบบไม่ใช้ทิศทาง";
    node.append(info);
  }
}

let warnIdx = -1;
function renderWarnBanner() {
  const b = qs("warn-banner");
  const n = state.warnings.length;
  b.hidden = n === 0;
  if (n) b.textContent = `⚠ พบ ${n} ช่วงที่เส้นอ้อม · แตะเพื่อดู`;
  else warnIdx = -1;
}
qs("warn-banner").addEventListener("click", () => {
  const n = state.warnings.length;
  if (!n) return;
  warnIdx = (warnIdx + 1) % n;
  const w = state.warnings[warnIdx];
  state.viewer?.focusPoints([project(state.points[w.from]), project(state.points[w.to])]);
});

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
let clearArmed = null;
const btnClear = qs("btn-clear");

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

let historyRouteId = null;
async function loadRoute() {
  state.route = await api(`/api/v2/transport/routes/${state.routeId}`);
  state.points = state.route.control_points.map((p) => ({ lat: p.lat, lng: p.lng, ...(p.leg ? { leg: p.leg } : {}), ...(p.label ? { label: p.label } : {}), ...(p.note ? { note: p.note } : {}) }));
  const kind = state.route.route_kind || "loop";
  state.stops = state.route.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, stop_type: s.stop_type, ...(kind === "out_back" && s.leg ? { leg: s.leg } : {}), ...(s.note ? { note: s.note } : {}) }));
  state.routeKind = state.route.route_kind || "loop";
  state.points = normalizeLegPoints(state.points, state.routeKind);
  if (!isOutBack()) state.leg = "out";
  state.dirty = false;
  if (historyRouteId !== state.routeId) {
    state.history = [];
    historyRouteId = state.routeId;
  }
  updateLegCache();
}

const savePoints = () => api(`/api/v2/transport/routes/${state.routeId}/control-points`, { method: "PUT", body: JSON.stringify({ control_points: state.points }) });
const saveStops = () => api(`/api/v2/transport/routes/${state.routeId}/stops`, { method: "PUT", body: JSON.stringify({ stops: state.stops }) });

let resolveSeq = 0;

async function resolveNow() {
  clearTimeout(state.timer);
  state.pending = true;
  refresh();
  const seq = ++resolveSeq;
  let resolved = false;
  await run("กำลังคำนวณเส้นทาง...", async () => {
    try {
      await savePoints();
      if (state.points.length >= 2) {
        const result = await api(`/api/v2/transport/routes/${state.routeId}/resolve`, { method: "POST" });
        if (seq === resolveSeq) {
          state.warnings = Array.isArray(result?.warnings) ? result.warnings : [];
          state.bearingsUsed = result?.bearings_used;
          resolved = true;
        }
      }
    } catch (err) {
      state.warnings = [];
      throw err;
    } finally {
      if (seq === resolveSeq) {
        state.pending = false;
        await loadRoute();
      }
    }
  });
  if (seq === resolveSeq && resolved && (state.warnings.length || state.bearingsUsed === false)) { renderWarningsStatus(); renderWarnBanner(); }
  refresh();
}

function scheduleResolve() {
  state.pending = true;
  refresh();
  clearTimeout(state.timer);
  state.timer = setTimeout(resolveNow, 700);
}

function pointsChanged() {
  state.warnings = [];
  renderWarningsStatus();
  renderWarnBanner();
  if (state.step === 2) {
    scheduleResolve();
    return;
  }
  state.dirty = true;
  refresh();
}

function setStep(step) {
  if (step > 1 && !hasPath()) return;
  if (clearArmed) { clearTimeout(clearArmed); clearArmed = null; btnClear.textContent = "ล้างจุดทั้งหมด"; }
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

function insertIndexFor(at) {
  const { start, end } = range();
  const pts = state.points.slice(start, end).map(project);
  const path = hasPath() ? legPaths().active : [];
  if (path.length < 2) {
    if (pts.length < 2) return end;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const d = distToSegment([at.x, at.y], pts[i], pts[i + 1]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return start + best + 1;
  }
  const target = nearestIndex(path, [at.x, at.y]);
  const minLocal = isOutBack() && state.leg === "back" ? 0 : 1;
  let from = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const idx = nearestIndex(path, pts[i], from);
    if (idx > target) return start + Math.max(minLocal, i);
    from = idx;
  }
  return isClosed() ? state.points.length - 1 : end;
}

function snapToPath(at) {
  let best = null;
  let bestDist = Infinity;
  for (const q of legPaths().active) {
    const d = Math.hypot(q[0] - at.x, q[1] - at.y);
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return best && bestDist <= SNAP_UNITS ? viewboxToLatLng(best[0], best[1], state.bundle.bounds, state.bundle.viewbox) : { lat: at.lat, lng: at.lng };
}

function addStopAt(at) {
  const where = snapToPath(at);
  const name = window.prompt("ชื่อป้ายจอด", `ป้าย ${state.stops.length + 1}`);
  if (name == null || !name.trim()) return;
  state.stops.push({ name: name.trim(), lat: where.lat, lng: where.lng, stop_type: "stop", ...(isOutBack() ? { leg: state.leg } : {}) });
  refresh();
  run("กำลังบันทึกป้ายจอด...", saveStops);
}

function onMapClick(at) {
  if (state.step === 3) return addStopAt(at);
  if (state.step !== 1) return;
  pushHistory();
  const point = withLeg(snapToRoad(at));
  if (isClosed()) state.points.splice(state.points.length - 1, 0, point);
  else state.points.splice(range().end, 0, point);
  pointsChanged();
}

function onLineClick(at) {
  if (state.step === 3) return addStopAt(at);
  if (state.points.length < 2) return onMapClick(at);
  pushHistory();
  state.points.splice(insertIndexFor(at), 0, withLeg(snapToRoad(at)));
  pointsChanged();
}

function onLineDragEnd(from, to) {
  if (state.step !== 2) {
    refresh();
    return;
  }
  pushHistory();
  state.points.splice(insertIndexFor(from), 0, withLeg(snapToRoad(to)));
  pointsChanged();
}

function onPointTap(localIndex) {
  const index = range().start + localIndex;
  if (state.step === 1 && !isOutBack() && index === 0 && state.points.length >= 3 && !isClosed()) {
    pushHistory();
    state.points.push({ ...state.points[0] });
    pointsChanged();
    return;
  }
  if (state.step === 3) return;
  pushHistory();
  state.points.splice(index, 1);
  pointsChanged();
}

function onPointDragEnd(localIndex, at) {
  if (state.step === 3) {
    refresh();
    return;
  }
  const index = range().start + localIndex;
  pushHistory();
  const closed = isClosed();
  const last = state.points.length - 1;
  state.points[index] = { ...state.points[index], ...snapToRoad(at) };
  if (closed && index === 0) state.points[last] = { ...state.points[0] };
  if (closed && index === last) state.points[0] = { ...state.points[last] };
  pointsChanged();
}

function onStopClick(localIndex) {
  if (state.step !== 3) return;
  const index = activeStops()[localIndex];
  if (index == null) return;
  const current = state.stops[index];
  const name = window.prompt("แก้ชื่อป้ายจอด (ลบข้อความทั้งหมดเพื่อลบป้าย)", current.name);
  if (name == null) return;
  if (!name.trim()) state.stops.splice(index, 1);
  else current.name = name.trim();
  refresh();
  run("กำลังบันทึกป้ายจอด...", saveStops);
}

async function setKind(kind) {
  const next = kind === "out_back" ? "out_back" : "loop";
  if (next === state.routeKind || state.pending) return;
  state.pending = true;
  refresh();
  try {
    await run("กำลังเปลี่ยนรูปแบบสาย...", async () => {
      await api(`/api/v2/transport/routes/${state.routeId}`, { method: "PUT", body: JSON.stringify({ route_kind: next }) });
      let pts = state.points.map(({ leg, ...p }) => p);
      if (next === "out_back") {
        if (isClosed()) pts = pts.slice(0, -1);
        pts = pts.map((p) => ({ ...p, leg: "out" }));
      }
      state.stops = next === "loop" ? state.stops.map(({ leg, ...s }) => s) : state.stops;
      state.routeKind = next;
      state.route.route_kind = next;
      state.points = pts;
      state.leg = "out";
      state.history = [];
      state.legCache = null;
      state.warnings = [];
      renderWarningsStatus();
      renderWarnBanner();
      await saveStops();
    });
  } finally {
    state.pending = false;
  }
  if (state.routeKind !== next) return;
  if (state.points.length >= 2) await resolveNow();
  else await run("กำลังบันทึกจุด...", savePoints);
}

function setLeg(leg) {
  if (!isOutBack() || state.leg === leg) return;
  state.leg = leg;
  refresh();
}

function buildBackLeg() {
  if (!isOutBack()) return;
  const back = buildBackFromOut(state.points);
  if (!back.length) {
    setBanner("workspace-status", "ขาไปต้องมีอย่างน้อย 2 จุด", true);
    return;
  }
  const { start } = legRange(state.points, "out_back", "back");
  if (start < state.points.length && !window.confirm("แทนที่ขากลับเดิมทั้งหมด?")) return;
  pushHistory();
  state.points = [...state.points.slice(0, start), ...back];
  state.leg = "back";
  pointsChanged();
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
  qs("btn-undo-point").addEventListener("click", () => undo());
  btnClear.addEventListener("click", () => {
    if (!clearArmed) {
      btnClear.textContent = "กดอีกครั้งเพื่อล้าง";
      clearArmed = setTimeout(() => { clearArmed = null; btnClear.textContent = "ล้างจุดทั้งหมด"; }, 3000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    btnClear.textContent = "ล้างจุดทั้งหมด";
    const { start, end } = range();
    if (end <= start) return;
    pushHistory();
    state.points.splice(start, end - start);
    if (state.legCache) state.legCache[state.leg] = [];
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
    const idx = activeStops();
    if (!idx.length) return;
    state.stops.splice(idx[idx.length - 1], 1);
    refresh();
    run("กำลังบันทึกป้ายจอด...", saveStops);
  });
  qs("btn-kind-loop").addEventListener("click", () => setKind("loop"));
  qs("btn-kind-outback").addEventListener("click", () => setKind("out_back"));
  qs("btn-leg-out").addEventListener("click", () => setLeg("out"));
  qs("btn-leg-back").addEventListener("click", () => setLeg("back"));
  qs("btn-build-back").addEventListener("click", () => buildBackLeg());
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
    updateLegCache();
    state.viewer = createTransportMapViewer(qs("path-editor-map"), {
      bundle: state.bundle,
      onMapClick,
      onLineClick,
      onLineDragEnd,
      onPointClick: onPointTap,
      onPointDragEnd,
      onStopClick,
      onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
    });
    const decorSvg = ensureLegDecor();
    let lastViewBox = "";
    if (decorSvg) new MutationObserver(() => {
      const r = decorSvg.getBoundingClientRect();
      const key = `${decorSvg.getAttribute("viewBox") || ""}|${r.width}x${r.height}`;
      if (key === lastViewBox) return;
      lastViewBox = key;
      drawLegDecor(lastLegPaths, lastLegColor);
    }).observe(decorSvg, { attributes: true, attributeFilter: ["viewBox"] });
    state.viewer.ready.then(buildRoadSnap);
    state.step = hasPath() ? 2 : 1;
    refresh();
    const focus = (state.route.resolved_path.length >= 2 ? state.route.resolved_path : state.points).map(project);
    state.viewer.focusPoints(focus);
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
