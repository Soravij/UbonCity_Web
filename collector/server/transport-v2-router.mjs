import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import express from "express";
import multer from "multer";
import { resolveAiConfig, resolveAiFeatureConfig } from "../config/ai.mjs";
import { assertCollectorIntegrationReadiness } from "./integration-readiness.mjs";
import { executeBackendAiJson } from "../services/backend-ai-client.mjs";
const VEHICLES = new Set(["songthaew", "minibus", "van", "bus"]);
const DEFAULT_COLOR = "#ff6600";
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

function normalizePoint(row, index = 0) {
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
  };
}

function normalizePoints(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(normalizePoint).filter(Boolean).map((row, index) => ({ ...row, order: index }));
}

function normalizeStops(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const point = normalizePoint(row, index);
      if (!point) return null;
      return {
        ...point,
        name: String(row?.name || `Stop ${index + 1}`).trim() || `Stop ${index + 1}`,
        stop_type: String(row?.stop_type || "stop").trim().toLowerCase() || "stop",
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

async function translateLabelEntries(aiConfig, entries, targetLang) {
  const translationConfig = resolveAiFeatureConfig(aiConfig, "translation");
  if (!translationConfig?.enabled) {
    throw new Error("translation AI is not configured");
  }
  const sourceEntries = Object.fromEntries(
    Object.entries(entries || {}).map(([key, value]) => [String(key || "").trim(), String(value || "").trim()]).filter(([key, value]) => key && value)
  );
  if (!Object.keys(sourceEntries).length) {
    throw new Error("thai source text is required");
  }
  const prompt = [
    "Return ONLY valid JSON.",
    "Translate Thai map labels into the target language.",
    "Keep the EXACT same JSON keys.",
    "Each value must be short UI label text only, with no explanations.",
    "Preserve proper nouns and place names naturally for the target locale.",
    `Target locale: ${String(targetLang || "").trim().toLowerCase()}`,
    "Input JSON:",
    JSON.stringify(sourceEntries, null, 2),
  ].join("\n");
  const result = await executeBackendAiJson({
    aiConfig: translationConfig,
    featureKey: "translation",
    task: "transport_label_translation",
    prompt,
  });
  const parsed = result?.parsed || parseJsonLike(String(result?.outputText || ""));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("translation response is not valid JSON");
  }
  const translated = Object.fromEntries(
    Object.keys(sourceEntries)
      .map((key) => [key, String(parsed?.[key] || "").trim()])
      .filter(([, value]) => value)
  );
  const missingKeys = Object.keys(sourceEntries).filter((key) => !String(translated?.[key] || "").trim());
  if (missingKeys.length) {
    throw new Error(`translation returned incomplete content for ${missingKeys.length} label(s)`);
  }
  if (!Object.keys(translated).length) {
    throw new Error("translation returned empty content");
  }
  return translated;
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

function assetIsSvg(db, assetId) {
  const asset = assetRecord(db, assetId);
  if (!asset) return false;
  const mimeType = String(asset.mime_type || "").trim().toLowerCase();
  const fileName = String(asset.file_name || asset.storage_path || "").trim().toLowerCase();
  return mimeType === "image/svg+xml" || fileName.endsWith(".svg");
}

function guessMimeType(fileName = "") {
  const lower = String(fileName || "").trim().toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

async function assetDataUri(db, mediaDir, assetId) {
  const asset = assetRecord(db, assetId);
  const storagePath = String(asset?.storage_path || "").trim();
  if (!storagePath) return "";
  if (!assetIsSvg(db, assetId)) {
    throw new Error("base_svg_asset_id must reference an SVG asset");
  }
  const mimeType = String(asset?.mime_type || "").trim() || guessMimeType(asset?.file_name || storagePath);
  const fullPath = path.join(mediaDir, storagePath);
  const buffer = await fs.readFile(fullPath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function assetDataUriAny(db, mediaDir, assetId) {
  const asset = assetRecord(db, assetId);
  const storagePath = String(asset?.storage_path || "").trim();
  if (!storagePath) return "";
  const mimeType = String(asset?.mime_type || "").trim() || guessMimeType(asset?.file_name || storagePath);
  const fullPath = path.join(mediaDir, storagePath);
  const buffer = await fs.readFile(fullPath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
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
        label_category: String(label?.label_category || "landmark").trim().toLowerCase() || "landmark",
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
    revision: Number(row.updated_at ? Date.parse(row.updated_at) : 0) || nullmber(row.id || 0) || 0,
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
      label_category: String(row?.label_category || "landmark").trim().toLowerCase() || "landmark",
      anchor_x: num(row?.anchor_x),
      anchor_y: num(row?.anchor_y),
      priority: Number(row?.priority ?? index) || 0,
      min_zoom_hint: row?.min_zoom_hint == null ? null : num(row?.min_zoom_hint),
      locale_offsets: normalizeLocaleOffsets(row?.locale_offsets),
    }))
    .filter((row) => row.label_key && Number.isFinite(row.anchor_x) && Number.isFinite(row.anchor_y));
  const markRoutesStaleForLayout = (layoutId) => {
    const resolvedLayoutId = Number(layoutId || 0) || 0;
    if (!resolvedLayoutId) return;
    const affectedBaseMapIds = db.prepare("SELECT id FROM transport_base_maps_v2 WHERE active_label_layout_id=?").all(resolvedLayoutId)
      .map((row) => Number(row.id || 0))
      .filter(Boolean);
    if (!affectedBaseMapIds.length) return;
    const placeholders = affectedBaseMapIds.map(() => "?").join(", ");
    db.prepare(`
      UPDATE transport_routes_v2
      SET poster_status='stale', updated_at=CURRENT_TIMESTAMP
      WHERE base_map_id IN (${placeholders})
    `).run(...affectedBaseMapIds);
  };
  const baseMapIdsForLayout = (layoutId) => {
    const resolvedLayoutId = Number(layoutId || 0) || 0;
    if (!resolvedLayoutId) return [];
    return db.prepare("SELECT id FROM transport_base_maps_v2 WHERE active_label_layout_id=?").all(resolvedLayoutId)
      .map((row) => Number(row.id || 0))
      .filter(Boolean);
  };
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
  const saveGeneratedSvgAsset = async (relPath, svgText, cleanupPaths = null) => {
    const fullPath = path.join(dirs.mediaDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, svgText, "utf8");
    if (Array.isArray(cleanupPaths)) {
      cleanupPaths.push(fullPath);
    }
    const stat = await fs.stat(fullPath);
    const assetUid = crypto.randomUUID();
    db.prepare("INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, created_at, updated_at) VALUES (?, 'local', ?, ?, 'image/svg+xml', ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run(
      assetUid,
      relPath.replace(/\\/g, "/"),
      path.basename(fullPath),
      Number(stat.size || 0)
    );
    return Number(db.prepare("SELECT id FROM assets WHERE asset_uid=? LIMIT 1").get(assetUid)?.id || 0) || 0;
  };
  const baseMapArtifactPath = (stage, baseMapRow, fileName) => {
    const key = String(baseMapRow?.map_key || `base-map-${Number(baseMapRow?.id || 0) || 0}`).trim() || `base-map-${Number(baseMapRow?.id || 0) || 0}`;
    const safeKey = key.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `base-map-${Number(baseMapRow?.id || 0) || 0}`;
    const stageDir = stage === "published"
      ? path.join("published", "transport-v2", "base-maps")
      : stage === "annotation"
        ? path.join("generated", "transport-v2", "base-map-annotation")
        : path.join("generated", "transport-v2", "base-map-candidates");
    return path.join(stageDir, safeKey, fileName);
  };
  const renderBaseMapPreviewSvg = async (baseMapRow, locale = "th") => {
    const baseMap = serializeBaseMapResolved(baseMapRow);
    if (!baseMap?.base_svg_asset_id) return null;
    const labelSource = resolveBaseMapLabelSource(baseMapRow);
    const baseMeta = labelSource.metadata || {};
    const dictionary = normalizeLabelDictionary(baseMeta?.label_dictionary || {})?.[locale] || {};
    const labelStyle = normalizeLabelStyle(baseMeta?.label_style || DEFAULT_LABEL_STYLE);
    const baseLayerUri = await assetDataUri(db, dirs.mediaDir, baseMap.base_svg_asset_id).catch(() => "");
    if (!baseLayerUri) return null;
    const overlayEntries = normalizeBaseMapOverlays(db, baseMap, baseMap.metadata?.overlays || [], { includeAssetUrl: false });
    const overlayLayers = (await Promise.all(overlayEntries.map(async (item) => {
      const href = await assetDataUriAny(db, dirs.mediaDir, item.asset_id).catch(() => "");
      if (!href) return "";
      const x = Number(item.anchor_x || 0);
      const y = Number(item.anchor_y || 0) - Number(item.height || 0);
      return `<image href="${href}" x="${x}" y="${y}" width="${Number(item.width || 0)}" height="${Number(item.height || 0)}" preserveAspectRatio="none" />`;
    }))).filter(Boolean).join("\n  ");
    const labelLayers = (Array.isArray(labelSource.labels) ? labelSource.labels : []).map((label) => {
      const text = String(dictionary?.[label.label_key] || "").trim();
      if (!text) return "";
      const style = resolveLabelStyleForCategory(labelStyle, label.label_category);
      const localeOffset = normalizeLocaleOffsetEntry(label?.locale_offsets?.[locale]) || { dx: 0, dy: 0 };
      return `<text x="${Number(label.anchor_x) + Number(localeOffset.dx || 0)}" y="${Number(label.anchor_y) + Number(localeOffset.dy || 0)}" font-family="${escapeSvgText(String(style.font_family || DEFAULT_LABEL_STYLE.global.font_family))}" font-size="${labelStyleSvgFontSize(style)}" fill="${style.text_color || DEFAULT_LABEL_STYLE.global.text_color}">${escapeSvgText(text)}</text>`;
    }).filter(Boolean).join("\n  ");
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${baseMap.viewbox.x} ${baseMap.viewbox.y} ${baseMap.viewbox.width} ${baseMap.viewbox.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeSvgText(baseMap.title || "Base Map Preview")}</title>
  <desc id="desc">Base map preview for routes, Thai labels only</desc>
  <image href="${baseLayerUri}" x="${baseMap.viewbox.x}" y="${baseMap.viewbox.y}" width="${baseMap.viewbox.width}" height="${baseMap.viewbox.height}" preserveAspectRatio="none" />
  ${overlayLayers}
  ${labelLayers}
</svg>`;
  };
  const regenerateBaseMapPreviewAsset = async (baseMapId, options = {}) => {
    const { cleanupPaths = null } = options || {};
    const baseMapRow = getBaseMapRow(baseMapId);
    if (!baseMapRow?.base_svg_asset_id) {
      db.prepare("UPDATE transport_base_maps_v2 SET preview_asset_id=NULL, annotation_map_asset_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(baseMapId || 0));
      return serializeBaseMapResolved(getBaseMapRow(baseMapId));
    }
    const svg = await renderBaseMapPreviewSvg(baseMapRow, "th");
    if (!svg) {
      db.prepare("UPDATE transport_base_maps_v2 SET preview_asset_id=NULL, annotation_map_asset_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(baseMapId || 0));
      return serializeBaseMapResolved(getBaseMapRow(baseMapId));
    }
    const relPath = baseMapArtifactPath("annotation", baseMapRow, `annotation-th-r${Date.now()}.svg`);
    const assetId = await saveGeneratedSvgAsset(relPath, svg, cleanupPaths);
    db.prepare("UPDATE transport_base_maps_v2 SET preview_asset_id=?, annotation_map_asset_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assetId, assetId, Number(baseMapId || 0));
    return serializeBaseMapResolved(getBaseMapRow(baseMapId));
  };
  const renderPublishedBaseMapAsset = async (baseMapId, options = {}) => {
    const { cleanupPaths = null } = options || {};
    const baseMapRow = getBaseMapRow(baseMapId);
    if (!baseMapRow) throw new Error("Base map not found");
    const serializedBaseMap = serializeBaseMapResolved(baseMapRow);
    const annotationAssetId = Number(baseMapRow.annotation_map_asset_id || 0) || Number(baseMapRow.preview_asset_id || 0) || null;
    if (!annotationAssetId) {
      throw new Error("Annotation map is required before published render");
    }
    const annotationLayerUri = await assetDataUriAny(db, dirs.mediaDir, annotationAssetId).catch(() => "");
    if (!annotationLayerUri) {
      throw new Error("Annotation map asset is missing");
    }
    const routeRows = db.prepare(`
      SELECT id
      FROM transport_routes_v2
      WHERE routing_status='fresh'
        AND resolved_revision=route_revision
        AND COALESCE(workflow_status, 'draft') <> 'archived'
      ORDER BY route_number COLLATE NOCASE ASC, id ASC
    `).all();
    const routeLayers = routeRows
      .map((row) => getRoute(row.id))
      .filter((route) => route && Array.isArray(route.resolved_path) && route.resolved_path.length >= 2)
      .map((route) => `<path d="${pathToSvg(route.resolved_path, serializedBaseMap)}" fill="none" stroke="${color(route.color)}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />`)
      .join("\n  ");
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${serializedBaseMap.viewbox.x} ${serializedBaseMap.viewbox.y} ${serializedBaseMap.viewbox.width} ${serializedBaseMap.viewbox.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeSvgText(serializedBaseMap.title || "Published Transport Map")}</title>
  <desc id="desc">Published transport map with route overlays</desc>
  <image href="${annotationLayerUri}" x="${serializedBaseMap.viewbox.x}" y="${serializedBaseMap.viewbox.y}" width="${serializedBaseMap.viewbox.width}" height="${serializedBaseMap.viewbox.height}" preserveAspectRatio="none" />
  ${routeLayers}
</svg>`;
    const relPath = baseMapArtifactPath("published", baseMapRow, `published-r${Date.now()}.svg`);
    const assetId = await saveGeneratedSvgAsset(relPath, svg, cleanupPaths);
    db.prepare("UPDATE transport_base_maps_v2 SET published_map_asset_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assetId, Number(baseMapId || 0));
    return serializeBaseMapResolved(getBaseMapRow(baseMapId));
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
      control_points: db.prepare("SELECT point_order, lat, lng, label, note FROM transport_route_control_points_v2 WHERE route_id=? ORDER BY point_order ASC").all(routeId).map((entry) => ({ order: Number(entry.point_order || 0), lat: Number(entry.lat), lng: Number(entry.lng), label: entry.label || '', note: entry.note || '' })),
      stops: db.prepare("SELECT stop_order, name, lat, lng, stop_type, note FROM transport_route_stops_v2 WHERE route_id=? ORDER BY stop_order ASC").all(routeId).map((entry) => ({ order: Number(entry.stop_order || 0), name: entry.name, lat: Number(entry.lat), lng: Number(entry.lng), stop_type: entry.stop_type || 'stop', note: entry.note || '' })),
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

  const buildReleasePayload = (item) => ({
    source_system: "collector-app",
    source_base_url: "",
    routes: [
      {
        collector_item_id: Number(item?.id || 0) || 0,
        source_content_item_id: Number(item?.id || 0) || 0,
        route_name: String(item?.route_name || "").trim(),
        route_number: String(item?.route_number || "").trim(),
        vehicle_type: vehicle(item?.vehicle_type),
        vehicle_image: "",
        color: color(item?.color),
        description: String(item?.description || "").trim(),
        raw_points: (Array.isArray(item?.control_points) ? item.control_points : []).map((point, index) => ({
          lat: num(point?.lat),
          lng: num(point?.lng),
          point_order: index,
        })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
        path: (Array.isArray(item?.resolved_path) ? item.resolved_path : []).map((point, index) => ({
          lat: num(point?.lat),
          lng: num(point?.lng),
          point_order: index,
        })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
        stops: (Array.isArray(item?.stops) ? item.stops : []).map((stop, index) => ({
          name: String(stop?.name || `Stop ${index + 1}`).trim() || `Stop ${index + 1}`,
          lat: num(stop?.lat),
          lng: num(stop?.lng),
          stop_order: index,
        })).filter((stop) => stop.name && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)),
      },
    ],
  });

  router.get("/base-maps", allow("owner", "admin", "editor", "user"), (_req, res) => {
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

  router.post("/base-maps", allow("owner", "admin"), async (req, res) => {
    try {
      const body = req.body || {};
      const bounds = body.bounds && typeof body.bounds === "object" ? body.bounds : {};
      const viewbox = body.viewbox && typeof body.viewbox === "object" ? body.viewbox : {};
      const minLat = num(bounds.min_lat);
      const minLng = num(bounds.min_lng);
      const maxLat = num(bounds.max_lat);
      const maxLng = num(bounds.max_lng);
      if (!String(body.key || "").trim()) throw new Error("key is required");
      if (!String(body.title || "").trim()) throw new Error("title is required");
      if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) throw new Error("bounds are required and must be finite");
      if (!(minLat < maxLat) || !(minLng < maxLng)) throw new Error("bounds are invalid");
      const baseSvgAssetId = Number(body.base_svg_asset_id || 0) || null;
      const previewAssetId = Number(body.preview_asset_id || 0) || null;
      const candidateMapAssetId = Number(body.candidate_map_asset_id || baseSvgAssetId || 0) || null;
      const annotationMapAssetId = Number(body.annotation_map_asset_id || previewAssetId || 0) || null;
      const publishedMapAssetId = Number(body.published_map_asset_id || 0) || null;
      const activeLabelLayoutId = Number(body.active_label_layout_id || 0) || null;
      if (baseSvgAssetId && !assetExists(db, baseSvgAssetId)) throw new Error("base_svg_asset_id is invalid");
      if (baseSvgAssetId && !assetIsSvg(db, baseSvgAssetId)) throw new Error("base_svg_asset_id must reference an SVG asset");
      if (previewAssetId && !assetExists(db, previewAssetId)) throw new Error("preview_asset_id is invalid");
      if (candidateMapAssetId && !assetExists(db, candidateMapAssetId)) throw new Error("candidate_map_asset_id is invalid");
      if (annotationMapAssetId && !assetExists(db, annotationMapAssetId)) throw new Error("annotation_map_asset_id is invalid");
      if (publishedMapAssetId && !assetExists(db, publishedMapAssetId)) throw new Error("published_map_asset_id is invalid");
      if (activeLabelLayoutId && !getLabelLayoutRow(activeLabelLayoutId)) throw new Error("active_label_layout_id is invalid");
      const rawMetadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
      const nextMetadata = activeLabelLayoutId
        ? stripLegacyLabelMetadata(rawMetadata)
        : normalizeLabelLayoutMetadata(rawMetadata);
      nextMetadata.overlays = normalizeBaseMapOverlays(db, { viewbox_width: num(viewbox.width, 4000), viewbox_height: num(viewbox.height, 5600) }, nextMetadata.overlays || []);
      let createdId = 0;
      const cleanupPaths = [];
      db.exec("BEGIN");
      try {
        db.prepare(`
          INSERT INTO transport_base_maps_v2 (
            map_key, title, version, status, bounds_min_lat, bounds_min_lng, bounds_max_lat, bounds_max_lng,
            viewbox_x, viewbox_y, viewbox_width, viewbox_height, projection_type, base_svg_asset_id, preview_asset_id,
            candidate_map_asset_id, annotation_map_asset_id, published_map_asset_id, active_label_layout_id, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
          String(body.key).trim(),
          String(body.title).trim(),
          Number(body.version || 1) || 1,
          String(body.status || "draft").trim().toLowerCase() || "draft",
          minLat,
          minLng,
          maxLat,
          maxLng,
          num(viewbox.x, 0),
          num(viewbox.y, 0),
          num(viewbox.width, 4000),
          num(viewbox.height, 5600),
          String(body.projection_type || "linear-bbox-fit").trim() || "linear-bbox-fit",
          baseSvgAssetId,
          previewAssetId,
          candidateMapAssetId,
          annotationMapAssetId,
          publishedMapAssetId,
          activeLabelLayoutId,
          json(nextMetadata, "{}")
        );
        createdId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0) || 0;
        await regenerateBaseMapPreviewAsset(createdId, { cleanupPaths });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
        throw error;
      }
      const created = serializeBaseMapResolved(getBaseMapRow(createdId));
      logAudit(actorEmail(req), "transport_v2.base_map.create", "transport_base_map_v2", String(created?.id || ""), { key: created?.key || null });
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  router.put("/base-maps/:id", allow("owner", "admin"), async (req, res) => {
    try {
      const baseMapId = Number(req.params.id || 0) || 0;
      const current = getBaseMapRow(baseMapId);
      if (!current) return res.status(404).json({ error: "Base map not found" });
      const body = req.body || {};
      const currentMeta = asJson(current.metadata_json, {});
      const bodyBounds = body.bounds && typeof body.bounds === "object" ? body.bounds : {};
      const bodyViewbox = body.viewbox && typeof body.viewbox === "object" ? body.viewbox : {};
      const nextMinLat = bodyBounds.min_lat == null ? Number(current.bounds_min_lat) : num(bodyBounds.min_lat);
      const nextMinLng = bodyBounds.min_lng == null ? Number(current.bounds_min_lng) : num(bodyBounds.min_lng);
      const nextMaxLat = bodyBounds.max_lat == null ? Number(current.bounds_max_lat) : num(bodyBounds.max_lat);
      const nextMaxLng = bodyBounds.max_lng == null ? Number(current.bounds_max_lng) : num(bodyBounds.max_lng);
      if (![nextMinLat, nextMinLng, nextMaxLat, nextMaxLng].every(Number.isFinite)) throw new Error("bounds are required and must be finite");
      if (!(nextMinLat < nextMaxLat) || !(nextMinLng < nextMaxLng)) throw new Error("bounds are invalid");
      const nextKey = String(body.key ?? current.map_key ?? "").trim();
      const nextTitle = String(body.title ?? current.title ?? "").trim();
      if (!nextKey) throw new Error("key is required");
      if (!nextTitle) throw new Error("title is required");
      const nextBaseSvgAssetId = body.base_svg_asset_id === undefined
        ? (Number(current.base_svg_asset_id || 0) || null)
        : (Number(body.base_svg_asset_id || 0) || null);
      const nextPreviewAssetId = body.preview_asset_id === undefined
        ? (Number(current.preview_asset_id || 0) || null)
        : (Number(body.preview_asset_id || 0) || null);
      const nextCandidateMapAssetId = body.candidate_map_asset_id === undefined
        ? (Number(current.candidate_map_asset_id || current.base_svg_asset_id || 0) || null)
        : (Number(body.candidate_map_asset_id || 0) || null);
      const nextAnnotationMapAssetId = body.annotation_map_asset_id === undefined
        ? (Number(current.annotation_map_asset_id || current.preview_asset_id || 0) || null)
        : (Number(body.annotation_map_asset_id || 0) || null);
      const nextPublishedMapAssetId = body.published_map_asset_id === undefined
        ? (Number(current.published_map_asset_id || 0) || null)
        : (Number(body.published_map_asset_id || 0) || null);
      const nextActiveLabelLayoutId = body.active_label_layout_id === undefined
        ? (Number(current.active_label_layout_id || 0) || null)
        : (Number(body.active_label_layout_id || 0) || null);
      if (nextBaseSvgAssetId && !assetExists(db, nextBaseSvgAssetId)) throw new Error("base_svg_asset_id is invalid");
      if (nextBaseSvgAssetId && !assetIsSvg(db, nextBaseSvgAssetId)) throw new Error("base_svg_asset_id must reference an SVG asset");
      if (nextPreviewAssetId && !assetExists(db, nextPreviewAssetId)) throw new Error("preview_asset_id is invalid");
      if (nextCandidateMapAssetId && !assetExists(db, nextCandidateMapAssetId)) throw new Error("candidate_map_asset_id is invalid");
      if (nextAnnotationMapAssetId && !assetExists(db, nextAnnotationMapAssetId)) throw new Error("annotation_map_asset_id is invalid");
      if (nextPublishedMapAssetId && !assetExists(db, nextPublishedMapAssetId)) throw new Error("published_map_asset_id is invalid");
      if (nextActiveLabelLayoutId && !getLabelLayoutRow(nextActiveLabelLayoutId)) throw new Error("active_label_layout_id is invalid");
      const mergedMetadata = body.metadata && typeof body.metadata === "object"
        ? { ...currentMeta, ...body.metadata }
        : currentMeta;
      const nextMetadata = nextActiveLabelLayoutId
        ? stripLegacyLabelMetadata(mergedMetadata)
        : normalizeLabelLayoutMetadata(mergedMetadata);
      nextMetadata.overlays = normalizeBaseMapOverlays(db, {
        viewbox_width: bodyViewbox.width == null ? Number(current.viewbox_width) : num(bodyViewbox.width, Number(current.viewbox_width)),
        viewbox_height: bodyViewbox.height == null ? Number(current.viewbox_height) : num(bodyViewbox.height, Number(current.viewbox_height)),
      }, nextMetadata.overlays || []);
      const cleanupPaths = [];
      db.exec("BEGIN");
      try {
        db.prepare(`
          UPDATE transport_base_maps_v2
          SET map_key=?, title=?, version=?, status=?, bounds_min_lat=?, bounds_min_lng=?, bounds_max_lat=?, bounds_max_lng=?,
              viewbox_x=?, viewbox_y=?, viewbox_width=?, viewbox_height=?, projection_type=?, base_svg_asset_id=?, preview_asset_id=?,
              candidate_map_asset_id=?, annotation_map_asset_id=?, published_map_asset_id=?, active_label_layout_id=?, metadata_json=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).run(
          nextKey,
          nextTitle,
          Number(body.version ?? current.version ?? 1) || 1,
          String(body.status ?? current.status ?? "draft").trim().toLowerCase() || "draft",
          nextMinLat,
          nextMinLng,
          nextMaxLat,
          nextMaxLng,
          bodyViewbox.x == null ? Number(current.viewbox_x) : num(bodyViewbox.x, Number(current.viewbox_x)),
          bodyViewbox.y == null ? Number(current.viewbox_y) : num(bodyViewbox.y, Number(current.viewbox_y)),
          bodyViewbox.width == null ? Number(current.viewbox_width) : num(bodyViewbox.width, Number(current.viewbox_width)),
          bodyViewbox.height == null ? Number(current.viewbox_height) : num(bodyViewbox.height, Number(current.viewbox_height)),
          String(body.projection_type ?? current.projection_type ?? "linear-bbox-fit").trim() || "linear-bbox-fit",
          nextBaseSvgAssetId,
          nextPreviewAssetId,
          nextCandidateMapAssetId,
          nextAnnotationMapAssetId,
          nextPublishedMapAssetId,
          nextActiveLabelLayoutId,
          json(nextMetadata, "{}"),
          baseMapId
        );
        db.prepare(`
          UPDATE transport_routes_v2
          SET poster_status='stale', updated_at=CURRENT_TIMESTAMP
          WHERE base_map_id=?
        `).run(baseMapId);
        await regenerateBaseMapPreviewAsset(baseMapId, { cleanupPaths });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
        throw error;
      }
      const updated = serializeBaseMapResolved(getBaseMapRow(baseMapId));
      logAudit(actorEmail(req), "transport_v2.base_map.update", "transport_base_map_v2", String(baseMapId), { key: updated?.key || null });
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  router.post("/base-maps/:id/render-annotation", allow("owner", "admin"), wrap(async (req, res) => {
    const baseMapId = Number(req.params.id || 0) || 0;
    const current = getBaseMapRow(baseMapId);
    if (!current) return res.status(404).json({ error: "Base map not found" });
    const cleanupPaths = [];
    try {
      const updated = await regenerateBaseMapPreviewAsset(baseMapId, { cleanupPaths });
      logAudit(actorEmail(req), "transport_v2.base_map.render_annotation", "transport_base_map_v2", String(baseMapId), { key: updated?.key || current.map_key || null });
      res.json(updated);
    } catch (error) {
      await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
      throw error;
    }
  }));

  router.post("/base-maps/:id/render-published", allow("owner", "admin"), wrap(async (req, res) => {
    const baseMapId = Number(req.params.id || 0) || 0;
    const current = getBaseMapRow(baseMapId);
    if (!current) return res.status(404).json({ error: "Base map not found" });
    const cleanupPaths = [];
    try {
      const updated = await renderPublishedBaseMapAsset(baseMapId, { cleanupPaths });
      logAudit(actorEmail(req), "transport_v2.base_map.render_published", "transport_base_map_v2", String(baseMapId), { key: updated?.key || current.map_key || null });
      res.json(updated);
    } catch (error) {
      await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
      throw error;
    }
  }));

  router.get("/label-layouts", allow("owner", "admin", "editor", "user"), (_req, res) => {
    res.json({
      items: db.prepare("SELECT * FROM transport_label_layouts_v2 ORDER BY created_at DESC, id DESC").all().map((row) => ({
        ...serializeLabelLayout(row),
        labels: listLabelLayoutItems(row.id),
      })),
    });
  });

  router.get("/label-layouts/:id", allow("owner", "admin", "editor", "user"), (req, res) => {
    const layout = serializeLabelLayout(getLabelLayoutRow(req.params.id));
    if (!layout) return res.status(404).json({ error: "Label layout not found" });
    res.json({
      ...layout,
      labels: listLabelLayoutItems(req.params.id),
    });
  });

  router.post("/label-layouts", allow("owner", "admin"), (req, res) => {
    try {
      const body = req.body || {};
      const key = String(body.key || body.layout_key || "").trim();
      const title = String(body.title || "").trim();
      if (!key) throw new Error("key is required");
      if (!title) throw new Error("title is required");
      const metadata = body.metadata && typeof body.metadata === "object"
        ? normalizeLabelLayoutMetadata(body.metadata)
        : normalizeLabelLayoutMetadata({});
      db.prepare(`
        INSERT INTO transport_label_layouts_v2 (
          layout_key, title, status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        key,
        title,
        String(body.status || "draft").trim().toLowerCase() || "draft",
        json(metadata, "{}")
      );
      const createdId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0) || 0;
      const created = serializeLabelLayout(getLabelLayoutRow(createdId));
      logAudit(actorEmail(req), "transport_v2.label_layout.create", "transport_label_layout_v2", String(created?.id || ""), { key: created?.key || null });
      res.status(201).json(created);
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  router.put("/label-layouts/:id", allow("owner", "admin"), (req, res) => {
    try {
      const layoutId = Number(req.params.id || 0) || 0;
      const current = getLabelLayoutRow(layoutId);
      if (!current) return res.status(404).json({ error: "Label layout not found" });
      const body = req.body || {};
      const currentMeta = asJson(current.metadata_json, {});
      const nextKey = String(body.key ?? body.layout_key ?? current.layout_key ?? "").trim();
      const nextTitle = String(body.title ?? current.title ?? "").trim();
      if (!nextKey) throw new Error("key is required");
      if (!nextTitle) throw new Error("title is required");
      const metadata = body.metadata && typeof body.metadata === "object"
        ? normalizeLabelLayoutMetadata({ ...currentMeta, ...body.metadata })
        : normalizeLabelLayoutMetadata(currentMeta);
      db.exec("BEGIN");
      try {
        db.prepare(`
          UPDATE transport_label_layouts_v2
          SET layout_key=?, title=?, status=?, metadata_json=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).run(
          nextKey,
          nextTitle,
          String(body.status ?? current.status ?? "draft").trim().toLowerCase() || "draft",
          json(metadata, "{}"),
          layoutId
        );
        markRoutesStaleForLayout(layoutId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const updated = serializeLabelLayout(getLabelLayoutRow(layoutId));
      logAudit(actorEmail(req), "transport_v2.label_layout.update", "transport_label_layout_v2", String(layoutId), { key: updated?.key || null });
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  router.get("/label-layouts/:id/labels", allow("owner", "admin", "editor", "user"), (req, res) => {
    const layout = getLabelLayoutRow(req.params.id);
    if (!layout) return res.status(404).json({ error: "Label layout not found" });
    res.json({ items: listLabelLayoutItems(req.params.id) });
  });

  router.put("/label-layouts/:id/labels", allow("owner", "admin"), wrap(async (req, res) => {
    const layout = getLabelLayoutRow(req.params.id);
    if (!layout) return res.status(404).json({ error: "Label layout not found" });
    const layoutId = Number(req.params.id || 0) || 0;
    const items = normalizeLabelLayoutItemsInput(req.body?.items);
    const affectedBaseMapIds = baseMapIdsForLayout(layoutId);
    const cleanupPaths = [];
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM transport_label_layout_items_v2 WHERE label_layout_id=?").run(layoutId);
      const insert = db.prepare(`
        INSERT INTO transport_label_layout_items_v2 (
          label_layout_id, label_key, label_category, anchor_x, anchor_y, priority, min_zoom_hint, locale_offsets_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      for (const row of items) {
        insert.run(
          layoutId,
          row.label_key,
          row.label_category,
          row.anchor_x,
          row.anchor_y,
          row.priority,
          row.min_zoom_hint,
          row.locale_offsets ? json(row.locale_offsets, "{}") : null
        );
      }
      markRoutesStaleForLayout(layoutId);
      for (const baseMapId of affectedBaseMapIds) {
        await regenerateBaseMapPreviewAsset(baseMapId, { cleanupPaths });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
      throw error;
    }
    logAudit(actorEmail(req), "transport_v2.label_layout.update_labels", "transport_label_layout_v2", String(layoutId), { label_count: items.length });
    res.json({ items: listLabelLayoutItems(layoutId) });
  }));

  router.post("/label-layouts/:id/labels/translate", allow("owner", "admin"), wrap(async (req, res) => {
    const layout = getLabelLayoutRow(req.params.id);
    if (!layout) return res.status(404).json({ error: "Label layout not found" });
    const layoutMeta = normalizeLabelLayoutMetadata(asJson(layout.metadata_json, {}));
    const dictionary = normalizeLabelDictionary(req.body?.dictionary || layoutMeta?.label_dictionary || {});
    const translationMeta = normalizeLabelTranslationMeta(req.body?.label_translation || layoutMeta?.label_translation || {}, dictionary);
    const labelKeys = [...new Set((Array.isArray(req.body?.label_keys) ? req.body.label_keys : listLabelLayoutItems(layout.id).map((item) => item.label_key))
      .map((value) => String(value || "").trim())
      .filter(Boolean))];
    const thaiSource = Object.fromEntries(
      labelKeys
        .map((labelKey) => [labelKey, String(dictionary?.th?.[labelKey] || "").trim()])
        .filter(([, text]) => text)
    );
    if (!Object.keys(thaiSource).length) {
      return res.status(400).json({ error: "Thai source text is required before translate" });
    }
    const targetLocales = [...new Set((Array.isArray(req.body?.target_locales) ? req.body.target_locales : translationMeta.target_locales)
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .filter((value) => value !== "th"))];
    if (!targetLocales.length) {
      return res.status(400).json({ error: "target locales are required" });
    }
    const aiConfig = resolveEffectiveAiConfig();
    if (!aiConfig?.enabled) {
      return res.status(503).json({ error: "translation AI is not configured" });
    }
    const nextDictionary = normalizeLabelDictionary(dictionary);
    const nextTranslationMeta = normalizeLabelTranslationMeta({
      ...translationMeta,
      target_locales: targetLocales,
    }, nextDictionary);
    let translatedLocaleCount = 0;
    for (const locale of targetLocales) {
      const missingSource = Object.fromEntries(
        Object.entries(thaiSource).filter(([labelKey]) => !String(nextDictionary?.[locale]?.[labelKey] || "").trim())
      );
      if (!Object.keys(missingSource).length) continue;
      const translated = await translateLabelEntries(aiConfig, missingSource, locale);
      nextDictionary[locale] = {
        ...(nextDictionary[locale] || {}),
        ...translated,
      };
      const localeIsComplete = Object.keys(thaiSource).every((labelKey) => String(nextDictionary?.[locale]?.[labelKey] || "").trim());
      nextTranslationMeta.locale_statuses[locale] = {
        ...(nextTranslationMeta.locale_statuses?.[locale] || {}),
        status: localeIsComplete ? "translated" : "missing",
        reviewed: false,
        translated_at: new Date().toISOString(),
        translated_by: actorEmail(req),
        reviewed_at: null,
        reviewed_by: null,
      };
      translatedLocaleCount += 1;
    }
    const nextMetadata = normalizeLabelLayoutMetadata({
      ...layoutMeta,
      label_dictionary: nextDictionary,
      label_translation: nextTranslationMeta,
    });
    const affectedBaseMapIds = baseMapIdsForLayout(layout.id);
    const cleanupPaths = [];
    db.exec("BEGIN");
    try {
      db.prepare(`
        UPDATE transport_label_layouts_v2
        SET metadata_json=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(json(nextMetadata, "{}"), Number(layout.id));
      markRoutesStaleForLayout(layout.id);
      for (const baseMapId of affectedBaseMapIds) {
        await regenerateBaseMapPreviewAsset(baseMapId, { cleanupPaths });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
      throw error;
    }
    logAudit(actorEmail(req), "transport_v2.label_layout.translate_labels", "transport_label_layout_v2", String(layout.id), { translated_locale_count: translatedLocaleCount });
    res.json({
      label_dictionary: nextMetadata.label_dictionary,
      label_translation: nextMetadata.label_translation,
      translated_locale_count: translatedLocaleCount,
    });
  }));

  router.get("/base-maps/:id/labels", allow("owner", "admin", "editor", "user"), (req, res) => {
    const baseMap = getBaseMapRow(req.params.id);
    if (!baseMap) return res.status(404).json({ error: "Base map not found" });
    res.json({ items: resolveBaseMapLabelSource(baseMap).labels });
  });

  router.put("/base-maps/:id/labels", allow("owner", "admin"), wrap(async (req, res) => {
    const baseMap = getBaseMapRow(req.params.id);
    if (!baseMap) return res.status(404).json({ error: "Base map not found" });
    if (Number(baseMap.active_label_layout_id || 0)) {
      const layoutId = Number(baseMap.active_label_layout_id || 0) || 0;
      const items = normalizeLabelLayoutItemsInput(req.body?.items);
      const cleanupPaths = [];
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM transport_label_layout_items_v2 WHERE label_layout_id=?").run(layoutId);
        const insert = db.prepare(`
          INSERT INTO transport_label_layout_items_v2 (
            label_layout_id, label_key, label_category, anchor_x, anchor_y, priority, min_zoom_hint, locale_offsets_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `);
        for (const row of items) {
          insert.run(layoutId, row.label_key, row.label_category, row.anchor_x, row.anchor_y, row.priority, row.min_zoom_hint, row.locale_offsets ? json(row.locale_offsets, "{}") : null);
        }
        markRoutesStaleForLayout(layoutId);
        await regenerateBaseMapPreviewAsset(Number(baseMap.id || 0), { cleanupPaths });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
        throw error;
      }
      logAudit(actorEmail(req), "transport_v2.base_map.update_labels", "transport_base_map_v2", String(baseMap.id), { label_count: items.length, delegated_to_layout_id: layoutId });
      return res.json({ items: listLabelLayoutItems(layoutId) });
    }
    const baseMapId = Number(req.params.id || 0) || 0;
    const items = (Array.isArray(req.body?.items) ? req.body.items : [])
      .map((row, index) => ({
        label_key: String(row?.label_key || "").trim(),
        label_category: String(row?.label_category || "landmark").trim().toLowerCase() || "landmark",
        anchor_x: num(row?.anchor_x),
        anchor_y: num(row?.anchor_y),
        priority: Number(row?.priority ?? index) || 0,
        min_zoom_hint: row?.min_zoom_hint == null ? null : num(row?.min_zoom_hint),
      }))
      .filter((row) => row.label_key && Number.isFinite(row.anchor_x) && Number.isFinite(row.anchor_y));
    const cleanupPaths = [];
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM transport_base_map_labels_v2 WHERE base_map_id=?").run(baseMapId);
      const insert = db.prepare(`
        INSERT INTO transport_base_map_labels_v2 (base_map_id, label_key, label_category, anchor_x, anchor_y, priority, min_zoom_hint, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      for (const row of items) {
        insert.run(baseMapId, row.label_key, row.label_category, row.anchor_x, row.anchor_y, row.priority, row.min_zoom_hint);
      }
      db.prepare(`
        UPDATE transport_routes_v2
        SET poster_status='stale', updated_at=CURRENT_TIMESTAMP
        WHERE base_map_id=?
      `).run(baseMapId);
      await regenerateBaseMapPreviewAsset(baseMapId, { cleanupPaths });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      await Promise.allSettled(cleanupPaths.map((fullPath) => fs.rm(fullPath, { force: true })));
      throw error;
    }
    logAudit(actorEmail(req), "transport_v2.base_map.update_labels", "transport_base_map_v2", String(baseMapId), { label_count: items.length });
    res.json({ items: listBaseMapLabels(baseMapId) });
  }));

  router.post("/base-maps/:id/labels/translate", allow("owner", "admin"), wrap(async (req, res) => {
    const baseMap = getBaseMapRow(req.params.id);
    if (!baseMap) return res.status(404).json({ error: "Base map not found" });
    const source = resolveBaseMapLabelSource(baseMap);
    const baseMeta = source.metadata || {};
    const dictionary = normalizeLabelDictionary(req.body?.dictionary || baseMeta?.label_dictionary || {});
    const translationMeta = normalizeLabelTranslationMeta(req.body?.label_translation || baseMeta?.label_translation || {}, dictionary);
    const labelKeys = [...new Set((Array.isArray(req.body?.label_keys) ? req.body.label_keys : source.labels.map((item) => item.label_key))
      .map((value) => String(value || "").trim())
      .filter(Boolean))];
    const thaiSource = Object.fromEntries(
      labelKeys
        .map((labelKey) => [labelKey, String(dictionary?.th?.[labelKey] || "").trim()])
        .filter(([, text]) => text)
    );
    if (!Object.keys(thaiSource).length) {
      return res.status(400).json({ error: "Thai source text is required before translate" });
    }
    const targetLocales = [...new Set((Array.isArray(req.body?.target_locales) ? req.body.target_locales : translationMeta.target_locales)
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .filter((value) => value !== "th"))];
    if (!targetLocales.length) {
      return res.status(400).json({ error: "target locales are required" });
    }
    const aiConfig = resolveEffectiveAiConfig();
    if (!aiConfig?.enabled) {
      return res.status(503).json({ error: "translation AI is not configured" });
    }
    const nextDictionary = normalizeLabelDictionary(dictionary);
    const nextTranslationMeta = normalizeLabelTranslationMeta({
      ...translationMeta,
      target_locales: targetLocales,
    }, nextDictionary);
    let translatedLocaleCount = 0;
    for (const locale of targetLocales) {
      const missingSource = Object.fromEntries(
        Object.entries(thaiSource).filter(([labelKey]) => !String(nextDictionary?.[locale]?.[labelKey] || "").trim())
      );
      if (!Object.keys(missingSource).length) {
        continue;
      }
      const translated = await translateLabelEntries(aiConfig, missingSource, locale);
      translatedLocaleCount += 1;
      nextDictionary[locale] = {
        ...(nextDictionary[locale] || {}),
        ...translated,
      };
      const localeIsComplete = Object.keys(thaiSource).every((labelKey) => String(nextDictionary?.[locale]?.[labelKey] || "").trim());
      nextTranslationMeta.locale_statuses[locale] = {
        ...(nextTranslationMeta.locale_statuses?.[locale] || {}),
        status: localeIsComplete ? "translated" : "missing",
        reviewed: false,
        translated_at: new Date().toISOString(),
        translated_by: actorEmail(req),
        reviewed_at: null,
        reviewed_by: null,
      };
    }
    if (translatedLocaleCount > 0) {
      nextTranslationMeta.last_translated_at = new Date().toISOString();
      nextTranslationMeta.last_translated_by = actorEmail(req);
    }
    logAudit(actorEmail(req), "transport_v2.base_map.translate_labels", "transport_base_map_v2", String(baseMap.id), {
      label_count: Object.keys(thaiSource).length,
      target_locales: targetLocales,
      translated_locale_count: translatedLocaleCount,
    });
    res.json({
      label_dictionary: normalizeLabelDictionary(nextDictionary),
      label_translation: normalizeLabelTranslationMeta(nextTranslationMeta, nextDictionary),
      translated_locale_count: translatedLocaleCount,
    });
  }));

  router.post("/base-maps/:id/overlays/image", allow("owner", "admin"), upload.single("file"), wrap(async (req, res) => {
    const baseMap = getBaseMapRow(req.params.id);
    if (!baseMap) return res.status(404).json({ error: "Base map not found" });
    const file = req.file;
    if (!file?.buffer?.length) return res.status(400).json({ error: "image file is required" });
    const declaredMimeType = String(file.mimetype || "").trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(declaredMimeType)) {
      return res.status(400).json({ error: "only jpeg, png, and webp images are supported" });
    }
    const detectedMimeType = detectImageMimeFromBuffer(file.buffer);
    if (!detectedMimeType || detectedMimeType !== declaredMimeType) {
      return res.status(400).json({ error: "file content does not match declared image type" });
    }
    try {
      readImageDimensions(file.buffer, declaredMimeType);
    } catch (error) {
      return res.status(400).json({ error: String(error?.message || error) || "image payload is invalid" });
    }
    const extension = declaredMimeType === "image/png" ? ".png" : declaredMimeType === "image/webp" ? ".webp" : ".jpg";
    const relPath = path.join("uploads", "transport-v2", "base-maps", `base-map-${Number(baseMap.id || 0)}`, `overlay-${Date.now()}${extension}`);
    const fullPath = path.join(dirs.mediaDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);
    const stat = await fs.stat(fullPath);
    const assetUid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, created_at, updated_at)
      VALUES (?, 'local', ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(assetUid, relPath.replace(/\\/g, "/"), path.basename(fullPath), declaredMimeType, Number(stat.size || file.buffer.length || 0));
    const assetId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0) || 0;
    logAudit(actorEmail(req), "transport_v2.base_map.upload_overlay_image", "transport_base_map_v2", String(baseMap.id), { asset_id: assetId });
    res.status(201).json({
      asset_id: assetId,
      asset_url: assetUrl(db, assetId),
      mime_type: declaredMimeType,
    });
  }));

  router.get("/routes", allow("owner", "admin", "editor", "user"), (_req, res) => {
    res.json({ items: db.prepare("SELECT id FROM transport_routes_v2 ORDER BY updated_at DESC, id DESC").all().map((row) => getRoute(row.id)).filter(Boolean) });
  });

  router.post("/routes", allow("owner", "admin"), (req, res) => {
    try {
      const body = req.body || {};
      if (!String(body.route_name || "").trim()) throw new Error("route_name is required");
      if (!String(body.route_number || "").trim()) throw new Error("route_number is required");
      const baseMapId = Number(body.base_map_id || 0) || null;
      if (!baseMapId) throw new Error("base_map_id is required");
      if (baseMapId && !getBaseMapRow(baseMapId)) throw new Error("base_map_id is invalid");
      db.prepare(`
        INSERT INTO transport_routes_v2 (
          base_map_id, route_name, route_number, vehicle_type, color, description, workflow_status, assignee_user_id,
          route_revision, resolved_revision, poster_revision, routing_status, poster_status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'missing', 'missing', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        baseMapId,
        String(body.route_name).trim(),
        String(body.route_number).trim(),
        vehicle(body.vehicle_type),
        color(body.color),
        String(body.description || "").trim(),
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

  router.get("/routes/:id", allow("owner", "admin", "editor", "user"), (req, res) => {
    const item = getRoute(req.params.id);
    if (!item) return res.status(404).json({ error: "Route not found" });
    res.json(item);
  });

  router.put("/routes/:id", allow("owner", "admin", "editor", "user"), (req, res) => {
    try {
      const current = getRoute(req.params.id);
      if (!current) return res.status(404).json({ error: "Route not found" });
      const body = req.body || {};
      const baseMapId = Number((body.base_map_id ?? current.base_map_id) || 0) || null;
      if (baseMapId && !getBaseMapRow(baseMapId)) throw new Error("base_map_id is invalid");
      const nextRouteName = String((body.route_name ?? current.route_name) || "").trim() || current.route_name;
      const nextRouteNumber = String((body.route_number ?? current.route_number) || "").trim() || current.route_number;
      const nextVehicleType = vehicle(body.vehicle_type ?? current.vehicle_type);
      const nextColor = color(body.color ?? current.color, current.color);
      const nextDescription = String((body.description ?? current.description) || "").trim();
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
        SET base_map_id=?, route_name=?, route_number=?, vehicle_type=?, color=?, description=?, workflow_status=?, assignee_user_id=?,
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
        nextColor,
        nextDescription,
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

  router.post("/routes/:id/thumbnail", allow("owner", "admin", "editor", "user"), upload.single("file"), wrap(async (req, res) => {
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

  router.put("/routes/:id/control-points", allow("owner", "admin", "editor", "user"), (req, res) => {
    const current = getRoute(req.params.id);
    if (!current) return res.status(404).json({ error: "Route not found" });
    const points = normalizePoints(req.body?.control_points || req.body?.items || []);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM transport_route_control_points_v2 WHERE route_id=?").run(Number(req.params.id));
      const insert = db.prepare("INSERT INTO transport_route_control_points_v2 (route_id, point_order, lat, lng, label, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
      for (const point of points) insert.run(Number(req.params.id), point.order, point.lat, point.lng, point.label, point.note);
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

  router.put("/routes/:id/stops", allow("owner", "admin", "editor", "user"), (req, res) => {
    const current = getRoute(req.params.id);
    if (!current) return res.status(404).json({ error: "Route not found" });
    const stops = normalizeStops(req.body?.stops || req.body?.items || []);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM transport_route_stops_v2 WHERE route_id=?").run(Number(req.params.id));
      const insert = db.prepare("INSERT INTO transport_route_stops_v2 (route_id, stop_order, name, lat, lng, stop_type, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
      for (const stop of stops) insert.run(Number(req.params.id), stop.order, stop.name, stop.lat, stop.lng, stop.stop_type, stop.note);
      bumpRoute(req.params.id, actorEmail(req));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const next = getRoute(req.params.id);
    logAudit(actorEmail(req), "transport_v2.route.update_stops", "transport_route_v2", String(next.id), { route_revision: next.route_revision, stop_count: next.stops.length });
    res.json(next);
  });

  router.post("/routes/:id/resolve", allow("owner", "admin", "editor", "user"), wrap(async (req, res) => {
    const item = getRoute(req.params.id);
    if (!item) return res.status(404).json({ error: "Route not found" });
    if (!osrmBaseUrl) {
      db.prepare("UPDATE transport_routes_v2 SET routing_status='error', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(item.id));
      return res.status(503).json({ error: "OSRM is not configured" });
    }
    if (item.control_points.length < 2) return res.status(409).json({ error: "At least 2 control points are required before resolve" });
    const coords = item.control_points.map((point) => `${point.lng},${point.lat}`).join(";");
    const response = await fetch(`${osrmBaseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.code !== "Ok") {
      db.prepare("UPDATE transport_routes_v2 SET routing_status='error', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(item.id));
      return res.status(502).json({ error: payload?.message || "OSRM route resolve failed", osrm: payload });
    }
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
    const next = getRoute(item.id);
    logAudit(actorEmail(req), "transport_v2.route.resolve", "transport_route_v2", String(next.id), { route_revision: next.route_revision, resolved_revision: next.resolved_revision, point_count: next.resolved_path.length });
    res.json(next);
  }));

  router.post("/routes/:id/render-poster", allow("owner", "admin", "editor", "user"), wrap(async (req, res) => {
    const item = getRoute(req.params.id);
    if (!item) return res.status(404).json({ error: "Route not found" });
    if (item.routing_status !== "fresh" || item.resolved_revision !== item.route_revision) return res.status(409).json({ error: "Route must be resolved before poster render", route: item });
    const baseMap = getBaseMapRow(item.base_map_id);
    if (!baseMap) {
      db.prepare("UPDATE transport_routes_v2 SET poster_status='error', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(item.id));
      return res.status(409).json({ error: "base_map_id is required before poster render" });
    }
    const serializedBaseMap = serializeBaseMapResolved(baseMap);
    const annotationAssetId = Number(baseMap.annotation_map_asset_id || 0) || null;
    // Use annotation map asset for poster rendering
    const posterUrl = assetUrl(db, annotationAssetId);
    if (!posterUrl) {
      return res.status(500).json({ error: "poster asset not found" });
    }
    // Update route with poster status
    db.prepare("UPDATE transport_routes_v2 SET poster_status='done', poster_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(posterUrl, Number(item.id));
    res.json({ poster_url: posterUrl, status: "done" });
  }));

  return router;
}
