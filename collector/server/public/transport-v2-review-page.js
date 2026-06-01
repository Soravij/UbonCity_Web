import { api, escapeHtml, qs, requireAdminShell, setBanner } from "/transport-v2-common.js";

const state = { itemId: Number(new URLSearchParams(window.location.search).get("id") || 0) || 0, route: null, readiness: null };

function render() {
  qs("readiness-output").textContent = JSON.stringify(state.readiness || {}, null, 2);
  const root = qs("poster-preview");
  if (!root) return;
  const url = String(state.route?.poster_svg_url || "").trim();
  root.innerHTML = url
    ? `<img src="${escapeHtml(url)}" alt="poster preview" style="width:100%;max-width:640px;height:auto;border:1px solid rgba(20,26,43,.12);border-radius:12px" /><div class="muted" style="margin-top:8px">${escapeHtml(url)}</div>`
    : '<p class="muted">ยังไม่มี poster.svg</p>';
}

async function load() {
  const [route, readiness] = await Promise.all([
    api(`/api/v2/transport/routes/${state.itemId}`),
    api(`/api/v2/transport/routes/${state.itemId}/review-readiness`),
  ]);
  state.route = route || null;
  state.readiness = readiness || null;
  render();
}

async function init() {
  try {
    await requireAdminShell();
    await load();
  } catch (error) {
    setBanner("workspace-status", error.message || "โหลดหน้าไม่สำเร็จ", true);
    return;
  }
  qs("btn-back-home")?.addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-open-manager")?.addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("btn-open-workspace")?.addEventListener("click", () => { window.location.href = `/transport-v2-path-editor.html?id=${state.itemId}`; });
  qs("btn-refresh-review")?.addEventListener("click", async () => {
    try {
      setBanner("review-status", "กำลังโหลด...");
      await load();
      setBanner("review-status", "รีเฟรชแล้ว");
    } catch (error) {
      setBanner("review-status", error.message || "รีเฟรชไม่สำเร็จ", true);
    }
  });
  qs("btn-release-route")?.addEventListener("click", async () => {
    try {
      setBanner("review-status", "กำลัง release...");
      await api(`/api/v2/transport/routes/${state.itemId}/release-main`, { method: "POST" });
      await load();
      setBanner("review-status", "release แล้ว");
    } catch (error) {
      setBanner("review-status", error.message || "release ไม่สำเร็จ", true);
    }
  });
}

init();
