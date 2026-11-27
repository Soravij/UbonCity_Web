import { api, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer } from "./transport-map-viewer.js";
import { createStage } from "./transport-v2-stage.js";

const READY_BASE_MAP_STATUSES = new Set(["ready", "active", "published", "reviewed"]);
const CATEGORY_LABELS = {
  hospital: "โรงพยาบาล", market: "ตลาด", temple: "วัด", school: "สถานศึกษา", transit: "สถานีขนส่ง/รถไฟ",
  airport: "สนามบิน", mall: "ห้าง", government: "สถานที่ราชการ", area: "ชื่อย่าน", other: "อื่น ๆ",
};
const state = { baseMap: null, viewer: null, saved: [], items: [], selectedKey: null, mode: "idle", saving: false, deleteArmed: null };
const stage = createStage({ stage: qs("landmarks-stage"), collapseBtn: qs("btn-collapse"), fullscreenBtn: qs("btn-fullscreen"), title: () => "Landmarks" });
const round1 = (v) => Math.round(Number(v) * 10) / 10;

function status(text, isError = false) {
  const node = qs("stage-status");
  node.textContent = text || "";
  node.classList.toggle("tv2-text-error", Boolean(isError));
}

function toViewerLabels(items) {
  return items.map((it, i) => ({
    key: it.key, category: it.category, x: it.x, y: it.y, priority: items.length - i, min_zoom: it.min_zoom,
    texts: { th: it.th || "(ยังไม่มีชื่อ)", ...(it.en ? { en: it.en } : {}) },
  }));
}

function selected() {
  return state.items.find((it) => it.key === state.selectedKey) || null;
}

function renderList() {
  const q = qs("lm-search").value.trim().toLowerCase();
  const nodes = state.items
    .filter((it) => !q || `${it.th} ${it.en}`.toLowerCase().includes(q))
    .map((it) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `${it.key === state.selectedKey ? "primary" : "utility-action"} tv2-panel-btn`;
      b.textContent = `${it.th || "(ยังไม่มีชื่อ)"} · ${CATEGORY_LABELS[it.category] || it.category}`;
      b.addEventListener("click", () => select(it.key));
      return b;
    });
  if (!nodes.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = state.items.length ? "ไม่พบ" : "ยังไม่มี landmark";
    nodes.push(p);
  }
  qs("lm-list").replaceChildren(...nodes);
}

function renderForm() {
  const it = selected();
  qs("lm-form").hidden = !it;
  if (it) {
    qs("lm-category").value = it.category;
    qs("lm-th").value = it.th;
    qs("lm-en").value = it.en;
    qs("lm-minzoom").value = it.min_zoom == null ? "" : String(it.min_zoom);
  }
  qs("btn-add-mode").className = `${state.mode === "add" ? "primary" : "utility-action"} tv2-panel-btn`;
  qs("btn-move").className = `${state.mode === "move" ? "primary" : "utility-action"} tv2-panel-btn`;
  qs("btn-delete").textContent = state.deleteArmed ? "กดอีกครั้งเพื่อลบ" : "ลบ";
  for (const id of ["btn-save", "btn-delete", "btn-move"]) qs(id).disabled = state.saving;
}

function refresh() {
  state.viewer?.setLabels(toViewerLabels(state.items));
  state.viewer?.selectLabel(state.selectedKey);
  renderList();
  renderForm();
  qs("lm-meta").textContent = `${state.baseMap?.title || ""} · ${state.saved.length} จุด`;
  stage.render();
}

function select(key) {
  state.items = state.items.filter((i) => !i.isNew || i.key === key);
  state.selectedKey = key;
  state.mode = "idle";
  state.deleteArmed = null;
  status("");
  refresh();
}

function readForm(it) {
  it.category = qs("lm-category").value || "other";
  it.th = qs("lm-th").value.trim();
  it.en = qs("lm-en").value.trim();
  const mz = qs("lm-minzoom").value.trim();
  it.min_zoom = mz === "" ? null : Number(mz);
}

async function save(nextItems) {
  state.saving = true;
  status("กำลังบันทึก…");
  renderForm();
  try {
    const res = await api(`/api/v2/transport/landmarks?base_map_id=${state.baseMap.id}`, {
      method: "PUT",
      body: JSON.stringify({ items: nextItems.map(({ key, category, x, y, min_zoom, th, en }) => ({ key, category, x, y, min_zoom, th, en })) }),
    });
    state.saved = res.items || [];
    state.items = state.saved.map((i) => ({ ...i }));
    if (!state.items.some((i) => i.key === state.selectedKey)) state.selectedKey = null;
    status("บันทึกแล้ว");
  } catch (err) {
    status(err.message || "บันทึกไม่สำเร็จ", true);
  } finally {
    state.saving = false;
    refresh();
  }
}

function unitsPerPx() {
  const svg = qs("landmarks-map").querySelector("svg");
  const vb = svg?.viewBox?.baseVal;
  return vb && svg.clientWidth && svg.clientHeight ? Math.max(vb.width / svg.clientWidth, vb.height / svg.clientHeight) : 1;
}

function hitTest(at) {
  const svg = qs("landmarks-map").querySelector("svg");
  if (!svg) return null;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const pad = (coarse ? 12 : 6) * unitsPerPx();
  let best = null;
  let bestD = Infinity;
  for (const g of svg.querySelectorAll("g[data-landmark]")) {
    if (g.style.display === "none") continue;
    const b = g.getBBox();
    if (at.x < b.x - pad || at.x > b.x + b.width + pad || at.y < b.y - pad || at.y > b.y + b.height + pad) continue;
    const it = state.items.find((i) => i.key === g.getAttribute("data-key"));
    if (!it) continue;
    const d = Math.hypot(it.x - at.x, it.y - at.y);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

function onMapClick(at) {
  if (state.saving) return;
  const cur = selected();
  if (state.mode === "move" && cur) {
    cur.x = round1(at.x);
    cur.y = round1(at.y);
    state.mode = "idle";
    status("ย้ายแล้ว — กดบันทึก");
    refresh();
    return;
  }
  if (state.mode === "add") {
    const it = { key: `lm-${Date.now().toString(36)}`, category: qs("lm-category").value || "other", x: round1(at.x), y: round1(at.y), min_zoom: null, th: "", en: "", isNew: true };
    state.items = state.items.filter((i) => !i.isNew);
    state.items.push(it);
    state.selectedKey = it.key;
    state.mode = "idle";
    status("ใส่ชื่อแล้วกดบันทึก");
    refresh();
    qs("lm-th").focus();
    return;
  }
  const hit = hitTest(at);
  select(hit ? hit.key : null);
}

function bind() {
  qs("btn-back-home")?.addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home")?.addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-routes")?.addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("btn-open-preview")?.addEventListener("click", () => { window.location.href = "/transport-v2-preview.html"; });
  qs("btn-add-mode").addEventListener("click", () => {
    state.mode = state.mode === "add" ? "idle" : "add";
    status(state.mode === "add" ? "แตะบนแผนที่เพื่อวางจุด" : "");
    renderForm();
  });
  qs("btn-move").addEventListener("click", () => {
    state.mode = state.mode === "move" ? "idle" : "move";
    status(state.mode === "move" ? "แตะบนแผนที่ตรงตำแหน่งใหม่" : "");
    renderForm();
  });
  qs("lm-search").addEventListener("input", renderList);
  qs("lm-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const it = selected();
    if (!it || state.saving) return;
    readForm(it);
    if (!it.th) { status("ต้องใส่ชื่อภาษาไทย", true); return; }
    delete it.isNew;
    save(state.items);
  });
  qs("btn-delete").addEventListener("click", () => {
    const it = selected();
    if (!it || state.saving) return;
    if (it.isNew) { select(null); return; }
    if (state.deleteArmed !== it.key) {
      state.deleteArmed = it.key;
      renderForm();
      setTimeout(() => { if (state.deleteArmed === it.key) { state.deleteArmed = null; renderForm(); } }, 3000);
      return;
    }
    state.deleteArmed = null;
    save(state.items.filter((i) => i.key !== it.key && !i.isNew));
  });
  qs("btn-cancel").addEventListener("click", () => select(null));
  qs("btn-fit").addEventListener("click", () => state.viewer?.fitAll());
}

async function init() {
  const user = await initAuthBox({ allowRoles: ["owner"] });
  if (!user) return;
  bind();
  try {
    const maps = (await api("/api/v2/transport/base-maps"))?.items || [];
    state.baseMap = maps.find((m) => READY_BASE_MAP_STATUSES.has(String(m.status || ""))) || maps[0] || null;
    if (!state.baseMap) {
      setBanner("workspace-status", "ยังไม่มี base map — ทำขั้น 1 ก่อน", true);
      return;
    }
    const [preview, lm] = await Promise.all([
      api(`/api/v2/transport/base-maps/${state.baseMap.id}/preview-bundle`),
      api(`/api/v2/transport/landmarks?base_map_id=${state.baseMap.id}`),
    ]);
    state.saved = lm?.items || [];
    state.items = state.saved.map((i) => ({ ...i }));
    state.viewer = createTransportMapViewer(qs("landmarks-map"), {
      bundle: { ...preview.bundle, routes: [], labels: toViewerLabels(state.items) },
      onMapClick,
      onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
    });
    refresh();
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
