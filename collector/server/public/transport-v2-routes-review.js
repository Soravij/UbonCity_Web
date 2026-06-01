import { api, escapeHtml, setBanner } from "./transport-v2-common.js";
import {
  computeBaseRenderedImageRect,
  mapPointToStagePercent as mapPointToStagePercentShared,
  mapSizeToStagePercent as mapSizeToStagePercentShared,
  projectBoundsPointToStagePercent,
} from "./transport-v2-map-geometry.js";

const state = {
  initialized: false,
  routes: [],
  baseMaps: [],
  selectedIds: [],
  routeDetails: new Map(),
  onSelectionChange: null,
  onActiveBaseMapChange: null,
  statusNodeId: "review-status",
  view: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    panning: false,
    startX: 0,
    startY: 0,
  },
  detailRequestToken: 0,
  hasMounted: false,
  zoomRenderTimer: 0,
  geometryCache: {
    revision: 0,
    stageRect: null,
    baseRect: null,
  },
};

const ZOOM_SCALE_RANGE = {
  min: 0.9,
  base: 1,
  max: 1.15,
};

function reviewElements() {
  return {
    stage: document.getElementById("routes-review-map-stage") || document.querySelector(".review-map"),
    viewport: document.getElementById("routes-review-viewport"),
    image: document.getElementById("routes-review-base-map-image"),
    empty: document.getElementById("routes-review-empty"),
    overlayLayer: document.getElementById("routes-review-overlay-layer"),
    labelLayer: document.getElementById("routes-review-label-layer"),
    overlay: document.getElementById("routes-review-overlay"),
    selectorList: document.getElementById("routes-review-selector-list"),
  };
}

function selectedRoutes() {
  const idSet = new Set(state.selectedIds.map((id) => Number(id || 0) || 0));
  return state.routes.filter((route) => idSet.has(Number(route?.id || 0) || 0));
}

function latestWorkspaceBaseMap() {
  const items = Array.isArray(state.baseMaps) ? state.baseMaps : [];
  return items.find((item) => ["ready", "active", "published", "reviewed"].includes(String(item?.status || "").trim().toLowerCase()))
    || items[0]
    || null;
}

function activeBaseMap() {
  return latestWorkspaceBaseMap();
}

function activeRenderPayload() {
  return activeBaseMap()?.annotation_render_payload || null;
}

function invalidateGeometryCache() {
  state.geometryCache.revision = 0;
  state.geometryCache.stageRect = null;
  state.geometryCache.baseRect = null;
}

function currentGeometry(renderPayload = activeRenderPayload()) {
  const revision = Number(renderPayload?.revision || 0) || 0;
  if (state.geometryCache.stageRect && state.geometryCache.baseRect && state.geometryCache.revision === revision) {
    return state.geometryCache;
  }
  const stageRect = reviewElements().stage?.getBoundingClientRect?.() || null;
  const baseRect = stageRect && renderPayload
    ? computeBaseRenderedImageRect(stageRect, renderPayload.viewbox)
    : null;
  state.geometryCache = {
    revision,
    stageRect,
    baseRect,
  };
  return state.geometryCache;
}

function toggleSelection(routeId, checked) {
  const id = Number(routeId || 0) || 0;
  if (!id) return;
  const set = new Set(state.selectedIds.map((item) => Number(item || 0) || 0));
  if (checked) set.add(id);
  else set.delete(id);
  state.selectedIds = Array.from(set);
  if (typeof state.onSelectionChange === "function") state.onSelectionChange([...state.selectedIds]);
}

function selectorItemMarkup(route, checked) {
  const color = String(route?.color || "#ff6600").trim() || "#ff6600";
  return `
    <div class="review-selector-item">
      <label>
        <input type="checkbox" data-route-id="${Number(route?.id || 0) || 0}" ${checked ? "checked" : ""} />
        <span>${escapeHtml(route?.route_name || "-")}</span>
      </label>
      <span class="muted">${escapeHtml(route?.route_number || "-")}</span>
      <span class="review-color-chip" style="background:${escapeHtml(color)}"></span>
    </div>
  `;
}

function renderSelector() {
  const { selectorList } = reviewElements();
  if (!selectorList) return;
  const selectedSet = new Set(state.selectedIds.map((id) => Number(id || 0) || 0));
  selectorList.innerHTML = state.routes.length
    ? state.routes.map((route) => selectorItemMarkup(route, selectedSet.has(Number(route?.id || 0)))).join("")
    : '<div class="muted">No routes available.</div>';
}

function updateViewportTransform() {
  const { stage, viewport } = reviewElements();
  if (!stage || !viewport) return;
  viewport.style.transform = `translate(${Number(state.view.offsetX || 0)}px, ${Number(state.view.offsetY || 0)}px) scale(${Number(state.view.scale || 1)})`;
  viewport.classList.toggle("is-dragging", Boolean(state.view.panning));
  stage.classList.toggle("is-panning", Boolean(state.view.panning));
}

function resetView() {
  state.view.scale = 1;
  state.view.offsetX = 0;
  state.view.offsetY = 0;
  state.view.panning = false;
  updateViewportTransform();
  flushZoomRender();
}

function clampScale(scale) {
  return Math.max(1, Math.min(8, Number(scale) || 1));
}

function zoomAssetMultiplier(viewportScale = state.view.scale) {
  const scale = Math.max(Number(viewportScale) || 1, 0.25);
  if (scale <= 1) {
    return ZOOM_SCALE_RANGE.min + ((ZOOM_SCALE_RANGE.base - ZOOM_SCALE_RANGE.min) * scale);
  }
  const progress = Math.max(0, Math.min(1, (scale - 1) / 7));
  return ZOOM_SCALE_RANGE.base + ((ZOOM_SCALE_RANGE.max - ZOOM_SCALE_RANGE.base) * progress);
}

function normalizeZoomScaleConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const min = Number(raw.min);
  const base = Number(raw.base);
  const max = Number(raw.max);
  const nextMin = Number.isFinite(min) ? Math.max(0.5, Math.min(2, min)) : ZOOM_SCALE_RANGE.min;
  const nextBase = Number.isFinite(base) ? Math.max(0.5, Math.min(2, base)) : ZOOM_SCALE_RANGE.base;
  const nextMax = Number.isFinite(max) ? Math.max(0.5, Math.min(2, max)) : ZOOM_SCALE_RANGE.max;
  const sorted = [nextMin, nextBase, nextMax].sort((left, right) => left - right);
  return { min: sorted[0], base: sorted[1], max: sorted[2] };
}

function zoomAssetMultiplierForConfig(zoomScale, viewportScale = state.view.scale) {
  const config = normalizeZoomScaleConfig(zoomScale);
  const scale = Math.max(Number(viewportScale) || 1, 0.25);
  if (scale <= 1) {
    return config.min + ((config.base - config.min) * scale);
  }
  const progress = Math.max(0, Math.min(1, (scale - 1) / 7));
  return config.base + ((config.max - config.base) * progress);
}

function routeStrokeWidth() {
  return (1.2 * zoomAssetMultiplier(state.view.scale)).toFixed(2);
}

function layerPreviewScale(scaleWithZoom = true, zoomScale = ZOOM_SCALE_RANGE) {
  const viewportScale = Math.max(Number(state.view.scale || 1), 1);
  if (!scaleWithZoom) return 1 / viewportScale;
  return zoomAssetMultiplierForConfig(zoomScale, viewportScale) / viewportScale;
}

function activeLocale() {
  return String(document.documentElement?.lang || "th").trim().toLowerCase() || "th";
}

function labelText(label) {
  const texts = label?.texts && typeof label.texts === "object" ? label.texts : {};
  const locale = activeLocale();
  return String(texts?.[locale] || texts?.th || texts?.en || label?.label_key || "").trim();
}

function localeOffset(label) {
  const locale = activeLocale();
  const offset = label?.locale_offsets?.[locale] && typeof label.locale_offsets[locale] === "object"
    ? label.locale_offsets[locale]
    : {};
  return {
    dx: Number(offset?.dx || 0) || 0,
    dy: Number(offset?.dy || 0) || 0,
  };
}

function mapPointToStagePercent(anchorX, anchorY, renderPayload, geometry = currentGeometry(renderPayload)) {
  return mapPointToStagePercentShared(
    anchorX,
    anchorY,
    renderPayload?.viewbox,
    geometry?.stageRect,
    geometry?.baseRect
  );
}

function mapSizeToStagePercent(widthValue, heightValue, renderPayload, geometry = currentGeometry(renderPayload)) {
  return mapSizeToStagePercentShared(
    widthValue,
    heightValue,
    renderPayload?.viewbox,
    geometry?.stageRect,
    geometry?.baseRect
  );
}

function renderOverlayLayer(renderPayload, geometry = currentGeometry(renderPayload)) {
  const { overlayLayer } = reviewElements();
  if (!overlayLayer) return;
  const items = Array.isArray(renderPayload?.overlay_layers) ? renderPayload.overlay_layers : [];
  overlayLayer.innerHTML = items.map((item) => {
    const position = mapPointToStagePercent(item.anchor_x, item.anchor_y, renderPayload, geometry);
    const size = mapSizeToStagePercent(item.width, item.height, renderPayload, geometry);
    const previewScale = layerPreviewScale(item?.scale_with_zoom !== false);
    return `
      <div class="review-overlay-item" data-scale-with-zoom="${item?.scale_with_zoom !== false ? "true" : "false"}" style="left:${position.left}%;top:${position.top}%;width:${size.width}%;height:${size.height}%;--review-overlay-scale:${previewScale}">
        <img src="${escapeHtml(item.asset_url || "")}" alt="${escapeHtml(item.overlay_id || "overlay")}" />
      </div>
    `;
  }).join("");
}

function renderLabelLayer(renderPayload, geometry = currentGeometry(renderPayload)) {
  const { labelLayer } = reviewElements();
  if (!labelLayer) return;
  const items = Array.isArray(renderPayload?.label_layer?.items) ? renderPayload.label_layer.items : [];
  labelLayer.innerHTML = items.map((item) => {
    const text = labelText(item);
    if (!text) return "";
    const offset = localeOffset(item);
    const position = mapPointToStagePercent(
      Number(item.anchor_x || 0) + Number(offset.dx || 0),
      Number(item.anchor_y || 0) + Number(offset.dy || 0),
      renderPayload,
      geometry
    );
    const style = item?.style && typeof item.style === "object" ? item.style : {};
    const previewScale = layerPreviewScale(style?.scale_with_zoom !== false, style?.zoom_scale);
    const sizePreset = String(style?.size_preset || "m").trim().toLowerCase();
    const fontSize = sizePreset === "s" ? 11 : sizePreset === "l" ? 15 : 13;
    return `
      <div class="review-label-item" data-scale-with-zoom="${style?.scale_with_zoom !== false ? "true" : "false"}" data-zoom-min="${Number(style?.zoom_scale?.min ?? ZOOM_SCALE_RANGE.min)}" data-zoom-base="${Number(style?.zoom_scale?.base ?? ZOOM_SCALE_RANGE.base)}" data-zoom-max="${Number(style?.zoom_scale?.max ?? ZOOM_SCALE_RANGE.max)}" style="left:${position.left}%;top:${position.top}%;font-family:${escapeHtml(style.font_family || "Noto Sans Thai")};font-size:${fontSize}px;color:${escapeHtml(style.text_color || "#243041")};--review-label-scale:${previewScale}">
        <span>${escapeHtml(text)}</span>
      </div>
    `;
  }).join("");
}

function refreshLayerScales() {
  const { overlayLayer, labelLayer } = reviewElements();
  overlayLayer?.querySelectorAll(".review-overlay-item").forEach((node) => {
    const scaleWithZoom = node.dataset.scaleWithZoom !== "false";
    node.style.setProperty("--review-overlay-scale", String(layerPreviewScale(scaleWithZoom)));
  });
  labelLayer?.querySelectorAll(".review-label-item").forEach((node) => {
    const scaleWithZoom = node.dataset.scaleWithZoom !== "false";
    node.style.setProperty("--review-label-scale", String(layerPreviewScale(scaleWithZoom, {
      min: Number(node.dataset.zoomMin || ZOOM_SCALE_RANGE.min),
      base: Number(node.dataset.zoomBase || ZOOM_SCALE_RANGE.base),
      max: Number(node.dataset.zoomMax || ZOOM_SCALE_RANGE.max),
    })));
  });
}

function scheduleZoomRender() {
  if (state.zoomRenderTimer) {
    window.clearTimeout(state.zoomRenderTimer);
  }
  state.zoomRenderTimer = window.setTimeout(() => {
    state.zoomRenderTimer = 0;
    renderMap();
  }, 120);
}

function flushZoomRender() {
  if (state.zoomRenderTimer) {
    window.clearTimeout(state.zoomRenderTimer);
    state.zoomRenderTimer = 0;
  }
  renderMap();
}

function zoom(delta) {
  state.view.scale = clampScale(Number(state.view.scale || 1) + Number(delta || 0));
  if (state.view.scale === 1) {
    state.view.offsetX = 0;
    state.view.offsetY = 0;
  }
  updateViewportTransform();
  refreshLayerScales();
  scheduleZoomRender();
}

function projectPoint(point, map, geometry = currentGeometry(map)) {
  return projectBoundsPointToStagePercent(
    point,
    map?.bounds || activeRenderPayload()?.bounds || {},
    geometry?.stageRect,
    geometry?.baseRect
  );
}

function routePathPoints(detail, map, geometry = currentGeometry(map)) {
  const raw = Array.isArray(detail?.resolved_path) && detail.resolved_path.length
    ? detail.resolved_path
    : Array.isArray(detail?.control_points) ? detail.control_points : [];
  return raw.map((point) => projectPoint(point, map, geometry)).filter(Boolean);
}

function renderMap() {
  const { image, empty, overlay, overlayLayer, labelLayer } = reviewElements();
  if (!image || !empty || !overlay || !overlayLayer || !labelLayer) return;
  const selected = selectedRoutes();
  const map = activeBaseMap();
  const renderPayload = activeRenderPayload();
  const statusNodeId = state.statusNodeId || "review-status";
  if (typeof state.onActiveBaseMapChange === "function") state.onActiveBaseMapChange(map);

  if (!map || !renderPayload) {
    image.hidden = true;
    image.removeAttribute("src");
    overlayLayer.innerHTML = "";
    labelLayer.innerHTML = "";
    overlay.innerHTML = "";
    empty.hidden = false;
    setBanner(statusNodeId, "");
    return;
  }

  if (!String(renderPayload.base_layer_url || "").trim()) {
    image.hidden = true;
    image.removeAttribute("src");
    overlayLayer.innerHTML = "";
    labelLayer.innerHTML = "";
    overlay.innerHTML = "";
    empty.hidden = false;
    setBanner(statusNodeId, "The latest annotation map is not ready for display yet.", true);
    return;
  }

  invalidateGeometryCache();
  const geometry = currentGeometry(renderPayload);
  image.hidden = false;
  image.src = String(renderPayload.base_layer_url || "").trim();
  renderOverlayLayer(renderPayload, geometry);
  renderLabelLayer(renderPayload, geometry);
  empty.hidden = selected.length > 0;
  overlay.innerHTML = selected
    .map((route) => {
      const detail = state.routeDetails.get(Number(route?.id || 0) || 0) || route;
      const points = routePathPoints(detail, renderPayload, geometry);
      if (points.length < 2) return "";
      const polylinePoints = points.map((point) => `${point.left},${point.top}`).join(" ");
      const stroke = escapeHtml(route?.color || "#ff6600");
      return `<polyline points="${polylinePoints}" fill="none" stroke="${stroke}" stroke-width="${routeStrokeWidth()}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
    })
    .join("");
  setBanner(statusNodeId, "");
}

async function loadRouteDetails(ids = []) {
  const requested = ids
    .map((id) => Number(id || 0) || 0)
    .filter(Boolean);
  if (!requested.length) {
    state.routeDetails.clear();
    return;
  }
  const requestedSet = new Set(requested);
  for (const cachedId of Array.from(state.routeDetails.keys())) {
    if (!requestedSet.has(cachedId)) {
      state.routeDetails.delete(cachedId);
    }
  }
  const details = await Promise.all(requested.map((id) => api(`/api/v2/transport/routes/${id}`)));
  details.forEach((detail) => {
    const routeId = Number(detail?.id || 0) || 0;
    if (routeId) state.routeDetails.set(routeId, detail);
  });
}

async function refreshView() {
  renderSelector();
  renderMap();
  const token = ++state.detailRequestToken;
  await loadRouteDetails(state.selectedIds);
  if (token !== state.detailRequestToken) return;
  renderMap();
}

function bindEvents() {
  if (state.initialized) return;
  const { stage, selectorList } = reviewElements();
  selectorList?.addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"][data-route-id]');
    if (!checkbox) return;
    toggleSelection(checkbox.dataset.routeId, checkbox.checked);
    refreshView().catch((error) => {
      setBanner(state.statusNodeId || "review-status", error.message || "Failed to refresh review", true);
    });
  });
  stage?.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.2 : -0.2);
  }, { passive: false });
  stage?.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, input, label, select, textarea, a")) {
      return;
    }
    event.preventDefault();
    state.view.panning = true;
    state.view.startX = Number(event.clientX || 0);
    state.view.startY = Number(event.clientY || 0);
    updateViewportTransform();
  });
  window.addEventListener("pointermove", (event) => {
    if (!state.view.panning) return;
    event.preventDefault();
    state.view.offsetX += Number(event.clientX || 0) - Number(state.view.startX || 0);
    state.view.offsetY += Number(event.clientY || 0) - Number(state.view.startY || 0);
    state.view.startX = Number(event.clientX || 0);
    state.view.startY = Number(event.clientY || 0);
    updateViewportTransform();
  });
  window.addEventListener("pointerup", () => {
    if (!state.view.panning) return;
    state.view.panning = false;
    updateViewportTransform();
    flushZoomRender();
  });
  window.addEventListener("pointercancel", () => {
    if (!state.view.panning) return;
    state.view.panning = false;
    updateViewportTransform();
    flushZoomRender();
  });
  window.addEventListener("resize", () => {
    invalidateGeometryCache();
    renderMap();
  });
  document.getElementById("btn-review-zoom-in")?.addEventListener("click", () => { zoom(0.2); });
  document.getElementById("btn-review-zoom-out")?.addEventListener("click", () => { zoom(-0.2); });
  document.getElementById("btn-review-reset-view")?.addEventListener("click", () => { resetView(); });
  state.initialized = true;
}

export async function mountRoutesReview(options = {}) {
  state.routes = Array.isArray(options.routes) ? options.routes : [];
  state.baseMaps = Array.isArray(options.baseMaps) ? options.baseMaps : [];
  state.selectedIds = Array.isArray(options.selectedRouteIds)
    ? options.selectedRouteIds.map((id) => Number(id || 0) || 0).filter(Boolean)
    : [];
  state.onSelectionChange = typeof options.onSelectionChange === "function" ? options.onSelectionChange : null;
  state.onActiveBaseMapChange = typeof options.onActiveBaseMapChange === "function" ? options.onActiveBaseMapChange : null;
  state.statusNodeId = String(options.statusNodeId || "review-status");
  bindEvents();
  if (!state.hasMounted) {
    resetView();
    state.hasMounted = true;
  } else {
    updateViewportTransform();
  }
  await refreshView();
}
