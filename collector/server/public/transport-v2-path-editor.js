import { api, setBanner } from "./transport-v2-common.js";
import {
  computeBaseRenderedImageRect,
  computeRenderedImageRect,
  mapPointToStagePercent as mapPointToStagePercentShared,
  mapSizeToStagePercent as mapSizeToStagePercentShared,
  projectBoundsPointToStagePercent,
} from "./transport-v2-map-geometry.js";

const state = {
  route: null,
  baseMaps: [],
  onRouteMutated: null,
  controlPoints: [],
  selectedIndex: -1,
  mode: "draw",
  draggingIndex: -1,
  suppressStageClick: false,
  renderFrame: 0,
  zoomRenderTimer: 0,
  mapRectCache: null,
  geometryCache: {
    revision: 0,
    stageRect: null,
    baseRect: null,
  },
  mapView: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    panning: false,
    startX: 0,
    startY: 0,
  },
};

const ZOOM_SCALE_RANGE = {
  min: 0.9,
  base: 1,
  max: 1.15,
};

function elements() {
  return {
    stage: document.getElementById("path-editor-map-stage"),
    empty: document.getElementById("path-editor-map-empty"),
    viewport: document.getElementById("path-editor-map-viewport"),
    image: document.getElementById("path-editor-map-image"),
    overlayLayer: document.getElementById("path-editor-map-overlay-layer"),
    labelLayer: document.getElementById("path-editor-map-label-layer"),
    overlay: document.getElementById("path-editor-map-overlay"),
    markers: document.getElementById("path-editor-map-markers"),
  };
}

function normalizePoint(point, index = 0) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    order: index,
    lat,
    lng,
    label: String(point?.label || "").trim(),
    note: String(point?.note || "").trim(),
  };
}

function normalizeControlPoints(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizePoint)
    .filter(Boolean)
    .map((item, index) => ({ ...item, order: index }));
}

function latestWorkspaceBaseMap() {
  const items = Array.isArray(state.baseMaps) ? state.baseMaps : [];
  return items.find((item) => ["ready", "active", "published", "reviewed"].includes(String(item?.status || "").trim().toLowerCase()))
    || items[0]
    || null;
}

function currentBaseMap() {
  return latestWorkspaceBaseMap();
}

function currentRenderPayload() {
  return currentBaseMap()?.annotation_render_payload || null;
}

function invalidateGeometryCache() {
  state.geometryCache.revision = 0;
  state.geometryCache.stageRect = null;
  state.geometryCache.baseRect = null;
}

function currentGeometry(renderPayload = currentRenderPayload()) {
  const revision = Number(renderPayload?.revision || 0) || 0;
  if (state.geometryCache.stageRect && state.geometryCache.baseRect && state.geometryCache.revision === revision) {
    return state.geometryCache;
  }
  const currentStageRect = elements().stage?.getBoundingClientRect?.() || null;
  const baseRect = currentStageRect && renderPayload
    ? computeBaseRenderedImageRect(currentStageRect, renderPayload.viewbox)
    : null;
  state.geometryCache = {
    revision,
    stageRect: currentStageRect,
    baseRect,
  };
  return state.geometryCache;
}

function stageRect() {
  return currentGeometry().stageRect;
}

function baseRenderedImageRect() {
  return currentGeometry().baseRect;
}

function setMode(mode) {
  state.mode = mode === "select" ? "select" : "draw";
  document.getElementById("btn-path-mode-select")?.classList.toggle("active", state.mode === "select");
  document.getElementById("btn-path-mode-draw")?.classList.toggle("active", state.mode === "draw");
  updateViewportTransform();
}

function clampScale(scale) {
  return Math.max(1, Math.min(8, Number(scale) || 1));
}

function zoomAssetMultiplier(viewportScale = state.mapView.scale) {
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

function zoomAssetMultiplierForConfig(zoomScale, viewportScale = state.mapView.scale) {
  const config = normalizeZoomScaleConfig(zoomScale);
  const scale = Math.max(Number(viewportScale) || 1, 0.25);
  if (scale <= 1) {
    return config.min + ((config.base - config.min) * scale);
  }
  const progress = Math.max(0, Math.min(1, (scale - 1) / 7));
  return config.base + ((config.max - config.base) * progress);
}

function pointPreviewScale() {
  const viewportScale = Math.max(Number(state.mapView.scale || 1), 1);
  return zoomAssetMultiplier(viewportScale) / viewportScale;
}

function routeStrokeWidth() {
  return (1.2 * zoomAssetMultiplier(state.mapView.scale)).toFixed(2);
}

function layerPreviewScale(scaleWithZoom = true, zoomScale = ZOOM_SCALE_RANGE) {
  const viewportScale = Math.max(Number(state.mapView.scale || 1), 1);
  if (!scaleWithZoom) {
    return 1 / viewportScale;
  }
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

function mapPointToStagePercent(anchorX, anchorY, renderPayload) {
  const geometry = currentGeometry(renderPayload);
  return mapPointToStagePercentShared(
    anchorX,
    anchorY,
    renderPayload?.viewbox,
    geometry?.stageRect,
    geometry?.baseRect
  );
}

function mapSizeToStagePercent(widthValue, heightValue, renderPayload) {
  const geometry = currentGeometry(renderPayload);
  return mapSizeToStagePercentShared(
    widthValue,
    heightValue,
    renderPayload?.viewbox,
    geometry?.stageRect,
    geometry?.baseRect
  );
}

function updateViewportTransform() {
  const { stage, viewport } = elements();
  if (!stage || !viewport) return;
  viewport.style.transform = `translate(${Number(state.mapView.offsetX || 0)}px, ${Number(state.mapView.offsetY || 0)}px) scale(${Number(state.mapView.scale || 1)})`;
  viewport.classList.toggle("is-dragging", Boolean(state.mapView.panning));
  stage.classList.toggle("mode-select", state.mode === "select");
  stage.classList.toggle("is-panning", Boolean(state.mapView.panning));
  state.mapRectCache = null;
}

function resetView() {
  state.mapView.scale = 1;
  state.mapView.offsetX = 0;
  state.mapView.offsetY = 0;
  state.mapView.panning = false;
  updateViewportTransform();
  flushZoomRender();
}

function zoom(delta) {
  state.mapView.scale = clampScale(Number(state.mapView.scale || 1) + Number(delta || 0));
  if (state.mapView.scale === 1) {
    state.mapView.offsetX = 0;
    state.mapView.offsetY = 0;
  }
  updateViewportTransform();
  refreshLayerScales();
  syncMarkerNodes(false);
  scheduleZoomRender();
}

function renderedImageRect() {
  if (state.mapRectCache) return state.mapRectCache;
  const renderPayload = currentRenderPayload();
  const geometry = currentGeometry(renderPayload);
  if (!geometry?.stageRect || !renderPayload) return null;
  state.mapRectCache = computeRenderedImageRect(geometry.stageRect, renderPayload.viewbox, state.mapView);
  return state.mapRectCache;
}

function projectPoint(point) {
  const renderPayload = currentRenderPayload();
  if (!renderPayload) return null;
  const geometry = currentGeometry(renderPayload);
  return projectBoundsPointToStagePercent(point, renderPayload.bounds || {}, geometry?.stageRect, geometry?.baseRect);
}

function clientToLatLng(clientX, clientY) {
  const renderPayload = currentRenderPayload();
  const rect = renderedImageRect();
  if (!renderPayload || !rect) throw new Error("The annotation map is not ready yet.");
  const localX = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const localY = Math.max(0, Math.min(clientY - rect.top, rect.height));
  const lat = Number(renderPayload.bounds.max_lat) - (localY / rect.height) * (Number(renderPayload.bounds.max_lat) - Number(renderPayload.bounds.min_lat));
  const lng = Number(renderPayload.bounds.min_lng) + (localX / rect.width) * (Number(renderPayload.bounds.max_lng) - Number(renderPayload.bounds.min_lng));
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  };
}

function renderOverlayLayer(renderPayload) {
  const { overlayLayer } = elements();
  if (!overlayLayer) return;
  const items = Array.isArray(renderPayload?.overlay_layers) ? renderPayload.overlay_layers : [];
  overlayLayer.innerHTML = items.map((item) => {
    const position = mapPointToStagePercent(item.anchor_x, item.anchor_y, renderPayload);
    const size = mapSizeToStagePercent(item.width, item.height, renderPayload);
    const previewScale = layerPreviewScale(item?.scale_with_zoom !== false);
    return `
      <div class="path-editor-overlay-item" data-scale-with-zoom="${item?.scale_with_zoom !== false ? "true" : "false"}" style="left:${position.left}%;top:${position.top}%;width:${size.width}%;height:${size.height}%;--path-overlay-scale:${previewScale}">
        <img src="${escapeHtml(item.asset_url || "")}" alt="${escapeHtml(item.overlay_id || "overlay")}" />
      </div>
    `;
  }).join("");
}

function renderLabelLayer(renderPayload) {
  const { labelLayer } = elements();
  if (!labelLayer) return;
  const items = Array.isArray(renderPayload?.label_layer?.items) ? renderPayload.label_layer.items : [];
  labelLayer.innerHTML = items.map((item) => {
    const text = labelText(item);
    if (!text) return "";
    const offset = localeOffset(item);
    const position = mapPointToStagePercent(
      Number(item.anchor_x || 0) + Number(offset.dx || 0),
      Number(item.anchor_y || 0) + Number(offset.dy || 0),
      renderPayload
    );
    const style = item?.style && typeof item.style === "object" ? item.style : {};
    const previewScale = layerPreviewScale(style?.scale_with_zoom !== false, style?.zoom_scale);
    const sizePreset = String(style?.size_preset || "m").trim().toLowerCase();
    const fontSize = sizePreset === "s" ? 11 : sizePreset === "l" ? 15 : 13;
    return `
      <div class="path-editor-label-item" data-scale-with-zoom="${style?.scale_with_zoom !== false ? "true" : "false"}" data-zoom-min="${Number(style?.zoom_scale?.min ?? ZOOM_SCALE_RANGE.min)}" data-zoom-base="${Number(style?.zoom_scale?.base ?? ZOOM_SCALE_RANGE.base)}" data-zoom-max="${Number(style?.zoom_scale?.max ?? ZOOM_SCALE_RANGE.max)}" style="left:${position.left}%;top:${position.top}%;font-family:${escapeHtml(style.font_family || "Noto Sans Thai")};font-size:${fontSize}px;color:${escapeHtml(style.text_color || "#243041")};--path-label-scale:${previewScale}">
        <span>${escapeHtml(text)}</span>
      </div>
    `;
  }).join("");
}

function refreshLayerScales() {
  const { overlayLayer, labelLayer } = elements();
  overlayLayer?.querySelectorAll(".path-editor-overlay-item").forEach((node) => {
    const scaleWithZoom = node.dataset.scaleWithZoom !== "false";
    node.style.setProperty("--path-overlay-scale", String(layerPreviewScale(scaleWithZoom)));
  });
  labelLayer?.querySelectorAll(".path-editor-label-item").forEach((node) => {
    const scaleWithZoom = node.dataset.scaleWithZoom !== "false";
    node.style.setProperty("--path-label-scale", String(layerPreviewScale(scaleWithZoom, {
      min: Number(node.dataset.zoomMin || ZOOM_SCALE_RANGE.min),
      base: Number(node.dataset.zoomBase || ZOOM_SCALE_RANGE.base),
      max: Number(node.dataset.zoomMax || ZOOM_SCALE_RANGE.max),
    })));
  });
}

function scheduleZoomRender() {
  if (state.draggingIndex >= 0 || state.mapView.panning) return;
  if (state.zoomRenderTimer) {
    window.clearTimeout(state.zoomRenderTimer);
  }
  state.zoomRenderTimer = window.setTimeout(() => {
    state.zoomRenderTimer = 0;
    renderScene(false);
  }, 120);
}

function flushZoomRender() {
  if (state.zoomRenderTimer) {
    window.clearTimeout(state.zoomRenderTimer);
    state.zoomRenderTimer = 0;
  }
  renderScene(false);
}

function polylinePoints() {
  return state.controlPoints
    .map((point) => projectPoint(point))
    .filter(Boolean)
    .map((point) => `${point.left},${point.top}`)
    .join(" ");
}

function ensurePolylineElement() {
  const { overlay } = elements();
  if (!overlay) return null;
  let polyline = overlay.querySelector("polyline");
  if (!polyline) {
    overlay.innerHTML = `<polyline fill="none" stroke="${state.route?.color || "#1954d1"}" stroke-width="${routeStrokeWidth()}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
    polyline = overlay.querySelector("polyline");
  }
  if (polyline) {
    polyline.setAttribute("stroke", String(state.route?.color || "#1954d1"));
    polyline.setAttribute("stroke-width", routeStrokeWidth());
  }
  return polyline;
}

function updatePolyline() {
  const polyline = ensurePolylineElement();
  if (!polyline) return;
  const points = polylinePoints();
  if (points) polyline.setAttribute("points", points);
  else polyline.removeAttribute("points");
}

function markerButtonMarkup(index) {
  return `<button type="button" class="path-editor-point" data-point-index="${index}"></button>`;
}

function syncMarkerNodes(forceRebuild = false) {
  const { markers } = elements();
  if (!markers) return;
  if (forceRebuild || markers.children.length !== state.controlPoints.length) {
    markers.innerHTML = state.controlPoints.map((_point, index) => markerButtonMarkup(index)).join("");
  }
  const previewScale = pointPreviewScale();
  Array.from(markers.children).forEach((node, index) => {
    const point = projectPoint(state.controlPoints[index]);
    if (!point) {
      node.remove();
      return;
    }
    node.style.left = `${point.left}%`;
    node.style.top = `${point.top}%`;
    node.style.setProperty("--path-point-scale", String(previewScale));
    node.classList.toggle("is-selected", index === state.selectedIndex);
    node.dataset.pointIndex = String(index);
  });
}

function scheduleOverlayRefresh() {
  if (state.renderFrame) return;
  state.renderFrame = window.requestAnimationFrame(() => {
    state.renderFrame = 0;
    updatePolyline();
    syncMarkerNodes(false);
  });
}

function cancelOverlayRefresh() {
  if (!state.renderFrame) return;
  window.cancelAnimationFrame(state.renderFrame);
  state.renderFrame = 0;
}

function renderScene(forceRebuildMarkers = false) {
  const { image, empty, overlay, markers, overlayLayer, labelLayer } = elements();
  if (!image || !empty || !overlay || !markers || !overlayLayer || !labelLayer) return;
  const map = currentBaseMap();
  const renderPayload = currentRenderPayload();
  if (!state.route || !map || !renderPayload || !String(renderPayload.base_layer_url || "").trim()) {
    image.hidden = true;
    image.removeAttribute("src");
    empty.hidden = false;
    overlayLayer.innerHTML = "";
    labelLayer.innerHTML = "";
    overlay.innerHTML = "";
    markers.innerHTML = "";
    updateViewportTransform();
    if (state.route && map && (!renderPayload || !String(renderPayload.base_layer_url || "").trim())) {
      setBanner("path-editor-status", "Render Annotation Map in Base Map Annotation Workspace before opening the path editor.", true);
    }
    return;
  }
  invalidateGeometryCache();
  currentGeometry(renderPayload);
  image.hidden = false;
  image.src = String(renderPayload.base_layer_url || "").trim();
  renderOverlayLayer(renderPayload);
  renderLabelLayer(renderPayload);
  empty.hidden = true;
  updatePolyline();
  syncMarkerNodes(forceRebuildMarkers);
  updateViewportTransform();
  setBanner("path-editor-status", "");
}

function addPoint(clientX, clientY) {
  state.controlPoints = normalizeControlPoints([...state.controlPoints, clientToLatLng(clientX, clientY)]);
  state.selectedIndex = state.controlPoints.length - 1;
  renderScene(true);
}

function updatePoint(index, clientX, clientY) {
  if (index < 0 || index >= state.controlPoints.length) return;
  const nextPoint = clientToLatLng(clientX, clientY);
  state.controlPoints[index] = {
    ...state.controlPoints[index],
    ...nextPoint,
    order: index,
  };
  state.selectedIndex = index;
  scheduleOverlayRefresh();
}

function removeSelected() {
  if (state.selectedIndex < 0) return;
  state.controlPoints = normalizeControlPoints(state.controlPoints.filter((_point, index) => index !== state.selectedIndex));
  state.selectedIndex = -1;
  renderScene(true);
}

function bindEvents() {
  const { stage, markers } = elements();
  document.getElementById("btn-path-mode-select")?.addEventListener("click", () => { setMode("select"); });
  document.getElementById("btn-path-mode-draw")?.addEventListener("click", () => { setMode("draw"); });
  document.getElementById("btn-path-zoom-in")?.addEventListener("click", () => { zoom(0.2); });
  document.getElementById("btn-path-zoom-out")?.addEventListener("click", () => { zoom(-0.2); });
  document.getElementById("btn-path-reset-view")?.addEventListener("click", () => { resetView(); });
  document.getElementById("btn-path-remove-selected")?.addEventListener("click", () => { removeSelected(); });
  document.getElementById("btn-path-save")?.addEventListener("click", async () => {
    if (!state.route) return;
    try {
      setBanner("path-editor-status", "Saving raw points...");
      await api(`/api/v2/transport/routes/${state.route.id}/control-points`, {
        method: "PUT",
        body: JSON.stringify({ control_points: state.controlPoints }),
      });
      if (typeof state.onRouteMutated === "function") {
        await state.onRouteMutated({ routeId: state.route.id, reason: "save-control-points" });
      }
      setBanner("path-editor-status", "Saved raw points.");
    } catch (error) {
      setBanner("path-editor-status", error.message || "Save raw points failed", true);
    }
  });
  document.getElementById("btn-path-generate")?.addEventListener("click", async () => {
    if (!state.route) return;
    try {
      setBanner("path-editor-status", "Generating route...");
      await api(`/api/v2/transport/routes/${state.route.id}/control-points`, {
        method: "PUT",
        body: JSON.stringify({ control_points: state.controlPoints }),
      });
      await api(`/api/v2/transport/routes/${state.route.id}/resolve`, { method: "POST" });
      if (typeof state.onRouteMutated === "function") {
        await state.onRouteMutated({ routeId: state.route.id, reason: "generate-route" });
      }
      setBanner("path-editor-status", "Generated route.");
    } catch (error) {
      setBanner("path-editor-status", error.message || "Generate route failed", true);
    }
  });
  stage?.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.2 : -0.2);
  }, { passive: false });
  stage?.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-point-index]")) return;
    if (state.mode !== "select") return;
    event.preventDefault();
    state.mapView.panning = true;
    state.mapView.startX = Number(event.clientX || 0);
    state.mapView.startY = Number(event.clientY || 0);
    updateViewportTransform();
  });
  window.addEventListener("pointermove", (event) => {
    if (!state.mapView.panning) return;
    event.preventDefault();
    state.mapView.offsetX += Number(event.clientX || 0) - Number(state.mapView.startX || 0);
    state.mapView.offsetY += Number(event.clientY || 0) - Number(state.mapView.startY || 0);
    state.mapView.startX = Number(event.clientX || 0);
    state.mapView.startY = Number(event.clientY || 0);
    updateViewportTransform();
  });
  stage?.addEventListener("click", (event) => {
    try {
      if (state.suppressStageClick) {
        state.suppressStageClick = false;
        return;
      }
      if (event.target.closest("[data-point-index]")) return;
      if (state.mode === "select") {
        state.selectedIndex = -1;
        syncMarkerNodes(false);
        return;
      }
      addPoint(event.clientX, event.clientY);
      setBanner("path-editor-status", "Added raw point.");
    } catch (error) {
      setBanner("path-editor-status", error.message || "Add point failed", true);
    }
  });
  markers?.addEventListener("click", (event) => {
    const point = event.target.closest("[data-point-index]");
    if (!point) return;
    state.selectedIndex = Number(point.dataset.pointIndex || -1);
    syncMarkerNodes(false);
  });
  markers?.addEventListener("pointerdown", (event) => {
    const point = event.target.closest("[data-point-index]");
    if (!point || state.mode === "select") return;
    event.preventDefault();
    state.draggingIndex = Number(point.dataset.pointIndex || -1);
    state.suppressStageClick = true;
    updatePoint(state.draggingIndex, event.clientX, event.clientY);
  });
  window.addEventListener("pointermove", (event) => {
    if (state.draggingIndex < 0) return;
    event.preventDefault();
    updatePoint(state.draggingIndex, event.clientX, event.clientY);
  });
  window.addEventListener("pointerup", () => {
    const wasDragging = state.draggingIndex >= 0;
    state.draggingIndex = -1;
    if (state.mapView.panning) {
      state.mapView.panning = false;
      updateViewportTransform();
      flushZoomRender();
      return;
    }
    if (wasDragging) flushZoomRender();
  });
  window.addEventListener("pointercancel", () => {
    const wasDragging = state.draggingIndex >= 0;
    state.draggingIndex = -1;
    if (state.mapView.panning) {
      state.mapView.panning = false;
      updateViewportTransform();
      flushZoomRender();
      return;
    }
    if (wasDragging) flushZoomRender();
  });
  window.addEventListener("resize", () => {
    invalidateGeometryCache();
    state.mapRectCache = null;
    renderScene(false);
  });
}

let bound = false;

export async function mountPathEditor(options = {}) {
  state.baseMaps = Array.isArray(options.baseMaps) ? options.baseMaps : [];
  state.onRouteMutated = typeof options.onRouteMutated === "function" ? options.onRouteMutated : null;
  const routeId = Number(options.routeId || 0) || 0;
  cancelOverlayRefresh();
  if (!bound) {
    bindEvents();
    bound = true;
  }
  if (!routeId) {
    state.route = null;
    state.controlPoints = [];
    state.selectedIndex = -1;
    renderScene(true);
    setBanner("path-editor-status", "");
    return;
  }
  const route = await api(`/api/v2/transport/routes/${routeId}`);
  state.route = route || null;
  state.controlPoints = normalizeControlPoints(route?.control_points || []);
  state.selectedIndex = -1;
  setMode("draw");
  resetView();
  renderScene(true);
  setBanner("path-editor-status", "");
}
