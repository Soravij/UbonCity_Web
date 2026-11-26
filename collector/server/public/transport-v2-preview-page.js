import { api, escapeHtml, qs, setBanner } from "./transport-v2-common.js";
import { initAuthBox } from "./auth-box.js";
import { createTransportMapViewer } from "./transport-map-viewer.js";
import { createStage } from "./transport-v2-stage.js";
import { colorClashes, routeCardModel } from "./transport-v2-preview-checks.js";

const state = { baseMaps: [], baseMapId: 0, viewer: null, bundle: null, selectedId: null, lang: "th" };
const stage = createStage({ stage: qs("preview-stage"), collapseBtn: qs("btn-collapse"), fullscreenBtn: qs("btn-fullscreen"), title: () => "Preview" });
stage.onChange(() => requestAnimationFrame(() => requestAnimationFrame(() => {
  if (state.selectedId != null) state.viewer?.focusRoute(state.selectedId); else state.viewer?.fitAll();
})));

function routeById(id) {
  return (state.bundle?.routes || []).find((r) => r.id === id) || null;
}

function renderRouteList() {
  const routes = state.bundle?.routes || [];
  qs("preview-route-list").innerHTML = routes.length
    ? routes.map((r) => `<button type="button" class="utility-action tv2-route-btn" data-route-id="${r.id}" aria-pressed="${state.selectedId === r.id}"><span>${escapeHtml(r.number)} ${escapeHtml(r.name)}</span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(r.color)}"></span></button>`).join("")
    : `<span class="muted">ยังไม่มีสายที่พร้อมแสดง</span>`;
}

function renderCard() {
  const r = routeById(state.selectedId);
  qs("route-card").hidden = !r;
  qs("route-card-empty").hidden = Boolean(r);
  if (!r) return;
  const card = routeCardModel(r, state.lang);
  qs("route-card-title").textContent = card.title;
  const img = qs("route-card-photo");
  img.hidden = !card.photo;
  if (card.photo) { img.src = card.photo; img.alt = card.title; } else img.removeAttribute("src");
  qs("route-card-info").innerHTML = card.rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("");
}

function selectRoute(id) {
  state.selectedId = id == null || state.selectedId === id ? null : id;
  state.viewer?.selectRoute(state.selectedId);
  if (state.selectedId != null) state.viewer?.focusRoute(state.selectedId);
  renderRouteList();
  renderCard();
}

function setLang(lang) {
  state.lang = lang;
  for (const l of ["th", "en"]) qs(`btn-lang-${l}`).setAttribute("aria-pressed", String(l === lang));
  state.viewer?.setLang(lang);
  renderCard();
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
  renderRouteList();
  renderCard();
  renderList("publish-problems", data.problems, (p) => `ยัง publish ไม่ได้: ${p}`);
  renderList("publish-warnings", colorClashes(data.bundle), (c) => `สีชน: สาย ${c.a} กับสาย ${c.b} ใช้สีเดียวกันและวิ่งใกล้กัน — เปลี่ยนสีที่หน้า Routes`);
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
  for (const lang of ["th", "en"]) qs(`btn-lang-${lang}`).addEventListener("click", () => setLang(lang));
  qs("preview-route-list").addEventListener("click", (e) => {
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
