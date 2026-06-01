import { api, escapeHtml, qs, requireAdminShell, setBanner } from "./transport-v2-common.js";

const READY_BASE_MAP_STATUSES = new Set(["ready", "active", "published", "reviewed"]);

const state = {
  baseMaps: [],
  routes: [],
  role: "",
  selectedRouteIds: [],
};

function handleLegacyModeRedirect() {
  const params = new URLSearchParams(window.location.search || "");
  const mode = String(params.get("mode") || "").trim().toLowerCase();
  const routeId = Number(params.get("id") || 0) || 0;
  if (mode === "review") {
    const url = new URL("/transport-v2-routes-review.html", window.location.origin);
    if (routeId) url.searchParams.set("ids", String(routeId));
    window.location.replace(`${url.pathname}${url.search}`);
    return true;
  }
  if (mode === "path") {
    const url = new URL("/transport-v2-path-editor.html", window.location.origin);
    if (routeId) url.searchParams.set("id", String(routeId));
    window.location.replace(`${url.pathname}${url.search}`);
    return true;
  }
  return false;
}

function canManageRoutes() {
  return state.role === "owner" || state.role === "admin";
}

function canOpenReview() {
  return ["owner", "admin", "user"].includes(state.role);
}

function canOpenPathEditor() {
  return ["owner", "admin", "user"].includes(state.role);
}

function canRenderPublishedMap() {
  return canManageRoutes();
}

function isReadyBaseMap(item) {
  return READY_BASE_MAP_STATUSES.has(String(item?.status || "").trim().toLowerCase());
}

function hasRenderableMapAsset(item) {
  return Boolean(String(item?.annotation_map_url || "").trim());
}

function latestWorkspaceBaseMap() {
  const items = Array.isArray(state.baseMaps) ? state.baseMaps : [];
  return items.find((item) => isReadyBaseMap(item)) || items[0] || null;
}

function selectedRoute() {
  if (state.selectedRouteIds.length !== 1) return null;
  const routeId = Number(state.selectedRouteIds[0] || 0) || 0;
  return state.routes.find((item) => Number(item?.id || 0) === routeId) || null;
}

function selectedReviewUrl() {
  const url = new URL("/transport-v2-routes-review.html", window.location.origin);
  if (state.selectedRouteIds.length) {
    url.searchParams.set("ids", state.selectedRouteIds.join(","));
  }
  return `${url.pathname}${url.search}`;
}

function selectedRouteIds() {
  return state.selectedRouteIds
    .map((item) => Number(item || 0) || 0)
    .filter(Boolean);
}

function selectedPathUrl(routeId = 0) {
  const activeId = Number(routeId || 0) || Number(selectedRouteIds()[0] || 0) || 0;
  const url = new URL("/transport-v2-path-editor.html", window.location.origin);
  if (activeId) url.searchParams.set("id", String(activeId));
  return `${url.pathname}${url.search}`;
}

function syncSelectionStatus() {
  const node = qs("route-selection-status");
  if (!node) return;
  const count = state.selectedRouteIds.length;
  if (!count) {
    node.textContent = "No route selected";
    return;
  }
  if (count === 1) {
    const route = selectedRoute();
    node.textContent = route
      ? `Selected 1 route: ${route.route_name || route.route_number || route.id}`
      : "Selected 1 route";
    return;
  }
  node.textContent = `Selected ${count} routes`;
}

function syncActionState() {
  const reviewButton = qs("btn-open-selected-review");
  const pathButton = qs("btn-open-selected-path");
  const pathTopButton = qs("btn-open-selected-path-top");
  const openReviewButton = qs("btn-open-routes-review");
  const renderPublishedButton = qs("btn-render-published-map");
  const count = state.selectedRouteIds.length;
  if (reviewButton) reviewButton.disabled = !canOpenReview();
  if (openReviewButton) openReviewButton.disabled = !canOpenReview();
  if (pathButton) pathButton.disabled = !canOpenPathEditor() || count !== 1;
  if (pathTopButton) pathTopButton.disabled = !canOpenPathEditor() || count !== 1;
  if (renderPublishedButton) {
    renderPublishedButton.disabled = !canRenderPublishedMap() || !hasRenderableMapAsset(latestWorkspaceBaseMap());
  }
  syncSelectionStatus();
}

function renderBaseMaps() {
  const createButton = qs("btn-create-route");
  const statusNode = qs("create-route-status");
  const contextNode = qs("create-route-map-context");
  const createSection = qs("route-create-section");
  const items = Array.isArray(state.baseMaps) ? state.baseMaps : [];
  const latest = latestWorkspaceBaseMap();
  const manageEnabled = canManageRoutes();
  const hasAnnotationMap = hasRenderableMapAsset(latest);

  if (createSection) createSection.classList.toggle("hidden", !manageEnabled);
  if (contextNode) {
    contextNode.textContent = latest
      ? `Using the latest annotation map from Base Map Annotation Workspace: ${latest.title || `#${latest.id}`}`
      : "No annotation map is available from Base Map Annotation Workspace yet.";
  }
  if (createButton) createButton.disabled = !manageEnabled || items.length === 0 || !hasAnnotationMap;
  if (statusNode && items.length === 0) {
    statusNode.textContent = "Complete the base map workflow before creating routes.";
  } else if (statusNode && latest && !hasAnnotationMap) {
    statusNode.textContent = "Render Annotation Map in Base Map Annotation Workspace before creating routes.";
  } else if (statusNode) {
    statusNode.textContent = "";
  }
}

function renderRoutes() {
  const tbody = qs("route-table")?.querySelector("tbody");
  if (!tbody) return;
  const selectedIds = new Set(selectedRouteIds());
  const items = Array.isArray(state.routes) ? state.routes : [];
  tbody.innerHTML = items.length
    ? items.map((item) => `
      <tr>
        <td><input type="checkbox" data-action="toggle-route" data-id="${item.id}" ${selectedIds.has(Number(item.id || 0)) ? "checked" : ""} /></td>
        <td>${item.id}</td>
        <td>
          <strong>${escapeHtml(item.route_name)}</strong>
          <div class="muted">${escapeHtml(item.route_number)} | ${escapeHtml(item.vehicle_type)}</div>
        </td>
        <td>${escapeHtml(item.routing_status)}<div class="muted">r${Number(item.resolved_revision || 0)}/${Number(item.route_revision || 0)}</div></td>
        <td>${escapeHtml(item.poster_status)}<div class="muted">p${Number(item.poster_revision || 0)}/${Number(item.route_revision || 0)}</div></td>
        <td class="table-actions">
          <button type="button" data-action="open-review" data-id="${item.id}">Review</button>
          <button type="button" data-action="open-path" data-id="${item.id}">Edit Path</button>
        </td>
      </tr>`).join("")
    : '<tr><td colspan="6" class="muted">No routes yet</td></tr>';
  syncActionState();
}

async function refresh() {
  const [baseMaps, routes] = await Promise.all([
    api("/api/v2/transport/base-maps"),
    api("/api/v2/transport/routes"),
  ]);
  state.baseMaps = Array.isArray(baseMaps?.items) ? baseMaps.items : [];
  state.routes = Array.isArray(routes?.items) ? routes.items : [];
  state.selectedRouteIds = state.selectedRouteIds.filter((selectedId) => (
    state.routes.some((item) => Number(item?.id || 0) === Number(selectedId || 0))
  ));
  renderBaseMaps();
  renderRoutes();
}

async function createRoute() {
  const latest = latestWorkspaceBaseMap();
  if (!latest) throw new Error("A base map from Base Map Annotation Workspace is required before creating a route.");
  if (!hasRenderableMapAsset(latest)) {
    throw new Error("Render Annotation Map in Base Map Annotation Workspace before creating a route.");
  }
  return api("/api/v2/transport/routes", {
    method: "POST",
    body: JSON.stringify({
      base_map_id: Number(latest.id || 0) || null,
      route_name: String(qs("create-route-name")?.value || "").trim(),
      route_number: String(qs("create-route-number")?.value || "").trim(),
      vehicle_type: String(qs("create-route-vehicle")?.value || "songthaew").trim(),
      color: String(qs("create-route-color")?.value || "#ff6600").trim(),
      description: String(qs("create-route-description")?.value || "").trim(),
    }),
  });
}

async function renderPublishedMap() {
  const latest = latestWorkspaceBaseMap();
  if (!latest) throw new Error("A base map is required before rendering the published map.");
  if (!hasRenderableMapAsset(latest)) {
    throw new Error("Render Annotation Map in Base Map Annotation Workspace before rendering the published map.");
  }
  return api(`/api/v2/transport/base-maps/${Number(latest.id || 0) || 0}/render-published`, {
    method: "POST",
  });
}

function selectOnlyRoute(routeId) {
  const id = Number(routeId || 0) || 0;
  state.selectedRouteIds = id ? [id] : [];
  renderRoutes();
}

function toggleRouteSelection(routeId, checked) {
  const id = Number(routeId || 0) || 0;
  if (!id) return;
  const set = new Set(selectedRouteIds());
  if (checked) set.add(id);
  else set.delete(id);
  state.selectedRouteIds = Array.from(set);
  syncActionState();
}

function openRoutesReview() {
  if (!canOpenReview()) return;
  window.location.href = selectedReviewUrl();
}

function openPathEditor(routeId = 0) {
  if (!canOpenPathEditor()) return;
  if (routeId) selectOnlyRoute(routeId);
  if (state.selectedRouteIds.length !== 1) {
    setBanner("workspace-status", "Path Editor requires exactly one route.", true);
    return;
  }
  window.location.href = selectedPathUrl(routeId);
}

async function init() {
  if (handleLegacyModeRedirect()) return;
  try {
    const { role } = await requireAdminShell();
    state.role = role;
    await refresh();
  } catch (error) {
    setBanner("workspace-status", error.message || "Failed to load page", true);
    return;
  }

  qs("btn-back-home")?.addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home")?.addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-base-maps")?.addEventListener("click", () => { window.location.href = "/transport-v2-base-maps.html"; });
  qs("btn-open-routes-review")?.addEventListener("click", () => { openRoutesReview(); });
  qs("btn-open-selected-review")?.addEventListener("click", () => { openRoutesReview(); });
  qs("btn-open-selected-path")?.addEventListener("click", () => { openPathEditor(); });
  qs("btn-open-selected-path-top")?.addEventListener("click", () => { openPathEditor(); });
  qs("btn-render-published-map")?.addEventListener("click", async () => {
    if (!canRenderPublishedMap()) return;
    if (!window.confirm("Render Published Map now? This updates the published output.")) return;
    try {
      setBanner("published-map-status", "Rendering published map...");
      const updated = await renderPublishedMap();
      await refresh();
      setBanner(
        "published-map-status",
        updated?.published_map_url ? `Published map ready: ${updated.published_map_url}` : "Published map rendered"
      );
    } catch (error) {
      setBanner("published-map-status", error.message || "Render published map failed", true);
    }
  });

  qs("btn-create-route")?.addEventListener("click", async () => {
    if (!canManageRoutes()) return;
    try {
      setBanner("create-route-status", "Creating route...");
      const created = await createRoute();
      await refresh();
      setBanner("create-route-status", "Route created");
      if (created?.id) {
        state.selectedRouteIds = [created.id];
        renderRoutes();
      }
    } catch (error) {
      setBanner("create-route-status", error.message || "Failed to create route", true);
    }
  });

  qs("route-table")?.querySelector("tbody")?.addEventListener("click", (event) => {
    const target = event.target;
    if (target.matches('input[type="checkbox"][data-action="toggle-route"]')) return;
    const button = target.closest("button[data-action]");
    if (!button) return;
    const routeId = Number(button.dataset.id || 0) || 0;
    if (!routeId) return;
    if (button.dataset.action === "open-review") {
      selectOnlyRoute(routeId);
      openRoutesReview();
      return;
    }
    if (button.dataset.action === "open-path") openPathEditor(routeId);
  });

  qs("route-table")?.querySelector("tbody")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-action="toggle-route"]');
    if (!checkbox) return;
    toggleRouteSelection(checkbox.dataset.id, checkbox.checked);
  });
}

init();
