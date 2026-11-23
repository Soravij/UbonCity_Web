import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import express from "express";
import multer from "multer";
import { resolveAiConfig, resolveAiFeatureConfig } from "../config/ai.mjs";
import { executeBackendAiJson } from "../services/backend-ai-client.mjs";
import { buildTransportBundle } from "./transport-v2-publish.mjs";
import { buildLegBearings, detourWarnings, fetchRouteWithFallback } from "./transport-v2-osrm.mjs";
import { pickLeastUsed, pickForPath } from "./public/transport-v2-palette.js";
const VEHICLES = new Set(["songthaew", "minibus", "van", "bus"]);
const ROUTE_LEGS = new Set(["out", "back"]);
const ROUTE_KINDS = new Set(["loop", "out_back"]);
const DEFAULT_COLOR = "#ff6600";

export function normalizeLeg(v) {
  if (v == null || v === "") return null;
  if (!ROUTE_LEGS.has(v)) throw new Error("leg is invalid");
  return v;
}
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
const LABEL_STYLE_SVG_FONT_SIZES = { s: 24, m: 28, l: 32 };

function actorEmail(req) {
  return String(req?.authUser?.email || "system@local").trim().toLowerCase() || "system@local";
}

function allow(...roles) {
  const allowed = new Set(roles.map((role) => String(role || "").trim().toLowerCase()));
  return (req, res, next) => {
    const role = String(req?.authUser?.role || "").trim().toLowerCase();
    if (allowed.has(role)) return next();
    res.status(403).json({ error: "Forbidden" });
  };
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function num(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function color(value, fallback = DEFAULT_COLOR) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const next = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(next) ? next.toLowerCase() : fallback;
}

function vehicle(value) {
  const raw = String(value || "").trim().toLowerCase();
  return VEHICLES.has(raw) ? raw : "songthaew";
}

function fare(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error("fare_baht ไม่ถูกต้อง");
  return Math.round(n * 100) / 100;
}

function asJson(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function json(value, fallback = "[]") {
  try { return JSON.stringify(value); } catch { return fallback; }
}

function normalizeLabelStyleColor(value, fallback = DEFAULT_LABEL_STYLE.global.text_color) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const next = raw.startsWith("#") ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(next) ? next.toLowerCase() : fallback;
}

function normalizeLabelStyleSize(value, fallback = DEFAULT_LABEL_STYLE.global.size_preset) {
  const next = String(value || "").trim().toLowerCase();
  return ["s", "m", "l"].includes(next) ? next : fallback;
}

function normalizeLabelStyleZoomScale(value, fallback = DEFAULT_LABEL_STYLE.global.zoom_scale) {
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
    text_color: normalizeLabelStyleColor(raw.text_color, fallback.text_color || DEFAULT_LABEL_STYLE.global.text_color),
    size_preset: normalizeLabelStyleSize(raw.size_preset || fallback.size_preset),
    scale_with_zoom: raw.scale_with_zoom == null ? Boolean(fallback.scale_with_zoom) : Boolean(raw.scale_with_zoom),
    zoom_scale: normalizeLabelStyleZoomScale(raw.zoom_scale, fallback.zoom_scale || DEFAULT_LABEL_STYLE.global.zoom_scale),
  };
}

function normalizeLabelStyle(value) {
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

function resolveLabelStyleForCategory(labelStyle, category) {
  const normalized = normalizeLabelStyle(labelStyle || DEFAULT_LABEL_STYLE);
  const categoryKey = String(category || "").trim().toLowerCase();
  return normalized.categories?.[categoryKey] || normalized.global;
}

function labelStyleSvgFontSize(style = DEFAULT_LABEL_STYLE.global) {
  return LABEL_STYLE_SVG_FONT_SIZES[normalizeLabelStyleSize(style?.size_preset)] || LABEL_STYLE_SVG_FONT_SIZES.m;
}

function normalizeLocaleOffsetEntry(value) {
  const raw = value && typeof value === "object" ? value : {};
  const dx = num(raw.dx, 0);
  const dy = num(raw.dy, 0);
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
      const localeKey = String(locale || "").trim();
      if (!localeKey) return null;
      const normalized = normalizeLocaleOffsetEntry(offset);
      if (!normalized) return null;
      return [localeKey, normalized];
    })
    .filter(Boolean);
  return entries.length ? Object.fromEntries(entries) : null;
}

function normalizeLabelLayoutMetadata(value) {
  const raw = value && typeof value === "object" ? { ...value } : {};
  const labelDictionary = normalizeLabelDictionary(raw.label_dictionary || {});
  const labelTranslation = normalizeLabelTranslationMeta(raw.label_translation || {}, labelDictionary);
  const labelStyle = normalizeLabelStyle(raw.label_style || DEFAULT_LABEL_STYLE);
  return {
    ...(raw && typeof raw === "object" ? raw : {}),
    label_dictionary: labelDictionary,
    label_translation: labelTranslation,
    label_style: labelStyle,
  };
}

function stripLegacyLabelMetadata(value) {
  const raw = value && typeof value === "object" ? { ...value } : {};
  delete raw.label_dictionary;
  delete raw.label_translation;
  delete raw.label_style;
  return raw;
}

export function normalizePoint(row, index = 0) {
  const lat = num(row?.lat);
  const lng = num(row?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    order: index,
    lat,
    lng,
    label: String(row?.label || "").trim(),
    note: String(row?.note || "").trim(),
    leg: normalizeLeg(row?.leg),
  };
}

function normalizePoints(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(normalizePoint).filter(Boolean).map((row, index) => ({ ...row, order: index }));
}

export function normalizeStops(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const point = normalizePoint(row, index);
      if (!point) return null;
      return {
        ...point,
        name: String(row?.name || `Stop ${index + 1}`).trim() || `Stop ${index + 1}`,
        stop_type: String(row?.stop_type || "stop").trim().toLowerCase() || "stop",
        leg: normalizeLeg(row?.leg),
      };
    })
    .filter(Boolean)
    .map((row, index) => ({ ...row, order: index }));
}

function bbox(points = []) {
  if (!Array.isArray(points) || !points.length) return null;
  let minLat = points[0].lat; let minLng = points[0].lng; let maxLat = points[0].lat; let maxLng = points[0].lng;
  for (const point of points.slice(1)) {
    minLat = Math.min(minLat, point.lat); minLng = Math.min(minLng, point.lng);
    maxLat = Math.max(maxLat, point.lat); maxLng = Math.max(maxLng, point.lng);
  }
  return { min_lat: minLat, min_lng: minLng, max_lat: maxLat, max_lng: maxLng };
}

function km(points = []) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    total += 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  return Number(total.toFixed(2));
}

function mapShape(baseMap) {
  return {
    bounds: {
      min_lat: Number(baseMap.bounds_min_lat),
      min_lng: Number(baseMap.bounds_min_lng),
      max_lat: Number(baseMap.bounds_max_lat),
      max_lng: Number(baseMap.bounds_max_lng),
    },
    viewbox: {
      x: Number(baseMap.viewbox_x),
      y: Number(baseMap.viewbox_y),
      width: Number(baseMap.viewbox_width),
      height: Number(baseMap.viewbox_height),
    },
  };
}

function assetUrl(db, assetId) {
  const id = Number(assetId || 0) || 0;
  if (!id) return "";
  const asset = db.prepare("SELECT storage_path FROM assets WHERE id=? LIMIT 1").get(id);
  const storagePath = String(asset?.storage_path || "").trim();
  if (!storagePath) return "";
  return `/media/${storagePath.replace(/\\/g, "/")}`;
}

function assetStoragePath(db, assetId) {
  const id = Number(assetId || 0) || 0;
  if (!id) return "";
  const asset = db.prepare("SELECT storage_path FROM assets WHERE id=? LIMIT 1").get(id);
  return String(asset?.storage_path || "").trim();
}

function detectImageMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (
    buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return "";
}

function readImageDimensions(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error("image payload is empty");
  }
  if (mimeType === "image/png") {
    if (buffer.length < 24) throw new Error("png payload is truncated");
    const chunkLength = buffer.readUInt32BE(8);
    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkLength !== 13 || chunkType !== "IHDR") throw new Error("png header is invalid");
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height) throw new Error("png dimensions are invalid");
    return { width, height };
  }
  if (mimeType === "image/jpeg") {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("jpeg header is invalid");
    let offset = 2;
    while (offset + 3 < buffer.length) {
      while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
      if (offset + 3 >= buffer.length) break;
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) throw new Error("jpeg payload is truncated");
      if (
        (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (segmentLength < 7) throw new Error("jpeg frame header is invalid");
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        if (!width || !height) throw new Error("jpeg dimensions are invalid");
        return { width, height };
      }
      offset += segmentLength;
    }
    throw new Error("jpeg dimensions could not be read");
  }
  if (mimeType === "image/webp") {
    if (buffer.length < 30) throw new Error("webp payload is truncated");
    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkType === "VP8X") {
      if (buffer.length < 30) throw new Error("webp vp8x payload is truncated");
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      if (!width || !height) throw new Error("webp dimensions are invalid");
      return { width, height };
    }
    if (chunkType === "VP8 ") {
      if (buffer.length < 30) throw new Error("webp vp8 payload is truncated");
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      if (!width || !height) throw new Error("webp dimensions are invalid");
      return { width, height };
    }
    if (chunkType === "VP8L") {
      if (buffer.length < 25) throw new Error("webp vp8l payload is truncated");
      if (buffer[20] !== 0x2f) throw new Error("webp vp8l header is invalid");
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (!width || !height) throw new Error("webp dimensions are invalid");
      return { width, height };
    }
    throw new Error("webp chunk type is unsupported");
  }
  throw new Error("unsupported image mime type");
}

function parseTargetLangs() {
  return [...new Set(
    String(process.env.TRANSLATION_TARGET_LANGS || "en,zh,lo")
      .trim()
      .split(",")
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .filter((value) => value !== "th")
  )];
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
  const targetLocales = [...new Set([
    ...parseTargetLangs(),
    ...(Array.isArray(raw?.target_locales) ? raw.target_locales : []),
    ...Object.keys(dictionary).filter((locale) => locale !== "th"),
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).filter((value) => value !== "th"))];
  const localeStatuses = { th: { status: "source", reviewed: true } };
  for (const locale of targetLocales) {
    const existing = raw?.locale_statuses?.[locale] && typeof raw.locale_statuses[locale] === "object"
      ? raw.locale_statuses[locale]
      : {};
    const hasText = Object.keys(dictionary?.[locale] || {}).length > 0;
    localeStatuses[locale] = {
      status: String(existing.status || (hasText ? "translated" : "missing")).trim().toLowerCase() || "missing",
      reviewed: Boolean(existing.reviewed) || String(existing.status || "").trim().toLowerCase() === "reviewed",
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

function parseJsonLike(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function extractResponseText(data) {
  const direct = data?.choices?.[0]?.message?.content;
  if (direct) return String(direct).trim();
  return "";
}

function assetExists(db, assetId) {
  const id = Number(assetId || 0) || 0;
  if (!id) return false;
  return Boolean(db.prepare("SELECT id FROM assets WHERE id=? LIMIT 1").get(id)?.id);
}

function assetRecord(db, assetId) {
  const id = Number(assetId || 0) || 0;
  if (!id) return null;
  return db.prepare("SELECT id, storage_path, mime_type, file_name FROM assets WHERE id=? LIMIT 1").get(id) || null;
}

function pathToSvg(points, baseMap) {
  const { bounds, viewbox } = mapShape(baseMap);
  const latSpan = bounds.max_lat - bounds.min_lat || 1;
  const lngSpan = bounds.max_lng - bounds.min_lng || 1;
  return points.map((point, index) => {
    const x = viewbox.x + ((point.lng - bounds.min_lng) / lngSpan) * viewbox.width;
    const y = viewbox.y + (1 - (point.lat - bounds.min_lat) / latSpan) * viewbox.height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function normalizeBaseMapOverlays(db, baseMap, value, options = {}) {
  const { includeAssetUrl = false } = options;
  const viewboxWidth = Number(baseMap?.viewbox_width || baseMap?.viewbox?.width || 4000) || 4000;
  const viewboxHeight = Number(baseMap?.viewbox_height || baseMap?.viewbox?.height || 5600) || 5600;
  return (Array.isArray(value) ? value : [])
    .map((row, index) => {
      const assetId = Number(row?.asset_id || 0) || 0;
      if (!assetId || !assetExists(db, assetId)) return null;
      const anchorX = num(row?.anchor_x);
      const anchorY = num(row?.anchor_y);
      const width = num(row?.width);
      const naturalWidth = num(row?.natural_width, 0);
      const naturalHeight = num(row?.natural_height, 0);
      const aspectRatio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1;
      const height = num(row?.height, width / aspectRatio);
      if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
      return {
        overlay_id: String(row?.overlay_id || `overlay_${index + 1}`).trim() || `overlay_${index + 1}`,
        kind: "image",
        asset_id: assetId,
        ...(includeAssetUrl ? { asset_url: assetUrl(db, assetId) } : {}),
        anchor_x: Math.max(0, Math.min(viewboxWidth, anchorX)),
        anchor_y: Math.max(0, Math.min(viewboxHeight, anchorY)),
        width: Math.max(1, Math.min(viewboxWidth, width)),
        height: Math.max(1, Math.min(viewboxHeight, height)),
        natural_width: naturalWidth > 0 ? naturalWidth : Math.max(1, width),
        natural_height: naturalHeight > 0 ? naturalHeight : Math.max(1, height),
        scale_with_zoom: row?.scale_with_zoom == null ? true : Boolean(row.scale_with_zoom),
      };
    })
    .filter(Boolean);
}

function localeTextsForLabel(labelKey, dictionary) {
  const source = dictionary && typeof dictionary === "object" ? dictionary : {};
  const entries = Object.entries(source)
    .map(([locale, labels]) => {
      const localeKey = String(locale || "").trim().toLowerCase();
      const text = String(labels?.[labelKey] || "").trim();
      if (!localeKey || !text) return null;
      return [localeKey, text];
    })
    .filter(Boolean);
  return entries.length ? Object.fromEntries(entries) : {};
}

function annotationRenderLabelLayer(labelSource) {
  const metadata = labelSource?.metadata && typeof labelSource.metadata === "object"
    ? labelSource.metadata
    : {};
  const dictionary = normalizeLabelDictionary(metadata.label_dictionary || {});
  const labelStyle = normalizeLabelStyle(metadata.label_style || DEFAULT_LABEL_STYLE);
  const availableLocales = [...new Set([
    "th",
    ...Object.keys(dictionary).map((locale) => String(locale || "").trim().toLowerCase()).filter(Boolean),
    ...Object.keys(metadata?.label_translation?.locale_statuses || {}).map((locale) => String(locale || "").trim().toLowerCase()).filter(Boolean),
    ...(Array.isArray(metadata?.label_translation?.target_locales) ? metadata.label_translation.target_locales.map((locale) => String(locale || "").trim().toLowerCase()) : []),
  ])];
  return {
    source_locale: String(metadata?.label_translation?.source_locale || "th").trim().toLowerCase() || "th",
    available_locales: availableLocales,
    items: (Array.isArray(labelSource?.labels) ? labelSource.labels : []).map((label) => {
      const style = resolveLabelStyleForCategory(labelStyle, label?.label_category);
      return {
        label_key: String(label?.label_key || "").trim(),
        label_category: String(label?.label_category || "other").trim().toLowerCase() || "other",
        anchor_x: Number(label?.anchor_x || 0),
        anchor_y: Number(label?.anchor_y || 0),
        priority: Number(label?.priority || 0),
        min_zoom_hint: label?.min_zoom_hint == null ? null : Number(label.min_zoom_hint),
        texts: localeTextsForLabel(label?.label_key, dictionary),
        locale_offsets: normalizeLocaleOffsets(label?.locale_offsets) || {},
        style: {
          font_family: String(style?.font_family || DEFAULT_LABEL_STYLE.global.font_family).trim() || DEFAULT_LABEL_STYLE.global.font_family,
          text_color: normalizeLabelStyleColor(style?.text_color, DEFAULT_LABEL_STYLE.global.text_color),
          size_preset: normalizeLabelStyleSize(style?.size_preset, DEFAULT_LABEL_STYLE.global.size_preset),
          scale_with_zoom: style?.scale_with_zoom == null ? true : Boolean(style.scale_with_zoom),
          zoom_scale: normalizeLabelStyleZoomScale(style?.zoom_scale, DEFAULT_LABEL_STYLE.global.zoom_scale),
        },
      };
    }).filter((item) => item.label_key),
  };
}

function annotationRenderPayload(db, row, labelSource = null) {
  if (!row) return null;
  const serialized = serializeBaseMapCore(db, row);
  const source = labelSource && typeof labelSource === "object"
    ? labelSource
    : { metadata: serialized?.metadata || {}, labels: [] };
  return {
    revision: Number(row.updated_at ? Date.parse(row.updated_at) : 0) || Number(row.id || 0) || 0,
    base_layer_url: String(serialized?.candidate_map_url || serialized?.base_svg_url || "").trim(),
    bounds: serialized?.bounds || mapShape(row).bounds,
    viewbox: serialized?.viewbox || mapShape(row).viewbox,
    label_layer: annotationRenderLabelLayer(source),
    overlay_layers: normalizeBaseMapOverlays(db, row, source?.metadata?.overlays || serialized?.metadata?.overlays || [], { includeAssetUrl: true }).map((item) => ({
      overlay_id: String(item?.overlay_id || "").trim(),
      asset_id: Number(item?.asset_id || 0) || 0,
      asset_url: String(item?.asset_url || "").trim(),
      anchor_x: Number(item?.anchor_x || 0),
      anchor_y: Number(item?.anchor_y || 0),
      width: Number(item?.width || 0),
      height: Number(item?.height || 0),
      natural_width: Number(item?.natural_width || item?.width || 0),
      natural_height: Number(item?.natural_height || item?.height || 0),
      aspect_ratio: Number(item?.natural_width || 0) > 0 && Number(item?.natural_height || 0) > 0
        ? Number((Number(item.natural_width) / Number(item.natural_height)).toFixed(4))
        : 1,
      scale_with_zoom: item?.scale_with_zoom == null ? true : Boolean(item.scale_with_zoom),
    })).filter((item) => item.overlay_id && item.asset_url),
  };
}

function serializeBaseMapCore(db, row) {
  if (!row) return null;
  const metadata = normalizeLabelLayoutMetadata(asJson(row.metadata_json, {}));
  const overlays = normalizeBaseMapOverlays(db, row, metadata?.overlays || [], { includeAssetUrl: true });
  const candidateMapAssetId = Number(row.candidate_map_asset_id || row.base_svg_asset_id || 0) || null;
  const annotationMapAssetId = Number(row.annotation_map_asset_id || row.preview_asset_id || 0) || null;
  const publishedMapAssetId = Number(row.published_map_asset_id || 0) || null;
  return {
    id: Number(row.id || 0),
    key: row.map_key,
    title: row.title,
    version: Number(row.version || 1),
    status: row.status,
    bounds: mapShape(row).bounds,
    viewbox: mapShape(row).viewbox,
    projection_type: row.projection_type,
    base_svg_asset_id: Number(row.base_svg_asset_id || 0) || null,
    preview_asset_id: Number(row.preview_asset_id || 0) || null,
    candidate_map_asset_id: candidateMapAssetId,
    annotation_map_asset_id: annotationMapAssetId,
    published_map_asset_id: publishedMapAssetId,
    active_label_layout_id: Number(row.active_label_layout_id || 0) || null,
    base_svg_url: assetUrl(db, row.base_svg_asset_id),
    preview_url: assetUrl(db, row.preview_asset_id),
    candidate_map_url: assetUrl(db, candidateMapAssetId),
    annotation_map_url: assetUrl(db, annotationMapAssetId),
    published_map_url: assetUrl(db, publishedMapAssetId),
    metadata: {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      overlays,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeBaseMap(db, row, labelSource = null) {
  if (!row) return null;
  return {
    ...serializeBaseMapCore(db, row),
    annotation_render_payload: annotationRenderPayload(db, row, labelSource),
  };
}

function escapeSvgText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createTransportV2Router({ db, dirs, logAudit = () => {}, getAiConfig = null }) {
  const router = express.Router();
  const resolveEffectiveAiConfig = () => {
    if (typeof getAiConfig === "function") {
      return getAiConfig();
    }
    return resolveAiConfig();
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
    },
  });
  const osrmBaseUrl = String(process.env.COLLECTOR_OSRM_API || process.env.OSRM_BASE_URL || "").trim().replace(/\/+$/, "");
  const backendApiBase = String(process.env.COLLECTOR_SYNC_BACKEND_API || "http://localhost:5000/api").trim().replace(/\/+$/, "");
  const backendSyncToken = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();

  const routeCols = db.prepare("PRAGMA table_info(transport_routes_v2)").all();
  if (!routeCols.some((row) => String(row?.name || "").trim().toLowerCase() === "vehicle_thumbnail_asset_id")) {
    db.exec("ALTER TABLE transport_routes_v2 ADD COLUMN vehicle_thumbnail_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL;");
  }
  const baseMapCols = db.prepare("PRAGMA table_info(transport_base_maps_v2)").all();
  if (!baseMapCols.some((row) => String(row?.name || "").trim().toLowerCase() === "active_label_layout_id")) {
    db.exec("ALTER TABLE transport_base_maps_v2 ADD COLUMN active_label_layout_id INTEGER;");
  }
  if (!baseMapCols.some((row) => String(row?.name || "").trim().toLowerCase() === "candidate_map_asset_id")) {
    db.exec("ALTER TABLE transport_base_maps_v2 ADD COLUMN candidate_map_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL;");
  }
  if (!baseMapCols.some((row) => String(row?.name || "").trim().toLowerCase() === "annotation_map_asset_id")) {
    db.exec("ALTER TABLE transport_base_maps_v2 ADD COLUMN annotation_map_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL;");
  }
  if (!baseMapCols.some((row) => String(row?.name || "").trim().toLowerCase() === "published_map_asset_id")) {
    db.exec("ALTER TABLE transport_base_maps_v2 ADD COLUMN published_map_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL;");
  }
  db.exec(`
    UPDATE transport_base_maps_v2
    SET candidate_map_asset_id = COALESCE(candidate_map_asset_id, base_svg_asset_id),
        annotation_map_asset_id = COALESCE(annotation_map_asset_id, preview_asset_id)
    WHERE candidate_map_asset_id IS NULL
       OR annotation_map_asset_id IS NULL;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transport_label_layouts_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      layout_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transport_label_layout_items_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label_layout_id INTEGER NOT NULL,
      label_key TEXT NOT NULL,
      label_category TEXT NOT NULL DEFAULT 'landmark',
      anchor_x REAL NOT NULL,
      anchor_y REAL NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      min_zoom_hint REAL,
      locale_offsets_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(label_layout_id) REFERENCES transport_label_layouts_v2(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_label_layout_items_v2_key
      ON transport_label_layout_items_v2(label_layout_id, label_key);
    CREATE INDEX IF NOT EXISTS idx_transport_label_layout_items_v2_layout
      ON transport_label_layout_items_v2(label_layout_id, priority DESC, id ASC);
  `);

  const getBaseMapRow = (id) => db.prepare("SELECT * FROM transport_base_maps_v2 WHERE id=? LIMIT 1").get(Number(id || 0));
  const getLabelLayoutRow = (id) => db.prepare("SELECT * FROM transport_label_layouts_v2 WHERE id=? LIMIT 1").get(Number(id || 0));
  const listLabelLayoutItems = (id) => db.prepare(`
    SELECT *
    FROM transport_label_layout_items_v2
    WHERE label_layout_id=?
    ORDER BY priority DESC, id ASC
  `).all(Number(id || 0)).map((row) => {
    const localeOffsets = normalizeLocaleOffsets(asJson(row.locale_offsets_json, null));
    return {
      id: Number(row.id || 0),
      label_key: row.label_key,
      label_category: row.label_category,
      anchor_x: Number(row.anchor_x || 0),
      anchor_y: Number(row.anchor_y || 0),
      priority: Number(row.priority || 0),
      min_zoom_hint: row.min_zoom_hint == null ? null : Number(row.min_zoom_hint),
      ...(localeOffsets ? { locale_offsets: localeOffsets } : {}),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
  const serializeLabelLayout = (row) => {
    if (!row) return null;
    const metadata = normalizeLabelLayoutMetadata(asJson(row.metadata_json, {}));
    return {
      id: Number(row.id || 0),
      key: row.layout_key,
      title: row.title,
      status: row.status || "draft",
      metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  };
  const listBaseMapLabels = (id) => db.prepare(`
    SELECT *
    FROM transport_base_map_labels_v2
    WHERE base_map_id=?
    ORDER BY priority DESC, id ASC
  `).all(Number(id || 0)).map((row) => ({
    id: Number(row.id || 0),
    label_key: row.label_key,
    label_category: row.label_category,
    anchor_x: Number(row.anchor_x || 0),
    anchor_y: Number(row.anchor_y || 0),
    priority: Number(row.priority || 0),
    min_zoom_hint: row.min_zoom_hint == null ? null : Number(row.min_zoom_hint),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const normalizeLabelLayoutItemsInput = (items = []) => (Array.isArray(items) ? items : [])
    .map((row, index) => ({
      label_key: String(row?.label_key || "").trim(),
      label_category: String(row?.label_category || "other").trim().toLowerCase() || "other",
      anchor_x: num(row?.anchor_x),
      anchor_y: num(row?.anchor_y),
      priority: Number(row?.priority ?? index) || 0,
      min_zoom_hint: row?.min_zoom_hint == null ? null : num(row?.min_zoom_hint),
      locale_offsets: normalizeLocaleOffsets(row?.locale_offsets),
    }))
    .filter((row) => row.label_key && Number.isFinite(row.anchor_x) && Number.isFinite(row.anchor_y));
  const resolveBaseMapLabelSource = (baseMap) => {
    const activeLayoutId = Number(baseMap?.active_label_layout_id || 0) || 0;
    if (activeLayoutId) {
      const layoutRow = getLabelLayoutRow(activeLayoutId);
      if (layoutRow) {
        const layout = serializeLabelLayout(layoutRow);
        return {
          kind: "layout",
          layout,
          metadata: layout?.metadata || {},
          labels: listLabelLayoutItems(activeLayoutId),
        };
      }
    }
    const legacyMetadata = normalizeLabelLayoutMetadata(asJson(baseMap?.metadata_json, {}));
    return {
      kind: "legacy",
      layout: null,
      metadata: legacyMetadata,
      labels: listBaseMapLabels(baseMap?.id),
    };
  };
  const serializeBaseMapResolved = (row) => {
    if (!row) return null;
    return serializeBaseMap(db, row, resolveBaseMapLabelSource(row));
  };
  const getRouteRow = (id) => db.prepare(`
    SELECT r.*, u.display_name AS assignee_display_name, u.email AS assignee_email
    FROM transport_routes_v2 r
    LEFT JOIN users u ON u.id = r.assignee_user_id
    WHERE r.id=?
    LIMIT 1
  `).get(Number(id || 0));

  const getRoute = (id) => {
    const row = getRouteRow(id);
    if (!row) return null;
    const routeId = Number(row.id || 0);
    const resolved = db.prepare("SELECT * FROM transport_route_resolved_paths_v2 WHERE route_id=? ORDER BY route_revision DESC, id DESC LIMIT 1").get(routeId);
    const poster = db.prepare("SELECT * FROM transport_route_poster_paths_v2 WHERE route_id=? ORDER BY route_revision DESC, id DESC LIMIT 1").get(routeId);
    return {
      id: routeId,
      base_map_id: Number(row.base_map_id || 0) || null,
      route_name: row.route_name,
      route_number: row.route_number,
      vehicle_type: row.vehicle_type,
      vehicle_thumbnail_asset_id: Number(row.vehicle_thumbnail_asset_id || 0) || null,
      vehicle_thumbnail_url: assetUrl(db, row.vehicle_thumbnail_asset_id),
      color: row.color,
      description: row.description,
      description_en: row.description_en || "",
      fare_baht: row.fare_baht == null ? null : Number(row.fare_baht),
      color_locked: Boolean(row.color_locked),
      workflow_status: row.workflow_status,
      assignee_user_id: Number(row.assignee_user_id || 0) || null,
      assignee_display_name: row.assignee_display_name || null,
      assignee_email: row.assignee_email || null,
      route_revision: Number(row.route_revision || 1),
      resolved_revision: Number(row.resolved_revision || 0),
      poster_revision: Number(row.poster_revision || 0),
      routing_status: row.routing_status || "missing",
      poster_status: row.poster_status || "missing",
      poster_svg_asset_id: Number(row.poster_svg_asset_id || 0) || null,
      poster_webp_asset_id: Number(row.poster_webp_asset_id || 0) || null,
      poster_svg_url: assetUrl(db, row.poster_svg_asset_id),
      poster_webp_url: assetUrl(db, row.poster_webp_asset_id),
      resolved_distance_km: Number(row.resolved_distance_km || 0),
      resolved_bbox: asJson(row.resolved_bbox_json, null),
      last_routed_at: row.last_routed_at || null,
      last_poster_generated_at: row.last_poster_generated_at || null,
      route_kind: row.route_kind || 'loop',
      control_points: db.prepare("SELECT point_order, lat, lng, label, note, leg FROM transport_route_control_points_v2 WHERE route_id=? ORDER BY point_order ASC").all(routeId).map((entry) => ({ order: Number(entry.point_order || 0), lat: Number(entry.lat), lng: Number(entry.lng), label: entry.label || '', note: entry.note || '', leg: entry.leg ?? null })),
      stops: db.prepare("SELECT stop_order, name, lat, lng, stop_type, note, leg FROM transport_route_stops_v2 WHERE route_id=? ORDER BY stop_order ASC").all(routeId).map((entry) => ({ order: Number(entry.stop_order || 0), name: entry.name, lat: Number(entry.lat), lng: Number(entry.lng), stop_type: entry.stop_type || 'stop', note: entry.note || '', leg: entry.leg ?? null })),
      resolved_path: resolved ? asJson(resolved.geometry_json, []) : [],
      resolved_path_meta: resolved ? { id: Number(resolved.id || 0), route_revision: Number(resolved.route_revision || 0), point_count: Number(resolved.point_count || 0), bbox: asJson(resolved.bbox_json, null), summary: asJson(resolved.osrm_summary_json, {}), created_at: resolved.created_at } : null,
      poster_path_simplified: poster ? asJson(poster.geometry_json, []) : [],
      poster_path_meta: poster ? { id: Number(poster.id || 0), route_revision: Number(poster.route_revision || 0), source_resolved_path_id: Number(poster.source_resolved_path_id || 0), point_count: Number(poster.point_count || 0), bbox: asJson(poster.bbox_json, null), simplification_profile: poster.simplification_profile, created_at: poster.created_at } : null,
      created_by: row.created_by || null,
      updated_by: row.updated_by || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  };

  const bumpRoute = (id, email) => db.prepare(`
    UPDATE transport_routes_v2
    SET route_revision=route_revision + 1, routing_status='stale', poster_status='stale', updated_by=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(email, Number(id));

const hasConfiguredSyncToken = () => Boolean(String(backendSyncToken || "").trim());
const collectorIntegrationConfig = () => ({
  backendApiBase,
  backendSyncToken,
  webReviewSyncToken: "",
  collectorPublicBaseUrl: String(process.env.COLLECTOR_PUBLIC_BASE_URL || process.env.COLLECTOR_PUBLIC_URL || "").trim(),
});

  router.get("/base-maps", allow("owner"), (_req, res) => {
    res.json({
      items: db.prepare("SELECT * FROM transport_base_maps_v2 ORDER BY created_at DESC, id DESC").all().map((row) => {
        const source = resolveBaseMapLabelSource(row);
        return {
          ...serializeBaseMapResolved(row),
          labels: source.labels,
          resolved_label_layout: source.layout,
        };
      }),
    });
  });

  const collectPublishInput = (id) => {
    const row = getBaseMapRow(id);
    if (!row) return null;
    const render = annotationRenderPayload(db, row, resolveBaseMapLabelSource(row));
    const routeIds = db.prepare("SELECT id FROM transport_routes_v2 WHERE base_map_id=? ORDER BY route_number ASC")
      .all(Number(row.id)).map((r) => Number(r.id));
    return {
      row,
      input: {
        baseMap: { id: Number(row.id), map_key: row.map_key, title: row.title, ...mapShape(row) },
        baseSvgStoragePath: assetStoragePath(db, row.candidate_map_asset_id || row.base_svg_asset_id),
        labelLayer: render.label_layer,
        overlayLayers: render.overlay_layers.map((o) => ({ ...o, storagePath: assetStoragePath(db, o.asset_id) })),
        routes: routeIds.map((rid) => getRoute(rid)).filter(Boolean),
      },
    };
  };

  router.get("/base-maps/:id/publish-preview", allow("owner"), wrap(async (req, res) => {
    const collected = collectPublishInput(req.params.id);
    if (!collected) return res.status(404).json({ error: "base map not found" });
    const { bundle, files, skipped, problems } = buildTransportBundle({ ...collected.input, revision: Date.now() });
    let live = null;
    try {
      const response = await fetch(`${backendApiBase}/transport-v2/maps/${encodeURIComponent(bundle.map_key)}`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        live = { publication_id: data.publication_id, published_at: data.published_at, revision: data.bundle?.revision || null, route_count: data.bundle?.routes?.length || 0 };
      }
    } catch {
      live = null;
    }
    return res.json({
      map_key: bundle.map_key, route_count: bundle.routes.length, label_count: bundle.labels.length,
      overlay_count: bundle.overlays.length, file_count: files.length, skipped, problems, live,
    });
  }));

  router.get("/base-maps/:id/preview-bundle", allow("owner"), wrap(async (req, res) => {
    const collected = collectPublishInput(req.params.id);
    if (!collected) return res.status(404).json({ error: "base map not found" });
    const { bundle, files, skipped, problems } = buildTransportBundle({ ...collected.input, revision: Date.now() });
    const urlFor = new Map(files.map((f) => [f.name, `/media/${String(f.storagePath).replace(/\\/g, "/")}`]));
    return res.json({
      bundle: {
        ...bundle,
        base_svg_url: urlFor.get(bundle.base_svg) || "",
        overlays: bundle.overlays.map((o) => ({ ...o, url: urlFor.get(o.file) || "" })),
        routes: bundle.routes.map((r) => (r.photo ? { ...r, photo_url: urlFor.get(r.photo) || "" } : r)),
      },
      skipped,
      problems,
    });
  }));

  router.post("/base-maps/:id/publish", allow("owner"), wrap(async (req, res) => {
    if (!backendSyncToken) return res.status(503).json({ error: "LIFECYCLE_SYNC_TOKEN is not configured" });
    const collected = collectPublishInput(req.params.id);
    if (!collected) return res.status(404).json({ error: "base map not found" });
    const { bundle, files, skipped, problems } = buildTransportBundle({ ...collected.input, revision: Date.now() });
    if (problems.length) return res.status(409).json({ error: "not ready to publish", problems, skipped });
    const form = new FormData();
    form.append("bundle", JSON.stringify(bundle));
    form.append("published_by", actorEmail(req));
    const missingFiles = [];
    for (const file of files) {
      try {
        const buffer = await fs.readFile(path.join(dirs.mediaDir, file.storagePath));
        form.append(file.name, new Blob([buffer]), file.name);
      } catch {
        missingFiles.push(file.name);
      }
    }
    if (missingFiles.length) return res.status(409).json({ error: "asset files missing", problems: missingFiles.map((n) => `file missing: ${n}`), skipped });
    let response;
    try {
      response = await fetch(`${backendApiBase}/transport-v2/publish`, {
        method: "POST", headers: { "x-lifecycle-token": backendSyncToken }, body: form, signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      return res.status(502).json({ error: "backend unreachable", detail: String(err?.name || err?.message || err) });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: "backend publish failed", backend_status: response.status, backend: payload });
    logAudit(actorEmail(req), "transport_v2.base_map.publish", "transport_base_map_v2", String(collected.row.id), {
      map_key: bundle.map_key, revision: bundle.revision, route_count: bundle.routes.length, skipped_count: skipped.length,
    });
    return res.json({ ok: true, ...payload, skipped });
  }));

  const landmarkOut = (it, dict) => ({
    key: it.label_key,
    category: it.label_category,
    x: it.anchor_x,
    y: it.anchor_y,
    min_zoom: it.min_zoom_hint,
    th: String(dict?.th?.[it.label_key] || ""),
    en: String(dict?.en?.[it.label_key] || ""),
  });
  const landmarksResponse = (layoutId) => {
    const row = layoutId ? getLabelLayoutRow(layoutId) : null;
    if (!row) return { layout_id: null, items: [] };
    const dict = normalizeLabelLayoutMetadata(asJson(row.metadata_json, {})).label_dictionary;
    return { layout_id: Number(row.id), items: listLabelLayoutItems(row.id).map((it) => landmarkOut(it, dict)) };
  };

  router.get("/landmarks", allow("owner"), (req, res) => {
    const baseMap = getBaseMapRow(req.query.base_map_id);
    if (!baseMap) return res.status(404).json({ error: "Base map not found" });
    res.json(landmarksResponse(Number(baseMap.active_label_layout_id || 0) || 0));
  });

  router.put("/landmarks", allow("owner"), (req, res) => {
    const baseMap = getBaseMapRow(req.query.base_map_id);
    if (!baseMap) return res.status(404).json({ error: "Base map not found" });
    if (!Array.isArray(req.body?.items)) return res.status(400).json({ error: "items ต้องเป็น array" });
    const input = req.body.items;
    const items = normalizeLabelLayoutItemsInput(input.map((r, i) => ({
      label_key: r?.key, label_category: r?.category, anchor_x: r?.x, anchor_y: r?.y,
      priority: input.length - i, min_zoom_hint: r?.min_zoom === "" || r?.min_zoom == null ? null : r.min_zoom,
    })));
    if (items.length !== input.length) return res.status(400).json({ error: "landmark ต้องมี key และพิกัด x/y" });
    if (new Set(items.map((it) => it.label_key)).size !== items.length) return res.status(400).json({ error: "key ซ้ำ" });
    if (input.some((r) => !String(r?.th || "").trim())) return res.status(400).json({ error: "ต้องมีชื่อภาษาไทยทุกจุด" });
    if (items.some((it) => it.min_zoom_hint != null && !Number.isFinite(it.min_zoom_hint))) return res.status(400).json({ error: "min_zoom ต้องเป็นตัวเลข" });
    let layoutId = Number(baseMap.active_label_layout_id || 0) || 0;
    db.exec("BEGIN");
    try {
      let layoutRow = layoutId ? getLabelLayoutRow(layoutId) : null;
      if (!layoutRow) {
        db.prepare(`INSERT INTO transport_label_layouts_v2 (layout_key, title, status, metadata_json, created_at, updated_at)
          VALUES (?, ?, 'draft', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
          .run(`base-map-${baseMap.id}-landmarks-${Date.now()}`, `${baseMap.title || `Base map ${baseMap.id}`} Landmarks`, json(normalizeLabelLayoutMetadata({}), "{}"));
        layoutId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0) || 0;
        db.prepare("UPDATE transport_base_maps_v2 SET active_label_layout_id=? WHERE id=?").run(layoutId, Number(baseMap.id));
        layoutRow = getLabelLayoutRow(layoutId);
      }
      const meta = normalizeLabelLayoutMetadata(asJson(layoutRow.metadata_json, {}));
      const keys = new Set(items.map((it) => it.label_key));
      const dict = {};
      for (const [loc, entries] of Object.entries(meta.label_dictionary || {})) {
        if (loc === "th" || loc === "en") continue;
        dict[loc] = Object.fromEntries(Object.entries(entries || {}).filter(([k]) => keys.has(k)));
      }
      dict.th = {};
      dict.en = {};
      for (const r of input) {
        dict.th[String(r.key).trim()] = String(r.th).trim();
        if (String(r.en || "").trim()) dict.en[String(r.key).trim()] = String(r.en).trim();
      }
      db.prepare("UPDATE transport_label_layouts_v2 SET metadata_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(json(normalizeLabelLayoutMetadata({ ...meta, label_dictionary: dict }), "{}"), layoutId);
      db.prepare("DELETE FROM transport_label_layout_items_v2 WHERE label_layout_id=?").run(layoutId);
      const insert = db.prepare(`INSERT INTO transport_label_layout_items_v2 (
        label_layout_id, label_key, label_category, anchor_x, anchor_y, priority, min_zoom_hint, locale_offsets_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
      for (const it of items) insert.run(layoutId, it.label_key, it.label_category, it.anchor_x, it.anchor_y, it.priority, it.min_zoom_hint);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      return res.status(400).json({ error: String(error?.message || error) });
    }
    logAudit(actorEmail(req), "transport_v2.landmarks.save", "transport_label_layout_v2", String(layoutId), { count: items.length });
    res.json(landmarksResponse(layoutId));
  });

  router.get("/routes", allow("owner"), (_req, res) => {
    res.json({ items: db.prepare("SELECT id FROM transport_routes_v2 ORDER BY updated_at DESC, id DESC").all().map((row) => getRoute(row.id)).filter(Boolean) });
  });

  router.post("/routes", allow("owner"), (req, res) => {
    try {
      const body = req.body || {};
      if (!String(body.route_name || "").trim()) throw new Error("route_name is required");
      if (!String(body.route_number || "").trim()) throw new Error("route_number is required");
      const baseMapId = Number(body.base_map_id || 0) || null;
      if (!baseMapId) throw new Error("base_map_id is required");
      if (baseMapId && !getBaseMapRow(baseMapId)) throw new Error("base_map_id is invalid");
      const routeKind = body.route_kind == null ? "loop" : String(body.route_kind).trim().toLowerCase();
      if (!ROUTE_KINDS.has(routeKind)) throw new Error("route_kind is invalid");
      const hasColor = String(body.color || "").trim() !== "";
      const usedColors = db.prepare("SELECT color FROM transport_routes_v2").all().map((r) => r.color);
      const routeColor = hasColor ? color(body.color) : pickLeastUsed(usedColors);
      db.prepare(`
        INSERT INTO transport_routes_v2 (
          base_map_id, route_name, route_number, vehicle_type, route_kind, color, description, description_en, fare_baht, color_locked, workflow_status, assignee_user_id,
          route_revision, resolved_revision, poster_revision, routing_status, poster_status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'missing', 'missing', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        baseMapId,
        String(body.route_name).trim(),
        String(body.route_number).trim(),
        vehicle(body.vehicle_type),
        routeKind,
        routeColor,
        String(body.description || "").trim(),
        String(body.description_en || "").trim(),
        fare(body.fare_baht),
        hasColor ? 1 : 0,
        String(body.workflow_status || "draft").trim().toLowerCase() || "draft",
        Number(body.assignee_user_id || 0) || null,
        actorEmail(req),
        actorEmail(req)
      );
      const created = getRoute(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
      logAudit(actorEmail(req), "transport_v2.route.create", "transport_route_v2", String(created?.id || ""), { route_number: created?.route_number || null });
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  router.get("/routes/:id", allow("owner"), (req, res) => {
    const item = getRoute(req.params.id);
    if (!item) return res.status(404).json({ error: "Route not found" });
    res.json(item);
  });

  router.put("/routes/:id", allow("owner"), (req, res) => {
    try {
      const current = getRoute(req.params.id);
      if (!current) return res.status(404).json({ error: "Route not found" });
      const body = req.body || {};
      const baseMapId = Number((body.base_map_id ?? current.base_map_id) || 0) || null;
      if (baseMapId && !getBaseMapRow(baseMapId)) throw new Error("base_map_id is invalid");
      const nextRouteName = String((body.route_name ?? current.route_name) || "").trim() || current.route_name;
      const nextRouteNumber = String((body.route_number ?? current.route_number) || "").trim() || current.route_number;
      const nextVehicleType = vehicle(body.vehicle_type ?? current.vehicle_type);
      const hasRouteKind = Object.prototype.hasOwnProperty.call(body, "route_kind");
      const nextRouteKind = hasRouteKind ? String(body.route_kind).trim().toLowerCase() : current.route_kind;
      if (hasRouteKind && !ROUTE_KINDS.has(nextRouteKind)) throw new Error("route_kind is invalid");
      const nextColor = color(body.color ?? current.color, current.color);
      const nextDescription = String((body.description ?? current.description) || "").trim();
      const hasColor = Object.prototype.hasOwnProperty.call(body, "color");
      const nextDescriptionEn = String((body.description_en ?? current.description_en) || "").trim();
      const nextFare = Object.prototype.hasOwnProperty.call(body, "fare_baht") ? fare(body.fare_baht) : current.fare_baht;
      const nextColorLocked = hasColor ? 1 : (current.color_locked ? 1 : 0);
      const nextWorkflowStatus = String((body.workflow_status ?? current.workflow_status) || "draft").trim().toLowerCase() || current.workflow_status;
      const nextAssigneeUserId = Number((body.assignee_user_id ?? current.assignee_user_id) || 0) || null;
      const affectsPoster =
        baseMapId !== current.base_map_id
        || nextRouteName !== current.route_name
        || nextRouteNumber !== current.route_number
        || nextVehicleType !== current.vehicle_type
        || nextColor !== current.color
        || nextDescription !== current.description;
      db.prepare(`
        UPDATE transport_routes_v2
        SET base_map_id=?, route_name=?, route_number=?, vehicle_type=?, route_kind=?, color=?, description=?, description_en=?, fare_baht=?, color_locked=?, workflow_status=?, assignee_user_id=?,
            route_revision=CASE WHEN ? THEN route_revision + 1 ELSE route_revision END,
            routing_status=CASE WHEN ? THEN 'stale' ELSE routing_status END,
            poster_status=CASE WHEN ? THEN 'stale' ELSE poster_status END,
            updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        baseMapId,
        nextRouteName,
        nextRouteNumber,
        nextVehicleType,
        nextRouteKind,
        nextColor,
        nextDescription,
        nextDescriptionEn,
        nextFare,
        nextColorLocked,
        nextWorkflowStatus,
        nextAssigneeUserId,
        affectsPoster ? 1 : 0,
        affectsPoster ? 1 : 0,
        affectsPoster ? 1 : 0,
        actorEmail(req),
        Number(req.params.id)
      );
      res.json(getRoute(req.params.id));
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  router.post("/routes/:id/thumbnail", allow("owner"), upload.single("file"), wrap(async (req, res) => {
    const current = getRoute(req.params.id);
    if (!current) return res.status(404).json({ error: "Route not found" });
    const file = req.file || null;
    if (!file) return res.status(400).json({ error: "file is required" });
    const mimeType = String(file.mimetype || "").trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return res.status(400).json({ error: "file must be jpeg, png, or webp" });
    }
    if (!file.buffer?.length) {
      return res.status(400).json({ error: "file is empty" });
    }
    const detectedMimeType = detectImageMimeFromBuffer(file.buffer);
    if (!detectedMimeType || detectedMimeType !== mimeType) {
      return res.status(400).json({ error: "file content does not match declared image type" });
    }
    const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
    const relPath = path.join("uploads", "transport-v2", "routes", `route-${current.id}`, `vehicle-thumbnail-${Date.now()}${extension}`);
    const fullPath = path.join(dirs.mediaDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);
    const checksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const assetUid = crypto.randomUUID();
    db.exec("BEGIN");
    try {
      db.prepare(`
        INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, created_at, updated_at)
        VALUES (?, 'local', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        assetUid,
        relPath.replace(/\\/g, "/"),
        path.basename(fullPath),
        mimeType,
        Number(file.size || file.buffer.length || 0),
        checksum
      );
      const assetId = Number(db.prepare("SELECT id FROM assets WHERE asset_uid=? LIMIT 1").get(assetUid)?.id || 0) || 0;
      db.prepare(`
        UPDATE transport_routes_v2
        SET vehicle_thumbnail_asset_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(assetId, actorEmail(req), Number(current.id));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      await fs.rm(fullPath, { force: true }).catch(() => null);
      throw error;
    }
    const next = getRoute(current.id);
    logAudit(actorEmail(req), "transport_v2.route.upload_thumbnail", "transport_route_v2", String(current.id), {
      vehicle_thumbnail_asset_id: next?.vehicle_thumbnail_asset_id || null,
      mime_type: mimeType,
      size_bytes: Number(file.size || file.buffer.length || 0),
    });
    res.json(next);
  }));

  router.put("/routes/:id/control-points", allow("owner"), (req, res) => {
    const current = getRoute(req.params.id);
    if (!current) return res.status(404).json({ error: "Route not found" });
    let points;
    try { points = normalizePoints(req.body?.control_points || req.body?.items || []); }
    catch (error) { return res.status(400).json({ error: String(error?.message || error) }); }
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM transport_route_control_points_v2 WHERE route_id=?").run(Number(req.params.id));
      const insert = db.prepare("INSERT INTO transport_route_control_points_v2 (route_id, point_order, lat, lng, label, note, leg, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
      for (const point of points) insert.run(Number(req.params.id), point.order, point.lat, point.lng, point.label, point.note, point.leg);
      bumpRoute(req.params.id, actorEmail(req));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const next = getRoute(req.params.id);
    logAudit(actorEmail(req), "transport_v2.route.update_control_points", "transport_route_v2", String(next.id), { route_revision: next.route_revision, point_count: next.control_points.length });
    res.json(next);
  });

  router.put("/routes/:id/stops", allow("owner"), (req, res) => {
    const current = getRoute(req.params.id);
    if (!current) return res.status(404).json({ error: "Route not found" });
    let stops;
    try { stops = normalizeStops(req.body?.stops || req.body?.items || []); }
    catch (error) { return res.status(400).json({ error: String(error?.message || error) }); }
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM transport_route_stops_v2 WHERE route_id=?").run(Number(req.params.id));
      const insert = db.prepare("INSERT INTO transport_route_stops_v2 (route_id, stop_order, name, lat, lng, stop_type, note, leg, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
      for (const stop of stops) insert.run(Number(req.params.id), stop.order, stop.name, stop.lat, stop.lng, stop.stop_type, stop.note, stop.leg);
      db.prepare("UPDATE transport_routes_v2 SET updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(actorEmail(req), Number(req.params.id));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const next = getRoute(req.params.id);
    logAudit(actorEmail(req), "transport_v2.route.update_stops", "transport_route_v2", String(next.id), { route_revision: next.route_revision, stop_count: next.stops.length });
    res.json(next);
  });

  router.post("/routes/:id/resolve", allow("owner"), wrap(async (req, res) => {
    const item = getRoute(req.params.id);
    if (!item) return res.status(404).json({ error: "Route not found" });
    if (!osrmBaseUrl) {
      db.prepare("UPDATE transport_routes_v2 SET routing_status='error', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(item.id));
      return res.status(503).json({ error: "OSRM is not configured" });
    }
    if (item.control_points.length < 2) return res.status(409).json({ error: "At least 2 control points are required before resolve" });
    const coords = item.control_points.map((point) => `${point.lng},${point.lat}`).join(";");
    const urlBase = `${osrmBaseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
    const bearings = buildLegBearings(item.control_points);
    let r;
    try {
      r = await fetchRouteWithFallback(urlBase, bearings);
    } catch (err) {
      db.prepare("UPDATE transport_routes_v2 SET routing_status='error', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(item.id));
      return res.status(502).json({ error: "OSRM unreachable", detail: String(err?.name || err?.message || err) });
    }
    if (!r.ok) {
      db.prepare("UPDATE transport_routes_v2 SET routing_status='error', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(item.id));
      return res.status(502).json({ error: r.parseError ? "OSRM ตอบกลับอ่านไม่ได้" : (r.body?.message || "OSRM route resolve failed"), osrm: r.body });
    }
    const bearingsUsed = r.bearingsUsed;
    const payload = r.body;
    const route = Array.isArray(payload.routes) ? payload.routes[0] : null;
    const geometry = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates.map((entry) => ({ lng: num(entry?.[0]), lat: num(entry?.[1]) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)) : [];
    if (geometry.length < 2) return res.status(502).json({ error: "OSRM returned invalid geometry", osrm: payload });
    const nextBbox = bbox(geometry);
    const distanceKm = Number(route?.distance || 0) / 1000 || km(geometry);
    db.prepare(`
      INSERT INTO transport_route_resolved_paths_v2 (route_id, route_revision, routing_engine, routing_profile, geometry_json, distance_km, bbox_json, point_count, osrm_summary_json, created_at)
      VALUES (?, ?, 'osrm', 'driving', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(Number(item.id), Number(item.route_revision), json(geometry), distanceKm, json(nextBbox, "null"), geometry.length, json({ code: payload.code, duration_seconds: Number(route?.duration || 0), route_count: Array.isArray(payload.routes) ? payload.routes.length : 0 }, "{}"));
    db.prepare(`
      UPDATE transport_routes_v2
      SET resolved_revision=?, routing_status='fresh', poster_status='stale', resolved_distance_km=?, resolved_bbox_json=?, last_routed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(Number(item.route_revision), distanceKm, json(nextBbox, "null"), Number(item.id));
    if (!item.color_locked && Number(item.resolved_revision || 0) === 0) {
      const others = db.prepare("SELECT id FROM transport_routes_v2 WHERE id<>? AND base_map_id IS ?").all(Number(item.id), item.base_map_id)
        .map((row) => getRoute(row.id))
        .filter((r) => r && Array.isArray(r.resolved_path) && r.resolved_path.length >= 2)
        .map((r) => ({ color: r.color, path: r.resolved_path }));
      db.prepare("UPDATE transport_routes_v2 SET color=?, color_locked=1 WHERE id=?").run(pickForPath(geometry, others), Number(item.id));
    }
    const next = getRoute(item.id);
    logAudit(actorEmail(req), "transport_v2.route.resolve", "transport_route_v2", String(next.id), { route_revision: next.route_revision, resolved_revision: next.resolved_revision, point_count: next.resolved_path.length });
    res.json({ ...next, bearings_used: bearingsUsed, warnings: detourWarnings(route?.legs, payload.waypoints) });
  }));

  return router;
}
