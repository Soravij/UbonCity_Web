import { api, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer } from "./transport-map-viewer.js";
import { createStage } from "./transport-v2-stage.js";
import { ROUTE_PALETTE } from "./transport-v2-palette.js";

const READY_BASE_MAP_STATUSES = new Set(["ready", "active", "published", "reviewed"]);
const SVG_NS = "http://www.w3.org/2000/svg";
const state = { baseMap: null, routes: [], viewer: null, selectedId: null, isNew: false, pickedColor: null, saving: false };
const stage = createStage({ stage: qs("routes-stage"), collapseBtn: qs("btn-collapse"), fullscreenBtn: qs("btn-fullscreen"), title: () => "Routes" });
stage.onChange(() => {
  const full = stage.isFull();
  document.getElementById("routes-map").hidden = !full;
  document.getElementById("btn-fit").hidden = !full;
  if (full) requestAnimationFrame(() => requestAnimationFrame(() => {
    if (state.selectedId) state.viewer?.focusRoute(state.selectedId); else state.viewer?.fitAll();
  }));
});
const pathEditorUrl = (id) => "transport-v2-path-editor.html?id=" + id;

function status(text, isError = false) {
  const node = qs("stage-status");
  node.textContent = text || "";
  node.classList.toggle("tv2-text-error", Boolean(isError));
}

function dot(color, size = 12) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", "6");
  c.setAttribute("cy", "6");
  c.setAttribute("r", "6");
  c.setAttribute("fill", color || "#999999");
  svg.append(c);
  return svg;
}

function current() {
  return state.routes.find((r) => r.id === state.selectedId) || null;
}

function routingStatusText(r) {
  return r?.routing_status === "fresh" ? "✓" : "ยังไม่คำนวณ";
}

function renderList() {
  const nodes = state.routes.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `${r.id === state.selectedId ? "primary" : "utility-action"} tv2-panel-btn tv2-route-btn`;
    const label = document.createElement("span");
    label.textContent = `${r.route_number} · ${r.route_name}`;
    const st = document.createElement("span");
    st.className = "muted";
    st.textContent = routingStatusText(r);
    b.append(dot(r.color), label, st);
    b.addEventListener("click", () => select(r.id));
    return b;
  });
  if (!nodes.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "ยังไม่มีสาย";
    nodes.push(p);
  }
  qs("rt-list").replaceChildren(...nodes);
  qs("rt-meta").textContent = `${state.baseMap?.title || ""} · ${state.routes.length} สาย`;
}

function renderSwatches() {
  const r = current();
  const active = state.pickedColor || (state.isNew ? null : r?.color || null);
  const nodes = ROUTE_PALETTE.map((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "utility-action tv2-swatch";
    b.setAttribute("aria-label", `สี ${c}`);
    b.setAttribute("aria-pressed", String(active === c));
    b.append(dot(c, 22));
    b.addEventListener("click", () => { state.pickedColor = c; renderSwatches(); });
    return b;
  });
  qs("rt-swatches").replaceChildren(...nodes);
  qs("rt-color-note").textContent = state.pickedColor ? "(เลือกเอง)"
    : state.isNew ? "(ระบบเลือกให้)"
    : r?.color_locked ? "(ล็อกแล้ว)" : "(ระบบจะเลือกให้ตอนคำนวณเส้นทางครั้งแรก)";
}

function renderForm() {
  const r = current();
  const show = state.isNew || Boolean(r);
  qs("rt-detail").hidden = !show;
  if (!show) return;
  qs("rt-form-title").textContent = state.isNew ? "สร้างสายใหม่" : `แก้สาย ${r.route_number}`;
  qs("rt-number").value = state.isNew ? "" : r.route_number || "";
  qs("rt-name").value = state.isNew ? "" : r.route_name || "";
  qs("rt-vehicle").value = state.isNew ? "songthaew" : r.vehicle_type || "songthaew";
  qs("rt-kind").value = state.isNew ? "loop" : r.route_kind || "loop";
  qs("rt-fare").value = state.isNew || r.fare_baht == null ? "" : String(r.fare_baht);
  qs("rt-desc").value = state.isNew ? "" : r.description || "";
  qs("rt-desc-en").value = state.isNew ? "" : r.description_en || "";
  const thumb = state.isNew ? "" : r.vehicle_thumbnail_url || "";
  qs("rt-thumb").hidden = !thumb;
  if (thumb) qs("rt-thumb").src = thumb;
  qs("rt-photo").value = "";
  renderSwatches();
}

function select(id) {
  state.selectedId = id;
  state.isNew = false;
  state.pickedColor = null;
  status("");
  renderList();
  renderForm();
  qs("rt-detail").hidden = !id;
  qs("rt-actions").hidden = false;
  qs("rt-form").hidden = true;
  state.viewer?.selectRoute(id);
  if (id) state.viewer?.focusRoute(id);
}

function startNew() {
  state.selectedId = null;
  state.isNew = true;
  state.pickedColor = null;
  status("");
  renderList();
  renderForm();
  qs("rt-detail").hidden = false;
  qs("rt-actions").hidden = true;
  qs("rt-form").hidden = false;
  state.viewer?.selectRoute(null);
}

function readForm() {
  const body = {
    route_number: qs("rt-number").value.trim(),
    route_name: qs("rt-name").value.trim(),
    vehicle_type: qs("rt-vehicle").value,
    route_kind: qs("rt-kind").value,
    fare_baht: qs("rt-fare").value.trim(),
    description: qs("rt-desc").value.trim(),
    description_en: qs("rt-desc-en").value.trim(),
  };
  if (state.pickedColor) body.color = state.pickedColor;
  return body;
}

async function load() {
  const [baseMaps, routes] = await Promise.all([api("/api/v2/transport/base-maps"), api("/api/v2/transport/routes")]);
  const maps = Array.isArray(baseMaps?.items) ? baseMaps.items : [];
  state.baseMap = maps.find((m) => READY_BASE_MAP_STATUSES.has(String(m.status || ""))) || maps[0] || null;
  if (!state.baseMap) throw new Error("ยังไม่มี base map — ทำขั้น 1 ก่อน");
  state.routes = (Array.isArray(routes?.items) ? routes.items : []).filter((r) => r.base_map_id === state.baseMap.id);
  const preview = await api(`/api/v2/transport/base-maps/${state.baseMap.id}/preview-bundle`);
  state.viewer?.destroy();
  state.viewer = createTransportMapViewer(qs("routes-map"), {
    bundle: preview.bundle,
    onRouteSelect: (id) => { if (id) select(id); },
    onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
  });
  renderList();
}

async function save() {
  const body = readForm();
  if (!body.route_number || !body.route_name) { status("ต้องใส่เลขสายและชื่อสาย", true); return; }
  if (state.saving) return;
  state.saving = true;
  qs("btn-save").disabled = true;
  status("กำลังบันทึก…");
  try {
    let saved = state.isNew
      ? await api("/api/v2/transport/routes", { method: "POST", body: JSON.stringify({ ...body, base_map_id: state.baseMap.id }) })
      : await api(`/api/v2/transport/routes/${state.selectedId}`, { method: "PUT", body: JSON.stringify(body) });
    state.isNew = false;
    state.selectedId = saved.id;
    const file = qs("rt-photo").files?.[0] || null;
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      saved = await api(`/api/v2/transport/routes/${saved.id}/thumbnail`, { method: "POST", body: fd });
    }
    await load();
    select(saved.id);
    qs("rt-actions").hidden = false;
    status("บันทึกแล้ว");
  } catch (err) {
    status(err.message || "บันทึกไม่สำเร็จ", true);
  } finally {
    state.saving = false;
    qs("btn-save").disabled = false;
  }
}

function bind() {
  qs("btn-back-home")?.addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home")?.addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-routes")?.addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("btn-open-preview")?.addEventListener("click", () => { window.location.href = "/transport-v2-preview.html"; });
  qs("btn-new").addEventListener("click", startNew);
  qs("btn-close").addEventListener("click", () => {
    if (state.isNew) select(null);
    else qs("rt-form").hidden = true;
  });
  qs("btn-fit").addEventListener("click", () => state.viewer?.fitAll());
  qs("rt-form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  qs("btn-edit-info").addEventListener("click", () => { qs("rt-form").hidden = false; });
  qs("btn-draw-path").addEventListener("click", () => {
    if (state.selectedId) window.location.href = pathEditorUrl(state.selectedId);
  });
}

async function init() {
  const user = await initAuthBox({ allowRoles: ["owner"] });
  if (!user) return;
  bind();
  try {
    await load();
    const want = Number(new URLSearchParams(location.search).get("route"));
    if (want) {
      const r = state.routes.find((x) => x.id === want);
      if (r) select(r.id);
    }
    stage.render();
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
