import { api, escapeHtml, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer } from "./transport-map-viewer.js";

const state = { baseMaps: [], baseMapId: 0, viewer: null, bundle: null, selectedId: null, lang: "th" };

function routeById(id) {
  return (state.bundle?.routes || []).find((r) => r.id === id) || null;
}

function renderChips() {
  const node = qs("preview-route-chips");
  const routes = state.bundle?.routes || [];
  node.innerHTML = routes.length
    ? routes.map((r) => `
      <button type="button" class="utility-action" data-route-id="${r.id}" aria-pressed="${state.selectedId === r.id}">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escapeHtml(r.color)}"></span>
        ${escapeHtml(r.number)} ${escapeHtml(r.name)}
      </button>`).join("")
    : `<span class="muted">ยังไม่มีสายที่พร้อมแสดง</span>`;
}

function renderDetail() {
  const r = routeById(state.selectedId);
  qs("preview-route-detail").textContent = r
    ? `สาย ${r.number} · ${r.name} · ${r.vehicle_type} · ${Number(r.distance_km || 0).toFixed(1)} กม. · ป้ายจอด ${r.stops.length} จุด${r.description ? ` · ${r.description}` : ""}`
    : "แตะเส้นหรือปุ่มเลขสายเพื่อดูรายละเอียด";
}

function selectRoute(id) {
  state.selectedId = id == null || state.selectedId === id ? null : id;
  state.viewer?.selectRoute(state.selectedId);
  if (state.selectedId != null) state.viewer?.focusRoute(state.selectedId);
  renderChips();
  renderDetail();
}

function renderList(id, items, format) {
  qs(id).innerHTML = (items || []).map((item) => `<li>${escapeHtml(format(item))}</li>`).join("");
}

async function loadLive() {
  const node = qs("publish-live");
  try {
    const info = await api(`/api/v2/transport/base-maps/${state.baseMapId}/publish-preview`);
    node.textContent = info.live
      ? `บนเว็บตอนนี้: revision ${info.live.revision} · ${info.live.route_count} สาย · ${new Date(info.live.published_at).toLocaleString("th-TH")}`
      : "ยังไม่เคย publish (หรือเชื่อม backend ไม่ได้)";
  } catch (err) {
    node.textContent = `เช็คสถานะบนเว็บไม่ได้: ${err.message}`;
  }
}

async function loadPreview() {
  setBanner("workspace-status", "");
  const data = await api(`/api/v2/transport/base-maps/${state.baseMapId}/preview-bundle`);
  state.bundle = data.bundle;
  state.selectedId = null;
  state.viewer?.destroy();
  const container = qs("preview-map");
  container.replaceChildren();
  state.viewer = createTransportMapViewer(container, {
    bundle: data.bundle,
    lang: state.lang,
    onRouteSelect: (id) => selectRoute(id),
    onError: (err) => setBanner("workspace-status", `โหลด base map ไม่ได้: ${err.message}`, true),
  });
  renderChips();
  renderDetail();
  renderList("publish-problems", data.problems, (p) => `ยัง publish ไม่ได้: ${p}`);
  renderList("publish-skipped", data.skipped, (s) => `ข้ามสาย ${s.number || s.id}: ${s.reason}`);
  qs("btn-publish").disabled = data.problems.length > 0;
  await loadLive();
}

async function publish() {
  if (!window.confirm("Publish แผนที่นี้ขึ้นเว็บตอนนี้?")) return;
  const button = qs("btn-publish");
  button.disabled = true;
  setBanner("publish-status", "กำลัง publish...");
  try {
    const result = await api(`/api/v2/transport/base-maps/${state.baseMapId}/publish`, { method: "POST" });
    setBanner("publish-status", `Publish แล้ว: revision ${result.revision} · ${result.route_count} สาย`);
    await loadLive();
  } catch (err) {
    const detail = err.payload?.problems?.join(", ") || err.payload?.backend?.error || "";
    setBanner("publish-status", `${err.message}${detail ? ` — ${detail}` : ""}`, true);
  } finally {
    button.disabled = false;
  }
}

async function init() {
  const user = await initAuthBox({ allowRoles: ["owner"] });
  if (!user) return;
  qs("btn-back-home").addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home").addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-base-maps").addEventListener("click", () => { window.location.href = "/transport-v2-base-maps.html"; });
  qs("btn-open-routes").addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("btn-fit").addEventListener("click", () => state.viewer?.fitAll());
  for (const lang of ["th", "en"]) {
    qs(`btn-lang-${lang}`).addEventListener("click", () => { state.lang = lang; state.viewer?.setLang(lang); });
  }
  qs("preview-route-chips").addEventListener("click", (e) => {
    const button = e.target.closest("button[data-route-id]");
    if (button) selectRoute(Number(button.dataset.routeId));
  });
  qs("btn-publish").addEventListener("click", publish);
  qs("preview-base-map").addEventListener("change", (e) => {
    state.baseMapId = Number(e.target.value || 0);
    loadPreview().catch((err) => setBanner("workspace-status", err.message, true));
  });
  try {
    const list = await api("/api/v2/transport/base-maps");
    state.baseMaps = Array.isArray(list?.items) ? list.items : [];
    if (!state.baseMaps.length) {
      setBanner("workspace-status", "ยังไม่มี base map", true);
      qs("btn-publish").disabled = true;
      return;
    }
    const requested = Number(new URLSearchParams(window.location.search).get("id") || 0);
    state.baseMapId = state.baseMaps.some((b) => b.id === requested) ? requested : state.baseMaps[0].id;
    qs("preview-base-map").innerHTML = state.baseMaps
      .map((b) => `<option value="${b.id}"${b.id === state.baseMapId ? " selected" : ""}>${escapeHtml(b.title || `#${b.id}`)}</option>`).join("");
    await loadPreview();
  } catch (err) {
    setBanner("workspace-status", err.message || "โหลดหน้าไม่ได้", true);
  }
}

init();
