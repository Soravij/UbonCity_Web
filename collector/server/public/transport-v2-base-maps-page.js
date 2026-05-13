import { api, escapeHtml, qs, requireAdminShell, setBanner } from "./transport-v2-common.js";
import {
  computeBaseRenderedImageRect,
  computeRenderedImageRect,
  mapPointToStagePercent as mapPointToStagePercentShared,
  mapSizeToStagePercent as mapSizeToStagePercentShared,
} from "./transport-v2-map-geometry.js";

const DEFAULT_BOUNDS = {
  min_lat: 15.1083,
  min_lng: 104.8068,
  max_lat: 15.3117,
  max_lng: 104.9720,
};

const DEFAULT_VIEWBOX = {
  x: 0,
  y: 0,
  width: 4000,
  height: 5600,
};

const GENERATED_BASE_MAP_R1 = {
  key: "ubon-city-base-map-v1",
  title: "Ubon City Base Map V1",
  status: "draft",
  projection_type: "linear-bbox-fit",
  bounds: {
    min_lat: 15.1083,
    min_lng: 104.8068,
    max_lat: 15.3117,
    max_lng: 104.9720,
  },
  viewbox: {
    x: 0,
    y: 0,
    width: 4000,
    height: 5600,
  },
};

const KNOWN_LABEL_CATEGORIES = [
  "landmark",
  "district",
  "terminal",
  "stop",
  "pier",
  "warning",
];

const DEFAULT_LABEL_TARGET_LOCALES = ["en", "zh", "lo"];
const DEFAULT_LABEL_STYLE = {
  global: {
    font_family: "Noto Sans Thai",
    text_color: "#243041",
    size_preset: "m",
    scale_with_zoom: true,
    zoom_scale: {
      min: 0.9,
      base: 1,
      max: 1.15,
    },
  },
  categories: {},
};
const LABEL_PRESET_FONT_SIZES = { s: 11, m: 13, l: 15 };
const BASE_MAP_SELECTION_STORAGE_KEY = "transport_v2_base_map_selection";
const BASE_MAP_EDITOR_DRAFT_STORAGE_PREFIX = "transport_v2_base_map_editor_draft_v1";
const LABEL_DRAG_THRESHOLD_PX = 6;

const state = {
  baseMaps: [],
  labelLayouts: [],
  selectedBaseMapId: 0,
  selectedLabelLayoutId: 0,
  selectedLabelKey: "",
  selectedLabelReviewLocale: "en",
  selectedOverlayId: "",
  draggingLabelKey: "",
  pendingLabelDragKey: "",
  draggingOverlayId: "",
  suppressStageClick: false,
  labelDragPointer: {
    startX: 0,
    startY: 0,
    anchorStartX: 0,
    anchorStartY: 0,
    currentX: null,
    currentY: null,
  },
  overlayDragPointer: {
    startX: 0,
    startY: 0,
    anchorStartX: 0,
    anchorStartY: 0,
    currentX: null,
    currentY: null,
  },
  draggingLabelElement: null,
  draggingLabelItem: null,
  draggingLabelLocaleOffset: { dx: 0, dy: 0 },
  draggingOverlayElement: null,
  draggingOverlayItem: null,
  hydratingBaseMapEditor: false,
  initialSnapshot: "",
  generatedPreview: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    startX: 0,
    startY: 0,
  },
  mapView: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    panning: false,
    didPan: false,
    startX: 0,
    startY: 0,
    rafId: 0,
    panMaxOffsetX: null,
    panMaxOffsetY: null,
    zoomRenderTimer: 0,
  },
};

function approximatelyEqualNumber(left, right) {
  return Math.abs((Number(left) || 0) - (Number(right) || 0)) < 0.0001;
}

function matchesGeneratedBaseMapCandidate(item) {
  if (!item) return false;
  return String(item?.key || "").trim() === GENERATED_BASE_MAP_R1.key
    && String(item?.projection_type || "").trim() === GENERATED_BASE_MAP_R1.projection_type
    && approximatelyEqualNumber(item?.bounds?.min_lat, GENERATED_BASE_MAP_R1.bounds.min_lat)
    && approximatelyEqualNumber(item?.bounds?.min_lng, GENERATED_BASE_MAP_R1.bounds.min_lng)
    && approximatelyEqualNumber(item?.bounds?.max_lat, GENERATED_BASE_MAP_R1.bounds.max_lat)
    && approximatelyEqualNumber(item?.bounds?.max_lng, GENERATED_BASE_MAP_R1.bounds.max_lng)
    && approximatelyEqualNumber(item?.viewbox?.x, GENERATED_BASE_MAP_R1.viewbox.x)
    && approximatelyEqualNumber(item?.viewbox?.y, GENERATED_BASE_MAP_R1.viewbox.y)
    && approximatelyEqualNumber(item?.viewbox?.width, GENERATED_BASE_MAP_R1.viewbox.width)
    && approximatelyEqualNumber(item?.viewbox?.height, GENERATED_BASE_MAP_R1.viewbox.height);
}

function latestGeneratedBaseMap(items = state.baseMaps) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => matchesGeneratedBaseMapCandidate(item))
    .sort((left, right) => {
      const leftCreated = String(left?.created_at || "");
      const rightCreated = String(right?.created_at || "");
      if (leftCreated !== rightCreated) return rightCreated.localeCompare(leftCreated);
      return Number(right?.id || 0) - Number(left?.id || 0);
    })[0] || null;
}

function syncGeneratedCandidateSummary() {
  const generated = latestGeneratedBaseMap(state.baseMaps);
  const image = qs("generated-base-map-image");
  const link = qs("generated-base-map-open-link");
  if (image) {
    if (generated?.candidate_map_url) {
      image.hidden = false;
      image.src = generated.candidate_map_url;
    } else {
      image.hidden = true;
      image.removeAttribute("src");
    }
  }
  if (link) {
    if (generated?.candidate_map_url) {
      link.hidden = false;
      link.href = generated.candidate_map_url;
      link.setAttribute("aria-disabled", "false");
    } else {
      link.hidden = true;
      link.href = "#";
      link.setAttribute("aria-disabled", "true");
    }
  }
  resetGeneratedPreview();
}

function persistedBaseMapSelection() {
  try {
    return Number(sessionStorage.getItem(BASE_MAP_SELECTION_STORAGE_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

function persistBaseMapSelection(id) {
  try {
    const value = Number(id || 0) || 0;
    if (value > 0) {
      sessionStorage.setItem(BASE_MAP_SELECTION_STORAGE_KEY, String(value));
    } else {
      sessionStorage.removeItem(BASE_MAP_SELECTION_STORAGE_KEY);
    }
  } catch {
    // no-op
  }
}

function baseMapDraftSelectionKey(id = state.selectedBaseMapId) {
  const value = Number(id || 0) || 0;
  return value > 0 ? `map:${value}` : "new";
}

function baseMapDraftStorageKey(selectionKey = baseMapDraftSelectionKey()) {
  return `${BASE_MAP_EDITOR_DRAFT_STORAGE_PREFIX}:${selectionKey}`;
}

function loadBaseMapEditorDraft(selectionKey = baseMapDraftSelectionKey()) {
  try {
    const raw = localStorage.getItem(baseMapDraftStorageKey(selectionKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function clearBaseMapEditorDraft(selectionKey = baseMapDraftSelectionKey()) {
  try {
    localStorage.removeItem(baseMapDraftStorageKey(selectionKey));
  } catch {
    // no-op
  }
}

function preferredBaseMapSelection(items = state.baseMaps) {
  const generated = latestGeneratedBaseMap(items);
  if (generated) return Number(generated.id || 0) || 0;
  const persisted = persistedBaseMapSelection();
  if (persisted && (Array.isArray(items) ? items : []).some((item) => Number(item?.id || 0) === persisted)) {
    return persisted;
  }
  return Number((Array.isArray(items) ? items[0]?.id : 0) || 0) || 0;
}

function deriveLabelCategoryFromKey(value) {
  const key = String(value || "").trim().toLowerCase();
  const prefix = key.split(".")[0] || "";
  return KNOWN_LABEL_CATEGORIES.includes(prefix) ? prefix : "custom";
}

function syncPlacementCategoryFromKey() {
  const keyInput = qs("placement-label-key");
  const categorySelect = qs("placement-label-category");
  if (!keyInput || !categorySelect) return;
  categorySelect.value = deriveLabelCategoryFromKey(keyInput.value);
}

function rewritePlacementKeyFromCategory() {
  const keyInput = qs("placement-label-key");
  const categorySelect = qs("placement-label-category");
  if (!keyInput || !categorySelect) return;
  const category = String(categorySelect.value || "").trim().toLowerCase();
  const rawKey = String(keyInput.value || "").trim();
  if (!rawKey || !category || category === "custom") return;
  const parts = rawKey.split(".");
  const suffix = parts.length > 1 ? parts.slice(1).join(".").trim() : rawKey;
  if (!suffix) return;
  keyInput.value = `${category}.${suffix}`;
}

function normalizeLocaleOffsetEntry(value) {
  const raw = value && typeof value === "object" ? value : {};
  const dx = Number(raw.dx);
  const dy = Number(raw.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  return {
    dx: Number(dx.toFixed(2)),
    dy: Number(dy.toFixed(2)),
  };
}

function normalizeLocaleOffsets(value) {
  const raw = value && typeof value === "object" ? value : {};
  const entries = Object.entries(raw)
    .map(([locale, offset]) => {
      const localeKey = String(locale || "").trim().toLowerCase();
      if (!localeKey) return null;
      const normalized = normalizeLocaleOffsetEntry(offset);
      if (!normalized) return null;
      return [localeKey, normalized];
    })
    .filter(Boolean);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeLabelItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((row, index) => ({
      label_key: String(row?.label_key || "").trim(),
      label_category: String(row?.label_category || "landmark").trim().toLowerCase() || "landmark",
      anchor_x: Number(row?.anchor_x),
      anchor_y: Number(row?.anchor_y),
      priority: Number(row?.priority ?? index) || 0,
      min_zoom_hint: row?.min_zoom_hint == null || row?.min_zoom_hint === "" ? null : Number(row.min_zoom_hint),
      ...(normalizeLocaleOffsets(row?.locale_offsets) ? { locale_offsets: normalizeLocaleOffsets(row?.locale_offsets) } : {}),
    }))
    .filter((row) => row.label_key && Number.isFinite(row.anchor_x) && Number.isFinite(row.anchor_y));
}

function normalizeOverlayItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((row, index) => {
      const assetId = Number(row?.asset_id || 0) || 0;
      const naturalWidth = Number(row?.natural_width || 0) || 0;
      const naturalHeight = Number(row?.natural_height || 0) || 0;
      const width = Number(row?.width || 0) || 0;
      const height = Number(row?.height || 0) || 0;
      const aspectRatio = naturalWidth > 0 && naturalHeight > 0
        ? naturalWidth / naturalHeight
        : (width > 0 && height > 0 ? width / height : 1);
      if (!assetId || !Number.isFinite(Number(row?.anchor_x)) || !Number.isFinite(Number(row?.anchor_y)) || !width || !height) {
        return null;
      }
      return {
        overlay_id: String(row?.overlay_id || `overlay_${index + 1}`).trim() || `overlay_${index + 1}`,
        kind: "image",
        asset_id: assetId,
        asset_url: String(row?.asset_url || "").trim(),
        anchor_x: Number(row.anchor_x),
        anchor_y: Number(row.anchor_y),
        width,
        height,
        natural_width: naturalWidth || width,
        natural_height: naturalHeight || height,
        aspect_ratio: Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1,
        scale_with_zoom: row?.scale_with_zoom == null ? true : Boolean(row.scale_with_zoom),
      };
    })
    .filter(Boolean);
}

function uniqueLocales(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeLabelDictionary(value) {
  const raw = value && typeof value === "object" ? value : {};
  const next = {};
  for (const [locale, entries] of Object.entries(raw)) {
    const localeKey = String(locale || "").trim().toLowerCase();
    if (!localeKey || !entries || typeof entries !== "object") continue;
    const normalizedEntries = Object.fromEntries(
      Object.entries(entries)
        .map(([labelKey, text]) => [String(labelKey || "").trim(), String(text || "").trim()])
        .filter(([labelKey, text]) => labelKey && text)
    );
    if (Object.keys(normalizedEntries).length) {
      next[localeKey] = normalizedEntries;
    }
  }
  if (!next.th) next.th = {};
  return next;
}

function normalizeLabelTranslationMeta(value, dictionary = normalizeLabelDictionary({})) {
  const raw = value && typeof value === "object" ? value : {};
  const targetLocales = uniqueLocales([
    ...DEFAULT_LABEL_TARGET_LOCALES,
    ...(Array.isArray(raw?.target_locales) ? raw.target_locales : []),
    ...Object.keys(dictionary).filter((locale) => locale !== "th"),
  ]).filter((locale) => locale !== "th");
  const localeStatuses = {};
  localeStatuses.th = { status: "source", reviewed: true };
  for (const locale of targetLocales) {
    const existing = raw?.locale_statuses?.[locale] && typeof raw.locale_statuses[locale] === "object"
      ? raw.locale_statuses[locale]
      : {};
    const hasText = Object.keys(dictionary?.[locale] || {}).length > 0;
    const status = String(existing.status || (hasText ? "translated" : "missing")).trim().toLowerCase() || "missing";
    localeStatuses[locale] = {
      status,
      reviewed: status === "reviewed" || Boolean(existing.reviewed),
      translated_at: existing.translated_at || null,
      translated_by: existing.translated_by || null,
      reviewed_at: existing.reviewed_at || null,
      reviewed_by: existing.reviewed_by || null,
    };
  }
  return {
    source_locale: "th",
    target_locales: targetLocales,
    locale_statuses: localeStatuses,
    last_translated_at: raw?.last_translated_at || null,
    last_translated_by: raw?.last_translated_by || null,
  };
}

function normalizeSizePreset(value) {
  const preset = String(value || "").trim().toLowerCase();
  return ["s", "m", "l"].includes(preset) ? preset : DEFAULT_LABEL_STYLE.global.size_preset;
}

function normalizeColorHex(value, fallback = DEFAULT_LABEL_STYLE.global.text_color) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const next = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(next) ? next.toLowerCase() : fallback;
}

function normalizeZoomScale(value, fallback = DEFAULT_LABEL_STYLE.global.zoom_scale) {
  const raw = value && typeof value === "object" ? value : {};
  const min = Number(raw.min);
  const base = Number(raw.base);
  const max = Number(raw.max);
  const nextMin = Number.isFinite(min) ? Math.max(0.5, Math.min(2, min)) : fallback.min;
  const nextBase = Number.isFinite(base) ? Math.max(0.5, Math.min(2, base)) : fallback.base;
  const nextMax = Number.isFinite(max) ? Math.max(0.5, Math.min(2, max)) : fallback.max;
  const sorted = [nextMin, nextBase, nextMax].sort((left, right) => left - right);
  return { min: sorted[0], base: sorted[1], max: sorted[2] };
}

function normalizeLabelStyleEntry(value, fallback = DEFAULT_LABEL_STYLE.global) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    font_family: String(raw.font_family || fallback.font_family || DEFAULT_LABEL_STYLE.global.font_family).trim() || DEFAULT_LABEL_STYLE.global.font_family,
    text_color: normalizeColorHex(raw.text_color, fallback.text_color || DEFAULT_LABEL_STYLE.global.text_color),
    size_preset: normalizeSizePreset(raw.size_preset || fallback.size_preset),
    scale_with_zoom: raw.scale_with_zoom == null ? Boolean(fallback.scale_with_zoom) : Boolean(raw.scale_with_zoom),
    zoom_scale: normalizeZoomScale(raw.zoom_scale, fallback.zoom_scale || DEFAULT_LABEL_STYLE.global.zoom_scale),
  };
}

function normalizeLabelStyleConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const global = normalizeLabelStyleEntry(raw.global, DEFAULT_LABEL_STYLE.global);
  const categoriesRaw = raw.categories && typeof raw.categories === "object" ? raw.categories : {};
  const categories = Object.fromEntries(
    Object.entries(categoriesRaw)
      .map(([key, entry]) => {
        const categoryKey = String(key || "").trim().toLowerCase();
        if (!categoryKey) return null;
        return [categoryKey, normalizeLabelStyleEntry(entry, global)];
      })
      .filter(Boolean)
  );
  return { global, categories };
}

function ensureSelectOption(select, value, text) {
  if (!select || !value) return;
  const normalizedValue = String(value);
  const existing = Array.from(select.options).find((option) => option.value === normalizedValue);
  for (const option of Array.from(select.options)) {
    if (option.dataset.dynamic === "true" && option.value !== normalizedValue) {
      option.remove();
    }
  }
  if (existing) return;
  const option = document.createElement("option");
  option.value = normalizedValue;
  option.textContent = text || normalizedValue;
  option.dataset.dynamic = "true";
  select.appendChild(option);
}

function currentLabelStyle() {
  const persisted = normalizeLabelStyleConfig(currentLabelLayout()?.metadata?.label_style || currentBaseMap()?.metadata?.label_style || DEFAULT_LABEL_STYLE);
  const fontNode = qs("label-style-font-family");
  const colorNode = qs("label-style-text-color");
  const sizeNode = qs("label-style-size-preset");
  const zoomNode = qs("label-style-scale-with-zoom");
  if (fontNode || colorNode || sizeNode || zoomNode) {
    return normalizeLabelStyleConfig({
      global: {
        ...persisted.global,
        font_family: fontNode?.value || persisted.global.font_family,
        text_color: colorNode?.value || persisted.global.text_color,
        size_preset: sizeNode?.value || persisted.global.size_preset,
        scale_with_zoom: zoomNode ? String(zoomNode.value || "true") !== "false" : persisted.global.scale_with_zoom,
      },
      categories: persisted.categories,
    });
  }
  return persisted;
}

function resolveLabelStyle(label) {
  const config = currentLabelStyle();
  const categoryKey = String(label?.label_category || "").trim().toLowerCase();
  return config.categories?.[categoryKey] || config.global;
}

function labelFontSizePx(style = DEFAULT_LABEL_STYLE.global) {
  return LABEL_PRESET_FONT_SIZES[normalizeSizePreset(style?.size_preset)] || LABEL_PRESET_FONT_SIZES.m;
}

function labelZoomMultiplier(style = DEFAULT_LABEL_STYLE.global, viewportScale = state.mapView.scale) {
  const zoomScale = normalizeZoomScale(style?.zoom_scale, DEFAULT_LABEL_STYLE.global.zoom_scale);
  const scale = Math.max(Number(viewportScale) || 1, 0.25);
  if (scale <= 1) {
    return zoomScale.min + ((zoomScale.base - zoomScale.min) * scale);
  }
  const progress = Math.max(0, Math.min(1, (scale - 1) / 7));
  return zoomScale.base + ((zoomScale.max - zoomScale.base) * progress);
}

function labelPreviewScale(style = DEFAULT_LABEL_STYLE.global) {
  const viewportScale = Math.max(Number(state.mapView.scale || 1), 1);
  if (!style?.scale_with_zoom) {
    return 1 / viewportScale;
  }
  return labelZoomMultiplier(style, viewportScale) / viewportScale;
}

function overlayPreviewScale(overlay) {
  const viewportScale = Math.max(Number(state.mapView.scale || 1), 1);
  if (!overlay?.scale_with_zoom) {
    return 1;
  }
  return labelZoomMultiplier(DEFAULT_LABEL_STYLE.global, viewportScale) / viewportScale;
}

function syncLabelStyleControls(styleConfig = currentLabelLayout()?.metadata?.label_style || currentBaseMap()?.metadata?.label_style || DEFAULT_LABEL_STYLE) {
  const normalized = normalizeLabelStyleConfig(styleConfig);
  const fontSelect = qs("label-style-font-family");
  const colorSelect = qs("label-style-text-color");
  const sizeSelect = qs("label-style-size-preset");
  const zoomSelect = qs("label-style-scale-with-zoom");
  ensureSelectOption(fontSelect, normalized.global.font_family, `Custom (${normalized.global.font_family})`);
  ensureSelectOption(colorSelect, normalized.global.text_color, `Custom (${normalized.global.text_color})`);
  if (fontSelect) fontSelect.value = normalized.global.font_family;
  if (colorSelect) colorSelect.value = normalized.global.text_color;
  if (sizeSelect) sizeSelect.value = normalized.global.size_preset;
  if (zoomSelect) zoomSelect.value = normalized.global.scale_with_zoom ? "true" : "false";
}

function previewFontSizeForZoom(style, zoomFactor) {
  const basePx = labelFontSizePx(style);
  if (!style?.scale_with_zoom) return basePx;
  return Math.round(basePx * zoomFactor * 10) / 10;
}

function renderLabelStylePreview() {
  const style = currentLabelStyle().global;
  const summaryNode = qs("label-style-preview-meta");
  const sampleNode = qs("label-style-preview-sample");
  if (sampleNode) {
    sampleNode.style.fontFamily = style.font_family;
    sampleNode.style.color = style.text_color;
    sampleNode.style.fontSize = `${labelFontSizePx(style)}px`;
    sampleNode.textContent = "สถานีรถไฟ";
  }
  if (summaryNode) {
    const zoomMode = style.scale_with_zoom ? "Auto" : "Fixed";
    summaryNode.innerHTML = `
      <div><span class="base-map-style-swatch" style="background:${escapeHtml(style.text_color)}"></span>${escapeHtml(style.text_color)}</div>
      <div>Zoom out: ${previewFontSizeForZoom(style, style.zoom_scale?.min || DEFAULT_LABEL_STYLE.global.zoom_scale.min)}px</div>
      <div>Default: ${previewFontSizeForZoom(style, style.zoom_scale?.base || DEFAULT_LABEL_STYLE.global.zoom_scale.base)}px</div>
      <div>Zoom in: ${previewFontSizeForZoom(style, style.zoom_scale?.max || DEFAULT_LABEL_STYLE.global.zoom_scale.max)}px</div>
      <div>Mode: ${zoomMode}</div>
    `;
  }
}

function applyLabelStyleDraft() {
  renderLabelStylePreview();
  renderPlacementStage({ refreshContentEditor: false });
  updateBaseMapEditorStatus();
}

function currentBaseMap() {
  return state.baseMaps.find((item) => Number(item?.id || 0) === Number(state.selectedBaseMapId || 0)) || null;
}

function currentLabelLayout() {
  return state.labelLayouts.find((item) => Number(item?.id || 0) === Number(state.selectedLabelLayoutId || 0)) || null;
}

function currentLabelOwnerSource() {
  const layout = currentLabelLayout();
  if (layout) return { kind: "layout", layout };
  const map = currentBaseMap();
  return { kind: "legacy", map };
}

function clampBaseMapScale(scale) {
  return Math.max(1, Math.min(8, Number(scale) || 1));
}

function measureBaseMapPanLimits(scale = state.mapView.scale) {
  const stage = qs("base-map-stage");
  const baseRect = baseRenderedImageRect();
  if (!stage || !baseRect) {
    return { maxOffsetX: 0, maxOffsetY: 0 };
  }
  const stageRect = stage.getBoundingClientRect();
  const nextScale = clampBaseMapScale(scale);
  if (nextScale <= 1) {
    return { maxOffsetX: 0, maxOffsetY: 0 };
  }
  const scaledWidth = baseRect.width * nextScale;
  const scaledHeight = baseRect.height * nextScale;
  return {
    maxOffsetX: Math.max(0, (scaledWidth - stageRect.width) / 2),
    maxOffsetY: Math.max(0, (scaledHeight - stageRect.height) / 2),
  };
}

function clampBaseMapOffsets(offsetX = state.mapView.offsetX, offsetY = state.mapView.offsetY, scale = state.mapView.scale) {
  const stage = qs("base-map-stage");
  const baseRect = baseRenderedImageRect();
  if (!stage || !baseRect) {
    return { offsetX: 0, offsetY: 0 };
  }
  const stageRect = stage.getBoundingClientRect();
  const nextScale = clampBaseMapScale(scale);
  if (nextScale <= 1) {
    return { offsetX: 0, offsetY: 0 };
  }
  const scaledWidth = baseRect.width * nextScale;
  const scaledHeight = baseRect.height * nextScale;
  const maxOffsetX = Math.max(0, (scaledWidth - stageRect.width) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - stageRect.height) / 2);
  return {
    offsetX: Math.max(-maxOffsetX, Math.min(maxOffsetX, Number(offsetX) || 0)),
    offsetY: Math.max(-maxOffsetY, Math.min(maxOffsetY, Number(offsetY) || 0)),
  };
}

function applyBaseMapViewportTransform(offsetX, offsetY, scale, panning) {
  const viewport = qs("base-map-viewport");
  const status = qs("base-map-zoom-status");
  if (!viewport) return;
  viewport.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  viewport.classList.toggle("is-dragging", Boolean(panning));
  if (status) {
    status.textContent = `${Math.round(scale * 100)}%`;
  }
}

function updateBaseMapViewportTransform() {
  const { scale, panning } = state.mapView;
  const clamped = clampBaseMapOffsets(state.mapView.offsetX, state.mapView.offsetY, scale);
  state.mapView.offsetX = clamped.offsetX;
  state.mapView.offsetY = clamped.offsetY;
  applyBaseMapViewportTransform(clamped.offsetX, clamped.offsetY, scale, panning);
}

function scheduleBaseMapViewportTransform() {
  if (state.mapView.rafId) return;
  state.mapView.rafId = window.requestAnimationFrame(() => {
    state.mapView.rafId = 0;
    if (state.mapView.panning) {
      applyBaseMapViewportTransform(
        state.mapView.offsetX,
        state.mapView.offsetY,
        state.mapView.scale,
        true
      );
      return;
    }
    updateBaseMapViewportTransform();
  });
}

function flushBaseMapViewportTransform() {
  if (state.mapView.rafId) {
    window.cancelAnimationFrame(state.mapView.rafId);
    state.mapView.rafId = 0;
  }
  updateBaseMapViewportTransform();
}

function scheduleBaseMapZoomRender() {
  if (state.mapView.zoomRenderTimer) {
    window.clearTimeout(state.mapView.zoomRenderTimer);
  }
  state.mapView.zoomRenderTimer = window.setTimeout(() => {
    state.mapView.zoomRenderTimer = 0;
    renderPlacementStage({ refreshContentEditor: false });
  }, 120);
}

function flushBaseMapZoomRender() {
  if (state.mapView.zoomRenderTimer) {
    window.clearTimeout(state.mapView.zoomRenderTimer);
    state.mapView.zoomRenderTimer = 0;
  }
  renderPlacementStage({ refreshContentEditor: false });
}

function resetBaseMapViewport() {
  state.mapView.scale = 1;
  state.mapView.offsetX = 0;
  state.mapView.offsetY = 0;
  state.mapView.panning = false;
  state.mapView.didPan = false;
  flushBaseMapViewportTransform();
  renderPlacementStage({ refreshContentEditor: false });
}

function zoomBaseMapViewport(delta) {
  const nextScale = clampBaseMapScale(state.mapView.scale + delta);
  if (nextScale === state.mapView.scale) return;
  state.mapView.scale = nextScale;
  if (nextScale === 1) {
    state.mapView.offsetX = 0;
    state.mapView.offsetY = 0;
  }
  flushBaseMapViewportTransform();
  scheduleBaseMapZoomRender();
}

function beginBaseMapPan(clientX, clientY) {
  if (state.mapView.scale <= 1) return;
  const limits = measureBaseMapPanLimits(state.mapView.scale);
  state.mapView.panning = true;
  state.mapView.didPan = false;
  state.mapView.startX = clientX;
  state.mapView.startY = clientY;
  state.mapView.panMaxOffsetX = limits.maxOffsetX;
  state.mapView.panMaxOffsetY = limits.maxOffsetY;
  flushBaseMapViewportTransform();
}

function moveBaseMapPan(clientX, clientY) {
  if (!state.mapView.panning) return;
  const deltaX = clientX - state.mapView.startX;
  const deltaY = clientY - state.mapView.startY;
  if (deltaX || deltaY) {
    state.mapView.didPan = true;
  }
  const maxOffsetX = Number(state.mapView.panMaxOffsetX);
  const maxOffsetY = Number(state.mapView.panMaxOffsetY);
  state.mapView.offsetX = Number.isFinite(maxOffsetX)
    ? Math.max(-maxOffsetX, Math.min(maxOffsetX, state.mapView.offsetX + deltaX))
    : state.mapView.offsetX + deltaX;
  state.mapView.offsetY = Number.isFinite(maxOffsetY)
    ? Math.max(-maxOffsetY, Math.min(maxOffsetY, state.mapView.offsetY + deltaY))
    : state.mapView.offsetY + deltaY;
  state.mapView.startX = clientX;
  state.mapView.startY = clientY;
  scheduleBaseMapViewportTransform();
}

function endBaseMapPan() {
  if (!state.mapView.panning) return;
  state.mapView.panning = false;
  const didPan = state.mapView.didPan;
  if (state.mapView.didPan) {
    state.suppressStageClick = true;
  }
  state.mapView.panMaxOffsetX = null;
  state.mapView.panMaxOffsetY = null;
  flushBaseMapViewportTransform();
  return didPan;
}

function fitBaseMapViewportToLabels() {
  const stage = qs("base-map-stage");
  const map = currentBaseMap();
  const items = currentLabelItems();
  if (!stage || !map || !items.length) {
    resetBaseMapViewport();
    return;
  }
  const stageRect = stage.getBoundingClientRect();
  const viewWidth = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const viewHeight = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  if (!stageRect.width || !stageRect.height || !viewWidth || !viewHeight) {
    resetBaseMapViewport();
    return;
  }
  const xs = items.map((item) => Number(item.anchor_x) || 0);
  const ys = items.map((item) => Number(item.anchor_y) || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const fracWidth = Math.max((maxX - minX) / viewWidth, 0.12);
  const fracHeight = Math.max((maxY - minY) / viewHeight, 0.12);
  const nextScale = clampBaseMapScale(Math.min(6, Math.min(0.82 / fracWidth, 0.82 / fracHeight)));
  const imageRect = baseRenderedImageRect();
  if (!imageRect) {
    resetBaseMapViewport();
    return;
  }
  const centerFracX = ((minX + maxX) / 2) / viewWidth;
  const centerFracY = ((minY + maxY) / 2) / viewHeight;
  state.mapView.scale = nextScale;
  state.mapView.offsetX = -((centerFracX - 0.5) * imageRect.width * nextScale);
  state.mapView.offsetY = -((centerFracY - 0.5) * imageRect.height * nextScale);
  updateBaseMapViewportTransform();
  renderPlacementStage({ refreshContentEditor: false });
}

async function toggleBaseMapEditorFullscreen() {
  const card = qs("base-map-editor-card");
  const button = qs("btn-base-map-fullscreen");
  if (!card || !button) return;
  if (document.fullscreenElement === card) {
    await document.exitFullscreen();
    return;
  }
  card.classList.add("is-placement-open");
  await card.requestFullscreen();
}

async function openBaseMapPlacement() {
  const card = qs("base-map-editor-card");
  if (!card) return;
  if (!currentBaseMap()) {
    throw new Error("select a base map first");
  }
  const localeSelect = qs("placement-preview-locale");
  if (localeSelect && !String(localeSelect.value || "").trim()) {
    localeSelect.value = "th";
  }
  card.classList.add("is-placement-open");
  try {
    await toggleBaseMapEditorFullscreen();
  } catch (error) {
    card.classList.remove("is-placement-open");
    throw error;
  }
}

function updateBaseMapFullscreenLayout() {
  const card = qs("base-map-editor-card");
  const sidebar = qs("base-map-editor-card .base-map-editor-sidebar");
  if (!card || !sidebar) return;
  if (!card.classList.contains("is-fullscreen-mode")) {
    card.style.removeProperty("--base-map-fullscreen-toolbar-height");
    return;
  }
  const height = Math.max(Math.ceil(sidebar.getBoundingClientRect().height), 72);
  card.style.setProperty("--base-map-fullscreen-toolbar-height", `${height}px`);
}

function syncBaseMapEditorFullscreenState() {
  const stage = qs("base-map-stage");
  const button = qs("btn-base-map-fullscreen");
  const card = qs("base-map-editor-card");
  if (!stage || !button || !card) return;
  const isFullscreen = document.fullscreenElement === card;
  if (!isFullscreen) {
    card.classList.remove("is-placement-open");
  }
  stage.classList.toggle("is-fullscreen", isFullscreen);
  card.classList.toggle("is-fullscreen-mode", isFullscreen);
  button.textContent = isFullscreen ? "Exit Full Screen" : "Full Screen";
  syncBaseMapFullscreenPads(isFullscreen);
  updateBaseMapFullscreenLayout();
}

function syncBaseMapFullscreenPads(isFullscreen) {
  const dock = qs("base-map-fullscreen-pad-dock");
  if (!dock) return;
  dock.setAttribute("aria-hidden", isFullscreen ? "false" : "true");
}

function bindFullscreenPadProxy(proxyId, targetId) {
  qs(proxyId)?.addEventListener("click", () => {
    qs(targetId)?.click();
  });
}

function updateGeneratedPreviewTransform() {
  const image = qs("generated-base-map-image");
  const viewport = qs("generated-base-map-viewport");
  const status = qs("generated-base-map-zoom-status");
  if (!image || !viewport) return;
  const { scale, offsetX, offsetY, dragging } = state.generatedPreview;
  image.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${scale})`;
  viewport.classList.toggle("is-dragging", Boolean(dragging));
  if (status) {
    status.textContent = `${Math.round(scale * 100)}%`;
  }
}

function clampGeneratedPreviewScale(scale) {
  return Math.max(1, Math.min(8, Number(scale) || 1));
}

function setGeneratedPreviewScale(nextScale) {
  state.generatedPreview.scale = clampGeneratedPreviewScale(nextScale);
  updateGeneratedPreviewTransform();
}

function resetGeneratedPreview() {
  state.generatedPreview.scale = 1;
  state.generatedPreview.offsetX = 0;
  state.generatedPreview.offsetY = 0;
  state.generatedPreview.dragging = false;
  updateGeneratedPreviewTransform();
}

function beginGeneratedPreviewDrag(clientX, clientY) {
  if (state.generatedPreview.scale <= 1) return;
  state.generatedPreview.dragging = true;
  state.generatedPreview.startX = clientX;
  state.generatedPreview.startY = clientY;
  updateGeneratedPreviewTransform();
}

function moveGeneratedPreviewDrag(clientX, clientY) {
  if (!state.generatedPreview.dragging) return;
  state.generatedPreview.offsetX += clientX - state.generatedPreview.startX;
  state.generatedPreview.offsetY += clientY - state.generatedPreview.startY;
  state.generatedPreview.startX = clientX;
  state.generatedPreview.startY = clientY;
  updateGeneratedPreviewTransform();
}

function endGeneratedPreviewDrag() {
  if (!state.generatedPreview.dragging) return;
  state.generatedPreview.dragging = false;
  updateGeneratedPreviewTransform();
}

function zoomGeneratedPreview(delta) {
  const nextScale = clampGeneratedPreviewScale(state.generatedPreview.scale + delta);
  if (nextScale === state.generatedPreview.scale) return;
  state.generatedPreview.scale = nextScale;
  if (nextScale === 1) {
    state.generatedPreview.offsetX = 0;
    state.generatedPreview.offsetY = 0;
  }
  updateGeneratedPreviewTransform();
}

async function toggleGeneratedPreviewFullscreen() {
  const stage = qs("generated-base-map-stage");
  const button = qs("btn-generated-base-map-fullscreen");
  if (!stage || !button) return;
  if (document.fullscreenElement === stage) {
    await document.exitFullscreen();
    return;
  }
  await stage.requestFullscreen();
}

function syncGeneratedPreviewFullscreenState() {
  const stage = qs("generated-base-map-stage");
  const button = qs("btn-generated-base-map-fullscreen");
  if (!stage || !button) return;
  const isFullscreen = document.fullscreenElement === stage;
  stage.classList.toggle("is-fullscreen", isFullscreen);
  button.textContent = isFullscreen ? "Exit Full Screen" : "Full Screen";
}

function parseJsonInput(id, fallback, label) {
  const raw = String(qs(id)?.value || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function currentLabelItems(options = {}) {
  const { throwOnError = false } = options;
  try {
    return normalizeLabelItems(parseJsonInput("base-map-label-items", [], "labels"));
  } catch {
    if (throwOnError) {
      throw new Error("labels must be valid JSON");
    }
    return [];
  }
}

function setLabelItems(items) {
  qs("base-map-label-items").value = JSON.stringify(normalizeLabelItems(items), null, 2);
  persistBaseMapEditorDraft();
}

function currentLabelDictionary() {
  try {
    return normalizeLabelDictionary(parseJsonInput("base-map-label-dictionary", {}, "label dictionary"));
  } catch {
    return normalizeLabelDictionary({});
  }
}

function setLabelDictionary(dictionary) {
  qs("base-map-label-dictionary").value = JSON.stringify(normalizeLabelDictionary(dictionary), null, 2);
  persistBaseMapEditorDraft();
}

function currentLabelTranslationMeta() {
  try {
    return normalizeLabelTranslationMeta(
      parseJsonInput("base-map-label-translation-meta", {}, "label translation"),
      currentLabelDictionary()
    );
  } catch {
    return normalizeLabelTranslationMeta({}, currentLabelDictionary());
  }
}

function setLabelTranslationMeta(meta) {
  qs("base-map-label-translation-meta").value = JSON.stringify(
    normalizeLabelTranslationMeta(meta, currentLabelDictionary()),
    null,
    2
  );
  persistBaseMapEditorDraft();
}

function currentPreviewLocale() {
  return String(qs("placement-preview-locale")?.value || "th").trim().toLowerCase() || "th";
}

function currentReviewLocale() {
  return String(qs("label-review-locale")?.value || state.selectedLabelReviewLocale || "en").trim().toLowerCase() || "en";
}

function supportedLabelLocales() {
  const dictionary = currentLabelDictionary();
  const meta = currentLabelTranslationMeta();
  return uniqueLocales(["th", ...Object.keys(dictionary), ...(meta?.target_locales || [])]);
}

function selectedLabelItem() {
  return currentLabelItems().find((item) => item.label_key === state.selectedLabelKey) || null;
}

function updateLabelLocaleStatus(locale, patch = {}) {
  const dictionary = currentLabelDictionary();
  const meta = currentLabelTranslationMeta();
  const next = {
    ...meta,
    locale_statuses: {
      ...(meta.locale_statuses || {}),
      [locale]: {
        ...(meta.locale_statuses?.[locale] || {}),
        ...patch,
      },
    },
  };
  setLabelTranslationMeta(normalizeLabelTranslationMeta(next, dictionary));
}

function markTargetLabelLocalesStale() {
  const meta = currentLabelTranslationMeta();
  for (const locale of meta.target_locales || []) {
    updateLabelLocaleStatus(locale, {
      status: "stale",
      reviewed: false,
      reviewed_at: null,
      reviewed_by: null,
    });
  }
}

function upsertLabelDictionaryEntry(locale, labelKey, text) {
  const localeKey = String(locale || "").trim().toLowerCase();
  const key = String(labelKey || "").trim();
  const value = String(text || "").trim();
  if (!localeKey || !key) return;
  const dictionary = currentLabelDictionary();
  const next = {
    ...dictionary,
    [localeKey]: {
      ...(dictionary[localeKey] || {}),
    },
  };
  if (value) {
    next[localeKey][key] = value;
  } else {
    delete next[localeKey][key];
  }
  if (localeKey !== "th" && !Object.keys(next[localeKey] || {}).length) {
    delete next[localeKey];
  }
  setLabelDictionary(next);
  setLabelTranslationMeta(currentLabelTranslationMeta());
}

function currentOverlayItems() {
  return normalizeOverlayItems(currentBaseMap()?.metadata?.overlays || []);
}

function setOverlayItems(items) {
  const map = currentBaseMap();
  if (!map) return;
  map.metadata = {
    ...(map.metadata && typeof map.metadata === "object" ? map.metadata : {}),
    overlays: normalizeOverlayItems(items),
  };
  persistBaseMapEditorDraft();
}

function syncSelectedOverlayId(items = currentOverlayItems()) {
  const normalized = Array.isArray(items) ? items : [];
  if (!normalized.some((item) => item.overlay_id === state.selectedOverlayId)) {
    state.selectedOverlayId = String(normalized[0]?.overlay_id || "").trim();
  }
}

function currentSelectedOverlay() {
  return currentOverlayItems().find((item) => item.overlay_id === state.selectedOverlayId) || null;
}

function initialOverlayItems() {
  try {
    const snapshot = JSON.parse(String(state.initialSnapshot || "{}"));
    return normalizeOverlayItems(snapshot?.overlays || []);
  } catch {
    return [];
  }
}

function hasUnsavedOverlayChanges() {
  return JSON.stringify(currentOverlayItems()) !== JSON.stringify(initialOverlayItems());
}

function baseMapEditorDraftPayload() {
  return {
    selectedBaseMapId: Number(state.selectedBaseMapId || 0) || 0,
    selectedLabelLayoutId: Number(state.selectedLabelLayoutId || 0) || 0,
    key: String(qs("base-map-key")?.value || ""),
    title: String(qs("base-map-title")?.value || ""),
    status: String(qs("base-map-status-select")?.value || ""),
    projectionType: String(qs("base-map-projection-type")?.value || ""),
    bounds: {
      minLat: String(qs("base-map-min-lat")?.value || ""),
      minLng: String(qs("base-map-min-lng")?.value || ""),
      maxLat: String(qs("base-map-max-lat")?.value || ""),
      maxLng: String(qs("base-map-max-lng")?.value || ""),
    },
    viewbox: {
      x: String(qs("base-map-viewbox-x")?.value || ""),
      y: String(qs("base-map-viewbox-y")?.value || ""),
      width: String(qs("base-map-viewbox-width")?.value || ""),
      height: String(qs("base-map-viewbox-height")?.value || ""),
    },
    baseSvgAssetId: String(qs("base-map-base-svg-asset-id")?.value || ""),
    previewAssetId: String(qs("base-map-preview-asset-id")?.value || ""),
    activeLabelLayoutId: String(qs("base-map-active-label-layout-id")?.value || ""),
    layoutKey: String(qs("label-layout-key")?.value || ""),
    layoutTitle: String(qs("label-layout-title")?.value || ""),
    layoutStatus: String(qs("label-layout-status-select")?.value || ""),
    dictionary: String(qs("base-map-label-dictionary")?.value || ""),
    labelTranslation: String(qs("base-map-label-translation-meta")?.value || ""),
    labels: String(qs("base-map-label-items")?.value || ""),
    labelStyle: currentLabelStyle(),
    overlays: currentOverlayItems(),
    previewLocale: currentPreviewLocale(),
    reviewLocale: currentReviewLocale(),
  };
}

function persistBaseMapEditorDraft() {
  if (state.hydratingBaseMapEditor) return;
  const payload = baseMapEditorDraftPayload();
  const selectionKey = baseMapDraftSelectionKey(payload.selectedBaseMapId);
  const snapshot = JSON.stringify(payload);
  if (state.initialSnapshot && snapshot === state.initialSnapshot) {
    clearBaseMapEditorDraft(selectionKey);
    return;
  }
  try {
    localStorage.setItem(baseMapDraftStorageKey(selectionKey), JSON.stringify({
      saved_at: new Date().toISOString(),
      payload,
    }));
  } catch {
    // no-op
  }
}

function baseMapEditorSnapshot() {
  return JSON.stringify(baseMapEditorDraftPayload());
}

function updateBaseMapEditorStatus() {
  const selection = qs("base-map-editor-selection");
  const dirty = qs("base-map-editor-dirty");
  const placementSummary = qs("base-map-placement-entry-summary");
  const map = currentBaseMap();
  if (selection) {
    const parts = [];
    if (map) {
      parts.push(`${map.title || map.key || "Base map"} #${Number(map.id || 0)}`);
    } else {
      parts.push("New draft");
    }
    const layout = currentLabelLayout();
    if (layout) {
      parts.push(`layout: ${layout.title || layout.key || "Label layout"} #${Number(layout.id || 0)}`);
    } else {
      parts.push("layout: legacy / none");
    }
    if (state.selectedLabelKey) {
      parts.push(`selected label: ${state.selectedLabelKey}`);
    }
    if (state.selectedOverlayId) {
      parts.push(`selected overlay: ${state.selectedOverlayId}`);
    }
    selection.textContent = parts.join(" | ");
  }
  if (placementSummary) {
    const parts = [];
    parts.push(map ? `Base map: ${map.title || map.key || "Base map"}` : "Base map: none selected");
    parts.push(`Display locale: ${currentPreviewLocale() || "th"}`);
    parts.push(state.selectedLabelKey ? `Selected label: ${state.selectedLabelKey}` : "Selected label: none");
    placementSummary.textContent = parts.join(" | ");
  }
  if (dirty) {
    dirty.textContent = state.initialSnapshot && state.initialSnapshot === baseMapEditorSnapshot()
      ? "All changes saved"
      : "Unsaved changes";
  }
}

function bindBaseMapDirtyTracking() {
  const ids = [
    "base-map-key",
    "base-map-title",
    "base-map-status-select",
    "base-map-projection-type",
    "base-map-min-lat",
    "base-map-min-lng",
    "base-map-max-lat",
    "base-map-max-lng",
    "base-map-viewbox-x",
    "base-map-viewbox-y",
    "base-map-viewbox-width",
    "base-map-viewbox-height",
    "base-map-base-svg-asset-id",
    "base-map-preview-asset-id",
    "label-layout-select",
    "label-layout-key",
    "label-layout-title",
    "label-layout-status-select",
    "base-map-label-dictionary",
    "base-map-label-translation-meta",
    "base-map-label-items",
    "label-style-font-family",
    "label-style-text-color",
    "label-style-size-preset",
    "label-style-scale-with-zoom",
    "placement-preview-locale",
    "label-review-locale",
  ];
  for (const id of ids) {
    const node = qs(id);
    if (!node) continue;
    node.addEventListener("input", () => {
      persistBaseMapEditorDraft();
      updateBaseMapEditorStatus();
    });
    node.addEventListener("change", () => {
      persistBaseMapEditorDraft();
      updateBaseMapEditorStatus();
    });
  }
}

function syncSelectedLabelKey(items = currentLabelItems()) {
  const normalized = Array.isArray(items) ? items : [];
  if (!normalized.some((item) => item.label_key === state.selectedLabelKey)) {
    state.selectedLabelKey = String(normalized[0]?.label_key || "").trim();
  }
}

function labelDisplayText(label) {
  const dictionary = currentLabelDictionary();
  const locale = currentPreviewLocale();
  return String(
    dictionary?.[locale]?.[label.label_key]
    || dictionary?.th?.[label.label_key]
    || dictionary?.en?.[label.label_key]
    || label.label_key
    || ""
  ).trim();
}

function labelLocaleOffset(label, locale = currentPreviewLocale()) {
  return normalizeLocaleOffsetEntry(label?.locale_offsets?.[locale]) || { dx: 0, dy: 0 };
}

function renderLabelList() {
  const root = qs("base-map-label-list");
  if (!root) return;
  const items = currentLabelItems();
  syncSelectedLabelKey(items);
  if (!items.length) {
    root.innerHTML = '<div class="muted">No labels yet</div>';
    return;
  }
  root.innerHTML = `
    <div class="base-map-label-picker-control">
      <label for="base-map-label-select">Choose Label</label>
      <select id="base-map-label-select">
        ${items.map((item) => `
          <option value="${escapeHtml(item.label_key)}" ${item.label_key === state.selectedLabelKey ? "selected" : ""}>
            ${escapeHtml(item.label_key)} - ${escapeHtml(labelDisplayText(item))}
          </option>
        `).join("")}
      </select>
    </div>
    <div class="muted">
      ${state.selectedLabelKey
        ? escapeHtml(`${items.find((item) => item.label_key === state.selectedLabelKey)?.label_category || ""} (${Number(items.find((item) => item.label_key === state.selectedLabelKey)?.anchor_x || 0).toFixed(0)}, ${Number(items.find((item) => item.label_key === state.selectedLabelKey)?.anchor_y || 0).toFixed(0)})`)
        : ""}
    </div>
  `;
  updateBaseMapFullscreenLayout();
}

function syncLabelLocaleOptions() {
  const reviewSelect = qs("label-review-locale");
  const displaySelect = qs("placement-preview-locale");
  const locales = supportedLabelLocales();
  if (displaySelect) {
    const current = currentPreviewLocale();
    displaySelect.innerHTML = locales.map((locale) => `<option value="${escapeHtml(locale)}">${escapeHtml(locale)}</option>`).join("");
    displaySelect.value = locales.includes(current) ? current : "th";
  }
  if (reviewSelect) {
    const reviewLocales = locales.filter((locale) => locale !== "th");
    const current = currentReviewLocale();
    reviewSelect.innerHTML = reviewLocales.map((locale) => `<option value="${escapeHtml(locale)}">${escapeHtml(locale)}</option>`).join("");
    const next = reviewLocales.includes(current) ? current : (reviewLocales[0] || "en");
    reviewSelect.value = next;
    state.selectedLabelReviewLocale = next;
  }
}

function renderLabelContentEditor() {
  const editorRoot = qs("label-content-set-editor");
  const metaNode = qs("label-content-meta");
  const statusNode = qs("label-translation-status");
  const reviewedButton = qs("btn-mark-label-locale-reviewed");
  syncLabelLocaleOptions();
  const items = currentLabelItems();
  const dictionary = currentLabelDictionary();
  const translationMeta = currentLabelTranslationMeta();
  const reviewLocale = currentReviewLocale();
  const locales = supportedLabelLocales();
  const reviewStatus = translationMeta?.locale_statuses?.[reviewLocale]?.status || "missing";
  const translatedCount = items.filter((item) => String(dictionary?.[reviewLocale]?.[item.label_key] || "").trim()).length;
  const totalCount = items.length;
  const missingCount = Math.max(0, totalCount - translatedCount);
  if (editorRoot) {
    if (!items.length) {
      editorRoot.innerHTML = '<div class="muted">Add labels in the placement panel first.</div>';
    } else {
      const localeHeaders = locales.map((locale) => `<th scope="col">${escapeHtml(locale.toUpperCase())}</th>`).join("");
      editorRoot.innerHTML = `
        <details class="base-map-label-table-shell" open>
          <summary>
            <span class="base-map-label-table-summary-title">Label Content</span>
            <span class="base-map-label-table-summary-meta">
              <span class="base-map-label-table-count">${totalCount} labels | ${locales.length} locales</span>
              <span class="base-map-label-table-toggle" aria-hidden="true"></span>
            </span>
          </summary>
          <div class="base-map-label-table-scroll">
            <table class="base-map-label-table">
              <thead>
                <tr>
                  <th scope="col">Label Key</th>
                  ${localeHeaders}
                </tr>
              </thead>
              <tbody>
                ${items.map((item) => `
                  <tr data-label-key="${escapeHtml(item.label_key)}">
                    <th scope="row" class="base-map-label-table-key">
                      <strong>${escapeHtml(item.label_key)}</strong>
                      <div class="muted">${escapeHtml(`${item.label_category} · (${Math.round(Number(item.anchor_x || 0))}, ${Math.round(Number(item.anchor_y || 0))})`)}</div>
                    </th>
                    ${locales.map((locale) => {
                      const text = String(dictionary?.[locale]?.[item.label_key] || "");
                      const isMissing = !text.trim();
                      return `
                        <td class="base-map-label-table-cell">
                          <div class="base-map-label-table-value${isMissing ? " is-empty" : ""}">
                            <span class="base-map-label-table-status ${isMissing ? "is-missing" : "is-filled"}" aria-hidden="true">${isMissing ? "✕" : "✓"}</span>
                            <span>${escapeHtml(text || "-")}</span>
                          </div>
                        </td>
                      `;
                    }).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </details>
      `;
    }
  }
  if (metaNode) {
    metaNode.textContent = items.length
      ? `Map locale: ${currentPreviewLocale()} | review locale: ${reviewLocale} | ${reviewLocale}: ${reviewStatus} | filled ${translatedCount}/${totalCount} | missing ${missingCount} | columns: ${locales.join(", ")}`
      : "Add labels in placement first, then write translations and review the whole set here.";
  }
  if (statusNode && !String(statusNode.textContent || "").trim()) {
    statusNode.textContent = translationMeta?.last_translated_at
      ? `Last translated ${translationMeta.last_translated_at}`
      : "Write Thai first, then fill the other locale columns here.";
  }
  if (reviewedButton) {
    reviewedButton.disabled = !items.length || !reviewLocale || reviewLocale === "th" || missingCount > 0;
  }
  updateBaseMapFullscreenLayout();
}

function updateOverlayControls() {
  const widthInput = qs("base-map-overlay-width");
  const heightInput = qs("base-map-overlay-height");
  const selected = currentSelectedOverlay();
  if (widthInput) {
    widthInput.value = selected ? String(Math.round(selected.width)) : "";
    widthInput.disabled = !selected;
  }
  if (heightInput) {
    heightInput.value = selected ? String(Math.round(selected.height)) : "";
  }
}

function renderOverlayList() {
  const root = qs("base-map-overlay-list");
  if (!root) return;
  const items = currentOverlayItems();
  syncSelectedOverlayId(items);
  if (!items.length) {
    root.innerHTML = '<div class="muted">No overlay images</div>';
    updateOverlayControls();
    return;
  }
  root.innerHTML = items.map((item) => `
    <div class="base-map-overlay-item${item.overlay_id === state.selectedOverlayId ? " is-selected" : ""}">
      <strong>${escapeHtml(item.overlay_id)}</strong>
      <div class="muted">asset #${Number(item.asset_id || 0)}</div>
      <div class="muted">${Math.round(item.width)} x ${Math.round(item.height)} at (${Math.round(item.anchor_x)}, ${Math.round(item.anchor_y)})</div>
      <button type="button" data-action="select-overlay" data-overlay-id="${escapeHtml(item.overlay_id)}">Select</button>
    </div>
  `).join("");
  updateOverlayControls();
}

function mapPointToStagePercent(anchorX, anchorY, map = currentBaseMap()) {
  const stage = qs("base-map-stage");
  const baseRect = baseRenderedImageRect();
  return mapPointToStagePercentShared(
    anchorX,
    anchorY,
    map?.viewbox,
    stage?.getBoundingClientRect?.() || null,
    baseRect,
    DEFAULT_VIEWBOX
  );
}

function mapSizeToStagePercent(widthValue, heightValue, map = currentBaseMap()) {
  const stage = qs("base-map-stage");
  const baseRect = baseRenderedImageRect();
  return mapSizeToStagePercentShared(
    widthValue,
    heightValue,
    map?.viewbox,
    stage?.getBoundingClientRect?.() || null,
    baseRect,
    DEFAULT_VIEWBOX
  );
}

function clampOverlayAnchor(anchorX, anchorY, overlay, map = currentBaseMap()) {
  const viewWidth = Number(map?.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const viewHeight = Number(map?.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  const overlayWidth = Math.max(1, Number(overlay?.width || 0) || 1);
  const overlayHeight = Math.max(1, Number(overlay?.height || 0) || 1);
  return {
    x: Math.max(0, Math.min(Math.max(0, viewWidth - overlayWidth), Number(anchorX) || 0)),
    y: Math.max(overlayHeight, Math.min(viewHeight, Number(anchorY) || 0)),
  };
}

function renderOverlayLayer(map) {
  const layer = qs("base-map-overlay-layer");
  if (!layer || !map) return;
  const items = currentOverlayItems();
  syncSelectedOverlayId(items);
  layer.innerHTML = items.map((item) => {
    const position = mapPointToStagePercent(item.anchor_x, item.anchor_y, map);
    const size = mapSizeToStagePercent(item.width, item.height, map);
    const previewScale = overlayPreviewScale(item);
    return `
      <button
        type="button"
        class="base-map-overlay${item.overlay_id === state.selectedOverlayId ? " is-selected" : ""}"
        data-action="select-overlay-image"
        data-overlay-id="${escapeHtml(item.overlay_id)}"
        draggable="false"
        style="left:${position.left}%;top:${position.top}%;width:${size.width}%;height:${size.height}%;--base-map-overlay-scale:${previewScale}"
      >
        <img src="${escapeHtml(item.asset_url || "")}" alt="${escapeHtml(item.overlay_id)}" width="${Math.round(item.width)}" height="${Math.round(item.height)}" />
      </button>
    `;
  }).join("");
  renderOverlayList();
}

function selectOverlay(overlayId) {
  state.selectedOverlayId = String(overlayId || "").trim();
  renderPlacementStage();
}

function updateSelectedOverlay(mutator) {
  if (!state.selectedOverlayId) throw new Error("select overlay first");
  const map = currentBaseMap();
  if (!map) throw new Error("select base map first");
  const viewWidth = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const viewHeight = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  let found = false;
  const next = currentOverlayItems().map((item) => {
    if (item.overlay_id !== state.selectedOverlayId) return item;
    found = true;
    const updated = mutator(item, { width: viewWidth, height: viewHeight }) || item;
    const nextWidth = Math.max(1, Math.min(viewWidth, Number(updated.width ?? item.width) || item.width));
    const aspectRatio = Number(updated.aspect_ratio || item.aspect_ratio || 1) || 1;
    const nextHeight = Math.max(1, Math.min(viewHeight, Number(updated.height ?? (nextWidth / aspectRatio)) || item.height));
    const clampedAnchor = clampOverlayAnchor(
      Number(updated.anchor_x ?? item.anchor_x),
      Number(updated.anchor_y ?? item.anchor_y),
      { ...item, ...updated, width: nextWidth, height: nextHeight },
      map
    );
    return {
      ...item,
      ...updated,
      width: nextWidth,
      height: nextHeight,
      anchor_x: clampedAnchor.x,
      anchor_y: clampedAnchor.y,
      aspect_ratio: aspectRatio,
      scale_with_zoom: updated.scale_with_zoom == null ? item.scale_with_zoom : Boolean(updated.scale_with_zoom),
    };
  });
  if (!found) throw new Error("selected overlay not found");
  setOverlayItems(next);
  renderPlacementStage();
}

function insertOverlayItem(item) {
  const map = currentBaseMap();
  if (!map) throw new Error("select base map first");
  const viewWidth = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const viewHeight = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  const naturalWidth = Number(item?.natural_width || 0) || 1;
  const naturalHeight = Number(item?.natural_height || 0) || 1;
  const aspectRatio = naturalWidth / naturalHeight || 1;
  const defaultWidth = Math.max(80, Math.round(viewWidth * 0.08));
  const nextWidth = Math.min(viewWidth, defaultWidth);
  const nextHeight = Math.max(1, Math.round(nextWidth / aspectRatio));
  const overlayId = `overlay_${Date.now()}`;
  const next = {
    overlay_id: overlayId,
    kind: "image",
    asset_id: Number(item.asset_id || 0) || 0,
    asset_url: String(item.asset_url || "").trim(),
    anchor_x: Math.max(0, Math.round((viewWidth - nextWidth) / 2)),
    anchor_y: Math.min(viewHeight, Math.round((viewHeight + nextHeight) / 2)),
    width: nextWidth,
    height: nextHeight,
    natural_width: naturalWidth,
    natural_height: naturalHeight,
    aspect_ratio: aspectRatio,
    scale_with_zoom: true,
  };
  setOverlayItems([...currentOverlayItems(), next]);
  state.selectedOverlayId = overlayId;
  renderPlacementStage();
}

function removeSelectedOverlay() {
  if (!state.selectedOverlayId) throw new Error("select overlay first");
  const next = currentOverlayItems().filter((item) => item.overlay_id !== state.selectedOverlayId);
  state.selectedOverlayId = String(next[0]?.overlay_id || "").trim();
  setOverlayItems(next);
  renderPlacementStage();
}

function renderPlacementStage(options = {}) {
  const { refreshContentEditor = true } = options || {};
  const stageImage = qs("base-map-stage-image");
  const stageEmpty = qs("base-map-stage-empty");
  const textLayer = qs("base-map-text-layer");
  const overlayLayer = qs("base-map-overlay-layer");
  const markers = qs("base-map-markers");
  const status = qs("base-map-placement-status");
  const map = currentBaseMap();
  const items = currentLabelItems();
  syncSelectedLabelKey(items);
  if (!stageImage || !stageEmpty || !textLayer || !overlayLayer || !markers) return;
  if (!map || !map.candidate_map_url) {
    stageImage.hidden = true;
    stageImage.removeAttribute("src");
    stageEmpty.hidden = false;
    textLayer.innerHTML = "";
    overlayLayer.innerHTML = "";
    markers.innerHTML = "";
    if (status) {
      status.textContent = map ? "This base map does not have a generated candidate map yet" : "";
    }
    renderLabelList();
    if (refreshContentEditor) renderLabelContentEditor();
    renderOverlayList();
    updateBaseMapEditorStatus();
    return;
  }
  stageImage.hidden = false;
  stageImage.src = map.candidate_map_url;
  stageEmpty.hidden = true;
  if (status) {
    status.textContent = state.selectedLabelKey
      ? `Selected ${state.selectedLabelKey}. Drag label to move, or drag map to pan.`
      : "Drag a label to move it, or drag empty map space to pan.";
  }
  textLayer.innerHTML = items.map((item) => {
    const localeOffset = labelLocaleOffset(item);
    const position = mapPointToStagePercent(
      Number(item.anchor_x) + Number(localeOffset.dx || 0),
      Number(item.anchor_y) + Number(localeOffset.dy || 0),
      map
    );
    const labelText = labelDisplayText(item);
    const style = resolveLabelStyle(item);
    const previewScale = labelPreviewScale(style);
    return `
      <div
        class="base-map-text-label${item.label_key === state.selectedLabelKey ? " is-selected" : ""}"
        data-label-key="${escapeHtml(item.label_key)}"
        data-action="select-label"
        style="left:${position.left}%;top:${position.top}%;font-family:${escapeHtml(style.font_family)};font-size:${labelFontSizePx(style)}px;color:${escapeHtml(style.text_color)};--base-map-label-scale:${previewScale}"
      >
        <span class="base-map-text-label-text">${escapeHtml(labelText)}</span>
      </div>
    `;
  }).join("");
  renderOverlayLayer(map);
  markers.innerHTML = "";
  renderLabelList();
  if (refreshContentEditor) renderLabelContentEditor();
  updateBaseMapEditorStatus();
}

function renderLabelLayouts() {
  const select = qs("label-layout-select");
  const items = Array.isArray(state.labelLayouts) ? state.labelLayouts : [];
  if (!select) return;
  select.innerHTML = `<option value="">-- Legacy / no layout --</option>${items.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(state.selectedLabelLayoutId || 0) ? "selected" : ""}>${escapeHtml(item.title || item.key || `Layout #${item.id}`)} (#${item.id})</option>`).join("")}`;
}

function currentLabelFormSource(map = currentBaseMap(), layout = currentLabelLayout()) {
  if (layout) {
    return {
      kind: "layout",
      layout,
      metadata: layout.metadata || {},
      labels: Array.isArray(layout.labels) ? layout.labels : [],
    };
  }
  return {
    kind: "legacy",
    layout: null,
    metadata: map?.metadata || {},
    labels: Array.isArray(map?.labels) ? map.labels : [],
  };
}

function normalizeLabelsIntoView(labels) {
  return normalizeLabelItems(labels);
}

function fillLabelLayoutForm(layout, map = currentBaseMap()) {
  const source = currentLabelFormSource(map, layout);
  const normalizedLabels = normalizeLabelsIntoView(source.labels || [], map);
  qs("selected-label-layout-id").value = layout ? String(layout.id) : "";
  qs("label-layout-key").value = layout?.key || "";
  qs("label-layout-title").value = layout?.title || "";
  qs("label-layout-status-select").value = layout?.status || "draft";
  setLabelDictionary(source.metadata?.label_dictionary || {});
  setLabelTranslationMeta(source.metadata?.label_translation || {});
  syncLabelStyleControls(source.metadata?.label_style || DEFAULT_LABEL_STYLE);
  renderLabelStylePreview();
  setLabelItems(normalizedLabels);
  syncSelectedLabelKey(normalizedLabels);
  renderLabelLayouts();
}

function applyBaseMapDraftPayload(draftPayload, map = currentBaseMap()) {
  const payload = draftPayload && typeof draftPayload === "object" ? draftPayload : null;
  if (!payload) return false;
  qs("base-map-key").value = String(payload.key || "");
  qs("base-map-title").value = String(payload.title || "");
  qs("base-map-status-select").value = String(payload.status || "draft");
  qs("base-map-projection-type").value = String(payload.projectionType || "linear-bbox-fit");
  qs("base-map-min-lat").value = String(payload?.bounds?.minLat ?? DEFAULT_BOUNDS.min_lat);
  qs("base-map-min-lng").value = String(payload?.bounds?.minLng ?? DEFAULT_BOUNDS.min_lng);
  qs("base-map-max-lat").value = String(payload?.bounds?.maxLat ?? DEFAULT_BOUNDS.max_lat);
  qs("base-map-max-lng").value = String(payload?.bounds?.maxLng ?? DEFAULT_BOUNDS.max_lng);
  qs("base-map-viewbox-x").value = String(payload?.viewbox?.x ?? DEFAULT_VIEWBOX.x);
  qs("base-map-viewbox-y").value = String(payload?.viewbox?.y ?? DEFAULT_VIEWBOX.y);
  qs("base-map-viewbox-width").value = String(payload?.viewbox?.width ?? DEFAULT_VIEWBOX.width);
  qs("base-map-viewbox-height").value = String(payload?.viewbox?.height ?? DEFAULT_VIEWBOX.height);
  qs("base-map-base-svg-asset-id").value = String(payload.baseSvgAssetId || "");
  qs("base-map-preview-asset-id").value = String(payload.previewAssetId || "");
  state.selectedLabelLayoutId = Number(payload.selectedLabelLayoutId || payload.activeLabelLayoutId || 0) || 0;
  qs("base-map-active-label-layout-id").value = state.selectedLabelLayoutId ? String(state.selectedLabelLayoutId) : "";
  qs("selected-label-layout-id").value = state.selectedLabelLayoutId ? String(state.selectedLabelLayoutId) : "";
  qs("label-layout-key").value = String(payload.layoutKey || "");
  qs("label-layout-title").value = String(payload.layoutTitle || "");
  qs("label-layout-status-select").value = String(payload.layoutStatus || "draft");
  if (map) {
    map.active_label_layout_id = state.selectedLabelLayoutId || null;
    map.metadata = {
      ...(map.metadata && typeof map.metadata === "object" ? map.metadata : {}),
      overlays: normalizeOverlayItems(payload.overlays || []),
    };
  }
  setLabelDictionary(payload.dictionary ? JSON.parse(payload.dictionary) : {});
  setLabelTranslationMeta(payload.labelTranslation ? JSON.parse(payload.labelTranslation) : {});
  syncLabelStyleControls(payload.labelStyle || DEFAULT_LABEL_STYLE);
  renderLabelStylePreview();
  setLabelItems(normalizeLabelsIntoView(payload.labels ? JSON.parse(payload.labels) : [], map));
  state.selectedLabelReviewLocale = String(payload.reviewLocale || state.selectedLabelReviewLocale || "en").trim().toLowerCase() || "en";
  if (qs("placement-preview-locale")) {
    qs("placement-preview-locale").value = String(payload.previewLocale || "th").trim().toLowerCase() || "th";
  }
  syncSelectedOverlayId(normalizeOverlayItems(payload.overlays || []));
  renderLabelLayouts();
  return true;
}

function fillBaseMapForm(item) {
  const map = item || null;
  persistBaseMapSelection(map?.id || 0);
  const draft = loadBaseMapEditorDraft(baseMapDraftSelectionKey(map?.id || 0));
  const generated = latestGeneratedBaseMap();
  state.hydratingBaseMapEditor = true;
  try {
  if (qs("placement-preview-locale")) {
    const currentLocale = String(qs("placement-preview-locale").value || "").trim().toLowerCase();
    qs("placement-preview-locale").value = currentLocale || "th";
  }
  qs("selected-base-map-id").value = map ? String(map.id) : "";
  qs("base-map-key").value = map?.key || "";
  qs("base-map-title").value = map?.title || "";
  qs("base-map-status-select").value = map?.status || "draft";
  qs("base-map-max-lat").value = String(map?.bounds?.max_lat ?? DEFAULT_BOUNDS.max_lat);
  qs("base-map-min-lng").value = String(map?.bounds?.min_lng ?? DEFAULT_BOUNDS.min_lng);
  qs("base-map-min-lat").value = String(map?.bounds?.min_lat ?? DEFAULT_BOUNDS.min_lat);
  qs("base-map-max-lng").value = String(map?.bounds?.max_lng ?? DEFAULT_BOUNDS.max_lng);
  qs("base-map-viewbox-x").value = String(map?.viewbox?.x ?? DEFAULT_VIEWBOX.x);
  qs("base-map-viewbox-y").value = String(map?.viewbox?.y ?? DEFAULT_VIEWBOX.y);
  qs("base-map-viewbox-width").value = String(map?.viewbox?.width ?? DEFAULT_VIEWBOX.width);
  qs("base-map-viewbox-height").value = String(map?.viewbox?.height ?? DEFAULT_VIEWBOX.height);
  qs("base-map-projection-type").value = String(map?.projection_type || "linear-bbox-fit");
  qs("base-map-base-svg-asset-id").value = map?.base_svg_asset_id ? String(map.base_svg_asset_id) : "";
  qs("base-map-preview-asset-id").value = map?.preview_asset_id ? String(map.preview_asset_id) : "";
  state.selectedLabelLayoutId = Number(map?.active_label_layout_id || 0) || 0;
  qs("base-map-active-label-layout-id").value = state.selectedLabelLayoutId ? String(state.selectedLabelLayoutId) : "";
  fillLabelLayoutForm(currentLabelLayout(), map);
  const persistedSnapshot = baseMapEditorSnapshot();
  if (draft?.payload) {
    try {
      applyBaseMapDraftPayload(draft.payload, map);
    } catch {
      clearBaseMapEditorDraft(baseMapDraftSelectionKey(map?.id || 0));
    }
  }
  syncSelectedOverlayId(normalizeOverlayItems(map?.metadata?.overlays || []));
  const preview = qs("base-map-preview-summary");
  const layout = currentLabelLayout();
  const source = currentLabelFormSource(map, layout);
  if (preview) {
    preview.innerHTML = map ? `
      <div><strong>${escapeHtml(map.title || map.key || "Base map")}</strong> <span class="muted">#${Number(map.id || 0)}</span></div>
      <div class="muted">key: ${escapeHtml(map.key || "-")} - status: ${escapeHtml(map.status || "-")}</div>
      <div class="muted">${matchesGeneratedBaseMapCandidate(map) ? "Matches latest generated candidate" : "Does not match latest generated candidate"}</div>
      ${generated ? `<div class="muted">latest candidate: ${escapeHtml(generated.title || generated.key || GENERATED_BASE_MAP_R1.key)} #${Number(generated.id || 0)}</div>` : `<div class="muted">latest candidate: ${escapeHtml(GENERATED_BASE_MAP_R1.key)}</div>`}
      <div class="muted">placement: ${layout ? `${escapeHtml(layout.title || layout.key || "Map labels")} #${Number(layout.id || 0)}` : "managed automatically"}</div>
      <div class="muted">labels: ${Number(source.labels?.length || 0)} - overlays: ${Number(map.metadata?.overlays?.length || 0)}</div>
      ${map.candidate_map_url ? `<div><a href="${escapeHtml(map.candidate_map_url)}" target="_blank" rel="noreferrer">open candidate map</a></div>` : ""}
      ${map.annotation_map_url ? `<div><a href="${escapeHtml(map.annotation_map_url)}" target="_blank" rel="noreferrer">open annotation map</a></div>` : ""}
      ${map.published_map_url ? `<div><a href="${escapeHtml(map.published_map_url)}" target="_blank" rel="noreferrer">open published map</a></div>` : ""}
    ` : '<div class="muted">no base map selected</div>';
  }
  resetBaseMapViewport();
  renderPlacementStage();
  state.initialSnapshot = persistedSnapshot;
  } finally {
    state.hydratingBaseMapEditor = false;
  }
  updateBaseMapEditorStatus();
}

function renderBaseMaps() {
  const tbody = qs("base-map-table")?.querySelector("tbody");
  const editorSelect = qs("base-map-editor-select");
  const items = Array.isArray(state.baseMaps) ? state.baseMaps : [];
  if (editorSelect) {
    editorSelect.innerHTML = `<option value="">-- Select base map --</option>${items.map((item) => `<option value="${item.id}" ${Number(item.id) === Number(state.selectedBaseMapId || 0) ? "selected" : ""}>${escapeHtml(item.title)} (#${item.id})</option>`).join("")}`;
  }
  if (tbody) {
    tbody.innerHTML = items.length
      ? items.map((item) => `
        <tr>
          <td>${item.id}</td>
          <td>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="muted">${escapeHtml(item.key)}</div>
          </td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(`${item.bounds.min_lat}, ${item.bounds.min_lng} -> ${item.bounds.max_lat}, ${item.bounds.max_lng}`)}</td>
          <td>${Number((state.labelLayouts.find((layout) => Number(layout?.id || 0) === Number(item.active_label_layout_id || 0))?.labels?.length) || item.labels?.length || 0)}</td>
          <td class="table-actions"><button type="button" data-action="edit-base-map" data-id="${item.id}">Edit</button></td>
        </tr>`).join("")
      : '<tr><td colspan="6" class="muted">No base maps yet</td></tr>';
  }
}

async function refresh() {
  const [baseMaps, labelLayouts] = await Promise.all([
    api("/api/v2/transport/base-maps"),
    api("/api/v2/transport/label-layouts"),
  ]);
  state.baseMaps = Array.isArray(baseMaps?.items) ? baseMaps.items : [];
  state.labelLayouts = Array.isArray(labelLayouts?.items) ? labelLayouts.items : [];
  if (!currentBaseMap()) {
    state.selectedBaseMapId = preferredBaseMapSelection(state.baseMaps);
  }
  syncGeneratedCandidateSummary();
  renderBaseMaps();
  renderLabelLayouts();
  fillBaseMapForm(currentBaseMap());
}

function collectBaseMapPayload() {
  const activeLabelLayoutId = Number(state.selectedLabelLayoutId || 0) || null;
  const metadata = {
    overlays: currentOverlayItems().map((item) => ({
      overlay_id: item.overlay_id,
      kind: "image",
      asset_id: item.asset_id,
      anchor_x: item.anchor_x,
      anchor_y: item.anchor_y,
        width: item.width,
        height: item.height,
        natural_width: item.natural_width,
        natural_height: item.natural_height,
        scale_with_zoom: item.scale_with_zoom == null ? true : Boolean(item.scale_with_zoom),
      })),
  };
  if (!activeLabelLayoutId) {
    metadata.label_dictionary = normalizeLabelDictionary(parseJsonInput("base-map-label-dictionary", {}, "label dictionary"));
    metadata.label_translation = normalizeLabelTranslationMeta(
      parseJsonInput("base-map-label-translation-meta", {}, "label translation"),
      currentLabelDictionary()
    );
    metadata.label_style = currentLabelStyle();
  }
  return {
    key: String(qs("base-map-key")?.value || "").trim(),
    title: String(qs("base-map-title")?.value || "").trim(),
    status: String(qs("base-map-status-select")?.value || "draft").trim().toLowerCase() || "draft",
    bounds: {
      min_lat: Number(qs("base-map-min-lat")?.value || 0),
      min_lng: Number(qs("base-map-min-lng")?.value || 0),
      max_lat: Number(qs("base-map-max-lat")?.value || 0),
      max_lng: Number(qs("base-map-max-lng")?.value || 0),
    },
    viewbox: {
      x: Number(qs("base-map-viewbox-x")?.value || 0),
      y: Number(qs("base-map-viewbox-y")?.value || 0),
      width: Number(qs("base-map-viewbox-width")?.value || 0),
      height: Number(qs("base-map-viewbox-height")?.value || 0),
    },
    projection_type: String(qs("base-map-projection-type")?.value || "linear-bbox-fit").trim() || "linear-bbox-fit",
    base_svg_asset_id: Number(qs("base-map-base-svg-asset-id")?.value || 0) || null,
    preview_asset_id: Number(qs("base-map-preview-asset-id")?.value || 0) || null,
    active_label_layout_id: activeLabelLayoutId,
    metadata,
  };
}

function collectLabelLayoutPayload() {
  return {
    key: String(qs("label-layout-key")?.value || "").trim(),
    title: String(qs("label-layout-title")?.value || "").trim(),
    status: String(qs("label-layout-status-select")?.value || "draft").trim().toLowerCase() || "draft",
    metadata: {
      label_dictionary: normalizeLabelDictionary(parseJsonInput("base-map-label-dictionary", {}, "label dictionary")),
      label_translation: normalizeLabelTranslationMeta(
        parseJsonInput("base-map-label-translation-meta", {}, "label translation"),
        currentLabelDictionary()
      ),
      label_style: currentLabelStyle(),
    },
  };
}

async function createBaseMap() {
  return api("/api/v2/transport/base-maps", {
    method: "POST",
    body: JSON.stringify(collectBaseMapPayload()),
  });
}

async function updateBaseMap() {
  const id = Number(qs("selected-base-map-id")?.value || 0) || 0;
  if (!id) throw new Error("Select a base map before editing");
  await api(`/api/v2/transport/base-maps/${id}`, {
    method: "PUT",
    body: JSON.stringify(collectBaseMapPayload()),
  });
}

async function renderBaseMapAnnotation() {
  const id = Number(qs("selected-base-map-id")?.value || 0) || 0;
  if (!id) throw new Error("Select a base map before rendering annotation output");
  return api(`/api/v2/transport/base-maps/${id}/render-annotation`, {
    method: "POST",
  });
}

async function createLabelLayout() {
  return api("/api/v2/transport/label-layouts", {
    method: "POST",
    body: JSON.stringify(collectLabelLayoutPayload()),
  });
}

async function updateLabelLayout() {
  const id = Number(state.selectedLabelLayoutId || 0) || 0;
  if (!id) throw new Error("Create or select a label layout first");
  return api(`/api/v2/transport/label-layouts/${id}`, {
    method: "PUT",
    body: JSON.stringify(collectLabelLayoutPayload()),
  });
}

async function ensureLabelLayoutForCurrentMap() {
  const existingId = Number(state.selectedLabelLayoutId || 0) || 0;
  if (existingId) return existingId;
  const map = currentBaseMap();
  if (!map?.id) throw new Error("Select and save a base map before promoting legacy labels");
  if (!String(qs("label-layout-key")?.value || "").trim()) {
    qs("label-layout-key").value = `${String(map.key || `base-map-${map.id}`).trim()}-layout`;
  }
  if (!String(qs("label-layout-title")?.value || "").trim()) {
    qs("label-layout-title").value = `${String(map.title || map.key || "Base map").trim()} Layout`;
  }
  if (!String(qs("label-layout-status-select")?.value || "").trim()) {
    qs("label-layout-status-select").value = String(map.status || "draft").trim().toLowerCase() || "draft";
  }
  const created = await createLabelLayout();
  state.selectedLabelLayoutId = Number(created?.id || 0) || 0;
  map.active_label_layout_id = state.selectedLabelLayoutId || null;
  qs("base-map-active-label-layout-id").value = state.selectedLabelLayoutId ? String(state.selectedLabelLayoutId) : "";
  await api(`/api/v2/transport/label-layouts/${state.selectedLabelLayoutId}/labels`, {
    method: "PUT",
    body: JSON.stringify({ items: currentLabelItems({ throwOnError: true }) }),
  });
  await updateBaseMap();
  return state.selectedLabelLayoutId;
}

async function saveBaseMapLabels() {
  const layoutId = await ensureLabelLayoutForCurrentMap();
  await api(`/api/v2/transport/label-layouts/${layoutId}/labels`, {
    method: "PUT",
    body: JSON.stringify({ items: currentLabelItems({ throwOnError: true }) }),
  });
}

async function saveLabelLayoutWorkspace() {
  await ensureLabelLayoutForCurrentMap();
  await updateLabelLayout();
  await saveBaseMapLabels();
}

async function saveBaseMapWorkspace() {
  const draftSelectionKey = baseMapDraftSelectionKey(state.selectedBaseMapId);
  const attachedLayoutId = Number(state.selectedLabelLayoutId || currentBaseMap()?.active_label_layout_id || 0) || 0;
  const hasLabelEdits = currentLabelItems().length > 0;
  if (attachedLayoutId || hasLabelEdits) {
    state.selectedLabelLayoutId = attachedLayoutId;
    await saveLabelLayoutWorkspace();
  }
  await updateBaseMap();
  clearBaseMapEditorDraft(draftSelectionKey);
}

async function uploadBaseMapOverlayImage(file) {
  const id = Number(qs("selected-base-map-id")?.value || 0) || 0;
  if (!id) throw new Error("save the base map before uploading overlays");
  const formData = new FormData();
  formData.set("file", file);
  return await api(`/api/v2/transport/base-maps/${id}/overlays/image`, {
    method: "POST",
    body: formData,
  });
}

function formatBaseMapOverlayUploadError(error) {
  const status = Number(error?.status || 0) || 0;
  const message = String(error?.message || "").trim().toLowerCase();
  if (message.includes("save the base map before uploading overlays")) {
    return "ต้อง Save Base Map ก่อน จึงจะอัปโหลด Logo / Picture ได้";
  }
  if (status === 401) {
    return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วลองอัปโหลดอีกครั้ง";
  }
  if (status === 403) {
    return "บัญชีนี้ไม่มีสิทธิ์อัปโหลดรูปในหน้านี้";
  }
  if (message.includes("only jpeg, png, and webp images are supported")) {
    return "รองรับเฉพาะไฟล์ JPG, PNG และ WEBP";
  }
  if (message.includes("file content does not match declared image type")) {
    return "ไฟล์รูปไม่สมบูรณ์ หรือชนิดไฟล์จริงไม่ตรงกับนามสกุล";
  }
  if (message.includes("image payload is invalid") || message.includes("png payload") || message.includes("jpeg") || message.includes("webp")) {
    return "ไฟล์รูปอ่านไม่สำเร็จ กรุณาลองใช้ไฟล์รูปอื่น";
  }
  if (message.includes("request failed (404)") || message.includes("base map not found")) {
    return "ไม่พบ Base Map นี้แล้ว ลองรีโหลดหน้าแล้วเลือกใหม่";
  }
  return String(error?.message || "อัปโหลด Logo / Picture ไม่สำเร็จ");
}

function resetBaseMapFormToDefaults() {
  state.selectedBaseMapId = 0;
  state.selectedLabelLayoutId = 0;
  state.selectedLabelKey = "";
  state.selectedOverlayId = "";
  renderBaseMaps();
  renderLabelLayouts();
  fillBaseMapForm(null);
  qs("base-map-key")?.focus();
}

function loadGeneratedBaseMapPreset() {
  const existing = state.baseMaps.find((item) => String(item?.key || "").trim() === GENERATED_BASE_MAP_R1.key) || null;
  if (existing) {
    state.selectedBaseMapId = Number(existing.id || 0) || 0;
    renderBaseMaps();
    fillBaseMapForm(existing);
    return;
  }
  state.selectedBaseMapId = 0;
  state.selectedLabelLayoutId = 0;
  state.selectedLabelKey = "";
  renderBaseMaps();
  renderLabelLayouts();
  fillBaseMapForm(null);
  qs("base-map-key").value = GENERATED_BASE_MAP_R1.key;
  qs("base-map-title").value = GENERATED_BASE_MAP_R1.title;
  qs("base-map-status-select").value = GENERATED_BASE_MAP_R1.status;
  qs("base-map-projection-type").value = GENERATED_BASE_MAP_R1.projection_type;
  qs("base-map-min-lat").value = String(GENERATED_BASE_MAP_R1.bounds.min_lat);
  qs("base-map-min-lng").value = String(GENERATED_BASE_MAP_R1.bounds.min_lng);
  qs("base-map-max-lat").value = String(GENERATED_BASE_MAP_R1.bounds.max_lat);
  qs("base-map-max-lng").value = String(GENERATED_BASE_MAP_R1.bounds.max_lng);
  qs("base-map-viewbox-x").value = String(GENERATED_BASE_MAP_R1.viewbox.x);
  qs("base-map-viewbox-y").value = String(GENERATED_BASE_MAP_R1.viewbox.y);
  qs("base-map-viewbox-width").value = String(GENERATED_BASE_MAP_R1.viewbox.width);
  qs("base-map-viewbox-height").value = String(GENERATED_BASE_MAP_R1.viewbox.height);
  qs("base-map-base-svg-asset-id").value = "";
  qs("base-map-preview-asset-id").value = "";
  state.initialSnapshot = baseMapEditorSnapshot();
  updateBaseMapEditorStatus();
  qs("base-map-key")?.focus();
}

function addPlacementLabel() {
  const key = String(qs("placement-label-key")?.value || "").trim();
  const thaiText = String(qs("placement-label-text-th")?.value || "").trim();
  if (!key) throw new Error("label key is required");
  if (!thaiText) throw new Error("Thai text is required");
  const items = currentLabelItems();
  const map = currentBaseMap();
  if (items.some((item) => item.label_key === key)) throw new Error("label key already exists");
  const viewWidth = Number(map?.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const viewHeight = Number(map?.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  const next = {
    label_key: key,
    label_category: String(qs("placement-label-category")?.value || "landmark").trim().toLowerCase() || "landmark",
    anchor_x: Math.round(viewWidth * 0.5),
    anchor_y: Math.round(viewHeight * 0.5),
    priority: Number(qs("placement-label-priority")?.value || 3) || 3,
    min_zoom_hint: null,
  };
  state.selectedLabelKey = key;
  setLabelItems([...items, next]);
  upsertLabelDictionaryEntry("th", key, thaiText);
  updateLabelLocaleStatus("th", { status: "source", reviewed: true });
  markTargetLabelLocalesStale();
  resetBaseMapViewport();
}

function removeSelectedLabel() {
  if (!state.selectedLabelKey) throw new Error("No label selected");
  const removedKey = state.selectedLabelKey;
  const next = currentLabelItems().filter((item) => item.label_key !== state.selectedLabelKey);
  state.selectedLabelKey = String(next[0]?.label_key || "").trim();
  const dictionary = currentLabelDictionary();
  for (const locale of Object.keys(dictionary)) {
    if (dictionary?.[locale]?.[removedKey]) {
      delete dictionary[locale][removedKey];
    }
  }
  setLabelDictionary(dictionary);
  markTargetLabelLocalesStale();
  setLabelItems(next);
  renderPlacementStage();
}

function selectLabel(labelKey) {
  state.selectedLabelKey = String(labelKey || "").trim();
  renderPlacementStage();
}

async function translateBaseMapLabels() {
  const items = currentLabelItems();
  if (!items.length) throw new Error("add labels first");
  const dictionary = currentLabelDictionary();
  const sourceDictionary = Object.fromEntries(
    items
      .map((item) => [item.label_key, String(dictionary?.th?.[item.label_key] || "").trim()])
      .filter(([, text]) => text)
  );
  if (!Object.keys(sourceDictionary).length) throw new Error("Thai source text is required before translate");
  const meta = currentLabelTranslationMeta();
  const layoutId = await ensureLabelLayoutForCurrentMap();
  const payload = await api(`/api/v2/transport/label-layouts/${layoutId}/labels/translate`, {
    method: "POST",
    body: JSON.stringify({
      dictionary: currentLabelDictionary(),
      label_translation: meta,
      target_locales: meta.target_locales,
      label_keys: items.map((item) => item.label_key),
    }),
  });
  setLabelDictionary(payload?.label_dictionary || dictionary);
  setLabelTranslationMeta(payload?.label_translation || meta);
  state.selectedLabelReviewLocale = currentReviewLocale();
  const translatedLocaleCount = Number(payload?.translated_locale_count || 0) || 0;
  setBanner(
    "label-translation-status",
    translatedLocaleCount > 0 ? "Missing translations updated" : "No missing translations to fill"
  );
  renderPlacementStage();
}

function markCurrentLabelLocaleReviewed() {
  const locale = currentReviewLocale();
  if (!locale || locale === "th") throw new Error("choose a target locale first");
  const items = currentLabelItems();
  const dictionary = currentLabelDictionary();
  const missing = items.filter((item) => !String(dictionary?.[locale]?.[item.label_key] || "").trim());
  if (missing.length) {
    throw new Error(`${locale} still has ${missing.length} label(s) without translated text`);
  }
  updateLabelLocaleStatus(locale, {
    status: "reviewed",
    reviewed: true,
    reviewed_at: new Date().toISOString(),
  });
  setBanner("label-translation-status", `${locale} marked reviewed`);
  renderLabelContentEditor();
  updateBaseMapEditorStatus();
}

function applyLabelContentDraftEdit(textarea) {
  const locale = String(textarea?.dataset?.labelLocale || "").trim().toLowerCase();
  const labelKey = String(textarea?.dataset?.labelKey || "").trim();
  if (!locale || !labelKey) return false;
  const nextText = textarea.value || "";
  upsertLabelDictionaryEntry(locale, labelKey, nextText);
  if (locale === "th") {
    updateLabelLocaleStatus("th", { status: "source", reviewed: true });
    markTargetLabelLocalesStale();
  } else {
    updateLabelLocaleStatus(locale, {
      status: String(nextText || "").trim() ? "draft" : "missing",
      reviewed: false,
      reviewed_at: null,
      reviewed_by: null,
    });
  }
  return true;
}

function selectedLabelStep() {
  const raw = Number(qs("placement-nudge-step")?.value || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 12;
}

function updateSelectedLabel(mutator) {
  if (!state.selectedLabelKey) throw new Error("Select a label first");
  const map = currentBaseMap();
  if (!map) throw new Error("No base map selected");
  const width = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const height = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  let found = false;
  const next = currentLabelItems().map((item) => {
    if (item.label_key !== state.selectedLabelKey) return item;
    found = true;
    const updated = mutator(item, { width, height });
    return {
      ...item,
      anchor_x: Math.max(0, Math.min(width, Number(updated?.anchor_x ?? item.anchor_x))),
      anchor_y: Math.max(0, Math.min(height, Number(updated?.anchor_y ?? item.anchor_y))),
    };
  });
  if (!found) throw new Error("Selected label was not found");
  setLabelItems(next);
  renderPlacementStage();
}

function baseRenderedImageRect() {
  const stage = qs("base-map-stage");
  const map = currentBaseMap();
  if (!stage || !map) return null;
  return computeBaseRenderedImageRect(stage.getBoundingClientRect(), map.viewbox, DEFAULT_VIEWBOX);
}

function renderedImageRect() {
  const stage = qs("base-map-stage");
  const map = currentBaseMap();
  if (!stage || !map) return null;
  return computeRenderedImageRect(stage.getBoundingClientRect(), map.viewbox, state.mapView, DEFAULT_VIEWBOX);
}

function clientPointToMapPoint(clientX, clientY) {
  const map = currentBaseMap();
  const imageRect = renderedImageRect();
  if (!map || !imageRect) return null;
  const width = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const height = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  const localX = Math.max(0, Math.min(clientX - imageRect.left, imageRect.width));
  const localY = Math.max(0, Math.min(clientY - imageRect.top, imageRect.height));
  return {
    x: Number(((localX / imageRect.width) * width).toFixed(2)),
    y: Number(((localY / imageRect.height) * height).toFixed(2)),
    width,
    height,
  };
}

function nextLabelAnchorPoint(clientX, clientY) {
  const map = currentBaseMap();
  const imageRect = renderedImageRect();
  if (!map || !imageRect) return null;
  const width = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const height = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  const deltaClientX = (Number(clientX) || 0) - (Number(state.labelDragPointer.startX) || 0);
  const deltaClientY = (Number(clientY) || 0) - (Number(state.labelDragPointer.startY) || 0);
  const deltaMapX = imageRect.width ? (deltaClientX / imageRect.width) * width : 0;
  const deltaMapY = imageRect.height ? (deltaClientY / imageRect.height) * height : 0;
  return {
    x: Math.max(0, Math.min(width, Number((Number(state.labelDragPointer.anchorStartX || 0) + deltaMapX).toFixed(2)))),
    y: Math.max(0, Math.min(height, Number((Number(state.labelDragPointer.anchorStartY || 0) + deltaMapY).toFixed(2)))),
    width,
    height,
  };
}

function previewDraggedLabelPosition(labelKey, anchorX, anchorY) {
  const nextLabelKey = String(labelKey || "").trim();
  if (!nextLabelKey) return;
  const map = currentBaseMap();
  const item = state.draggingLabelItem?.label_key === nextLabelKey
    ? state.draggingLabelItem
    : currentLabelItems().find((entry) => entry.label_key === nextLabelKey) || null;
  if (!map || !item) return;
  const localeOffset = state.draggingLabelItem?.label_key === nextLabelKey
    ? state.draggingLabelLocaleOffset
    : labelLocaleOffset(item);
  const textLabel = state.draggingLabelElement
    || qs("base-map-text-layer")?.querySelector(`[data-label-key="${nextLabelKey}"]`);
  const textPosition = mapPointToStagePercent(
    Number(anchorX) + Number(localeOffset.dx || 0),
    Number(anchorY) + Number(localeOffset.dy || 0),
    map
  );
  if (textLabel) {
    textLabel.classList.add("is-dragging");
    textLabel.style.left = `${textPosition.left}%`;
    textLabel.style.top = `${textPosition.top}%`;
  }
}

function updateLabelPosition(labelKey, clientX, clientY) {
  const map = currentBaseMap();
  const imageRect = renderedImageRect();
  if (!map || !imageRect) throw new Error("Preview is not ready");
  const nextLabelKey = String(labelKey || "").trim();
  if (!nextLabelKey) throw new Error("Select a label first");
  const anchorPoint = nextLabelAnchorPoint(clientX, clientY);
  if (!anchorPoint) throw new Error("Preview is not ready");
  const width = anchorPoint.width;
  const height = anchorPoint.height;
  const nextX = anchorPoint.x;
  const nextY = anchorPoint.y;
  const updated = currentLabelItems().map((item) => (
    item.label_key === nextLabelKey
      ? { ...item, anchor_x: nextX, anchor_y: nextY }
      : item
  ));
  state.selectedLabelKey = nextLabelKey;
  setLabelItems(updated);
  renderPlacementStage();
}

function updateOverlayPosition(overlayId, clientX, clientY) {
  const map = currentBaseMap();
  const imageRect = renderedImageRect();
  if (!map || !imageRect) throw new Error("preview is not ready");
  const nextOverlayId = String(overlayId || "").trim();
  if (!nextOverlayId) throw new Error("select overlay first");
  const width = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const height = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  const localX = Math.max(0, Math.min(clientX - imageRect.left, imageRect.width));
  const localY = Math.max(0, Math.min(clientY - imageRect.top, imageRect.height));
  const overlay = currentOverlayItems().find((item) => item.overlay_id === nextOverlayId) || null;
  const clamped = clampOverlayAnchor(
    Number(((localX / imageRect.width) * width).toFixed(2)),
    Number(((localY / imageRect.height) * height).toFixed(2)),
    overlay,
    map
  );
  const updated = currentOverlayItems().map((item) => (
    item.overlay_id === nextOverlayId
      ? { ...item, anchor_x: clamped.x, anchor_y: clamped.y }
      : item
  ));
  state.selectedOverlayId = nextOverlayId;
  setOverlayItems(updated);
  renderPlacementStage();
}

function nextOverlayAnchorPoint(clientX, clientY) {
  const map = currentBaseMap();
  const imageRect = renderedImageRect();
  if (!map || !imageRect) return null;
  const width = Number(map.viewbox?.width || DEFAULT_VIEWBOX.width) || DEFAULT_VIEWBOX.width;
  const height = Number(map.viewbox?.height || DEFAULT_VIEWBOX.height) || DEFAULT_VIEWBOX.height;
  const deltaClientX = (Number(clientX) || 0) - (Number(state.overlayDragPointer.startX) || 0);
  const deltaClientY = (Number(clientY) || 0) - (Number(state.overlayDragPointer.startY) || 0);
  const deltaMapX = imageRect.width ? (deltaClientX / imageRect.width) * width : 0;
  const deltaMapY = imageRect.height ? (deltaClientY / imageRect.height) * height : 0;
  return clampOverlayAnchor(
    Number((Number(state.overlayDragPointer.anchorStartX || 0) + deltaMapX).toFixed(2)),
    Number((Number(state.overlayDragPointer.anchorStartY || 0) + deltaMapY).toFixed(2)),
    state.draggingOverlayItem,
    map
  );
}

function previewDraggedOverlayPosition(overlayId, anchorX, anchorY) {
  const nextOverlayId = String(overlayId || "").trim();
  if (!nextOverlayId) return;
  const map = currentBaseMap();
  const overlay = state.draggingOverlayItem?.overlay_id === nextOverlayId
    ? state.draggingOverlayItem
    : currentOverlayItems().find((item) => item.overlay_id === nextOverlayId) || null;
  if (!map || !overlay) return;
  const overlayElement = state.draggingOverlayElement
    || qs("base-map-overlay-layer")?.querySelector(`[data-overlay-id="${nextOverlayId}"]`);
  const position = mapPointToStagePercent(anchorX, anchorY, map);
  if (overlayElement) {
    overlayElement.style.left = `${position.left}%`;
    overlayElement.style.top = `${position.top}%`;
  }
}

function beginLabelDrag(labelKey, clientX, clientY, element = null) {
  const nextLabelKey = String(labelKey || "").trim();
  const item = currentLabelItems().find((entry) => entry.label_key === nextLabelKey) || null;
  const localeOffset = item ? labelLocaleOffset(item) : { dx: 0, dy: 0 };
  state.pendingLabelDragKey = "";
  state.draggingLabelKey = nextLabelKey;
  state.draggingLabelElement = element;
  state.draggingLabelItem = item;
  state.draggingLabelLocaleOffset = {
    dx: Number(localeOffset.dx || 0) || 0,
    dy: Number(localeOffset.dy || 0) || 0,
  };
  state.suppressStageClick = true;
  state.labelDragPointer.startX = Number(clientX) || 0;
  state.labelDragPointer.startY = Number(clientY) || 0;
  state.labelDragPointer.anchorStartX = Number(item?.anchor_x || 0) || 0;
  state.labelDragPointer.anchorStartY = Number(item?.anchor_y || 0) || 0;
  state.labelDragPointer.currentX = state.labelDragPointer.anchorStartX;
  state.labelDragPointer.currentY = state.labelDragPointer.anchorStartY;
}

function activateLabelDrag(clientX, clientY) {
  if (!state.pendingLabelDragKey) return false;
  state.draggingLabelKey = state.pendingLabelDragKey;
  state.pendingLabelDragKey = "";
  state.suppressStageClick = true;
  const anchorPoint = nextLabelAnchorPoint(clientX, clientY);
  if (!anchorPoint) return false;
  state.labelDragPointer.currentX = anchorPoint.x;
  state.labelDragPointer.currentY = anchorPoint.y;
  previewDraggedLabelPosition(state.draggingLabelKey, anchorPoint.x, anchorPoint.y);
  return true;
}

function moveLabelDrag(clientX, clientY) {
  if (!state.draggingLabelKey) return;
  const anchorPoint = nextLabelAnchorPoint(clientX, clientY);
  if (!anchorPoint) return;
  state.labelDragPointer.currentX = anchorPoint.x;
  state.labelDragPointer.currentY = anchorPoint.y;
  previewDraggedLabelPosition(state.draggingLabelKey, anchorPoint.x, anchorPoint.y);
}

function endLabelDrag() {
  if (state.draggingLabelKey && state.labelDragPointer.currentX != null && state.labelDragPointer.currentY != null) {
    const didAnchorChange = !approximatelyEqualNumber(
      state.labelDragPointer.currentX,
      state.labelDragPointer.anchorStartX
    ) || !approximatelyEqualNumber(
      state.labelDragPointer.currentY,
      state.labelDragPointer.anchorStartY
    );
    if (didAnchorChange) {
      const updated = currentLabelItems().map((item) => (
        item.label_key === state.draggingLabelKey
          ? { ...item, anchor_x: state.labelDragPointer.currentX, anchor_y: state.labelDragPointer.currentY }
          : item
      ));
      setLabelItems(updated);
      renderPlacementStage({ refreshContentEditor: false });
    }
  }
  state.draggingLabelKey = "";
  state.pendingLabelDragKey = "";
  state.labelDragPointer.anchorStartX = 0;
  state.labelDragPointer.anchorStartY = 0;
  state.labelDragPointer.currentX = null;
  state.labelDragPointer.currentY = null;
  state.draggingLabelElement = null;
  state.draggingLabelItem = null;
  state.draggingLabelLocaleOffset = { dx: 0, dy: 0 };
}

function beginOverlayDrag(overlayId, clientX, clientY, element = null) {
  const nextOverlayId = String(overlayId || "").trim();
  const item = currentOverlayItems().find((entry) => entry.overlay_id === nextOverlayId) || null;
  state.draggingOverlayId = nextOverlayId;
  state.suppressStageClick = true;
  state.draggingOverlayElement = element;
  state.draggingOverlayItem = item;
  state.overlayDragPointer.startX = Number(clientX) || 0;
  state.overlayDragPointer.startY = Number(clientY) || 0;
  state.overlayDragPointer.anchorStartX = Number(item?.anchor_x || 0) || 0;
  state.overlayDragPointer.anchorStartY = Number(item?.anchor_y || 0) || 0;
  state.overlayDragPointer.currentX = state.overlayDragPointer.anchorStartX;
  state.overlayDragPointer.currentY = state.overlayDragPointer.anchorStartY;
}

function moveOverlayDrag(clientX, clientY) {
  if (!state.draggingOverlayId) return;
  const anchorPoint = nextOverlayAnchorPoint(clientX, clientY);
  if (!anchorPoint) return;
  state.overlayDragPointer.currentX = anchorPoint.x;
  state.overlayDragPointer.currentY = anchorPoint.y;
  previewDraggedOverlayPosition(state.draggingOverlayId, anchorPoint.x, anchorPoint.y);
}

function endOverlayDrag() {
  if (state.draggingOverlayId && state.overlayDragPointer.currentX != null && state.overlayDragPointer.currentY != null) {
    const didAnchorChange = !approximatelyEqualNumber(
      state.overlayDragPointer.currentX,
      state.overlayDragPointer.anchorStartX
    ) || !approximatelyEqualNumber(
      state.overlayDragPointer.currentY,
      state.overlayDragPointer.anchorStartY
    );
    if (didAnchorChange) {
      const updated = currentOverlayItems().map((item) => (
        item.overlay_id === state.draggingOverlayId
          ? { ...item, anchor_x: state.overlayDragPointer.currentX, anchor_y: state.overlayDragPointer.currentY }
          : item
      ));
      setOverlayItems(updated);
      renderPlacementStage();
    }
  }
  state.draggingOverlayId = "";
  state.overlayDragPointer.startX = 0;
  state.overlayDragPointer.startY = 0;
  state.overlayDragPointer.anchorStartX = 0;
  state.overlayDragPointer.anchorStartY = 0;
  state.overlayDragPointer.currentX = null;
  state.overlayDragPointer.currentY = null;
  state.draggingOverlayElement = null;
  state.draggingOverlayItem = null;
}

function syncGeneratedBaseMapSummaryToggle() {
  const details = qs("generated-base-map-summary");
  const button = qs("btn-toggle-generated-base-map-summary");
  if (!details || !button) return;
  button.textContent = details.open ? "Collapse" : "Expand";
}

async function init() {
  try {
    const { role } = await requireAdminShell();
    if (role !== "owner") {
      window.location.replace("/transport-v2-routes.html");
      return;
    }
    await refresh();
  } catch (error) {
    setBanner("workspace-status", error.message || "Failed to load page", true);
    return;
  }

  qs("btn-back-home")?.addEventListener("click", () => { window.location.href = "/"; });
  qs("btn-process-home")?.addEventListener("click", () => { window.location.href = "/transport.html"; });
  qs("btn-open-routes")?.addEventListener("click", () => { window.location.href = "/transport-v2-routes.html"; });
  qs("generated-base-map-summary-head")?.addEventListener("click", (event) => {
    if (event.target?.id !== "btn-toggle-generated-base-map-summary") {
      event.preventDefault();
    }
  });
  qs("btn-toggle-generated-base-map-summary")?.addEventListener("click", (event) => {
    event.preventDefault();
    const details = qs("generated-base-map-summary");
    if (!details) return;
    details.open = !details.open;
    syncGeneratedBaseMapSummaryToggle();
  });
  qs("generated-base-map-summary")?.addEventListener("toggle", () => {
    syncGeneratedBaseMapSummaryToggle();
  });
  qs("btn-generated-base-map-zoom-in")?.addEventListener("click", () => { zoomGeneratedPreview(0.25); });
  qs("btn-generated-base-map-zoom-out")?.addEventListener("click", () => { zoomGeneratedPreview(-0.25); });
  qs("btn-generated-base-map-reset-view")?.addEventListener("click", () => { resetGeneratedPreview(); });
  qs("btn-generated-base-map-fullscreen")?.addEventListener("click", async () => {
    try {
      await toggleGeneratedPreviewFullscreen();
    } catch (error) {
      setBanner("base-map-status", error.message || "Failed to enter full screen", true);
    }
  });

  qs("generated-base-map-viewport")?.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomGeneratedPreview(event.deltaY < 0 ? 0.2 : -0.2);
  }, { passive: false });

  qs("generated-base-map-viewport")?.addEventListener("pointerdown", (event) => {
    beginGeneratedPreviewDrag(event.clientX, event.clientY);
  });

  window.addEventListener("pointermove", (event) => {
    moveGeneratedPreviewDrag(event.clientX, event.clientY);
  });

  window.addEventListener("pointerup", () => {
    endGeneratedPreviewDrag();
  });

  window.addEventListener("pointercancel", () => {
    endGeneratedPreviewDrag();
  });

  document.addEventListener("fullscreenchange", () => {
    syncGeneratedPreviewFullscreenState();
    updateGeneratedPreviewTransform();
  });

  qs("btn-create-base-map")?.addEventListener("click", async () => {
    try {
      setBanner("base-map-status", "Creating...");
      const created = await createBaseMap();
      state.selectedBaseMapId = Number(created?.id || 0) || 0;
      await refresh();
      setBanner("base-map-status", "Base map created");
    } catch (error) {
      setBanner("base-map-status", error.message || "Failed to create base map", true);
    }
  });

  qs("btn-save-base-map")?.addEventListener("click", async () => {
    try {
      const attachedLayoutId = Number(state.selectedLabelLayoutId || currentBaseMap()?.active_label_layout_id || 0) || 0;
      setBanner("base-map-status", attachedLayoutId ? "Saving base map and map labels..." : "Saving base map...");
      await saveBaseMapWorkspace();
      await refresh();
      setBanner("base-map-status", attachedLayoutId ? "Base map and map labels saved" : "Base map saved");
    } catch (error) {
      setBanner("base-map-status", error.message || "Failed to save base map", true);
    }
  });

  qs("btn-render-base-map-annotation")?.addEventListener("click", async () => {
    try {
      setBanner("base-map-status", "Saving draft and rendering annotation map...");
      await saveBaseMapWorkspace();
      await renderBaseMapAnnotation();
      await refresh();
      setBanner("base-map-status", "Annotation map rendered");
    } catch (error) {
      setBanner("base-map-status", error.message || "Failed to render annotation map", true);
    }
  });

  qs("btn-create-label-layout")?.addEventListener("click", async () => {
    try {
      setBanner("label-layout-status", "Creating label layout...");
      const created = await createLabelLayout();
      state.selectedLabelLayoutId = Number(created?.id || 0) || 0;
      const map = currentBaseMap();
      if (map) {
        map.active_label_layout_id = state.selectedLabelLayoutId || null;
        qs("base-map-active-label-layout-id").value = state.selectedLabelLayoutId ? String(state.selectedLabelLayoutId) : "";
      }
      await saveBaseMapLabels();
      if (map?.id) {
        await updateBaseMap();
      }
      await refresh();
      setBanner("label-layout-status", map?.id ? "Label layout created and attached to the selected base map" : "Label layout created");
    } catch (error) {
      setBanner("label-layout-status", error.message || "Failed to create label layout", true);
    }
  });

  qs("btn-save-label-layout")?.addEventListener("click", async () => {
    try {
      setBanner("label-layout-status", "Saving label layout...");
      await saveLabelLayoutWorkspace();
      await refresh();
      setBanner("label-layout-status", "Label layout saved");
    } catch (error) {
      setBanner("label-layout-status", error.message || "Failed to save label layout", true);
    }
  });

  qs("btn-save-base-map-labels")?.addEventListener("click", async () => {
    try {
      setBanner("base-map-status", "Saving labels...");
      if (hasUnsavedOverlayChanges()) {
        throw new Error("save base map first to keep overlay changes");
      }
      await saveBaseMapLabels();
      await refresh();
      setBanner("base-map-status", "Labels saved");
    } catch (error) {
      setBanner("base-map-status", error.message || "Failed to save labels", true);
    }
  });

  qs("btn-new-base-map-draft")?.addEventListener("click", () => {
    setBanner("base-map-status", "");
    resetBaseMapFormToDefaults();
  });

  qs("btn-load-generated-base-map-r1")?.addEventListener("click", () => {
    loadGeneratedBaseMapPreset();
    setBanner("base-map-status", "Loaded generated base map v1 r1 into the form");
  });

  qs("btn-upload-base-map-overlay")?.addEventListener("click", () => {
    qs("base-map-overlay-upload-input")?.click();
  });
  qs("btn-remove-base-map-overlay")?.addEventListener("click", () => {
    try {
      removeSelectedOverlay();
      setBanner("base-map-overlay-status", "Selected overlay removed");
    } catch (error) {
      setBanner("base-map-overlay-status", error.message || "Remove overlay failed", true);
    }
  });
  qs("base-map-overlay-width")?.addEventListener("input", (event) => {
    const nextWidth = Number(event.target.value || 0);
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
    try {
      updateSelectedOverlay((item) => ({
        ...item,
        width: nextWidth,
        height: nextWidth / (Number(item.aspect_ratio || 1) || 1),
      }));
    } catch (error) {
      setBanner("base-map-overlay-status", error.message || "Resize overlay failed", true);
    }
  });
  qs("base-map-overlay-upload-input")?.addEventListener("change", async (event) => {
    const file = event.target?.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const fileUrl = URL.createObjectURL(file);
      const dimensions = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          resolve({ width: Number(image.naturalWidth || 0) || 1, height: Number(image.naturalHeight || 0) || 1 });
          URL.revokeObjectURL(fileUrl);
        };
        image.onerror = () => {
          URL.revokeObjectURL(fileUrl);
          reject(new Error("unable to read overlay image size"));
        };
        image.src = fileUrl;
      });
      setBanner("base-map-overlay-status", "Uploading overlay image...");
      const uploaded = await uploadBaseMapOverlayImage(file);
      insertOverlayItem({
        asset_id: uploaded?.asset_id,
        asset_url: uploaded?.asset_url,
        natural_width: dimensions.width,
        natural_height: dimensions.height,
      });
      setBanner("base-map-overlay-status", "Overlay image inserted. Drag it on the map and save the base map.");
    } catch (error) {
      setBanner("base-map-overlay-status", formatBaseMapOverlayUploadError(error), true);
    }
  });

  syncGeneratedPreviewFullscreenState();
  syncGeneratedBaseMapSummaryToggle();
  syncPlacementCategoryFromKey();
  updateGeneratedPreviewTransform();

  qs("base-map-editor-select")?.addEventListener("change", (event) => {
    state.selectedBaseMapId = Number(event.target.value || 0) || 0;
    renderBaseMaps();
    fillBaseMapForm(currentBaseMap());
  });

  qs("label-layout-select")?.addEventListener("change", (event) => {
    state.selectedLabelLayoutId = Number(event.target.value || 0) || 0;
    const map = currentBaseMap();
    if (map) {
      map.active_label_layout_id = state.selectedLabelLayoutId || null;
    }
    qs("base-map-active-label-layout-id").value = state.selectedLabelLayoutId ? String(state.selectedLabelLayoutId) : "";
    fillLabelLayoutForm(currentLabelLayout(), map);
    renderBaseMaps();
    renderPlacementStage();
    updateBaseMapEditorStatus();
  });

  qs("btn-open-base-map-placement")?.addEventListener("click", async () => {
    try {
      await openBaseMapPlacement();
    } catch (error) {
      setBanner("base-map-status", error.message || "Failed to open placement", true);
    }
  });

  qs("placement-preview-locale")?.addEventListener("change", () => {
    const locale = currentPreviewLocale();
    if (locale !== "th" && qs("label-review-locale")) {
      qs("label-review-locale").value = locale;
      state.selectedLabelReviewLocale = locale;
    }
    renderPlacementStage();
  });

  ["label-style-font-family", "label-style-text-color", "label-style-size-preset", "label-style-scale-with-zoom"].forEach((id) => {
    qs(id)?.addEventListener("change", () => {
      applyLabelStyleDraft();
    });
  });

  qs("base-map-label-dictionary")?.addEventListener("input", () => {
    renderPlacementStage();
  });

  qs("base-map-label-translation-meta")?.addEventListener("input", () => {
    renderLabelContentEditor();
    updateBaseMapEditorStatus();
  });

  qs("placement-label-key")?.addEventListener("input", () => {
    syncPlacementCategoryFromKey();
  });

  qs("placement-label-category")?.addEventListener("change", () => {
    rewritePlacementKeyFromCategory();
    syncPlacementCategoryFromKey();
  });

  qs("btn-translate-base-map-labels")?.addEventListener("click", async () => {
    try {
      setBanner("label-translation-status", "Translating missing labels...");
      await translateBaseMapLabels();
    } catch (error) {
      setBanner("label-translation-status", error.message || "Translate failed", true);
    }
  });

  qs("btn-mark-label-locale-reviewed")?.addEventListener("click", () => {
    try {
      markCurrentLabelLocaleReviewed();
    } catch (error) {
      setBanner("label-translation-status", error.message || "Mark reviewed failed", true);
    }
  });

  qs("label-review-locale")?.addEventListener("change", (event) => {
    state.selectedLabelReviewLocale = String(event.target.value || "en").trim().toLowerCase() || "en";
    if (qs("placement-preview-locale")) {
      qs("placement-preview-locale").value = state.selectedLabelReviewLocale;
    }
    renderPlacementStage();
  });
  qs("label-content-set-editor")?.addEventListener("input", (event) => {
    const textarea = event.target.closest("textarea[data-label-locale][data-label-key]");
    if (!textarea) return;
    applyLabelContentDraftEdit(textarea);
  });
  qs("label-content-set-editor")?.addEventListener("change", (event) => {
    const textarea = event.target.closest("textarea[data-label-locale][data-label-key]");
    if (!textarea) return;
    applyLabelContentDraftEdit(textarea);
    renderPlacementStage();
  });

  qs("base-map-table")?.querySelector("tbody")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='edit-base-map']");
    if (!button) return;
    state.selectedBaseMapId = Number(button.dataset.id || 0) || 0;
    renderBaseMaps();
    fillBaseMapForm(currentBaseMap());
  });

  qs("btn-add-placement-label")?.addEventListener("click", () => {
    try {
      addPlacementLabel();
      setBanner("base-map-placement-status", "Label added near the center. Drag the label to position it.");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to add label", true);
    }
  });

  qs("btn-remove-placement-label")?.addEventListener("click", () => {
    try {
      removeSelectedLabel();
      setBanner("base-map-placement-status", "Selected label removed");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to remove label", true);
    }
  });

  qs("btn-nudge-up")?.addEventListener("click", () => {
    try {
      const step = selectedLabelStep();
      updateSelectedLabel((item) => ({ ...item, anchor_y: Number(item.anchor_y) - step }));
      setBanner("base-map-placement-status", "Moved label up");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to move label", true);
    }
  });

  qs("btn-nudge-left")?.addEventListener("click", () => {
    try {
      const step = selectedLabelStep();
      updateSelectedLabel((item) => ({ ...item, anchor_x: Number(item.anchor_x) - step }));
      setBanner("base-map-placement-status", "Moved label left");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to move label", true);
    }
  });

  qs("btn-nudge-right")?.addEventListener("click", () => {
    try {
      const step = selectedLabelStep();
      updateSelectedLabel((item) => ({ ...item, anchor_x: Number(item.anchor_x) + step }));
      setBanner("base-map-placement-status", "Moved label right");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to move label", true);
    }
  });

  qs("btn-nudge-down")?.addEventListener("click", () => {
    try {
      const step = selectedLabelStep();
      updateSelectedLabel((item) => ({ ...item, anchor_y: Number(item.anchor_y) + step }));
      setBanner("base-map-placement-status", "Moved label down");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to move label", true);
    }
  });

  qs("btn-align-center-x")?.addEventListener("click", () => {
    try {
      updateSelectedLabel((item, viewbox) => ({ ...item, anchor_x: viewbox.width / 2 }));
      setBanner("base-map-placement-status", "Centered label on X");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to center label on X", true);
    }
  });

  qs("btn-align-center-y")?.addEventListener("click", () => {
    try {
      updateSelectedLabel((item, viewbox) => ({ ...item, anchor_y: viewbox.height / 2 }));
      setBanner("base-map-placement-status", "Centered label on Y");
    } catch (error) {
      setBanner("base-map-placement-status", error.message || "Failed to center label on Y", true);
    }
  });

  qs("base-map-stage")?.addEventListener("click", () => {
    if (state.suppressStageClick) {
      state.suppressStageClick = false;
    }
  });

  qs("base-map-text-layer")?.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-action='select-label']");
    if (!button) return;
    if (event.button !== 0) return;
    const labelKey = String(button.dataset.labelKey || "").trim();
    event.preventDefault();
    event.stopPropagation();
    button.setPointerCapture?.(event.pointerId);
    state.selectedLabelKey = labelKey;
    beginLabelDrag(labelKey, event.clientX, event.clientY, button);
    updateBaseMapEditorStatus();
  });

  qs("base-map-overlay-layer")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='select-overlay-image']");
    if (!button) return;
    selectOverlay(button.dataset.overlayId);
  });

  qs("base-map-overlay-layer")?.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-action='select-overlay-image']");
    if (!button) return;
    if (event.button !== 0) return;
    if (event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    button.setPointerCapture?.(event.pointerId);
    state.selectedOverlayId = String(button.dataset.overlayId || "").trim();
    beginOverlayDrag(button.dataset.overlayId, event.clientX, event.clientY, button);
    setBanner("base-map-overlay-status", "Dragging overlay...");
  });

  qs("base-map-label-list")?.addEventListener("change", (event) => {
    const select = event.target.closest("#base-map-label-select");
    if (!select) return;
    selectLabel(select.value);
  });

  qs("base-map-overlay-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='select-overlay']");
    if (!button) return;
    selectOverlay(button.dataset.overlayId);
  });
}

function bindBaseMapWorkspaceChrome() {
  bindBaseMapDirtyTracking();
  syncBaseMapEditorFullscreenState();
  updateBaseMapViewportTransform();
  renderLabelStylePreview();
  updateBaseMapEditorStatus();
  bindFullscreenPadProxy("btn-fs-nudge-up", "btn-nudge-up");
  bindFullscreenPadProxy("btn-fs-nudge-left", "btn-nudge-left");
  bindFullscreenPadProxy("btn-fs-nudge-right", "btn-nudge-right");
  bindFullscreenPadProxy("btn-fs-nudge-down", "btn-nudge-down");
  bindFullscreenPadProxy("btn-fs-align-center-x", "btn-align-center-x");
  bindFullscreenPadProxy("btn-fs-align-center-y", "btn-align-center-y");

  qs("btn-base-map-zoom-in")?.addEventListener("click", () => { zoomBaseMapViewport(0.25); });
  qs("btn-base-map-zoom-out")?.addEventListener("click", () => { zoomBaseMapViewport(-0.25); });
  qs("btn-base-map-reset-view")?.addEventListener("click", () => { resetBaseMapViewport(); });
  qs("btn-base-map-fit-view")?.addEventListener("click", () => { fitBaseMapViewportToLabels(); });
  qs("btn-base-map-fullscreen")?.addEventListener("click", async () => {
    try {
      await toggleBaseMapEditorFullscreen();
    } catch (error) {
      setBanner("base-map-status", error.message || "Editor fullscreen failed", true);
    }
  });

  qs("base-map-stage")?.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomBaseMapViewport(event.deltaY < 0 ? 0.2 : -0.2);
  }, { passive: false });

  qs("base-map-stage")?.addEventListener("pointerdown", (event) => {
    if (state.draggingLabelKey || state.pendingLabelDragKey) return;
    if (event.button !== 0 && event.button !== 2) return;
    if (event.target.closest("[data-action='select-label']")) return;
    if (event.button === 0 && event.target.closest("[data-action='select-overlay-image']")) return;
    event.preventDefault();
    beginBaseMapPan(event.clientX, event.clientY);
  });

  qs("base-map-stage")?.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  window.addEventListener("pointermove", (event) => {
    if (state.draggingOverlayId) {
      moveOverlayDrag(event.clientX, event.clientY);
      return;
    }
    if (state.draggingLabelKey || state.pendingLabelDragKey) {
      moveLabelDrag(event.clientX, event.clientY);
      return;
    }
    moveBaseMapPan(event.clientX, event.clientY);
  });

  window.addEventListener("pointerup", () => {
    if (state.draggingOverlayId) {
      endOverlayDrag();
      setBanner("base-map-overlay-status", "Overlay position updated");
      return;
    }
    if (state.draggingLabelKey || state.pendingLabelDragKey) {
      const didDrag = Boolean(state.draggingLabelKey);
      endLabelDrag();
      if (didDrag) {
        setBanner("base-map-placement-status", "Updated label position in JSON");
      }
      return;
    }
    const didPan = endBaseMapPan();
    if (didPan === false && state.selectedLabelKey) {
      setBanner("base-map-placement-status", `Selected ${state.selectedLabelKey}. Drag label to move.`);
    }
  });

  window.addEventListener("pointercancel", () => {
    if (state.draggingOverlayId) {
      endOverlayDrag();
      setBanner("base-map-overlay-status", "Overlay drag cancelled");
      return;
    }
    if (state.draggingLabelKey || state.pendingLabelDragKey) {
      endLabelDrag();
      setBanner("base-map-placement-status", "Label drag cancelled");
      return;
    }
    endBaseMapPan();
  });

  document.addEventListener("fullscreenchange", () => {
    syncBaseMapEditorFullscreenState();
    if (state.mapView.panning) {
      const limits = measureBaseMapPanLimits(state.mapView.scale);
      state.mapView.panMaxOffsetX = limits.maxOffsetX;
      state.mapView.panMaxOffsetY = limits.maxOffsetY;
    }
    updateBaseMapViewportTransform();
  });
  window.addEventListener("resize", () => {
    if (state.mapView.panning) {
      const limits = measureBaseMapPanLimits(state.mapView.scale);
      state.mapView.panMaxOffsetX = limits.maxOffsetX;
      state.mapView.panMaxOffsetY = limits.maxOffsetY;
    }
    updateBaseMapViewportTransform();
    updateBaseMapFullscreenLayout();
  });
}

bindBaseMapWorkspaceChrome();
init();

