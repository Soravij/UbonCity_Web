import { api, requireAdminShell, setBanner } from "./transport-v2-common.js";
import { mountRoutesReview } from "./transport-v2-routes-review.js";

const state = {
  baseMaps: [],
  routes: [],
  selectedRouteIds: [],
};

function parseSelectedIds() {
  const params = new URLSearchParams(window.location.search || "");
  const raw = String(params.get("ids") || params.get("id") || "")
    .split(",")
    .map((item) => Number(item || 0) || 0)
    .filter(Boolean);
  return raw;
}

async function load() {
  const [baseMaps, routes] = await Promise.all([
    api("/api/v2/transport/base-maps"),
    api("/api/v2/transport/routes"),
  ]);
  state.baseMaps = Array.isArray(baseMaps?.items) ? baseMaps.items : [];
  state.routes = Array.isArray(routes?.items) ? routes.items : [];
  const existingIds = new Set(state.routes.map((item) => Number(item?.id || 0) || 0));
  state.selectedRouteIds = state.selectedRouteIds.filter((id) => existingIds.has(id));
}

function updateUrl() {
  const url = new URL(window.location.href);
  if (state.selectedRouteIds.length) url.searchParams.set("ids", state.selectedRouteIds.join(","));
  else url.searchParams.delete("ids");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

async function render() {
  await mountRoutesReview({
    routes: state.routes,
    baseMaps: state.baseMaps,
    selectedRouteIds: state.selectedRouteIds,
    statusNodeId: "review-status",
    onSelectionChange: (selectedIds) => {
      state.selectedRouteIds = Array.isArray(selectedIds)
        ? selectedIds.map((id) => Number(id || 0) || 0).filter(Boolean)
        : [];
      updateUrl();
    },
  });
}

async function init() {
  try {
    await requireAdminShell("review-status", "");
    state.selectedRouteIds = parseSelectedIds();
    await load();
    await render();
  } catch (error) {
    setBanner("review-status", error.message || "Failed to load routes review", true);
    return;
  }
  document.getElementById("btn-back-routes")?.addEventListener("click", () => {
    window.location.href = "/transport-v2-routes.html";
  });
}

init();
