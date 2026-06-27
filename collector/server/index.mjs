import "dotenv/config";
import crypto from "crypto";
import { once } from "events";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import express from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { createCollectorAuthIntegration } from "./auth-integration.mjs";
import { createCollectorMcpPublicTestRouter, createCollectorMcpRouter } from "./mcp/index.mjs";
import { createTransportV2Router } from "./transport-v2-router.mjs";
import {
  assertCollectorIntegrationReadiness,
  getCollectorIntegrationReadiness,
  getCollectorRequiredIntegrationKeys,
} from "./integration-readiness.mjs";
import { resolvePaths } from "../config/paths.mjs";
import {
  buildFeaturePolicyMap,
  listAiFeatureCatalog,
  listAiPolicyCatalog,
  resolveAiFeatureConfig,
  resolveAiConfig,
} from "../config/ai.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository, hasRecognizedEvaluationOverrideInput } from "../db/repository.mjs";
import { resolveRequestedChecksWithCatalog } from "./taxonomy-resolver.mjs";
import { collectRawFromAdapter, listSourceAdapters } from "../collector/sources/index.mjs";
import { dedupeMediaEntries, normalizeMediaUrl } from "../collector/sources/media.mjs";
import {
  getCurrentTranslationSourceFingerprint,
  isTranslationRowStale as isWorkflowTranslationRowStale,
  isTranslationTechnicalReady as isWorkflowTranslationTechnicalReady,
  isTranslationRecheckPassed as isWorkflowTranslationRecheckPassed,
  applyReviewAction,
  compensateReleaseAfterSyncFailure,
  parseImportText,
  releaseItemToMainSite,
  reopenReviewDecision,
  returnFieldPackToClean,
  reviewInternalLink,
  rerunProblemTranslations,
  repairAndRecheckTranslationFromIssues,
  rerunTranslationRecheck,
  runAiDraftStage,
  runCleanStage,
  runQualityStage,
} from "../services/workflow.mjs";
import { generateExecutionChannelForItem } from "../services/execution-generation.mjs";
import { buildCleanStructuredContext, validateCleanMinimum } from "../services/clean-context.mjs";
import { deriveCtaContactCandidatesFromStructuredContext } from "./cta-contact-normalizer.mjs";
import { isCtaTraceEnabled, summarizeCtaCandidates, summarizeStructuredContext, traceCtaStage } from "../services/cta-trace.mjs";
import {
  DEFAULT_FIELD_PACK_AGENT_PROFILE,
  FIELD_PACK_AGENT_KEY,
  createAgentGenerationEngine,
} from "../services/agent-generation.mjs";
import { executeBackendAiJson } from "../services/backend-ai-client.mjs";
import { buildArticleSuggestionPrompt, buildArticleSuggestionRequestContext, normalizeArticleSuggestion } from "../services/article-agent.mjs";
import { planBulkItemDelete } from "../services/raw-delete.mjs";
import { buildSeoSuggestionPrompt, buildSeoSuggestionRequestContext, normalizeSeoSuggestion } from "../services/seo-agent.mjs";
import {
  absolutizeCollectorMediaUrl,
  buildAdminReviewMultipartUploadPlan,
  mergeInlineMediaManifestFromBody,
  rewriteCollectorHtmlMediaUrls,
} from "./review-inline-media.mjs";
import {
  buildAssignmentSubmissionPayload,
  buildFieldPackUpdatePayloadFromAgent,
  mergeConfirmedDraftMetadata,
} from "./endpoint-schema-mapping.mjs";
import { buildReviewIngestContentPayload, resolveReviewIngestPayloadSourceContext } from "./review-ingest-mapping.mjs";

const ARTICLE_AGENT_KEY = "article_agent";
const DEFAULT_ARTICLE_AGENT_PROFILE = [
  "คุณคือ Article Agent สำหรับ UbonCity มีหน้าที่ร่างบทความท่องเที่ยวจากข้อมูลที่มีอยู่ เช่น field pack, Q&A, media, handoff, และข้อมูลสถานที่หรืออีเวนต์",
  "",
  "เขียนภาษาไทยให้อ่านง่าย เป็นธรรมชาติ ไม่ขายของ ไม่เขียนเหมือนโฆษณา และเหมาะกับนักท่องเที่ยวจริง",
  "",
  "ใช้เฉพาะข้อมูลที่มีหลักฐานหรือได้รับการยืนยันแล้ว ถ้าข้อมูลไม่ชัวร์ให้เขียนอย่างระมัดระวังหรือเว้นไว้ให้ editor ตรวจ ไม่แต่งข้อเท็จจริงเพิ่มเอง",
  "",
  "เน้นโครงเรื่องที่ช่วยให้คนอ่านตัดสินใจได้ว่า ที่นี่เหมาะกับใคร ไปทำอะไรได้ จุดเด่นจริงคืออะไร และควรรู้อะไรก่อนไป",
].join("\n");

const SEO_AGENT_KEY = "seo_agent";
const DEFAULT_SEO_AGENT_PROFILE = [
  "คุณคือ SEO Agent สำหรับ UbonCity มีหน้าที่สร้างหรือปรับ metadata จากบทความที่ editor แก้แล้วใน Article Workspace",
  "",
  "เขียนเพื่อคนอ่านจริงก่อน search engine ไม่ยัด keyword ไม่ทำให้เหมือนโฆษณา และไม่แต่งข้อเท็จจริงเพิ่ม",
  "",
  "meta title ต้องชัด อ่านรู้เรื่อง เป็นธรรมชาติ และควรยาวประมาณ 45-65 ตัวอักษรถ้าเป็นไปได้",
  "",
  "meta description ต้องสรุปว่าบทความหรือสถานที่นี้มีประโยชน์กับผู้อ่านอย่างไร และช่วยให้เขาตัดสินใจอะไรได้ ควรยาวประมาณ 120-155 ตัวอักษรถ้าเป็นไปได้",
  "",
  "ถ้าข้อมูลในบทความไม่พอหรือยังไม่ชัวร์ ห้ามนำไปใช้เป็น metadata แบบฟันธง",
  "",
  "SEO Agent เป็น suggestion-only: เติมข้อเสนอในช่อง metadata เพื่อให้คนตรวจและกด save เอง ไม่ auto-save ไม่ auto-publish",
].join("\n");

const app = express();
const port = Number(process.env.PORT || 5060);
const bindHost = String(process.env.COLLECTOR_BIND_HOST || "127.0.0.1").trim() || "127.0.0.1";
const dirs = resolvePaths(path.resolve(process.cwd()));
const backendApiBase = String(
  process.env.COLLECTOR_SYNC_BACKEND_API || process.env.BACKEND_API_BASE_URL || process.env.BACKEND_URL || ""
).trim();
const backendSyncToken = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
const backendJwtSecret = String(process.env.BACKEND_JWT_SECRET || process.env.JWT_SECRET || "").trim();
const backendJwtIssuer = String(process.env.BACKEND_JWT_ISSUER || process.env.JWT_ISSUER || "uboncity-backend").trim();
const collectorBackendJwtAudience = String(
  process.env.COLLECTOR_BACKEND_JWT_AUDIENCE || "uboncity-collector"
).trim();
const webReviewSyncToken = String(process.env.COLLECTOR_REVIEW_SYNC_TOKEN || "").trim();
const collectorPublicBaseUrl = String(process.env.COLLECTOR_PUBLIC_BASE_URL || process.env.COLLECTOR_PUBLIC_URL || "").trim();
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
const db = openDatabase(dirs.dbPath, schemaPath);
const repo = createRepository(db);
const AI_POLICY_CATALOG = listAiPolicyCatalog();
const AI_POLICY_BY_KEY = new Map(AI_POLICY_CATALOG.map((row) => [String(row.key || "").trim(), row]));
const AI_FEATURE_CATALOG = listAiFeatureCatalog();
const AI_FEATURE_BY_KEY = new Map(AI_FEATURE_CATALOG.map((row) => [String(row.key || "").trim(), row]));
const slugBackfillResult = typeof repo.backfillInvalidSlugs === "function"
  ? repo.backfillInvalidSlugs()
  : null;
const MAX_IMAGES_PER_ITEM = 25;
const GOOGLE_MAPS_PHOTO_PROXY_PATH = "/api/google-maps/photo";
const COLLECTOR_ASSET_VERSION_TOKEN = "__COLLECTOR_ASSET_VERSION__";
const collectorPublicDir = path.join(dirs.rootDir, "server", "public");
const collectorRootIndexPath = path.join(collectorPublicDir, "index.html");
const collectorAssetVersionOverride = String(process.env.COLLECTOR_ASSET_VERSION || "").trim();
const collectorServerBootVersion = String(Date.now());

function resolveCollectorAssetVersionForFile(filePath) {
  if (collectorAssetVersionOverride) return collectorAssetVersionOverride;
  try {
    const stats = fsSync.statSync(filePath);
    const mtimeMs = Number(stats.mtimeMs || 0);
    if (mtimeMs > 0) return String(Math.floor(mtimeMs));
  } catch {}
  return collectorServerBootVersion;
}

function setCollectorHtmlRevalidateHeaders(res) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function isSafeCollectorHtmlRequestPath(rawPath) {
  return typeof rawPath === "string" && /^\/[A-Za-z0-9._/-]+\.html$/i.test(rawPath);
}

function resolveCollectorHtmlFilePath(requestPath) {
  if (!isSafeCollectorHtmlRequestPath(requestPath)) return null;
  const relativePath = requestPath.slice(1);
  const fullPath = path.resolve(collectorPublicDir, relativePath);
  const normalizedPublicDir = path.resolve(collectorPublicDir) + path.sep;
  if (!fullPath.startsWith(normalizedPublicDir)) return null;
  return fullPath;
}

function renderCollectorHtmlFile(filePath) {
  const htmlTemplate = fsSync.readFileSync(filePath, "utf8");
  return rewriteCollectorHtmlAssetUrls(htmlTemplate, filePath);
}

function isSafeCollectorJsRequestPath(rawPath) {
  return typeof rawPath === "string" && /^\/[A-Za-z0-9._/-]+\.(?:mjs|js)$/i.test(rawPath);
}

function resolveCollectorJsFilePath(requestPath) {
  if (!isSafeCollectorJsRequestPath(requestPath)) return null;
  const relativePath = requestPath.slice(1);
  const fullPath = path.resolve(collectorPublicDir, relativePath);
  const normalizedPublicDir = path.resolve(collectorPublicDir) + path.sep;
  if (!fullPath.startsWith(normalizedPublicDir)) return null;
  return fullPath;
}

function resolveCollectorAssetFilePath(specifier, importerPath = "") {
  if (typeof specifier !== "string" || !specifier) return null;
  if (!(specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/"))) return null;

  const hashIndex = specifier.indexOf("#");
  const withoutHash = hashIndex >= 0 ? specifier.slice(0, hashIndex) : specifier;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  if (!pathname) return null;

  const importerDir = importerPath
    ? path.dirname(importerPath)
    : collectorPublicDir;
  const candidatePath = pathname.startsWith("/")
    ? path.resolve(collectorPublicDir, `.${pathname}`)
    : path.resolve(importerDir, pathname);
  const normalizedPublicDir = path.resolve(collectorPublicDir) + path.sep;
  if (!candidatePath.startsWith(normalizedPublicDir)) return null;
  return candidatePath;
}

function withVersionQuery(specifier, importerPath = "") {
  if (typeof specifier !== "string" || !specifier) return specifier;
  if (!(specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/"))) return specifier;

  const hashIndex = specifier.indexOf("#");
  const hash = hashIndex >= 0 ? specifier.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? specifier.slice(0, hashIndex) : specifier;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";

  if (!/\.(?:mjs|js|css)$/i.test(pathname)) return specifier;

  const params = new URLSearchParams(query);
  const assetFilePath = resolveCollectorAssetFilePath(specifier, importerPath);
  const version = resolveCollectorAssetVersionForFile(assetFilePath || importerPath || collectorRootIndexPath);
  if (!params.has("v") || params.get("v") === COLLECTOR_ASSET_VERSION_TOKEN) {
    params.set("v", version);
  }
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash}`;
}

function rewriteCollectorHtmlAssetUrls(htmlText, htmlFilePath) {
  return htmlText.replace(
    /((?:src|href)=["'])([^"']+)(["'])/gi,
    (match, prefix, specifier, suffix) => `${prefix}${withVersionQuery(specifier, htmlFilePath)}${suffix}`
  );
}

function rewriteCollectorModuleSpecifiers(jsText, sourcePath = "") {
  const withTokenResolved = jsText;
  const withStaticImports = withTokenResolved.replace(
    /((?:\bimport|\bexport)\s+(?:[^"'`]*?\s+from\s*)?)(["'])([^"'`]+)\2/g,
    (match, prefix, quote, specifier) => `${prefix}${quote}${withVersionQuery(specifier, sourcePath)}${quote}`
  );
  return withStaticImports.replace(
    /(\bimport\s*\(\s*)(["'])([^"'`]+)\2(\s*\))/g,
    (match, prefix, quote, specifier, suffix) => `${prefix}${quote}${withVersionQuery(specifier, sourcePath)}${quote}${suffix}`
  );
}

function renderCollectorRootHtml() {
  const htmlTemplate = fsSync.readFileSync(collectorRootIndexPath, "utf8");
  return rewriteCollectorHtmlAssetUrls(htmlTemplate, collectorRootIndexPath);
}
const CONTENT_ITEM_CATEGORIES = new Set(["attractions", "activities", "hotels", "cafes", "restaurants", "transport"]);
const ARTICLE_RICH_TEXT_ALLOWED_TAGS = new Set([
  "p",
  "br",
  "h2",
  "h3",
  "blockquote",
  "ul",
  "ol",
  "li",
  "figure",
  "figcaption",
  "img",
  "iframe",
  "strong",
  "em",
  "b",
  "i",
  "a",
]);
const ARTICLE_RICH_TEXT_VOID_TAGS = new Set(["br", "img"]);
const TRANSPORT_MAP_ITEM_TYPE = "public_transport_map";
const TRANSPORT_MAP_SOURCE_TYPE = "transport_map";
const TRANSPORT_MAP_VEHICLE_TYPES = new Set(["songthaew", "minibus", "van", "bus"]);
const TRANSPORT_MAP_DEFAULT_IMAGES = Object.freeze({
  songthaew: "/transport-vehicles/songthaew.svg",
  minibus: "/transport-vehicles/minibus.svg",
  van: "/transport-vehicles/van.svg",
  bus: "/transport-vehicles/bus.svg",
});
const TRANSPORT_MAP_DEFAULT_THUMBNAIL = TRANSPORT_MAP_DEFAULT_IMAGES.bus;
const TRANSPORT_MAP_DEFAULT_COLOR = "#ff6600";
const TRANSPORT_MAP_MAX_POINTS = 2000;
const TRANSPORT_MAP_MAX_STOPS = 400;
const ASSIGNMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024 * 1024;
const OTHER_TRANSPORT_ITEM_TYPE = "other_transport";
const OTHER_TRANSPORT_METADATA_SOURCE_TYPE = "manual";
const OTHER_TRANSPORT_METADATA_SOURCE_NAME = "collector-other-transport";
const OTHER_TRANSPORT_SUBTYPES = new Set(["taxi", "rental", "shuttle", "other"]);
const AGENT_PROFILE_DEFINITIONS = Object.freeze({
  [FIELD_PACK_AGENT_KEY]: {
    agent_key: FIELD_PACK_AGENT_KEY,
    display_name: "Field Pack Agent",
    default_profile_text: DEFAULT_FIELD_PACK_AGENT_PROFILE,
  },
  [ARTICLE_AGENT_KEY]: {
    agent_key: ARTICLE_AGENT_KEY,
    display_name: "Article Agent",
    default_profile_text: DEFAULT_ARTICLE_AGENT_PROFILE,
  },
  [SEO_AGENT_KEY]: {
    agent_key: SEO_AGENT_KEY,
    display_name: "SEO Agent",
    default_profile_text: DEFAULT_SEO_AGENT_PROFILE,
  },
});
const AGENT_PROFILE_MAX_LENGTH = 8000;

function normalizeAiFeaturePolicyForResponse(row) {
  if (!row) return null;
  const featureKey = String(row.feature_key || "").trim();
  const feature = AI_FEATURE_BY_KEY.get(featureKey);
  if (!feature) return null;
  const policyKey = String(row.policy_key || "").trim();
  const policy = AI_POLICY_BY_KEY.get(policyKey) || null;
  return {
    feature_key: featureKey,
    policy_key: policyKey,
    feature_label: feature.label,
    feature_description: feature.description,
    feature_status: feature.status,
    feature_active: Boolean(feature.active),
    policy_label: policy?.label || null,
    provider: policy?.provider || null,
    model: policy?.model || null,
    updated_by: row.updated_by || null,
    updated_at: row.updated_at || null,
  };
}

function listStoredAiFeaturePolicyMap() {
  const rawRows = Array.isArray(repo.listAiFeaturePolicies()) ? repo.listAiFeaturePolicies() : [];
  const map = {};
  for (const row of rawRows) {
    const key = String(row?.feature_key || "").trim();
    const value = String(row?.policy_key || "").trim();
    if (!AI_FEATURE_BY_KEY.has(key)) continue;
    if (!AI_POLICY_BY_KEY.has(value)) continue;
    map[key] = value;
  }
  return map;
}

function getEffectiveAiConfig() {
  return resolveAiConfig({ policyByFeature: listStoredAiFeaturePolicyMap() });
}

function sleep(ms) {
  const waitMs = Number(ms || 0);
  if (!Number.isFinite(waitMs) || waitMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function isRetryableAiDraftError(err) {
  const message = String(err?.message || "").trim().toLowerCase();
  if (!message) return false;
  if (message.includes(" 429") || message.includes(" 503") || message.includes(" 504")) return true;
  if (message.includes("unavailable")) return true;
  if (message.includes("timeout")) return true;
  if (message.includes("temporarily")) return true;
  return false;
}

function buildAiFeatureRuntimeSnapshot(aiConfig) {
  const config = aiConfig && typeof aiConfig === "object" ? aiConfig : {};
  const features = config?.features && typeof config.features === "object" ? config.features : {};
  const pickFeature = (key) => {
    const row = features?.[key] && typeof features[key] === "object" ? features[key] : {};
    return {
      policy_key: String(row?.policyKey || "").trim() || null,
      provider: String(row?.provider || "").trim() || null,
      model: String(row?.model || "").trim() || null,
      has_api_key: false,
      backend_proxy_ready: Boolean(String(config?.backendApiBase || "").trim() && String(config?.backendSyncToken || "").trim()),
    };
  };
  return {
    field_pack: pickFeature("fieldPack"),
    visual_context: pickFeature("visualContext"),
    translation: pickFeature("translation"),
    translation_recheck: pickFeature("translationRecheck"),
    translation_repair: pickFeature("translationRepair"),
    seo_agent: pickFeature("seoAgent"),
  };
}

function listAiFeaturePolicyRowsForOwner() {
  const effectiveMap = buildFeaturePolicyMap(listStoredAiFeaturePolicyMap());
  return AI_FEATURE_CATALOG.map((feature) => {
    const key = String(feature.key || "").trim();
    const policy = effectiveMap[key] || null;
    const stored = repo.getAiFeaturePolicy(key);
    return normalizeAiFeaturePolicyForResponse({
      feature_key: key,
      policy_key: policy?.policy_key || "",
      updated_by: stored?.updated_by || null,
      updated_at: stored?.updated_at || null,
    });
  }).filter(Boolean);
}

function isPlaceholderSecret(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return true;
  return normalized === "CHANGE_ME" || normalized.startsWith("REPLACE_WITH_");
}

function hasConfiguredSyncToken() {
  return !isPlaceholderSecret(backendSyncToken);
}

function hasConfiguredWebReviewToken() {
  return !isPlaceholderSecret(webReviewSyncToken);
}

function collectorIntegrationConfig() {
  return {
    backendApiBase,
    backendSyncToken,
    webReviewSyncToken,
    collectorPublicBaseUrl,
  };
}

function canUseLocalReleaseSyncSimulation() {
  if (String(process.env.COLLECTOR_ALLOW_RELEASE_SYNC_SIMULATION || "").trim() === "1") {
    return true;
  }
  try {
    const url = new URL(String(backendApiBase || "").trim());
    const host = String(url.hostname || "").trim().toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function isValidWebReviewSyncToken(candidate) {
  const expected = String(webReviewSyncToken || "");
  const provided = String(candidate || "");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function toFiniteNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTransportVehicleType(value) {
  const normalized = String(value || "songthaew").trim().toLowerCase();
  if (TRANSPORT_MAP_VEHICLE_TYPES.has(normalized)) return normalized;
  if (normalized === "mini-bus" || normalized === "mini_bus") return "minibus";
  return "songthaew";
}

function normalizeTransportColor(value, fallback = TRANSPORT_MAP_DEFAULT_COLOR) {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  const withHash = normalized.startsWith("#") ? normalized : `#${normalized}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : fallback;
}

function normalizeTransportMediaUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.startsWith("/")) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return "";
}

function normalizeTransportVehicleImage(vehicleType, value) {
  const normalized = normalizeTransportMediaUrl(value);
  if (normalized) return normalized;
  return TRANSPORT_MAP_DEFAULT_THUMBNAIL;
}

function isTransportDefaultThumbnail(value) {
  return String(value || "").trim() === TRANSPORT_MAP_DEFAULT_THUMBNAIL;
}

function normalizeTransportPoint(row) {
  if (!row || typeof row !== "object") return null;
  const lat = toFiniteNumber(row.lat);
  const lng = toFiniteNumber(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function normalizeTransportPointList(rows, max = TRANSPORT_MAP_MAX_POINTS) {
  const list = Array.isArray(rows) ? rows.slice(0, max) : [];
  return list.map(normalizeTransportPoint).filter(Boolean);
}

function normalizeTransportStops(rows) {
  const list = Array.isArray(rows) ? rows.slice(0, TRANSPORT_MAP_MAX_STOPS) : [];
  return list
    .map((row, index) => {
      const point = normalizeTransportPoint(row);
      if (!point) return null;
      const name = String(row?.name || `Stop ${index + 1}`).trim() || `Stop ${index + 1}`;
      return { ...point, name };
    })
    .filter(Boolean);
}

function calculateTransportDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const toRad = (deg) => (deg * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const dLat = toRad(curr.lat - prev.lat);
    const dLng = toRad(curr.lng - prev.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(prev.lat)) * Math.cos(toRad(curr.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    total += 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return Number(total.toFixed(2));
}

function isTransportMapItem(item) {
  return String(item?.type || "").trim().toLowerCase() === TRANSPORT_MAP_ITEM_TYPE;
}

function isOtherTransportItem(item) {
  return String(item?.type || "").trim().toLowerCase() === OTHER_TRANSPORT_ITEM_TYPE;
}

function normalizeOtherTransportSubtype(value, fallback = "other") {
  const normalized = String(value || "").trim().toLowerCase();
  if (OTHER_TRANSPORT_SUBTYPES.has(normalized)) return normalized;
  return OTHER_TRANSPORT_SUBTYPES.has(String(fallback || "").trim().toLowerCase())
    ? String(fallback || "").trim().toLowerCase()
    : "other";
}

function normalizeOtherTransportPhone(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeOtherTransportContactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function normalizeOtherTransportLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function getOtherTransportSourceRecord(itemId) {
  const targetId = Number(itemId || 0) || 0;
  if (!targetId) return null;
  const rows = repo.listSourceRecordsByItem(targetId);
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.find((row) =>
    String(row?.source_name || "").trim().toLowerCase() === OTHER_TRANSPORT_METADATA_SOURCE_NAME
  ) || null;
}

function normalizeOtherTransportMetadata(input = {}, item = null) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fallbackMeta = item?.other_transport_meta && typeof item.other_transport_meta === "object"
    ? item.other_transport_meta
    : parseObjectCandidate(getOtherTransportSourceRecord(item?.id)?.payload_json) || {};
  const subtype = normalizeOtherTransportSubtype(
    source.subtype || fallbackMeta.subtype || item?.source_entity_id || "other",
    item?.source_entity_id || fallbackMeta.subtype || "other"
  );
  return {
    subtype,
    contact_name: normalizeOtherTransportContactText(source.contact_name || fallbackMeta.contact_name || item?.title || ""),
    contact_details: normalizeOtherTransportContactText(source.contact_details || fallbackMeta.contact_details || ""),
    phone: normalizeOtherTransportPhone(source.phone || fallbackMeta.phone || ""),
    link_url: normalizeOtherTransportLink(source.link_url || fallbackMeta.link_url || ""),
    thumbnail_mode: "cover_asset",
  };
}

function getOtherTransportMetadata(item) {
  if (!isOtherTransportItem(item)) return null;
  return normalizeOtherTransportMetadata({}, item);
}

function upsertOtherTransportMetadata(itemId, item, input = {}) {
  const targetId = Number(itemId || 0) || 0;
  if (!targetId) return null;
  const metadata = normalizeOtherTransportMetadata(input, item);
  const existing = getOtherTransportSourceRecord(targetId);
  const payloadJson = JSON.stringify(metadata);
  if (existing?.id) {
    db.prepare(`
      UPDATE source_records
      SET source_type=?, source_name=?, source_entity_id=?, payload_json=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      OTHER_TRANSPORT_METADATA_SOURCE_TYPE,
      OTHER_TRANSPORT_METADATA_SOURCE_NAME,
      metadata.subtype,
      payloadJson,
      Number(existing.id || 0)
    );
    return { id: Number(existing.id || 0), payload: metadata };
  }
  const result = db.prepare(`
    INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
    VALUES (?, ?, ?, NULL, ?, ?)
  `).run(
    targetId,
    OTHER_TRANSPORT_METADATA_SOURCE_TYPE,
    OTHER_TRANSPORT_METADATA_SOURCE_NAME,
    metadata.subtype,
    payloadJson
  );
  return { id: Number(result?.lastInsertRowid || 0) || 0, payload: metadata };
}

function attachOtherTransportMetadataToItem(item) {
  if (!isOtherTransportItem(item)) return sanitizeItemForResponse(item);
  return sanitizeItemForResponse({
    ...item,
    other_transport_meta: getOtherTransportMetadata(item),
  });
}

function normalizeTransportRoutePayload(input = {}, item = null) {
  const routeName = String(input.route_name || input.name || item?.title || "").trim();
  const routeNumber = String(input.route_number || input.route_code || item?.slug || "").trim();
  const vehicleType = normalizeTransportVehicleType(input.vehicle_type || input.route_type);
  const vehicleImage = normalizeTransportVehicleImage(vehicleType, input.vehicle_image || input.thumbnail_url);
  const rawPoints = normalizeTransportPointList(input.raw_points || input.rawPoints || []);
  const path = normalizeTransportPointList(input.path || []);
  const stops = normalizeTransportStops(input.stops || []);
  const description = String(input.description || item?.summary || "").trim();
  const color = normalizeTransportColor(input.color, TRANSPORT_MAP_DEFAULT_COLOR);

  return {
    route_name: routeName,
    route_number: routeNumber,
    vehicle_type: vehicleType,
    vehicle_image: vehicleImage,
    color,
    description,
    raw_points: rawPoints,
    path,
    stops,
    distance_km: calculateTransportDistanceKm(path),
  };
}

function getTransportMapSourceRecord(itemId) {
  const targetId = Number(itemId || 0) || 0;
  if (!targetId) return null;
  const rows = repo.listSourceRecordsByItem(targetId);
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.find((row) => String(row?.source_type || "").trim().toLowerCase() === TRANSPORT_MAP_SOURCE_TYPE) || rows[0] || null;
}

function listTransportMapAssetUrls(itemId) {
  const targetId = Number(itemId || 0) || 0;
  if (!targetId) return [];
  return db.prepare(`
    SELECT a.storage_path
    FROM content_assets ca
    JOIN assets a ON a.id = ca.asset_id
    WHERE ca.content_item_id=?
  `)
    .all(targetId)
    .map((row) => parseAssetPathForUrl(row?.storage_path || ""))
    .filter(Boolean);
}

function classifyTransportThumbnail(itemId, value) {
  const normalized = normalizeTransportMediaUrl(value);
  if (!normalized) {
    return {
      url: "",
      is_default: false,
      is_asset: false,
      is_valid: false,
    };
  }
  if (isTransportDefaultThumbnail(normalized)) {
    return {
      url: normalized,
      is_default: true,
      is_asset: false,
      is_valid: true,
    };
  }
  const assetUrls = new Set(listTransportMapAssetUrls(itemId));
  return {
    url: normalized,
    is_default: false,
    is_asset: assetUrls.has(normalized),
    is_valid: assetUrls.has(normalized),
  };
}

function buildTransportMapRouteResponse(item) {
  if (!item) return null;
  const sourceRecord = getTransportMapSourceRecord(item.id);
  const payload = normalizeTransportRoutePayload(sourceRecord?.payload_json || {}, item);
  const thumbnail = classifyTransportThumbnail(item.id, payload.vehicle_image);
  return {
    ...attachSingleItemClaimUser(item),
    ...payload,
    vehicle_image: thumbnail.url || payload.vehicle_image,
    thumbnail_is_default: thumbnail.is_default,
    thumbnail_is_asset: thumbnail.is_asset,
    thumbnail_is_valid: thumbnail.is_valid,
    default_thumbnail_url: TRANSPORT_MAP_DEFAULT_THUMBNAIL,
    source_record_id: Number(sourceRecord?.id || 0) || null,
    type: TRANSPORT_MAP_ITEM_TYPE,
    category: "transport",
  };
}

function validateTransportMapRouteForPublish(route) {
  const missing = [];
  if (!String(route?.route_name || "").trim()) missing.push("route_name");
  if (!String(route?.route_number || "").trim()) missing.push("route_number");
  if (!Array.isArray(route?.path) || route.path.length < 2) missing.push("path");
  if (!String(route?.vehicle_image || "").trim()) missing.push("thumbnail");
  if (route?.thumbnail_is_valid !== true) missing.push("thumbnail_asset");
  return {
    ok: missing.length === 0,
    missing,
  };
}

function buildTransportRouteSyncPayload(route) {
  return {
    source_system: "collector-app",
    source_base_url: resolveCollectorPublicBaseUrl(),
    routes: [
      {
        source_content_item_id: Number(route?.id || 0) || 0,
        route_name: String(route?.route_name || "").trim(),
        route_number: String(route?.route_number || "").trim(),
        vehicle_type: normalizeTransportVehicleType(route?.vehicle_type),
        vehicle_image: normalizeTransportVehicleImage(route?.vehicle_type, route?.vehicle_image),
        color: normalizeTransportColor(route?.color, TRANSPORT_MAP_DEFAULT_COLOR),
        description: String(route?.description || "").trim(),
        raw_points: normalizeTransportPointList(route?.raw_points || []),
        path: normalizeTransportPointList(route?.path || []),
        stops: normalizeTransportStops(route?.stops || []),
      },
    ],
  };
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function parseAllowedOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
}

function normalizePhoneKey(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "").trim();
  if (!digits) return "";
  if (digits.startsWith("+66")) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("66") && digits.length >= 9) {
    return `0${digits.slice(2)}`;
  }
  return digits.replace(/^\+/, "");
}

function getItemBulkPreview(itemId) {
  const id = Number(itemId || 0);
  if (!id) {
    return {
      source_count: 0,
      media_count: 0,
      evidence_count: 0,
      approved_context_count: 0,
      blockers: [],
    };
  }
  return {
    source_count: Number(db.prepare("SELECT COUNT(*) AS c FROM source_records WHERE content_item_id=?").get(id)?.c || 0),
    media_count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE content_item_id=?").get(id)?.c || 0),
    evidence_count: Number(db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id=?").get(id)?.c || 0),
    approved_context_count: Number(db.prepare("SELECT COUNT(*) AS c FROM approved_context_blocks WHERE content_item_id=?").get(id)?.c || 0),
    blockers: getMergeBlockersForItem(id),
  };
}

function deriveHostName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return String(new URL(raw).hostname || "").trim().replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sanitizeArticleHtmlUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
}

function normalizeArticleEmbedUrl(value) {
  const raw = sanitizeArticleHtmlUrl(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, "http://localhost");
    const host = String(url.hostname || "").replace(/^www\./i, "").toLowerCase();
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname.startsWith("/embed/")) return `https://www.youtube.com${url.pathname}`;
      if (url.pathname.startsWith("/shorts/")) {
        const videoId = url.pathname.replace(/^\/shorts\//, "").split("/")[0] || "";
        return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
      }
      const videoId = url.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }
    if (host === "youtu.be") {
      const videoId = url.pathname.replace(/^\/+/, "").split("/")[0] || "";
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }
    if (host === "youtube-nocookie.com") {
      return url.pathname.startsWith("/embed/") ? `https://www.youtube-nocookie.com${url.pathname}` : "";
    }
    if (host === "vimeo.com") {
      const videoId = url.pathname.replace(/^\/+/, "").split("/")[0] || "";
      return videoId ? `https://player.vimeo.com/video/${videoId}` : "";
    }
    if (host === "player.vimeo.com") {
      return url.pathname.startsWith("/video/") ? `https://player.vimeo.com${url.pathname}` : "";
    }
    if (host === "tiktok.com" || host === "m.tiktok.com") {
      if (url.pathname.startsWith("/embed/v2/")) return `https://www.tiktok.com${url.pathname}`;
      const match = url.pathname.match(/\/@[^/]+\/video\/(\d+)/i);
      return match?.[1] ? `https://www.tiktok.com/embed/v2/${match[1]}` : "";
    }
    if (host === "facebook.com" || host === "m.facebook.com" || host === "web.facebook.com") {
      if (url.pathname.startsWith("/plugins/video.php")) {
        const href = url.searchParams.get("href");
        return href
          ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`
          : "";
      }
      const isVideoPath = url.pathname.startsWith("/watch")
        || url.pathname.startsWith("/reel/")
        || /\/videos\//i.test(url.pathname)
        || url.pathname.startsWith("/share/v/");
      if (isVideoPath) {
        const href = `${url.origin}${url.pathname}${url.search}`;
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function detectArticleEmbedOrientation(value) {
  const raw = sanitizeArticleHtmlUrl(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, "http://localhost");
    const host = String(url.hostname || "").replace(/^www\./i, "").toLowerCase();
    const path = String(url.pathname || "").toLowerCase();
    if (host === "tiktok.com" || host === "m.tiktok.com") return "vertical";
    if ((host === "youtube.com" || host === "m.youtube.com") && path.startsWith("/shorts/")) return "vertical";
    if (host === "facebook.com" || host === "m.facebook.com" || host === "web.facebook.com") {
      if (path.startsWith("/reel/") || path.startsWith("/reels/")) return "vertical";
      if (path.startsWith("/plugins/video.php")) {
        const href = decodeURIComponent(url.searchParams.get("href") || "");
        if (/\/reels?\//i.test(href)) return "vertical";
      }
    }
  } catch {
    return "";
  }
  return "";
}

function extractHtmlAttribute(rawTag, attributeName) {
  const tag = String(rawTag || "");
  const name = String(attributeName || "").trim().toLowerCase();
  if (!tag || !name) return "";
  const pattern = new RegExp(`${name}\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))`, "i");
  const match = tag.match(pattern);
  return String(match?.[2] || match?.[3] || match?.[4] || "").trim();
}

function sanitizeArticleHtmlTag(rawTag) {
  const tag = String(rawTag || "");
  const match = tag.match(/^<\s*(\/?)\s*([a-z0-9:-]+)/i);
  if (!match) return "";
  const isClosing = match[1] === "/";
  const tagName = String(match[2] || "").trim().toLowerCase();
  if (!ARTICLE_RICH_TEXT_ALLOWED_TAGS.has(tagName)) return "";
  if (isClosing) {
    return ARTICLE_RICH_TEXT_VOID_TAGS.has(tagName) ? "" : `</${tagName}>`;
  }
  if (tagName === "br") return "<br>";
  if (tagName === "img") {
    const src = sanitizeArticleHtmlUrl(extractHtmlAttribute(tag, "src"));
    if (!src) return "";
    const alt = extractHtmlAttribute(tag, "alt");
    return alt
      ? `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}">`
      : `<img src="${escapeHtmlAttribute(src)}">`;
  }
  if (tagName === "iframe") {
    const rawSrc = extractHtmlAttribute(tag, "src");
    const rawOrientation = String(extractHtmlAttribute(tag, "data-orientation") || "").trim().toLowerCase();
    const src = normalizeArticleEmbedUrl(rawSrc);
    if (!src) return "";
    const orientation = rawOrientation === "vertical"
      ? "vertical"
      : (detectArticleEmbedOrientation(rawSrc) || detectArticleEmbedOrientation(src));
    return `<iframe src="${escapeHtmlAttribute(src)}" loading="lazy"${orientation === "vertical" ? ' data-orientation="vertical"' : ""} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen>`;
  }
  if (tagName === "a") {
    const href = sanitizeArticleHtmlUrl(extractHtmlAttribute(tag, "href"));
    if (!href) return "";
    return `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">`;
  }
  return `<${tagName}>`;
}

function sanitizeArticleRichTextHtml(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const stripped = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|object|embed|svg|math|form|textarea|select|option|button)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|object|embed|svg|math|form|textarea|select|option|button)\b[^>]*\/?\s*>/gi, "");
  return stripped.replace(/<[^>]*>/g, (tag) => sanitizeArticleHtmlTag(tag)).trim();
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function pickFirstFiniteNumber(...values) {
  for (const value of values) {
    const n = toFiniteNumberOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function isThirdPartyPlaceHost(host) {
  const value = String(host || "").trim().toLowerCase();
  if (!value) return false;
  return /(google\.[a-z.]+|gstatic\.com|wongnai\.com|facebook\.com|fb\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|booking\.com|agoda\.com|traveloka\.com)/i.test(value);
}

function isInstitutionalReferenceDomain(domain) {
  const value = String(domain || "").trim().toLowerCase();
  if (!value) return false;
  return (
    value.endsWith(".go.th")
    || value.endsWith(".ac.th")
    || value.endsWith(".or.th")
    || value.endsWith(".gov")
    || value.endsWith(".edu")
  );
}

function looksLikeOfficialSupportRecord(record) {
  const sourceType = String(record?.source_type || "").trim().toLowerCase();
  const sourceUrl = String(record?.source_url || "").trim();
  const host = deriveHostName(sourceUrl);
  if (sourceType && sourceType !== "manual") return false;
  if (!host || isThirdPartyPlaceHost(host)) return false;

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }

  const pathname = String(parsed.pathname || "/").trim() || "/";
  const segments = pathname
    .split("/")
    .map((segment) => String(segment || "").trim().toLowerCase())
    .filter(Boolean);

  let score = 0;
  if (isInstitutionalReferenceDomain(host)) score += 4;
  if (pathname === "/" || pathname === "") score += 4;
  if (segments.some((segment) => ["about", "about-us", "aboutus", "contact", "contact-us", "contactus", "visit", "location", "history", "museum", "travel", "tourism"].includes(segment))) {
    score += 2;
  }
  if (segments.length <= 1 && pathname !== "/" && pathname !== "") score += 1;
  if (!parsed.search) score += 1;
  else score -= 1;
  if (segments.length >= 3) score -= 2;
  if (segments.some((segment) => ["article", "articles", "blog", "blogs", "news", "post", "posts", "detail", "details", "category", "categorie", "tag", "tags", "archive", "archives"].includes(segment))) {
    score -= 2;
  }
  if (segments.some((segment) => segment.length >= 48 || /\d{4}[-_/]?\d{1,2}[-_/]?\d{1,2}/.test(segment))) {
    score -= 1;
  }
  const sourceName = String(record?.source_name || "").trim().toLowerCase();
  if (sourceName && !["", "manual", "manual-url"].includes(sourceName) && sourceName !== host) {
    score += 1;
  }
  return score >= 2;
}

function isPlaceholderDescriptionText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^imported from pasted url:/i.test(text);
}

function readPayloadLayers(record) {
  const payload = parseObjectCandidate(record?.payload_json) || {};
  const normalized = parseObjectCandidate(payload?.normalized_json)
    || parseObjectCandidate(payload?.payload_json?.normalized_json)
    || {};
  const extractedMetadata = parseObjectCandidate(payload?.extracted_metadata)
    || parseObjectCandidate(payload?.payload_json?.extracted_metadata)
    || {};
  const extractedArticle = parseObjectCandidate(payload?.extracted_article)
    || parseObjectCandidate(payload?.payload_json?.extracted_article)
    || {};
  const extractedReviews = parseObjectCandidate(payload?.extracted_reviews)
    || parseObjectCandidate(payload?.payload_json?.extracted_reviews)
    || {};
  return {
    payload,
    normalized,
    extractedMetadata,
    extractedArticle,
    extractedReviews,
  };
}

function scorePlaceInterestingness(item = {}, sourceRecords = []) {
  const reasons = [];
  const sourceLabels = [];
  let score = 0;
  let hasGoogle = false;
  let hasWongnai = false;
  let hasOfficial = false;
  let hasInstitutional = false;
  const itemSummary = String(item?.summary || "").trim();
  const itemDescriptionRaw = String(item?.description_raw || "").trim();
  let hasArticle = Boolean(itemSummary || (itemDescriptionRaw && !isPlaceholderDescriptionText(itemDescriptionRaw)));
  let hasAddress = false;
  let hasHours = false;
  let hasPhone = Boolean(String(item?.match_phone || "").trim());
  let hasImage = Boolean(String(item?.image_url || "").trim());
  let googleUserRatingCount = null;
  let googleRating = null;
  let googleHasPhotos = false;
  let googleHasReviewText = false;
  let wongnaiSignals = 0;

  for (const record of Array.isArray(sourceRecords) ? sourceRecords : []) {
    const sourceType = String(record?.source_type || "").trim().toLowerCase();
    const sourceUrl = pickFirstText(record?.source_url);
    const host = deriveHostName(sourceUrl);
    const {
      payload,
      normalized,
      extractedMetadata,
      extractedArticle,
      extractedReviews,
    } = readPayloadLayers(record);

    const pageProfile = pickFirstText(
      extractedMetadata?.page_profile,
      payload?.page_profile,
      normalized?.page_profile
    ).toLowerCase();
    const isGoogle = sourceType === "google_maps" || /(?:^|\.)google\./i.test(host) || /places\.googleapis\.com/i.test(sourceUrl);
    const isWongnai = sourceType === "wongnai" || /(?:^|\.)wongnai\.com$/i.test(host);
    const isInstitutional = pageProfile === "institutional" || /\.go\.th$/i.test(host);
    const isOfficial = looksLikeOfficialSupportRecord(record);

    if (isGoogle) hasGoogle = true;
    if (isWongnai) hasWongnai = true;
    if (isOfficial) hasOfficial = true;
    if (isInstitutional) hasInstitutional = true;

    const articleText = pickFirstText(
      extractedArticle?.body_text,
      ...(Array.isArray(extractedArticle?.section_texts) ? extractedArticle.section_texts : []),
      normalized?.article_body_text,
      normalized?.description,
      extractedArticle?.excerpt,
      extractedMetadata?.description
    );
    if (articleText) hasArticle = true;

    const addressText = pickFirstText(
      extractedMetadata?.address,
      normalized?.formatted_address,
      normalized?.short_formatted_address,
      normalized?.address,
      normalized?.vicinity
    );
    if (addressText) hasAddress = true;

    const openingHours = Array.isArray(extractedMetadata?.opening_hours)
      ? extractedMetadata.opening_hours
      : Array.isArray(normalized?.opening_hours_weekday_text)
        ? normalized.opening_hours_weekday_text
        : [];
    if (openingHours.some((value) => String(value || "").trim())) hasHours = true;

    const phoneText = pickFirstText(
      extractedMetadata?.phone,
      extractedMetadata?.national_phone_number,
      extractedMetadata?.international_phone_number,
      normalized?.national_phone_number,
      normalized?.international_phone_number,
      payload?.telephone
    );
    if (phoneText) hasPhone = true;

    const recordImage = pickFirstText(
      extractedMetadata?.image,
      normalized?.image,
      payload?.image,
      payload?.ogImage
    );
    if (recordImage) hasImage = true;

    if (isGoogle) {
      googleUserRatingCount = pickFirstFiniteNumber(
        googleUserRatingCount,
        extractedMetadata?.user_rating_count,
        normalized?.user_rating_count,
        normalized?.userRatingCount
      );
      googleRating = pickFirstFiniteNumber(
        googleRating,
        extractedMetadata?.rating,
        normalized?.rating
      );
      const photoCount = Array.isArray(extractedMetadata?.photos)
        ? extractedMetadata.photos.length
        : Array.isArray(payload?.photos)
          ? payload.photos.length
          : 0;
      if (photoCount > 0 || recordImage) googleHasPhotos = true;
      const reviewCount = pickFirstFiniteNumber(
        extractedReviews?.count_found,
        Array.isArray(extractedReviews?.items) ? extractedReviews.items.length : null,
        Array.isArray(normalized?.review_snippets) ? normalized.review_snippets.length : null
      );
      if ((reviewCount || 0) > 0) googleHasReviewText = true;
    }

    if (isWongnai) {
      if (pickFirstText(extractedMetadata?.description, extractedArticle?.excerpt, normalized?.description, normalized?.editorial_summary)) {
        wongnaiSignals += 1;
      }
      const hasMenu = (
        (Array.isArray(extractedMetadata?.menu_sections) && extractedMetadata.menu_sections.length > 0)
        || (Array.isArray(extractedMetadata?.menu_highlights) && extractedMetadata.menu_highlights.length > 0)
        || (Array.isArray(normalized?.menu_sections) && normalized.menu_sections.length > 0)
        || (Array.isArray(normalized?.menu_highlights) && normalized.menu_highlights.length > 0)
      );
      if (hasMenu) wongnaiSignals += 1;
      const hasReviews = (
        (Array.isArray(extractedReviews?.items) && extractedReviews.items.length > 0)
        || (Array.isArray(normalized?.review_snippets) && normalized.review_snippets.length > 0)
      );
      if (hasReviews) wongnaiSignals += 1;
      if (recordImage) wongnaiSignals += 1;
    }
  }

  if (hasInstitutional) sourceLabels.push("เว็บหน่วยงาน");
  else if (hasOfficial) sourceLabels.push("เว็บไซต์ทางการ");
  if (hasGoogle) sourceLabels.push("Google Maps");
  if (hasWongnai) sourceLabels.push("Wongnai");
  if (!sourceLabels.length && Array.isArray(sourceRecords) && sourceRecords.length > 0) {
    sourceLabels.push("Manual");
  }

  const corroborationCount = [hasGoogle, hasWongnai, hasOfficial || hasInstitutional].filter(Boolean).length;
  if (corroborationCount >= 3) {
    score += 4;
    reasons.push("หลายแหล่งยืนยันตรงกัน");
  } else if (corroborationCount >= 2) {
    score += 2;
    reasons.push("มีหลายแหล่งข้อมูลรองรับ");
  }
  if (hasGoogle && hasWongnai) {
    score += 2;
    reasons.push("มีทั้งกระแสและข้อมูลสถานที่");
  }

  if (googleUserRatingCount != null) {
    if (googleUserRatingCount >= 500) score += 4;
    else if (googleUserRatingCount >= 150) score += 3;
    else if (googleUserRatingCount >= 40) score += 2;
    else if (googleUserRatingCount >= 10) score += 1;
    if (googleUserRatingCount >= 40) reasons.push("Google คนให้คะแนนค่อนข้างมาก");
  }
  if (googleRating != null && googleRating >= 4.4) {
    score += 1;
    reasons.push("Google rating ค่อนข้างดี");
  }
  if (googleHasPhotos) score += 1;
  if (googleHasReviewText) score += 1;

  if (wongnaiSignals >= 3) {
    score += 3;
    reasons.push("Wongnai ให้ข้อมูลร้านค่อนข้างแน่น");
  } else if (wongnaiSignals >= 1) {
    score += 1;
    reasons.push("มีข้อมูลเชิงร้านจาก Wongnai");
  }

  if (hasInstitutional) {
    score += 1;
    reasons.push("มีเว็บหน่วยงานอ้างอิง");
  } else if (hasOfficial) {
    score += 1;
    reasons.push("มีเว็บไซต์ทางการรองรับ");
  }

  const richnessCount = [hasArticle, hasAddress, hasHours, hasPhone, hasImage].filter(Boolean).length;
  if (richnessCount >= 4) {
    score += 2;
    reasons.push("ข้อมูลพร้อมทำต่อ");
  } else if (richnessCount >= 2) {
    score += 1;
    reasons.push("ข้อมูลพอทำต่อ");
  }

  let label = "ข้อมูลยังบาง";
  let rank = 0;
  if (score >= 10) {
    label = "น่าทำก่อน";
    rank = 3;
  } else if (score >= 6) {
    label = "มีศักยภาพ";
    rank = 2;
  } else if (score >= 3) {
    label = "ต้องตรวจเอง";
    rank = 1;
  }

  if (!reasons.length) reasons.push("ข้อมูลยังบาง");

  return {
    score,
    rank,
    label,
    reasons: Array.from(new Set(reasons)).slice(0, 4),
    source_labels: sourceLabels,
  };
}

function attachItemMatchFields(items = [], options = {}) {
  const includeBulkPreview = options?.includeBulkPreview === true;
  return (Array.isArray(items) ? items : []).map((item) => {
    const itemId = Number(item?.id || 0);
    const sourceRecords = repo.listSourceRecordsByItem(itemId);
    const currentFieldPack = repo.getCurrentFieldPackByItem(itemId);
    const latestFieldPack = currentFieldPack || (Array.isArray(repo.listFieldPacksByItem(itemId)) ? repo.listFieldPacksByItem(itemId)[0] : null);
    const workflow = repo.getWorkflowModelByItem(itemId);
    let matchPhone = "";
    for (const record of sourceRecords) {
      const payload = record?.payload_json && typeof record.payload_json === "object" ? record.payload_json : {};
      const rawPhone =
        payload.nationalPhoneNumber ||
        payload.internationalPhoneNumber ||
        payload.national_phone_number ||
        payload.international_phone_number ||
        payload.telephone ||
        "";
      const normalized = normalizePhoneKey(rawPhone);
      if (normalized) {
        matchPhone = normalized;
        break;
      }
    }
    const next = {
      ...item,
      image_url: sanitizeGoogleMapsPhotoUrl(item?.image_url),
      production_state: String(workflow?.production_state || "").trim().toLowerCase() || null,
      publication_state: String(workflow?.publication_state || "").trim().toLowerCase() || null,
      current_field_pack_id: Number(currentFieldPack?.id || latestFieldPack?.id || 0) || null,
      current_field_pack_status: String(currentFieldPack?.status || latestFieldPack?.status || "").trim().toLowerCase() || null,
      assignment_state: String(workflow?.assignment_state || "").trim().toLowerCase() || null,
      current_draft_id: Number(workflow?.current_draft_id || 0) || null,
      current_review_report_id: Number(workflow?.current_review_report_id || 0) || null,
      workflow_state_version: Number(workflow?.state_version || 0) || 0,
      workflow_content_version: Number(workflow?.content_version || 0) || 0,
      match_phone: matchPhone || null,
      interestingness: scorePlaceInterestingness({
        ...item,
        match_phone: matchPhone || null,
      }, sourceRecords),
    };
    if (includeBulkPreview) {
      next.bulk_preview = getItemBulkPreview(itemId);
    }
    return next;
  });
}

function sanitizeItemForResponse(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    image_url: sanitizeGoogleMapsPhotoUrl(item?.image_url),
  };
}

function attachWorkflowHeadFields(item) {
  if (!item || typeof item !== "object") return item;
  const itemId = Number(item?.id || 0);
  const workflow = repo.getWorkflowHeadByItem(itemId) || null;
  const currentFieldPack = repo.getCurrentFieldPackByItem(itemId) || null;
  const latestFieldPack = currentFieldPack || (Array.isArray(repo.listFieldPacksByItem(itemId)) ? repo.listFieldPacksByItem(itemId)[0] : null);
  return {
    ...item,
    production_state: String(workflow?.production_state || "").trim().toLowerCase() || null,
    publication_state: String(workflow?.publication_state || "").trim().toLowerCase() || null,
    assignment_state: String(workflow?.assignment_state || "").trim().toLowerCase() || null,
    current_draft_id: Number(workflow?.current_draft_id || 0) || null,
    current_review_report_id: Number(workflow?.current_review_report_id || 0) || null,
    current_field_pack_id: Number(workflow?.current_field_pack_id || currentFieldPack?.id || latestFieldPack?.id || 0) || null,
    current_field_pack_status: String(currentFieldPack?.status || latestFieldPack?.status || "").trim().toLowerCase() || null,
    workflow_state_version: Number(workflow?.state_version || 0) || 0,
    workflow_content_version: Number(workflow?.content_version || 0) || 0,
  };
}

function toUniquePositiveIds(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
}

function mergeTextTags(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const text = String(value || "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(text);
    }
  }
  return merged;
}

function isMeaningfulScalar(value) {
  if (value == null) return false;
  if (typeof value === "string") return String(value).trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function buildMergedItemSnapshot(item) {
  return {
    source_item_id: Number(item?.id || 0),
    title: String(item?.title || "").trim() || null,
    type: String(item?.type || "").trim() || null,
    category: String(item?.category || "").trim() || null,
    description_raw: String(item?.description_raw || "").trim() || null,
    description_clean: String(item?.description_clean || "").trim() || null,
    summary: String(item?.summary || "").trim() || null,
    meta_title: String(item?.meta_title || "").trim() || null,
    meta_description: String(item?.meta_description || "").trim() || null,
    latitude: item?.latitude == null ? null : Number(item.latitude),
    longitude: item?.longitude == null ? null : Number(item.longitude),
    map_url: String(item?.map_url || "").trim() || null,
    google_place_id: String(item?.google_place_id || "").trim() || null,
    image_url: String(item?.image_url || "").trim() || null,
    tags: Array.isArray(item?.tags) ? item.tags : [],
  };
}

function preserveSecondaryItemFacts(masterItem, sourceItem) {
  const masterId = Number(masterItem?.id || 0);
  const sourceId = Number(sourceItem?.id || 0);
  if (!masterId || !sourceId) {
    return { source_snapshot_added: 0, master_fields_filled: 0 };
  }

  const snapshotEntityId = `merged-content-item:${sourceId}`;
  const existingSnapshot = db
    .prepare("SELECT id FROM source_records WHERE content_item_id=? AND source_entity_id=? LIMIT 1")
    .get(masterId, snapshotEntityId);

  if (!existingSnapshot) {
    db.prepare(`
      INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
      VALUES (?, 'merge_snapshot', ?, NULL, ?, ?)
    `).run(
      masterId,
      String(sourceItem?.title || "").trim() || `Merged item #${sourceId}`,
      snapshotEntityId,
      JSON.stringify({
        merge_mode: "bulk_merge",
        merged_into_item_id: masterId,
        snapshot: buildMergedItemSnapshot(sourceItem),
      })
    );
  }

  const patch = {};
  const fillableFields = [
    "type",
    "category",
    "description_raw",
    "description_clean",
    "summary",
    "meta_title",
    "meta_description",
    "map_url",
    "google_place_id",
    "image_url",
  ];

  let masterFieldsFilled = 0;
  for (const field of fillableFields) {
    if (!isMeaningfulScalar(masterItem?.[field]) && isMeaningfulScalar(sourceItem?.[field])) {
      patch[field] = sourceItem[field];
      masterFieldsFilled += 1;
    }
  }

  const masterLatMissing = !Number.isFinite(Number(masterItem?.latitude));
  const masterLngMissing = !Number.isFinite(Number(masterItem?.longitude));
  const sourceLatPresent = Number.isFinite(Number(sourceItem?.latitude));
  const sourceLngPresent = Number.isFinite(Number(sourceItem?.longitude));
  if (masterLatMissing && masterLngMissing && sourceLatPresent && sourceLngPresent) {
    patch.latitude = Number(sourceItem.latitude);
    patch.longitude = Number(sourceItem.longitude);
    masterFieldsFilled += 2;
  }

  if (masterFieldsFilled > 0) {
    const fields = Object.keys(patch);
    const assignments = fields.map((field) => `${field}=@${field}`).join(", ");
    db.prepare(`UPDATE content_items SET ${assignments}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({
      id: masterId,
      ...patch,
    });
    Object.assign(masterItem, patch);
  }

  return {
    source_snapshot_added: existingSnapshot ? 0 : 1,
    master_fields_filled: masterFieldsFilled,
  };
}

function getMergeBlockersForItem(itemId) {
  const blockers = [];
  const checks = [
    {
      key: "assignments",
      label: "มี assignment งานอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assignments WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "published_articles",
      label: "เผยแพร่ขึ้นเว็บแล้ว",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM published_articles WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "translations",
      label: "มีงานแปลที่ผูกอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_translations WHERE source_content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "drafts",
      label: "มี AI draft ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_drafts WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "review_reports",
      label: "มี review report ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM review_reports WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "staging_items",
      label: "มีข้อมูล staging/export ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM staging_items WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_versions",
      label: "มีประวัติเวอร์ชันคอนเทนต์อยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_versions WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "source_records",
      label: "มีแหล่งข้อมูลต้นทางผูกอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM source_records WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "reviews_raw",
      label: "มีรีวิวดิบค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM reviews_raw WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "quality_checks",
      label: "มีผลตรวจคุณภาพค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM quality_checks WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_assets",
      label: "มีไฟล์หรือรูปที่ผูกกับรายการนี้",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "evidence_blocks",
      label: "มี evidence block ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "approved_context_blocks",
      label: "มี approved context ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM approved_context_blocks WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "draft_input_snapshots",
      label: "มี draft input snapshot ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM draft_input_snapshots WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "field_packs",
      label: "มี field pack ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM field_packs WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_workflow_models",
      label: "มี workflow model ผูกอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_workflow_models WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_workflow_transitions",
      label: "มีประวัติ workflow transition อยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_workflow_transitions WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_readiness_briefs",
      label: "มี readiness brief ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_readiness_briefs WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_execution_controls",
      label: "มี execution controls ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_execution_controls WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_execution_channels",
      label: "มี execution channels ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_execution_channels WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "search_enrichment_records",
      label: "มีข้อมูล search enrichment ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM search_enrichment_records WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "place_intelligence_scores",
      label: "มีคะแนน place intelligence ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM place_intelligence_scores WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "social_signal_sources",
      label: "มีข้อมูล social signal ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM social_signal_sources WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "social_momentum_snapshots",
      label: "มี social momentum snapshot ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM social_momentum_snapshots WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_direction_reports",
      label: "มี content direction report ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_direction_reports WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "review_actions",
      label: "มีประวัติ action จาก review อยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM review_actions WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_intelligence_models",
      label: "มี intelligence model ค้างอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_intelligence_models WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_assignment_submissions",
      label: "มีงานส่งกลับจาก assignment อยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assignment_submissions WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "content_assignment_submission_deliverables",
      label: "มีไฟล์หรือข้อมูลส่งงานจาก assignment อยู่",
      count: Number(
        db.prepare("SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE content_item_id=?").get(itemId)?.c || 0
      ),
    },
    {
      key: "content_assignment_handoff_snapshots",
      label: "มี snapshot การส่งงานอยู่",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM content_assignment_handoff_snapshots WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "internal_link_sources",
      label: "มี internal link suggestion ต้นทาง",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM internal_link_suggestions WHERE content_item_id=?").get(itemId)?.c || 0),
    },
    {
      key: "internal_link_targets",
      label: "มี internal link suggestion ปลายทาง",
      count: Number(db.prepare("SELECT COUNT(*) AS c FROM internal_link_suggestions WHERE target_content_item_id=?").get(itemId)?.c || 0),
    },
  ];

  for (const check of checks) {
    if (check.count > 0) {
      blockers.push({ key: check.key, label: check.label, count: check.count });
    }
  }
  return blockers;
}

function getDeletedItemCleanupSnapshot(itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return null;
  return db.prepare(`
    SELECT id, item_uid, type, category, title, slug, workflow_status, claimed_by_user_id, is_deleted, created_at, updated_at
    FROM content_items
    WHERE id=? AND is_deleted=1
  `).get(id) || null;
}

function buildDeletedItemCleanupReport(row) {
  if (!row) return null;
  const blockers = getMergeBlockersForItem(Number(row.id || 0));
  return {
    id: Number(row.id || 0) || 0,
    item_uid: row.item_uid || null,
    type: row.type || null,
    category: row.category || null,
    title: row.title || null,
    slug: row.slug || null,
    legacy_workflow_status: row.workflow_status || null,
    claimed_by_user_id: row.claimed_by_user_id ?? null,
    is_deleted: Number(row.is_deleted || 0) || 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    blockers,
    blocker_count: blockers.length,
    can_purge: blockers.length === 0,
    blocker_summary: blockers.map((entry) => ({
      key: entry.key,
      label: entry.label,
      count: Number(entry.count || 0) || 0,
    })),
  };
}

function listDeletedItemCleanupReports(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = db.prepare(`
    SELECT id, item_uid, type, category, title, slug, workflow_status, claimed_by_user_id, is_deleted, created_at, updated_at
    FROM content_items
    WHERE is_deleted=1
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(safeLimit);
  return rows.map((row) => buildDeletedItemCleanupReport(row)).filter(Boolean);
}

function purgeDeletedItemTx(itemId, actorEmailValue, reasonText) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = getDeletedItemCleanupSnapshot(itemId);
    if (!row) {
      const err = new Error("deleted item not found");
      err.statusCode = 404;
      throw err;
    }
    const blockers = getMergeBlockersForItem(Number(itemId || 0));
    if (blockers.length) {
      const err = new Error("deleted item has purge blockers");
      err.statusCode = 409;
      err.blockers = blockers;
      err.snapshot = row;
      throw err;
    }
    repo.logAudit(actorEmailValue, "item.purge", "content_item", String(Number(itemId || 0) || 0), {
      reason: String(reasonText || "").trim() || null,
      snapshot: {
        id: Number(row.id || 0) || 0,
        item_uid: row.item_uid || null,
        type: row.type || null,
        category: row.category || null,
        title: row.title || null,
        slug: row.slug || null,
        legacy_workflow_status: row.workflow_status || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
      },
      blockers: blockers.map((entry) => ({
        key: entry.key,
        label: entry.label,
        count: Number(entry.count || 0) || 0,
      })),
      purge_mode: "hard",
    });
    db.prepare("DELETE FROM content_items WHERE id=?").run(Number(itemId || 0) || 0);
    db.exec("COMMIT");
    return row;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function buildPurgedDeletedItemResult(row, actorEmailValue, reasonText) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    item_uid: row.item_uid || null,
    type: row.type || null,
    category: row.category || null,
    title: row.title || null,
    slug: row.slug || null,
    legacy_workflow_status: row.workflow_status || null,
    purged: true,
    purged_at: new Date().toISOString(),
    purged_by: String(actorEmailValue || "").trim() || null,
    reason: String(reasonText || "").trim() || null,
  };
}

function formatItemBlockerSummary(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => `#${row.item_id} ${row.title || ""}: ${row.blockers.map((entry) => entry.label).join(", ")}`)
    .join(" | ");
}

function hardDeleteRawOnlyItemAndSweepAssets(itemId, actorEmailValue) {
  const result = repo.hardDeleteRawOnlyItem(itemId, actorEmailValue);
  const deletedAssetIds = Array.isArray(result?.deleted_asset_ids) ? result.deleted_asset_ids : [];
  let sweptAssets = 0;
  let sweptFiles = 0;
  const skippedAssets = [];
  for (const assetId of deletedAssetIds) {
    const cleanup = deleteAssetIfUnused(assetId);
    if (cleanup?.deleted_asset) sweptAssets += 1;
    if (cleanup?.deleted_file) sweptFiles += 1;
    if (!cleanup?.deleted_asset && Array.isArray(cleanup?.blocked_references) && cleanup.blocked_references.length > 0) {
      skippedAssets.push({
        asset_id: Number(assetId || 0) || 0,
        blocked_references: cleanup.blocked_references,
      });
    }
  }
  return {
    ...result,
    swept_assets: sweptAssets,
    swept_files: sweptFiles,
    skipped_assets: skippedAssets,
  };
}

function assertItemsCanBeDeleted(items = []) {
  const blockers = [];
  for (const item of Array.isArray(items) ? items : []) {
    const itemId = Number(item?.id || 0);
    if (!itemId) continue;
    const itemBlockers = getMergeBlockersForItem(itemId);
    if (itemBlockers.length) {
      blockers.push({
        item_id: itemId,
        title: item?.title || "",
        blockers: itemBlockers,
      });
    }
  }
  if (blockers.length) {
    throw new Error(`cannot delete items with dependency blockers: ${formatItemBlockerSummary(blockers)}`);
  }
}

function moveSimpleContentItemRows(tableName, masterId, sourceId) {
  return Number(
    db.prepare(`UPDATE ${tableName} SET content_item_id=? WHERE content_item_id=?`).run(masterId, sourceId)?.changes || 0
  );
}

function mergeSourceRecordsIntoMaster(masterId, sourceId, mergeItemIds) {
  const rows = repo.listSourceRecordsByItem(sourceId);
  let moved = 0;
  let skipped = 0;
  for (const row of rows) {
    const sourceUrl = String(row?.source_url || "").trim();
    if (sourceUrl) {
      const existing = db.prepare("SELECT id, content_item_id FROM source_records WHERE source_url=? LIMIT 1").get(sourceUrl);
      const existingItemId = Number(existing?.content_item_id || 0);
      if (existing && existingItemId !== sourceId) {
        if (existingItemId === masterId || mergeItemIds.has(existingItemId)) {
          skipped += 1;
          continue;
        }
        throw new Error(`?? source URL ???????????? #${existingItemId}: ${sourceUrl}`);
      }
    }

    moved += Number(
      db.prepare("UPDATE source_records SET content_item_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(masterId, Number(row.id || 0))
        ?.changes || 0
    );
  }
  return { moved, skipped };
}

function mergeContentAssetsIntoMaster(masterId, sourceId) {
  const rows = db
    .prepare("SELECT ca.*, a.storage_path FROM content_assets ca JOIN assets a ON a.id = ca.asset_id WHERE ca.content_item_id=? ORDER BY ca.sort_order ASC, ca.id ASC")
    .all(sourceId);
  let moved = 0;
  let merged = 0;
  let nextSort = Number(
    db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM content_assets WHERE content_item_id=?").get(masterId)?.max_sort || 0
  );
  let masterHasCover = Number(
    db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE content_item_id=? AND (is_cover=1 OR role='cover')").get(masterId)?.c || 0
  ) > 0;

  const masterRows = db
    .prepare("SELECT ca.*, a.storage_path FROM content_assets ca JOIN assets a ON a.id = ca.asset_id WHERE ca.content_item_id=? ORDER BY ca.sort_order ASC, ca.id ASC")
    .all(masterId);
  const masterByAssetId = new Map();
  const masterByMediaKey = new Map();
  for (const masterRow of masterRows) {
    masterByAssetId.set(Number(masterRow.asset_id || 0), masterRow);
    const mediaKey = toMediaDedupKey(masterRow.storage_path);
    if (mediaKey && !masterByMediaKey.has(mediaKey)) {
      masterByMediaKey.set(mediaKey, masterRow);
    }
  }

  for (const row of rows) {
    const assetId = Number(row.asset_id || 0);
    const mediaKey = toMediaDedupKey(row.storage_path);
    const existing = masterByAssetId.get(assetId) || (mediaKey ? masterByMediaKey.get(mediaKey) : null);

    if (existing) {
      const selectedInClean =
        Number(existing.selected_in_clean || 0) === 1 || Number(row.selected_in_clean || 0) === 1 ? 1 : 0;
      let role = String(existing.role || "unused");
      let placementType = String(existing.placement_type || "unused");
      let isCover = Number(existing.is_cover || 0) === 1 ? 1 : 0;

      if (role === "unused" && String(row.role || "unused") !== "unused") {
        role = String(row.role || "unused");
      }
      if (placementType === "unused" && String(row.placement_type || "unused") !== "unused") {
        placementType = String(row.placement_type || "unused");
      }
      if (!masterHasCover && (Number(row.is_cover || 0) === 1 || String(row.role || "") === "cover")) {
        role = "cover";
        placementType = "gallery";
        isCover = 1;
        masterHasCover = true;
      }

      db.prepare("UPDATE content_assets SET role=?, selected_in_clean=?, is_cover=?, placement_type=? WHERE id=?").run(
        role,
        selectedInClean,
        isCover,
        placementType,
        Number(existing.id || 0)
      );
      db.prepare("DELETE FROM content_assets WHERE id=?").run(Number(row.id || 0));
      deleteAssetIfUnused(assetId);
      merged += 1;
      continue;
    }

    nextSort += 1;
    let role = String(row.role || "unused");
    let placementType = String(row.placement_type || "unused");
    let isCover = Number(row.is_cover || 0) === 1 ? 1 : 0;
    const selectedInClean = Number(row.selected_in_clean || 0) === 1 ? 1 : 0;

    if ((isCover === 1 || role === "cover") && masterHasCover) {
      role = "gallery";
      isCover = 0;
      if (placementType === "unused") {
        placementType = "gallery";
      }
    } else if (isCover === 1 || role === "cover") {
      masterHasCover = true;
      role = "cover";
      placementType = "gallery";
    }

    moved += Number(
      db.prepare("UPDATE content_assets SET content_item_id=?, role=?, selected_in_clean=?, is_cover=?, placement_type=?, sort_order=? WHERE id=?").run(
        masterId,
        role,
        selectedInClean,
        isCover,
        placementType,
        nextSort,
        Number(row.id || 0)
      )?.changes || 0
    );

    const movedRow = {
      ...row,
      content_item_id: masterId,
      role,
      selected_in_clean: selectedInClean,
      is_cover: isCover,
      placement_type: placementType,
      sort_order: nextSort,
    };
    masterByAssetId.set(assetId, movedRow);
    if (mediaKey && !masterByMediaKey.has(mediaKey)) {
      masterByMediaKey.set(mediaKey, movedRow);
    }
  }

  return { moved, merged };
}

function mergeContentItems({ masterItemId, sourceItemIds, actorEmailValue }) {
  const masterId = Number(masterItemId || 0);
  const sourceIds = toUniquePositiveIds(sourceItemIds).filter((id) => id !== masterId);
  if (!masterId) {
    throw new Error("master_item_id is required");
  }
  if (!sourceIds.length) {
    throw new Error("source_item_ids must contain at least one item");
  }

  const master = repo.getItem(masterId);
  if (!master) {
    throw new Error("???????????????????????");
  }

  const sources = sourceIds.map((id) => repo.getItem(id));
  if (sources.some((item) => !item)) {
    throw new Error("?????????????????????????????????");
  }

  const blockers = [];
  for (const item of sources) {
    const itemId = Number(item?.id || 0);
    const itemBlockers = getMergeBlockersForItem(itemId);
    if (itemBlockers.length) {
      blockers.push({
        item_id: itemId,
        title: item?.title || "",
        blockers: itemBlockers,
      });
    }
  }
  if (blockers.length) {
    throw new Error(`??? merge ?????? ???????????????? dependency ?????: ${formatItemBlockerSummary(blockers)}`);
  }

  const mergeItemIds = new Set([masterId, ...sourceIds]);
  const counts = {
    source_records_moved: 0,
    source_records_skipped: 0,
    source_snapshots_added: 0,
    master_fields_filled: 0,
    reviews_raw_moved: 0,
    quality_checks_moved: 0,
    evidence_blocks_moved: 0,
    approved_context_blocks_moved: 0,
    draft_input_snapshots_moved: 0,
    search_enrichment_records_moved: 0,
    place_intelligence_scores_moved: 0,
    social_signal_sources_moved: 0,
    social_momentum_snapshots_moved: 0,
    content_direction_reports_moved: 0,
    content_assets_moved: 0,
    content_assets_merged: 0,
  };

  let txStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    txStarted = true;

    const mergedTags = mergeTextTags(master.tags, ...sources.map((item) => item?.tags || []));
    db.prepare("UPDATE content_items SET tags=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(mergedTags), masterId);

    for (const source of sources) {
      const sourceId = Number(source?.id || 0);
      const preserveStats = preserveSecondaryItemFacts(master, source);
      counts.source_snapshots_added += preserveStats.source_snapshot_added;
      counts.master_fields_filled += preserveStats.master_fields_filled;
      const sourceStats = mergeSourceRecordsIntoMaster(masterId, sourceId, mergeItemIds);
      counts.source_records_moved += sourceStats.moved;
      counts.source_records_skipped += sourceStats.skipped;
      counts.reviews_raw_moved += moveSimpleContentItemRows("reviews_raw", masterId, sourceId);
      counts.quality_checks_moved += moveSimpleContentItemRows("quality_checks", masterId, sourceId);
      counts.evidence_blocks_moved += moveSimpleContentItemRows("evidence_blocks", masterId, sourceId);
      counts.approved_context_blocks_moved += moveSimpleContentItemRows("approved_context_blocks", masterId, sourceId);
      counts.draft_input_snapshots_moved += moveSimpleContentItemRows("draft_input_snapshots", masterId, sourceId);
      counts.search_enrichment_records_moved += moveSimpleContentItemRows("search_enrichment_records", masterId, sourceId);
      counts.place_intelligence_scores_moved += moveSimpleContentItemRows("place_intelligence_scores", masterId, sourceId);
      counts.social_signal_sources_moved += moveSimpleContentItemRows("social_signal_sources", masterId, sourceId);
      counts.social_momentum_snapshots_moved += moveSimpleContentItemRows("social_momentum_snapshots", masterId, sourceId);
      counts.content_direction_reports_moved += moveSimpleContentItemRows("content_direction_reports", masterId, sourceId);

      const assetStats = mergeContentAssetsIntoMaster(masterId, sourceId);
      counts.content_assets_moved += assetStats.moved;
      counts.content_assets_merged += assetStats.merged;

      db.prepare("UPDATE content_items SET is_deleted=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(sourceId);
      repo.logAudit(actorEmailValue, "item.merge.into_master", "content_item", String(sourceId), {
        master_item_id: masterId,
      });
    }

    repo.logAudit(actorEmailValue, "item.bulk_merge", "content_item", String(masterId), {
      merged_item_ids: sourceIds,
      counts,
    });

    db.exec("COMMIT");
    txStarted = false;
    return {
      master_item_id: masterId,
      merged_count: sourceIds.length,
      counts,
    };
  } catch (err) {
    if (txStarted) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
    }
    throw err;
  }
}

function requireCollectorSecurityConfig() {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  const rawCors = String(process.env.CORS_ALLOWED_ORIGINS || "").trim();
  if (rawCors.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS must not contain wildcard '*'.");
  }

  const allowed = parseAllowedOrigins();
  if (env === "production" && !allowed.length) {
    throw new Error("CORS_ALLOWED_ORIGINS is required in production.");
  }

  const normalizedBackend = String(backendApiBase || "").trim();
  if (!normalizedBackend) {
    throw new Error(
      "Backend auth API base URL is required. Set COLLECTOR_SYNC_BACKEND_API (or BACKEND_API_BASE_URL/BACKEND_URL)."
    );
  }
  if (!/^https?:\/\//i.test(normalizedBackend)) {
    throw new Error("Backend auth API base URL must start with http:// or https://.");
  }
  if (!backendJwtSecret) {
    throw new Error("BACKEND_JWT_SECRET is required for collector backend-auth token verification.");
  }
  if (env === "production" && /^http:\/\//i.test(normalizedBackend) && !/localhost|127\.0\.0\.1/i.test(normalizedBackend)) {
    throw new Error("Backend auth API base URL must use HTTPS in production.");
  }
  if (hasConfiguredSyncToken() && /^http:\/\//i.test(normalizedBackend) && !/localhost|127\.0\.0\.1/i.test(normalizedBackend)) {
    throw new Error("COLLECTOR_SYNC_BACKEND_API must use HTTPS when LIFECYCLE_SYNC_TOKEN is set.");
  }
}

requireCollectorSecurityConfig();
assertCollectorIntegrationReadiness(
  collectorIntegrationConfig(),
  getCollectorRequiredIntegrationKeys(collectorIntegrationConfig())
);

function applyCollectorSecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.tiktok.com https://tiktok.com https://www.facebook.com https://facebook.com https://web.facebook.com",
    "media-src 'self' data: blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  res.setHeader("Content-Security-Policy", csp);
  if (String(process.env.NODE_ENV || "development") === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

function collectorCors(req, res, next) {
  const origin = normalizeOrigin(req.header("origin"));
  const allowed = parseAllowedOrigins();
  const forwardedHost = String(req.header("x-forwarded-host") || req.header("host") || "").trim();
  const forwardedProto = String(req.header("x-forwarded-proto") || req.protocol || "").split(",")[0].trim().toLowerCase();
  const requestOrigin = forwardedHost
    ? normalizeOrigin(`${forwardedProto === "https" ? "https" : "http"}://${forwardedHost}`)
    : "";
  const sameOrigin = origin && requestOrigin && origin === requestOrigin;

  if (!origin) {
    next();
    return;
  }

  const ok = sameOrigin || (allowed.length ? allowed.includes(origin) : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin));
  if (!ok) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send();
    return;
  }

  next();
}

function hasEvaluationOverrideInput(body = {}) {
  return hasRecognizedEvaluationOverrideInput(body);
}

const ASSIGNMENT_EVALUATE_ROUTE_CONFIG = Object.freeze({
  submission: Object.freeze({
    decisionKey: "submission_decision",
    readyFlagKey: "ready_for_handoff",
    compareReasonCodes: true,
    reasonCodesKey: "reason_codes",
    responsePayloadKey: "decision",
    auditAction: "assignment_submission.decision_evaluate",
    defaultReasonCode: "assignment_submission_decision_evaluated",
  }),
  governance: Object.freeze({
    decisionKey: "governance_decision",
    readyFlagKey: "ready_for_review",
    compareReasonCodes: true,
    reasonCodesKey: "reason_codes",
    responsePayloadKey: "summary",
    auditAction: "assignment_deliverables.governance_summary_evaluate",
    defaultReasonCode: "assignment_deliverables_governance_summary_evaluated",
  }),
  handoff: Object.freeze({
    decisionKey: "handoff_governance_decision",
    readyFlagKey: "ready_for_handoff_governance",
    compareReasonCodes: true,
    reasonCodesKey: "reason_codes",
    responsePayloadKey: "summary",
    auditAction: "assignment_handoff.governance_evaluate",
    defaultReasonCode: "assignment_handoff_governance_evaluated",
  }),
});

function normalizeSemanticText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeReasonCodeList(values) {
  // Comparator uses semantic set equality for reason_codes (order-insensitive, de-duplicated).
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const code = normalizeSemanticText(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.sort();
}

function computeLegacyTopLevelSemanticComparison({
  legacyTopLevel = null,
  authoritativeSummary = null,
  decisionKey = "",
  readyFlagKey = "",
  compareReasonCodes = false,
  reasonCodesKey = "reason_codes",
} = {}) {
  const mismatchFields = [];

  if (decisionKey) {
    const legacyDecisionValue = normalizeSemanticText(legacyTopLevel?.[decisionKey] ?? null);
    const authoritativeDecisionValue = normalizeSemanticText(authoritativeSummary?.[decisionKey] ?? null);
    if (legacyDecisionValue !== authoritativeDecisionValue) {
      mismatchFields.push(decisionKey);
    }
  }

  if (readyFlagKey) {
    const legacyReadyFlag = Boolean(legacyTopLevel?.[readyFlagKey]);
    const authoritativeReadyFlag = Boolean(authoritativeSummary?.[readyFlagKey]);
    if (legacyReadyFlag !== authoritativeReadyFlag) {
      mismatchFields.push(readyFlagKey);
    }
  }

  if (compareReasonCodes) {
    const legacyCodes = normalizeReasonCodeList(legacyTopLevel?.[reasonCodesKey]);
    const authoritativeCodes = normalizeReasonCodeList(authoritativeSummary?.[reasonCodesKey]);
    const sameLength = legacyCodes.length === authoritativeCodes.length;
    const sameValues = sameLength && legacyCodes.every((code, idx) => code === authoritativeCodes[idx]);
    if (!sameValues) {
      mismatchFields.push(reasonCodesKey);
    }
  }

  return {
    legacy_top_level_match_scope: compareReasonCodes ? "reason_semantic" : "final_semantic",
    legacy_top_level_matches_authoritative: mismatchFields.length === 0,
    legacy_top_level_mismatch_fields: mismatchFields,
  };
}

function buildEvaluateAuthoritativeContract(evaluation, routeConfig, { hasOverrideInput = false } = {}) {
  const decisionKey = String(routeConfig?.decisionKey || "").trim();
  const readyFlagKey = String(routeConfig?.readyFlagKey || "").trim();
  const reasonCodesKey = String(routeConfig?.reasonCodesKey || "reason_codes").trim() || "reason_codes";
  const compareReasonCodes = Boolean(routeConfig?.compareReasonCodes);
  const rawSummary = evaluation?.raw_summary ?? null;
  const effectiveSummary = evaluation?.effective_summary ?? null;
  const authoritativeSummaryMode = hasOverrideInput ? "effective" : "raw";
  const authoritativeSummary = authoritativeSummaryMode === "effective"
    ? (effectiveSummary ?? rawSummary)
    : (rawSummary ?? effectiveSummary);
  const legacyTopLevelMode = "compatibility";
  const legacySemanticComparison = computeLegacyTopLevelSemanticComparison({
    legacyTopLevel: evaluation,
    authoritativeSummary,
    decisionKey,
    readyFlagKey,
    compareReasonCodes,
    reasonCodesKey,
  });

  return {
    authoritative_summary_mode: authoritativeSummaryMode,
    authoritative_summary: authoritativeSummary,
    raw_summary: rawSummary,
    effective_summary: effectiveSummary,
    raw_effective_diverged: Boolean(evaluation?.raw_effective_diverged),
    legacy_top_level_mode: legacyTopLevelMode,
    legacy_top_level_match_scope: legacySemanticComparison.legacy_top_level_match_scope,
    legacy_top_level_matches_authoritative: legacySemanticComparison.legacy_top_level_matches_authoritative,
    legacy_top_level_mismatch_fields: legacySemanticComparison.legacy_top_level_mismatch_fields,
    raw_decision: decisionKey ? rawSummary?.[decisionKey] ?? null : null,
    effective_decision: decisionKey ? effectiveSummary?.[decisionKey] ?? null : null,
  };
}

function buildEvaluateResponseEnvelope({ assignmentId, evaluation, authoritative, responsePayloadKey = "summary" } = {}) {
  const payloadKey = String(responsePayloadKey || "summary").trim() || "summary";
  return {
    ok: true,
    assignment_id: assignmentId,
    [payloadKey]: evaluation,
    authoritative_summary_mode: authoritative.authoritative_summary_mode,
    authoritative_summary: authoritative.authoritative_summary,
    raw_summary: authoritative.raw_summary,
    effective_summary: authoritative.effective_summary,
    raw_effective_diverged: authoritative.raw_effective_diverged,
    legacy_top_level_mode: authoritative.legacy_top_level_mode,
    legacy_top_level_match_scope: authoritative.legacy_top_level_match_scope,
    legacy_top_level_matches_authoritative: authoritative.legacy_top_level_matches_authoritative,
    legacy_top_level_mismatch_fields: authoritative.legacy_top_level_mismatch_fields,
    debug_override_used: Boolean(evaluation?.debug_override_used),
    debug_override_keys: Array.isArray(evaluation?.debug_override_keys) ? evaluation.debug_override_keys : [],
    evaluated_debug_result: true,
    persisted_state_updated: false,
  };
}

function buildEvaluateAuditAdditions({ authoritative, hasOverrideInput = false } = {}) {
  return {
    authoritative_summary_mode: authoritative.authoritative_summary_mode,
    legacy_top_level_mode: authoritative.legacy_top_level_mode,
    legacy_top_level_match_scope: authoritative.legacy_top_level_match_scope,
    legacy_top_level_matches_authoritative: authoritative.legacy_top_level_matches_authoritative,
    legacy_top_level_mismatch_fields: authoritative.legacy_top_level_mismatch_fields,
    raw_effective_diverged: hasOverrideInput ? authoritative.raw_effective_diverged : undefined,
    effective_decision: hasOverrideInput ? authoritative.effective_decision : undefined,
    raw_decision: hasOverrideInput ? authoritative.raw_decision : undefined,
  };
}

function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 60, keyBy = "ip", message = "Too many requests" } = {}) {
  const store = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key =
      keyBy === "user" && req.authUser?.id
        ? `u:${req.authUser.id}`
        : `ip:${String(req.header("x-forwarded-for") || req.ip || "unknown").split(",")[0].trim()}`;

    for (const [k, v] of store.entries()) {
      if (v.resetAt <= now) store.delete(k);
    }

    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

function isAllowedImageUploadMime(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  return value === "image/jpeg"
    || value === "image/png"
    || value === "image/webp"
    || value === "image/gif";
}

function isAllowedAssignmentUploadMime(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  return isAllowedImageUploadMime(value)
    || value === "video/mp4"
    || value === "video/webm"
    || value === "video/quicktime";
}

function isSupportedImageSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === "image/gif") {
    const sig = buffer.subarray(0, 6).toString("ascii");
    return sig === "GIF87a" || sig === "GIF89a";
  }

  if (mimeType === "image/webp") {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    return riff === "RIFF" && webp === "WEBP";
  }

  return false;
}

function isSupportedVideoSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  if (mimeType === "video/webm") {
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }

  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    const boxType = buffer.subarray(4, 8).toString("ascii");
    const majorBrand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (boxType !== "ftyp") return false;
    if (mimeType === "video/quicktime") return majorBrand === "qt  ";
    return true;
  }

  return false;
}

function isSupportedMediaSignature(buffer, mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.startsWith("image/")) return isSupportedImageSignature(buffer, normalized);
  if (normalized.startsWith("video/")) return isSupportedVideoSignature(buffer, normalized);
  return false;
}

function hasAssignmentSubmissionAccess(req, assignment, role = actorPolicyRole(req)) {
  const actorId = getAuthUserId(req.authUser);
  if (!actorId) return false;
  if (role === "owner") return true;
  if (role === "admin") return canSeeAssignmentByManagementLine(req.authUser, assignment);
  const assignmentKind = String(assignment?.assignment_kind || "").trim().toLowerCase();
  const assigneeUserId = Number(assignment?.assignee_user_id || 0);
  if (assigneeUserId > 0) {
    if (assigneeUserId === actorId) {
      if (role === "editor") return assignmentKind === "editorial";
      return true;
    }
    return role === "user" && canSeeAssignmentByManagementLine(req.authUser, assignment);
  }
  const assignedByUserId = Number(assignment?.assigned_by_user_id || 0);
  return role === "user" && assignedByUserId > 0 && assignedByUserId === actorId;
}

function hasAssignmentDraftAccess(req, assignment) {
  const actorId = Number(req.authUser?.id || 0) || 0;
  const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
  if (!actorId || !assigneeUserId) return false;
  return actorId === assigneeUserId;
}

await fs.mkdir(dirs.rawDir, { recursive: true });
await fs.mkdir(dirs.stagingDir, { recursive: true });
await fs.mkdir(dirs.exportDir, { recursive: true });
await fs.mkdir(dirs.mediaDir, { recursive: true });
await fs.mkdir(path.join(dirs.mediaDir, "uploads"), { recursive: true });

app.set("trust proxy", 1);
app.use(applyCollectorSecurityHeaders);
app.use(collectorCors);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(createRateLimiter({ windowMs: 60 * 1000, max: 180, message: "Too many requests" }));
app.use("/media", express.static(dirs.mediaDir, { index: false }));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const fullPath = resolveCollectorHtmlFilePath(req.path || "");
  if (!fullPath || !fsSync.existsSync(fullPath)) return next();
  setCollectorHtmlRevalidateHeaders(res);
  res.type("html");
  if (req.method === "HEAD") return res.status(200).end();
  res.send(renderCollectorHtmlFile(fullPath));
});
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const fullPath = resolveCollectorJsFilePath(req.path || "");
  if (!fullPath || !fsSync.existsSync(fullPath)) return next();
  res.type("application/javascript; charset=utf-8");
  if (req.method === "HEAD") return res.status(200).end();
  const jsSource = fsSync.readFileSync(fullPath, "utf8");
  res.send(rewriteCollectorModuleSpecifiers(jsSource, fullPath));
});
app.use(express.static(collectorPublicDir, { index: false }));
app.get("/", (_req, res) => {
  setCollectorHtmlRevalidateHeaders(res);
  res.type("html");
  res.send(renderCollectorRootHtml());
});

app.get(
  GOOGLE_MAPS_PHOTO_PROXY_PATH,
  safeAsync(async (req, res) => {
    const name = String(req.query?.name || "").trim();
    if (!/^places\/[^/?#]+\/photos\/[^/?#]+$/i.test(name)) {
      res.status(400).json({ error: "Invalid Google photo name" });
      return;
    }

    const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
    if (!apiKey) {
      res.status(503).json({ error: "GOOGLE_MAPS_API_KEY is missing" });
      return;
    }

    const maxWidthPx = toPositiveIntWithinRange(req.query?.maxWidthPx, 1400, 1, 1600);
    const maxHeightPx = toPositiveIntWithinRange(req.query?.maxHeightPx, 1400, 1, 1600);
    const googleUrl = new URL(`https://places.googleapis.com/v1/${name}/media`);
    googleUrl.searchParams.set("maxWidthPx", String(maxWidthPx));
    googleUrl.searchParams.set("maxHeightPx", String(maxHeightPx));
    googleUrl.searchParams.set("key", apiKey);

    const upstream = await fetch(googleUrl, { method: "GET", redirect: "follow" });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "Unable to fetch Google photo" });
      return;
    }

    const contentType = String(upstream.headers.get("content-type") || "").trim();
    const cacheControl = String(upstream.headers.get("cache-control") || "").trim();
    const body = Buffer.from(await upstream.arrayBuffer());

    if (contentType) res.setHeader("Content-Type", contentType);
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);
    res.setHeader("Content-Length", String(body.length));
    res.send(body);
  })
);

const authIntegration = createCollectorAuthIntegration({
  db,
  jwt,
  backendApiBase,
  parseObjectJson,
  normalizeUserProfilePayload,
  mergeReservedUserProfileFields,
  backendJwtSecret,
  backendJwtIssuer,
  collectorBackendJwtAudience,
});
const {
  authenticateViaBackendLogin,
  syncCollectorUsersFromBackendDirectory,
  readCollectorDirectoryLastSyncedAt,
  verifyBackendTokenIdentity,
  requireAuth,
  requireRole,
  actorEmail,
} = authIntegration;

function safeAsync(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const ALLOWED_USER_ROLES = new Set(["owner", "admin", "editor", "user", "freelance"]);
const MANAGED_CONTRIBUTOR_ROLES = new Set(["freelance", "editor"]);
const ASSIGNMENT_KINDS = new Set(["field", "editorial"]);
const PRODUCTION_STATES = new Set([
  "collected",
  "analyzed",
  "brief_generated",
  "ready_for_content",
  "content_in_progress",
  "in_review",
  "needs_revision",
  "ready_for_publish",
  "submitted_for_admin_review",
  "rejected",
  "completed",
]);
const PUBLICATION_STATES = new Set(["draft", "approved", "published", "unpublished", "archived", "deleted"]);
const ASSIGNMENT_STATES = new Set(["assigned", "in_progress", "submitted", "revision_requested", "resubmitted", "accepted", "closed"]);
const ASSIGNMENT_SUBMISSION_STATES = new Set(["submitted", "resubmitted"]);
const ASSIGNMENT_DELIVERABLE_TYPES = new Set(["photos", "videos", "raw_notes", "caption_draft", "script_draft", "article_draft"]);
const EXECUTION_CHANNELS = new Set(["facebook", "tiktok"]);
const ASSIGNMENT_ACTION_TO_STATE = Object.freeze({
  request_revision: "revision_requested",
  accept_submission: "accepted",
  reopen_in_progress: "in_progress",
  close_assignment: "closed",
});
const ASSIGNMENT_REASON_CODE_DEFAULTS = Object.freeze({
  request_revision: "assignment_revision_requested",
  accept_submission: "assignment_submission_accepted",
  reopen_in_progress: "assignment_reopened_in_progress",
  close_assignment: "assignment_closed",
  submit: "assignment_submission_submitted",
  resubmit: "assignment_submission_resubmitted",
});
const ARTICLE_PROCESS_STATUSES = new Set(["drafting", "revision_requested", "ready_for_review", "ready_for_sync", "submitted_for_admin_review", "synced_to_admin"]);
const ARTICLE_PROCESS_TRANSITIONS = Object.freeze({
  drafting: new Set(["drafting", "ready_for_review"]),
  revision_requested: new Set(["drafting", "ready_for_review"]),
  ready_for_review: new Set(["revision_requested", "ready_for_sync"]),
  ready_for_sync: new Set(["revision_requested", "submitted_for_admin_review"]),
  submitted_for_admin_review: new Set(["revision_requested"]),
  synced_to_admin: new Set(["revision_requested", "submitted_for_admin_review"]),
});
const ASSIGNMENT_STATE_AUDIT_ACTIONS = Object.freeze({
  request_revision: "assignment.state.request_revision",
  accept_submission: "assignment.state.accept_submission",
  reopen_in_progress: "assignment.state.reopen_in_progress",
  close_assignment: "assignment.state.close_assignment",
});
const WORKFLOW_REASON_CODES = Object.freeze({
  ASSIGNMENT_CREATED_SYNC: "assignment_created_sync",
  ASSIGNMENT_CREATED_SYNC_MANUAL: "assignment_created_sync_manual",
  ASSIGNMENT_CREATED_SYNC_FROM_READINESS: "assignment_created_sync_from_readiness",
  ASSIGNMENT_CREATED_SYNC_FROM_FIELD_PACK: "assignment_created_sync_from_field_pack",
  READINESS_RECOMPUTED: "readiness_recomputed",
  EXECUTION_CONTROLS_DERIVED: "execution_controls_derived",
  EXECUTION_READINESS_EVALUATED: "execution_readiness_evaluated",
  HANDOFF_READINESS_EVALUATED: "handoff_readiness_evaluated",
});

function normalizeUserRole(value, fallback = "user") {
  const role = String(value || "").trim().toLowerCase();
  if (!role) return fallback;
  if (!ALLOWED_USER_ROLES.has(role)) return fallback;
  return role;
}

function isOwnerUser(user) {
  return String(user?.role || "").toLowerCase() === "owner";
}

function normalizePolicyRole(value, fallback = "user") {
  return normalizeUserRole(value, fallback);
}

function actorPolicyRole(req, fallback = "user") {
  return normalizePolicyRole(req?.authUser?.role, fallback);
}

function isAdminLikeUser(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "admin" || role === "owner";
}

function isManagedContributorByUser(managerUserId, contributorUserId) {
  const managerId = Number(managerUserId || 0);
  const workerId = Number(contributorUserId || 0);
  if (!managerId || !workerId) return false;
  const row = db
    .prepare("SELECT id FROM users WHERE id=? AND role IN ('freelance', 'editor') AND managed_by_user_id=? LIMIT 1")
    .get(workerId, managerId);
  return Boolean(row?.id);
}

function normalizeAssignmentKind(value, fallback = "field") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ASSIGNMENT_KINDS.has(normalized) ? normalized : fallback;
}

function validateAssignmentCreateFieldPackPrerequisites(assignmentKind, currentFieldPack) {
  const normalizedKind = normalizeAssignmentKind(assignmentKind, "field");
  if (normalizedKind !== "field") {
    return { ok: true, error: null };
  }
  if (!currentFieldPack || !Number(currentFieldPack?.id || 0)) {
    return {
      ok: false,
      error: 'item is not ready_for_assignment; brief is missing (complete step "จัด brief" first)',
    };
  }
  const fieldPackStatus = String(currentFieldPack?.status || "").trim().toLowerCase();
  if (fieldPackStatus !== "ready_for_field") {
    return {
      ok: false,
      error: 'item is not ready_for_assignment; complete step "พร้อมส่งเข้า handoff" (stored field pack status must be "ready_for_field")',
    };
  }
  return { ok: true, error: null };
}

function getAllowedAssigneeRolesForAssignmentKind(kind) {
  const normalized = normalizeAssignmentKind(kind, "");
  if (normalized === "field") return ["freelance", "user", "admin", "owner"];
  if (normalized === "editorial") return ["editor", "user", "admin", "owner"];
  return [];
}

function isInternalAssignmentRole(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "user" || normalizedRole === "admin" || normalizedRole === "owner";
}

function canAssignInternalWork(assignerRole, assignerId, assigneeRole, assigneeId) {
  const normalizedAssignerRole = String(assignerRole || "").trim().toLowerCase();
  const normalizedAssigneeRole = String(assigneeRole || "").trim().toLowerCase();
  const assignerUserId = Number(assignerId || 0) || 0;
  const assigneeUserId = Number(assigneeId || 0) || 0;
  if (!isInternalAssignmentRole(normalizedAssigneeRole) || !assignerUserId || !assigneeUserId) return true;
  if (assignerUserId === assigneeUserId) return true;
  if (normalizedAssignerRole === "user") return false;
  if (normalizedAssignerRole === "admin") return normalizedAssigneeRole === "user";
  if (normalizedAssignerRole === "owner") return normalizedAssigneeRole === "user" || normalizedAssigneeRole === "admin";
  return false;
}

function getFallbackAssignmentKindForAssigneeRole(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "freelance") return "field";
  if (normalizedRole === "editor") return "editorial";
  return "";
}

function canAssignUserToAssignmentKind(kind, assigneeRole) {
  const normalizedRole = String(assigneeRole || "").trim().toLowerCase();
  if (!normalizedRole) return false;
  return getAllowedAssigneeRolesForAssignmentKind(kind).includes(normalizedRole);
}

function getUserAssignmentRole(userId) {
  const id = Number(userId || 0) || 0;
  if (!id) return "";
  return String(db.prepare("SELECT role FROM users WHERE id=? LIMIT 1").get(id)?.role || "").trim().toLowerCase();
}

function getAuthUserId(authUser) {
  return Number(authUser?.id || 0) || 0;
}

function canAssignToUserByManagementLine(authUser, targetUserId) {
  const actorId = getAuthUserId(authUser);
  const targetId = Number(targetUserId || 0) || 0;
  const actorRole = normalizeUserRole(authUser?.role, "user");
  if (!actorId || !targetId) return false;
  if (isOwnerUser(authUser)) return true;
  if (!["admin", "user"].includes(actorRole)) return false;
  if (actorId === targetId) return false;
  return canSeeUserByManagementLine(authUser, targetId);
}

function canSeeUserByManagementLine(authUser, targetUserId) {
  const actorId = getAuthUserId(authUser);
  const targetId = Number(targetUserId || 0) || 0;
  const actorRole = normalizeUserRole(authUser?.role, "user");
  if (!actorId || !targetId) return false;
  if (isOwnerUser(authUser)) return true;
  if (actorId === targetId) return true;
  if (!["admin", "user"].includes(actorRole)) return false;

  let currentId = targetId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const row = db.prepare("SELECT id, managed_by_user_id FROM users WHERE id=? LIMIT 1").get(currentId);
    if (!row) return false;
    const managerId = Number(row?.managed_by_user_id || 0) || 0;
    if (!managerId) return false;
    if (managerId === actorId) return true;
    currentId = managerId;
  }
  return false;
}

function canSeeManagedWorkForUser(authUser, targetUserId, options) {
  const actorId = getAuthUserId(authUser);
  const targetId = Number(targetUserId || 0) || 0;
  const actorRole = normalizeUserRole(authUser?.role, "user");
  const allowSelf = options && options.allowSelf === true;
  if (!actorId || !targetId) return false;
  if (isOwnerUser(authUser)) return true;
  if (actorRole === "editor" || actorRole === "freelance") return allowSelf && actorId === targetId;
  if (allowSelf && actorId === targetId) return true;
  if (!["admin", "user"].includes(actorRole)) return false;
  return canAssignToUserByManagementLine(authUser, targetId);
}

function canSeeAssignmentByManagementLine(authUser, assignment) {
  if (!assignment || typeof assignment !== "object") return false;
  if (isOwnerUser(authUser)) return true;
  const actorId = getAuthUserId(authUser);
  if (!actorId) return false;
  const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
  const assignedByUserId = Number(assignment?.assigned_by_user_id || 0) || 0;

  if (assigneeUserId > 0) return canSeeManagedWorkForUser(authUser, assigneeUserId);
  if (!assignedByUserId) return false;
  return assignedByUserId === actorId;
}

function filterAssignmentsByManagementLine(authUser, assignments = []) {
  if (isOwnerUser(authUser)) return Array.isArray(assignments) ? assignments : [];
  return (Array.isArray(assignments) ? assignments : []).filter((assignment) => canSeeAssignmentByManagementLine(authUser, assignment));
}

function hasAssignmentAccess(req, assignment, role = actorPolicyRole(req)) {
  const assignmentKind = String(assignment?.assignment_kind || "").trim().toLowerCase();
  const assignmentAssigneeId = Number(assignment?.assignee_user_id || 0);
  const assignedByUserId = Number(assignment?.assigned_by_user_id || 0);
  const actorId = getAuthUserId(req.authUser);
  if (role === "owner") return true;
  if (!actorId) return false;
  if (role === "admin") return canSeeAssignmentByManagementLine(req.authUser, assignment);
  if (!assignmentAssigneeId) {
    return role === "user" && assignedByUserId === actorId;
  }
  if (assignmentAssigneeId === actorId) {
    if (role === "editor") return assignmentKind === "editorial";
    return true;
  }
  if (role === "user") return canSeeAssignmentByManagementLine(req.authUser, assignment);
  return false;
}

function parseIsoDateTimeOrEmpty(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function deriveAssignmentDraftExpiryIso(assignment) {
  const dueAtIso = parseIsoDateTimeOrEmpty(assignment?.due_at);
  if (dueAtIso) return dueAtIso;
  // Fallback for assignments without due_at: keep draft for 14 days.
  return new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString();
}

function resolveAssignmentCurrentRound(assignment) {
  return Math.max(1, (Number(assignment?.revision_round || 0) || 0) + 1);
}

function parseRequiredBooleanInput(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return Boolean(fallback);
}

function resolveRevisionMediaResetPayload(body = {}) {
  const imageResetRequired = parseRequiredBooleanInput(body?.image_reset_required, false);
  const videoResetRequired = parseRequiredBooleanInput(body?.video_reset_required, false);
  const imageResetReason = String(body?.image_reset_reason || "").trim() || null;
  const videoResetReason = String(body?.video_reset_reason || "").trim() || null;
  return {
    image_reset_required: imageResetRequired,
    image_reset_reason: imageResetReason,
    video_reset_required: videoResetRequired,
    video_reset_reason: videoResetReason,
  };
}

function normalizeAssignmentDraftAnswerRows(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      prompt: String(row?.prompt || "").trim(),
      answer: String(row?.answer || "").trim(),
    }))
    .filter((row) => row.prompt || row.answer);
}

function uniqueAssignmentPromptStrings(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function normalizeAssignmentCaptureMediaType(value) {
  const mediaType = String(value || "").trim().toLowerCase();
  if (mediaType === "image" || mediaType === "video") return mediaType;
  return "";
}

function buildAssignmentCaptureSlotKey(prompt, itemOrder, mediaType, captureType) {
  const base = String(prompt || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const normalized = base || `capture-${(Number(itemOrder || 0) || 0) + 1}`;
  const baseKey = `shot-${(Number(itemOrder || 0) || 0) + 1}-${normalized}`.slice(0, 48);
  const normalizedCaptureType = String(captureType || "").trim().toLowerCase();
  const normalizedMediaType = normalizeAssignmentCaptureMediaType(mediaType);
  if (normalizedCaptureType === "both" && normalizedMediaType) {
    return `${baseKey}--${normalizedMediaType}`;
  }
  return baseKey;
}

function getAssignmentBriefPromptGroups(brief = null) {
  const source = brief && typeof brief === "object" ? brief : {};
  const verifiedFacts = uniqueAssignmentPromptStrings(source?.evidence_summary?.verified_facts);
  const nextActions = uniqueAssignmentPromptStrings(source?.next_actions);
  const captureItems = uniqueAssignmentPromptStrings(source?.shot_list_suggestions);
  return {
    mustVerify: verifiedFacts.length ? verifiedFacts : nextActions,
    mustCapture: captureItems,
    mustAsk: nextActions,
  };
}

function getFieldPackPromptGroups(fieldPack = null) {
  const checklists = Array.isArray(fieldPack?.checklists) ? fieldPack.checklists : [];
  return {
    mustVerify: checklists
      .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_verify_fact")
      .map((row) => String(row?.item_text || "").trim())
      .filter(Boolean),
    mustCapture: checklists
      .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_capture")
      .map((row) => String(row?.item_text || "").trim())
      .filter(Boolean),
    mustAsk: checklists
      .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_ask_question")
      .map((row) => String(row?.item_text || "").trim())
      .filter(Boolean),
  };
}

function getStructuredFieldPackCaptureItems(fieldPack = null) {
  const checklists = Array.isArray(fieldPack?.checklists) ? fieldPack.checklists : [];
  const normalized = [];
  checklists
    .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_capture")
    .forEach((row, index) => {
      const prompt = String(row?.item_text || "").trim();
      if (!prompt) return;
      const captureType = ["photo", "video", "both"].includes(String(row?.capture_type || "").trim().toLowerCase())
        ? String(row.capture_type || "").trim().toLowerCase()
        : "photo";
      const itemOrder = Number.isFinite(Number(row?.item_order)) ? Number(row.item_order) : index;
      const displayIndex = itemOrder + 1;
      if (captureType === "both") {
        normalized.push({
          prompt,
          captureType,
          mediaType: "image",
          itemOrder,
          displayIndex,
          slotKey: buildAssignmentCaptureSlotKey(prompt, itemOrder, "image", captureType),
        });
        normalized.push({
          prompt,
          captureType,
          mediaType: "video",
          itemOrder,
          displayIndex,
          slotKey: buildAssignmentCaptureSlotKey(prompt, itemOrder, "video", captureType),
        });
        return;
      }
      const mediaType = captureType === "video" ? "video" : "image";
      normalized.push({
        prompt,
        captureType,
        mediaType,
        itemOrder,
        displayIndex,
        slotKey: buildAssignmentCaptureSlotKey(prompt, itemOrder, mediaType, captureType),
      });
    });
  return normalized;
}

function getEditorialPromptGroups(fieldPack = null, brief = null) {
  const summary = String(fieldPack?.editor_summary || fieldPack?.ai_summary || brief?.brief_summary || "").trim();
  const socialHook = String(fieldPack?.social_hook || brief?.recommended_hook || "").trim();
  const socialCaptionAngle = String(
    fieldPack?.social_caption_angle
    || (Array.isArray(brief?.caption_suggestions) ? brief.caption_suggestions[0] : "")
    || ""
  ).trim();
  const socialOnCameraPoints = Array.isArray(fieldPack?.social_on_camera_points_json)
    ? fieldPack.social_on_camera_points_json.map((value) => String(value || "").trim()).filter(Boolean)
    : uniqueAssignmentPromptStrings(brief?.script_suggestions);
  const fallbackGroups = getAssignmentBriefPromptGroups(brief);
  const { mustVerify, mustAsk } = fieldPack ? getFieldPackPromptGroups(fieldPack) : fallbackGroups;
  const directionPrompts = [
    summary ? `สรุปแกนเรื่องจากต้นทาง: ${summary}` : "",
    socialHook ? `Hook ที่ควรรักษา: ${socialHook}` : "",
    socialCaptionAngle ? `แนว Caption/Copy ที่ควรรักษา: ${socialCaptionAngle}` : "",
    ...socialOnCameraPoints.map((value) => `ประเด็นที่ต้องเล่า: ${value}`),
  ];
  const sourcePrompts = [
    ...mustVerify,
    ...mustAsk,
  ];
  const unique = (items) => uniqueAssignmentPromptStrings(items);
  return {
    directionPrompts: unique(directionPrompts).length ? unique(directionPrompts) : ["สรุปมุมเล่าและโทนของงานเรียบเรียงที่ต้องรักษา"],
    sourcePrompts: unique(sourcePrompts).length ? unique(sourcePrompts) : ["ระบุข้อมูลหรือข้อเท็จจริงที่ต้องอ้างอิงให้ครบก่อนเรียบเรียง"],
  };
}

function resolveAssignmentFieldPackFromBrief(assignment = null) {
  const brief = assignment?.brief_json && typeof assignment.brief_json === "object" ? assignment.brief_json : null;
  if (!brief) return null;
  const candidates = [
    brief.field_pack,
    brief.fieldPack,
    brief.current_field_pack,
    brief.currentFieldPack,
    brief.context_field_pack,
    brief.contextFieldPack,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return null;
}

function resolveAssignmentSubmissionPromptContext(assignment = null) {
  const brief = assignment?.brief_json && typeof assignment.brief_json === "object" ? assignment.brief_json : null;
  const contentItemId = Number(assignment?.content_item_id || 0) || 0;
  const currentFieldPack = contentItemId ? repo.getCurrentFieldPackByItem(contentItemId) : null;
  const embeddedFieldPack = resolveAssignmentFieldPackFromBrief(assignment);
  return {
    brief,
    fieldPack: currentFieldPack || embeddedFieldPack || null,
  };
}

function findMissingPromptAnswers(expectedPrompts = [], answerRows = []) {
  const expected = uniqueAssignmentPromptStrings(expectedPrompts);
  if (!expected.length) return [];
  const answerByPrompt = new Map();
  for (const row of Array.isArray(answerRows) ? answerRows : []) {
    const prompt = String(row?.prompt || "").trim();
    if (!prompt) continue;
    answerByPrompt.set(prompt, String(row?.answer || "").trim());
  }
  return expected.filter((prompt) => !String(answerByPrompt.get(prompt) || "").trim());
}

function getAssignmentCaptureAssetSlotTypeKey(asset) {
  const source = asset && typeof asset === "object" ? asset : {};
  const explicitSlotKey = String(source?.slotKey || source?.slot_key || source?.assignment_slot_key || "").trim().toLowerCase();
  const explicitMediaType = normalizeAssignmentCaptureMediaType(source?.mediaType || source?.media_type || source?.assignment_media_type);
  if (explicitSlotKey && explicitMediaType) return `${explicitSlotKey}|${explicitMediaType}`;
  const fileName = String(source?.file_name || "").trim();
  const shotSlug = parseCaptureShotSlugFromFileName(fileName);
  const mimeType = String(source?.mime_type || "").trim().toLowerCase();
  const mediaType = explicitMediaType || (mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : "");
  if (shotSlug && mediaType) return `${shotSlug}|${mediaType}`;
  return "";
}

function normalizeAssignmentMediaPayloadAssets(mediaPayload) {
  const source = mediaPayload && typeof mediaPayload === "object" ? mediaPayload : null;
  const assets = Array.isArray(source?.assets) ? source.assets : [];
  return assets.map((asset) => ({
    id: Number(asset?.id || 0) || null,
    file_name: String(asset?.file_name || "").trim() || null,
    mime_type: String(asset?.mime_type || "").trim().toLowerCase() || null,
    slotKey: String(asset?.slotKey || asset?.slot_key || asset?.assignment_slot_key || "").trim().toLowerCase() || null,
    mediaType: normalizeAssignmentCaptureMediaType(asset?.mediaType || asset?.media_type || asset?.assignment_media_type) || null,
    capture_type: String(asset?.capture_type || "").trim().toLowerCase() || null,
    prompt: String(asset?.prompt || "").trim() || null,
  })).filter((asset) => asset.id || asset.file_name || asset.slotKey);
}

function findMissingCapturePrompts(expectedPrompts = [], assignmentId = 0, currentRound = 1, options) {
  const config = options && typeof options === "object" ? options : {};
  const structuredItems = Array.isArray(config?.structuredItems) ? config.structuredItems : [];
  if (structuredItems.length) {
    const payloadAssets = normalizeAssignmentMediaPayloadAssets(config?.mediaPayload);
    const sourceAssets = payloadAssets.length
      ? payloadAssets
      : [
        ...(Array.isArray(repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "image")) ? repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "image") : []),
        ...(Array.isArray(repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "video")) ? repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "video") : []),
      ];
    const uploadedSlotTypeKeys = new Set();
    for (const asset of sourceAssets) {
      const slotTypeKey = getAssignmentCaptureAssetSlotTypeKey(asset);
      if (slotTypeKey) uploadedSlotTypeKeys.add(slotTypeKey);
    }
    return structuredItems
      .filter((item) => !uploadedSlotTypeKeys.has(`${String(item.slotKey || "").trim().toLowerCase()}|${item.mediaType}`))
      .map((item) => item.prompt);
  }

  const prompts = uniqueAssignmentPromptStrings(expectedPrompts);
  if (!prompts.length || !(Number(assignmentId || 0) > 0)) return [];
  const imageAssets = repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "image");
  const videoAssets = repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "video");
  const uploadedShotSlugs = new Set();
  for (const asset of [...(Array.isArray(imageAssets) ? imageAssets : []), ...(Array.isArray(videoAssets) ? videoAssets : [])]) {
    const shotSlug = parseCaptureShotSlugFromFileName(asset?.file_name);
    if (shotSlug) uploadedShotSlugs.add(shotSlug);
  }
  return prompts.filter((prompt, index) => !uploadedShotSlugs.has(toCaptureShotSlug(prompt, index)));
}

function enforceAssignmentSubmissionRequiredFields(assignment, articlePayload, assignmentId, currentRound, mediaPayload = null) {
  const payload = articlePayload && typeof articlePayload === "object" && !Array.isArray(articlePayload)
    ? articlePayload
    : {};
  const kind = String(assignment?.assignment_kind || "").trim().toLowerCase() === "editorial" ? "editorial" : "field";
  const { brief, fieldPack } = resolveAssignmentSubmissionPromptContext(assignment);
  const missing = [];

  if (kind === "editorial") {
    const groups = getEditorialPromptGroups(fieldPack, brief);
    missing.push(...findMissingPromptAnswers(groups.directionPrompts, payload.direction_answers).map((prompt) => `แนวสื่อสารหลัก: ${prompt}`));
    missing.push(...findMissingPromptAnswers(groups.sourcePrompts, payload.source_answers).map((prompt) => `ข้อมูล/มุมที่ต้องใช้: ${prompt}`));
  } else {
    const groups = fieldPack ? getFieldPackPromptGroups(fieldPack) : getAssignmentBriefPromptGroups(brief);
    const structuredCaptureItems = fieldPack ? getStructuredFieldPackCaptureItems(fieldPack) : [];
    missing.push(...findMissingPromptAnswers(groups.mustVerify, payload.verified_answers).map((prompt) => `สิ่งที่ต้องยืนยัน: ${prompt}`));
    missing.push(...findMissingPromptAnswers(groups.mustAsk, payload.question_answers).map((prompt) => `คำตอบจากหน้างาน: ${prompt}`));
    missing.push(...findMissingCapturePrompts(groups.mustCapture, assignmentId, currentRound, {
      structuredItems: structuredCaptureItems,
      mediaPayload,
    }).map((prompt) => `สิ่งที่ต้องถ่าย: ${prompt}`));
  }

  if (!String(payload.additional_text || "").trim()) {
    missing.push("ข้อความเพิ่มเติม");
  }
  if (missing.length) {
    const preview = missing.slice(0, 8).join(" | ");
    const remain = missing.length > 8 ? ` | และอีก ${missing.length - 8} รายการ` : "";
    throw new Error(`บล็อกการส่งงาน: ต้องกรอกข้อมูลให้ครบทุกช่องก่อนส่ง (${preview}${remain})`);
  }
}

function normalizeAssignmentDraftArticlePayload(rawPayload = null, assignment = null) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const kind = String(assignment?.assignment_kind || "").trim().toLowerCase() === "editorial"
    ? "editorial"
    : "field";
  if (kind === "editorial") {
    return {
      direction_answers: normalizeAssignmentDraftAnswerRows(rawPayload.direction_answers),
      source_answers: normalizeAssignmentDraftAnswerRows(rawPayload.source_answers),
      additional_text: String(rawPayload.additional_text || "").trim(),
    };
  }
  return {
    verified_answers: normalizeAssignmentDraftAnswerRows(rawPayload.verified_answers),
    question_answers: normalizeAssignmentDraftAnswerRows(rawPayload.question_answers),
    capture_answers: normalizeAssignmentDraftAnswerRows(rawPayload.capture_answers),
    additional_text: String(rawPayload.additional_text || "").trim(),
  };
}

function normalizeAssignmentShotPromptList(assignment = null) {
  const source = assignment?.brief_json && typeof assignment.brief_json === "object"
    ? assignment.brief_json
    : {};
  const raw = Array.isArray(source?.shot_list_suggestions) ? source.shot_list_suggestions : [];
  return Array.from(new Set(raw.map((value) => String(value || "").trim()).filter(Boolean)));
}

function toCaptureShotSlug(prompt, index) {
  const base = String(prompt || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const normalized = base || `capture-${index + 1}`;
  return `shot-${index + 1}-${normalized}`.slice(0, 48);
}

function parseCaptureShotSlugFromFileName(fileName) {
  const raw = String(fileName || "").trim();
  if (!raw) return "";
  const marker = raw.indexOf("__");
  if (marker <= 0) return "";
  const slug = raw.slice(0, marker).trim().toLowerCase();
  if (!slug.startsWith("shot-")) return "";
  return slug;
}

function enforceResetPerShotRequirements(assignment, assignmentId, currentRound) {
  const imageResetRequired = Number(assignment?.image_reset_required ? 1 : 0) === 1;
  const videoResetRequired = Number(assignment?.video_reset_required ? 1 : 0) === 1;
  if (!imageResetRequired && !videoResetRequired) return;
  const prompts = normalizeAssignmentShotPromptList(assignment);
  if (!prompts.length) {
    throw new Error("assignment reset requires shot_list_suggestions in brief_json");
  }
  const requiredShotSlugs = prompts.map((prompt, index) => ({
    slug: toCaptureShotSlug(prompt, index),
    label: `${index + 1}. ${String(prompt || "").trim()}`,
  }));
  const imageAssets = imageResetRequired
    ? repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "image")
    : [];
  const videoAssets = videoResetRequired
    ? repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "video")
    : [];
  const imageByShot = new Map();
  const videoByShot = new Map();
  for (const asset of Array.isArray(imageAssets) ? imageAssets : []) {
    const slug = parseCaptureShotSlugFromFileName(asset?.file_name);
    if (!slug) continue;
    imageByShot.set(slug, (imageByShot.get(slug) || 0) + 1);
  }
  for (const asset of Array.isArray(videoAssets) ? videoAssets : []) {
    const slug = parseCaptureShotSlugFromFileName(asset?.file_name);
    if (!slug) continue;
    const sizeBytes = Number(asset?.size_bytes || 0) || 0;
    if (sizeBytes > ASSIGNMENT_UPLOAD_MAX_BYTES) {
      throw new Error(`video reset is active: shot ${slug} contains file larger than 20GB`);
    }
    videoByShot.set(slug, (videoByShot.get(slug) || 0) + 1);
  }

  const errors = [];
  for (const shot of requiredShotSlugs) {
    if (imageResetRequired) {
      const imageCount = Number(imageByShot.get(shot.slug) || 0) || 0;
      if (imageCount < 1) errors.push(`image reset: missing image in shot "${shot.label}"`);
      if (imageCount > 5) errors.push(`image reset: too many images in shot "${shot.label}" (max 5)`);
    }
    if (videoResetRequired) {
      const videoCount = Number(videoByShot.get(shot.slug) || 0) || 0;
      if (videoCount < 1) errors.push(`video reset: missing video in shot "${shot.label}"`);
      if (videoCount > 2) errors.push(`video reset: too many videos in shot "${shot.label}" (max 2)`);
    }
  }
  if (errors.length) {
    throw new Error(errors.join(" | "));
  }
}

function listManagedScopeUserIds(actorUserId, role) {
  const actorId = Number(actorUserId || 0);
  if (!actorId) return [];
  if (role === "owner") return [actorId];
  if (role !== "admin" && role !== "user") return [];
  const directManagedIds = db
    .prepare("SELECT id FROM users WHERE managed_by_user_id=? ORDER BY id ASC")
    .all(actorId)
    .map((row) => Number(row?.id || 0) || 0)
    .filter(Boolean);
  if (role === "user") {
    return Array.from(new Set([actorId, ...directManagedIds]));
  }
  if (!directManagedIds.length) {
    return [actorId];
  }
  const placeholders = directManagedIds.map(() => "?").join(", ");
  const nestedManagedIds = db
    .prepare(`SELECT id FROM users WHERE managed_by_user_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...directManagedIds)
    .map((row) => Number(row?.id || 0) || 0)
    .filter(Boolean);
  return Array.from(new Set([actorId, ...directManagedIds, ...nestedManagedIds]));
}

function sortAssignmentsForList(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const aTime = Date.parse(String(a?.updated_at || a?.created_at || "").trim() || "") || 0;
    const bTime = Date.parse(String(b?.updated_at || b?.created_at || "").trim() || "") || 0;
    if (bTime !== aTime) return bTime - aTime;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function buildActionableAssignmentsForActor(actorUserId, limit = 50) {
  const actorId = Number(actorUserId || 0);
  if (!actorId) return [];
  const rows = [
    ...repo.listAssignmentsByAssignee(actorId, limit),
    ...repo.listExternalAssignmentsByAssigner(actorId, limit),
  ];
  const deduped = new Map();
  rows.forEach((row) => {
    const id = Number(row?.id || 0) || 0;
    if (id) deduped.set(id, row);
  });
  const actionableStates = new Set(["assigned", "in_progress", "revision_requested"]);
  return sortAssignmentsForList(
    Array.from(deduped.values()).filter((row) => actionableStates.has(String(row?.state || "").trim().toLowerCase()))
  ).slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function buildSubmittedAssignmentsForActor(actorUserId, limit = 50) {
  const actorId = Number(actorUserId || 0);
  if (!actorId) return [];
  const rows = repo.listAssignmentsByAssignee(actorId, limit);
  const deduped = new Map();
  rows.forEach((row) => {
    const id = Number(row?.id || 0) || 0;
    if (id) deduped.set(id, row);
  });
  const submittedStates = new Set(["submitted", "resubmitted"]);
  return sortAssignmentsForList(
    Array.from(deduped.values()).filter((row) => submittedStates.has(String(row?.state || "").trim().toLowerCase()))
  ).slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function buildReviewAssignmentsForActor(actorUserId, role, limit = 50, options = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const includeTracking = Boolean(options?.include_tracking);
  const reviewStates = role === "owner" && includeTracking
    ? new Set(["submitted", "resubmitted", "revision_requested", "accepted"])
    : new Set(["submitted", "resubmitted"]);
  if (role === "owner") {
    return sortAssignmentsForList(
      repo.listAssignments(safeLimit).filter((row) => reviewStates.has(String(row?.state || "").trim().toLowerCase()))
    ).slice(0, safeLimit);
  }
  if (role === "admin" || role === "user") {
    const authUser = { id: actorUserId, role };
    const scopeUserIds = listManagedScopeUserIds(actorUserId, role);
    if (!scopeUserIds.length) {
      return [];
    }
    const scopeSet = new Set(scopeUserIds.map((value) => Number(value || 0)).filter(Boolean));
    return sortAssignmentsForList(
      filterAssignmentsByManagementLine(
        authUser,
        repo
          .listAssignmentsByScopeUserIds(Array.from(scopeSet), safeLimit)
      )
        .filter((row) => reviewStates.has(String(row?.state || "").trim().toLowerCase()))
    ).slice(0, safeLimit);
  }
  const actorId = Number(actorUserId || 0);
  if (!actorId) return [];
  return sortAssignmentsForList(
    repo
      .listAssignmentsByAssignee(actorId, safeLimit)
      .filter((row) => reviewStates.has(String(row?.state || "").trim().toLowerCase()))
  ).slice(0, safeLimit);
}

function buildManagedAssignmentsForActor(actorUserId, role, limit = 50) {
  if (role === "owner") {
    return repo.listAssignments(limit);
  }
  if (role !== "admin" && role !== "user") {
    return [];
  }
  const scopeUserIds = listManagedScopeUserIds(actorUserId, role);
  if (!scopeUserIds.length) {
    return [];
  }
  const scopeSet = new Set(scopeUserIds.map((value) => Number(value || 0)).filter(Boolean));
  return sortAssignmentsForList(
    filterAssignmentsByManagementLine(
      { id: actorUserId, role },
      repo.listAssignmentsByScopeUserIds(Array.from(scopeSet), limit)
    )
  ).slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function hasItemBriefAccess(req, contentItemId, role = actorPolicyRole(req)) {
  const id = Number(contentItemId || 0);
  if (!id) return false;
  if (role === "owner") return true;
  const item = repo.getItem(id);
  if (!item) return false;
  const actorId = getAuthUserId(req.authUser);
  if (!actorId) return false;
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (claimedByUserId > 0 && canSeeManagedWorkForUser(req.authUser, claimedByUserId)) {
    return true;
  }
  const primaryAssignment = getPrimaryEditorialAssignment(id);
  if (primaryAssignment?.id && canSeeAssignmentByManagementLine(req.authUser, primaryAssignment)) {
    return true;
  }
  const assignments = repo.listAssignmentsByItem(id);
  return (Array.isArray(assignments) ? assignments : []).some((assignment) => hasAssignmentAccess(req, assignment, role));
}

function ensureItemBriefReadAccess(req, res, itemOrId, errorMessage = "forbidden") {
  const itemId = typeof itemOrId === "object"
    ? Number(itemOrId?.id || 0)
    : Number(itemOrId || 0);
  if (hasItemBriefAccess(req, itemId, actorPolicyRole(req))) {
    return true;
  }
  res.status(403).json({ error: errorMessage });
  return false;
}

function canClaimPrepItemRole(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin" || normalized === "user";
}

function canTakeOverPrepItemRole(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

function getPrepClaimRoleRank(role = "") {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "owner") return 3;
  if (normalized === "admin") return 2;
  if (normalized === "user") return 1;
  return 0;
}

function canTakeOverPrepClaim(actorRole = "", claimantRole = "") {
  return getPrepClaimRoleRank(actorRole) > getPrepClaimRoleRank(claimantRole);
}

function isClaimableRawPoolItem(item) {
  if (!item || typeof item !== "object") return false;
  // Deleted items are never claimable.
  if (Number(item.is_deleted || 0) === 1) return false;
  // Use item_work_scope_state when available (set by attachItemScopeMetadata before permission check).
  const scopeState = String(item.item_work_scope_state || "").trim().toLowerCase();
  if (scopeState) {
    return scopeState === "raw_pool";
  }
  // Fallback: fail closed - only allow truly raw/collected/draft states.
  // item_work_scope_state is not available here, so we inspect individual workflow fields.
  const publicationState = String(item.publication_state || "").trim().toLowerCase();
  const productionState = String(item.production_state || "").trim().toLowerCase();
  const workflowStatus = String(item.workflow_status || "").trim().toLowerCase();
  const allowedPublication = new Set(["", "draft", "raw"]);
  const allowedProduction = new Set(["", "collected", "raw"]);
  const allowedWorkflow = new Set(["", "raw"]);
  if (!allowedPublication.has(publicationState)) return false;
  if (!allowedProduction.has(productionState)) return false;
  if (!allowedWorkflow.has(workflowStatus)) return false;
  return true;
}

function canClaimItemByManagementLine(authUser, item) {
  if (!item || typeof item !== "object") return false;
  if (isOwnerUser(authUser)) return true;
  const actorRole = normalizeUserRole(authUser?.role, "user");
  if (actorRole !== "admin" && actorRole !== "user") return false;
  const itemId = Number(item?.id || 0) || 0;
  if (!itemId) return false;
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (claimedByUserId > 0) {
    return canSeeManagedWorkForUser(authUser, claimedByUserId);
  }
  const primaryAssignment = getPrimaryEditorialAssignment(itemId);
  if (primaryAssignment?.id) {
    return canSeeAssignmentByManagementLine(authUser, primaryAssignment);
  }
  const assignments = repo.listAssignmentsByItem(itemId);
  if (Array.isArray(assignments) && assignments.length) {
    return assignments.some((assignment) => canSeeAssignmentByManagementLine(authUser, assignment));
  }
  // Truly raw pool item: no claimant, no assignment, not deleted, not published/completed.
  // Internal staff (admin/user) can claim to create initial ownership/scope.
  return isClaimableRawPoolItem(item);
}

function canTakeOverItemByManagementLine(authUser, item) {
  if (!item || typeof item !== "object") return false;
  if (isOwnerUser(authUser)) return true;
  const actorRole = normalizeUserRole(authUser?.role, "user");
  if (actorRole !== "admin" && actorRole !== "user") return false;
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId) return false;
  return canSeeManagedWorkForUser(authUser, claimedByUserId);
}

function canMutateItemByManagementLine(authUser, item, options) {
  if (!item || typeof item !== "object") return false;
  if (isOwnerUser(authUser)) return true;
  const actorRole = normalizeUserRole(authUser?.role, "user");
  if (actorRole !== "admin" && actorRole !== "user") return false;
  const itemId = Number(item?.id || 0) || 0;
  if (!itemId) return false;
  const mutationOptions = options && typeof options === "object" ? options : {};
  const allowSelf = mutationOptions.allowSelf === true;
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (claimedByUserId > 0 && canSeeManagedWorkForUser(authUser, claimedByUserId, { allowSelf })) {
    return true;
  }
  const assignments = repo.listAssignmentsByItem(itemId);
  if (Array.isArray(assignments) && assignments.length) {
    return assignments.some((assignment) => {
      const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
      if (assigneeUserId > 0) {
        return canSeeManagedWorkForUser(authUser, assigneeUserId, { allowSelf });
      }
      return false;
    });
  }
  return false;
}

function listUsersByIds(ids = []) {
  const userIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((value) => Number(value || 0)).filter(Boolean)));
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => "?").join(", ");
  return db
    .prepare(`SELECT id, email, display_name, role FROM users WHERE id IN (${placeholders})`)
    .all(...userIds);
}

function buildItemWorkScopeState(item, assignment) {
  const publicationState = String(item?.publication_state || item?.workflow_status || "").trim().toLowerCase();
  const productionState = String(item?.production_state || "").trim().toLowerCase();
  if (publicationState === "published" || publicationState === "completed" || productionState === "completed" || productionState === "ready_for_publish") {
    return "published_or_completed";
  }
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
  const hasAssignment = assigneeUserId > 0 || Number(assignment?.assigned_by_user_id || 0) > 0 || String(assignment?.assignee_name || "").trim().length > 0;
  if (claimedByUserId > 0 && hasAssignment) return "claimed_and_assigned";
  if (assigneeUserId > 0 || hasAssignment) return "assigned";
  if (claimedByUserId > 0) return "claimed";
  return "raw_pool";
}

function canSeeRawPoolInItemsQueue(authUser) {
  if (isOwnerUser(authUser)) return true;
  const actorRole = normalizeUserRole(authUser?.role, "");
  return actorRole === "admin" || actorRole === "user";
}

function isItemVisibleToActor(authUser, item, assignment) {
  if (!item || typeof item !== "object") return false;
  if (isOwnerUser(authUser)) return true;
  const actorId = getAuthUserId(authUser);
  if (!actorId) return false;
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (claimedByUserId > 0) {
    return claimedByUserId === actorId || canSeeManagedWorkForUser(authUser, claimedByUserId);
  }
  const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
  if (assigneeUserId > 0) {
    return assigneeUserId === actorId || canSeeManagedWorkForUser(authUser, assigneeUserId);
  }
  const assignedByUserId = Number(assignment?.assigned_by_user_id || 0) || 0;
  if (assignedByUserId > 0 || String(assignment?.assignee_name || "").trim().length > 0) {
    return assignedByUserId > 0 && assignedByUserId === actorId;
  }
  return canSeeRawPoolInItemsQueue(authUser);
}

function buildViewerScopeReason(authUser, item, assignment) {
  if (isOwnerUser(authUser)) return "owner_global";
  const actorId = getAuthUserId(authUser);
  if (!actorId) return "out_of_scope";
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (claimedByUserId > 0) {
    if (claimedByUserId === actorId) return "claimed_by_me";
    if (canSeeManagedWorkForUser(authUser, claimedByUserId)) return "claimed_by_descendant";
    return "out_of_scope";
  }
  const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
  if (assigneeUserId > 0) {
    if (assigneeUserId === actorId) return "assigned_to_me";
    if (canSeeManagedWorkForUser(authUser, assigneeUserId)) return "assigned_to_descendant";
  }
  const assignedByUserId = Number(assignment?.assigned_by_user_id || 0) || 0;
  if (assignedByUserId > 0 && assignedByUserId === actorId && !assigneeUserId) {
    return "assigned_by_me_external";
  }
  if (assigneeUserId > 0 || assignedByUserId > 0) return "out_of_scope";

  if (canSeeRawPoolInItemsQueue(authUser)) {
    return "raw_pool_visible";
  }
  return "out_of_scope";
}

function buildItemCurrentHolder(item) {
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId) return null;
  const claimedBy = item?.claimed_by_user || null;
  return {
    claimed_by_user_id: claimedByUserId,
    claimed_by: claimedBy
      ? {
          id: Number(claimedBy.id || 0) || null,
          email: String(claimedBy.email || "").trim() || null,
          display_name: String(claimedBy.display_name || "").trim() || null,
          role: String(claimedBy.role || "").trim().toLowerCase() || null,
        }
      : null,
  };
}

function buildItemAssignmentOwner(assignment, userById = new Map()) {
  if (!assignment || typeof assignment !== "object") return null;
  const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
  const assignedByUserId = Number(assignment?.assigned_by_user_id || 0) || 0;
  const assigneeUser = assigneeUserId ? userById.get(assigneeUserId) || null : null;
  const assignedByUser = assignedByUserId ? userById.get(assignedByUserId) || null : null;
  return {
    assignee_user_id: assigneeUserId || null,
    assignee: assigneeUserId || String(assignment?.assignee_name || "").trim()
      ? {
          id: assigneeUserId || null,
          email: String(assignment?.assignee_email || assigneeUser?.email || "").trim().toLowerCase() || null,
          display_name: String(assignment?.assignee_display_name || assignment?.assignee_name || assigneeUser?.display_name || "").trim() || null,
          role: String(assigneeUser?.role || "").trim().toLowerCase() || null,
        }
      : null,
    assigned_by_user_id: assignedByUserId || null,
    assigned_by: assignedByUserId
      ? {
          id: assignedByUserId,
          email: String(assignment?.assigned_by_email || assignedByUser?.email || "").trim().toLowerCase() || null,
          display_name: String(assignment?.assigned_by_display_name || assignedByUser?.display_name || "").trim() || null,
          role: String(assignedByUser?.role || "").trim().toLowerCase() || null,
        }
      : null,
  };
}

function resolveItemScopeContext(item) {
  if (!item || typeof item !== "object") return item;
  const itemId = Number(item?.id || 0) || 0;
  const listAssignments = itemId && typeof repo?.listAssignmentsByItem === "function"
    ? (Array.isArray(repo.listAssignmentsByItem(itemId)) ? repo.listAssignmentsByItem(itemId) : [])
    : [];
  const primaryAssignment = itemId
    ? (typeof getPrimaryEditorialAssignment === "function" ? getPrimaryEditorialAssignment(itemId) : null) || listAssignments[0] || null
    : null;
  const assignmentUserIds = [
    Number(primaryAssignment?.assignee_user_id || 0) || 0,
    Number(primaryAssignment?.assigned_by_user_id || 0) || 0,
  ].filter(Boolean);
  return {
    primaryAssignment,
    assignmentUserIds,
  };
}

function attachItemScopeMetadata(authUser, item, scopeContext = null) {
  if (!item || typeof item !== "object") return item;
  const resolvedScope = scopeContext && typeof scopeContext === "object"
    ? scopeContext
    : resolveItemScopeContext(item);
  const primaryAssignment = resolvedScope?.primaryAssignment || null;
  const assignmentUserIds = [
    ...(Array.isArray(resolvedScope?.assignmentUserIds) ? resolvedScope.assignmentUserIds : []),
  ];
  const assignmentUsers = listUsersByIds(assignmentUserIds);
  const userById = new Map(assignmentUsers.map((row) => [Number(row?.id || 0), row]));
  return sanitizeItemForResponse({
    ...item,
    item_work_scope_state: buildItemWorkScopeState(item, primaryAssignment),
    viewer_scope_reason: buildViewerScopeReason(authUser, item, primaryAssignment),
    current_holder: buildItemCurrentHolder(item),
    assignment_owner: buildItemAssignmentOwner(primaryAssignment, userById),
  });
}

function attachItemClaimUsers(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const claimedIds = rows.map((item) => Number(item?.claimed_by_user_id || 0)).filter(Boolean);
  const users = listUsersByIds(claimedIds);
  const userById = new Map(users.map((row) => [Number(row?.id || 0), row]));
  return rows.map((item) => {
    const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
    const claimedByUser = claimedByUserId ? userById.get(claimedByUserId) || null : null;
    return sanitizeItemForResponse({
      ...item,
      claim_status: claimedByUserId ? "claimed" : "unclaimed",
      claimed_by_user: claimedByUser
        ? {
            id: Number(claimedByUser.id || 0) || null,
            email: String(claimedByUser.email || "").trim() || null,
            display_name: String(claimedByUser.display_name || "").trim() || null,
            role: String(claimedByUser.role || "").trim().toLowerCase() || null,
          }
        : null,
    });
  });
}

function attachSingleItemClaimUser(item) {
  return attachItemClaimUsers(item ? [item] : [])[0] || null;
}

function getPrepClaimHolderLabel(item) {
  const claimedBy = item?.claimed_by_user || null;
  if (claimedBy) {
    return String(claimedBy.display_name || claimedBy.email || `user #${Number(claimedBy.id || 0)}`).trim();
  }
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  return claimedByUserId ? `user #${claimedByUserId}` : "";
}

function ensurePrepItemEditAccess(req, res, item) {
  const role = actorPolicyRole(req);
  if (!canClaimPrepItemRole(role)) {
    res.status(403).json({ error: "role นี้ไม่ได้อยู่ในขั้นเตรียมข้อมูล" });
    return false;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  const decoratedItem = attachSingleItemClaimUser(item);
  const claimedByUserId = Number(decoratedItem?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId) {
    res.status(409).json({
      error: "ต้องรับงานนี้ก่อนจึงจะแก้รายการได้",
      item: decoratedItem,
    });
    return false;
  }
  if (claimedByUserId !== actorId) {
    const holderLabel = getPrepClaimHolderLabel(decoratedItem);
    res.status(409).json({
      error: holderLabel
        ? `รายการนี้ถูกรับงานโดย ${holderLabel} อยู่`
        : "รายการนี้มีผู้รับงานอยู่แล้ว",
      item: decoratedItem,
    });
    return false;
  }
  return true;
}

function hasPrepItemEditAccess(req, item) {
  const role = actorPolicyRole(req);
  if (!canClaimPrepItemRole(role)) {
    return false;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  return Boolean(actorId) && claimedByUserId > 0 && claimedByUserId === actorId;
}

function hasEditorialAssignmentEditAccess(req, item) {
  return hasEditorialAssignmentAccess(req, item, new Set(["assigned", "in_progress", "revision_requested"]));
}

function hasEditorialAssignmentAccess(req, item, allowedStates = new Set()) {
  const actorId = Number(req.authUser?.id || 0) || 0;
  const itemId = Number(item?.id || 0) || 0;
  if (!actorId || !itemId) return false;
  const assignments = repo.listAssignmentsByItem(itemId);
  return (Array.isArray(assignments) ? assignments : []).some((assignment) => {
    const assignmentKind = String(assignment?.assignment_kind || "").trim().toLowerCase();
    const assignmentState = String(assignment?.state || "").trim().toLowerCase();
    const assigneeUserId = Number(assignment?.assignee_user_id || 0) || 0;
    return assignmentKind === "editorial" && assigneeUserId === actorId && allowedStates.has(assignmentState);
  });
}

function ensureItemMutationAccess(req, res, item, options = {}) {
  const role = actorPolicyRole(req);
  if (role === "owner") {
    return true;
  }
  if ((role === "admin" || role === "user") && canMutateItemByManagementLine(req.authUser, item, options)) {
    return true;
  }
  if ((role === "editor" || role === "freelance") && options.allowAssignedSelf === true && hasEditorialAssignmentEditAccess(req, item)) {
    return true;
  }
  res.status(403).json({ error: "role นี้ไม่มีสิทธิ์แก้บทความในขั้นนี้" });
  return false;
}

function ensureArticleComposerEditAccess(req, res, item) {
  const role = actorPolicyRole(req);
  if (role === "owner") {
    return true;
  }
  if ((role === "admin" || role === "user") && canMutateItemByManagementLine(req.authUser, item)) {
    return true;
  }
  if (role === "editor" && hasEditorialAssignmentEditAccess(req, item)) {
    return true;
  }
  if (role === "editor") {
    res.status(403).json({ error: "editor ต้องมี editorial assignment ที่ยัง active จึงจะแก้บทความได้" });
    return false;
  }
  res.status(403).json({ error: "role นี้ไม่มีสิทธิ์แก้บทความในขั้นนี้" });
  return false;
}

function ensureArticleProcessTransitionAccess(req, res, item, nextStatus) {
  const role = actorPolicyRole(req);
  if (role === "owner") {
    return true;
  }
  if ((role === "admin" || role === "user") && canMutateItemByManagementLine(req.authUser, item)) {
    return true;
  }
  if (role !== "editor") {
    res.status(403).json({ error: "role นี้ไม่มีสิทธิ์เปลี่ยน article process ในขั้นนี้" });
    return false;
  }
  if (nextStatus === "ready_for_review") {
    const allowedStates = new Set(["submitted", "resubmitted"]);
    if (hasEditorialAssignmentAccess(req, item, allowedStates)) {
      return true;
    }
    res.status(403).json({ error: "editor ต้อง submit หรือ resubmit assignment ของตัวเองก่อนส่งบทความเข้าตรวจ" });
    return false;
  }
  return ensureArticleComposerEditAccess(req, res, item);
}

function transitionArticleProcessState(req, item, currentStatus, nextStatus, note, reasonCode) {
  const itemId = Number(item?.id || 0) || 0;
  if (!itemId) throw new Error("Invalid item id");
  const patch = mapArticleProcessStatusToWorkflowPatch(nextStatus);
  if (!patch) {
    throw new Error("article process patch is not supported for this status");
  }

  const primaryAssignment = getPrimaryEditorialAssignment(itemId);
  if (primaryAssignment?.id) {
    const assignmentState = String(primaryAssignment.state || "").trim().toLowerCase();
    if (nextStatus === "revision_requested" && assignmentState !== "revision_requested") {
      repo.updateAssignmentState(primaryAssignment.id, "revision_requested", actorEmail(req), {
        actor_role: actorPolicyRole(req),
        reason_code: `${reasonCode}_assignment`,
        internal_note: note || "returned from article process review",
      });
    }
    if (nextStatus === "drafting" && assignmentState === "revision_requested") {
      repo.updateAssignmentState(primaryAssignment.id, "in_progress", actorEmail(req), {
        actor_role: actorPolicyRole(req),
        reason_code: `${reasonCode}_assignment`,
        internal_note: note || "editor resumed article work",
      });
    }
  }

  if (nextStatus === "revision_requested") {
    const model = applyArticleNeedsRevisionWorkflowTransition(itemId, {
      actor: actorEmail(req),
      actorRole: actorPolicyRole(req),
      reasonCode,
      note,
    });
    repo.logAudit(actorEmail(req), "article_process.transition", "content_item", String(itemId), {
      from_status: currentStatus,
      to_status: nextStatus,
      production_state: model?.production_state || null,
      publication_state: model?.publication_state || null,
      reason_code: reasonCode,
    });
    return model;
  }

  const model = repo.upsertWorkflowModel(
    itemId,
    {
      ...patch,
      last_transition_note: note,
    },
    actorEmail(req),
    {
      actor_role: actorPolicyRole(req),
      reason_code: reasonCode,
    }
  );
  repo.logAudit(actorEmail(req), "article_process.transition", "content_item", String(itemId), {
    from_status: currentStatus,
    to_status: nextStatus,
    production_state: model?.production_state || null,
    publication_state: model?.publication_state || null,
    reason_code: reasonCode,
  });
  return model;
}

function applyArticleNeedsRevisionWorkflowTransition(contentItemId, options = {}) {
  const itemId = Number(contentItemId || 0) || 0;
  if (!itemId) throw new Error("Invalid item id");
  const actor = String(options.actor || "").trim() || "system@local";
  const actorRole = String(options.actorRole || "").trim().toLowerCase() || "system";
  const reasonCode = String(options.reasonCode || "").trim().toLowerCase() || "article_revision_requested";
  const note = String(options.note || "").trim() || null;
  const workflowBefore = repo.ensureWorkflowModel(itemId);

  return repo.upsertWorkflowModel(
    itemId,
    {
      production_state: "needs_revision",
      publication_state: "draft",
      last_transition_note: note,
    },
    actor,
    {
      actor_role: actorRole,
      reason_code: reasonCode,
    }
  );
}

async function finalizeArticleProcessReadyForSync(req, item, currentStatus, note, reasonCode) {
  const itemId = Number(item?.id || 0) || 0;
  if (!itemId) throw new Error("Invalid item id");
  const publishableSource = repo.buildPublishableSourceByItem(itemId);

  if (publishableSource?.ready_for_publish_source) {
    const workflowBefore = repo.ensureWorkflowModel(itemId);
    const model = repo.upsertWorkflowModel(
      itemId,
      {
        production_state: "ready_for_publish",
        publication_state: "approved",
        last_transition_note: note || "approved from article process ready_for_sync",
      },
      actorEmail(req),
      {
        actor_role: actorPolicyRole(req),
        reason_code: reasonCode,
        bump_state_version: true,
      }
    );
    repo.logAudit(actorEmail(req), "article_process.transition", "content_item", String(itemId), {
      from_status: currentStatus,
      to_status: "ready_for_sync",
      production_state: model?.production_state || null,
      publication_state: model?.publication_state || null,
      reason_code: reasonCode,
      publish_source_kind: publishableSource?.source?.source_kind || "assignment_submission_article_draft",
      assignment_id: publishableSource?.source?.assignment_id || null,
      submission_id: publishableSource?.source?.latest_submission_id || null,
      from_production_state: workflowBefore?.production_state || null,
      to_production_state: model?.production_state || null,
      from_publication_state: workflowBefore?.publication_state || null,
      to_publication_state: model?.publication_state || null,
    });
    return model;
  }

  const latestDraft = repo.latestDraftByItem(itemId);
  if (!latestDraft?.id) {
    throw new Error("latest draft is required before ready_for_sync");
  }

  const currentItem = repo.getItem(itemId) || item;
  const currentWorkflow = repo.ensureWorkflowModel(itemId);
  const latestReview = repo.latestReviewByItem(itemId);
  const latestApprovedReview = repo.latestApprovedReviewByItem(itemId);
  const alreadyApprovedForLatestDraft =
    Number(latestReview?.id || 0) > 0
    && Number(latestApprovedReview?.id || 0) === Number(latestReview?.id || 0)
    && Number(latestApprovedReview?.draft_id || 0) === Number(latestDraft.id || 0)
    && String(currentWorkflow?.production_state || "").trim().toLowerCase() === "ready_for_publish"
    && String(currentWorkflow?.publication_state || "").trim().toLowerCase() === "approved";

  let model = currentWorkflow;
  if (!alreadyApprovedForLatestDraft) {
    await runQualityStage(repo, actorEmail(req), { contentItemId: itemId });

    const reviewedItem = repo.getItem(itemId) || currentItem;
    const reviewedDraft = repo.latestDraftByItem(itemId) || latestDraft;
    const reviewedLatestReview = repo.latestReviewByItem(itemId);
    if (!reviewedLatestReview?.id) {
      throw new Error("review prerequisite missing: latest review report is required");
    }
    if (Number(reviewedLatestReview?.draft_id || 0) !== Number(reviewedDraft?.id || 0)) {
      throw new Error("stale review report: latest review is not for latest draft");
    }
    if (String(reviewedLatestReview?.status || "").trim().toLowerCase() === "needs_revision") {
      throw new Error("article process quality gate failed: latest draft needs revision");
    }

    const reviewedWorkflow = repo.getWorkflowModelByItem(itemId) || model;
    const hasApprovedReviewForLatestDraft =
      Number(repo.latestApprovedReviewByItem(itemId)?.id || 0) === Number(reviewedLatestReview.id || 0)
      && Number(repo.latestApprovedReviewByItem(itemId)?.draft_id || 0) === Number(reviewedDraft?.id || 0)
      && String(reviewedWorkflow?.production_state || "").trim().toLowerCase() === "ready_for_publish"
      && String(reviewedWorkflow?.publication_state || "").trim().toLowerCase() === "approved";

    if (!hasApprovedReviewForLatestDraft) {
      applyReviewAction(repo, actorEmail(req), {
        content_item_id: itemId,
        action: "approve",
        notes: note || "approved from article process ready_for_sync",
      });
    }

    model = repo.getWorkflowModelByItem(itemId) || model;
  }

  repo.logAudit(actorEmail(req), "article_process.transition", "content_item", String(itemId), {
    from_status: currentStatus,
    to_status: "ready_for_sync",
    production_state: model?.production_state || null,
    publication_state: model?.publication_state || null,
    reason_code: reasonCode,
  });
  return model;
}

function ensureComposerMediaEditAccess(req, res, item) {
  return ensureItemMutationAccess(req, res, item);
}

function normalizeArticleProcessStatus(value, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ARTICLE_PROCESS_STATUSES.has(normalized) ? normalized : fallback;
}

function canTransitionArticleProcess(currentStatus, nextStatus) {
  const current = normalizeArticleProcessStatus(currentStatus, "");
  const next = normalizeArticleProcessStatus(nextStatus, "");
  if (!next) return false;
  if (!current) return next === "drafting";
  if (current === next) return true;
  return ARTICLE_PROCESS_TRANSITIONS[current]?.has(next) === true;
}

function deriveArticleProcessStatus(item, workflowModel = null, publishableSource = null) {
  const productionState = String(workflowModel?.production_state || "").trim().toLowerCase();
  const publicationState = String(workflowModel?.publication_state || "").trim().toLowerCase();
  if (publicationState === "published") return "synced_to_admin";
  if (productionState === "submitted_for_admin_review") return "submitted_for_admin_review";
  if (publicationState === "approved" || productionState === "ready_for_publish") return "ready_for_sync";
  if (productionState === "needs_revision") return "revision_requested";
  if (productionState === "in_review" || publishableSource?.ready_for_publish_source) return "ready_for_review";
  if (
    productionState === "content_in_progress"
    || productionState === "ready_for_content"
    || productionState === "brief_generated"
    || productionState === "analyzed"
    || productionState === "collected"
  ) {
    return "drafting";
  }
  return "drafting";
}

function deriveQueuedArticleProcessStatus(item, workflowModel = null, workflowTransitions = [], baseStatus = "drafting") {
  return baseStatus;
}

function buildArticleProcessDraftPreview(item, workflowModel = null, publishableSource = null) {
  const itemId = Number(item?.id || 0) || 0;
  const latestDraft = repo.latestDraftByItem(itemId) || null;
  if (latestDraft?.id) return latestDraft;
  if (!publishableSource?.resolved_article) return null;

  const resolved = publishableSource.resolved_article;
  return {
    id: null,
    content_item_id: itemId,
    generation_run_uid: null,
    draft_title: String(resolved?.title || item?.title || "").trim() || null,
    excerpt: String(resolved?.excerpt || item?.summary || "").trim() || null,
    body: String(resolved?.body || item?.description_clean || item?.description_raw || "").trim() || null,
    meta_title: String(resolved?.meta_title || item?.meta_title || item?.title || "").trim() || null,
    meta_description: String(resolved?.meta_description || item?.meta_description || item?.summary || "").trim() || null,
    suggested_related: [],
    ai_quality_score: null,
    confirmed_cta_contact_json: {
      phone: null,
      line_url: null,
      facebook_url: null,
      website_url: null,
      primary_cta: null,
    },
    confirmed_taxonomy_json: {
      category: null,
      subtype: null,
      tags: [],
    },
    confirmed_meta_status: "not_started",
    confirmed_by_user_id: null,
    confirmed_at: null,
    confirmed_note: null,
    status: publishableSource?.ready_for_publish_source ? "generated" : "draft",
    created_at: null,
    updated_at: null,
    source_mode: publishableSource?.source?.source_kind || "assignment_submission_article_draft",
    assignment_id: publishableSource?.source?.assignment_id || null,
    submission_id: publishableSource?.source?.latest_submission_id || null,
  };
}

function mapArticleProcessStatusToWorkflowPatch(status) {
  const normalized = normalizeArticleProcessStatus(status, "");
  if (!normalized || normalized === "synced_to_admin") return null;
  if (normalized === "ready_for_sync") {
    return {
      production_state: "ready_for_publish",
      publication_state: "approved",
    };
  }
  if (normalized === "submitted_for_admin_review") {
    return {
      production_state: "submitted_for_admin_review",
      publication_state: "approved",
    };
  }
  if (normalized === "ready_for_review") {
    return {
      production_state: "in_review",
      publication_state: "draft",
    };
  }
  if (normalized === "revision_requested") {
    return {
      production_state: "needs_revision",
      publication_state: "draft",
    };
  }
  return {
    production_state: "content_in_progress",
    publication_state: "draft",
  };
}

function canManageArticleEditorialAssignments(req) {
  const role = actorPolicyRole(req);
  return role === "owner" || role === "admin" || role === "user";
}

function canReadArticleProcess(req, item) {
  const role = actorPolicyRole(req);
  if (role === "owner") return true;
  if (role === "admin" || role === "user") {
    return hasItemBriefAccess(req, Number(item?.id || 0) || 0, role);
  }
  if (role !== "editor") return false;
  return hasItemBriefAccess(req, Number(item?.id || 0) || 0, role);
}

function ensureArticleProcessReadAccess(req, res, item) {
  if (canReadArticleProcess(req, item)) return true;
  res.status(403).json({ error: "role นี้ไม่มีสิทธิ์ดู article process ของรายการนี้" });
  return false;
}

function canTransitionArticleProcessByRole(req, nextStatus) {
  const role = actorPolicyRole(req);
  const normalized = normalizeArticleProcessStatus(nextStatus, "");
  if (!normalized || normalized === "synced_to_admin") return false;
  if (role === "owner") return true;
  if (role === "admin") {
    return normalized === "drafting"
      || normalized === "revision_requested"
      || normalized === "ready_for_review"
      || normalized === "ready_for_sync";
  }
  if (role === "user") {
    return normalized === "drafting"
      || normalized === "revision_requested"
      || normalized === "ready_for_review";
  }
  if (role === "editor") {
    return normalized === "drafting" || normalized === "ready_for_review";
  }
  return false;
}

function listEditorialAssignmentsByItem(itemId) {
  const targetItemId = Number(itemId || 0) || 0;
  if (!targetItemId) return [];
  return repo
    .listAssignmentsByItem(targetItemId)
    .filter((assignment) => String(assignment?.assignment_kind || "").trim().toLowerCase() === "editorial");
}

function getPrimaryEditorialAssignment(itemId) {
  const activeStates = new Set(["assigned", "in_progress", "submitted", "resubmitted", "revision_requested"]);
  return listEditorialAssignmentsByItem(itemId).find((assignment) => activeStates.has(String(assignment?.state || "").trim().toLowerCase())) || null;
}

function buildArticleProcessPayload(req, item) {
  const isDebugDiagnosticsEnabled = String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
  const itemType = String(item?.type || "").trim().toLowerCase();
  const workflowModel = repo.ensureWorkflowModel(Number(item?.id || 0) || 0);
  const publishableSource = repo.buildPublishableSourceByItem(Number(item?.id || 0) || 0);
  const latestDraft = buildArticleProcessDraftPreview(item, workflowModel, publishableSource);
  const rawFieldReturnEvidence = itemType === "place"
    ? repo.buildFieldReturnEvidenceByItem(Number(item?.id || 0) || 0)
    : { version: 1, items: [] };
  const workflowTransitions = repo.listWorkflowTransitionsByItem(Number(item?.id || 0) || 0, 12);
  const baseArticleStatus = deriveArticleProcessStatus(item, workflowModel, publishableSource);
  const articleStatus = deriveQueuedArticleProcessStatus(item, workflowModel, workflowTransitions, baseArticleStatus);
  const editorialAssignments = listEditorialAssignmentsByItem(item?.id);
  const activeEditorialAssignment = getPrimaryEditorialAssignment(item?.id);
  const role = actorPolicyRole(req);
  const fieldReturnSubmitters = new Map(
    listUsersByIds(
      Array.isArray(rawFieldReturnEvidence?.items)
        ? rawFieldReturnEvidence.items.map((row) => Number(row?.submitted_by_user_id || 0)).filter(Boolean)
        : []
    ).map((row) => [Number(row?.id || 0), row])
  );
  const fieldReturnEvidence = {
    version: 1,
    items: Array.isArray(rawFieldReturnEvidence?.items)
      ? rawFieldReturnEvidence.items.map((row) => {
        const submitter = fieldReturnSubmitters.get(Number(row?.submitted_by_user_id || 0)) || null;
        const submittedBy = submitter
          ? String(submitter.display_name || submitter.email || `user #${Number(submitter.id || 0)}`).trim()
          : null;
        return {
          key: String(row?.key || "").trim(),
          group_key: String(row?.group_key || "").trim() || "other",
          check_key: String(row?.check_key || "").trim() || String(row?.key || "").trim(),
          label: String(row?.label || "").trim() || String(row?.check_key || row?.key || "").trim(),
          checked: row?.checked === true,
          found: row?.found === true,
          value: row?.value ?? null,
          condition_note: row?.condition_note ?? null,
          evidence: row?.evidence ?? null,
          note: row?.note ?? null,
          submitted_at: row?.submitted_at || null,
          submitted_by: submittedBy,
          assignment_id: Number(row?.assignment_id || 0) || null,
        };
      })
      : [],
  };
  return {
    item_id: Number(item?.id || 0) || 0,
    status: articleStatus,
    workflow_model: workflowModel,
    latest_draft: latestDraft,
    field_return_evidence: fieldReturnEvidence,
    publishable_source: publishableSource?.source || null,
    publishable_source_ready: Boolean(publishableSource?.ready_for_publish_source),
    publishable_source_issues: Array.isArray(publishableSource?.issues) ? publishableSource.issues : [],
    publishable_source_debug: isDebugDiagnosticsEnabled ? (publishableSource?.debug || null) : undefined,
    editorial_assignments: editorialAssignments,
    active_editorial_assignment: activeEditorialAssignment,
    workflow_transitions: workflowTransitions,
    permissions: {
      can_read: canReadArticleProcess(req, item),
      can_edit: role === "owner" || role === "admin" || role === "user" || hasEditorialAssignmentEditAccess(req, item),
      can_assign_editor: canManageArticleEditorialAssignments(req),
      can_request_revision: role === "owner" || role === "admin" || role === "user",
      can_submit_for_review: role === "owner" || role === "admin" || role === "user" || role === "editor",
      can_approve: role === "owner" || role === "admin",
      can_sync: role === "owner" || role === "admin",
    },
    allowed_transitions: Array.from(ARTICLE_PROCESS_STATUSES)
      .filter((nextStatus) => nextStatus !== "synced_to_admin" && nextStatus !== "submitted_for_admin_review")
      .filter((nextStatus) => canTransitionArticleProcess(articleStatus, nextStatus))
      .filter((nextStatus) => canTransitionArticleProcessByRole(req, nextStatus)),
  };
}

function parseObjectJson(value) {
  if (value == null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeUserProfilePayload(value, { allowPic = true } = {}) {
  const source = parseObjectJson(value);
  const picAssetId = Number(source.pic_asset_id || 0) || 0;
  return {
    display_name: String(source.display_name || "").trim(),
    phone: String(source.phone || "").trim(),
    email_alt: String(source.email_alt || "").trim().toLowerCase(),
    line_id: String(source.line_id || "").trim(),
    pic_asset_id: allowPic && picAssetId > 0 ? picAssetId : null,
  };
}

function mergeReservedUserProfileFields(source, profile = {}) {
  const raw = parseObjectJson(source);
  const next = { ...(profile || {}) };
  const authSync = parseObjectJson(raw._auth_sync);
  if (Object.keys(authSync).length > 0) {
    next._auth_sync = authSync;
  }
  return next;
}

function normalizeExternalAssigneeProfilePayload(value, fallbackName = "", fallbackContact = "") {
  const source = parseObjectJson(value);
  const profile = {
    name: String(source.name || fallbackName || "").trim(),
    phone: String(source.phone || "").trim(),
    email: String(source.email || "").trim().toLowerCase(),
    line_id: String(source.line_id || "").trim(),
  };
  if (!profile.name) return null;
  if (!profile.phone && !profile.email && !profile.line_id) {
    const fallback = String(fallbackContact || "").trim();
    if (fallback) {
      if (fallback.startsWith("@")) profile.line_id = fallback;
      else if (fallback.includes("@")) profile.email = fallback.toLowerCase();
      else profile.phone = fallback;
    }
  }
  return profile;
}

function hasOwnField(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function resolveUserAvatarUrl(profile) {
  const picAssetId = Number(profile?.pic_asset_id || 0) || 0;
  if (!picAssetId) return "";
  const asset = db.prepare("SELECT storage_path FROM assets WHERE id=? LIMIT 1").get(picAssetId);
  return parseAssetPathForUrl(asset?.storage_path || "");
}

function buildUserAvatarUrlMap(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const picAssetIds = Array.from(new Set(
    list
      .map((row) => Number(normalizeUserProfilePayload(row?.profile_json, { allowPic: true })?.pic_asset_id || 0) || 0)
      .filter(Boolean)
  ));
  if (!picAssetIds.length) {
    return new Map();
  }
  const placeholders = picAssetIds.map(() => "?").join(", ");
  const assets = db
    .prepare(`SELECT id, storage_path FROM assets WHERE id IN (${placeholders})`)
    .all(...picAssetIds);
  return new Map(
    assets.map((row) => [Number(row?.id || 0) || 0, parseAssetPathForUrl(row?.storage_path || "")])
  );
}

function stripUserSecret(row, avatarUrlByAssetId = null) {
  if (!row) return null;
  const profile = normalizeUserProfilePayload(row.profile_json, { allowPic: true });
  const displayName = String(row.display_name || "").trim() || profile.display_name || row.email;
  const picAssetId = Number(profile?.pic_asset_id || 0) || 0;
  profile.display_name = profile.display_name || displayName;
  return {
    id: row.id,
    email: row.email,
    display_name: displayName,
    profile_json: profile,
    avatar_url: avatarUrlByAssetId instanceof Map
      ? String(avatarUrlByAssetId.get(picAssetId) || "").trim()
      : resolveUserAvatarUrl(profile),
    managed_by_user_id: row.managed_by_user_id ?? null,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function extractProjectedBackendUserId(profileJson) {
  const profile = parseObjectJson(profileJson);
  const authSync = parseObjectJson(profile?._auth_sync);
  return Number(authSync?.user_id || 0) || 0;
}

function readUserAuthSyncProjection(profileJson) {
  const profile = parseObjectJson(profileJson);
  const authSync = parseObjectJson(profile?._auth_sync);
  return {
    provider: String(authSync?.provider || "").trim().toLowerCase() || null,
    backend_user_id: Number(authSync?.user_id || 0) || null,
    email: String(authSync?.email || "").trim().toLowerCase() || null,
    manager_backend_user_id: Number(authSync?.manager_backend_user_id || 0) || null,
    synced_at: String(authSync?.synced_at || "").trim() || null,
  };
}

function isActiveDirectoryUserProjection(row) {
  const profile = parseObjectJson(row?.profile_json);
  const authSync = parseObjectJson(profile?._auth_sync);
  const isBackendProjection = String(authSync?.provider || "").trim().toLowerCase() === "backend"
    && Number(authSync?.user_id || 0) > 0;
  if (!isBackendProjection) return true;
  return authSync?.directory_active === true;
}

function isPlaceholderUserEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return !email || email.endsWith("@example.com") || email.includes("your-admin-email");
}

function listLocalUsersByProjectedBackendUserId(backendUserId) {
  const targetBackendUserId = Number(backendUserId || 0) || 0;
  if (!targetBackendUserId) return [];
  const candidates = db
    .prepare("SELECT id, email, display_name, role, managed_by_user_id, profile_json FROM users WHERE profile_json IS NOT NULL")
    .all();
  const matches = [];
  for (const row of candidates) {
    if (!isActiveDirectoryUserProjection(row)) continue;
    if (extractProjectedBackendUserId(row?.profile_json) === targetBackendUserId) {
      matches.push({
        id: Number(row?.id || 0) || null,
        email: String(row?.email || "").trim().toLowerCase() || null,
        display_name: String(row?.display_name || "").trim() || null,
        role: String(row?.role || "").trim().toLowerCase() || null,
        managed_by_user_id: Number(row?.managed_by_user_id || 0) || null,
      });
    }
  }
  return matches.sort((left, right) => {
    const leftPlaceholder = isPlaceholderUserEmail(left?.email);
    const rightPlaceholder = isPlaceholderUserEmail(right?.email);
    if (leftPlaceholder !== rightPlaceholder) return leftPlaceholder ? 1 : -1;
    return Number(left?.id || 0) - Number(right?.id || 0);
  });
}

function findLocalUserByProjectedBackendUserId(backendUserId) {
  return listLocalUsersByProjectedBackendUserId(backendUserId)[0] || null;
}

function readCollectorRuntimeDiagnosticSnapshot() {
  const dbPath = String(dirs?.dbPath || "").trim();
  let dbRealPath = dbPath;
  let dbExists = false;
  let dbSizeBytes = null;
  let dbUpdatedAt = null;

  if (dbPath) {
    try {
      dbExists = fsSync.existsSync(dbPath);
    } catch {
      dbExists = false;
    }
  }

  if (dbExists) {
    try {
      dbRealPath = fsSync.realpathSync(dbPath);
    } catch {
      dbRealPath = dbPath;
    }
    try {
      const stat = fsSync.statSync(dbPath);
      dbSizeBytes = Number(stat?.size || 0) || 0;
      dbUpdatedAt = stat?.mtime ? new Date(stat.mtime).toISOString() : null;
    } catch {
      dbSizeBytes = null;
      dbUpdatedAt = null;
    }
  }

  const startedAtMs = Date.now() - Math.floor((Number(process.uptime() || 0) || 0) * 1000);

  return {
    service: "collector-app",
    pid: Number(process.pid || 0) || null,
    node_version: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    started_at: new Date(startedAtMs).toISOString(),
    uptime_seconds: Number((Number(process.uptime() || 0) || 0).toFixed(3)),
    bind_host: bindHost,
    port,
    backend_api_base: backendApiBase,
    paths: {
      root_dir: dirs.rootDir,
      raw_dir: dirs.rawDir,
      staging_dir: dirs.stagingDir,
      export_dir: dirs.exportDir,
      media_dir: dirs.mediaDir,
      schema_path: schemaPath,
    },
    db: {
      path: dbPath,
      real_path: dbRealPath,
      exists: dbExists,
      size_bytes: dbSizeBytes,
      updated_at: dbUpdatedAt,
      db_path_env: String(process.env.DB_PATH || "").trim() || null,
    },
  };
}

function normalizeAssignmentHealthRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    content_item_id: Number(row.content_item_id || 0) || null,
    assignment_kind: String(row.assignment_kind || "").trim().toLowerCase() || null,
    assignee_user_id: row.assignee_user_id == null ? null : Number(row.assignee_user_id || 0) || null,
    assignee_name: row.assignee_name == null ? null : String(row.assignee_name || "").trim() || null,
    assignee_contact: row.assignee_contact == null ? null : String(row.assignee_contact || "").trim() || null,
    assignee_email: row.assignee_email == null ? null : String(row.assignee_email || "").trim().toLowerCase() || null,
    assigned_by_user_id: row.assigned_by_user_id == null ? null : Number(row.assigned_by_user_id || 0) || null,
    assigned_by_email: row.assigned_by_email == null ? null : String(row.assigned_by_email || "").trim().toLowerCase() || null,
    state: String(row.state || "").trim().toLowerCase() || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function listAssignmentRowsByAssigneeUserId(assigneeUserId, limit = 20) {
  const targetUserId = Number(assigneeUserId || 0) || 0;
  if (!targetUserId) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 20) || 20));
  const rows = db.prepare(`
    SELECT
      a.id,
      a.content_item_id,
      a.assignment_kind,
      a.assignee_user_id,
      a.assignee_name,
      a.assignee_contact,
      a.assigned_by_user_id,
      a.state,
      a.created_at,
      a.updated_at,
      u.email AS assignee_email,
      assigner.email AS assigned_by_email
    FROM content_assignments a
    LEFT JOIN users u ON u.id = a.assignee_user_id
    LEFT JOIN users assigner ON assigner.id = a.assigned_by_user_id
    WHERE a.assignee_user_id=?
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?
  `).all(targetUserId, safeLimit);
  return rows.map(normalizeAssignmentHealthRow).filter(Boolean);
}

function listAssignmentRowsByExternalContact(targetEmail, limit = 20) {
  const email = String(targetEmail || "").trim().toLowerCase();
  if (!email) return [];
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 20) || 20));
  const rows = db.prepare(`
    SELECT
      a.id,
      a.content_item_id,
      a.assignment_kind,
      a.assignee_user_id,
      a.assignee_name,
      a.assignee_contact,
      a.assigned_by_user_id,
      a.state,
      a.created_at,
      a.updated_at,
      u.email AS assignee_email,
      assigner.email AS assigned_by_email
    FROM content_assignments a
    LEFT JOIN users u ON u.id = a.assignee_user_id
    LEFT JOIN users assigner ON assigner.id = a.assigned_by_user_id
    WHERE a.assignee_user_id IS NULL
      AND lower(coalesce(a.assignee_contact, '')) = lower(?)
    ORDER BY a.updated_at DESC, a.id DESC
    LIMIT ?
  `).all(email, safeLimit);
  return rows.map(normalizeAssignmentHealthRow).filter(Boolean);
}

function toBackendSafeSlug(rawValue, fallbackKey = "item") {
  const isWeakSlug = (value) => {
    const text = String(value || "").trim();
    return !text || text.length < 3 || /^\d+$/.test(text);
  };
  const raw = String(rawValue || "").trim().toLowerCase();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) && !isWeakSlug(raw)) {
    return raw;
  }
  const normalized = raw
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) && !isWeakSlug(normalized)) {
    return normalized;
  }
  const fallback = String(fallbackKey || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return fallback || "item";
}

function normalizeCollectorSlug(rawValue, fallbackKey = "item") {
  return toBackendSafeSlug(rawValue, fallbackKey);
}

function resolveCollectorPublicBaseUrl() {
  const explicit = String(process.env.COLLECTOR_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;
  const host = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
  return `http://${host}:${port}`;
}

function resolveCollectorRequestBaseUrl(req) {
  const forwardedHost = String(req?.header?.("x-forwarded-host") || req?.header?.("host") || "").trim();
  const forwardedProto = String(req?.header?.("x-forwarded-proto") || req?.protocol || "").split(",")[0].trim().toLowerCase();
  if (!forwardedHost) return "";
  return `${forwardedProto === "https" ? "https" : "http"}://${forwardedHost}`.replace(/\/+$/, "");
}

function hasExplicitCollectorPublicBaseUrl() {
  const explicit = String(process.env.COLLECTOR_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  return Boolean(explicit && /^https?:\/\//i.test(explicit));
}

function rewriteMediaManifestForBase(mediaManifest, baseUrl) {
  const rewriteEntry = (entry, fallbackRole = "gallery") => {
    if (!entry || typeof entry !== "object") return null;
    const normalizedUrl = absolutizeCollectorMediaUrl(entry.source_url || entry.url || "", baseUrl);
    if (!normalizedUrl) return null;
    return {
      ...entry,
      source_url: normalizedUrl,
      url: normalizedUrl,
      role: String(entry.role || fallbackRole).trim().toLowerCase() || fallbackRole,
      selected: entry.selected !== false,
    };
  };

  const cover = rewriteEntry(mediaManifest?.cover, "cover");
  const gallery = (Array.isArray(mediaManifest?.gallery) ? mediaManifest.gallery : [])
    .map((entry) => rewriteEntry(entry, "gallery"))
    .filter(Boolean);
  const inline = (Array.isArray(mediaManifest?.inline) ? mediaManifest.inline : [])
    .map((entry) => rewriteEntry(entry, "inline"))
    .filter(Boolean);

  return {
    ...mediaManifest,
    cover,
    gallery,
    inline,
  };
}

function normalizeSelectedAssetRole(asset) {
  const role = String(asset?.role || "").trim().toLowerCase();
  const placement = String(asset?.placement_type || "").trim().toLowerCase();
  const isCover = Number(asset?.is_cover || 0) === 1 || role === "cover";
  if (isCover) return "cover";
  if (role === "inline" || placement === "inline") return "inline";
  return "gallery";
}

function buildAdminReviewClientMediaUid(contentItemId, asset, role, position = 0) {
  const itemId = Number(contentItemId || 0) || 0;
  const assetId = Number(asset?.asset_id || asset?.id || 0) || 0;
  const normalizedRole = String(role || "gallery").trim().toLowerCase() || "gallery";
  const normalizedPosition = Number(position || 0) || 0;
  return `item-${itemId}-asset-${assetId}-${normalizedRole}-${normalizedPosition}`;
}

function buildSelectedAssetManifestEntry(contentItemId, asset, role, position = 0) {
  const sourceUrl = String(asset?.public_url || "").trim();
  const mimeType = String(asset?.mime_type || "").trim().toLowerCase();
  if (!sourceUrl) return null;
  if (mimeType && !mimeType.startsWith("image/")) return null;
  return {
    kind: "image",
    source_url: sourceUrl,
    url: sourceUrl,
    role,
    selected: true,
    client_media_uid: buildAdminReviewClientMediaUid(contentItemId, asset, role, position),
    source_asset_id: Number(asset?.asset_id || asset?.id || 0) || null,
    mime_type: mimeType || null,
    original_file_name: String(asset?.file_name || "").trim() || null,
    storage_disk: String(asset?.storage_disk || "").trim().toLowerCase() || null,
    storage_path: String(asset?.storage_path || "").trim() || null,
  };
}

function attachSelectedMediaMetadata(mediaManifest, selectedAssets, contentItemId) {
  const manifest = mediaManifest && typeof mediaManifest === "object" ? mediaManifest : {};
  const rows = Array.isArray(selectedAssets) ? selectedAssets : [];
  const byUrl = new Map();
  rows.forEach((asset) => {
    const url = String(asset?.public_url || "").trim();
    if (!url) return;
    byUrl.set(url, asset);
  });
  const enrichEntry = (entry, fallbackRole = "gallery", position = 0) => {
    if (!entry || typeof entry !== "object") return null;
    const normalizedUrl = String(entry.source_url || entry.url || "").trim();
    if (!normalizedUrl) return null;
    const role = String(entry.role || fallbackRole).trim().toLowerCase() || fallbackRole;
    const asset = byUrl.get(normalizedUrl) || null;
    const base = asset ? buildSelectedAssetManifestEntry(contentItemId, asset, role, position) : null;
    return {
      ...(base || {}),
      ...entry,
      source_url: normalizedUrl,
      url: normalizedUrl,
      role,
      selected: entry.selected !== false,
      client_media_uid: String(entry.client_media_uid || base?.client_media_uid || "").trim() || null,
      source_asset_id: Number(entry.source_asset_id || base?.source_asset_id || 0) || null,
      mime_type: String(entry.mime_type || base?.mime_type || "").trim().toLowerCase() || null,
      original_file_name: String(entry.original_file_name || base?.original_file_name || "").trim() || null,
      storage_disk: String(entry.storage_disk || base?.storage_disk || "").trim().toLowerCase() || null,
      storage_path: String(entry.storage_path || base?.storage_path || "").trim() || null,
    };
  };

  const cover = enrichEntry(manifest?.cover, "cover", 0);
  const gallery = (Array.isArray(manifest?.gallery) ? manifest.gallery : [])
    .map((entry, index) => enrichEntry(entry, "gallery", index))
    .filter(Boolean);
  const inline = (Array.isArray(manifest?.inline) ? manifest.inline : [])
    .map((entry, index) => enrichEntry(entry, "inline", index))
    .filter(Boolean);

  return {
    ...manifest,
    cover,
    gallery,
    inline,
  };
}

function isAdminReviewLocalMediaEntry(entry) {
  const storageDisk = String(entry?.storage_disk || "").trim().toLowerCase();
  const storagePath = String(entry?.storage_path || "").trim();
  if (!["local", "nas"].includes(storageDisk)) return false;
  if (!storagePath) return false;
  if (/^https?:\/\//i.test(storagePath)) return false;
  return true;
}

function sanitizeAdminReviewMediaManifest(mediaManifest, contentItemId) {
  const manifest = mediaManifest && typeof mediaManifest === "object" ? mediaManifest : {};
  const diagnostics = [];
  const noteExcluded = (entry, role, reason = "external_media_excluded") => {
    diagnostics.push({
      reason,
      content_item_id: Number(contentItemId || 0) || 0,
      asset_id: Number(entry?.source_asset_id || 0) || null,
      client_media_uid: String(entry?.client_media_uid || "").trim() || null,
      source_url: String(entry?.source_url || entry?.url || "").trim() || null,
      role: String(role || entry?.role || "").trim().toLowerCase() || null,
    });
  };

  const cover = manifest?.cover && typeof manifest.cover === "object" ? manifest.cover : null;
  if (!cover || !isAdminReviewLocalMediaEntry(cover)) {
    if (cover) noteExcluded(cover, "cover");
    throw new Error("cover image must be selected from uploaded local assets");
  }

  const gallery = (Array.isArray(manifest?.gallery) ? manifest.gallery : []).filter((entry) => {
    if (entry && isAdminReviewLocalMediaEntry(entry)) return true;
    if (entry) noteExcluded(entry, "gallery");
    return false;
  });
  const inline = (Array.isArray(manifest?.inline) ? manifest.inline : []).filter((entry) => {
    if (entry && isAdminReviewLocalMediaEntry(entry)) return true;
    if (entry) noteExcluded(entry, "inline");
    return false;
  });

  return {
    mediaManifest: {
      ...manifest,
      cover,
      gallery,
      inline,
    },
    diagnostics,
  };
}

function toPublishedMediaManifest(contentItemId) {
  const selectedAssets = repo.listContentAssetsByItem(contentItemId, { onlySelected: true });
  const imageEntries = selectedAssets
    .map((asset, index) => buildSelectedAssetManifestEntry(contentItemId, asset, normalizeSelectedAssetRole(asset), index))
    .filter(Boolean);

  let cover = imageEntries.find((entry) => entry.role === "cover") || null;
  if (!cover && imageEntries.length > 0) {
    cover = { ...imageEntries[0], role: "cover" };
  }

  const gallery = imageEntries
    .filter((entry) => entry.role === "gallery")
    .filter((entry) => entry.source_url !== String(cover?.source_url || ""));
  const inline = imageEntries.filter((entry) => entry.role === "inline");

  return {
    authority: "release_main_selected_assets",
    cover,
    gallery,
    inline,
    video: [],
  };
}

function buildBackendSyncPayload(options = {}) {
  if (!hasExplicitCollectorPublicBaseUrl()) {
    throw new Error("COLLECTOR_PUBLIC_BASE_URL is required for backend lifecycle sync.");
  }
  const contentItemId = Number(options?.contentItemId || options?.content_item_id || 0) || null;
  const currentSourceFingerprint = contentItemId ? getCurrentTranslationSourceFingerprint(repo, contentItemId) : "";
  const fingerprintByItemId = new Map();
  function getFingerprintForTranslation(row) {
    if (contentItemId) {
      return currentSourceFingerprint;
    }
    const sourceContentItemId = Number(row?.source_content_item_id || 0) || 0;
    if (!sourceContentItemId) {
      return "";
    }
    if (!fingerprintByItemId.has(sourceContentItemId)) {
      fingerprintByItemId.set(
        sourceContentItemId,
        getCurrentTranslationSourceFingerprint(repo, sourceContentItemId),
      );
    }
    return fingerprintByItemId.get(sourceContentItemId) || "";
  }
  const published = repo
    .listPublishedArticles()
    .filter((row) => !contentItemId || Number(row.content_item_id || 0) === contentItemId)
    .map((row) => {
      const sourceContentItemId = Number(row.content_item_id || 0) || 0;
      const sourceItem = repo.getItem(sourceContentItemId) || null;
      const otherTransportMeta = isOtherTransportItem(sourceItem) ? getOtherTransportMetadata(sourceItem) : null;
      const mediaManifest = toPublishedMediaManifest(sourceContentItemId);
      const coverImage = String(mediaManifest?.cover?.source_url || "").trim();
      return {
        source_content_item_id: sourceContentItemId,
        type: row.source_type || "place",
        category: row.source_category || "attractions",
        source_lang: row.source_lang || "th",
        slug: toBackendSafeSlug(row.slug, `item-${sourceContentItemId || "sync"}`),
        title: row.title,
        excerpt: row.excerpt,
        body: row.body,
        meta_title: row.meta_title,
        meta_description: row.meta_description,
        event_period_text: row.event_period_text,
        location_text: row.location_text,
        latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null,
        longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null,
        map_url: String(row.map_url || "").trim() || null,
        google_place_id: String(row.google_place_id || "").trim() || null,
        image: coverImage,
        transport_subtype: otherTransportMeta?.subtype || null,
        transport_contact_name: otherTransportMeta?.contact_name || null,
        transport_contact_phone: otherTransportMeta?.phone || null,
        transport_contact_details: otherTransportMeta?.contact_details || null,
        transport_link_url: otherTransportMeta?.link_url || null,
        published_at: row.published_at,
        media_manifest: mediaManifest,
      };
    });

  const translations = repo
    .listTranslations(contentItemId)
    .filter((t) => isTranslationRecheckPassed(t, getFingerprintForTranslation(t)))
    .map((t) => ({
      source_content_item_id: t.source_content_item_id,
      lang: t.lang,
      title: t.translated_title,
      excerpt: t.translated_excerpt,
      body: t.translated_body,
      meta_title: t.translated_meta_title,
      meta_description: t.translated_meta_description,
    }));

  return {
    source_system: "collector-app",
    source_base_url: resolveCollectorPublicBaseUrl(),
    content_item_id: contentItemId,
    published,
    translations,
  };
}

function buildReviewIngestPayload(options = {}) {
  const contentItemId = Number(options?.contentItemId || options?.content_item_id || 0) || 0;
  if (!contentItemId) {
    throw new Error("content_item_id is required");
  }
  const item = repo.getItem(contentItemId);
  if (!item) {
    throw new Error("Item not found");
  }
  const workflowModel = repo.ensureWorkflowModel(contentItemId);
  const publishableSource = repo.buildPublishableSourceByItem(contentItemId);
  const latestDraft = buildArticleProcessDraftPreview(item, workflowModel, publishableSource) || {};
  const selectedAssets = repo.listContentAssetsByItem(contentItemId, { onlySelected: true });
  const allAssets = repo.listContentAssetsByItem(contentItemId, { onlySelected: false });
  const sourceBaseUrl = String(options?.sourceBaseUrl || options?.source_base_url || resolveCollectorPublicBaseUrl()).trim();
  const contentType = String(item?.type || "").trim().toLowerCase() === "event" ? "event" : "place";
  const otherTransportMeta = isOtherTransportItem(item) ? getOtherTransportMetadata(item) : null;
  const sourceLang = String(item?.lang || "th").trim().toLowerCase() || "th";
  const title = String(latestDraft?.draft_title || item?.title || "").trim();
  const excerpt = String(latestDraft?.excerpt || item?.summary || "").trim();
  const body = String(latestDraft?.body || item?.description_clean || item?.description_raw || "").trim();
  const rewrittenBody = rewriteCollectorHtmlMediaUrls(body, sourceBaseUrl);
  const mergedMediaResult = mergeInlineMediaManifestFromBody({
    mediaManifest: rewriteMediaManifestForBase(toPublishedMediaManifest(contentItemId), sourceBaseUrl),
    bodyHtml: rewrittenBody,
    baseUrl: sourceBaseUrl,
    allAssets,
    createInlineEntry: (asset, position) => buildSelectedAssetManifestEntry(contentItemId, asset, "inline", position),
  });
  const unresolvedCollectorUploadUrls = Array.isArray(mergedMediaResult?.diagnostics?.unresolved_collector_upload_urls)
    ? mergedMediaResult.diagnostics.unresolved_collector_upload_urls.filter(Boolean)
    : [];
  if (unresolvedCollectorUploadUrls.length > 0) {
    throw new Error(`body inline image must map to a local collector asset before admin review: ${unresolvedCollectorUploadUrls.join(", ")}`);
  }
  const enrichedMediaManifest = attachSelectedMediaMetadata(mergedMediaResult?.mediaManifest || {}, selectedAssets, contentItemId);
  const adminReviewMediaResult = sanitizeAdminReviewMediaManifest(enrichedMediaManifest, contentItemId);
  const mediaManifest = adminReviewMediaResult.mediaManifest || {};
  const coverImage = String(mediaManifest?.cover?.source_url || "").trim();
  if (!coverImage) {
    throw new Error("cover image must be selected from uploaded local assets");
  }
  const metaTitle = String(latestDraft?.meta_title || item?.meta_title || title).trim();
  const metaDescription = String(latestDraft?.meta_description || item?.meta_description || excerpt).trim();
  if (!title || !excerpt || !rewrittenBody || !metaTitle || !metaDescription) {
    throw new Error("content fields are incomplete for admin review ingest");
  }

  const currentSourceFingerprint = contentItemId ? getCurrentTranslationSourceFingerprint(repo, contentItemId) : "";
  const translationLangs = repo
    .listTranslations(contentItemId)
    .filter((t) => isTranslationRecheckPassed(t, currentSourceFingerprint))
    .map((t) => String(t.lang || "").trim().toLowerCase())
    .filter(Boolean);
  const reviewIngestSource = resolveReviewIngestPayloadSourceContext({ repo, contentItemId, contentType });
  const handoffSnapshotJson = reviewIngestSource.handoff_snapshot_json;
  const reviewSourceKind = reviewIngestSource.review_source_kind;

  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
    if (unresolvedCollectorUploadUrls.length > 0) {
      try {
        console.error("[admin-review media eligibility skipped body images]", JSON.stringify({
          content_item_id: contentItemId,
          unresolved_collector_upload_urls: unresolvedCollectorUploadUrls,
        }));
      } catch {
        console.error("[admin-review media eligibility skipped body images]");
      }
    }
    const excludedExternalMedia = Array.isArray(adminReviewMediaResult?.diagnostics) ? adminReviewMediaResult.diagnostics : [];
    if (excludedExternalMedia.length > 0) {
      try {
        console.error("[admin-review external media excluded]", JSON.stringify(excludedExternalMedia));
      } catch {
        console.error("[admin-review external media excluded]");
      }
    }
  }

  return {
    source_system: "collector-app",
    source_content_item_id: contentItemId,
    source_base_url: sourceBaseUrl,
    review_source_kind: reviewSourceKind,
    handoff_snapshot_json: handoffSnapshotJson,
    content: {
      ...buildReviewIngestContentPayload({
        contentType,
        sourceLang,
        item: {
          ...item,
          // Confirmed CTA/contact remains place-first and draft-owned only.
          slug: normalizeCollectorSlug(item?.slug || "", `item-${contentItemId}`),
        },
        latestDraft,
        title,
        excerpt,
        rewrittenBody,
        metaTitle,
        metaDescription,
        otherTransportMeta,
        translationLangs,
      }),
    },
    media_manifest: {
      ...mediaManifest,
      gallery: Array.isArray(mediaManifest?.gallery) ? mediaManifest.gallery : [],
      inline: Array.isArray(mediaManifest?.inline) ? mediaManifest.inline : [],
      selected_asset_count: selectedAssets.length,
    },
  };
}

function buildAdminReviewMultipartFilePlan(payload, contentItemId) {
  const itemId = Number(contentItemId || 0) || 0;
  const selectedAssets = repo.listContentAssetsByItem(itemId, { onlySelected: true });
  const allAssets = repo.listContentAssetsByItem(itemId, { onlySelected: false });
  return buildAdminReviewMultipartUploadPlan({
    payload,
    selectedAssets,
    allAssets,
    resolveStoragePath,
    fileExists: (absolutePath) => fsSync.existsSync(absolutePath),
  });
}

function buildEventAdminQueuePayload(options = {}) {
  const reviewPayload = buildReviewIngestPayload(options);
  const contentItemId = Number(reviewPayload?.source_content_item_id || 0) || 0;
  const content = reviewPayload?.content || {};
  const sourceBaseUrl = String(reviewPayload?.source_base_url || options?.sourceBaseUrl || resolveCollectorPublicBaseUrl()).trim();
  const mediaManifest = rewriteMediaManifestForBase(reviewPayload?.media_manifest || {}, sourceBaseUrl);
  const currentSourceFingerprint = contentItemId ? getCurrentTranslationSourceFingerprint(repo, contentItemId) : "";

  return {
    source_system: String(reviewPayload?.source_system || "collector-app").trim().toLowerCase() || "collector-app",
    source_content_type: "event",
    source_content_item_id: contentItemId,
    source_base_url: sourceBaseUrl || null,
    published_at: new Date().toISOString(),
    article_snapshot: {
      category: String(content?.category || "").trim().toLowerCase() || "event",
      slug: String(content?.slug || "").trim() || null,
      title: String(content?.title || "").trim() || null,
      description: String(content?.body || "").trim() || null,
      excerpt: String(content?.excerpt || "").trim() || null,
      meta_title: String(content?.meta_title || "").trim() || null,
      meta_description: String(content?.meta_description || "").trim() || null,
      source_base_url: sourceBaseUrl || null,
      event_period_text: content?.event_period_text || null,
      location_text: content?.location_text || null,
      latitude: Number.isFinite(Number(content?.latitude)) ? Number(content.latitude) : null,
      longitude: Number.isFinite(Number(content?.longitude)) ? Number(content.longitude) : null,
      map_url: String(content?.map_url || "").trim() || null,
      google_place_id: String(content?.google_place_id || "").trim() || null,
      image: String(mediaManifest?.cover?.source_url || "").trim() || null,
      media_manifest: {
        ...mediaManifest,
        gallery: Array.isArray(mediaManifest?.gallery) ? mediaManifest.gallery : [],
        inline: Array.isArray(mediaManifest?.inline) ? mediaManifest.inline : [],
      },
    },
    translations_snapshot: repo
      .listTranslations(contentItemId)
      .filter((t) => isTranslationRecheckPassed(t, currentSourceFingerprint))
      .map((t) => ({
        lang: String(t.lang || "").trim().toLowerCase(),
        title: t.translated_title,
        description: t.translated_body,
        meta_title: t.translated_meta_title,
        meta_description: t.translated_meta_description,
      })),
    translation_langs: repo
      .listTranslations(contentItemId)
      .filter((t) => isTranslationRecheckPassed(t, currentSourceFingerprint))
      .map((t) => String(t.lang || "").trim().toLowerCase())
      .filter(Boolean),
  };
}

function respondBatchReleaseDisabled(req, res, routePath) {
  repo.logAudit(actorEmail(req), "release.batch_route_blocked", "api_route", routePath, {
    route: routePath,
    replacement: "/api/items/:id/release-main",
  });
  res.status(410).json({
    error: "Batch release routes are disabled. Use POST /api/items/:id/release-main for item-scoped release.",
    route: routePath,
    replacement: "/api/items/:id/release-main",
  });
}

function buildUploadStorage() {
  return multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const now = new Date();
      const subdir = path.join(
        dirs.mediaDir,
        "uploads",
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, "0")
      );
      try {
        await fs.mkdir(subdir, { recursive: true });
        cb(null, subdir);
      } catch (err) {
        cb(err, subdir);
      }
    },
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || "asset.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  });
}

function createUploadMiddleware(isAllowedMime, { maxFileSizeBytes = 20 * 1024 * 1024 } = {}) {
  return multer({
    storage: buildUploadStorage(),
    limits: { fileSize: Number(maxFileSizeBytes || 0) > 0 ? Number(maxFileSizeBytes) : 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedMime(file?.mimetype)) {
        cb(new Error("Unsupported upload mime type"));
        return;
      }
      cb(null, true);
    },
  });
}

const upload = createUploadMiddleware(isAllowedImageUploadMime);
const assignmentUpload = createUploadMiddleware(isAllowedAssignmentUploadMime, {
  maxFileSizeBytes: 500 * 1024 * 1024,
});
const ASSIGNMENT_CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
const ASSIGNMENT_CHUNK_MAX_BYTES = 30 * 1024 * 1024;
const ASSIGNMENT_CHUNK_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const assignmentChunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ASSIGNMENT_CHUNK_MAX_BYTES },
});

function isValidAssignmentUploadId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function sanitizeStoredUploadName(name, fallback = "upload.bin") {
  const base = String(name || "").trim() || fallback;
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeRelativeStoragePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
}

function getAssignmentUploadTempDir(assignmentId, uploadId) {
  return path.join(
    dirs.mediaDir,
    "tmp-chunks",
    "assignment-work",
    String(Number(assignmentId || 0) || 0),
    String(uploadId || "").trim()
  );
}

function getAssignmentUploadRootDir() {
  return path.join(dirs.mediaDir, "tmp-chunks", "assignment-work");
}

function getAssignmentUploadManifestPath(assignmentId, uploadId) {
  return path.join(getAssignmentUploadTempDir(assignmentId, uploadId), "manifest.json");
}

function getAssignmentChunkFilePath(assignmentId, uploadId, chunkIndex) {
  const index = Number(chunkIndex || 0);
  const fileName = `chunk-${String(index).padStart(6, "0")}.part`;
  return path.join(getAssignmentUploadTempDir(assignmentId, uploadId), fileName);
}

async function writeAssignmentUploadManifest(assignmentId, uploadId, manifest) {
  const manifestPath = getAssignmentUploadManifestPath(assignmentId, uploadId);
  const payload = JSON.stringify(manifest, null, 2);
  await fs.writeFile(manifestPath, payload, "utf8");
}

async function readAssignmentUploadManifest(assignmentId, uploadId) {
  const manifestPath = getAssignmentUploadManifestPath(assignmentId, uploadId);
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}

function isPathWithinRoot(rootPath, candidatePath) {
  const rootResolved = path.resolve(rootPath);
  const candidateResolved = path.resolve(candidatePath);
  return candidateResolved === rootResolved || candidateResolved.startsWith(`${rootResolved}${path.sep}`);
}

async function removeAssignmentUploadSessionTempDir(assignmentId, uploadId) {
  const root = getAssignmentUploadRootDir();
  const target = getAssignmentUploadTempDir(assignmentId, uploadId);
  if (!isPathWithinRoot(root, target)) return false;
  await fs.rm(target, { recursive: true, force: true });
  return true;
}

async function cleanupStaleAssignmentUploadSessions({ maxAgeMs = ASSIGNMENT_CHUNK_SESSION_MAX_AGE_MS } = {}) {
  const root = getAssignmentUploadRootDir();
  const now = Date.now();
  const safeMaxAge = Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) > 0
    ? Number(maxAgeMs)
    : ASSIGNMENT_CHUNK_SESSION_MAX_AGE_MS;
  await fs.mkdir(root, { recursive: true });
  const assignmentDirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const assignmentDir of assignmentDirs) {
    if (!assignmentDir?.isDirectory()) continue;
    const assignmentPath = path.join(root, assignmentDir.name);
    if (!isPathWithinRoot(root, assignmentPath)) continue;
    const uploadDirs = await fs.readdir(assignmentPath, { withFileTypes: true }).catch(() => []);
    for (const uploadDir of uploadDirs) {
      if (!uploadDir?.isDirectory()) continue;
      const uploadPath = path.join(assignmentPath, uploadDir.name);
      if (!isPathWithinRoot(root, uploadPath)) continue;
      const manifestPath = path.join(uploadPath, "manifest.json");
      let updatedAtMs = 0;
      try {
        const raw = await fs.readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw);
        updatedAtMs = Date.parse(String(parsed?.updated_at || parsed?.created_at || ""));
      } catch {}
      if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
        try {
          const stats = await fs.stat(uploadPath);
          updatedAtMs = Number(stats?.mtimeMs || 0);
        } catch {
          updatedAtMs = 0;
        }
      }
      if (Number.isFinite(updatedAtMs) && updatedAtMs > 0 && (now - updatedAtMs) >= safeMaxAge) {
        await fs.rm(uploadPath, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

async function readFileHeadBytes(filePath, maxBytes = 8192) {
  const limit = Math.max(64, Number(maxBytes || 0) || 8192);
  const file = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const read = await file.read(buffer, 0, limit, 0);
    return buffer.subarray(0, Number(read?.bytesRead || 0));
  } finally {
    await file.close();
  }
}

async function appendChunkToStream(chunkPath, outputStream, hash) {
  let chunkBytesWritten = 0;
  const input = fsSync.createReadStream(chunkPath);
  const onError = (err) => {
    input.destroy(err);
  };
  outputStream.once("error", onError);
  try {
    for await (const chunk of input) {
      hash.update(chunk);
      chunkBytesWritten += chunk.length;
      if (!outputStream.write(chunk)) {
        await once(outputStream, "drain");
      }
    }
  } finally {
    outputStream.off("error", onError);
  }
  return chunkBytesWritten;
}

async function ensureAssignmentUploadAccess(req, res, assignmentId) {
  const normalizedId = Number(assignmentId || 0);
  if (!normalizedId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return null;
  }
  const assignment = repo.getAssignmentById(normalizedId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return null;
  }
  if (actorPolicyRole(req) === "editor") {
    res.status(403).json({ error: "editor cannot upload assignment assets from this surface" });
    return null;
  }
  if (!hasAssignmentSubmissionAccess(req, assignment)) {
    res.status(403).json({ error: "only assigned contributor can upload files for this assignment" });
    return null;
  }
  return assignment;
}

function toPositiveIntWithinRange(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseGoogleMapsPhotoProxyValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, "http://collector.local");
    if (parsed.pathname !== GOOGLE_MAPS_PHOTO_PROXY_PATH) return null;
    const name = String(parsed.searchParams.get("name") || "").trim();
    if (!/^places\/[^/?#]+\/photos\/[^/?#]+$/i.test(name)) return null;
    return {
      name,
      maxWidthPx: toPositiveIntWithinRange(parsed.searchParams.get("maxWidthPx"), 1400, 1, 1600),
      maxHeightPx: toPositiveIntWithinRange(parsed.searchParams.get("maxHeightPx"), 1400, 1, 1600),
    };
  } catch {
    return null;
  }
}

function parseLegacyGoogleMapsPhotoUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname !== "places.googleapis.com") return null;
    const nameMatch = parsed.pathname.match(/^\/v1\/(places\/[^/?#]+\/photos\/[^/?#]+)\/media$/i);
    if (!nameMatch) return null;
    return {
      name: decodeURIComponent(nameMatch[1]),
      maxWidthPx: toPositiveIntWithinRange(parsed.searchParams.get("maxWidthPx"), 1400, 1, 1600),
      maxHeightPx: toPositiveIntWithinRange(parsed.searchParams.get("maxHeightPx"), 1400, 1, 1600),
    };
  } catch {
    return null;
  }
}

function buildGoogleMapsPhotoProxyPath(name, maxWidthPx = 1400, maxHeightPx = 1400) {
  const normalizedName = String(name || "").trim();
  if (!/^places\/[^/?#]+\/photos\/[^/?#]+$/i.test(normalizedName)) return "";
  const params = new URLSearchParams();
  params.set("name", normalizedName);
  params.set("maxWidthPx", String(toPositiveIntWithinRange(maxWidthPx, 1400, 1, 1600)));
  params.set("maxHeightPx", String(toPositiveIntWithinRange(maxHeightPx, 1400, 1, 1600)));
  return `${GOOGLE_MAPS_PHOTO_PROXY_PATH}?${params.toString()}`;
}

function sanitizeGoogleMapsPhotoUrl(value) {
  const proxy = parseGoogleMapsPhotoProxyValue(value);
  if (proxy) {
    return buildGoogleMapsPhotoProxyPath(proxy.name, proxy.maxWidthPx, proxy.maxHeightPx);
  }
  const legacy = parseLegacyGoogleMapsPhotoUrl(value);
  if (!legacy) return String(value || "").trim();
  return buildGoogleMapsPhotoProxyPath(legacy.name, legacy.maxWidthPx, legacy.maxHeightPx);
}

function sanitizeGoogleMapsPhotoUrlsDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeGoogleMapsPhotoUrlsDeep(entry));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeGoogleMapsPhotoUrl(value) : value;
  }
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = sanitizeGoogleMapsPhotoUrlsDeep(entry);
  }
  return next;
}

function parseAssetPathForUrl(storagePath) {
  const value = String(storagePath || "").trim();
  if (!value) return "";
  const sanitized = sanitizeGoogleMapsPhotoUrl(value);
  if (sanitized.startsWith("/api/")) return sanitized;
  if (/^https?:\/\//i.test(sanitized)) return sanitized;
  const relative = value.replace(/\\/g, "/");
  return `/media/${relative}`;
}

function isCollectorControlledLocalAssetRow(row) {
  const storageDisk = String(row?.storage_disk || "").trim().toLowerCase();
  const storagePath = String(row?.storage_path || "").trim();
  const mimeType = String(row?.mime_type || "").trim().toLowerCase();
  if (!["local", "nas"].includes(storageDisk)) return false;
  if (!storagePath || /^https?:\/\//i.test(storagePath)) return false;
  if (mimeType && !mimeType.startsWith("image/")) return false;
  return true;
}

function clearExternalUsableMediaAtHandoff(contentItemId, options = {}) {
  const itemId = Number(contentItemId || 0) || 0;
  if (!itemId) return { cleared: [], cover_cleared: false, local_cover_url: "" };
  const item = repo.getItem(itemId);
  if (!item) return { cleared: [], cover_cleared: false, local_cover_url: "" };

  const submissionId = Number(options?.submissionId || 0) || null;
  const rows = repo.listContentAssetsByItem(itemId, { onlySelected: false });
  const cleared = [];
  for (const row of rows) {
    const selectedInClean = Number(row?.selected_in_clean || 0) === 1;
    const role = String(row?.role || "").trim().toLowerCase();
    const isCover = Number(row?.is_cover || 0) === 1 || role === "cover";
    const isUsableMedia = selectedInClean || isCover || ["cover", "gallery", "inline"].includes(role);
    if (!isUsableMedia || isCollectorControlledLocalAssetRow(row)) continue;
    repo.setContentAssetRole(itemId, Number(row.asset_id || 0), "unused");
    cleared.push({
      reason: "external_media_cleared_at_handoff_submit",
      content_item_id: itemId,
      submission_id: submissionId,
      role: role || null,
      candidate_role: role || null,
      source_url: String(row?.public_url || "").trim() || null,
      asset_id: Number(row?.asset_id || 0) || null,
    });
  }

  const selectedLocalRows = repo
    .listContentAssetsByItem(itemId, { onlySelected: true })
    .filter((row) => isCollectorControlledLocalAssetRow(row));
  const localCover = selectedLocalRows.find((row) => Number(row?.is_cover || 0) === 1 || String(row?.role || "").trim().toLowerCase() === "cover") || null;
  const localCoverUrl = String(localCover?.public_url || "").trim();
  const currentImageUrl = String(item?.image_url || "").trim();
  const coverCleared = Boolean(currentImageUrl) && currentImageUrl !== localCoverUrl;
  if (coverCleared) {
    repo.saveItem({ ...item, id: itemId, image_url: localCoverUrl || "" }, actorEmail(options?.req) || "system@local");
  }

  if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production" && cleared.length > 0) {
    try {
      console.error("[external usable media cleared at handoff submit]", JSON.stringify(cleared));
    } catch {
      console.error("[external usable media cleared at handoff submit]");
    }
  }

  return {
    cleared,
    cover_cleared: coverCleared,
    local_cover_url: localCoverUrl || "",
  };
}

function resolveFieldPackRequestedChecksForEditor(item, fieldPack) {
  if (!fieldPack || typeof fieldPack !== "object" || !item || typeof item !== "object") return fieldPack || null;
  return {
    ...fieldPack,
    requested_checks_json: resolveRequestedChecksWithCatalog({
      requestedChecks: fieldPack.requested_checks_json,
      item,
      aiCtaContact: fieldPack.ai_cta_contact_json,
      aiTaxonomy: fieldPack.ai_taxonomy_json,
    }),
  };
}

function buildRequestedChecksResolutionItem(item, itemOverride = {}) {
  const baseItem = item && typeof item === "object" ? item : {};
  const override = itemOverride && typeof itemOverride === "object" ? itemOverride : {};
  return {
    ...baseItem,
    ...override,
    type: String(override.type || baseItem.type || "").trim().toLowerCase() || String(baseItem.type || "").trim().toLowerCase(),
    category: String(override.category || baseItem.category || "").trim() || String(baseItem.category || "").trim(),
  };
}

function toMediaDedupKey(value) {
  const raw = sanitizeGoogleMapsPhotoUrl(value);
  if (!raw) return "";
  return normalizeMediaUrl(raw) || raw;
}

const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;

function sanitizeAssignmentSyncBatchId(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return String(fallback || "").trim();
  const normalized = raw.replace(/[^a-zA-Z0-9._:-]/g, "");
  if (!normalized) return String(fallback || "").trim();
  return normalized.slice(0, 128);
}

function sanitizeAssignmentCaptureSlotKey(value, fallback = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return String(fallback || "").trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9-]/g, "");
  if (!normalized.startsWith("shot-")) return String(fallback || "").trim().toLowerCase();
  return normalized.slice(0, 96);
}

function parseIsoMs(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function listDraftAssignmentWorkAssetRows(options = {}) {
  const assignmentId = Number(options.assignmentId || 0) || 0;
  const assignmentRound = Number(options.assignmentRound || 0) || 0;
  const contentItemId = Number(options.contentItemId || 0) || 0;
  const clauses = ["COALESCE(ca.assignment_surface, '')='assignment_work'"];
  const params = [];
  if (assignmentId > 0) {
    clauses.push("ca.assignment_id=?");
    params.push(assignmentId);
  }
  if (assignmentRound > 0) {
    clauses.push("ca.assignment_round=?");
    params.push(assignmentRound);
  }
  if (contentItemId > 0) {
    clauses.push("ca.content_item_id=?");
    params.push(contentItemId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT
      ca.id AS content_asset_id,
      ca.assignment_id,
      ca.assignment_round,
      ca.assignment_media_type,
      ca.content_item_id,
      a.id AS asset_id,
      a.storage_disk,
      a.storage_path,
      a.file_name,
      a.mime_type,
      a.created_at
    FROM content_assets ca
    JOIN assets a ON a.id = ca.asset_id
    ${where}
    ORDER BY a.id DESC
  `).all(...params);
  return Array.isArray(rows) ? rows : [];
}

function removeAssignmentWorkRowsByAssetIds(assetIds = []) {
  const ids = Array.from(new Set((Array.isArray(assetIds) ? assetIds : []).map((v) => Number(v || 0)).filter((v) => v > 0)));
  if (!ids.length) return { removed_links: 0, removed_assets: 0, deleted_files: [] };
  let removedLinks = 0;
  let removedAssets = 0;
  const deletedFiles = [];
  for (const assetId of ids) {
    const linkRows = db.prepare(
      "SELECT id, assignment_surface FROM content_assets WHERE asset_id=? AND COALESCE(assignment_surface,'')='assignment_work'"
    ).all(assetId);
    for (const linkRow of linkRows) {
      const result = db.prepare("DELETE FROM content_assets WHERE id=?").run(Number(linkRow?.id || 0) || 0);
      removedLinks += Number(result?.changes || 0) || 0;
    }
    const stillLinked = Number(db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(assetId)?.c || 0);
    if (stillLinked > 0) continue;
    const deliverableRefs = Number(
      db.prepare("SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE source_asset_id=?").get(assetId)?.c || 0
    );
    if (deliverableRefs > 0) continue;
    const row = db.prepare("SELECT storage_disk, storage_path FROM assets WHERE id=? LIMIT 1").get(assetId);
    const deletedAsset = db.prepare("DELETE FROM assets WHERE id=?").run(assetId);
    if (Number(deletedAsset?.changes || 0) < 1) continue;
    removedAssets += 1;
    const storagePath = String(row?.storage_path || "").trim();
    const storageDisk = String(row?.storage_disk || "").trim().toLowerCase();
    if (!storagePath || !["local", "nas"].includes(storageDisk)) continue;
    const duplicatePathRefs = Number(
      db.prepare("SELECT COUNT(*) AS c FROM assets WHERE storage_path=?").get(storagePath)?.c || 0
    );
    if (duplicatePathRefs > 0) continue;
    try {
      fsSync.unlinkSync(resolveStoragePath(storagePath));
      deletedFiles.push(storagePath);
    } catch (err) {
      console.warn("[assignment.work.cleanup.file_delete_failed]", {
        assetId,
        storagePath,
        error: err?.message || String(err),
      });
    }
  }
  return { removed_links: removedLinks, removed_assets: removedAssets, deleted_files: deletedFiles };
}

function cleanupExpiredAssignmentWorkDraftAssets(options = {}) {
  const nowMs = Date.now();
  const maxAgeMs = Number(options.maxAgeMs || ASSIGNMENT_WORK_SYNC_EXPIRY_MS) || ASSIGNMENT_WORK_SYNC_EXPIRY_MS;
  const rows = listDraftAssignmentWorkAssetRows({
    assignmentId: options.assignmentId,
    assignmentRound: options.assignmentRound,
    contentItemId: options.contentItemId,
  });
  const expiredAssetIds = [];
  for (const row of rows) {
    const assetId = Number(row?.asset_id || 0) || 0;
    if (!assetId) continue;
    const deliverableRefs = Number(
      db.prepare("SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE source_asset_id=?").get(assetId)?.c || 0
    );
    if (deliverableRefs > 0) continue;
    const createdAtMs = parseIsoMs(row?.created_at);
    if (createdAtMs <= 0) continue;
    if ((nowMs - createdAtMs) < maxAgeMs) continue;
    expiredAssetIds.push(assetId);
  }
  return removeAssignmentWorkRowsByAssetIds(expiredAssetIds);
}

function cleanupSupersededAssignmentWorkAssetsAfterSubmit(assignmentId, assignmentRound, keepAssetIds = []) {
  const id = Number(assignmentId || 0) || 0;
  const round = Number(assignmentRound || 0) || 0;
  if (!id || !round) return { removed_links: 0, removed_assets: 0, deleted_files: [] };
  const keepSet = new Set((Array.isArray(keepAssetIds) ? keepAssetIds : []).map((v) => Number(v || 0)).filter((v) => v > 0));
  const rows = listDraftAssignmentWorkAssetRows({ assignmentId: id, assignmentRound: round });
  const deleteIds = rows
    .map((row) => Number(row?.asset_id || 0) || 0)
    .filter((assetId) => assetId > 0 && !keepSet.has(assetId));
  return removeAssignmentWorkRowsByAssetIds(deleteIds);
}

function deleteAssetIfUnused(assetId) {
  const id = Number(assetId || 0);
  if (!id) {
    return { deleted_asset: false, deleted_file: false, blocked_references: [] };
  }
  const blockedReferences = [];
  const linkedCount = Number(db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(id)?.c || 0);
  if (linkedCount > 0) {
    blockedReferences.push("content_assets");
  }
  const deliverableCount = Number(
    db.prepare("SELECT COUNT(*) AS c FROM content_assignment_submission_deliverables WHERE source_asset_id=?").get(id)?.c || 0
  );
  if (deliverableCount > 0) {
    blockedReferences.push("content_assignment_submission_deliverables");
  }
  const transportBaseMapCount = Number(
    db.prepare(`
      SELECT COUNT(*) AS c
      FROM transport_base_maps_v2
      WHERE base_svg_asset_id=?
         OR preview_asset_id=?
         OR candidate_map_asset_id=?
         OR annotation_map_asset_id=?
         OR published_map_asset_id=?
    `).get(id, id, id, id, id)?.c || 0
  );
  if (transportBaseMapCount > 0) {
    blockedReferences.push("transport_base_maps_v2");
  }
  const transportRouteCount = Number(
    db.prepare(`
      SELECT COUNT(*) AS c
      FROM transport_routes_v2
      WHERE vehicle_thumbnail_asset_id=?
         OR poster_svg_asset_id=?
         OR poster_webp_asset_id=?
    `).get(id, id, id)?.c || 0
  );
  if (transportRouteCount > 0) {
    blockedReferences.push("transport_routes_v2");
  }
  const userRows = db.prepare("SELECT profile_json FROM users WHERE profile_json IS NOT NULL").all();
  const userProfileRefCount = userRows.reduce((count, row) => {
    const picAssetId = Number(normalizeUserProfilePayload(row?.profile_json, { allowPic: true })?.pic_asset_id || 0) || 0;
    return picAssetId === id ? count + 1 : count;
  }, 0);
  if (userProfileRefCount > 0) {
    blockedReferences.push("users.profile_json.pic_asset_id");
  }
  if (blockedReferences.length > 0) {
    return { deleted_asset: false, deleted_file: false, blocked_references: blockedReferences };
  }
  const assetRow = db.prepare("SELECT storage_disk, storage_path FROM assets WHERE id=? LIMIT 1").get(id) || null;
  let deletedFile = false;
  if (assetRow && (assetRow.storage_disk === "local" || assetRow.storage_disk === "nas")) {
    const rawStoragePath = String(assetRow.storage_path || "").trim();
    if (rawStoragePath && !/^https?:\/\//i.test(rawStoragePath)) {
      try {
        fsSync.unlinkSync(resolveStoragePath(rawStoragePath));
        deletedFile = true;
      } catch {
        // Keep delete behavior best-effort and idempotent.
      }
    }
  }
  db.prepare("DELETE FROM assets WHERE id=?").run(id);
  return { deleted_asset: true, deleted_file: deletedFile, blocked_references: [] };
}

function purgeUnusedContentAssetsForItem(contentItemId) {
  const itemId = Number(contentItemId || 0) || 0;
  if (!itemId) {
    return {
      content_item_id: 0,
      removed_links: 0,
      removed_assets: 0,
      removed_local_files: 0,
      skipped_asset_deletes: 0,
      blocked_asset_references: [],
    };
  }

  const rows = db
    .prepare(`
      SELECT id, asset_id
      FROM content_assets
      WHERE content_item_id=?
        AND (selected_in_clean=0 OR role='unused')
    `)
    .all(itemId);

  let removedLinks = 0;
  let removedAssets = 0;
  let removedLocalFiles = 0;
  let skippedAssetDeletes = 0;
  const blockedAssetReferences = [];

  for (const row of rows) {
    const mappingId = Number(row?.id || 0) || 0;
    const assetId = Number(row?.asset_id || 0) || 0;
    if (!mappingId || !assetId) continue;
    db.prepare("DELETE FROM content_assets WHERE id=?").run(mappingId);
    removedLinks += 1;
    const assetDelete = deleteAssetIfUnused(assetId);
    if (assetDelete?.deleted_asset) removedAssets += 1;
    if (assetDelete?.deleted_file) removedLocalFiles += 1;
    if (!assetDelete?.deleted_asset && Array.isArray(assetDelete?.blocked_references) && assetDelete.blocked_references.length > 0) {
      skippedAssetDeletes += 1;
      blockedAssetReferences.push({
        asset_id: assetId,
        references: assetDelete.blocked_references,
      });
    }
  }

  return {
    content_item_id: itemId,
    removed_links: removedLinks,
    removed_assets: removedAssets,
    removed_local_files: removedLocalFiles,
    skipped_asset_deletes: skippedAssetDeletes,
    blocked_asset_references: blockedAssetReferences,
  };
}

function cleanupAiInputAssetsAfterAssignmentCreated(contentItemId) {
  const itemId = Number(contentItemId || 0) || 0;
  if (!itemId) {
    return {
      ok: true,
      content_item_id: 0,
      removed_links: 0,
      removed_assets: 0,
      removed_local_files: 0,
      skipped_asset_deletes: 0,
      blocked_asset_references: [],
      policy_blocked_assets: [],
    };
  }

  const report = repo.listPostAssignmentAiInputCleanupCandidates(itemId, { include_blocked: true });
  const candidates = Array.isArray(report?.assets) ? report.assets : [];
  const eligible = candidates.filter((row) => row?.eligible_for_cleanup === true);
  const policyBlocked = candidates
    .filter((row) => row?.eligible_for_cleanup !== true)
    .map((row) => ({
      content_asset_id: Number(row?.content_asset_id || 0) || 0,
      asset_id: Number(row?.asset_id || 0) || 0,
      blocked_reasons: Array.isArray(row?.blocked_reasons) ? row.blocked_reasons : [],
    }));

  let removedLinks = 0;
  let removedAssets = 0;
  let removedLocalFiles = 0;
  let skippedAssetDeletes = 0;
  const blockedAssetReferences = [];

  for (const row of eligible) {
    const contentAssetId = Number(row?.content_asset_id || 0) || 0;
    const assetId = Number(row?.asset_id || 0) || 0;
    if (!contentAssetId || !assetId) continue;

    const deleteLinkResult = db.prepare("DELETE FROM content_assets WHERE id=?").run(contentAssetId);
    removedLinks += Number(deleteLinkResult?.changes || 0) || 0;

    const assetDelete = deleteAssetIfUnused(assetId);
    if (assetDelete?.deleted_asset) removedAssets += 1;
    if (assetDelete?.deleted_file) removedLocalFiles += 1;
    if (!assetDelete?.deleted_asset) {
      skippedAssetDeletes += 1;
      blockedAssetReferences.push({
        asset_id: assetId,
        references: Array.isArray(assetDelete?.blocked_references) ? assetDelete.blocked_references : [],
      });
    }
  }

  return {
    ok: true,
    content_item_id: itemId,
    policy_version: String(report?.policy_version || "post_assignment_ai_input_cleanup_v1"),
    ai_input_assets: Number(report?.summary?.ai_input_assets || 0) || 0,
    eligible_assets: Number(report?.summary?.eligible_assets || 0) || 0,
    blocked_assets: Number(report?.summary?.blocked_assets || 0) || 0,
    removed_links: removedLinks,
    removed_assets: removedAssets,
    removed_local_files: removedLocalFiles,
    skipped_asset_deletes: skippedAssetDeletes,
    blocked_asset_references: blockedAssetReferences,
    policy_blocked_assets: policyBlocked,
  };
}

function scoreRemoteMediaCandidate(entry) {
  const width = Number(entry?.width || 0);
  const height = Number(entry?.height || 0);
  const area = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width * height : 0;
  const role = String(entry?.metadata_json?.role || entry?.role || "").trim().toLowerCase();
  const roleBonus = role === "hero" || role === "cover" ? 1_000_000_000 : 0;
  return roleBonus + area;
}

function toRemoteMediaCandidates(rawItem = {}, limit = MAX_IMAGES_PER_ITEM) {
  const out = [];

  const pushCandidate = (url, mimeType = null, options = {}) => {
    const normalized = sanitizeGoogleMapsPhotoUrl(url);
    if (!normalized) return;
    if (!/^https?:\/\//i.test(normalized) && !normalized.startsWith("/api/")) return;
    out.push({
      url: normalized,
      mime_type: mimeType || null,
      width: Number.isFinite(Number(options?.width)) ? Number(options.width) : null,
      height: Number.isFinite(Number(options?.height)) ? Number(options.height) : null,
      metadata_json: options?.metadata_json && typeof options.metadata_json === "object" ? options.metadata_json : null,
      role: String(options?.role || "").trim() || null,
    });
  };

  if (Array.isArray(rawItem?.media)) {
    for (const media of rawItem.media) {
      const metadataJson =
        media?.metadata_json && typeof media.metadata_json === "object"
          ? media.metadata_json
          : media?.metadata && typeof media.metadata === "object"
            ? media.metadata
            : null;
      pushCandidate(media?.media_url || media?.url, media?.mime_type || null, {
        width: media?.width,
        height: media?.height,
        metadata_json: metadataJson,
        role: metadataJson?.role || media?.role || null,
      });
    }
  }

  const normalizedImage = String(rawItem?.normalized_json?.image || rawItem?.image_url || "").trim();
  if (normalizedImage) {
    pushCandidate(normalizedImage, null);
  }

  out.sort((a, b) => scoreRemoteMediaCandidate(b) - scoreRemoteMediaCandidate(a));
  return dedupeMediaEntries(out, (entry) => entry?.url, limit).slice(0, limit);
}

function buildRemoteFileName(url) {
  const proxy = parseGoogleMapsPhotoProxyValue(url);
  if (proxy?.name) {
    const photoId = String(proxy.name).split("/").pop() || "google-photo";
    return `${String(photoId).replace(/[^a-zA-Z0-9._-]/g, "_") || "google-photo"}.jpg`;
  }
  try {
    const parsed = new URL(String(url || ""));
    const name = path.basename(parsed.pathname || "") || "remote-image.jpg";
    return String(name).replace(/[^a-zA-Z0-9._-]/g, "_") || "remote-image.jpg";
  } catch {
    return "remote-image.jpg";
  }
}

function resolveStoragePath(storagePath) {
  if (path.isAbsolute(storagePath)) return storagePath;
  return path.join(dirs.mediaDir, storagePath);
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

function normalizeSeoSuggestionRequestBody(body = {}, item = null) {
  return buildSeoSuggestionRequestContext(body, item, sanitizeArticleRichTextHtml);
}

function normalizeArticleSuggestionRequestBody(body = {}, item = null) {
  const selectedAssets = Array.isArray(body?.selected_assets) ? body.selected_assets : null;
  return buildArticleSuggestionRequestContext(body, item, sanitizeArticleRichTextHtml, selectedAssets);
}

function hasOwnRequestField(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function readSubmittedStringField(source, key, fallback = "") {
  if (hasOwnRequestField(source, key)) {
    return String(source[key] ?? "");
  }
  return String(fallback ?? "");
}

async function buildAiCollectQueries(topic, category, lang = "th", maxQueries = 5) {
  const safeTopic = String(topic || "").trim();
  if (!safeTopic) return [];
  const aiConfig = resolveAiFeatureConfig(getEffectiveAiConfig(), "aiDiscovery");
  if (!aiConfig?.enabled) return [];

  const prompt = [
    "Generate search queries for discovering real places in Ubon Ratchathani.",
    "Return ONLY JSON: {\"queries\":[\"...\"]}",
    `topic: ${safeTopic}`,
    `category: ${String(category || "attractions").trim()}`,
    `language: ${String(lang || "th").trim()}`,
    `max_queries: ${Number(maxQueries || 5)}`,
    "Queries should be practical for Google Maps text search.",
  ].join("\n");

  let result;
  try {
    result = await executeBackendAiJson({
      aiConfig,
      featureKey: "aiDiscovery",
      task: "ai_discovery_queries",
      prompt,
    });
  } catch {
    return [];
  }
  const parsed = result?.parsed || parseJsonLike(String(result?.outputText || ""));
  const queries = Array.isArray(parsed?.queries) ? parsed.queries : [];

  return queries
    .map((q) => String(q || "").trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(10, Number(maxQueries || 5))));
}

function normalizeCollectPayload(payload, adapter, aiQueries = []) {
  if (adapter !== "google_maps") return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const currentQueries = Array.isArray(payload.queries) ? payload.queries : [];
    const mergedQueries = [...currentQueries, ...aiQueries].map((x) => String(x || "").trim()).filter(Boolean);
    if (mergedQueries.length > 0) {
      return {
        ...payload,
        queries: Array.from(new Set(mergedQueries)),
      };
    }
    return payload;
  }

  if (aiQueries.length) {
    return {
      queries: aiQueries,
      language: "th",
      region: "th",
      max_results_per_query: 20,
    };
  }

  return payload;
}

function summarizeCollectSignals(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const summary = {
    total_items: rows.length,
    with_rating: 0,
    with_user_rating_count: 0,
    with_business_status: 0,
    with_opening_hours: 0,
    with_open_now: 0,
    with_editorial_summary: 0,
    with_review_snippets: 0,
    with_phone: 0,
    with_website: 0,
  };

  for (const row of rows) {
    const n = row?.normalized_json || {};
    if (Number.isFinite(Number(n.rating))) summary.with_rating += 1;
    if (Number.isFinite(Number(n.user_rating_count)) && Number(n.user_rating_count) > 0) summary.with_user_rating_count += 1;
    if (String(n.business_status || "").trim()) summary.with_business_status += 1;
    if (Array.isArray(n.opening_hours_weekday_text) && n.opening_hours_weekday_text.length > 0) summary.with_opening_hours += 1;
    if (typeof n.open_now === "boolean") summary.with_open_now += 1;
    if (String(n.editorial_summary || "").trim()) summary.with_editorial_summary += 1;
    if (Array.isArray(n.review_snippets) && n.review_snippets.length > 0) summary.with_review_snippets += 1;
    if (String(n.national_phone_number || n.international_phone_number || "").trim()) summary.with_phone += 1;
    if (String(n.website_url || "").trim()) summary.with_website += 1;
  }

  return summary;
}

function parseStoredJsonValue(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function hydrateRawSourceItems(batchUid, rawItemIds = []) {
  const wantedIds = new Set((Array.isArray(rawItemIds) ? rawItemIds : []).map((id) => Number(id || 0)).filter(Boolean));
  let rawRows = [];
  if (wantedIds.size) {
    rawRows = db.prepare(
      `SELECT *
       FROM source_raw_items
       WHERE batch_uid=?
         AND id IN (${Array.from(wantedIds).map(() => "?").join(",")})
       ORDER BY id DESC`
    ).all(batchUid, ...Array.from(wantedIds));
  } else {
    rawRows = repo.listRawSourceItems(batchUid, 1000);
  }

  const rows = rawRows.map((row) => ({
    ...row,
    payload_json: sanitizeGoogleMapsPhotoUrlsDeep(parseStoredJsonValue(row?.payload_json, null)),
    normalized_json: sanitizeGoogleMapsPhotoUrlsDeep(parseStoredJsonValue(row?.normalized_json, {})),
  }));

  if (!rows.length) return [];

  const mediaRows = db.prepare(
    `SELECT raw_item_id, media_url, checksum, mime_type, width, height, status, metadata_json
     FROM source_raw_media
     WHERE raw_item_id IN (${rows.map(() => "?").join(",")})
     ORDER BY id ASC`
  ).all(...rows.map((row) => Number(row.id || 0)));

  const mediaMap = new Map();
  for (const media of mediaRows) {
    const rawItemId = Number(media?.raw_item_id || 0);
    if (!mediaMap.has(rawItemId)) mediaMap.set(rawItemId, []);
    mediaMap.get(rawItemId).push({
      media_url: sanitizeGoogleMapsPhotoUrl(media?.media_url),
      checksum: String(media?.checksum || "").trim() || null,
      mime_type: String(media?.mime_type || "").trim() || null,
      width: toFiniteNumberOrNull(media?.width),
      height: toFiniteNumberOrNull(media?.height),
      status: String(media?.status || "raw").trim() || "raw",
      metadata_json: sanitizeGoogleMapsPhotoUrlsDeep(parseStoredJsonValue(media?.metadata_json, null)),
    });
  }

  return rows.map((row) => ({
    ...row,
    media: mediaMap.get(Number(row.id || 0)) || [],
  }));
}

function buildCollectedImportSeed(rawItem, adapter) {
  const normalized = parseObjectCandidate(rawItem?.normalized_json) || {};
  const title = String(normalized.title || rawItem?.title_raw || "").trim();
  const description = String(normalized.description || rawItem?.description_raw || "").trim();

  return {
    normalized,
    itemInput: {
      type: normalized.type || "place",
      category: normalized.category || "attractions",
      lang: normalized.lang || "th",
      title: title || description.slice(0, 120) || `raw-${Number(rawItem?.id || 0) || "item"}`,
      description_raw: description || title,
      description_clean: "",
      image_url: normalized.image || "",
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      map_url: normalized.map_url || "",
      google_place_id: normalized.google_place_id || "",
      source_name: normalized.source_name || adapter,
      source_url: normalized.source_url || rawItem?.source_url || "",
      source_entity_id: normalized.google_place_id || rawItem?.source_ref || "",
      payload_json: rawItem?.payload_json?.payload_json || rawItem?.payload_json || normalized || null,
      tags: Array.isArray(normalized.tags) ? normalized.tags : [],
      source_type: adapter,
    },
  };
}

function normalizeLegacyWorkflowStatus(value) {
  return String(value || "").trim().toLowerCase() || "raw";
}

function mapLegacyStatusToCanonicalStates(value) {
  const status = normalizeLegacyWorkflowStatus(value);
  if (status === "published") {
    return { production_state: "completed", publication_state: "published" };
  }
  if (status === "approved") {
    return { production_state: "ready_for_publish", publication_state: "approved" };
  }
  if (status === "reviewed") {
    return { production_state: "in_review", publication_state: "draft" };
  }
  if (status === "generated") {
    return { production_state: "generated", publication_state: "draft" };
  }
  if (status === "cleaned" || status === "analyzed") {
    return { production_state: "analyzed", publication_state: "draft" };
  }
  if (status === "needs_revision") {
    return { production_state: "needs_revision", publication_state: "draft" };
  }
  if (status === "rejected") {
    return { production_state: "rejected", publication_state: "draft" };
  }
  if (status === "content_in_progress") {
    return { production_state: "content_in_progress", publication_state: "draft" };
  }
  return { production_state: "collected", publication_state: "draft" };
}

function resolveCreateWorkflowPatch(body, fallbackLegacyStatus = "raw") {
  const payload = body && typeof body === "object" ? body : {};
  const requestedPatch = payload.workflow_patch && typeof payload.workflow_patch === "object"
    ? payload.workflow_patch
    : null;
  const legacyMapped = mapLegacyStatusToCanonicalStates(payload.workflow_status || fallbackLegacyStatus);
  const productionState = String(requestedPatch?.production_state || "").trim().toLowerCase() || legacyMapped.production_state;
  const publicationState = String(requestedPatch?.publication_state || "").trim().toLowerCase() || legacyMapped.publication_state;
  const assignmentState = String(requestedPatch?.assignment_state || "").trim().toLowerCase() || null;
  const workflowPatch = {
    production_state: productionState,
    publication_state: publicationState,
  };
  if (assignmentState) {
    workflowPatch.assignment_state = assignmentState;
  }
  return workflowPatch;
}

function attachCollectedSourceRecord(contentItemId, rawItem, adapter) {
  const normalized = parseObjectCandidate(rawItem?.normalized_json) || {};
  const payloadJson = rawItem?.payload_json?.payload_json || rawItem?.payload_json || normalized || null;
  const sourceParams = {
    content_item_id: Number(contentItemId || 0),
    source_type: String(adapter || rawItem?.source_type || "manual").trim() || "manual",
    source_name: String(normalized.source_name || adapter || rawItem?.source_type || "manual").trim() || "manual",
    source_url: String(normalized.source_url || rawItem?.source_url || "").trim() || null,
    source_entity_id: String(normalized.google_place_id || rawItem?.source_ref || "").trim() || null,
    payload_json: payloadJson == null ? null : JSON.stringify(payloadJson),
  };

  if (!sourceParams.content_item_id) return;

  if (!sourceParams.source_url) {
    db.prepare(
      `INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
       VALUES (@content_item_id, @source_type, @source_name, @source_url, @source_entity_id, @payload_json)`
    ).run(sourceParams);
    return;
  }

  const existing = db.prepare("SELECT id FROM source_records WHERE source_url=? LIMIT 1").get(sourceParams.source_url);
  if (existing) {
    db.prepare(
      `UPDATE source_records
       SET content_item_id=@content_item_id,
           source_type=@source_type,
           source_name=@source_name,
           source_entity_id=@source_entity_id,
           payload_json=@payload_json,
           updated_at=CURRENT_TIMESTAMP
       WHERE source_url=@source_url`
    ).run(sourceParams);
    return;
  }

  db.prepare(
    `INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json)
     VALUES (@content_item_id, @source_type, @source_name, @source_url, @source_entity_id, @payload_json)`
  ).run(sourceParams);
}

function importCollectedRawItem(rawItem, adapter, targetMode, targetItemId, actor) {
  const { normalized, itemInput } = buildCollectedImportSeed(rawItem, adapter);
  const mode = String(targetMode || "new").trim().toLowerCase();

  if (mode === "merge") {
    const existingItemId = Number(targetItemId || 0);
    const existingItem = repo.getItem(existingItemId);
    if (!existingItem) {
      throw new Error(`???????????????????????? merge (#${existingItemId || 0})`);
    }

    attachCollectedSourceRecord(existingItemId, rawItem, adapter);
    const sourceRecords = repo.listSourceRecordsByItem(existingItemId);
    const seeded = seedEvidenceBlocksForItem(existingItem, {
      normalized,
      sourceType: adapter,
      sourceRecords,
    });
    const referenceMediaCount = repo.listReferenceMediaByItem(existingItemId).length;

    return {
      mode: "merge",
      item: repo.getItem(existingItemId),
      seeded_evidence_count: Number(seeded?.added || 0),
      bridged_image_count: 0,
      reference_media_count: referenceMediaCount,
    };
  }

  const { item: savedItem } = repo.createItemWithWorkflowHead(
    itemInput,
    {
      production_state: "collected",
      publication_state: "draft",
      last_transition_note: "collected import item created",
    },
    actor,
    {
      actor_role: "system",
      reason_code: "collect_import_created",
      bump_state_version: true,
    }
  );
  const sourceRecords = repo.listSourceRecordsByItem(savedItem.id);
  const seeded = seedEvidenceBlocksForItem(savedItem, {
    normalized,
    sourceType: adapter,
    sourceRecords,
  });
  const referenceMediaCount = repo.listReferenceMediaByItem(savedItem.id).length;

  return {
    mode: "new",
    item: savedItem,
    seeded_evidence_count: Number(seeded?.added || 0),
    bridged_image_count: 0,
    reference_media_count: referenceMediaCount,
  };
}

function importCollectedRawItemsTxn(payloads) {
  db.exec("BEGIN IMMEDIATE");
  try {
  let importedCount = 0;
  let mergedCount = 0;
  let skippedCount = 0;
  let seededEvidenceCount = 0;
  let bridgedImageCount = 0;
  let referenceMediaCount = 0;
  const results = [];

  for (const payload of payloads) {
    const rawItemId = Number(payload?.rawItem?.id || 0);
    const mode = String(payload?.mode || "skip").trim().toLowerCase();
    if (!rawItemId) continue;

    if (mode === "skip") {
      skippedCount += 1;
      results.push({ raw_item_id: rawItemId, decision: "skip" });
      continue;
    }

    const imported = importCollectedRawItem(
      payload.rawItem,
      payload.adapter,
      mode,
      payload.targetItemId,
      payload.actor
    );

    importedCount += 1;
    if (imported.mode === "merge") mergedCount += 1;
    seededEvidenceCount += Number(imported.seeded_evidence_count || 0);
    bridgedImageCount += Number(imported.bridged_image_count || 0);
    referenceMediaCount += Number(imported.reference_media_count || 0);
    results.push({
      raw_item_id: rawItemId,
      decision: imported.mode,
      item_id: Number(imported.item?.id || 0) || null,
      item_title: imported.item?.title || "",
    });
  }

    const summary = {
      imported_count: importedCount,
      merged_count: mergedCount,
      new_count: importedCount - mergedCount,
      skipped_count: skippedCount,
      seeded_evidence_count: seededEvidenceCount,
      bridged_image_count: bridgedImageCount,
      reference_media_count: referenceMediaCount,
      results,
    };
    db.exec("COMMIT");
    return summary;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const EVIDENCE_SOURCE_TYPES = new Set(["manual", "google_maps", "google_search", "editor", "import", "future_social"]);

function normalizeEvidenceSourceType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (EVIDENCE_SOURCE_TYPES.has(raw)) return raw;
  if (raw.includes("custom search")) return "google_search";
  if (raw.includes("google_search") || raw.includes("google search")) return "google_search";
  if (raw.includes("google")) return "google_maps";
  if (!raw || raw === "system" || raw === "collector") return "import";
  return "import";
}

function toFiniteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseObjectCandidate(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

function buildNormalizedFromExtractedPayload(payload = {}, sourceRecord = null) {
  const extractedMetadata = parseObjectCandidate(payload?.extracted_metadata)
    || parseObjectCandidate(payload?.payload_json?.extracted_metadata)
    || {};
  const extractedArticle = parseObjectCandidate(payload?.extracted_article)
    || parseObjectCandidate(payload?.payload_json?.extracted_article)
    || {};
  const extractedReviews = parseObjectCandidate(payload?.extracted_reviews)
    || parseObjectCandidate(payload?.payload_json?.extracted_reviews)
    || {};

  const sectionTexts = Array.isArray(extractedArticle?.section_texts)
    ? extractedArticle.section_texts.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const reviewItems = Array.isArray(extractedReviews?.items)
    ? extractedReviews.items
    : [];
  const reviewSnippets = reviewItems
    .map((row) => ({
      text: String(row?.text || "").trim(),
      rating: toFiniteNumberOrNull(row?.rating),
      author: String(row?.author || "").trim() || null,
      relative_time: String(row?.relative_time || "").trim() || null,
    }))
    .filter((row) => row.text)
    .slice(0, 5);

  const openingHours = Array.isArray(extractedMetadata?.opening_hours)
    ? extractedMetadata.opening_hours.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const sourceUrl = String(payload?.submitted_url || payload?.fetched_url || sourceRecord?.source_url || "").trim();
  const sourceName = String(extractedMetadata?.source_name || payload?.hostname || sourceRecord?.source_name || "").trim();
  const excerpt = String(extractedArticle?.excerpt || extractedMetadata?.description || "").trim();
  const bodyText = String(extractedArticle?.body_text || "").trim();

  const candidate = {
    type: "place",
    category: String(extractedMetadata?.category || "").trim(),
    lang: "th",
    title: String(extractedMetadata?.title || extractedArticle?.headline || "").trim(),
    description: excerpt || "",
    source_url: sourceUrl,
    source_name: sourceName,
    image: String(extractedMetadata?.image || "").trim(),
    address: String(extractedMetadata?.address || "").trim(),
    latitude: extractedMetadata?.latitude ?? null,
    longitude: extractedMetadata?.longitude ?? null,
    rating: extractedMetadata?.rating ?? null,
    review_count: extractedMetadata?.review_count ?? null,
    opening_hours_weekday_text: openingHours,
    service_facts: Array.isArray(extractedMetadata?.service_facts) ? extractedMetadata.service_facts : [],
    price_signals: Array.isArray(extractedMetadata?.price_signals) ? extractedMetadata.price_signals : [],
    menu_sections: Array.isArray(extractedMetadata?.menu_sections) ? extractedMetadata.menu_sections : [],
    menu_highlights: Array.isArray(extractedMetadata?.menu_highlights) ? extractedMetadata.menu_highlights : [],
    editorial_summary: excerpt || "",
    review_snippets: reviewSnippets,
    article_body_text: bodyText,
    article_section_texts: sectionTexts,
    article_page_title: String(extractedArticle?.page_title || "").trim(),
  };

  if (
    !candidate.title &&
    !candidate.description &&
    !candidate.image &&
    !candidate.address &&
    !candidate.article_body_text &&
    !candidate.article_section_texts.length &&
    !candidate.review_snippets.length
  ) {
    return null;
  }
  return candidate;
}

function pickNormalizedFromSourceRecords(sourceRecords = []) {
  for (const row of sourceRecords) {
    const payload = parseObjectCandidate(row?.payload_json);
    if (!payload) continue;
    const normalized = parseObjectCandidate(payload?.normalized_json)
      || parseObjectCandidate(payload?.payload_json?.normalized_json);
    if (normalized) return normalized;
    const extractedNormalized = buildNormalizedFromExtractedPayload(payload, row);
    if (extractedNormalized) return extractedNormalized;
  }
  return null;
}

function buildFallbackNormalizedFromItem(item) {
  return {
    type: String(item?.type || "place").trim() || "place",
    category: String(item?.category || "").trim(),
    lang: String(item?.lang || "th").trim().toLowerCase() || "th",
    title: String(item?.title || "").trim(),
    description: String(item?.description_raw || "").trim(),
    map_url: String(item?.map_url || "").trim(),
    source_url: String(item?.source_url || "").trim(),
    source_name: String(item?.source_name || "").trim(),
    google_place_id: String(item?.google_place_id || "").trim(),
    latitude: item?.latitude ?? null,
    longitude: item?.longitude ?? null,
    image: String(item?.image_url || "").trim(),
  };
}

function normalizeEnum(value, allowed) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return allowed.has(normalized) ? normalized : "";
}

function makeEvidenceSignature(block = {}) {
  const listValue = Array.isArray(block.list_value)
    ? block.list_value.map((x) => String(x)).filter(Boolean)
    : [];
  return [
    String(block.block_type || "").trim().toLowerCase(),
    String(block.source_type || "").trim().toLowerCase(),
    String(block.source_url || "").trim(),
    String(block.text_value || "").trim(),
    block.numeric_value == null ? "" : String(block.numeric_value),
    JSON.stringify(listValue),
  ].join("|");
}

function pushEvidenceCandidate(out, payload = {}) {
  const textValue = String(payload.text_value || "").trim();
  const numericValue = payload.numeric_value == null ? null : toFiniteNumberOrNull(payload.numeric_value);
  const listValue = Array.isArray(payload.list_value) ? payload.list_value.map((x) => String(x)).filter(Boolean) : [];
  if (!textValue && numericValue == null && listValue.length === 0) return;
  out.push({
    ...payload,
    text_value: textValue || null,
    numeric_value: numericValue,
    list_value: listValue,
  });
}

function buildEvidenceCandidatesForNormalized(normalized = {}, base = {}) {
  const out = [];
  const title = String(normalized.title || normalized.name || "").trim();
  const description = String(normalized.description || "").trim();
  const category = String(normalized.category || "").trim();
  const type = String(normalized.type || "").trim();
  const mapUrl = String(normalized.map_url || "").trim();
  const sourceUrl = String(normalized.source_url || base.source_url || "").trim();
  const address = String(
    normalized.formatted_address
    || normalized.short_formatted_address
    || normalized.address
    || normalized.vicinity
    || ""
  ).trim();
  const editorialSummary = String(normalized.editorial_summary || "").trim();
  const businessStatus = String(normalized.business_status || "").trim();
  const website = String(normalized.website_url || "").trim();
  const phone = String(normalized.national_phone_number || normalized.international_phone_number || "").trim();
  const primaryTypeName = String(normalized.primary_type_display_name || "").trim();
  const imageUrl = String(normalized.image || "").trim();
  const rating = toFiniteNumberOrNull(normalized.rating);
  const userRatingCount = toFiniteNumberOrNull(normalized.user_rating_count ?? normalized.review_count);
  const articleBodyText = String(normalized.article_body_text || "").trim();
  const articleSections = Array.isArray(normalized.article_section_texts)
    ? normalized.article_section_texts.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "fact",
    text_value: title ? `Name: ${title}` : null,
    payload_json: { field: "title", value: title || null },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "fact",
    text_value: description || null,
    payload_json: { field: "description", value: description || null },
  });

  if (category || type || primaryTypeName) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "fact",
      text_value: "Place classification",
      list_value: [category && `category=${category}`, type && `type=${type}`, primaryTypeName && `primary_type=${primaryTypeName}`].filter(Boolean),
      payload_json: { field: "classification" },
    });
  }

  if (address || mapUrl || sourceUrl) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "fact",
      text_value: address || "Location link available",
      list_value: [mapUrl && `map_url=${mapUrl}`, sourceUrl && `source_url=${sourceUrl}`].filter(Boolean),
      payload_json: { field: "location" },
    });
  }

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "social_proof",
    text_value: rating == null ? null : "Rating signal",
    numeric_value: rating,
    payload_json: { field: "rating", value: rating },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "social_proof",
    text_value: userRatingCount == null ? null : "Review count signal",
    numeric_value: userRatingCount,
    payload_json: { field: "user_rating_count", value: userRatingCount },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "fact",
    text_value: businessStatus ? `Business status: ${businessStatus}` : null,
    payload_json: { field: "business_status", value: businessStatus || null },
  });

  if (typeof normalized.open_now === "boolean") {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "social_proof",
      text_value: `Open now: ${normalized.open_now ? "yes" : "no"}`,
      list_value: [`open_now=${normalized.open_now ? "true" : "false"}`],
      payload_json: { field: "open_now", value: normalized.open_now },
    });
  }

  if (Array.isArray(normalized.opening_hours_weekday_text) && normalized.opening_hours_weekday_text.length > 0) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "fact",
      text_value: "Opening hours",
      list_value: normalized.opening_hours_weekday_text,
      payload_json: { field: "opening_hours_weekday_text" },
    });
  }

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "mention",
    text_value: editorialSummary || null,
    payload_json: { field: "editorial_summary", value: editorialSummary || null },
  });

  if (Array.isArray(normalized.review_snippets)) {
    for (const snippet of normalized.review_snippets.slice(0, 3)) {
      const text = String(snippet?.text || "").trim();
      if (!text) continue;
      pushEvidenceCandidate(out, {
        ...base,
        block_type: "review_snippet",
        text_value: text,
        numeric_value: toFiniteNumberOrNull(snippet?.rating),
        payload_json: { field: "review_snippet", snippet },
      });
    }
  }

  for (const section of articleSections.slice(0, 5)) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "mention",
      text_value: section,
      payload_json: { field: "article_section", value: section },
    });
  }

  if (!articleSections.length) {
    pushEvidenceCandidate(out, {
      ...base,
      block_type: "mention",
      text_value: articleBodyText || null,
      payload_json: articleBodyText ? { field: "article_body_text", value: articleBodyText } : null,
    });
  }

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "mention",
    text_value: website ? `Website: ${website}` : null,
    payload_json: { field: "website_url", value: website || null },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "mention",
    text_value: phone ? `Phone: ${phone}` : null,
    payload_json: { field: "phone", value: phone || null },
  });

  pushEvidenceCandidate(out, {
    ...base,
    block_type: "media",
    text_value: imageUrl || null,
    payload_json: imageUrl ? { field: "image", media_url: imageUrl } : null,
  });

  return out;
}

function seedEvidenceBlocksForItem(item, options = {}) {
  const contentItemId = Number(item?.id || 0);
  if (!contentItemId) return { added: 0, skipped: 0, total_candidates: 0 };

  const sourceRecords = Array.isArray(options.sourceRecords)
    ? options.sourceRecords
    : repo.listSourceRecordsByItem(contentItemId);
  const normalized = parseObjectCandidate(options.normalized)
    || pickNormalizedFromSourceRecords(sourceRecords)
    || buildFallbackNormalizedFromItem(item);

  const sourceRecord = sourceRecords[0] || null;
  const base = {
    source_type: normalizeEvidenceSourceType(options.sourceType || sourceRecord?.source_type || item?.source_type || "import"),
    source_record_type: sourceRecord ? "source_records" : null,
    source_record_id: sourceRecord ? String(sourceRecord.id || "") : null,
    source_url: String(normalized.source_url || sourceRecord?.source_url || item?.source_url || "").trim() || null,
    source_label: String(normalized.source_name || sourceRecord?.source_name || item?.source_name || "").trim() || null,
    lang: String(normalized.lang || item?.lang || "th").trim().toLowerCase() || "th",
    attribution_text: "Collected source signal",
    status: "active",
  };

  const existing = repo.listEvidenceBlocks(contentItemId);
  const seen = new Set(existing.map((row) => makeEvidenceSignature({
    block_type: row.block_type,
    source_type: row.source_type,
    source_url: row.source_url,
    text_value: row.text_value,
    numeric_value: row.numeric_value,
    list_value: Array.isArray(row.list_value_json) ? row.list_value_json : [],
  })));

  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  let added = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const signature = makeEvidenceSignature(candidate);
    if (seen.has(signature)) {
      skipped += 1;
      continue;
    }
    repo.addEvidenceBlock(contentItemId, candidate);
    seen.add(signature);
    added += 1;
  }

  return { added, skipped, total_candidates: candidates.length };
}

function parseTargetLangs() {
  const raw = String(process.env.TRANSLATION_TARGET_LANGS || "en,zh,lo").trim();
  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function isTranslationTechnicalReady(row, currentSourceFingerprint = "") {
  return isWorkflowTranslationTechnicalReady(row, currentSourceFingerprint);
}

function isTranslationRecheckPassed(row, currentSourceFingerprint = "") {
  return isWorkflowTranslationRecheckPassed(row, currentSourceFingerprint);
}

function getRequiredTranslationRecheckBlockers(contentItemId, readiness = null) {
  const exportReadiness = readiness || buildExportReadiness(contentItemId);
  const item = repo.getItem(contentItemId) || null;
  const sourceLang = String(item?.lang || "th").trim().toLowerCase() || "th";
  const requiredLocales = parseTargetLangs().filter((lang) => lang !== sourceLang);
  const liveTranslationRows = repo.listTranslations(contentItemId);
  const currentSourceFingerprint = String(
    exportReadiness?.current_source_fingerprint
    || getCurrentTranslationSourceFingerprint(repo, contentItemId)
    || ""
  ).trim();
  const liveByLang = new Map(
    liveTranslationRows.map((row) => [String(row?.lang || "").trim().toLowerCase(), row]),
  );
  const blockers = requiredLocales.map((lang) => {
    const live = liveByLang.get(lang);
    if (!lang) return null;
    if (!live) {
      return { lang, reason: "missing translation" };
    }
    if (isWorkflowTranslationRowStale(live, currentSourceFingerprint)) {
      return { lang, reason: "translation is stale" };
    }
    if (String(live?.translation_status || "").trim().toLowerCase() !== "ready") {
      return { lang, reason: "translation is missing or not ready" };
    }
    if (String(live?.automatic_check_status || "").trim().toLowerCase() !== "passed") {
      return { lang, reason: "technical QA must pass first" };
    }
    if (String(live?.translation_recheck_status || "").trim().toLowerCase() !== "passed") {
      return {
        lang,
        reason: `translation recheck is not passed (${String(live?.translation_recheck_status || "not_checked").trim().toLowerCase() || "not_checked"})`,
      };
    }
    if (!isTranslationRecheckPassed(live, currentSourceFingerprint)) {
      return { lang, reason: "translation recheck gate is not satisfied" };
    }
    return null;
  }).filter(Boolean);

  return {
    required_locales: requiredLocales,
    blockers,
    blocking_langs: blockers.map((row) => String(row?.lang || "").trim().toUpperCase()).filter(Boolean),
    blocking: blockers.length > 0,
  };
}

function buildExportReadiness(contentItemId) {
  const isDebugDiagnosticsEnabled = String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
  const item = repo.getItem(contentItemId);
  if (!item) return null;

  const image = repo.getImageWorkflowStatus(contentItemId);
  const publishableSource = repo.buildPublishableSourceByItem(contentItemId);
  const body = String(item.description_clean || item.description_raw || "").trim();
  const metaTitle = String(item.meta_title || "").trim();
  const metaDesc = String(item.meta_description || "").trim();
  const slug = String(item.slug || "").trim();
  const eventPeriodText = String(item.event_period_text || "").trim();
  const locationText = String(item.location_text || "").trim();
  const isEventItem = String(item.type || "").trim().toLowerCase() === "event";
  const latestDraft = repo.latestDraftByItem(contentItemId);
  const latestReview = repo.latestReviewByItem(contentItemId);
  const latestApprovedReview = repo.latestApprovedReviewByItem(contentItemId);
  const workflowModel = repo.ensureWorkflowModel(contentItemId);
  const productionState = String(workflowModel?.production_state || "").trim().toLowerCase();
  const publicationState = String(workflowModel?.publication_state || "").trim().toLowerCase();
  const isApprovedForAdminReview =
    publicationState === "approved"
    && (productionState === "ready_for_publish" || productionState === "submitted_for_admin_review");

  const sourceIssues = [];
  if (!image.local_cover_count) sourceIssues.push("Missing local cover image");
  if (!image.local_selected_count) sourceIssues.push("Select at least 1 local image");
  if (!body) sourceIssues.push("Missing body content");
  if (!metaTitle) sourceIssues.push("Missing meta title");
  if (!metaDesc) sourceIssues.push("Missing meta description");
  if (!slug) sourceIssues.push("Missing slug");
  if (isEventItem && !eventPeriodText) sourceIssues.push("Missing event period text");
  if (isEventItem && !locationText) sourceIssues.push("Missing location text");

  const editorialIssues = [];
  if (!latestDraft?.id) editorialIssues.push("Missing latest draft");
  if (!latestReview?.id) editorialIssues.push("Missing review report");
  if (!latestApprovedReview?.id) editorialIssues.push("Missing approved review");
  if (latestReview?.id && latestApprovedReview?.id && Number(latestReview.id) !== Number(latestApprovedReview.id)) {
    editorialIssues.push("Approved review is stale");
  }
  if (latestDraft?.id && latestApprovedReview?.draft_id && Number(latestApprovedReview.draft_id) !== Number(latestDraft.id)) {
    editorialIssues.push("Approved review is not for latest draft");
  }
  if (!isApprovedForAdminReview) editorialIssues.push("Production state must be ready_for_publish or submitted_for_admin_review");
  if (publicationState !== "approved") editorialIssues.push("Publication state must be approved");

  const fieldFlowIssues = Array.isArray(publishableSource?.issues) ? [...publishableSource.issues] : [];
  if (publicationState !== "approved") fieldFlowIssues.push("Publication state must be approved");

  const targetLangs = parseTargetLangs().filter((lang) => lang !== String(item.lang || "th").toLowerCase());
  const rows = repo.listTranslations(contentItemId);
  const currentSourceFingerprint = getCurrentTranslationSourceFingerprint(repo, contentItemId);
  const translationByLang = new Map(rows.map((row) => [String(row.lang || "").toLowerCase(), row]));

  const translations = targetLangs.map((lang) => {
    const row = translationByLang.get(lang);
    if (!row) return { lang, status: "not_ready" };

    if (isWorkflowTranslationRowStale(row, currentSourceFingerprint)) {
      return { lang, status: "stale" };
    }
    if (String(row.translation_status || "") === "ready" && String(row.automatic_check_status || "") === "passed") {
      return { lang, status: "passed" };
    }
    if (String(row.translation_status || "") === "failed" || String(row.translation_status || "") === "check_failed" || String(row.automatic_check_status || "") === "failed") {
      return { lang, status: "failed" };
    }
    return { lang, status: "not_ready" };
  });

  const counts = {
    passed: translations.filter((x) => x.status === "passed").length,
    failed: translations.filter((x) => x.status === "failed").length,
    stale: translations.filter((x) => x.status === "stale").length,
    not_ready: translations.filter((x) => x.status === "not_ready").length,
    total: translations.length,
  };

  const translationRecheckCounts = {
    passed: rows.filter((row) => isTranslationRecheckPassed(row, currentSourceFingerprint)).length,
    warning: rows.filter((row) => String(row?.translation_recheck_status || "").trim().toLowerCase() === "warning").length,
    failed: rows.filter((row) => String(row?.translation_recheck_status || "").trim().toLowerCase() === "failed").length,
    stale: rows.filter((row) => isWorkflowTranslationRowStale(row, currentSourceFingerprint)).length,
    not_checked: rows.filter((row) =>
      !isWorkflowTranslationRowStale(row, currentSourceFingerprint)
      && (!String(row?.translation_recheck_status || "").trim() || String(row?.translation_recheck_status || "").trim().toLowerCase() === "not_checked")
    ).length,
  };

  return {
    content_item_id: contentItemId,
    current_source_fingerprint: currentSourceFingerprint,
    source_ready: sourceIssues.length === 0,
    source_issues: sourceIssues,
    editorial_ready: editorialIssues.length === 0,
    editorial_issues: editorialIssues,
    field_flow_ready: fieldFlowIssues.length === 0 && Boolean(publishableSource?.ready_for_publish_source),
    field_flow_issues: fieldFlowIssues,
    source_checks: {
      has_cover: image.cover_count > 0,
      has_local_cover: image.local_cover_count > 0,
      has_local_selected_image: image.local_selected_count > 0,
      has_selected_image: image.selected_count > 0,
      has_body: Boolean(body),
      has_meta_title: Boolean(metaTitle),
      has_meta_description: Boolean(metaDesc),
      has_slug: Boolean(slug),
      has_event_period_text: isEventItem ? Boolean(eventPeriodText) : null,
      has_location_text: isEventItem ? Boolean(locationText) : null,
    },
    editorial_checks: {
      has_latest_draft: Boolean(latestDraft?.id),
      has_review_report: Boolean(latestReview?.id),
      has_approved_review: Boolean(latestApprovedReview?.id),
      approved_review_matches_latest_review:
        Boolean(latestReview?.id)
        && Boolean(latestApprovedReview?.id)
        && Number(latestReview.id) === Number(latestApprovedReview.id),
      approved_review_matches_latest_draft:
        Boolean(latestDraft?.id)
        && Boolean(latestApprovedReview?.draft_id)
        && Number(latestApprovedReview.draft_id) === Number(latestDraft.id),
      production_state_ready_for_publish: isApprovedForAdminReview,
      publication_state_approved: publicationState === "approved",
    },
    field_flow_checks: {
      has_current_field_pack: Boolean(publishableSource?.checks?.has_current_field_pack),
      has_assignment: Boolean(publishableSource?.checks?.has_assignment),
      assignment_accepted: Boolean(publishableSource?.checks?.assignment_accepted),
      has_latest_submission: Boolean(publishableSource?.checks?.has_latest_submission),
      has_article_draft_deliverable: Boolean(publishableSource?.checks?.has_article_draft_deliverable),
      has_article_draft_content: Boolean(publishableSource?.checks?.has_article_draft_content),
      deliverables_review_usable: Boolean(publishableSource?.checks?.deliverables_review_usable),
      publication_state_approved: publicationState === "approved",
    },
    publishable_source: publishableSource?.source || null,
    publishable_source_debug: isDebugDiagnosticsEnabled ? (publishableSource?.debug || null) : undefined,
    publishable_article_preview: publishableSource?.resolved_article
      ? {
        title: publishableSource.resolved_article.title,
        excerpt: publishableSource.resolved_article.excerpt,
        body_length: String(publishableSource.resolved_article.body || "").length,
        meta_title: publishableSource.resolved_article.meta_title,
        meta_description: publishableSource.resolved_article.meta_description,
      }
      : null,
    translation_counts: counts,
    translation_recheck_counts: translationRecheckCounts,
    translations,
  };
}

function buildImageWorkflowState(contentItemId) {
  return repo.getImageWorkflowStatus(contentItemId);
}

function parsePositiveEnvInt(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const isDevelopmentEnv = String(process.env.NODE_ENV || "development").toLowerCase() === "development";
const loginRateLimitWindowMs = parsePositiveEnvInt(
  process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const loginRateLimitMax = parsePositiveEnvInt(
  process.env.LOGIN_RATE_LIMIT_MAX,
  isDevelopmentEnv ? 30 : 10
);

const loginRateLimit = createRateLimiter({
  windowMs: loginRateLimitWindowMs,
  max: loginRateLimitMax,
  keyBy: "ip",
  message: "Too many login attempts. Try again later.",
});

const workflowRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyBy: "user",
  message: "Workflow rate limit exceeded",
});

const uploadRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
  keyBy: "user",
  message: "Upload rate limit exceeded",
});
const assignmentChunkUploadRateLimit = createRateLimiter({
  windowMs: 12 * 60 * 60 * 1000,
  max: 2500,
  keyBy: "user",
  message: "Assignment chunk upload rate limit exceeded",
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "collector-app" });
});

app.get("/api/integrations/readiness", (_req, res) => {
  const readiness = getCollectorIntegrationReadiness(collectorIntegrationConfig());
  res.status(readiness.ok ? 200 : 503).json(readiness);
});

function isInternalStaffRoleForLoginSync(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "user";
}

function isDirectorySyncStale(lastSyncedAt, nowMs, thresholdMs = 60000) {
  const normalized = String(lastSyncedAt || "").trim();
  if (!normalized) return true;
  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) return true;
  const deltaMs = Number(nowMs || Date.now()) - parsedMs;
  return deltaMs > Number(thresholdMs || 60000);
}

app.post("/api/auth/login", loginRateLimit, safeAsync(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const backendLogin = await authenticateViaBackendLogin(email, password);
  if (backendLogin.ok) {
    const role = String(backendLogin.user?.role || "").trim().toLowerCase();
    if (isInternalStaffRoleForLoginSync(role)) {
      let lastSyncedAt = null;
      try {
        lastSyncedAt = readCollectorDirectoryLastSyncedAt();
        if (isDirectorySyncStale(lastSyncedAt, Date.now(), 60000)) {
          const syncResult = await syncCollectorUsersFromBackendDirectory(backendLogin.token);
          if (!syncResult?.ok) {
            repo.logAudit(email, "auth.login.backend_directory_sync_failed", "user", String(backendLogin.user.id), {
              role,
              status: Number(syncResult?.status || 0) || null,
              error: String(syncResult?.error || "directory sync failed"),
              last_synced_at: lastSyncedAt || null,
            });
          } else {
            const createdCount = Number(syncResult?.createdCount || 0) || 0;
            const updatedCount = Number(syncResult?.updatedCount || 0) || 0;
            const deactivatedCount = Number(syncResult?.deactivatedCount || 0) || 0;
            if (createdCount > 0 || updatedCount > 0 || deactivatedCount > 0) {
              repo.logAudit(email, "auth.login.backend_directory_sync", "user", String(backendLogin.user.id), {
                role,
                created_count: createdCount,
                updated_count: updatedCount,
                deactivated_count: deactivatedCount,
                synced_backend_user_count: Number(syncResult?.syncedBackendUserCount || 0) || 0,
                last_synced_at: String(syncResult?.lastSyncedAt || "").trim() || null,
              });
            }
          }
        }
      } catch (error) {
        repo.logAudit(email, "auth.login.backend_directory_sync_failed", "user", String(backendLogin.user.id), {
          role,
          error: String(error?.message || "directory sync exception"),
          last_synced_at: lastSyncedAt || null,
        });
      }
    }

    repo.logAudit(email, "auth.login.backend", "user", String(backendLogin.user.id), {
      backend_user_id: Number(backendLogin.user.backend_user_id || 0) || null,
      auth_source: "backend",
    });
    res.json({
      token: backendLogin.token,
      user: {
        id: backendLogin.user.id,
        email: backendLogin.user.email,
        display_name: backendLogin.user.display_name,
        role: backendLogin.user.role,
        auth_source: "backend",
      },
    });
    return;
  }

  repo.logAudit(email, "auth.login.backend_failed", "user", null, {
    status: backendLogin.status,
    error: backendLogin.error,
  });
  res.status(backendLogin.status || 503).json({ error: backendLogin.error || "Backend auth failed" });
}));

app.use("/api/mcp-chatgpt-test", createCollectorMcpPublicTestRouter({
  repo,
}));

app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login" || req.path === "/web-review-feedback") {
    next();
    return;
  }
  requireAuth(req, res, () => {
    const role = String(req.authUser?.role || "").toLowerCase();
    if (role !== "freelance") {
      next();
      return;
    }
    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || "");
    const allowed =
      (method === "GET" && (path === "/auth/me" || path === "/assignments/mine")) ||
      (method === "POST" && path === "/auth/logout") ||
      (method === "GET" && /^\/assignments\/\d+$/.test(path)) ||
      (method === "GET" && /^\/assignments\/\d+\/draft$/.test(path)) ||
      (method === "PUT" && /^\/assignments\/\d+\/draft$/.test(path)) ||
      (method === "DELETE" && /^\/assignments\/\d+\/draft$/.test(path)) ||
      (method === "POST" && /^\/assignments\/\d+\/submissions$/.test(path)) ||
      (method === "GET" && /^\/assignments\/\d+\/submissions$/.test(path)) ||
      (method === "GET" && /^\/assignments\/\d+\/deliverables\/latest-bundle$/.test(path)) ||
      (method === "GET" && /^\/assignments\/\d+\/submissions\/\d+\/deliverables$/.test(path)) ||
      (method === "POST" && /^\/assignments\/\d+\/submissions\/\d+\/deliverables$/.test(path)) ||
      (method === "POST" && /^\/assignments\/\d+\/assets\/upload$/.test(path));
    const briefItemMatch =
      path.match(/^\/items\/(\d+)\/field-pack\/current$/);
    const assetItemId = Number(req.query?.content_item_id || 0);
    const briefAssetsAllowed =
      method === "GET"
      && path === "/assets"
      && assetItemId > 0
      && hasItemBriefAccess(req, assetItemId, actorPolicyRole(req));
    const briefItemAllowed =
      method === "GET"
      && briefItemMatch
      && hasItemBriefAccess(req, Number(briefItemMatch[1] || 0), actorPolicyRole(req));
    if (!allowed) {
      if (briefItemAllowed || briefAssetsAllowed) {
        next();
        return;
      }
      res.status(403).json({ error: "freelance access is limited to assigned submissions" });
      return;
    }
    next();
  });
});

app.use("/api/v2/transport", createTransportV2Router({
  db,
  dirs,
  logAudit: (...args) => repo.logAudit(...args),
  getAiConfig: () => getEffectiveAiConfig(),
}));
app.use("/api/mcp", createCollectorMcpRouter({
  repo,
  requireRole,
}));

app.post("/api/auth/logout", (req, res) => {
  repo.logAudit(actorEmail(req), "auth.logout", "user", req.authUser ? String(req.authUser.id) : null, null);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.authUser });
});

app.get("/api/admin/runtime-diagnostics", requireRole("owner"), (_req, res) => {
  res.json({
    ok: true,
    runtime: readCollectorRuntimeDiagnosticSnapshot(),
  });
});

app.get("/api/admin/assignment-health", requireRole("owner"), safeAsync(async (req, res) => {
  const targetEmail = String(req.query?.email || "").trim().toLowerCase();
  if (!targetEmail) {
    res.status(400).json({ error: "email query is required" });
    return;
  }

  const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 20) || 20));
  const syncBackendDirectory = String(req.query?.sync_backend || req.query?.sync || "").trim() === "1";
  const issueHints = [];

  let syncResult = {
    attempted: false,
    ok: null,
    status: null,
    error: null,
    synced_backend_user_count: 0,
  };

  if (syncBackendDirectory) {
    const authHeader = String(req.header("authorization") || "");
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const backendSync = await syncCollectorUsersFromBackendDirectory(token);
    syncResult = {
      attempted: true,
      ok: Boolean(backendSync?.ok),
      status: Number(backendSync?.status || 0) || null,
      error: backendSync?.error ? String(backendSync.error) : null,
      synced_backend_user_count: Array.isArray(backendSync?.backendUserIds) ? backendSync.backendUserIds.length : 0,
    };
    if (!backendSync?.ok) {
      issueHints.push("backend_directory_sync_failed");
    }
  }

  const targetRow = db
    .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role, created_at, updated_at FROM users WHERE lower(email)=lower(?) LIMIT 1")
    .get(targetEmail);

  if (!targetRow) {
    issueHints.push("local_user_not_found");
    res.json({
      ok: true,
      query: {
        email: targetEmail,
        limit,
        sync_backend: syncBackendDirectory,
      },
      sync_backend_directory: syncResult,
      target: null,
      assignments: {
        internal_by_assignee_user_id: [],
        external_by_assignee_contact: listAssignmentRowsByExternalContact(targetEmail, limit),
        actionable_preview_for_user: [],
        submitted_preview_for_user: [],
      },
      issue_hints: issueHints,
    });
    return;
  }

  const targetUserId = Number(targetRow.id || 0) || 0;
  const targetManagedByUserId = Number(targetRow.managed_by_user_id || 0) || null;
  const targetAuthSync = readUserAuthSyncProjection(targetRow.profile_json);

  const managerLocalRow = targetManagedByUserId
    ? db.prepare("SELECT id, email, display_name, role, managed_by_user_id, profile_json FROM users WHERE id=? LIMIT 1").get(targetManagedByUserId)
    : null;
  const managerLocalProjectedBackendUserId = managerLocalRow
    ? extractProjectedBackendUserId(managerLocalRow.profile_json) || null
    : null;
  const managerProjectionCandidates = targetAuthSync.manager_backend_user_id
    ? listLocalUsersByProjectedBackendUserId(targetAuthSync.manager_backend_user_id)
    : [];
  const projectedManagerLocalUser = targetAuthSync.manager_backend_user_id
    ? findLocalUserByProjectedBackendUserId(targetAuthSync.manager_backend_user_id)
    : null;

  if (!targetAuthSync.backend_user_id) {
    issueHints.push("target_user_missing_backend_projection");
  }
  if (targetAuthSync.manager_backend_user_id && !targetManagedByUserId) {
    issueHints.push("target_user_missing_managed_by_user_id");
  }
  if (targetAuthSync.manager_backend_user_id && targetManagedByUserId && !managerLocalRow) {
    issueHints.push("managed_by_user_not_found");
  }
  if (targetAuthSync.manager_backend_user_id && targetManagedByUserId && managerLocalProjectedBackendUserId
    && managerLocalProjectedBackendUserId !== targetAuthSync.manager_backend_user_id) {
    issueHints.push("managed_by_user_backend_projection_mismatch");
  }
  if (targetAuthSync.manager_backend_user_id && !projectedManagerLocalUser) {
    issueHints.push("projected_manager_local_user_not_found");
  }
  if (managerProjectionCandidates.length > 1) {
    issueHints.push("projected_manager_local_user_ambiguous");
  }

  const internalMatches = listAssignmentRowsByAssigneeUserId(targetUserId, limit);
  const externalMatches = listAssignmentRowsByExternalContact(targetEmail, limit);
  const actionablePreview = buildActionableAssignmentsForActor(targetUserId, limit)
    .map(normalizeAssignmentHealthRow)
    .filter(Boolean);
  const submittedPreview = buildSubmittedAssignmentsForActor(targetUserId, limit)
    .map(normalizeAssignmentHealthRow)
    .filter(Boolean);

  if (!internalMatches.length && externalMatches.length > 0) {
    issueHints.push("assignments_found_only_as_external_contact");
  }
  if (internalMatches.length > 0 && !actionablePreview.length && !submittedPreview.length) {
    issueHints.push("internal_assignments_exist_but_not_in_actionable_or_submitted_scopes");
  }

  res.json({
    ok: true,
    query: {
      email: targetEmail,
      limit,
      sync_backend: syncBackendDirectory,
    },
    sync_backend_directory: syncResult,
    target: {
      requested_email: targetEmail,
      local_user: stripUserSecret(targetRow),
      auth_projection: targetAuthSync,
      managed_by_user: managerLocalRow
        ? {
            id: Number(managerLocalRow.id || 0) || null,
            email: String(managerLocalRow.email || "").trim().toLowerCase() || null,
            display_name: String(managerLocalRow.display_name || "").trim() || null,
            role: String(managerLocalRow.role || "").trim().toLowerCase() || null,
            projected_backend_user_id: managerLocalProjectedBackendUserId,
          }
        : null,
      projected_manager_local_user_candidates: managerProjectionCandidates,
      projected_manager_local_user: projectedManagerLocalUser,
    },
    assignments: {
      internal_by_assignee_user_id: internalMatches,
      external_by_assignee_contact: externalMatches,
      actionable_preview_for_user: actionablePreview,
      submitted_preview_for_user: submittedPreview,
    },
    issue_hints: issueHints,
  });
}));

function rejectLegacyLifecycleMutation(req, res, action, details = null) {
  repo.logAudit(actorEmail(req), action, "user", null, {
    reason: "collector_lifecycle_mutation_disabled",
    method: req.method,
    path: req.originalUrl || req.url,
    details,
  });
  res.status(409).json({
    error: "user lifecycle mutation has moved to backend admin",
    code: "LIFECYCLE_MUTATION_MOVED",
  });
}

app.get("/api/users", requireAuth, safeAsync(async (req, res) => {
  const currentRole = String(req.authUser?.role || "").toLowerCase();
  let rows = [];

  if (currentRole === "owner" || currentRole === "admin") {
    rows = db
      .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role, created_at, updated_at FROM users ORDER BY id DESC")
      .all();
  } else if (currentRole === "user") {
    rows = db
      .prepare(`
        SELECT id, email, display_name, profile_json, managed_by_user_id, role, created_at, updated_at
        FROM users
        WHERE role IN ('freelance', 'editor') AND managed_by_user_id=?
        ORDER BY id DESC
      `)
      .all(Number(req.authUser?.id || 0));
  } else {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  rows = rows.filter((row) => isActiveDirectoryUserProjection(row));
  const avatarUrlByAssetId = buildUserAvatarUrlMap(rows);
  res.json({ items: rows.map((row) => stripUserSecret(row, avatarUrlByAssetId)) });
}));

app.post("/api/users/sync", requireRole("owner", "admin"), safeAsync(async (req, res) => {
  const authHeader = String(req.header("authorization") || "");
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const syncResult = await syncCollectorUsersFromBackendDirectory(token);
  if (!syncResult.ok) {
    repo.logAudit(actorEmail(req), "auth.backend_directory_sync_failed", "user", null, {
      status: syncResult.status,
      error: syncResult.error,
    });
    res.status(syncResult.status || 503).json({ error: syncResult.error || "Backend user directory sync failed" });
    return;
  }
  repo.logAudit(actorEmail(req), "auth.backend_directory_sync_manual", "user", null, {
    synced_backend_user_count: Number(syncResult.syncedBackendUserCount || 0) || 0,
    created_count: Number(syncResult.createdCount || 0) || 0,
    updated_count: Number(syncResult.updatedCount || 0) || 0,
    failed_count: Number(syncResult.failedCount || 0) || 0,
    deactivated_count: Number(syncResult.deactivatedCount || 0) || 0,
    freshness_updated: Boolean(syncResult.freshnessUpdated),
    last_synced_at: String(syncResult.lastSyncedAt || ""),
  });
  res.json({
    ok: true,
    synced_backend_user_count: Number(syncResult.syncedBackendUserCount || 0) || 0,
    created_count: Number(syncResult.createdCount || 0) || 0,
    updated_count: Number(syncResult.updatedCount || 0) || 0,
    failed_count: Number(syncResult.failedCount || 0) || 0,
    deactivated_count: Number(syncResult.deactivatedCount || 0) || 0,
    freshness_updated: Boolean(syncResult.freshnessUpdated),
    last_synced_at: String(syncResult.lastSyncedAt || "") || null,
  });
}));

app.get("/api/users/assignable", requireRole("owner", "admin", "user"), safeAsync(async (req, res) => {
  const assignmentKind = normalizeAssignmentKind(req.query?.kind, "editorial");
  const allowedRoles = new Set(getAllowedAssigneeRolesForAssignmentKind(assignmentKind));
  if (!allowedRoles.size) {
    res.status(400).json({ error: "assignment kind is not supported" });
    return;
  }
  const actorRole = String(req.authUser?.role || "").trim().toLowerCase();
  const actorId = Number(req.authUser?.id || 0) || 0;
  let rows = [];
  if (actorRole === "owner") {
    rows = db
      .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role, created_at, updated_at FROM users ORDER BY id DESC")
      .all();
  } else if (actorRole === "admin" || actorRole === "user") {
    rows = db
      .prepare(`
        SELECT id, email, display_name, profile_json, managed_by_user_id, role, created_at, updated_at
        FROM users
        WHERE (role IN ('freelance', 'editor') AND managed_by_user_id=?)
           OR id=?
        ORDER BY id DESC
      `)
      .all(actorId, actorId);
  } else {
    rows = db
      .prepare(`
        SELECT id, email, display_name, profile_json, managed_by_user_id, role, created_at, updated_at
        FROM users
        WHERE (role IN ('freelance', 'editor') AND managed_by_user_id=?)
           OR id=?
        ORDER BY id DESC
      `)
      .all(actorId, actorId);
  }
  rows = rows.filter((row) => {
    const normalizedRole = String(row?.role || "").trim().toLowerCase();
    if (!allowedRoles.has(normalizedRole)) return false;
    return isActiveDirectoryUserProjection(row);
  });
  const avatarUrlByAssetId = buildUserAvatarUrlMap(rows);
  res.json({
    kind: assignmentKind,
    directory_last_synced_at: readCollectorDirectoryLastSyncedAt(),
    items: rows.map((row) => stripUserSecret(row, avatarUrlByAssetId)),
  });
}));

app.post("/api/users", requireAuth, (req, res) => {
  rejectLegacyLifecycleMutation(req, res, "user.create.rejected", {
    email: String(req.body?.email || "").trim().toLowerCase() || null,
    role: normalizeUserRole(req.body?.role, "") || null,
  });
});

app.patch("/api/users/:id/role", requireRole("owner"), (req, res) => {
  rejectLegacyLifecycleMutation(req, res, "user.update_role.rejected", {
    user_id: Number(req.params.id || 0) || null,
    role: normalizeUserRole(req.body?.role, "") || null,
    managed_by_user_id: Number(req.body?.managed_by_user_id || 0) || null,
  });
});

app.patch("/api/users/:id/profile", requireRole("owner", "admin", "user"), (req, res) => {
  const userId = Number(req.params.id || 0);
  if (!userId) {
    res.status(400).json({ error: "valid user id is required" });
    return;
  }
  const target = db.prepare("SELECT id, email, display_name, profile_json, role, managed_by_user_id FROM users WHERE id=?").get(userId);
  if (!target) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  const actorRole = String(req.authUser?.role || "").toLowerCase();
  const actorId = Number(req.authUser?.id || 0);
  if (actorRole === "user") {
    const targetRole = String(target.role || "").toLowerCase();
    const managedBy = Number(target.managed_by_user_id || 0);
    if (!(MANAGED_CONTRIBUTOR_ROLES.has(targetRole) && managedBy === actorId)) {
      res.status(403).json({ error: "user can update profile only for managed contributor accounts" });
      return;
    }
  }
  const existingProfile = normalizeUserProfilePayload(target.profile_json, { allowPic: true });
  const rawProfileSource = req.body?.profile_json;
  const rawProfile = rawProfileSource != null && rawProfileSource !== "" ? parseObjectJson(rawProfileSource) : null;
  const profileSource = rawProfile || req.body || {};
  const hasDisplayName = hasOwnField(profileSource, "display_name");
  const hasPhone = hasOwnField(profileSource, "phone");
  const hasEmailAlt = hasOwnField(profileSource, "email_alt");
  const hasLineId = hasOwnField(profileSource, "line_id");
  const hasPicAssetId = hasOwnField(profileSource, "pic_asset_id");
  const incomingProfile = normalizeUserProfilePayload(
    req.body?.profile_json ?? {
      display_name: req.body?.display_name,
      phone: req.body?.phone,
      email_alt: req.body?.email_alt,
      line_id: req.body?.line_id,
      pic_asset_id: req.body?.pic_asset_id,
    },
    { allowPic: true }
  );
  const nextProfile = {
    display_name: hasDisplayName
      ? (incomingProfile.display_name || "")
      : (existingProfile.display_name || String(target.display_name || "").trim()),
    phone: hasPhone ? (incomingProfile.phone || "") : (existingProfile.phone || ""),
    email_alt: hasEmailAlt ? (incomingProfile.email_alt || "") : (existingProfile.email_alt || ""),
    line_id: hasLineId ? (incomingProfile.line_id || "") : (existingProfile.line_id || ""),
    pic_asset_id: hasPicAssetId ? (incomingProfile.pic_asset_id || null) : (existingProfile.pic_asset_id || null),
  };
  const storedProfile = mergeReservedUserProfileFields(target.profile_json, nextProfile);
  if (nextProfile.pic_asset_id) {
    const asset = db.prepare("SELECT id FROM assets WHERE id=? AND mime_type LIKE 'image/%' LIMIT 1").get(nextProfile.pic_asset_id);
    if (!asset) {
      res.status(400).json({ error: "pic_asset_id not found or is not an image asset" });
      return;
    }
  }
  const displayName = nextProfile.display_name || target.email;
  db.prepare("UPDATE users SET display_name=?, profile_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(displayName, JSON.stringify(storedProfile), userId);
  const updated = db
    .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role, created_at, updated_at FROM users WHERE id=?")
    .get(userId);
  repo.logAudit(actorEmail(req), "user.update_profile", "user", String(userId), {
    profile_json: nextProfile,
  });
  res.json({ ok: true, user: stripUserSecret(updated) });
});

app.post("/api/users/avatar/upload", requireRole("owner", "admin", "user"), uploadRateLimit, upload.single("file"), async (req, res) => {
  const file = req.file || null;
  if (!file) {
    res.status(400).json({ error: "file is required" });
    return;
  }
  try {
    const fileBuffer = fsSync.readFileSync(file.path);
    if (!isSupportedImageSignature(fileBuffer, String(file.mimetype || "").toLowerCase())) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: "Uploaded file signature does not match mime type" });
      return;
    }
    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const relativePath = path.relative(dirs.mediaDir, file.path);
    const assetUid = crypto.randomUUID();
    const result = db
      .prepare("INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(assetUid, "local", relativePath, file.originalname || "user-avatar.jpg", file.mimetype || "image/jpeg", file.size || fileBuffer.byteLength, checksum);
    const assetId = Number(result.lastInsertRowid || 0);
    repo.logAudit(actorEmail(req), "user.avatar.upload", "asset", String(assetId), {
      storage_path: relativePath,
      mime_type: file.mimetype || "image/jpeg",
    });
    res.status(201).json({
      id: assetId,
      asset_uid: assetUid,
      storage_path: relativePath,
      public_url: parseAssetPathForUrl(relativePath),
    });
  } catch (err) {
    await fs.unlink(file.path).catch(() => {});
    res.status(400).json({ error: String(err?.message || "Cannot upload user avatar") });
  }
});

app.patch("/api/users/:id/password", requireRole("admin", "owner"), (req, res) => {
  const userId = Number(req.params.id || 0) || null;
  repo.logAudit(actorEmail(req), "user.reset_password.rejected", "user", String(userId || 0), {
    reason: "collector_local_auth_removed_phase5",
  });
  res.status(410).json({
    error: "collector local password management has been removed; use backend auth authority",
    code: "COLLECTOR_LOCAL_AUTH_REMOVED",
  });
});

app.delete("/api/users/:id", requireRole("owner"), (req, res) => {
  rejectLegacyLifecycleMutation(req, res, "user.delete.rejected", {
    user_id: Number(req.params.id || 0) || null,
  });
});

app.get("/api/config", requireRole("owner"), (_req, res) => {
  const featureRows = listAiFeaturePolicyRowsForOwner();
  res.json({
    ai: {
      provider: null,
      model: null,
      policy_mode: "feature_based",
      enabled: featureRows.some((row) => Boolean(row?.provider) && Boolean(row?.model)),
      policies: featureRows,
    },
    storage_mode: "local",
  });
});

app.get("/api/ai-feature-policies", requireRole("owner"), (_req, res) => {
  const items = listAiFeaturePolicyRowsForOwner();
  res.json({
    items,
    policy_catalog: AI_POLICY_CATALOG.map((row) => ({
      key: row.key,
      label: row.label,
      provider: row.provider,
      model: row.model,
    })),
  });
});

app.get("/api/ai-feature-policies/runtime", requireRole("owner"), (_req, res) => {
  const policyMap = listStoredAiFeaturePolicyMap();
  const effectiveMap = buildFeaturePolicyMap(policyMap);
  const aiConfig = getEffectiveAiConfig();
  res.json({
    policy_mode: "feature_based",
    policy_by_feature: policyMap,
    effective_policies: Object.fromEntries(
      Object.entries(effectiveMap).map(([key, row]) => [
        key,
        {
          policy_key: String(row?.policy_key || "").trim() || null,
          provider: String(row?.provider || "").trim() || null,
          model: String(row?.model || "").trim() || null,
          feature_status: String(row?.status || "").trim() || null,
          feature_active: Boolean(row?.active),
        },
      ])
    ),
    ai_runtime: buildAiFeatureRuntimeSnapshot(aiConfig),
  });
});

app.put("/api/ai-feature-policies/:featureKey", requireRole("owner"), (req, res) => {
  const featureKey = String(req.params.featureKey || "").trim();
  const featureDef = AI_FEATURE_BY_KEY.get(featureKey);
  if (!featureDef) {
    res.status(404).json({ error: "Unknown AI feature" });
    return;
  }
  const policyKey = String(req.body?.policy_key || "").trim();
  if (!AI_POLICY_BY_KEY.has(policyKey)) {
    res.status(400).json({ error: "Unknown AI policy" });
    return;
  }
  const oldRow = repo.getAiFeaturePolicy(featureKey);
  const saved = repo.upsertAiFeaturePolicy(featureKey, {
    policy_key: policyKey,
    updated_by: actorEmail(req),
  });
  repo.logAudit(actorEmail(req), "ai_feature_policy.update", "ai_feature_policy", featureKey, {
    feature_key: featureKey,
    old_policy_key: oldRow?.policy_key || null,
    new_policy_key: policyKey,
  });
  res.json({
    ok: true,
    item: normalizeAiFeaturePolicyForResponse(saved),
  });
});

function normalizeAgentProfileForResponse(row, definition) {
  const def = definition || AGENT_PROFILE_DEFINITIONS[String(row?.agent_key || "").trim().toLowerCase()] || null;
  if (!def) return null;
    // savedText: null means no DB row exists; empty string means owner intentionally cleared the profile
  const savedText = (row && typeof row.profile_text === "string") ? row.profile_text : null;
  return {
    agent_key: def.agent_key,
    display_name: String(row?.display_name || def.display_name).trim() || def.display_name,
    profile_text: savedText ?? def.default_profile_text,
    default_profile_text: def.default_profile_text,
    is_default: savedText == null,
    is_enabled: row?.is_enabled == null ? true : Boolean(row.is_enabled),
    updated_by: row?.updated_by || null,
    updated_at: row?.updated_at || null,
  };
}

function getAgentProfileDefinitionOrNull(agentKey) {
  const key = String(agentKey || "").trim().toLowerCase();
  return AGENT_PROFILE_DEFINITIONS[key] || null;
}

function getEffectiveAgentProfile(agentKey) {
  const def = getAgentProfileDefinitionOrNull(agentKey);
  if (!def) return null;
  return normalizeAgentProfileForResponse(repo.getAgentProfile(def.agent_key), def);
}

app.get("/api/agent-profiles", requireRole("owner"), (_req, res) => {
  const savedByKey = new Map(repo.listAgentProfiles().map((row) => [String(row.agent_key || "").trim().toLowerCase(), row]));
  const items = Object.values(AGENT_PROFILE_DEFINITIONS)
    .map((definition) => normalizeAgentProfileForResponse(savedByKey.get(definition.agent_key), definition))
    .filter(Boolean);
  res.json({ items });
});

app.get("/api/agent-profiles/:agentKey", requireRole("owner"), (req, res) => {
  const profile = getEffectiveAgentProfile(req.params.agentKey);
  if (!profile) {
    res.status(404).json({ error: "Unknown agent profile" });
    return;
  }
  res.json({ profile });
});

app.put("/api/agent-profiles/:agentKey", requireRole("owner"), (req, res) => {
  const def = getAgentProfileDefinitionOrNull(req.params.agentKey);
  if (!def) {
    res.status(404).json({ error: "Unknown agent profile" });
    return;
  }
    // Accept raw profile_text including empty string (owner intentionally clears)
    const profileText = req.body && typeof req.body.profile_text === "string"
      ? req.body.profile_text
      : "";
  if (profileText.length > AGENT_PROFILE_MAX_LENGTH) {
    res.status(400).json({ error: `profile_text must be ${AGENT_PROFILE_MAX_LENGTH} characters or fewer` });
    return;
  }
  const saved = repo.upsertAgentProfile(def.agent_key, {
    display_name: def.display_name,
    profile_text: profileText,
    is_enabled: true,
    updated_by: actorEmail(req),
  });
  repo.logAudit(actorEmail(req), "agent_profile.update", "agent_profile", def.agent_key, {
    agent_key: def.agent_key,
    profile_length: profileText.length,
  });
  res.json({ ok: true, profile: normalizeAgentProfileForResponse(saved, def) });
});

app.post("/api/agent-profiles/:agentKey/reset", requireRole("owner"), (req, res) => {
  const def = getAgentProfileDefinitionOrNull(req.params.agentKey);
  if (!def) {
    res.status(404).json({ error: "Unknown agent profile" });
    return;
  }
    const saved = repo.upsertAgentProfile(def.agent_key, {
    display_name: def.display_name,
    profile_text: def.default_profile_text,
    is_enabled: true,
    updated_by: actorEmail(req),
  });
  repo.logAudit(actorEmail(req), "agent_profile.reset", "agent_profile", def.agent_key, {
    agent_key: def.agent_key,
  });
  res.json({ ok: true, profile: normalizeAgentProfileForResponse(saved, def) });
});

app.get("/api/items", (req, res) => {
  const role = actorPolicyRole(req, "");
  if (role !== "owner" && role !== "admin" && role !== "user") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const status = String(req.query.status || "").trim();
  const includeBulkPreview = isAdminLikeUser(req.authUser);
  const decorateVisibleItems = (items) => attachItemClaimUsers(items)
    .flatMap((item) => {
      const scopeContext = resolveItemScopeContext(item);
      if (!isItemVisibleToActor(req.authUser, item, scopeContext?.primaryAssignment || null)) {
        return [];
      }
      return [attachItemScopeMetadata(req.authUser, item, scopeContext)];
    })
    ;
  if (!status) {
    res.json(attachItemMatchFields(decorateVisibleItems(repo.listItems()), { includeBulkPreview }));
    return;
  }

  const statuses = status
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  res.json(attachItemMatchFields(decorateVisibleItems(repo.listItemsByStatus(statuses)), { includeBulkPreview }));
});

app.post("/api/items/bulk-delete", requireRole("admin", "owner"), (req, res) => {
  const ids = toUniquePositiveIds(req.body?.ids);
  if (!ids.length) {
    res.status(400).json({ error: "?????????????????? 1 ??????" });
    return;
  }

  const rows = ids.map((id) => repo.getItem(id));
  const missing = ids.filter((id, index) => !rows[index]);
  if (missing.length) {
    res.status(404).json({ error: `???????????: ${missing.join(", ")}` });
    return;
  }

  try {
    const plan = planBulkItemDelete(rows, {
      getRawOnlyHardDeleteEligibility: (itemId) => repo.getRawOnlyHardDeleteEligibility(itemId),
      getMergeBlockersForItem,
    });
    if (!plan.ok) {
      res.status(400).json({ error: `cannot delete items with dependency blockers: ${formatItemBlockerSummary(plan.blocked_rows)}` });
      return;
    }

    const hardItemIds = [];
    const softItemIds = [];
    for (const action of plan.actions) {
      if (action.mode === "hard") {
        hardItemIds.push(action.item_id);
      } else {
        softItemIds.push(action.item_id);
      }
    }

    const result = repo.bulkDeleteItems(hardItemIds, softItemIds, actorEmail(req));
    const deletedIds = Array.isArray(result?.deleted_ids) ? result.deleted_ids : [];
    const deletedAssetIds = Array.isArray(result?.deleted_asset_ids) ? result.deleted_asset_ids : [];

    let assetsCleaned = 0;
    const assetCleanupErrors = [];
    for (const assetId of deletedAssetIds) {
      try {
        const cleanup = deleteAssetIfUnused(assetId);
        if (cleanup?.deleted_asset) assetsCleaned += 1;
      } catch (sweepErr) {
        assetCleanupErrors.push(String(sweepErr?.message || sweepErr || "asset cleanup failed"));
      }
    }

    const responsePayload = { ok: true, deleted_count: deletedIds.length, ids: deletedIds };
    if (assetsCleaned > 0) {
      responsePayload.assets_cleaned = assetsCleaned;
    }
    if (assetCleanupErrors.length > 0) {
      responsePayload.asset_cleanup_failed_count = assetCleanupErrors.length;
      responsePayload.asset_cleanup_errors = assetCleanupErrors;
    }
    res.json(responsePayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "delete failed";
    res.status(400).json({ error: message });
  }
});

app.post("/api/items/bulk-category", requireRole("admin", "owner"), (req, res) => {
  const ids = toUniquePositiveIds(req.body?.ids);
  const category = String(req.body?.category || "").trim().toLowerCase();
  if (!ids.length) {
    res.status(400).json({ error: "ต้องเลือกรายการอย่างน้อย 1 รายการ" });
    return;
  }
  if (!CONTENT_ITEM_CATEGORIES.has(category)) {
    res.status(400).json({ error: "หมวดหมู่ไม่ถูกต้อง" });
    return;
  }

  const rows = ids.map((id) => repo.getItem(id));
  const missing = ids.filter((id, index) => !rows[index]);
  if (missing.length) {
    res.status(404).json({ error: `ไม่พบรายการ: ${missing.join(", ")}` });
    return;
  }

  const updatedCount = repo.updateItemsCategory(ids, category, actorEmail(req));
  res.json({ ok: true, updated_count: updatedCount, ids, category });
});

app.post("/api/items/bulk-merge", requireRole("admin", "owner"), (req, res) => {
  const masterItemId = Number(req.body?.master_item_id || 0);
  const sourceItemIds = toUniquePositiveIds(req.body?.source_item_ids);

  if (!masterItemId) {
    res.status(400).json({ error: "master_item_id is required" });
    return;
  }
  if (!sourceItemIds.length) {
    res.status(400).json({ error: "source_item_ids must contain at least one item" });
    return;
  }
  if (sourceItemIds.includes(masterItemId)) {
    res.status(400).json({ error: "????????????????????????????????" });
    return;
  }

  try {
    const result = mergeContentItems({
      masterItemId,
      sourceItemIds,
      actorEmailValue: actorEmail(req),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "merge failed";
    res.status(400).json({ error: message });
  }
});

app.get("/api/items/:id", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const officialReference = repo.getOfficialReferenceByItem(id);
  const responseItem = attachItemScopeMetadata(req.authUser, attachSingleItemClaimUser({
    ...attachWorkflowHeadFields(item),
    official_reference: officialReference,
  }));
  res.json(isOtherTransportItem(responseItem) ? attachOtherTransportMetadataToItem(responseItem) : responseItem);
});

app.post("/api/events-manager/items", requireRole("owner", "admin", "user"), (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const payload = {
    type: "event",
    category: "activities",
    lang: "th",
    title,
    slug: normalizeCollectorSlug(title, "event"),
    summary: "",
    meta_title: "",
    meta_description: "",
    event_period_text: "",
    location_text: "",
    map_url: "",
    description_raw: "",
    description_clean: "",
    source_type: "manual",
    source_name: "event-editorial",
  };
  const actor = actorEmail(req);
  const { item } = repo.createItemWithWorkflowHead(
    payload,
    {
      production_state: "content_in_progress",
      publication_state: "draft",
      assignment_state: null,
      last_transition_note: "item created",
    },
    actor,
    {
      actor_role: "system",
      reason_code: "item_created",
      bump_state_version: true,
    }
  );
  res.status(201).json(item);
});

app.post("/api/other-transport/items", requireRole("owner", "admin", "user"), (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const subtype = normalizeOtherTransportSubtype(req.body?.subtype, "other");
  const payload = {
    type: OTHER_TRANSPORT_ITEM_TYPE,
    category: "transport",
    lang: "th",
    title,
    slug: normalizeCollectorSlug(title, "other-transport"),
    summary: "",
    meta_title: title,
    meta_description: "",
    description_raw: "",
    description_clean: "",
    source_type: "manual",
    source_name: "other-transport-editorial",
    source_entity_id: subtype,
  };
  const actor = actorEmail(req);
  const { item } = repo.createItemWithWorkflowHead(
    payload,
    {
      production_state: "content_in_progress",
      publication_state: "draft",
      assignment_state: null,
      last_transition_note: "item created",
    },
    actor,
    {
      actor_role: "system",
      reason_code: "item_created",
      bump_state_version: true,
    }
  );
  res.status(201).json(item);
});

app.post("/api/items", requireRole("owner", "admin"), (req, res) => {
  const payload = req.body && typeof req.body === "object" ? { ...req.body } : {};
  const workflowPatch = resolveCreateWorkflowPatch(req.body, "raw");
  if (Object.prototype.hasOwnProperty.call(payload, "workflow_status")) {
    delete payload.workflow_status;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "workflow_patch")) {
    delete payload.workflow_patch;
  }
  const actor = actorEmail(req);
  const { item } = repo.createItemWithWorkflowHead(
    payload,
    {
      production_state: workflowPatch.production_state,
      publication_state: workflowPatch.publication_state,
      assignment_state: workflowPatch.assignment_state || null,
      last_transition_note: "item created",
    },
    actor,
    {
      actor_role: "system",
      reason_code: "item_created",
      bump_state_version: true,
    }
  );
  res.status(201).json(item);
});

function transportMapLegacyRemoved(res) {
  res.status(410).json({
    error: "transport map v1 has been removed; use /api/v2/transport instead",
    replacement_api_base: "/api/v2/transport",
    replacement_ui: "/transport-v2-routes.html",
  });
}

app.all("/api/transport-map/config", requireRole("owner", "admin", "user"), (_req, res) => {
  transportMapLegacyRemoved(res);
});

app.all("/api/transport-map-routes", requireRole("owner", "admin", "user"), (_req, res) => {
  transportMapLegacyRemoved(res);
});

app.all("/api/transport-map-routes/:id", requireRole("owner", "admin", "user"), (_req, res) => {
  transportMapLegacyRemoved(res);
});

app.all("/api/transport-map-routes/:id/release-main", requireRole("owner", "admin"), (_req, res) => {
  transportMapLegacyRemoved(res);
});

app.get("/api/transport-map/config", requireRole("owner", "admin", "user"), (_req, res) => {
  res.json({
    mapsApiKey: String(process.env.GOOGLE_MAPS_BROWSER_KEY || "").trim(),
  });
});

app.get("/api/transport-map-routes", requireRole("owner", "admin"), (_req, res) => {
  const items = repo
    .listItems()
    .filter((item) => isTransportMapItem(item))
    .map((item) => buildTransportMapRouteResponse(item))
    .filter(Boolean)
    .sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
  res.json({ items });
});

app.get("/api/transport-map-routes/:id", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid route id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item || !isTransportMapItem(item)) {
    res.status(404).json({ error: "Transport route not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  res.json(buildTransportMapRouteResponse(item));
});

app.post("/api/transport-map-routes", requireRole("owner", "admin"), (req, res) => {
  const routePayload = normalizeTransportRoutePayload(req.body || null, null);
  const requestedVehicleImage = normalizeTransportMediaUrl(req.body?.vehicle_image || req.body?.thumbnail_url || "");
  if (!routePayload.route_name) {
    res.status(400).json({ error: "route_name is required" });
    return;
  }
  if (!routePayload.route_number) {
    res.status(400).json({ error: "route_number is required" });
    return;
  }
  if (requestedVehicleImage && !isTransportDefaultThumbnail(requestedVehicleImage)) {
    res.status(400).json({ error: "thumbnail must be uploaded to collector or use the default bus image" });
    return;
  }

  const { item } = repo.createItemWithWorkflowHead(
    {
      type: TRANSPORT_MAP_ITEM_TYPE,
      category: "transport",
      lang: "th",
      title: routePayload.route_name,
      slug: normalizeCollectorSlug(routePayload.route_number, `transport-route-${Date.now()}`),
      summary: routePayload.description,
      description_raw: routePayload.description,
      description_clean: routePayload.description,
      image_url: routePayload.vehicle_image,
      source_type: TRANSPORT_MAP_SOURCE_TYPE,
      source_name: "collector-transport-map",
      source_entity_id: routePayload.route_number,
      payload_json: routePayload,
    },
    {
      production_state: "content_in_progress",
      publication_state: "draft",
      last_transition_note: "transport route created",
    },
    actorEmail(req),
    {
      actor_role: "system",
      reason_code: "transport_route_created",
      bump_state_version: true,
    }
  );
  res.status(201).json(buildTransportMapRouteResponse(item));
});

app.put("/api/transport-map-routes/:id", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid route id" });
    return;
  }
  const current = repo.getItem(id);
  if (!current || !isTransportMapItem(current)) {
    res.status(404).json({ error: "Transport route not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, current)) {
    return;
  }

  const routePayload = normalizeTransportRoutePayload(req.body || null, current);
  if (!routePayload.route_name) {
    res.status(400).json({ error: "route_name is required" });
    return;
  }
  if (!routePayload.route_number) {
    res.status(400).json({ error: "route_number is required" });
    return;
  }
  const thumbnail = classifyTransportThumbnail(id, routePayload.vehicle_image);
  if (!thumbnail.is_valid) {
    res.status(400).json({
      error: "thumbnail must be uploaded to collector or use the default bus image",
      thumbnail,
    });
    return;
  }

  const currentHead = repo.ensureWorkflowModel(id);
  const shouldKeepContentInProgress = String(currentHead?.production_state || "").trim().toLowerCase() !== "content_in_progress";
  const updateResult = repo.updateItemWithWorkflowHead({
    id,
    type: TRANSPORT_MAP_ITEM_TYPE,
    category: "transport",
    lang: String(current.lang || "th").trim().toLowerCase() || "th",
    title: routePayload.route_name,
    slug: normalizeCollectorSlug(routePayload.route_number, `transport-route-${id}`),
    summary: routePayload.description,
    description_raw: routePayload.description,
    description_clean: routePayload.description,
    image_url: thumbnail.url || routePayload.vehicle_image,
    source_type: TRANSPORT_MAP_SOURCE_TYPE,
    source_name: "collector-transport-map",
    source_entity_id: routePayload.route_number,
    payload_json: { ...routePayload, vehicle_image: thumbnail.url || routePayload.vehicle_image },
  }, actorEmail(req), shouldKeepContentInProgress
    ? {
      workflow_patch: {
        production_state: "content_in_progress",
        publication_state: "draft",
        last_transition_note: "transport route updated",
      },
      workflow_metadata: {
        actor_role: "system",
        reason_code: "transport_route_updated",
        bump_state_version: true,
      },
    }
    : {});
  const item = updateResult.item;
  res.json(buildTransportMapRouteResponse(item));
});

app.post("/api/transport-map-routes/:id/release-main", requireRole("owner", "admin"), workflowRateLimit, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid route id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item || !isTransportMapItem(item)) {
    res.status(404).json({ error: "Transport route not found" });
    return;
  }
  const route = buildTransportMapRouteResponse(item);
  const validation = validateTransportMapRouteForPublish(route);
  if (!validation.ok) {
    res.status(409).json({
      error: `Transport route is not ready: ${validation.missing.join(", ")}`,
      validation,
    });
    return;
  }
  if (!hasConfiguredSyncToken()) {
    res.status(503).json({ error: "LIFECYCLE_SYNC_TOKEN is not configured" });
    return;
  }

  const workflowModel = repo.ensureWorkflowModel(id);
  const publishableSource = repo.buildPublishableSourceByItem(id);
  const currentStatus = deriveArticleProcessStatus(item, workflowModel, publishableSource);
  if (currentStatus !== "ready_for_sync" && currentStatus !== "synced_to_admin") {
    res.status(409).json({ error: `Transport route must be approved before sync (${currentStatus})` });
    return;
  }

  try {
    const payload = buildTransportRouteSyncPayload(route);
    const syncRes = await fetch(`${backendApiBase}/transport-routes/import-collector`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lifecycle-token": backendSyncToken,
      },
      body: JSON.stringify(payload),
    });
    const body = await syncRes.json().catch(() => ({ error: "Invalid backend sync response" }));
    const backendSync = {
      ok: syncRes.ok,
      status: syncRes.status,
      result: body,
      payload_summary: { routes: payload.routes.length },
    };
    if (!syncRes.ok) {
      res.status(syncRes.status).json({
        error: body?.error || "Backend transport sync failed",
        backend_sync: backendSync,
      });
      return;
    }

    const nextModel = repo.upsertWorkflowModel(
      id,
      {
        production_state: "ready_for_publish",
        publication_state: "published",
        last_transition_note: "transport route synced to backend",
      },
      actorEmail(req),
      {
        actor_role: actorPolicyRole(req),
        reason_code: "transport_map_sync_backend",
      }
    );
    repo.logAudit(actorEmail(req), "transport_map.sync_backend", "content_item", String(id), {
      content_item_id: id,
      route_number: route.route_number,
      backend_result: body,
    });
    res.json({
      ok: true,
      item: buildTransportMapRouteResponse(repo.getItem(id) || item),
      workflow_model: nextModel,
      backend_sync: backendSync,
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || "Cannot sync transport route to backend") });
  }
});

app.post("/api/items/:id/claim", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const current = repo.getItem(id);
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  const decoratedCurrent = attachItemScopeMetadata(req.authUser, attachSingleItemClaimUser(current));
  if (Number(decoratedCurrent?.claimed_by_user_id || 0) === actorId) {
    res.json({ ok: true, item: decoratedCurrent });
    return;
  }
  if (!canClaimItemByManagementLine(req.authUser, decoratedCurrent)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (Number(decoratedCurrent?.claimed_by_user_id || 0) > 0) {
    const holderLabel = getPrepClaimHolderLabel(decoratedCurrent);
    res.status(409).json({
      error: holderLabel
        ? `รายการนี้ถูกรับงานโดย ${holderLabel} อยู่`
        : "รายการนี้มีผู้รับงานอยู่แล้ว",
      item: decoratedCurrent,
    });
    return;
  }

  try {
    const claimed = attachSingleItemClaimUser(
      repo.claimItem(id, actorId, { claim_note: req.body?.claim_note })
    );
    repo.logAudit(actorEmail(req), "item.claim", "content_item", String(id), {
      content_item_id: id,
      claimed_by_user_id: actorId,
    });
    res.json({ ok: true, item: attachItemScopeMetadata(req.authUser, claimed) });
  } catch (err) {
    const msg = String(err?.message || "Cannot claim item");
    const status = /already claimed/i.test(msg) ? 409 : /not found/i.test(msg) ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/release", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const current = repo.getItem(id);
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  const decoratedCurrent = attachItemScopeMetadata(req.authUser, attachSingleItemClaimUser(current));
  const claimedByUserId = Number(decoratedCurrent?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId) {
    res.status(409).json({ error: "รายการนี้ยังไม่มีผู้รับงาน", item: decoratedCurrent });
    return;
  }
  if (claimedByUserId !== actorId) {
    const holderLabel = getPrepClaimHolderLabel(decoratedCurrent);
    res.status(409).json({
      error: holderLabel
        ? `รายการนี้อยู่ในการดูแลของ ${holderLabel}`
        : "รายการนี้อยู่ในการดูแลของผู้ใช้อื่น",
      item: decoratedCurrent,
    });
    return;
  }

  try {
    const released = attachItemScopeMetadata(req.authUser, attachSingleItemClaimUser(repo.releaseItemClaim(id, actorId)));
    repo.logAudit(actorEmail(req), "item.claim_release", "content_item", String(id), {
      content_item_id: id,
      released_by_user_id: actorId,
    });
    res.json({ ok: true, item: released });
  } catch (err) {
    const msg = String(err?.message || "Cannot release item claim");
    const status = /another user|already released/i.test(msg) ? 409 : /not found/i.test(msg) ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/takeover", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: "confirm=true is required for takeover" });
    return;
  }
  const current = repo.getItem(id);
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  const decoratedCurrent = attachItemScopeMetadata(req.authUser, attachSingleItemClaimUser(current));
  const actorRole = actorPolicyRole(req);
  const claimedByUserId = Number(decoratedCurrent?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId) {
    res.status(409).json({ error: "รายการนี้ยังไม่มีผู้รับงาน ให้ใช้การรับงานแทน takeover" });
    return;
  }
  if (Number(decoratedCurrent?.claimed_by_user_id || 0) === actorId) {
    res.json({ ok: true, item: decoratedCurrent });
    return;
  }
  const claimantRole = String(decoratedCurrent?.claimed_by_user?.role || "").trim().toLowerCase();
  if (!canTakeOverPrepClaim(actorRole, claimantRole) || !canTakeOverItemByManagementLine(req.authUser, decoratedCurrent)) {
    res.status(403).json({
      error: claimantRole === "owner"
        ? "admin ไม่สามารถ takeover งานที่ owner ถืออยู่"
        : "takeover ต้องมีลำดับสิทธิ์สูงกว่าผู้ถือรายการปัจจุบัน",
    });
    return;
  }

  try {
    const taken = attachSingleItemClaimUser(
      repo.takeOverItemClaim(id, actorId, { claim_note: req.body?.claim_note })
    );
    repo.logAudit(actorEmail(req), "item.claim_takeover", "content_item", String(id), {
      content_item_id: id,
      previous_claimed_by_user_id: Number(decoratedCurrent?.claimed_by_user_id || 0) || null,
      claimed_by_user_id: actorId,
    });
    res.json({ ok: true, item: attachItemScopeMetadata(req.authUser, taken) });
  } catch (err) {
    const msg = String(err?.message || "Cannot take over item");
    const status = /not found/i.test(msg) ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

app.put("/api/items/:id", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id);
  const current = repo.getItem(id);
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensurePrepItemEditAccess(req, res, current)) {
    return;
  }

  const workflowAction = String(req.body?.workflow_action || "").trim().toLowerCase() || null;
  const requestBody = req.body && typeof req.body === "object" ? { ...req.body } : {};
  delete requestBody.workflow_status;
  delete requestBody.workflow_action;
  const payload = { ...current, ...requestBody, id };
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "description_raw")
    || Object.prototype.hasOwnProperty.call(req.body || {}, "description_clean")) {
    const normalizedDescription = String(
      req.body?.description_clean ?? req.body?.description_raw ?? ""
    ).trim();
    payload.description_raw = normalizedDescription;
    payload.description_clean = normalizedDescription;
  }

  const actor = actorEmail(req);
  const workflowBefore = workflowAction === "mark_cleaned" ? repo.ensureWorkflowModel(id) : null;
  const shouldAdvanceToAnalyzed = workflowBefore
    ? String(workflowBefore?.production_state || "").trim().toLowerCase() !== "analyzed"
    : false;
  const updateResult = repo.updateItemWithWorkflowHead(
    payload,
    actor,
    workflowAction === "mark_cleaned"
      ? {
        workflow_patch: {
          production_state: "analyzed",
          last_transition_note: "clean step saved by editor",
        },
        workflow_metadata: {
          actor_role: String(req.user?.role || "user").trim().toLowerCase() || "user",
          reason_code: "clean_step_saved",
          bump_state_version: shouldAdvanceToAnalyzed,
        },
      }
      : {}
  );
  const updated = updateResult.item;
  res.json(attachSingleItemClaimUser(attachWorkflowHeadFields(updated)));
});

app.put("/api/items/:id/editor-work", requireRole("owner", "admin", "editor", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const current = repo.getItem(id);
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureArticleComposerEditAccess(req, res, current)) {
    return;
  }

  try {
    const incomingItemPayload = req.body?.item && typeof req.body.item === "object"
      ? { ...(req.body.item || {}) }
      : {};
    delete incomingItemPayload.workflow_status;
    delete incomingItemPayload.workflow_action;
    const itemPayload = { ...current, ...incomingItemPayload, id };
    const otherTransportMetaPayload = isOtherTransportItem(itemPayload)
      ? normalizeOtherTransportMetadata(req.body?.item?.other_transport_meta || {}, current)
      : null;
    if (Object.prototype.hasOwnProperty.call(itemPayload, "other_transport_meta")) {
      delete itemPayload.other_transport_meta;
    }
    const fieldPackPayload = req.body?.field_pack && typeof req.body.field_pack === "object"
      ? { ...(req.body.field_pack || {}) }
      : null;
    const draftPayload = req.body?.draft && typeof req.body.draft === "object"
      ? { ...(req.body.draft || {}) }
      : null;
    const itemBodyWasProvided = hasOwnRequestField(incomingItemPayload, "description_clean")
      || hasOwnRequestField(incomingItemPayload, "description_raw");
    const draftBodyWasProvided = hasOwnRequestField(draftPayload, "body");
    const sanitizedBody = sanitizeArticleRichTextHtml(
      draftBodyWasProvided
        ? draftPayload.body
        : itemBodyWasProvided
          ? (hasOwnRequestField(incomingItemPayload, "description_clean")
              ? incomingItemPayload.description_clean
              : incomingItemPayload.description_raw)
          : (current.description_clean ?? current.description_raw ?? "")
    );
    itemPayload.description_clean = sanitizedBody;
    itemPayload.description_raw = sanitizedBody;
    if (hasOwnRequestField(incomingItemPayload, "slug")) {
      const requestedSlug = String(incomingItemPayload.slug ?? "").trim();
      itemPayload.slug = requestedSlug ? normalizeCollectorSlug(requestedSlug, `item-${id}`) : "";
    } else {
      itemPayload.slug = normalizeCollectorSlug(
        itemPayload.slug || itemPayload.title || current.slug || current.title || "",
        `item-${id}`
      );
    }
    if (otherTransportMetaPayload) {
      itemPayload.source_entity_id = otherTransportMetaPayload.subtype;
    }
    if (draftPayload) {
      draftPayload.body = sanitizedBody;
    }
    const resolutionItem = buildRequestedChecksResolutionItem(current, itemPayload);
    const resolvedFieldPackPayload = fieldPackPayload
      ? resolveFieldPackRequestedChecksForEditor(resolutionItem, fieldPackPayload)
      : fieldPackPayload;
    const result = repo.saveItemWithFieldPack(itemPayload, resolvedFieldPackPayload, actorEmail(req));
    let responseItem = result?.item || null;
    if (responseItem && otherTransportMetaPayload) {
      upsertOtherTransportMetadata(id, responseItem, otherTransportMetaPayload);
      responseItem = attachOtherTransportMetadataToItem({
        ...responseItem,
        other_transport_meta: otherTransportMetaPayload,
      });
    }
    let savedDraft = null;
    if (draftPayload) {
      const latestDraft = repo.latestDraftByItem(id);
      const generationRunUid = String(
        draftPayload.generation_run_uid
        || latestDraft?.generation_run_uid
        || `manual-editor-${id}`
      ).trim() || `manual-editor-${id}`;
      const draftTitleWasProvided = hasOwnRequestField(draftPayload, "draft_title");
      const draftExcerptWasProvided = hasOwnRequestField(draftPayload, "excerpt");
      const draftMetaTitleWasProvided = hasOwnRequestField(draftPayload, "meta_title");
      const draftMetaDescriptionWasProvided = hasOwnRequestField(draftPayload, "meta_description");
      savedDraft = repo.saveDraft(id, generationRunUid, {
        draft_title: draftTitleWasProvided
          ? readSubmittedStringField(draftPayload, "draft_title").trim()
          : (String(itemPayload.title ?? current.title ?? "Untitled draft").trim() || "Untitled draft"),
        excerpt: draftExcerptWasProvided
          ? readSubmittedStringField(draftPayload, "excerpt").trim()
          : String(itemPayload.summary ?? current.summary ?? "").trim(),
        body: draftBodyWasProvided
          ? readSubmittedStringField(draftPayload, "body").trim()
          : String(itemPayload.description_clean ?? itemPayload.description_raw ?? current.description_clean ?? current.description_raw ?? "").trim(),
        meta_title: draftMetaTitleWasProvided
          ? readSubmittedStringField(draftPayload, "meta_title").trim()
          : String(itemPayload.meta_title ?? current.meta_title ?? "").trim(),
        meta_description: draftMetaDescriptionWasProvided
          ? readSubmittedStringField(draftPayload, "meta_description").trim()
          : String(itemPayload.meta_description ?? current.meta_description ?? "").trim(),
        suggested_related: Array.isArray(draftPayload.suggested_related)
          ? draftPayload.suggested_related
          : (latestDraft?.suggested_related || []),
        ai_quality_score: draftPayload.ai_quality_score ?? latestDraft?.ai_quality_score ?? 0,
        ...mergeConfirmedDraftMetadata(draftPayload, latestDraft),
        status: String(draftPayload.status || latestDraft?.status || "generated").trim() || "generated",
      });
      repo.logAudit(actorEmail(req), "draft.save_editor_work", "content_item", String(id), {
        draft_id: savedDraft?.id || null,
        generation_run_uid: generationRunUid,
        status: savedDraft?.status || null,
      });
    }
    if (result?.field_pack) {
      repo.logAudit(actorEmail(req), "field_pack.save_editor_work", "content_item", String(id), {
        field_pack_id: result.field_pack.id || null,
        status: result.field_pack.status || null,
        is_current: result.field_pack.is_current === true,
      });
    }
    res.json({
      ok: true,
      item: responseItem,
      field_pack: resolveFieldPackRequestedChecksForEditor(responseItem || current, result?.field_pack || null),
      draft: savedDraft || null,
    });
  } catch (err) {
    const message = String(err?.message || "Failed to save editor work");
    const status = /not found/i.test(message) ? 404 : /conflict|constraint/i.test(message) ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

app.post("/api/items/:id/seo-suggestion", requireRole("owner", "admin", "editor", "user"), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureArticleComposerEditAccess(req, res, item)) {
    return;
  }

  const aiConfig = getEffectiveAiConfig();
  if (!aiConfig?.enabled) {
    res.status(409).json({ error: "AI backend is not configured for SEO suggestions" });
    return;
  }

  const seoAgentProfile = getEffectiveAgentProfile(SEO_AGENT_KEY);
  if (!seoAgentProfile?.profile_text) {
    res.status(409).json({ error: "SEO Agent profile is not available" });
    return;
  }

  const promptInput = normalizeSeoSuggestionRequestBody(req.body, item);
  if (!promptInput.title && !promptInput.excerpt && !promptInput.body_plain_text) {
    res.status(400).json({ error: "title, excerpt, or body is required before generating SEO metadata" });
    return;
  }

  try {
    const result = await executeBackendAiJson({
      aiConfig,
      featureKey: "seoAgent",
      task: "seo_metadata_suggestion",
      prompt: buildSeoSuggestionPrompt(promptInput, seoAgentProfile.profile_text),
    });
    const parsed = result?.parsed || parseJsonLike(String(result?.outputText || ""));
    const suggestion = normalizeSeoSuggestion(parsed);
    if (!suggestion) {
      throw new Error("SEO Agent returned empty or invalid JSON suggestions");
    }
    res.json({
      ok: true,
      suggestion,
      agent_key: SEO_AGENT_KEY,
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot generate SEO metadata suggestions");
    const status = /configured|required/i.test(msg) ? 409 : /invalid|empty|json/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/article-suggestion", requireRole("owner", "admin", "editor", "user"), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureArticleComposerEditAccess(req, res, item)) {
    return;
  }

  const aiConfig = getEffectiveAiConfig();
  if (!aiConfig?.enabled) {
    res.status(409).json({ error: "AI backend is not configured for article suggestions" });
    return;
  }

  const articleAgentProfile = getEffectiveAgentProfile(ARTICLE_AGENT_KEY);
  if (!articleAgentProfile?.profile_text) {
    res.status(409).json({ error: "Article Agent profile is not available" });
    return;
  }

  const latestDraft = repo.latestDraftByItem(id) || null;
  const fieldPack = repo.getCurrentFieldPackByItem(id) || null;
  const processPayload = buildArticleProcessPayload(req, item);
  const selectedAssets = repo.listContentAssetsByItem(id, { onlySelected: true });
  const source = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? {
        ...req.body,
        field_pack: req.body.field_pack && typeof req.body.field_pack === "object" ? req.body.field_pack : fieldPack,
        publishable_source: req.body.publishable_source && typeof req.body.publishable_source === "object"
          ? req.body.publishable_source
          : processPayload?.publishable_source || null,
        selected_assets: selectedAssets,
        latest_draft: req.body.latest_draft && typeof req.body.latest_draft === "object" ? req.body.latest_draft : latestDraft,
      }
    : {
        field_pack: fieldPack,
        publishable_source: processPayload?.publishable_source || null,
        selected_assets: selectedAssets,
        latest_draft: latestDraft,
      };
  const promptInput = normalizeArticleSuggestionRequestBody(source, item);
  if (!promptInput.title && !promptInput.excerpt && !promptInput.body_html && !promptInput.body_blocks_text && !promptInput.field_pack && !promptInput.publishable_source) {
    res.status(400).json({ error: "title, excerpt, body, or source material is required before generating article draft" });
    return;
  }

  try {
    const result = await executeBackendAiJson({
      aiConfig,
      featureKey: "articleGenerator",
      task: "article_draft_suggestion",
      prompt: buildArticleSuggestionPrompt(promptInput, articleAgentProfile.profile_text),
    });
    const parsed = result?.parsed || parseJsonLike(String(result?.outputText || ""));
    const suggestion = normalizeArticleSuggestion(parsed);
    if (!suggestion || !suggestion.title || !suggestion.excerpt || !suggestion.body) {
      throw new Error("Article Agent returned empty or invalid JSON suggestions");
    }
    res.json({
      ok: true,
      suggestion,
      agent_key: ARTICLE_AGENT_KEY,
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot generate article draft suggestions");
    const status = /configured|required/i.test(msg) ? 409 : /invalid|empty|json/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/items/:id/workflow-model", requireRole("owner", "admin", "editor", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const model = repo.ensureWorkflowModel(id);
  const transitions = repo.listWorkflowTransitionsByItem(id, Number(req.query.limit || 30));
  const drift = repo.getWorkflowStateDriftByItem(id);
  res.json({ item_id: id, model, transitions, drift });
});

app.get("/api/items/:id/article-process", requireRole("owner", "admin", "editor", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureArticleProcessReadAccess(req, res, item)) {
    return;
  }
  res.json(buildArticleProcessPayload(req, item));
});

app.post("/api/items/:id/article-process/transition", requireRole("owner", "admin", "editor", "user"), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const nextStatus = normalizeArticleProcessStatus(req.body?.status, "");
  if (!nextStatus) {
    res.status(400).json({ error: "invalid article process status" });
    return;
  }
  if (nextStatus === "synced_to_admin") {
    res.status(409).json({ error: "synced_to_admin is set by the publish/sync step, not by manual transition" });
    return;
  }
  if (!canTransitionArticleProcessByRole(req, nextStatus)) {
    res.status(403).json({ error: "role นี้ไม่มีสิทธิ์เปลี่ยน article process ไปสถานะนี้" });
    return;
  }
  if (!ensureArticleProcessTransitionAccess(req, res, item, nextStatus)) {
    return;
  }

  const workflowModel = repo.ensureWorkflowModel(id);
  const publishableSource = repo.buildPublishableSourceByItem(id);
  const currentStatus = deriveArticleProcessStatus(item, workflowModel, publishableSource);
  if (!canTransitionArticleProcess(currentStatus, nextStatus)) {
    res.status(409).json({ error: `invalid article process transition: ${currentStatus} -> ${nextStatus}` });
    return;
  }

  const note = String(req.body?.note || "").trim() || null;
  const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || `article_process_${nextStatus}`;

  try {
    if (nextStatus === "ready_for_sync") {
      await finalizeArticleProcessReadyForSync(req, item, currentStatus, note, reasonCode);
    } else {
      transitionArticleProcessState(req, item, currentStatus, nextStatus, note, reasonCode);
    }
    const nextItem = repo.getItem(id) || item;
    res.json({ ok: true, ...buildArticleProcessPayload(req, nextItem) });
  } catch (err) {
    const msg = String(err?.message || "Cannot transition article process");
    const status = /invalid .*transition|cannot transition|latest draft is required|review prerequisite missing|stale review report|quality gate failed/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/article-process/submit-review", requireRole("owner", "admin", "editor", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  const isDebugDiagnosticsEnabled = String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!canTransitionArticleProcessByRole(req, "ready_for_review")) {
    res.status(403).json({ error: "role นี้ไม่มีสิทธิ์ส่งบทความเข้าตรวจ" });
    return;
  }
  if (!ensureArticleProcessTransitionAccess(req, res, item, "ready_for_review")) {
    return;
  }

  const workflowModel = repo.ensureWorkflowModel(id);
  const publishableSource = repo.buildPublishableSourceByItem(id);
  const currentStatus = deriveArticleProcessStatus(item, workflowModel, publishableSource);
  if (!canTransitionArticleProcess(currentStatus, "ready_for_review")) {
    res.status(409).json({ error: `invalid article process transition: ${currentStatus} -> ready_for_review` });
    return;
  }

  const role = actorPolicyRole(req);
  const note = String(req.body?.note || "").trim() || "submitted from article workspace";
  const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "article_process_ready_for_review";

  try {
    let submitReviewDiagnostics = null;
    const editorialAssignment = listEditorialAssignmentsByItem(id).find((assignment) => {
      const assignmentKind = String(assignment?.assignment_kind || "").trim().toLowerCase();
      const assignmentState = String(assignment?.state || "").trim().toLowerCase();
      return assignmentKind === "editorial"
        && hasAssignmentSubmissionAccess(req, assignment, role)
        && ["assigned", "in_progress", "revision_requested"].includes(assignmentState);
    }) || null;

    if (editorialAssignment?.id) {
      const assignmentBeforeSubmit = repo.getAssignmentById(editorialAssignment.id);
      const assignmentLatestSubmissionIdBeforeSubmit = Number(assignmentBeforeSubmit?.latest_submission_id || 0) || null;
      const latestDraftBeforeSubmit = repo.latestDraftByItem(id);
      const latestDraftBodyBeforeSubmit = String(latestDraftBeforeSubmit?.body || "").trim();
      if (!latestDraftBodyBeforeSubmit) {
        res.status(409).json({
          ok: false,
          error: "latest draft body is required before submit-review",
          failure_reason: "missing_latest_draft_body",
          latest_draft_id: Number(latestDraftBeforeSubmit?.id || 0) || null,
          latest_draft_body_length: String(latestDraftBeforeSubmit?.body || "").trim().length,
        });
        return;
      }

      const assignmentState = String(editorialAssignment.state || "").trim().toLowerCase();
      const submissionState = assignmentState === "revision_requested" ? "resubmitted" : "submitted";
      const submissionAction = submissionState === "resubmitted" ? "resubmit" : "submit";
      const submission = repo.addAssignmentSubmission({
        assignment_id: editorialAssignment.id,
        submitted_by_user_id: req.authUser?.id,
        submission_state: submissionState,
        contributor_note: note,
      });
      const assignmentAfterSubmission = repo.setAssignmentLatestSubmission(editorialAssignment.id, submission.id);
      const assignmentLatestSubmissionIdAfterSubmit = Number(assignmentAfterSubmission?.latest_submission_id || 0) || null;
      const latestDraft = repo.latestDraftByItem(id);
      const latestDraftBody = String(latestDraft?.body || "").trim();
      if (!latestDraftBody) {
        res.status(409).json({
          ok: false,
          error: "latest draft body is required before submit-review",
          failure_reason: "missing_latest_draft_body",
          submission_id: Number(submission?.id || 0) || null,
          latest_draft_id: Number(latestDraft?.id || 0) || null,
          latest_draft_body_length: latestDraftBody.length,
        });
        return;
      }
      const draftDeliverable = repo.createAssignmentSubmissionDeliverable({
        assignment_id: editorialAssignment.id,
        submission_id: submission.id,
        content_item_id: id,
        deliverable_type: "article_draft",
        title: String(latestDraft?.draft_title || item.title || "").trim() || null,
        lang: String(item?.lang || "th").trim().toLowerCase() || "th",
        text_content: latestDraftBody,
        payload_json: {
          excerpt: String(latestDraft?.excerpt || "").trim() || null,
          meta_title: String(latestDraft?.meta_title || "").trim() || null,
          meta_description: String(latestDraft?.meta_description || "").trim() || null,
          draft_id: Number(latestDraft?.id || 0) || null,
          generation_run_uid: String(latestDraft?.generation_run_uid || "").trim() || null,
        },
        status: "submitted",
      }, actorEmail(req));
      const publishableSourceAfterSubmit = repo.buildPublishableSourceByItem(id);
      if (isDebugDiagnosticsEnabled) {
        submitReviewDiagnostics = {
          submission_id: Number(submission?.id || 0) || null,
          assignment_latest_submission_id_before_submit: assignmentLatestSubmissionIdBeforeSubmit,
          assignment_latest_submission_id_after_submit: assignmentLatestSubmissionIdAfterSubmit,
          latest_draft_id: Number(latestDraft?.id || 0) || null,
          latest_draft_body_length: latestDraftBody.length,
          latest_draft_title: String(latestDraft?.draft_title || item.title || "").trim() || null,
          article_draft_deliverable_id: Number(draftDeliverable?.id || 0) || null,
          article_draft_deliverable_created: Boolean(Number(draftDeliverable?.id || 0)),
          deliverable_type: String(draftDeliverable?.deliverable_type || "").trim() || "article_draft",
          deliverable_text_length: String(draftDeliverable?.text_content || "").trim().length,
          deliverable_status: String(draftDeliverable?.status || "").trim() || null,
          publishable_source: {
            article_draft_deliverable_id: Number(publishableSourceAfterSubmit?.article_draft_deliverable_id || 0) || null,
            article_draft_body_length: Number(publishableSourceAfterSubmit?.article_draft_body_length || 0) || 0,
            ready_for_publish_source: Boolean(publishableSourceAfterSubmit?.ready_for_publish_source),
          },
        };
      }
      const handoffCleanup = clearExternalUsableMediaAtHandoff(id, {
        req,
        submissionId: Number(submission?.id || 0) || null,
      });
      if (isDebugDiagnosticsEnabled && handoffCleanup.cleared.length > 0) {
        submitReviewDiagnostics = {
          ...(submitReviewDiagnostics || {}),
          external_media_cleanup: handoffCleanup,
        };
      }
      repo.updateAssignmentState(editorialAssignment.id, submissionState, actorEmail(req), {
        actor_role: role,
        reason_code: ASSIGNMENT_REASON_CODE_DEFAULTS[submissionAction],
      });
      repo.logAudit(actorEmail(req), `assignment.submission.${submissionAction}`, "content_item", String(id), {
        assignment_id: editorialAssignment.id,
        submission_id: submission?.id || null,
        submission_state: submissionState,
        article_draft_deliverable_id: draftDeliverable?.id || null,
      });
    } else if (role === "editor") {
      res.status(403).json({ error: "editor ต้องมี editorial assignment ที่พร้อม submit หรือ resubmit ก่อนส่งบทความเข้าตรวจ" });
      return;
    }

    if (!editorialAssignment?.id) {
      const handoffCleanup = clearExternalUsableMediaAtHandoff(id, { req });
      if (isDebugDiagnosticsEnabled && handoffCleanup.cleared.length > 0) {
        submitReviewDiagnostics = {
          ...(submitReviewDiagnostics || {}),
          external_media_cleanup: handoffCleanup,
        };
      }
    }

    transitionArticleProcessState(req, item, currentStatus, "ready_for_review", note, reasonCode);
    const nextItem = repo.getItem(id) || item;
    const responsePayload = { ok: true, ...buildArticleProcessPayload(req, nextItem) };
    if (isDebugDiagnosticsEnabled && submitReviewDiagnostics) responsePayload.submit_review_diagnostics = submitReviewDiagnostics;
    res.json(responsePayload);
  } catch (err) {
    const msg = String(err?.message || "Cannot submit article for review");
    if (String(err?.failure_reason || "").trim().toLowerCase() === "missing_latest_draft_body") {
      res.status(409).json({ ok: false, error: msg, failure_reason: "missing_latest_draft_body" });
      return;
    }
    const status = /invalid .*transition|cannot transition|duplicate submission|requires revision_requested|use resubmitted/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/items/:id/transitions", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const limit = Number(req.query.limit || 100);
  const stateGroup = String(req.query.state_group || "").trim().toLowerCase();
  const actorFilter = String(req.query.actor_email || "").trim().toLowerCase();
  const reasonFilter = String(req.query.reason_code || "").trim().toLowerCase();
  let transitions;
  try {
    transitions = repo.listWorkflowTransitionsByItem(id, limit, {
      state_group: stateGroup || null,
      actor_email: actorFilter || null,
      reason_code: reasonFilter || null,
    });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot list transitions") });
    return;
  }
  res.json({ item_id: id, transitions });
});

app.get("/api/items/:id/audit-logs", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const limit = Number(req.query.limit || 100);
  const action = String(req.query.action || "").trim().toLowerCase();
  const actionPrefix = String(req.query.action_prefix || "").trim().toLowerCase();
  const actorFilter = String(req.query.actor_email || "").trim().toLowerCase();
  const logs = repo.listAuditByTarget("content_item", String(id), limit, {
    action: action || null,
    action_prefix: actionPrefix || null,
    actor_email: actorFilter || null,
  });
  res.json({ item_id: id, logs });
});

app.put("/api/items/:id/workflow-model", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  const actorRole = actorPolicyRole(req);
  const patch = {};
  const productionState = normalizeEnum(req.body?.production_state, PRODUCTION_STATES);
  const publicationState = normalizeEnum(req.body?.publication_state, PUBLICATION_STATES);
  const assignmentState = req.body?.assignment_state == null
    ? ""
    : normalizeEnum(req.body?.assignment_state, ASSIGNMENT_STATES);
  const note = req.body?.last_transition_note == null ? null : String(req.body.last_transition_note || "").trim();

  if (productionState) patch.production_state = productionState;
  if (publicationState) patch.publication_state = publicationState;
  if (req.body?.assignment_state != null) {
    if (!assignmentState && String(req.body.assignment_state || "").trim() !== "") {
      res.status(400).json({ error: "invalid assignment_state" });
      return;
    }
    patch.assignment_state = assignmentState || null;
  }
  if (note != null) patch.last_transition_note = note || null;

  if (actorRole === "user") {
    const disallowedPublication = Boolean(patch.publication_state);
    const disallowedAssignment = req.body?.assignment_state != null;
    const disallowedProduction = patch.production_state && patch.production_state !== "ready_for_content";
    if (disallowedPublication || disallowedAssignment || disallowedProduction) {
      res.status(403).json({ error: "user/editor can only set production_state=ready_for_content" });
      return;
    }
  }

  if (!Object.keys(patch).length) {
    res.status(400).json({ error: "no valid state fields provided" });
    return;
  }

  try {
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || null;
    const model = repo.upsertWorkflowModel(id, patch, actorEmail(req), {
      actor_role: actorRole,
      reason_code: reasonCode,
    });
    repo.logAudit(actorEmail(req), "workflow_model.update", "content_item", String(id), {
      ...patch,
      reason_code: reasonCode,
    });
    let readiness = null;
    try {
      readiness = repo.recomputeReadinessBriefByItem(id, actorEmail(req));
      repo.logAudit(actorEmail(req), "readiness_brief.recompute", "content_item", String(id), {
        source: "workflow_model.update",
        readiness_id: readiness?.id || null,
        reason_code: WORKFLOW_REASON_CODES.READINESS_RECOMPUTED,
        source_reason_code: reasonCode || null,
      });
    } catch {
      readiness = null;
    }
    res.json({ ok: true, item_id: id, model, readiness });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot update workflow model") });
  }
});

app.get("/api/items/:id/intelligence-model/latest", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const model = repo.getLatestIntelligenceModelByItem(id);
  res.json({ item_id: id, model: model || null });
});

app.post("/api/items/:id/intelligence-model", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  try {
    const model = repo.addIntelligenceModel({ ...req.body, content_item_id: id, computed_by: actorEmail(req) });
    repo.logAudit(actorEmail(req), "intelligence_model.add", "content_item", String(id), { model_id: model?.id || null });
    res.status(201).json({ ok: true, item_id: id, model });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot create intelligence model") });
  }
});

app.get("/api/items/:id/readiness/latest", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const latest = repo.getLatestReadinessBriefByItem(id);
  const drift = repo.getWorkflowStateDriftByItem(id);
  res.json({ item_id: id, readiness: latest?.readiness_json || null, snapshot: latest || null, drift });
});

app.get("/api/items/:id/brief/latest", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const latest = repo.getLatestReadinessBriefByItem(id);
  const drift = repo.getWorkflowStateDriftByItem(id);
  res.json({ item_id: id, brief: latest?.brief_json || null, snapshot: latest || null, drift });
});

app.post("/api/items/:id/recompute-readiness-brief", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  try {
    const snapshot = repo.recomputeReadinessBriefByItem(id, actorEmail(req));
    const readiness = snapshot?.readiness_json || {};
    const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
    const missingRequirements = Array.isArray(readiness?.missing_requirements) ? readiness.missing_requirements : [];
    repo.logAudit(actorEmail(req), "readiness_brief.recompute", "content_item", String(id), {
      source: "manual_api",
      readiness_id: snapshot?.id || null,
      ready_for_content: Boolean(readiness?.ready_for_content),
      ready_for_publish: Boolean(readiness?.ready_for_publish),
      blockers_count: blockers.length,
      missing_requirements_count: missingRequirements.length,
      reason_code: WORKFLOW_REASON_CODES.READINESS_RECOMPUTED,
    });
    res.json({
      ok: true,
      item_id: id,
      readiness: snapshot?.readiness_json || null,
      brief: snapshot?.brief_json || null,
      snapshot: snapshot || null,
    });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot recompute readiness/brief") });
  }
});

app.get("/api/items/:id/execution-controls/latest", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  try {
    const readiness = repo.getLatestReadinessBriefByItem(id);
    if (!readiness?.id) {
      res.status(409).json({ error: "readiness snapshot is required before querying execution controls" });
      return;
    }
    const controls = repo.getLatestExecutionControlsByItem(id);
    res.json({ item_id: id, controls: controls || null });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot get execution controls") });
  }
});

app.post("/api/items/:id/recompute-execution-controls", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  try {
    const snapshot = repo.recomputeExecutionControlsByItem(id, actorEmail(req));
    repo.logAudit(actorEmail(req), "execution_controls.derive", "content_item", String(id), {
      source_readiness_brief_id: snapshot?.source_readiness_brief_id || null,
      status: Array.isArray(snapshot?.blockers_json) && snapshot.blockers_json.length > 0 ? "blocked" : "derived",
      blockers_count: Array.isArray(snapshot?.blockers_json) ? snapshot.blockers_json.length : 0,
      missing_requirements_count: Array.isArray(snapshot?.missing_requirements_json) ? snapshot.missing_requirements_json.length : 0,
      reason_code: WORKFLOW_REASON_CODES.EXECUTION_CONTROLS_DERIVED,
    });
    res.json({ ok: true, item_id: id, controls: snapshot || null });
  } catch (err) {
    const msg = String(err?.message || "Cannot recompute execution controls");
    const status = /readiness snapshot is required/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/items/:id/execution-channels", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const channels = repo.listExecutionChannelsByItem(id);
  const latestByChannel = {};
  for (const channel of EXECUTION_CHANNELS) {
    latestByChannel[channel] = repo.getLatestExecutionChannelByItemAndChannel(id, channel);
  }
  const coverage = repo.getExecutionChannelCoverageByItem(id);
  res.json({ item_id: id, channels, latest_by_channel: latestByChannel, coverage });
});

app.get("/api/items/:id/execution-readiness", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  try {
    const summary = repo.evaluateExecutionReadinessByItem(id);
    const drift = repo.getWorkflowStateDriftByItem(id);
    res.json({ item_id: id, summary, drift });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate execution readiness") });
  }
});

app.get("/api/items/:id/execution-readiness/:channel", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const channel = String(req.params.channel || "").trim().toLowerCase();
  if (!EXECUTION_CHANNELS.has(channel)) {
    res.status(400).json({ error: "channel must be one of: facebook, tiktok" });
    return;
  }
  try {
    const readiness = repo.evaluateExecutionReadinessByItem(id, channel);
    const drift = repo.getWorkflowStateDriftByItem(id);
    res.json({ item_id: id, channel, readiness, drift });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate execution readiness for channel") });
  }
});

app.post("/api/items/:id/execution-readiness/evaluate", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  try {
    const summary = repo.evaluateExecutionReadinessByItem(id);
    const governance = repo.buildGovernanceSummaryByItem(id);
    const drift = repo.getWorkflowStateDriftByItem(id);
    for (const channel of EXECUTION_CHANNELS) {
      const row = summary?.channels?.[channel] || null;
      repo.logAudit(actorEmail(req), "execution_readiness.evaluate", "content_item", String(id), {
        channel,
        source_readiness_brief_id: row?.source_readiness_brief_id || null,
        source_controls_id: row?.source_controls_id || null,
        source_execution_channel_id: row?.source_execution_channel_id || null,
        ready_for_execution: Boolean(row?.ready_for_execution),
        blockers_count: Array.isArray(row?.blockers) ? row.blockers.length : 0,
        missing_requirements_count: Array.isArray(row?.missing_requirements) ? row.missing_requirements.length : 0,
        execution_validation_status: row?.debug?.execution_validation_status || null,
        ready_for_content: Boolean(governance?.readiness?.ready_for_content),
        ready_for_publish: Boolean(governance?.readiness?.ready_for_publish),
        ready_for_handoff: Boolean(governance?.handoff?.ready_for_handoff),
        legacy_workflow_status_mismatch: Boolean(drift?.mismatch_flags?.workflow_status_mismatch),
        legacy_workflow_status: drift?.source_workflow_status || null,
        workflow_head_derived_status: drift?.derived_workflow_status || null,
        reason_code: WORKFLOW_REASON_CODES.EXECUTION_READINESS_EVALUATED,
      });
    }
    res.json({ ok: true, item_id: id, summary, governance, drift });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate execution readiness") });
  }
});

app.get("/api/items/:id/governance-summary", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  try {
    const summary = repo.buildGovernanceSummaryByItem(id);
    const drift = repo.getWorkflowStateDriftByItem(id);
    res.json({ item_id: id, summary, drift });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot build governance summary") });
  }
});

app.post("/api/items/:id/governance-summary/evaluate", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  try {
    const summary = repo.buildGovernanceSummaryByItem(id);
    const drift = repo.getWorkflowStateDriftByItem(id);
    repo.logAudit(actorEmail(req), "handoff_readiness.evaluate", "content_item", String(id), {
      content_item_id: id,
      source_readiness_brief_id: summary?.source_readiness_brief_id || null,
      source_controls_id: summary?.source_controls_id || null,
      source_execution_channels: summary?.source_execution_channels || null,
      ready_for_content: Boolean(summary?.readiness?.ready_for_content),
      ready_for_execution: Boolean(summary?.execution?.ready_for_execution),
      ready_for_publish: Boolean(summary?.readiness?.ready_for_publish),
      ready_for_handoff: Boolean(summary?.handoff?.ready_for_handoff),
      blockers_count: Array.isArray(summary?.handoff?.blockers) ? summary.handoff.blockers.length : 0,
      missing_requirements_count: Array.isArray(summary?.handoff?.missing_requirements) ? summary.handoff.missing_requirements.length : 0,
      reason_code: WORKFLOW_REASON_CODES.HANDOFF_READINESS_EVALUATED,
    });
    res.json({ ok: true, item_id: id, summary, drift });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate governance summary") });
  }
});

app.get("/api/items/:id/execution-channels/:channel/latest", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const channel = String(req.params.channel || "").trim().toLowerCase();
  if (!EXECUTION_CHANNELS.has(channel)) {
    res.status(400).json({ error: "channel must be one of: facebook, tiktok" });
    return;
  }
  const latest = repo.getLatestExecutionChannelByItemAndChannel(id, channel);
  const coverage = repo.getExecutionChannelCoverageByItem(id);
  res.json({
    item_id: id,
    channel,
    latest: latest || null,
    source_readiness_brief_id: latest?.source_readiness_brief_id || null,
    coverage: coverage?.channel_status?.[channel] || null,
  });
});

app.post("/api/items/:id/execution-channels", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  try {
    const payload = { ...(req.body || {}), content_item_id: id };
    const isUpdate = Number(payload.id || 0) > 0;
    const record = repo.createExecutionChannelRecord(payload, actorEmail(req));
    const action = isUpdate ? "execution_channel.update" : "execution_channel.create";
    repo.logAudit(actorEmail(req), action, "content_item", String(id), {
      execution_channel_id: record?.id || null,
      source_readiness_brief_id: record?.source_readiness_brief_id || null,
      channel: record?.channel || null,
      lang: record?.lang || null,
      status: record?.status || null,
    });
    res.status(isUpdate ? 200 : 201).json({
      ok: true,
      item_id: id,
      execution_channel: record,
      source_readiness_brief_id: record?.source_readiness_brief_id || null,
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot create execution channel");
    const status = /readiness snapshot is required|source_readiness_brief_id|channel does not match/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/execution-channels/:channel/validate-latest", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  const channel = String(req.params.channel || "").trim().toLowerCase();
  if (!EXECUTION_CHANNELS.has(channel)) {
    res.status(400).json({ error: "channel must be one of: facebook, tiktok" });
    return;
  }
  try {
    const result = repo.validateLatestExecutionChannelByItemAndChannel(id, channel, actorEmail(req));
    const validation = result?.validation || {};
    repo.logAudit(actorEmail(req), "execution_channel.validate", "content_item", String(id), {
      channel,
      source_readiness_brief_id: result?.source_readiness_brief_id || null,
      status: validation?.validation_status || null,
      blockers_count: Array.isArray(validation?.blockers) ? validation.blockers.length : 0,
      missing_requirements_count: Array.isArray(validation?.missing_requirements) ? validation.missing_requirements.length : 0,
    }, {
      assignment_id: null,
    });
    repo.logAudit(actorEmail(req), "execution_channel.validate", "execution_channel", String(result?.execution_channel?.id || ""), {
      content_item_id: id,
      channel,
      source_readiness_brief_id: result?.source_readiness_brief_id || null,
      status: validation?.validation_status || null,
      blockers_count: Array.isArray(validation?.blockers) ? validation.blockers.length : 0,
      missing_requirements_count: Array.isArray(validation?.missing_requirements) ? validation.missing_requirements.length : 0,
    });
    res.json({ ok: true, item_id: id, channel, result });
  } catch (err) {
    const msg = String(err?.message || "Cannot validate execution channel");
    const status = /execution controls snapshot is required|readiness snapshot is required/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/execution-channels/:channel/generate", requireRole("admin", "user"), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  const channel = String(req.params.channel || "").trim().toLowerCase();
  if (!EXECUTION_CHANNELS.has(channel)) {
    res.status(400).json({ error: "channel must be one of: facebook, tiktok" });
    return;
  }
  try {
    const aiConfig = getEffectiveAiConfig();
    const result = await generateExecutionChannelForItem(repo, id, channel, {
      actorEmail: actorEmail(req),
      actorRole: actorPolicyRole(req),
      aiConfig,
    });
    const action = channel === "facebook" ? "execution_channel.generate.facebook" : "execution_channel.generate.tiktok";
    repo.logAudit(actorEmail(req), action, "content_item", String(id), {
      source_readiness_brief_id: result?.source_readiness_brief_id || null,
      channel,
      status: result?.execution_channel?.status || null,
      generated_by: result?.generated_by || null,
      used_controls_id: result?.source_controls_id || null,
      generation_mode: result?.generation_mode || null,
      regenerated: Boolean(result?.regenerated),
    });
    repo.logAudit(actorEmail(req), action, "execution_channel", String(result?.execution_channel?.id || ""), {
      content_item_id: id,
      source_readiness_brief_id: result?.source_readiness_brief_id || null,
      channel,
      status: result?.execution_channel?.status || null,
      generated_by: result?.generated_by || null,
      used_controls_id: result?.source_controls_id || null,
      generation_mode: result?.generation_mode || null,
      regenerated: Boolean(result?.regenerated),
    });
    res.status(result?.regenerated ? 200 : 201).json({
      ok: true,
      item_id: id,
      channel,
      result,
    });
  } catch (err) {
    const reasonCode = String(err?.code || "").trim();
    const prereqSummary = err?.prereq_summary && typeof err.prereq_summary === "object" ? err.prereq_summary : null;
    if (reasonCode === "readiness_not_ready_for_content" || reasonCode === "execution_controls_blocked" || reasonCode === "execution_controls_missing_requirements") {
      const rejectedAction =
        channel === "facebook" ? "execution_channel.generate.rejected.facebook" : "execution_channel.generate.rejected.tiktok";
      repo.logAudit(actorEmail(req), rejectedAction, "content_item", String(id), {
        channel,
        source_readiness_brief_id: prereqSummary?.source_readiness_brief_id || null,
        source_controls_id: prereqSummary?.source_controls_id || null,
        reason_code: reasonCode,
        blockers_count: Number(prereqSummary?.blockers_count || 0),
        missing_requirements_count: Number(prereqSummary?.missing_requirements_count || 0),
        ready_for_content: Boolean(prereqSummary?.ready_for_content),
      });
    }
    const msg = String(err?.message || "Cannot generate execution channel");
    const status =
      reasonCode === "readiness_not_ready_for_content" ||
      reasonCode === "execution_controls_blocked" ||
      reasonCode === "execution_controls_missing_requirements" ||
      /readiness snapshot is required|execution controls snapshot is required|stale/i.test(msg)
        ? 409
        : 400;
    res.status(status).json({
      error: reasonCode || msg,
      reason_code: reasonCode || null,
      prereq_summary: prereqSummary,
    });
  }
});

app.post("/api/items/:id/assignments/from-readiness", requireRole("owner"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  try {
    const role = actorPolicyRole(req);
    const forceOverride = Boolean(req.body?.force_override);
    const forceReason = String(req.body?.force_reason || "").trim();
    const requestedAssignmentKind = normalizeAssignmentKind(req.body?.assignment_kind, "field");
    if (!forceOverride || !forceReason) {
      res.status(400).json({
        error: "legacy from-readiness route requires force_override=true and force_reason",
      });
      return;
    }
    const assigneeId = Number(req.body?.assignee_user_id || 0);
    if (!assigneeId) {
      res.status(400).json({ error: "assignee_user_id is required" });
      return;
    }
    const assigneeRole = getUserAssignmentRole(assigneeId);
    if (!String(req.body?.assignment_kind || "").trim() && isInternalAssignmentRole(assigneeRole)) {
      res.status(400).json({ error: "assignment_kind is required when assigning work to an internal user" });
      return;
    }
    if (!canAssignInternalWork(role, req.authUser?.id, assigneeRole, assigneeId) || !canAssignToUserByManagementLine(req.authUser, assigneeId)) {
      res.status(403).json({ error: "assigner role cannot assign internal work to the selected user" });
      return;
    }
    const allowedAssigneeRoles = getAllowedAssigneeRolesForAssignmentKind(requestedAssignmentKind);
    if (!canAssignUserToAssignmentKind(requestedAssignmentKind, assigneeRole)) {
      res.status(400).json({ error: `assignment_kind=${requestedAssignmentKind} requires assignee role in [${allowedAssigneeRoles.join(", ") || "unknown"}]` });
      return;
    }
    const result = repo.createAssignmentFromReadiness(id, req.body || {}, req.authUser?.id || null, actorEmail(req), role);
    const mode = String(result?.guard?.mode || "readiness");
    const sourceOfTruth = String(result?.guard?.source_of_truth || "readiness_snapshot");
    const effectiveHandoffReady = Boolean(result?.preview?.ready_for_handoff);
    const effectiveHandoffBlockers = Array.isArray(result?.preview?.blockers) ? result.preview.blockers : [];
    const effectiveHandoffMissing = Array.isArray(result?.preview?.missing_requirements) ? result.preview.missing_requirements : [];
    const effectiveHandoffReasonCodes = Array.isArray(result?.preview?.reason_codes) ? result.preview.reason_codes : [];
    const workflowReasonCode = sourceOfTruth === "field_pack"
      ? WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC_FROM_FIELD_PACK
      : WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC_FROM_READINESS;
    const auditAction = sourceOfTruth === "field_pack"
      ? (mode === "forced" ? "assignment.create.forced_from_field_pack" : "assignment.create.from_field_pack")
      : (mode === "forced" ? "assignment.create.forced_from_readiness" : "assignment.create.from_readiness");
    const assignment = result?.assignment || null;
    repo.logAudit(actorEmail(req), auditAction, "assignment", String(assignment?.id || ""), {
      content_item_id: id,
      assignment_kind: assignment?.assignment_kind || requestedAssignmentKind,
      mode,
      force_reason: result?.guard?.force_reason || null,
      field_pack_id: result?.preview?.field_pack?.id || null,
      readiness_brief_id: result?.handoff?.readiness_brief_id || null,
      handoff_snapshot_id: result?.handoff?.id || null,
      source_of_truth: sourceOfTruth,
      brief_source: result?.guard?.brief_source || "none",
      brief_override_applied: Boolean(result?.guard?.brief_override_applied),
      source_controls_id: result?.preview?.governance_summary?.source_controls_id || null,
      source_execution_channels: result?.preview?.governance_summary?.source_execution_channels || null,
      ready_for_content: Boolean(result?.preview?.governance_summary?.readiness?.ready_for_content),
      ready_for_execution: Boolean(result?.preview?.governance_summary?.execution?.ready_for_execution),
      ready_for_publish: Boolean(result?.preview?.governance_summary?.readiness?.ready_for_publish),
      ready_for_handoff: effectiveHandoffReady,
      blockers_count: effectiveHandoffBlockers.length,
      missing_requirements_count: effectiveHandoffMissing.length,
      handoff_reason_codes: effectiveHandoffReasonCodes,
      reason_code: workflowReasonCode,
    }, {
      assignment_id: assignment?.id || null,
    });
    repo.logAudit(actorEmail(req), auditAction, "content_item", String(id), {
      assignment_id: assignment?.id || null,
      mode,
      force_reason: result?.guard?.force_reason || null,
      field_pack_id: result?.preview?.field_pack?.id || null,
      readiness_brief_id: result?.handoff?.readiness_brief_id || null,
      handoff_snapshot_id: result?.handoff?.id || null,
      source_of_truth: sourceOfTruth,
      brief_source: result?.guard?.brief_source || "none",
      brief_override_applied: Boolean(result?.guard?.brief_override_applied),
      source_controls_id: result?.preview?.governance_summary?.source_controls_id || null,
      source_execution_channels: result?.preview?.governance_summary?.source_execution_channels || null,
      ready_for_content: Boolean(result?.preview?.governance_summary?.readiness?.ready_for_content),
      ready_for_execution: Boolean(result?.preview?.governance_summary?.execution?.ready_for_execution),
      ready_for_publish: Boolean(result?.preview?.governance_summary?.readiness?.ready_for_publish),
      ready_for_handoff: effectiveHandoffReady,
      blockers_count: effectiveHandoffBlockers.length,
      missing_requirements_count: effectiveHandoffMissing.length,
      handoff_reason_codes: effectiveHandoffReasonCodes,
      reason_code: workflowReasonCode,
    }, {
      assignment_id: assignment?.id || null,
    });
    if (assignment?.workflow_sync?.applied) {
      repo.logAudit(actorEmail(req), "assignment.workflow_sync.initialized", "content_item", String(id), {
        assignment_id: assignment?.id || null,
        from_state: assignment.workflow_sync.from_state || null,
        to_state: assignment.workflow_sync.to_state || null,
        reason_code: assignment.workflow_sync.reason_code || WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC,
      }, {
        assignment_id: assignment?.id || null,
      });
      repo.logAudit(actorEmail(req), "assignment.workflow_sync.initialized", "assignment", String(assignment?.id || ""), {
        content_item_id: id,
        from_state: assignment.workflow_sync.from_state || null,
        to_state: assignment.workflow_sync.to_state || null,
        reason_code: assignment.workflow_sync.reason_code || WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC,
      }, {
        assignment_id: assignment?.id || null,
      });
    }
    let aiInputCleanup = null;
    try {
      aiInputCleanup = cleanupAiInputAssetsAfterAssignmentCreated(id);
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.post_create", "content_item", String(id), {
        assignment_id: assignment?.id || null,
        mode: "from_readiness",
        ...aiInputCleanup,
      }, {
        assignment_id: assignment?.id || null,
      });
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.post_create", "assignment", String(assignment?.id || ""), {
        content_item_id: id,
        mode: "from_readiness",
        ...aiInputCleanup,
      }, {
        assignment_id: assignment?.id || null,
      });
    } catch (cleanupErr) {
      const cleanupMessage = String(cleanupErr?.message || "post-create ai input cleanup failed");
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.error", "content_item", String(id), {
        assignment_id: assignment?.id || null,
        mode: "from_readiness",
        error: cleanupMessage,
      }, {
        assignment_id: assignment?.id || null,
      });
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.error", "assignment", String(assignment?.id || ""), {
        content_item_id: id,
        mode: "from_readiness",
        error: cleanupMessage,
      }, {
        assignment_id: assignment?.id || null,
      });
      aiInputCleanup = {
        ok: false,
        error: cleanupMessage,
      };
    }
    res.status(201).json({
      ok: true,
      item_id: id,
      assignment: result.assignment,
      handoff: result.handoff,
      guard: result.guard,
      ai_input_cleanup: aiInputCleanup,
      warning: aiInputCleanup?.ok === false ? "Assignment created but AI input cleanup failed" : null,
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot create assignment from readiness");
    const status = /not ready_for_content|not ready_for_handoff|readiness snapshot is required|force_reason is required/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/items/:id/assignments", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }
  const authUser = req.authUser || null;
  const assignments = filterAssignmentsByManagementLine(authUser, repo.listAssignmentsByItem(id));
  res.json({ item_id: id, assignments });
});

app.post("/api/items/:id/article-editorial-assignments", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  if (!canManageArticleEditorialAssignments(req)) {
    res.status(403).json({ error: "role นี้ไม่มีสิทธิ์มอบหมายงานเขียนบทความ" });
    return;
  }

  const assigneeId = Number(req.body?.assignee_user_id || 0) || 0;
  const externalAssigneeName = String(req.body?.assignee_name || "").trim();
  const externalAssigneeContact = String(req.body?.assignee_contact || "").trim();
  const isExternalAssignee = !assigneeId;
  if (!assigneeId && !externalAssigneeName) {
    res.status(400).json({ error: "assignee_user_id or assignee_name is required" });
    return;
  }

  let assigneeRole = "";
  if (!isExternalAssignee) {
    assigneeRole = getUserAssignmentRole(assigneeId);
    if (!canAssignUserToAssignmentKind("editorial", assigneeRole)) {
      res.status(400).json({ error: "editorial assignment requires assignee role in [editor, user, admin, owner]" });
      return;
    }
  }

  const role = actorPolicyRole(req);
  if (!isExternalAssignee && !canAssignToUserByManagementLine(req.authUser, assigneeId)) {
    res.status(403).json({ error: "assigner cannot assign article work outside the management subtree" });
    return;
  }
  if (!isExternalAssignee && !canAssignInternalWork(role, req.authUser?.id, assigneeRole, assigneeId)) {
    res.status(403).json({ error: "assigner role cannot assign article work to the selected user" });
    return;
  }

  try {
    const workflowModel = repo.ensureWorkflowModel(id);
    const activeEditorial = getPrimaryEditorialAssignment(id);
    const sameExternalAssignee =
      activeEditorial?.id
      && !Number(activeEditorial.assignee_user_id || 0)
      && isExternalAssignee
      && String(activeEditorial.assignee_display_name || activeEditorial.assignee_name || "").trim() === externalAssigneeName
      && String(activeEditorial.assignee_email || activeEditorial.assignee_contact || "").trim() === externalAssigneeContact;
    if (activeEditorial?.id && ((assigneeId && Number(activeEditorial.assignee_user_id || 0) === assigneeId) || sameExternalAssignee)) {
      res.json({
        ok: true,
        assignment: activeEditorial,
        article_process: buildArticleProcessPayload(req, item),
      });
      return;
    }
    if (activeEditorial?.id) {
      if (req.body?.replace_active !== true) {
        res.status(409).json({ error: "active editorial assignment already exists; set replace_active=true to reassign" });
        return;
      }
      repo.updateAssignmentState(activeEditorial.id, "closed", actorEmail(req), {
        actor_role: role,
        reason_code: "article_editorial_assignment_replaced",
        internal_note: String(req.body?.replace_note || "").trim() || "editorial assignment replaced",
      });
    }

    const assignment = repo.createAssignment(
      {
        content_item_id: id,
        assignee_user_id: assigneeId || null,
        assignee_name: isExternalAssignee ? externalAssigneeName : null,
        assignee_contact: isExternalAssignee ? externalAssigneeContact : null,
        external_assignee_profile_json: isExternalAssignee ? {
          name: externalAssigneeName,
          contact: externalAssigneeContact,
          kind: "editorial_external",
        } : null,
        assignment_kind: "editorial",
        state: "assigned",
        due_at: req.body?.due_at || null,
        brief_json: {
          item_id: id,
          title: item.title || "",
          summary: item.summary || "",
          production_state: workflowModel?.production_state || "",
          publication_state: workflowModel?.publication_state || "",
        },
        requirements_json: {
          article_process: true,
          requested_by_role: role,
        },
        internal_note: String(req.body?.internal_note || "").trim() || null,
      },
      req.authUser?.id || null,
      {
        actor_email: actorEmail(req),
        actor_role: role,
        reason_code: "article_editorial_assignment_created",
        note: "editorial assignment created via article process route",
      }
    );
    repo.upsertWorkflowModel(
      id,
      {
        production_state: "content_in_progress",
        publication_state: "draft",
        last_transition_note: String(req.body?.internal_note || "").trim() || "editorial assignment created",
      },
      actorEmail(req),
      {
        actor_role: role,
        reason_code: "article_process_assignment_created",
      }
    );
    repo.logAudit(actorEmail(req), "article_assignment.create", "content_item", String(id), {
      assignment_id: assignment?.id || null,
      assignee_user_id: assigneeId || null,
      assignee_name: isExternalAssignee ? externalAssigneeName : null,
      assignee_contact: isExternalAssignee ? externalAssigneeContact : null,
      assignment_kind: "editorial",
    }, {
      assignment_id: assignment?.id || null,
    });
    const nextItem = repo.getItem(id) || item;
    res.status(201).json({
      ok: true,
      assignment,
      article_process: buildArticleProcessPayload(req, nextItem),
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot create article editorial assignment");
    const status = /invalid .*transition|cannot transition|already exists/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/article-editorial-assignments/:assignmentId/request-revision", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  const assignmentId = Number(req.params.assignmentId || 0);
  if (!id || !assignmentId) {
    res.status(400).json({ error: "Invalid item or assignment id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment || Number(assignment.content_item_id || 0) !== id) {
    res.status(404).json({ error: "Editorial assignment not found for this item" });
    return;
  }
  if (!canSeeAssignmentByManagementLine(req.authUser, assignment)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (String(assignment.assignment_kind || "").trim().toLowerCase() !== "editorial") {
    res.status(409).json({ error: "assignment is not editorial" });
    return;
  }

  try {
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "article_revision_requested";
    const note = String(req.body?.note || "").trim() || "revision requested from article process";
    const updatedAssignment = repo.updateAssignmentState(assignmentId, "revision_requested", actorEmail(req), {
      actor_role: actorPolicyRole(req),
      reason_code: reasonCode,
      internal_note: note,
    });
    applyArticleNeedsRevisionWorkflowTransition(id, {
      actor: actorEmail(req),
      actorRole: actorPolicyRole(req),
      reasonCode,
      note,
    });
    repo.logAudit(actorEmail(req), "article_assignment.request_revision", "content_item", String(id), {
      assignment_id: assignmentId,
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    const nextItem = repo.getItem(id) || item;
    res.json({
      ok: true,
      assignment: updatedAssignment,
      article_process: buildArticleProcessPayload(req, nextItem),
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot request article revision");
    const status = /invalid .*transition|cannot transition/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/assignments", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  try {
    const role = actorPolicyRole(req);
    const assigneeId = Number(req.body?.assignee_user_id || 0);
    const assigneeRole = assigneeId ? getUserAssignmentRole(assigneeId) : "";
    const fallbackAssignmentKind = assigneeId ? getFallbackAssignmentKindForAssigneeRole(assigneeRole) : "field";
    const requestedAssignmentKind = normalizeAssignmentKind(req.body?.assignment_kind, fallbackAssignmentKind || "field");
    const externalAssigneeName = String(req.body?.assignee_name || "").trim();
    const externalAssigneeContact = String(req.body?.assignee_contact || "").trim();
    const externalAssigneeProfile = normalizeExternalAssigneeProfilePayload(
      req.body?.external_assignee_profile_json,
      externalAssigneeName,
      externalAssigneeContact
    );
    if (assigneeId && !String(req.body?.assignment_kind || "").trim() && isInternalAssignmentRole(assigneeRole)) {
      res.status(400).json({ error: "assignment_kind is required when assigning work to an internal user" });
      return;
    }
    if (assigneeId) {
      if (!canAssignToUserByManagementLine(req.authUser, assigneeId)) {
        res.status(403).json({ error: "assigner cannot assign work outside the management subtree" });
        return;
      }
      if (!canAssignInternalWork(role, req.authUser?.id, assigneeRole, assigneeId)) {
        res.status(403).json({ error: "assigner role cannot assign internal work to the selected user" });
        return;
      }
      const allowedAssigneeRoles = getAllowedAssigneeRolesForAssignmentKind(requestedAssignmentKind);
      if (!canAssignUserToAssignmentKind(requestedAssignmentKind, assigneeRole)) {
        res.status(400).json({ error: `assignment_kind=${requestedAssignmentKind} requires assignee role in [${allowedAssigneeRoles.join(", ") || "unknown"}]` });
        return;
      }
    }
    if (!assigneeId && (!externalAssigneeProfile?.name || (!externalAssigneeProfile.phone && !externalAssigneeProfile.email && !externalAssigneeProfile.line_id))) {
      res.status(400).json({ error: "external assignee requires name and at least one contact field (phone/email/line_id)" });
      return;
    }
    const normalizedPayload = {
      ...req.body,
      assignee_name: assigneeId ? null : externalAssigneeProfile?.name || externalAssigneeName || null,
      assignee_contact: assigneeId
        ? null
        : (
          externalAssigneeContact
          || externalAssigneeProfile?.phone
          || externalAssigneeProfile?.email
          || externalAssigneeProfile?.line_id
          || null
        ),
      external_assignee_profile_json: assigneeId ? null : externalAssigneeProfile,
      assignment_kind: requestedAssignmentKind,
      content_item_id: id,
    };
    let assignment = null;
    let handoff = null;
    let guard = null;
    let fieldPackAuditId = null;
    if (requestedAssignmentKind === "field") {
      const currentFieldPack = repo.getCurrentFieldPackByItem(id);
      const fieldPackPrerequisites = validateAssignmentCreateFieldPackPrerequisites(requestedAssignmentKind, currentFieldPack);
      if (!fieldPackPrerequisites.ok) {
        res.status(409).json({ error: fieldPackPrerequisites.error });
        return;
      }
      const fieldResult = repo.createAssignmentFromReadiness(
        id,
        normalizedPayload,
        req.authUser?.id || null,
        actorEmail(req),
        role,
        { requireReadyForHandoff: false }
      );
      assignment = fieldResult?.assignment || null;
      handoff = fieldResult?.handoff || null;
      fieldPackAuditId = Number(fieldResult?.preview?.field_pack?.id || 0) || null;
      guard = {
        ...(fieldResult?.guard || {}),
        mode: "field_pack_handoff",
        source_of_truth: "field_pack",
      };
    } else {
      assignment = repo.createAssignment(
        normalizedPayload,
        req.authUser?.id || null,
        {
          actor_email: actorEmail(req),
          actor_role: role,
          reason_code: WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC_MANUAL,
          note: "assignment created via direct request payload",
        }
      );
      handoff = null;
      guard = {
        mode: "direct_assignment",
        source_of_truth: "request_payload",
        brief_source: normalizedPayload.brief_json != null ? "request_payload" : "none",
        brief_override_applied: normalizedPayload.brief_json != null,
      };
    }
    const mode = String(guard?.mode || (requestedAssignmentKind === "field" ? "field_pack_handoff" : "direct_assignment"));
    const sourceOfTruth = String(guard?.source_of_truth || (requestedAssignmentKind === "field" ? "field_pack" : "request_payload"));
    repo.logAudit(actorEmail(req), "assignment.create", "content_item", String(id), {
      assignment_id: assignment?.id || null,
      mode,
      source_of_truth: sourceOfTruth,
      field_pack_id: requestedAssignmentKind === "field" ? fieldPackAuditId : null,
      handoff_snapshot_id: handoff?.id || null,
      brief_source: guard?.brief_source || (requestedAssignmentKind === "field" ? "field_pack" : "none"),
    }, {
      assignment_id: assignment?.id || null,
    });
    repo.logAudit(actorEmail(req), "assignment.create", "assignment", String(assignment?.id || ""), {
      content_item_id: id,
      assignment_kind: assignment?.assignment_kind || requestedAssignmentKind,
      assignee_user_id: assignment?.assignee_user_id || null,
      assignee_name: assignment?.assignee_name || null,
      assignee_contact: assignment?.assignee_contact || null,
      external_assignee_profile_json: assignment?.external_assignee_profile_json || null,
      state: assignment?.state || null,
      mode,
      source_of_truth: sourceOfTruth,
      field_pack_id: requestedAssignmentKind === "field" ? fieldPackAuditId : null,
      handoff_snapshot_id: handoff?.id || null,
      brief_source: guard?.brief_source || (requestedAssignmentKind === "field" ? "field_pack" : "none"),
    }, {
      assignment_id: assignment?.id || null,
    });
    if (assignment?.workflow_sync?.applied) {
      repo.logAudit(actorEmail(req), "assignment.workflow_sync.initialized", "content_item", String(id), {
        assignment_id: assignment?.id || null,
        mode,
        from_state: assignment.workflow_sync.from_state || null,
        to_state: assignment.workflow_sync.to_state || null,
        reason_code: assignment.workflow_sync.reason_code || WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC,
      }, {
        assignment_id: assignment?.id || null,
      });
      repo.logAudit(actorEmail(req), "assignment.workflow_sync.initialized", "assignment", String(assignment?.id || ""), {
        content_item_id: id,
        mode,
        from_state: assignment.workflow_sync.from_state || null,
        to_state: assignment.workflow_sync.to_state || null,
        reason_code: assignment.workflow_sync.reason_code || WORKFLOW_REASON_CODES.ASSIGNMENT_CREATED_SYNC,
      }, {
        assignment_id: assignment?.id || null,
      });
    }
    let aiInputCleanup = null;
    try {
      aiInputCleanup = cleanupAiInputAssetsAfterAssignmentCreated(id);
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.post_create", "content_item", String(id), {
        assignment_id: assignment?.id || null,
        mode,
        ...aiInputCleanup,
      }, {
        assignment_id: assignment?.id || null,
      });
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.post_create", "assignment", String(assignment?.id || ""), {
        content_item_id: id,
        mode,
        ...aiInputCleanup,
      }, {
        assignment_id: assignment?.id || null,
      });
    } catch (cleanupErr) {
      const cleanupMessage = String(cleanupErr?.message || "post-create ai input cleanup failed");
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.error", "content_item", String(id), {
        assignment_id: assignment?.id || null,
        mode,
        error: cleanupMessage,
      }, {
        assignment_id: assignment?.id || null,
      });
      repo.logAudit(actorEmail(req), "assignment.ai_input_cleanup.error", "assignment", String(assignment?.id || ""), {
        content_item_id: id,
        mode,
        error: cleanupMessage,
      }, {
        assignment_id: assignment?.id || null,
      });
      aiInputCleanup = {
        ok: false,
        error: cleanupMessage,
      };
    }
    res.status(201).json({
      ok: true,
      item_id: id,
      assignment,
      handoff,
      guard,
      ai_input_cleanup: aiInputCleanup,
      warning: aiInputCleanup?.ok === false ? "Assignment created but AI input cleanup failed" : null,
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot create assignment");
    const isConflict = /UNIQUE|constraint/i.test(msg);
    res.status(isConflict ? 409 : 400).json({ error: msg });
  }
});

app.get("/api/assignments/mine", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const limit = Number(req.query.limit || 50);
  const authRole = normalizeUserRole(req.authUser?.role, "user");
  const role = actorPolicyRole(req);
  const scope = String(req.query.scope || "").trim().toLowerCase();
  if (authRole === "freelance") {
    const actorId = Number(req.authUser?.id || 0) || 0;
    if (!actorId) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (scope === "managed" || scope === "review") {
      res.status(403).json({ error: "freelance can only access own actionable/submitted assignments" });
      return;
    }
    if (scope === "actionable") {
      const assignments = sortAssignmentsForList(
        repo
          .listAssignmentsByAssignee(actorId, limit)
          .filter((row) => new Set(["assigned", "in_progress", "revision_requested"]).has(String(row?.state || "").trim().toLowerCase()))
      ).slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
      res.json({ assignments });
      return;
    }
    if (scope === "submitted") {
      const assignments = buildSubmittedAssignmentsForActor(actorId, limit);
      res.json({ assignments });
      return;
    }
    if (String(req.query.assigned_by_me || "").trim() === "1") {
      res.status(403).json({ error: "freelance cannot query assignments by assigner scope" });
      return;
    }
    const assigneeId = Number(req.query.assignee_user_id || 0);
    if (assigneeId && assigneeId !== actorId) {
      res.status(403).json({ error: "freelance can view assignments only for itself" });
      return;
    }
    const assignments = repo.listAssignmentsByAssignee(actorId, limit);
    res.json({ assignments });
    return;
  }
  if (authRole === "editor" && (scope === "review" || scope === "managed")) {
    res.status(403).json({ error: "editor can only access own actionable/submitted assignments" });
    return;
  }
  if (scope === "actionable") {
    const assignments = authRole === "editor"
      ? sortAssignmentsForList(
        repo
          .listAssignmentsByAssignee(req.authUser?.id, limit)
          .filter((row) => new Set(["assigned", "in_progress", "revision_requested"]).has(String(row?.state || "").trim().toLowerCase()))
      ).slice(0, Math.max(1, Math.min(200, Number(limit) || 50)))
      : buildActionableAssignmentsForActor(req.authUser?.id, limit);
    res.json({ assignments });
    return;
  }
  if (scope === "managed") {
    const assignments = buildManagedAssignmentsForActor(req.authUser?.id, authRole, limit);
    res.json({ assignments });
    return;
  }
  if (scope === "submitted") {
    const assignments = buildSubmittedAssignmentsForActor(req.authUser?.id, limit);
    res.json({ assignments });
    return;
  }
  if (scope === "review") {
    const assigneeId = Number(req.query.assignee_user_id || 0);
    const includeTracking = authRole === "owner" && String(req.query.include_tracking || "").trim() === "1";
    const assignments = buildReviewAssignmentsForActor(req.authUser?.id, authRole, limit, {
      include_tracking: includeTracking,
    })
      .filter((row) => !assigneeId || Number(row?.assignee_user_id || 0) === assigneeId);
    res.json({ assignments });
    return;
  }
  const assignedByMe = String(req.query.assigned_by_me || "").trim() === "1";
  if (authRole === "editor" && assignedByMe) {
    res.status(403).json({ error: "editor can only access own assignee assignments" });
    return;
  }
  if (assignedByMe) {
    const assignments = filterAssignmentsByManagementLine(
      req.authUser,
      repo.listExternalAssignmentsByAssigner(req.authUser?.id, limit)
    );
    res.json({ assignments });
    return;
  }
  const assigneeId = Number(req.query.assignee_user_id || 0);
  if (!assigneeId) {
    if (authRole === "freelance" || authRole === "editor") {
      const assignments = repo.listAssignmentsByAssignee(req.authUser?.id, limit);
      res.json({ assignments });
      return;
    }
    if (authRole === "owner") {
      const assignments = repo.listAssignments(limit);
      res.json({ assignments });
      return;
    }
    if (authRole === "admin" || authRole === "user") {
      const assignments = buildManagedAssignmentsForActor(req.authUser?.id, authRole, limit);
      res.json({ assignments });
      return;
    }
    res.status(400).json({ error: "assignee_user_id or assigned_by_me=1 is required for non-freelance roles" });
    return;
  }
  if ((authRole === "editor" || authRole === "freelance") && Number(assigneeId || 0) !== Number(req.authUser?.id || 0)) {
    res.status(403).json({ error: "role can view assignments only for itself" });
    return;
  }
  if (
    (role === "admin" || role === "user")
    && Number(assigneeId || 0) !== Number(req.authUser?.id || 0)
    && !canSeeManagedWorkForUser(req.authUser, assigneeId)
  ) {
    res.status(403).json({ error: `${role} can view assignments only inside management scope` });
    return;
  }
  const assignments = filterAssignmentsByManagementLine(
    req.authUser,
    repo.listAssignmentsByAssignee(assigneeId, limit)
  );
  res.json({ assignments });
});

app.get("/api/assignments/:id", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({ assignment });
});

app.get("/api/assignments/:id/draft", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  if (!hasAssignmentDraftAccess(req, assignment)) {
    res.status(403).json({ error: "only assigned contributor can load this draft" });
    return;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  if (!actorId) {
    res.json({ draft: null });
    return;
  }
  try {
    repo.purgeExpiredAssignmentSubmissionDrafts(new Date().toISOString());
    const currentRound = resolveAssignmentCurrentRound(assignment);
    const prefill = repo.getAssignmentSubmissionDraftPrefill(assignmentId, actorId, {
      now: new Date().toISOString(),
      revision_round: currentRound,
    });
    res.json({ draft: prefill?.draft || null, source: prefill?.source || "none", revision_round: currentRound });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot load assignment draft") });
  }
});

app.put("/api/assignments/:id/draft", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  if (!hasAssignmentDraftAccess(req, assignment)) {
    res.status(403).json({ error: "only assigned contributor can save this draft" });
    return;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  if (!actorId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const expiresAt = deriveAssignmentDraftExpiryIso(assignment);
    const currentRound = resolveAssignmentCurrentRound(assignment);
    const normalizedDraftPayload = normalizeAssignmentDraftArticlePayload(req.body?.article_payload_json || null, assignment);
    const draft = repo.upsertAssignmentSubmissionDraft({
      assignment_id: assignmentId,
      user_id: actorId,
      revision_round: currentRound,
      article_payload_json: normalizedDraftPayload,
      expires_at: expiresAt,
    });
    res.json({ ok: true, draft, revision_round: currentRound });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot save assignment draft") });
  }
});

app.delete("/api/assignments/:id/draft", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  if (!hasAssignmentDraftAccess(req, assignment)) {
    res.status(403).json({ error: "only assigned contributor can delete this draft" });
    return;
  }
  const actorId = Number(req.authUser?.id || 0) || 0;
  if (!actorId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const currentRound = resolveAssignmentCurrentRound(assignment);
    const deleted = repo.deleteAssignmentSubmissionDraft(assignmentId, actorId, currentRound);
    res.json({ ok: true, deleted, revision_round: currentRound });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot delete assignment draft") });
  }
});

app.patch("/api/assignments/:id/state", requireRole("owner", "admin", "user"), async (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const currentAssignment = repo.getAssignmentById(assignmentId);
  if (!currentAssignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const fromState = String(currentAssignment.state || "").trim().toLowerCase() || null;
  const role = actorPolicyRole(req);
  const action = String(req.body?.action || "").trim().toLowerCase();
  const mappedState = action ? ASSIGNMENT_ACTION_TO_STATE[action] : "";
  const nextState = normalizeEnum(mappedState || req.body?.state, ASSIGNMENT_STATES);
  if (!nextState) {
    res.status(400).json({ error: "invalid assignment state" });
    return;
  }
  if (role === "user" && !["revision_requested", "in_progress", "accepted"].includes(nextState)) {
    res.status(403).json({ error: "user cannot set this assignment state" });
    return;
  }
  if (role === "user" && ["close_assignment"].includes(action)) {
    res.status(403).json({ error: "user cannot close assignment directly" });
    return;
  }

  try {
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || ASSIGNMENT_REASON_CODE_DEFAULTS[action] || null;
    const auditAction = ASSIGNMENT_STATE_AUDIT_ACTIONS[action] || "assignment.state.update";
    const isRevisionRequest = action === "request_revision" || nextState === "revision_requested";
    const resetPayload = isRevisionRequest
      ? resolveRevisionMediaResetPayload(req.body || {})
      : null;
    if (isRevisionRequest && resetPayload?.image_reset_required && !resetPayload?.image_reset_reason) {
      res.status(400).json({ error: "image_reset_reason is required when image_reset_required=true" });
      return;
    }
    if (isRevisionRequest && resetPayload?.video_reset_required && !resetPayload?.video_reset_reason) {
      res.status(400).json({ error: "video_reset_reason is required when video_reset_required=true" });
      return;
    }
    const revisionResult = isRevisionRequest
      ? repo.requestAssignmentRevisionWithReset(assignmentId, actorEmail(req), {
        contributor_note: req.body?.contributor_note,
        internal_note: req.body?.internal_note,
        actor_role: role,
        reason_code: reasonCode,
        ...(resetPayload || {}),
      })
      : null;
    const assignment = revisionResult?.assignment || repo.updateAssignmentState(assignmentId, nextState, actorEmail(req), {
      contributor_note: req.body?.contributor_note,
      internal_note: req.body?.internal_note,
      actor_role: role,
      reason_code: reasonCode,
    });
    if (isRevisionRequest && revisionResult) {
      for (const relativePath of Array.isArray(revisionResult?.deleted_files) ? revisionResult.deleted_files : []) {
        try {
          await fs.unlink(resolveStoragePath(relativePath));
        } catch {
          // keep reset flow idempotent even when physical file is already missing
        }
      }
    }
    const assignmentKind = String(currentAssignment.assignment_kind || "").trim().toLowerCase();
    const contentItemId = Number(assignment?.content_item_id || 0) || 0;
    if (assignmentKind === "field" && nextState === "accepted" && contentItemId) {
      clearExternalUsableMediaAtHandoff(contentItemId, { req });
      const workflowModel = repo.ensureWorkflowModel(contentItemId);
      const productionState = String(workflowModel?.production_state || "").trim().toLowerCase();
      const publicationState = String(workflowModel?.publication_state || "").trim().toLowerCase() || "draft";
      if (["collected", "analyzed", "brief_generated", "ready_for_content"].includes(productionState)) {
        repo.upsertWorkflowModel(
          contentItemId,
          {
            production_state: "content_in_progress",
            publication_state: publicationState === "published" ? "published" : "draft",
            last_transition_note: String(req.body?.internal_note || "").trim() || "field assignment accepted and promoted to article drafting",
          },
          actorEmail(req),
          {
            actor_role: role,
            reason_code: "field_assignment_accepted_promote_article",
            assignment_id: assignmentId,
          }
        );
      }
    }
    repo.logAudit(actorEmail(req), "assignment.state.update", "content_item", String(assignment?.content_item_id || ""), {
      assignment_id: assignmentId,
      action: action || null,
      next_state: nextState,
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    repo.logAudit(actorEmail(req), auditAction, "assignment", String(assignmentId), {
      content_item_id: assignment?.content_item_id || null,
      action: action || null,
      next_state: nextState,
      reason_code: reasonCode,
      role,
    }, {
      assignment_id: assignmentId,
    });
    const sourceAction = action || "state_patch";
    const workflowSyncDetails = {
      assignment_id: assignmentId,
      content_item_id: assignment?.content_item_id || null,
      from_state: fromState,
      to_state: String(assignment?.state || "").trim().toLowerCase() || nextState,
      source_action: sourceAction,
      reason_code: reasonCode,
    };
    repo.logAudit(actorEmail(req), "assignment.workflow_sync.on_state_update", "content_item", String(assignment?.content_item_id || ""), workflowSyncDetails, {
      assignment_id: assignmentId,
    });
    repo.logAudit(actorEmail(req), "assignment.workflow_sync.on_state_update", "assignment", String(assignmentId), workflowSyncDetails, {
      assignment_id: assignmentId,
    });
    res.json({ ok: true, assignment });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot update assignment state") });
  }
});

function buildSubmissionErrorResponse(err) {
  if (err && err.code === "REQUESTED_CHECK_VALIDATION_FAILED" && Array.isArray(err.validation_errors) && err.validation_errors.length) {
    return {
      status: 400,
      body: {
        error: "requested_check_validation_failed",
        message: "กรุณาตรวจสอบข้อมูลที่ต้องยืนยัน",
        validation_errors: err.validation_errors,
      },
    };
  }
  return {
    status: 400,
    body: { error: String(err?.message || "Cannot create submission") },
  };
}

app.post("/api/assignments/:id/submissions", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }

  const role = actorPolicyRole(req);
  if (role === "editor") {
    res.status(403).json({ error: "editor should submit via article/event workspace flow only" });
    return;
  }
  if (!hasAssignmentSubmissionAccess(req, assignment)) {
    res.status(403).json({ error: "only assigned contributor can submit this assignment" });
    return;
  }
  if (role === "freelance") {
    const assignmentState = String(assignment.state || "").toLowerCase();
    if (!["assigned", "in_progress", "revision_requested"].includes(assignmentState)) {
      res.status(409).json({ error: "assignment is not accepting submissions" });
      return;
    }
  }

  try {
    const assignmentState = String(assignment.state || "").toLowerCase();
    const requestedAction = String(req.body?.action || "").trim().toLowerCase();
    let normalizedSubmissionState = role === "freelance"
      ? (assignmentState === "revision_requested" ? "resubmitted" : "submitted")
      : normalizeEnum(req.body?.submission_state, ASSIGNMENT_SUBMISSION_STATES) || "submitted";
    if (requestedAction === "submit") normalizedSubmissionState = "submitted";
    if (requestedAction === "resubmit") normalizedSubmissionState = "resubmitted";
    if (!ASSIGNMENT_SUBMISSION_STATES.has(normalizedSubmissionState)) {
      res.status(400).json({ error: "invalid submission_state" });
      return;
    }
    if (normalizedSubmissionState === "resubmitted" && assignmentState !== "revision_requested") {
      res.status(409).json({ error: "resubmit requires revision_requested state" });
      return;
    }
    if (normalizedSubmissionState === "submitted" && assignmentState === "revision_requested") {
      res.status(409).json({ error: "use resubmit when assignment is revision_requested" });
      return;
    }
    const currentRound = resolveAssignmentCurrentRound(assignment);
    cleanupExpiredAssignmentWorkDraftAssets({
      assignmentId,
      assignmentRound: currentRound,
      maxAgeMs: ASSIGNMENT_WORK_SYNC_EXPIRY_MS,
    });
    if (["owner", "admin", "user", "freelance"].includes(role)) {
      const currentRoundImageAssets = repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "image");
      const currentRoundVideoAssets = repo.listAssignmentRoundAssetsByType(assignmentId, currentRound, "video");
      const currentRoundDeliverablesCount = (Array.isArray(currentRoundImageAssets) ? currentRoundImageAssets.length : 0)
        + (Array.isArray(currentRoundVideoAssets) ? currentRoundVideoAssets.length : 0);
      if (currentRoundDeliverablesCount < 1) {
        res.status(409).json({
          error: "บล็อกการส่งงาน: ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง",
        });
        return;
      }
    }
    const imageResetRequired = Number(assignment?.image_reset_required ? 1 : 0) === 1;
    const videoResetRequired = Number(assignment?.video_reset_required ? 1 : 0) === 1;
    const normalizedArticlePayload = normalizeAssignmentDraftArticlePayload(req.body?.article_payload_json || null, assignment);
    const mediaPayload = req.body?.media_payload_json && typeof req.body.media_payload_json === "object"
      ? req.body.media_payload_json
      : null;
    enforceAssignmentSubmissionRequiredFields(assignment, normalizedArticlePayload, assignmentId, currentRound, mediaPayload);
    enforceResetPerShotRequirements(assignment, assignmentId, currentRound);
    const assignmentAction = normalizedSubmissionState === "resubmitted" ? "resubmit" : "submit";
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase()
      || ASSIGNMENT_REASON_CODE_DEFAULTS[assignmentAction];
    const submission = repo.addAssignmentSubmission(buildAssignmentSubmissionPayload({
      assignmentId,
      sourceHandoffSnapshotId: req.body?.source_handoff_snapshot_id,
      submittedByUserId: req.authUser?.id,
      submissionState: normalizedSubmissionState,
      articlePayloadJson: normalizedArticlePayload,
      mediaPayloadJson: mediaPayload,
      fieldReturnPayloadJson: req.body?.field_return_payload_json,
      contributorNote: req.body?.contributor_note,
      reviewerNote: req.body?.reviewer_note,
      reviewedAt: req.body?.reviewed_at,
    }));
    const keepAssetIds = Array.isArray(req.body?.media_payload_json?.assets)
      ? req.body.media_payload_json.assets.map((row) => Number(row?.id || 0)).filter((id) => id > 0)
      : [];
    const nextAssignmentState = normalizedSubmissionState === "resubmitted" ? "resubmitted" : "submitted";
    const updatedAssignment = repo.updateAssignmentState(assignmentId, nextAssignmentState, actorEmail(req), {
      actor_role: role,
      reason_code: reasonCode,
    });
    if (imageResetRequired || videoResetRequired) {
      repo.updateAssignmentMediaResetPolicy(assignmentId, {
        image_reset_required: false,
        image_reset_reason: null,
        video_reset_required: false,
        video_reset_reason: null,
      });
    }
    repo.deleteAssignmentSubmissionDraft(assignmentId, Number(req.authUser?.id || 0) || 0, currentRound);
    repo.logAudit(actorEmail(req), `assignment.submission.${assignmentAction}`, "content_item", String(assignment.content_item_id), {
      assignment_id: assignmentId,
      submission_id: submission?.id || null,
      assignment_action: assignmentAction,
      reason_code: reasonCode,
      submission_state: normalizedSubmissionState,
    }, {
      assignment_id: assignmentId,
    });
    repo.logAudit(actorEmail(req), `assignment.submission.${assignmentAction}`, "assignment", String(assignmentId), {
      content_item_id: assignment.content_item_id,
      submission_id: submission?.id || null,
      assignment_action: assignmentAction,
      reason_code: reasonCode,
      submission_state: normalizedSubmissionState,
      role,
    }, {
      assignment_id: assignmentId,
    });
    const workflowSyncDetails = {
      assignment_id: assignmentId,
      content_item_id: updatedAssignment?.content_item_id || assignment.content_item_id,
      from_state: assignmentState || null,
      to_state: String(updatedAssignment?.state || "").trim().toLowerCase() || nextAssignmentState,
      source_action: `assignment.submission.${assignmentAction}`,
      reason_code: reasonCode,
    };
    repo.logAudit(actorEmail(req), "assignment.workflow_sync.on_submission", "content_item", String(updatedAssignment?.content_item_id || assignment.content_item_id), workflowSyncDetails, {
      assignment_id: assignmentId,
    });
    repo.logAudit(actorEmail(req), "assignment.workflow_sync.on_submission", "assignment", String(assignmentId), workflowSyncDetails, {
      assignment_id: assignmentId,
    });
    const cleanupResult = cleanupSupersededAssignmentWorkAssetsAfterSubmit(assignmentId, currentRound, keepAssetIds);
    if ((Number(cleanupResult?.removed_links || 0) > 0) || (Number(cleanupResult?.removed_assets || 0) > 0)) {
      repo.logAudit(actorEmail(req), "assignment.asset.cleanup_post_submit", "assignment", String(assignmentId), {
        assignment_id: assignmentId,
        assignment_round: currentRound,
        keep_asset_ids: keepAssetIds,
        removed_links: Number(cleanupResult?.removed_links || 0),
        removed_assets: Number(cleanupResult?.removed_assets || 0),
        deleted_files: Array.isArray(cleanupResult?.deleted_files) ? cleanupResult.deleted_files.length : 0,
      }, {
        assignment_id: assignmentId,
      });
    }
    res.status(201).json({ ok: true, submission });
  } catch (err) {
    const { status, body } = buildSubmissionErrorResponse(err);
    res.status(status).json(body);
  }
});

app.get("/api/assignments/:id/submissions", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (role === "editor") {
    res.status(403).json({ error: "editor cannot inspect assignment submissions from this surface" });
    return;
  }
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const items = repo.listAssignmentSubmissions(assignmentId);
  res.json({ assignment_id: assignmentId, submissions: items });
});

app.get("/api/assignments/:id/deliverables", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (role === "editor") {
    res.status(403).json({ error: "editor cannot inspect assignment deliverables from this surface" });
    return;
  }
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const deliverables = repo.listAssignmentSubmissionDeliverablesByAssignment(assignmentId);
  res.json({ assignment_id: assignmentId, deliverables });
});

app.get("/api/assignments/:id/deliverables/latest-bundle", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (role === "editor") {
    res.status(403).json({ error: "editor cannot inspect assignment deliverables from this surface" });
    return;
  }
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const bundle = repo.getLatestAssignmentDeliverablesBundle(assignmentId);
    const reasonCode = String(req.query.reason_code || "").trim().toLowerCase() || "assignment_deliverables_latest_bundle_viewed";
    repo.logAudit(actorEmail(req), "assignment_deliverables.latest_bundle_view", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: bundle?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: bundle?.latest_submission_id || null,
      available_count: Number(bundle?.available_deliverable_types?.length || 0),
      missing_count: Number(bundle?.missing_deliverable_types?.length || 0),
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json({ assignment_id: assignmentId, bundle });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot build latest assignment deliverables bundle") });
  }
});

app.get("/api/assignments/:id/deliverables/utility-readiness", requireRole("admin", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const readiness = repo.evaluateAssignmentDeliverablesUtilityReadiness(assignmentId);
    res.json({ assignment_id: assignmentId, readiness });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverables utility readiness") });
  }
});

app.post("/api/assignments/:id/deliverables/utility-readiness/evaluate", requireRole("admin", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const readiness = repo.evaluateAssignmentDeliverablesUtilityReadiness(assignmentId, {
      expected_deliverables: req.body?.expected_deliverables,
    });
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "assignment_deliverables_utility_readiness_evaluated";
    repo.logAudit(actorEmail(req), "assignment_deliverables.utility_readiness_evaluate", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: readiness?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: readiness?.latest_submission_id || null,
      review_usable: Boolean(readiness?.review_usable),
      handoff_usable: Boolean(readiness?.handoff_usable),
      available_count: Number(readiness?.debug?.available_count || 0),
      missing_count: Number(readiness?.debug?.missing_count || 0),
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json({ ok: true, assignment_id: assignmentId, readiness });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverables utility readiness") });
  }
});

app.get("/api/assignments/:id/deliverables/review-decision", requireRole("admin", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const decision = repo.evaluateAssignmentDeliverablesReviewDecisionByAssignment(assignmentId);
    res.json({ assignment_id: assignmentId, decision });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverables review decision") });
  }
});

app.post("/api/assignments/:id/deliverables/review-decision/evaluate", requireRole("admin", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const decision = repo.evaluateAssignmentDeliverablesReviewDecisionByAssignment(assignmentId, {
      expected_deliverables: req.body?.expected_deliverables,
    });
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "assignment_deliverables_review_decision_evaluated";
    repo.logAudit(actorEmail(req), "assignment_deliverables.review_decision_evaluate", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: decision?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: decision?.latest_submission_id || null,
      review_decision: String(decision?.review_decision || "blocked"),
      review_usable: Boolean(decision?.review_usable),
      handoff_usable: Boolean(decision?.handoff_usable),
      blockers_count: Array.isArray(decision?.blockers) ? decision.blockers.length : 0,
      missing_requirements_count: Array.isArray(decision?.missing_requirements) ? decision.missing_requirements.length : 0,
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json({ ok: true, assignment_id: assignmentId, decision });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverables review decision") });
  }
});

app.get("/api/assignments/:id/submission-decision", requireRole("admin", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const decision = repo.evaluateAssignmentSubmissionDecisionByAssignment(assignmentId);
    res.json({ assignment_id: assignmentId, decision });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment submission decision") });
  }
});

app.post("/api/assignments/:id/submission-decision/evaluate", requireRole("owner", "admin", "user"), (req, res) => {
  const routeConfig = ASSIGNMENT_EVALUATE_ROUTE_CONFIG.submission;
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const hasOverrideInput = hasEvaluationOverrideInput(req.body);
    const decision = repo.evaluateAssignmentSubmissionDecisionByAssignment(assignmentId, {
      expected_deliverables: req.body?.expected_deliverables,
      debug_overrides: req.body?.debug_overrides,
    });
    const authoritative = buildEvaluateAuthoritativeContract(decision, routeConfig, {
      hasOverrideInput,
    });
    const auditAdditions = buildEvaluateAuditAdditions({
      authoritative,
      hasOverrideInput,
    });
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || routeConfig.defaultReasonCode;
    repo.logAudit(actorEmail(req), routeConfig.auditAction, "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: decision?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: decision?.latest_submission_id || null,
      submission_decision: String(decision?.submission_decision || "block"),
      review_usable: Boolean(decision?.review_usable),
      handoff_usable: Boolean(decision?.handoff_usable),
      ready_for_handoff: Boolean(decision?.ready_for_handoff),
      blockers_count: Array.isArray(decision?.blockers) ? decision.blockers.length : 0,
      missing_requirements_count: Array.isArray(decision?.missing_requirements) ? decision.missing_requirements.length : 0,
      debug_override_used: Boolean(decision?.debug_override_used),
      debug_override_keys: Array.isArray(decision?.debug_override_keys) ? decision.debug_override_keys : [],
      ...auditAdditions,
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json(buildEvaluateResponseEnvelope({
      assignmentId,
      evaluation: decision,
      authoritative,
      responsePayloadKey: routeConfig.responsePayloadKey,
    }));
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment submission decision") });
  }
});

app.get("/api/assignments/:id/deliverables/governance-summary", requireRole("owner", "admin", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const summary = repo.evaluateAssignmentDeliverablesGovernanceSummaryByAssignment(assignmentId);
    res.json({ assignment_id: assignmentId, summary });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverables governance summary") });
  }
});

app.post("/api/assignments/:id/deliverables/governance-summary/evaluate", requireRole("owner", "admin", "user"), (req, res) => {
  const routeConfig = ASSIGNMENT_EVALUATE_ROUTE_CONFIG.governance;
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const hasOverrideInput = hasEvaluationOverrideInput(req.body);
    const summary = repo.evaluateAssignmentDeliverablesGovernanceSummaryByAssignment(assignmentId, {
      expected_deliverables: req.body?.expected_deliverables,
      debug_overrides: req.body?.debug_overrides,
    });
    const authoritative = buildEvaluateAuthoritativeContract(summary, routeConfig, {
      hasOverrideInput,
    });
    const auditAdditions = buildEvaluateAuditAdditions({
      authoritative,
      hasOverrideInput,
    });
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || routeConfig.defaultReasonCode;
    repo.logAudit(actorEmail(req), routeConfig.auditAction, "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: summary?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: summary?.latest_submission_id || null,
      governance_decision: String(summary?.governance_decision || "hold"),
      ready_for_review: Boolean(summary?.ready_for_review),
      ready_for_handoff: Boolean(summary?.ready_for_handoff),
      blockers_count: Array.isArray(summary?.blockers) ? summary.blockers.length : 0,
      missing_requirements_count: Array.isArray(summary?.missing_requirements) ? summary.missing_requirements.length : 0,
      debug_override_used: Boolean(summary?.debug_override_used),
      debug_override_keys: Array.isArray(summary?.debug_override_keys) ? summary.debug_override_keys : [],
      ...auditAdditions,
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json(buildEvaluateResponseEnvelope({
      assignmentId,
      evaluation: summary,
      authoritative,
      responsePayloadKey: routeConfig.responsePayloadKey,
    }));
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverables governance summary") });
  }
});

app.get("/api/assignments/:id/handoff-governance", requireRole("admin", "user"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const summary = repo.evaluateAssignmentHandoffGovernanceByAssignment(assignmentId);
    res.json({ assignment_id: assignmentId, summary });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment handoff governance") });
  }
});

app.post("/api/assignments/:id/handoff-governance/evaluate", requireRole("admin", "user"), (req, res) => {
  const routeConfig = ASSIGNMENT_EVALUATE_ROUTE_CONFIG.handoff;
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const hasOverrideInput = hasEvaluationOverrideInput(req.body);
    const summary = repo.evaluateAssignmentHandoffGovernanceByAssignment(assignmentId, {
      expected_deliverables: req.body?.expected_deliverables,
      debug_overrides: req.body?.debug_overrides,
    });
    const authoritative = buildEvaluateAuthoritativeContract(summary, routeConfig, {
      hasOverrideInput,
    });
    const auditAdditions = buildEvaluateAuditAdditions({
      authoritative,
      hasOverrideInput,
    });
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || routeConfig.defaultReasonCode;
    repo.logAudit(actorEmail(req), routeConfig.auditAction, "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: summary?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: summary?.latest_submission_id || null,
      handoff_governance_decision: String(summary?.handoff_governance_decision || "hold"),
      ready_for_handoff_governance: Boolean(summary?.ready_for_handoff_governance),
      blockers_count: Array.isArray(summary?.blockers) ? summary.blockers.length : 0,
      missing_requirements_count: Array.isArray(summary?.missing_requirements) ? summary.missing_requirements.length : 0,
      debug_override_used: Boolean(summary?.debug_override_used),
      debug_override_keys: Array.isArray(summary?.debug_override_keys) ? summary.debug_override_keys : [],
      ...auditAdditions,
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json(buildEvaluateResponseEnvelope({
      assignmentId,
      evaluation: summary,
      authoritative,
      responsePayloadKey: routeConfig.responsePayloadKey,
    }));
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment handoff governance") });
  }
});

app.get("/api/assignments/:id/submissions/:submissionId/deliverables", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  const submissionId = Number(req.params.submissionId || 0);
  if (!assignmentId || !submissionId) {
    res.status(400).json({ error: "Invalid assignment/submission id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (role === "editor") {
    res.status(403).json({ error: "editor cannot inspect submission deliverables from this surface" });
    return;
  }
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const deliverables = repo.listAssignmentSubmissionDeliverablesBySubmission(assignmentId, submissionId);
    res.json({ assignment_id: assignmentId, submission_id: submissionId, deliverables });
  } catch (err) {
    const msg = String(err?.message || "Cannot list submission deliverables");
    const status = /submission does not belong to assignment/i.test(msg)
      ? 409
      : /assignment not found|submission not found/i.test(msg)
        ? 404
        : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/assignments/:id/submissions/:submissionId/deliverables", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  const submissionId = Number(req.params.submissionId || 0);
  if (!assignmentId || !submissionId) {
    res.status(400).json({ error: "Invalid assignment/submission id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (role === "editor") {
    res.status(403).json({ error: "editor cannot submit deliverables from this surface" });
    return;
  }
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  try {
    const deliverableType = String(req.body?.deliverable_type || "").trim().toLowerCase();
    if (!ASSIGNMENT_DELIVERABLE_TYPES.has(deliverableType)) {
      res.status(400).json({ error: "deliverable_type must be one of: photos, videos, raw_notes, caption_draft, script_draft, article_draft" });
      return;
    }
    const created = repo.createAssignmentSubmissionDeliverable({
      ...(req.body || {}),
      assignment_id: assignmentId,
      submission_id: submissionId,
      deliverable_type: deliverableType,
    }, actorEmail(req));
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "assignment_submission_deliverable_created";
    repo.logAudit(actorEmail(req), "assignment_submission_deliverable.create", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      submission_id: submissionId,
      content_item_id: created?.content_item_id || assignment?.content_item_id || null,
      deliverable_type: created?.deliverable_type || null,
      status: created?.status || null,
      source_asset_id: created?.source_asset_id || null,
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.status(201).json({ ok: true, assignment_id: assignmentId, submission_id: submissionId, deliverable: created });
  } catch (err) {
    const msg = String(err?.message || "Cannot create submission deliverable");
    const status = /submission does not belong to assignment/i.test(msg)
      ? 409
      : /submission is not latest for assignment/i.test(msg)
        ? 409
      : /assignment not found|submission not found/i.test(msg)
        ? 404
        : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/assignments/:id/deliverables/summary", requireRole("admin", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const summary = repo.summarizeAssignmentDeliverables(assignmentId);
    res.json({ assignment_id: assignmentId, summary });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot summarize assignment deliverables") });
  }
});

app.post("/api/assignments/:id/deliverables/summary/evaluate", requireRole("admin", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const summary = repo.summarizeAssignmentDeliverables(assignmentId, {
      expected_deliverables: req.body?.expected_deliverables,
    });
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "assignment_deliverables_evaluated";
    repo.logAudit(actorEmail(req), "assignment_deliverables.evaluate", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: summary?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: summary?.latest_submission_id || null,
      expected_count: Number(summary?.expected_count || 0),
      submitted_count: Number(summary?.submitted_count || 0),
      missing_count: Number(summary?.missing_count || 0),
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json({ ok: true, assignment_id: assignmentId, summary });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverables") });
  }
});

app.get("/api/assignments/:id/deliverables/readiness", requireRole("admin", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const readiness = repo.evaluateAssignmentDeliverablesReadiness(assignmentId);
    res.json({ assignment_id: assignmentId, readiness });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverable readiness") });
  }
});

app.post("/api/assignments/:id/deliverables/readiness/evaluate", requireRole("admin", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const readiness = repo.evaluateAssignmentDeliverablesReadiness(assignmentId, {
      expected_deliverables: req.body?.expected_deliverables,
    });
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "assignment_deliverables_readiness_evaluated";
    repo.logAudit(actorEmail(req), "assignment_deliverables.readiness_evaluate", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      content_item_id: readiness?.content_item_id || assignment?.content_item_id || null,
      latest_submission_id: readiness?.latest_submission_id || null,
      ready_for_review: Boolean(readiness?.ready_for_review),
      expected_count: Number(readiness?.debug?.expected_count || 0),
      submitted_count: Number(readiness?.debug?.submitted_count || 0),
      missing_count: Number(readiness?.debug?.missing_count || 0),
      reason_code: reasonCode,
    }, {
      assignment_id: assignmentId,
    });
    res.json({ ok: true, assignment_id: assignmentId, readiness });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot evaluate assignment deliverable readiness") });
  }
});

app.get("/api/assignments/:id/handoff-source", requireRole("admin", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const handoff = repo.getLatestAssignmentHandoffByAssignment(assignmentId);
  let deliverablesGovernanceSummary = null;
  let handoffGovernanceSummary = null;
  let governanceSummaryError = null;
  try {
    deliverablesGovernanceSummary = repo.evaluateAssignmentDeliverablesGovernanceSummaryByAssignment(assignmentId);
  } catch (err) {
    governanceSummaryError = {
      ...(governanceSummaryError || {}),
      deliverables_governance_error: String(err?.message || "Cannot evaluate deliverables governance summary"),
    };
  }
  try {
    handoffGovernanceSummary = repo.evaluateAssignmentHandoffGovernanceByAssignment(assignmentId);
  } catch (err) {
    governanceSummaryError = {
      ...(governanceSummaryError || {}),
      handoff_governance_error: String(err?.message || "Cannot evaluate handoff governance summary"),
    };
  }
  res.json({
    assignment_id: assignmentId,
    content_item_id: assignment.content_item_id,
    handoff: handoff || null,
    deliverables_governance_summary: deliverablesGovernanceSummary,
    handoff_governance_summary: handoffGovernanceSummary,
    ready_for_handoff_governance: Boolean(handoffGovernanceSummary?.ready_for_handoff_governance),
    handoff_governance_decision: String(handoffGovernanceSummary?.handoff_governance_decision || "hold"),
    governance_summary_error: governanceSummaryError,
  });
});

app.get("/api/assignments/:id/history", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const role = actorPolicyRole(req);
  if (role === "editor") {
    res.status(403).json({ error: "editor cannot inspect assignment history from this surface" });
    return;
  }
  if (!hasAssignmentAccess(req, assignment, role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const limit = Number(req.query.limit || 100);
  const actorFilter = String(req.query.actor_email || "").trim().toLowerCase();
  const reasonFilter = String(req.query.reason_code || "").trim().toLowerCase();
  const action = String(req.query.action || "").trim().toLowerCase();
  const actionPrefix = String(req.query.action_prefix || "").trim().toLowerCase();
  const effectivePrefixes = (!action && !actionPrefix)
    ? ["assignment.", "assignment_deliverables.", "assignment_submission.", "assignment_handoff."]
    : (actionPrefix ? [actionPrefix] : []);
  const transitions = repo.listWorkflowTransitionsByAssignment(assignmentId, limit, {
    actor_email: actorFilter || null,
    reason_code: reasonFilter || null,
  });
  const auditById = new Map();
  if (effectivePrefixes.length > 0 && !action) {
    for (const prefix of effectivePrefixes) {
      const rows = repo.listAuditByTarget("assignment", String(assignmentId), limit, {
        action: null,
        action_prefix: prefix,
        actor_email: actorFilter || null,
        assignment_id: assignmentId,
      });
      for (const row of rows) {
        auditById.set(Number(row?.id || 0), row);
      }
    }
  } else {
    const rows = repo.listAuditByTarget("assignment", String(assignmentId), limit, {
      action: action || null,
      action_prefix: actionPrefix || null,
      actor_email: actorFilter || null,
      assignment_id: assignmentId,
    });
    for (const row of rows) {
      auditById.set(Number(row?.id || 0), row);
    }
  }
  const audit = Array.from(auditById.values())
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  const submissions = repo.listAssignmentSubmissions(assignmentId);
  res.json({
    assignment_id: assignmentId,
    content_item_id: assignment.content_item_id,
    transitions,
    audit,
    submissions,
  });
});


app.get("/api/items/:id/search-enrichment", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const records = repo.listSearchEnrichmentByItem(id);
  const latest = records[0] || null;
  res.json({ item_id: id, latest, records });
});

app.post("/api/items/:id/search-enrichment", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const record = repo.addSearchEnrichmentRecord(id, req.body || {});
    repo.logAudit(actorEmail(req), "search_enrichment.add", "content_item", String(id), { record_id: record?.id || null });
    res.status(201).json({ ok: true, item_id: id, record });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot create search enrichment") });
  }
});

app.post("/api/items/:id/recompute-intelligence", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const intelligence = repo.recomputePlaceIntelligence(id);
    repo.logAudit(actorEmail(req), "place_intelligence.recompute", "content_item", String(id), { score_mode: intelligence?.score_mode || null });
    let readiness = null;
    try {
      readiness = repo.recomputeReadinessBriefByItem(id, actorEmail(req));
      repo.logAudit(actorEmail(req), "readiness_brief.recompute", "content_item", String(id), {
        source: "recompute_intelligence",
        readiness_id: readiness?.id || null,
        reason_code: WORKFLOW_REASON_CODES.READINESS_RECOMPUTED,
      });
    } catch {
      readiness = null;
    }
    res.json({ ok: true, item_id: id, intelligence, readiness: readiness?.readiness_json || null });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot recompute intelligence") });
  }
});

app.get("/api/items/:id/place-intelligence", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const intelligence = repo.getPlaceIntelligenceByItem(id);
  const momentumPlatform = String(req.query.platform || "").trim().toLowerCase();
  const momentum = repo.latestMomentumSnapshotByItem(id, momentumPlatform);
  res.json({
    item_id: id,
    intelligence: intelligence || null,
    momentum: momentum || null,
  });
});

app.get("/api/place-intelligence/top", (req, res) => {
  const limit = Number(req.query.limit || 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "limit must be an integer between 1 and 100" });
    return;
  }

  const category = String(req.query.category || "").trim();
  const items = repo.listTopPlaceIntelligence(limit, category);
  res.json({ limit, category: category || null, items });
});

app.get("/api/items/:id/social-signals", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const signals = repo.listSocialSignalSourcesByItem(id);
  res.json({ item_id: id, signals });
});

app.post("/api/items/:id/social-signals", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const signal = repo.addSocialSignalSource(id, req.body || {});
    repo.logAudit(actorEmail(req), "social_signal.add", "content_item", String(id), { signal_id: signal?.id || null, platform: signal?.platform || null });
    res.status(201).json({ ok: true, item_id: id, signal });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot create social signal") });
  }
});

app.get("/api/items/:id/momentum", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const platform = String(req.query.platform || "").trim().toLowerCase();
  if (platform && !["facebook", "tiktok"].includes(platform)) {
    res.status(400).json({ error: "invalid platform" });
    return;
  }

  const snapshots = repo.listMomentumSnapshotsByItem(id, platform);
  const latest = snapshots[0] || null;
  res.json({ item_id: id, platform: platform || null, latest, snapshots });
});

app.post("/api/items/:id/momentum/recompute", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  const platform = String(req.body?.platform || req.query.platform || "facebook").trim().toLowerCase();
  if (!["facebook", "tiktok"].includes(platform)) {
    res.status(400).json({ error: "invalid platform" });
    return;
  }

  try {
    const snapshot = repo.recomputeMomentumScore(id, platform);
    repo.logAudit(actorEmail(req), "momentum.recompute", "content_item", String(id), { snapshot_id: snapshot?.id || null, platform });
    res.json({ ok: true, item_id: id, platform, snapshot });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot recompute momentum") });
  }
});
app.post("/api/items/:id/recompute-content-direction", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const report = repo.recomputeContentDirectionByItem(id);
    repo.logAudit(actorEmail(req), "content_direction.recompute", "content_item", String(id), {
      report_id: report?.id || null,
      direction_status: report?.direction_status || null,
      priority_band: report?.priority_band || null,
    });
    res.json({ ok: true, item_id: id, report });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot recompute content direction") });
  }
});

app.get("/api/items/:id/content-direction", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const report = repo.getLatestContentDirectionByItem(id);
  res.json({ item_id: id, report: report || null });
});

app.get("/api/content-direction/top", (req, res) => {
  const limit = Number(req.query.limit || 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "limit must be an integer between 1 and 100" });
    return;
  }

  const priorityBand = String(req.query.priority_band || "").trim().toLowerCase();
  const directionStatus = String(req.query.direction_status || "").trim().toLowerCase();

  try {
    const items = repo.listTopContentDirectionReports(limit, priorityBand, directionStatus);
    res.json({
      limit,
      priority_band: priorityBand || null,
      direction_status: directionStatus || null,
      items,
    });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot list content direction reports") });
  }
});
app.get("/api/items/:id/evidence-blocks", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  let blocks = repo.listEvidenceBlocks(id);
  const seeded = seedEvidenceBlocksForItem(item);
  const autoSeededCount = Number(seeded?.added || 0);
  if (autoSeededCount > 0 || blocks.length === 0) {
    blocks = repo.listEvidenceBlocks(id);
  }

  res.json({ item_id: id, blocks, auto_seeded_count: autoSeededCount });
});

app.post("/api/items/:id/evidence-blocks", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensurePrepItemEditAccess(req, res, item)) {
    return;
  }

  try {
    const block = repo.addEvidenceBlock(id, req.body || {});
    repo.logAudit(actorEmail(req), "evidence.add", "content_item", String(id), { block_id: block?.id || null, block_type: block?.block_type || null });
    res.status(201).json({ ok: true, item_id: id, block });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot create evidence block") });
  }
});

app.get("/api/items/:id/approved-context", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const onlyActive = String(req.query.only_active || "0") === "1";
  const blocks = repo.listApprovedContextBlocks(id, { onlyActive });
  res.json({ item_id: id, blocks });
});

app.post("/api/items/:id/approved-context", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensurePrepItemEditAccess(req, res, item)) {
    return;
  }

  try {
    const block = repo.addApprovedContextBlock(id, req.body || {}, actorEmail(req));
    repo.logAudit(actorEmail(req), "context.approve", "content_item", String(id), { context_id: block?.id || null, evidence_block_id: block?.evidence_block_id || null });
    res.status(201).json({ ok: true, item_id: id, block });
  } catch (err) {
    const msg = String(err?.message || "Cannot create approved context");
    const isConflict = String(err?.code || "") === "CONFLICT" || /UNIQUE|constraint/i.test(msg);
    res.status(isConflict ? 409 : 400).json({ error: msg });
  }
});

app.patch("/api/items/:id/approved-context/:contextId", requireRole("admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  const contextId = Number(req.params.contextId || 0);
  if (!id || !contextId) {
    res.status(400).json({ error: "Invalid item id or context id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensurePrepItemEditAccess(req, res, item)) {
    return;
  }

  try {
    const block = repo.updateApprovedContextBlock(id, contextId, req.body || {});
    if (!block) {
      res.status(404).json({ error: "Approved context not found" });
      return;
    }
    repo.logAudit(actorEmail(req), "context.update", "content_item", String(id), { context_id: contextId });
    res.json({ ok: true, item_id: id, block });
  } catch (err) {
    const msg = String(err?.message || "Cannot update approved context");
    const isConflict = String(err?.code || "") === "CONFLICT" || /UNIQUE|constraint/i.test(msg);
    res.status(isConflict ? 409 : 400).json({ error: msg });
  }
});

app.get("/api/items/:id/field-pack/current", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const fieldPack = resolveFieldPackRequestedChecksForEditor(item, repo.getCurrentFieldPackByItem(id));
  res.json({ item_id: id, field_pack: fieldPack });
});

app.post("/api/items/:id/field-pack/requested-checks/resolve", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  const resolutionItem = buildRequestedChecksResolutionItem(item, req.body?.item || {});
  const fieldPackPayload = req.body?.field_pack && typeof req.body.field_pack === "object"
    ? { ...(req.body.field_pack || {}) }
    : {};
  const fieldPack = resolveFieldPackRequestedChecksForEditor(resolutionItem, fieldPackPayload) || fieldPackPayload;
  res.json({ ok: true, item_id: id, field_pack: fieldPack });
});

app.post("/api/items/:id/field-packs", requireRole("owner", "admin", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const fieldPack = repo.createFieldPack({
      ...(req.body || {}),
      content_item_id: id,
      updated_by: actorEmail(req),
    });
    repo.logAudit(actorEmail(req), "field_pack.create", "content_item", String(id), {
      field_pack_id: fieldPack?.id || null,
      status: fieldPack?.status || null,
      is_current: fieldPack?.is_current === true,
    });
    res.status(201).json({ ok: true, item_id: id, field_pack: resolveFieldPackRequestedChecksForEditor(item, fieldPack) });
  } catch (err) {
    const msg = String(err?.message || "Cannot create field pack");
    const isConflict = String(err?.code || "") === "CONFLICT" || /UNIQUE|constraint/i.test(msg);
    res.status(isConflict ? 409 : 400).json({ error: msg });
  }
});

app.put("/api/field-packs/:fieldPackId", requireRole("owner", "admin", "user"), (req, res) => {
  const fieldPackId = Number(req.params.fieldPackId || 0);
  if (!fieldPackId) {
    res.status(400).json({ error: "Invalid field pack id" });
    return;
  }

  try {
    const existingFieldPack = repo.getFieldPackBundleById(fieldPackId);
    if (!existingFieldPack) {
      res.status(404).json({ error: "Field pack not found" });
      return;
    }
    const item = repo.getItem(Number(existingFieldPack.content_item_id || 0) || 0);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    if (!ensureItemMutationAccess(req, res, item)) {
      return;
    }
    const fieldPack = repo.updateFieldPack(fieldPackId, {
      ...(req.body || {}),
      updated_by: actorEmail(req),
    });
    if (!fieldPack) {
      res.status(404).json({ error: "Field pack not found" });
      return;
    }
    repo.logAudit(actorEmail(req), "field_pack.update", "content_item", String(fieldPack.content_item_id || ""), {
      field_pack_id: fieldPack?.id || null,
      status: fieldPack?.status || null,
      is_current: fieldPack?.is_current === true,
    });
    res.json({
      ok: true,
      item_id: Number(fieldPack?.content_item_id || 0) || null,
      field_pack: resolveFieldPackRequestedChecksForEditor(item, fieldPack),
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot update field pack");
    const isConflict = String(err?.code || "") === "CONFLICT" || /UNIQUE|constraint/i.test(msg);
    const isNotFound = /field pack not found|item not found/i.test(msg);
    res.status(isNotFound ? 404 : isConflict ? 409 : 400).json({ error: msg });
  }
});

app.post("/api/items/:id/field-pack/regenerate", requireRole("owner", "admin", "user"), workflowRateLimit, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const revisionNote = String(req.body?.revision_note || "").trim();
  if (!revisionNote) {
    res.status(400).json({ error: "revision_note is required" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  const cleanContext = buildCleanStructuredContext(repo, id);
  const ctaCandidates = deriveCtaContactCandidatesFromStructuredContext(cleanContext);
  if (isCtaTraceEnabled()) {
    traceCtaStage("buildCleanStructuredContext", {
      item_id: Number(id || 0) || null,
      ...summarizeStructuredContext(cleanContext),
      ...summarizeCtaCandidates(ctaCandidates),
    });
  }
  if (!cleanContext?.completeness?.has_minimum_required) {
    res.status(400).json({
      error: "Clean context does not meet minimum requirements",
      blocking_reasons: cleanContext?.completeness?.blocking_reasons || [],
      minimum_missing: cleanContext?.completeness?.minimum_missing || [],
    });
    return;
  }

  const currentFieldPack = repo.getCurrentFieldPackByItem(id);

  try {
    const aiConfig = getEffectiveAiConfig();
    const agentEngine = createAgentGenerationEngine(aiConfig);
    const fieldPackAgentProfile = getEffectiveAgentProfile(FIELD_PACK_AGENT_KEY);
    const agentInput = {
      ...item,
      agent_profile: fieldPackAgentProfile,
      structured_context: cleanContext,
      cta_contact_candidates: ctaCandidates,
      visual_context: null,
    };
    let agentFieldPack = null;
    let fieldPack = null;
    const mode = currentFieldPack?.id ? "revise" : "create";

    if (currentFieldPack?.id) {
      if (!agentEngine?.reviseFieldPack) {
        throw new Error("Agent engine does not support field pack revision");
      }
      agentFieldPack = await agentEngine.reviseFieldPack(agentInput, currentFieldPack, revisionNote);
      fieldPack = repo.updateFieldPack(currentFieldPack.id, {
        ...buildFieldPackUpdatePayloadFromAgent({ ...agentFieldPack, content_item_id: id }),
        updated_by: actorEmail(req),
      });
    } else {
      if (agentEngine?.reviseFieldPack) {
        agentFieldPack = await agentEngine.reviseFieldPack(agentInput, {}, revisionNote);
      } else if (agentEngine?.generateFieldPack) {
        agentFieldPack = await agentEngine.generateFieldPack(agentInput);
      } else {
        throw new Error("Agent engine does not support field pack generation");
      }
      fieldPack = repo.createFieldPack({
        ...buildFieldPackUpdatePayloadFromAgent({ ...agentFieldPack, content_item_id: id }),
        content_item_id: id,
        updated_by: actorEmail(req),
      });
    }

    repo.logAudit(actorEmail(req), "field_pack.regenerate", "content_item", String(id), {
      field_pack_id: fieldPack?.id || null,
      mode,
      revision_note: revisionNote,
      status: fieldPack?.status || null,
      ai_engine: String(aiConfig?.agentEngine || "internal").trim().toLowerCase() || "internal",
    });

    res.json({ ok: true, item_id: id, field_pack: resolveFieldPackRequestedChecksForEditor(item, fieldPack) });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot regenerate field pack") });
  }
});

app.get("/api/items/:id/draft-input-preview", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const preview = buildCleanStructuredContext(repo, id);
  if (!preview) {
    res.status(404).json({ error: "Preview not available" });
    return;
  }

  const withSnapshot = String(req.query.snapshot || "0") === "1";
  if (!withSnapshot) {
    res.json({ item_id: id, preview });
    return;
  }

  const snapshotSource = String(req.query.source || "approved_context_preview").trim() || "approved_context_preview";
  try {
    const snapshot = repo.createDraftInputSnapshot(id, preview, actorEmail(req), snapshotSource);
    repo.logAudit(actorEmail(req), "context.snapshot", "content_item", String(id), { snapshot_id: snapshot.id, run_uid: snapshot.run_uid });
    res.json({ item_id: id, preview, snapshot });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot create snapshot") });
  }
});

app.get("/api/items/:id/media-candidates", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const sourceRecord = db
    .prepare(
      `SELECT source_url, source_entity_id, payload_json
       FROM source_records
       WHERE content_item_id=?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(id);

  const sourceUrl = String(sourceRecord?.source_url || item?.map_url || "").trim();
  const placeId = String(item?.google_place_id || sourceRecord?.source_entity_id || "").trim();

  const collected = db
    .prepare(
      `SELECT DISTINCT srm.media_url AS url, srm.mime_type, srm.width, srm.height, srm.metadata_json
       FROM source_raw_media srm
       JOIN source_raw_items sri ON sri.id = srm.raw_item_id
       WHERE srm.media_url IS NOT NULL
         AND srm.media_url <> ''
         AND (
           (? <> '' AND sri.source_url = ?)
           OR (? <> '' AND sri.source_ref = ?)
           OR (? <> '' AND json_extract(sri.normalized_json, '$.google_place_id') = ?)
         )
       ORDER BY srm.id DESC
       LIMIT 80`
    )
    .all(sourceUrl, sourceUrl, placeId, placeId, placeId, placeId)
    .map((row) => ({
      url: sanitizeGoogleMapsPhotoUrl(row.url),
      mime_type: row.mime_type || null,
      width: row.width || null,
      height: row.height || null,
      metadata_json: sanitizeGoogleMapsPhotoUrlsDeep(parseStoredJsonValue(row.metadata_json, null)),
      source: "collected",
    }))
    .sort((a, b) => scoreRemoteMediaCandidate(b) - scoreRemoteMediaCandidate(a));

  const assets = db
    .prepare(
      `SELECT a.id, ca.role, a.storage_path
       FROM content_assets ca
       JOIN assets a ON a.id = ca.asset_id
       WHERE ca.content_item_id=?
       ORDER BY ca.id DESC`
    )
    .all(id)
    .map((row) => ({
      id: row.id,
      role: row.role || "gallery",
      url: parseAssetPathForUrl(row.storage_path),
      source: "asset",
    }));

  const direct = [];
  if (String(item?.image_url || "").trim()) {
    direct.push({ url: sanitizeGoogleMapsPhotoUrl(item.image_url), source: "item_cover" });
  }

  res.json({ item_id: id, collected, assets, direct });
});
app.get("/api/items/:id/image-workflow", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const status = buildImageWorkflowState(id);
  const assets = repo.listContentAssetsByItem(id).filter((row) => isCollectorControlledLocalAssetRow(row));
  const referenceMedia = repo.listReferenceMediaByItem(id);
  res.json({ item_id: id, status, assets, reference_media: referenceMedia });
});

app.get("/api/items/:id/reference-media", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  res.json(repo.listReferenceMediaByItem(id));
});

app.patch("/api/items/:id/reference-media/:referenceMediaId/selected", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  const referenceMediaId = String(req.params.referenceMediaId || "").trim();
  const selected = req.body?.selected;
  if (!id || !referenceMediaId) {
    res.status(400).json({ error: "Invalid reference media payload" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const row = repo.setReferenceMediaSelected(id, referenceMediaId, selected);
    repo.logAudit(actorEmail(req), "reference_media.select", "content_item", String(id), {
      reference_media_id: referenceMediaId,
      selected: selected === true || selected === 1 || selected === "1",
    });
    res.json({ ok: true, reference_media: row });
  } catch (err) {
    const message = String(err?.message || "Update failed");
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
});
app.post("/api/items/:id/assets/repair-imported-media", requireRole("admin", "owner"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  try {
    res.status(410).json({
      error: "legacy imported media repair is deprecated by reference media policy v2",
      code: "REFERENCE_MEDIA_POLICY_V2",
    });
  } catch (err) {
    res.status(410).json({
      error: "legacy imported media repair is deprecated by reference media policy v2",
      code: "REFERENCE_MEDIA_POLICY_V2",
    });
  }
});

app.get("/api/items/:id/assets/cleanup-eligibility", requireRole("admin", "owner"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  try {
    const scope = String(req.query.scope || "excluded").trim().toLowerCase();
    const report = repo.evaluateContentAssetCleanupEligibility(id, { scope });
    repo.logAudit(actorEmail(req), "asset.cleanup_eligibility.evaluate", "content_item", String(id), {
      scope: report?.scope || scope,
      evaluated_assets: Number(report?.summary?.evaluated_assets || 0),
      cleanup_ready_assets: Number(report?.summary?.cleanup_ready_assets || 0),
      protected_assets: Number(report?.summary?.protected_assets || 0),
    });
    res.json(report);
  } catch (err) {
    const msg = String(err?.message || "Cannot evaluate asset cleanup eligibility");
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

app.get("/api/items/:id/export-readiness", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const readiness = buildExportReadiness(id);
  if (!readiness) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  res.json(readiness);
});

app.post("/api/items/:id/recheck-export-readiness", requireRole("admin", "owner"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemBriefReadAccess(req, res, item)) {
    return;
  }

  const readiness = buildExportReadiness(id);
  if (!readiness) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  repo.logAudit(actorEmail(req), "export.recheck_readiness", "content_item", String(id), {
    source_ready: readiness.source_ready,
    translation_counts: readiness.translation_counts,
  });
  res.json({ ok: true, readiness });
});

app.post("/api/items/:id/release-main", requireRole("admin", "owner"), workflowRateLimit, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  const readiness = buildExportReadiness(id);
  if (!readiness?.source_ready) {
    res.status(409).json({
      error: "ข้อมูลต้นทางยังไม่พร้อมสำหรับส่งออก",
      readiness,
    });
    return;
  }
  if (!readiness?.editorial_ready && !readiness?.field_flow_ready) {
    res.status(409).json({
      error: "ข้อมูลยังไม่ผ่าน publish gate สำหรับส่งออก",
      readiness,
    });
    return;
  }
  const translationRecheckGate = getRequiredTranslationRecheckBlockers(id, readiness);
  if (translationRecheckGate.blocking) {
    res.status(409).json({
      error: "คำแปลยังไม่ผ่าน translation recheck สำหรับส่งออก",
      reason: `Blocked locales: ${translationRecheckGate.blocking_langs.join(", ")}`,
      locales: translationRecheckGate.blocking_langs,
      translation_recheck_gate: translationRecheckGate,
      readiness,
    });
    return;
  }

  try {
    const aiConfig = getEffectiveAiConfig();
    const workflowBeforeRelease = repo.ensureWorkflowModel(id);
    const publishedArticleBefore = repo.getPublishedArticleByItem(id);
    const autoSync = String(req.query?.sync_backend || "1") !== "0";
    if (autoSync && !hasExplicitCollectorPublicBaseUrl()) {
      res.status(409).json({
        error: "COLLECTOR_PUBLIC_BASE_URL is required before backend sync/release.",
        readiness,
      });
      return;
    }

    const result = await releaseItemToMainSite(repo, dirs, actorEmail(req), {
      contentItemId: id,
      actor_role: actorPolicyRole(req),
      aiConfig,
      skipTranslationStage: true,
      approval_notes: "อนุมัติจากขั้นตอนส่งออกไปเว็บไซต์หลัก",
    });

    let backendSync = null;
    if (autoSync) {
      assertCollectorIntegrationReadiness(collectorIntegrationConfig(), ["publish_sync_to_backend"]);
      const payload = buildBackendSyncPayload({ contentItemId: id });
      const simulateSyncFailure = String(req.query?.simulate_sync_failure || "0") === "1";
      const simulateSyncSuccess = String(req.query?.simulate_sync_success || "0") === "1";
      if ((simulateSyncFailure || simulateSyncSuccess) && !canUseLocalReleaseSyncSimulation()) {
        res.status(403).json({ error: "release sync simulation is not allowed in this environment" });
        return;
      }
      let syncStatus = 0;
      let syncOk = false;
      let body = { error: "Invalid backend sync response" };

      if (simulateSyncFailure) {
        syncStatus = 502;
        syncOk = false;
        body = { error: "Simulated backend sync failure" };
      } else if (simulateSyncSuccess) {
        syncStatus = 200;
        syncOk = true;
        body = { ok: true, simulated: true, message: "Simulated backend sync success" };
      } else {
        const syncRes = await fetch(`${backendApiBase}/lifecycle/import-published`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-lifecycle-token": backendSyncToken,
          },
          body: JSON.stringify(payload),
        });
        syncStatus = Number(syncRes.status || 0) || 500;
        syncOk = Boolean(syncRes.ok);
        body = await syncRes.json().catch(() => ({ error: "Invalid backend sync response" }));
      }

      backendSync = {
        ok: syncOk,
        status: syncStatus,
        result: body,
        payload_summary: {
          published: payload.published.length,
          translations: payload.translations.length,
        },
      };

      if (!syncOk) {
        repo.logAudit(actorEmail(req), "publish.sync_backend.failed", "content_item", String(id), {
          content_item_id: id,
          status: syncStatus,
          error: body?.error || "Backend sync failed",
          payload_summary: backendSync.payload_summary,
        });

        let compensationResult = null;
        try {
          compensationResult = compensateReleaseAfterSyncFailure(repo, actorEmail(req), {
            content_item_id: id,
            workflow_before: workflowBeforeRelease,
            published_article_before: publishedArticleBefore,
            actor_role: actorPolicyRole(req),
            reason_code: "publish_sync_compensation",
            note: `compensate release-main after backend sync failed (status=${syncStatus})`,
          });
          repo.logAudit(actorEmail(req), "publish.compensation.success", "content_item", String(id), {
            content_item_id: id,
            sync_status: syncStatus,
            workflow_after: compensationResult?.workflow_after || null,
            published_article_status: compensationResult?.published_article_status || null,
          });
        } catch (compErr) {
          const compensationError = String(compErr?.message || "publish compensation failed");
          repo.logAudit(actorEmail(req), "publish.compensation.failed", "content_item", String(id), {
            content_item_id: id,
            sync_status: syncStatus,
            sync_error: body?.error || "Backend sync failed",
            compensation_error: compensationError,
          });
          res.status(500).json({
            error: "Backend sync failed and compensation failed",
            backend_sync: backendSync,
            compensation: {
              ok: false,
              error: compensationError,
            },
            result,
            readiness: buildExportReadiness(id),
          });
          return;
        }

        res.status(syncStatus).json({
          error: body?.error || "Backend sync failed",
          backend_sync: backendSync,
          compensation: {
            ok: true,
            result: compensationResult,
          },
          result,
          readiness: buildExportReadiness(id),
        });
        return;
      }

      repo.logAudit(actorEmail(req), "publish.sync_backend", "lifecycle_sync", "backend", {
        trigger: "item_release_main",
        content_item_id: id,
        published: payload.published.length,
        translations: payload.translations.length,
        result: body,
      });
    }

    res.json({
      ok: true,
      ...result,
      backend_sync: backendSync,
      readiness: buildExportReadiness(id),
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot release item to main site");
    const status = /publish prerequisite conflict|missing_approved_review|stale_approved_review|approved_review_not_for_latest_draft|missing_quality_report|missing_latest_draft/i.test(msg)
      ? 409
      : /item not found/i.test(msg)
        ? 404
        : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/submit-admin-review", requireRole("admin", "owner"), workflowRateLimit, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  if (!String(backendApiBase || "").trim() || !/^https?:\/\//i.test(String(backendApiBase || "").trim())) {
    res.status(409).json({ error: "COLLECTOR_SYNC_BACKEND_API is required before admin review ingest." });
    return;
  }
  if (!hasExplicitCollectorPublicBaseUrl()) {
    res.status(409).json({ error: "COLLECTOR_PUBLIC_BASE_URL is required before admin review ingest." });
    return;
  }

  try {
    const item = repo.getItem(id);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    if (!ensureItemMutationAccess(req, res, item)) {
      return;
    }
    const readiness = buildExportReadiness(id);
    if (!readiness?.source_ready) {
      res.status(409).json({
        error: "ข้อมูลต้นทางยังไม่พร้อมสำหรับส่งเข้า admin review",
        readiness,
      });
      return;
    }
    if (!readiness?.editorial_ready && !readiness?.field_flow_ready) {
      res.status(409).json({
        error: "ข้อมูลยังไม่ผ่าน publish gate สำหรับส่งเข้า admin review",
        readiness,
      });
      return;
    }
    const translationRecheckGate = getRequiredTranslationRecheckBlockers(id, readiness);
    if (translationRecheckGate.blocking) {
      res.status(409).json({
        error: "คำแปลยังไม่ผ่าน translation recheck สำหรับส่งเข้า admin review",
        reason: `Blocked locales: ${translationRecheckGate.blocking_langs.join(", ")}`,
        locales: translationRecheckGate.blocking_langs,
        translation_recheck_gate: translationRecheckGate,
        readiness,
      });
      return;
    }
    const workflowModel = repo.ensureWorkflowModel(id);
    const publishableSource = repo.buildPublishableSourceByItem(id);
    const workflowTransitions = repo.listWorkflowTransitionsByItem(id, 12);
    const processStatus = deriveQueuedArticleProcessStatus(
      item,
      workflowModel,
      workflowTransitions,
      deriveArticleProcessStatus(item, workflowModel, publishableSource),
    );
    if (processStatus !== "ready_for_sync") {
      res.status(409).json({
        error: "item is not ready_for_sync",
        status: processStatus,
      });
      return;
    }

    const contentType = String(item?.type || "").trim().toLowerCase() === "event" ? "event" : "place";
    if (isPlaceholderSecret(webReviewSyncToken)) {
      res.status(409).json({ error: "COLLECTOR_REVIEW_SYNC_TOKEN is required before admin review ingest." });
      return;
    }
    const payload = buildReviewIngestPayload({
      contentItemId: id,
      sourceBaseUrl: resolveCollectorRequestBaseUrl(req) || resolveCollectorPublicBaseUrl(),
    });
    const multipartPlan = buildAdminReviewMultipartFilePlan(payload, id);
    if (String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production") {
      try {
        console.error("[collector review ingest media_manifest]", JSON.stringify({
          content_item_id: id,
          content_type: payload?.content?.content_type || null,
          media_manifest: payload?.media_manifest || null,
          eligible_selected_asset_count: Number(multipartPlan?.eligibleSelectedAssetCount || 0) || 0,
          uploaded_file_count: Array.isArray(multipartPlan?.uploadPlan) ? multipartPlan.uploadPlan.length : 0,
          upload_diagnostics: Array.isArray(multipartPlan?.diagnostics) ? multipartPlan.diagnostics : [],
        }));
      } catch {
        console.error("[collector review ingest media_manifest]");
      }
    }
    const formData = new FormData();
    formData.append("payload", JSON.stringify(payload));
    const mediaIndex = [];
    for (const plannedFile of multipartPlan.uploadPlan) {
      const fileBuffer = await fs.readFile(plannedFile.absolute_path);
      const blob = new Blob([fileBuffer], { type: plannedFile.mime_type || "application/octet-stream" });
      const fieldName = `media_${plannedFile.client_media_uid}`;
      formData.append(fieldName, blob, plannedFile.original_file_name);
      mediaIndex.push({
        client_media_uid: plannedFile.client_media_uid,
        field_name: fieldName,
        original_name: plannedFile.original_file_name,
        source_asset_id: plannedFile.asset_id,
        role: plannedFile.role,
        position: plannedFile.position,
        source_url: plannedFile.source_url,
      });
    }
    if (mediaIndex.length > 0) {
      formData.append("media_index", JSON.stringify({ files: mediaIndex }));
    }
    const ingestRes = await fetch(`${backendApiBase}/review-content/ingest`, {
      method: "POST",
      headers: {
        "x-review-sync-token": webReviewSyncToken,
      },
      body: formData,
    });
    const ingestBody = await ingestRes.json().catch(() => ({ error: "Invalid backend ingest response" }));
    const backendResult = {
      kind: "backend_ingest",
      ok: ingestRes.ok,
      status: ingestRes.status,
      result: ingestBody,
    };
    if (!ingestRes.ok) {
      res.status(ingestRes.status).json({
        error: ingestBody?.error || "Backend review ingest failed",
        backend_ingest: backendResult,
      });
      return;
    }
    repo.logAudit(actorEmail(req), "review_content.ingest_backend", "content_item", String(id), {
      source_system: payload.source_system,
      source_content_item_id: payload.source_content_item_id,
      content_type: payload.content?.content_type || null,
      review_content_id: Number(ingestBody?.item?.id || 0) || null,
    });
    repo.upsertWorkflowModel(
      id,
      {
        production_state: "submitted_for_admin_review",
        publication_state: "approved",
        last_transition_note: "submitted to admin review",
      },
      actorEmail(req),
      {
        actor_role: actorPolicyRole(req),
        reason_code: "article_process_admin_review_submitted",
      }
    );
    const nextItem = repo.getItem(id) || item;
    res.json({
      ok: true,
      item: nextItem,
      article_process: buildArticleProcessPayload(req, nextItem),
      readiness: buildExportReadiness(id),
      backend_ingest: backendResult?.kind === "backend_ingest" ? backendResult : null,
      backend_sync: backendResult?.kind === "backend_sync" ? backendResult : null,
      backend_queue: null,
    });
  } catch (err) {
    const msg = String(err?.message || "Cannot submit admin review");
    const status = /not found/i.test(msg) ? 404 : /required|incomplete/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/items/:id/recover-problem-translations", requireRole("admin", "owner"), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const aiConfig = getEffectiveAiConfig();
    const result = await rerunProblemTranslations(repo, actorEmail(req), { aiConfig, content_item_id: id });
    const readiness = buildExportReadiness(id);
    repo.logAudit(actorEmail(req), "translation.recover_problematic", "content_item", String(id), result);
    res.json({ ok: true, result, readiness });
  } catch (err) {
    const message = String(err?.message || "Cannot recover translations");
    res.status(400).json({ error: message });
  }
});

app.post("/api/items/:id/generate-translations", requireRole("admin", "owner"), async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const aiConfig = getEffectiveAiConfig();
    const result = await rerunProblemTranslations(repo, actorEmail(req), {
      aiConfig,
      content_item_id: id,
      forceRegenerate: true,
    });
    const readiness = buildExportReadiness(id);
    repo.logAudit(actorEmail(req), "translation.generate", "content_item", String(id), result);
    res.json({
      ok: Number(result?.failed_count || 0) === 0,
      generated_count: Number(result?.generated_count || 0) || 0,
      failed_count: Number(result?.failed_count || 0) || 0,
      per_language_status: Array.isArray(result?.languages) ? result.languages : [],
      result,
      readiness,
    });
  } catch (err) {
    const message = String(err?.message || "Cannot generate translations");
    res.status(400).json({ error: message });
  }
});

app.post("/api/items/:id/translations/:lang/recheck", requireRole("admin", "owner"), async (req, res) => {
  const id = Number(req.params.id || 0);
  const lang = String(req.params.lang || "").trim().toLowerCase();
  if (!id || !lang) {
    res.status(400).json({ error: "Invalid item id or locale" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const aiConfig = getEffectiveAiConfig();
    const result = await rerunTranslationRecheck(repo, actorEmail(req), {
      aiConfig,
      content_item_id: id,
      lang,
    });
    const readiness = buildExportReadiness(id);
    res.json({
      ok: true,
      result,
      readiness,
      translations: repo.listTranslations(id),
    });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot run translation recheck") });
  }
});

app.post("/api/items/:id/translations/:lang/repair", requireRole("admin", "owner"), async (req, res) => {
  const id = Number(req.params.id || 0);
  const lang = String(req.params.lang || "").trim().toLowerCase();
  if (!id || !lang) {
    res.status(400).json({ error: "Invalid item id or locale" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }

  try {
    const aiConfig = getEffectiveAiConfig();
    const repairResult = await repairAndRecheckTranslationFromIssues(repo, id, lang, aiConfig, actorEmail(req));
    const translation = repairResult?.translation || null;
    const readiness = buildExportReadiness(id);
    res.json({
      ok: true,
      translation,
      translations: repo.listTranslations(id),
      readiness,
      result: {
        ...(repairResult?.recheck_result || {
          content_item_id: id,
          locales: [],
          completed_count: 0,
        }),
        lang,
        translation_recheck_status: String(translation?.translation_recheck_status || "not_checked").trim().toLowerCase() || "not_checked",
      },
    });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Cannot repair translation from recheck issues") });
  }
});

app.patch("/api/items/:id/assets/:assetId/selected", requireRole("owner", "admin", "editor", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  const assetId = Number(req.params.assetId || 0);
  const selected = req.body?.selected;

  if (!id || !assetId) {
    res.status(400).json({ error: "Invalid item or asset id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  const targetAsset = repo.listContentAssetsByItem(id, { onlySelected: false }).find((row) => Number(row?.asset_id || 0) === assetId) || null;
  const wantsSelected = selected === true || selected === 1 || selected === "1";

  try {
    const status = repo.setContentAssetSelected(id, assetId, selected);
    repo.logAudit(actorEmail(req), "asset.select", "content_item", String(id), { assetId, selected: !!selected });
    const cover = repo
      .listContentAssetsByItem(id, { onlySelected: true })
      .filter((row) => isCollectorControlledLocalAssetRow(row))
      .find((row) => Number(row?.is_cover || 0) === 1 || String(row?.role || "").trim().toLowerCase() === "cover")
      ?.public_url || "";
    if (item && cover && String(item.image_url || "").trim() !== String(cover).trim()) {
      repo.saveItem({ ...item, id, image_url: cover }, actorEmail(req));
    }
    res.json({ ok: true, status, assets: repo.listContentAssetsByItem(id) });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "Update failed") });
  }
});

app.patch("/api/items/:id/assets/:assetId/role", requireRole("owner", "admin", "editor", "user"), (req, res) => {
  const id = Number(req.params.id || 0);
  const assetId = Number(req.params.assetId || 0);
  const role = String(req.body?.role || "").trim().toLowerCase();

  if (!id || !assetId || !role) {
    res.status(400).json({ error: "Invalid item or asset role payload" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  const targetAsset = repo.listContentAssetsByItem(id, { onlySelected: false }).find((row) => Number(row?.asset_id || 0) === assetId) || null;
  const promotesUsableRole = role === "cover" || role === "gallery" || role === "inline";

  try {
    const status = repo.setContentAssetRole(id, assetId, role);
    repo.logAudit(actorEmail(req), "asset.role", "content_item", String(id), { assetId, role });

    const cover = repo
      .listContentAssetsByItem(id, { onlySelected: true })
      .filter((row) => isCollectorControlledLocalAssetRow(row))
      .find((row) => Number(row?.is_cover || 0) === 1 || String(row?.role || "").trim().toLowerCase() === "cover")
      ?.public_url || "";
    if (item) {
      const nextImage = cover || "";
      if (String(item.image_url || "").trim() !== String(nextImage).trim()) {
        repo.saveItem({ ...item, id, image_url: nextImage }, actorEmail(req));
      }
    }

    res.json({ ok: true, status, assets: repo.listContentAssetsByItem(id) });
  } catch (err) {
    res.status(400).json({ error: "Update failed" });
  }
});
app.delete("/api/items/:id", requireRole("admin", "owner"), (req, res) => {
  const id = Number(req.params.id);
  const current = repo.getItem(id);
  if (!current) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, current)) {
    return;
  }
  const rawOnlyEligibility = repo.getRawOnlyHardDeleteEligibility(id);
  if (rawOnlyEligibility?.eligible) {
    try {
      hardDeleteRawOnlyItemAndSweepAssets(id, actorEmail(req));
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      res.status(400).json({ error: message });
    }
    return;
  }
  try {
    assertItemsCanBeDeleted([current]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "delete failed";
    res.status(400).json({ error: message });
    return;
  }
  repo.deleteItem(id, actorEmail(req));
  res.json({ ok: true });
});

app.get("/api/admin/deleted-items", requireRole("owner"), (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 100) || 100));
  res.json({
    items: listDeletedItemCleanupReports(limit),
  });
});

app.get("/api/admin/deleted-items/:id/cleanup-check", requireRole("owner"), (req, res) => {
  const id = Number(req.params.id || 0) || 0;
  if (!id) {
    res.status(400).json({ error: "invalid item id" });
    return;
  }
  const row = getDeletedItemCleanupSnapshot(id);
  if (!row) {
    res.status(404).json({ error: "deleted item not found" });
    return;
  }
  res.json({
    ok: true,
    item: buildDeletedItemCleanupReport(row),
  });
});

app.post("/api/items/:id/field-pack/return-to-clean", requireRole("owner", "admin", "user"), workflowRateLimit, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  if (!ensurePrepItemEditAccess(req, res, item)) {
    return;
  }

  try {
    const result = returnFieldPackToClean(repo, actorEmail(req), {
      content_item_id: id,
      notes: req.body?.comment,
      actor_role: actorPolicyRole(req),
    });
    res.json(result);
  } catch (err) {
    const msg = String(err?.message || "Cannot return field pack to clean");
    const status = /current field pack not found/i.test(msg)
      ? 404
      : /notes\/reason is required|content_item_id is required/i.test(msg)
        ? 400
        : /active assignment|publish-ready|published state/i.test(msg)
          ? 409
          : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/admin/deleted-items/:id/references", requireRole("owner"), (req, res) => {
  const id = Number(req.params.id || 0) || 0;
  if (!id) {
    res.status(400).json({ error: "invalid item id" });
    return;
  }
  try {
    const result = repo.getDeletedItemReferenceGroups(id);
    res.json(result);
  } catch (err) {
    const statusCode = Number(err?.statusCode || 0) || 400;
    if (statusCode === 404) {
      res.status(404).json({ error: "deleted item not found" });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid request" });
  }
});

app.post("/api/admin/deleted-items/:id/references/cleanup", requireRole("owner"), (req, res) => {
  const id = Number(req.params.id || 0) || 0;
  if (!id) {
    res.status(400).json({ error: "invalid item id" });
    return;
  }
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  const reason = String(req.body?.reason || "").trim();
  try {
    const cleanupResult = repo.cleanupDeletedItemReferenceGroups({
      itemId: id,
      groups,
      actorEmail: actorEmail(req),
      reason,
    });
    const deletedAssetIds = Array.isArray(cleanupResult?.deleted_asset_ids) ? cleanupResult.deleted_asset_ids : [];
    let assetsCleaned = 0;
    const skipped_assets = [];
    for (const assetId of deletedAssetIds) {
      const result = deleteAssetIfUnused(assetId);
      if (result?.deleted_asset) assetsCleaned += 1;
      if (!result?.deleted_asset) {
        skipped_assets.push({
          asset_id: Number(assetId || 0) || 0,
          blocked_references: Array.isArray(result?.blocked_references) ? result.blocked_references : [],
        });
      }
    }
    const remainingGroups = repo.getDeletedItemReferenceGroups(id)?.groups || [];
    const normalizedRemainingGroups = remainingGroups.map((entry) => ({
      key: entry.key,
      count: Number(entry.count || 0) || 0,
      label_th: entry.label_th,
      category: entry.category,
      resolution_hint: entry.resolution_hint || null,
    }));
    res.json({
      ok: true,
      item_id: id,
      cleaned: cleanupResult?.cleaned || {},
      assets_cleaned: assetsCleaned,
      remaining_groups: normalizedRemainingGroups,
      remaining_blockers: normalizedRemainingGroups.filter((entry) => entry.category === "hard_blocker"),
      skipped_assets,
    });
  } catch (err) {
    const statusCode = Number(err?.statusCode || 0) || 400;
    if (statusCode === 404) {
      res.status(404).json({ error: "deleted item not found" });
      return;
    }
    if (statusCode === 400 && String(err?.message || "") === "group not eligible for cleanup") {
      res.status(400).json({
        error: "group not eligible for cleanup",
        group: String(err?.group || "").trim().toLowerCase() || null,
        category: String(err?.category || "").trim().toLowerCase() || "invalid_group",
      });
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "cleanup failed" });
  }
});

app.post("/api/admin/deleted-items/:id/purge", requireRole("owner"), (req, res) => {
  const id = Number(req.params.id || 0) || 0;
  if (!id) {
    res.status(400).json({ error: "invalid item id" });
    return;
  }
  const reason = String(req.body?.reason || "").trim();
  try {
    const purgedRow = purgeDeletedItemTx(id, actorEmail(req), reason);
    res.json({
      ok: true,
      purged: true,
      item: buildPurgedDeletedItemResult(purgedRow, actorEmail(req), reason),
    });
  } catch (err) {
    const statusCode = Number(err?.statusCode || 0) || 400;
    if (statusCode === 409) {
      res.status(409).json({
        error: "deleted item has purge blockers",
        blockers: Array.isArray(err?.blockers) ? err.blockers : [],
        item: err?.snapshot ? buildDeletedItemCleanupReport(err.snapshot) : null,
      });
      return;
    }
    if (statusCode === 404) {
      res.status(404).json({ error: "deleted item not found" });
      return;
    }
    const message = err instanceof Error ? err.message : "purge failed";
    res.status(400).json({ error: message });
  }
});

app.post("/api/import", requireRole("admin"), workflowRateLimit, (req, res) => {
  const format = String(req.body.format || "json").toLowerCase();
  const text = String(req.body.text || "");
  const rows = parseImportText(format, text);

  const saved = [];
  const actor = actorEmail(req);
  for (const row of rows) {
    const payload = row && typeof row === "object" ? { ...row } : {};
    const workflowPatch = resolveCreateWorkflowPatch(payload, "raw");
    if (Object.prototype.hasOwnProperty.call(payload, "workflow_status")) {
      delete payload.workflow_status;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "workflow_patch")) {
      delete payload.workflow_patch;
    }
    const { item } = repo.createItemWithWorkflowHead(
      payload,
      {
        production_state: workflowPatch.production_state,
        publication_state: workflowPatch.publication_state,
        assignment_state: workflowPatch.assignment_state || null,
        last_transition_note: "manual import created",
      },
      actor,
      {
        actor_role: "system",
        reason_code: "manual_import_created",
        bump_state_version: true,
      }
    );
    saved.push(item);
  }

  res.json({ imported: saved.length });
});
app.get("/api/source-adapters", (_req, res) => {
  res.json({ adapters: listSourceAdapters() });
});

app.get("/api/source-ingestions", requireRole("owner", "admin", "user"), (req, res) => {
  const limit = Number(req.query.limit || 100);
  res.json({ items: repo.listSourceIngestions(limit) });
});

app.get("/api/source-raw-items", requireRole("owner", "admin", "user"), (req, res) => {
  const batchUid = String(req.query.batch_uid || "").trim();
  const limit = Number(req.query.limit || 200);
  res.json({ items: repo.listRawSourceItems(batchUid, limit) });
});

app.post("/api/source-raw-items/import", requireRole("admin"), workflowRateLimit, (req, res) => {
  try {
    const batchUid = String(req.body?.batch_uid || "").trim();
    const adapter = String(req.body?.adapter || "").trim().toLowerCase();
    const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : [];

    if (!batchUid) {
      res.status(400).json({ error: "batch_uid is required" });
      return;
    }
    if (!decisions.length) {
      res.status(400).json({ error: "decisions are required" });
      return;
    }

    const rawItemIds = decisions.map((row) => Number(row?.raw_item_id || 0)).filter(Boolean);
    const rawItems = hydrateRawSourceItems(batchUid, rawItemIds);
    const rawMap = new Map(rawItems.map((row) => [Number(row.id || 0), row]));

    for (const rawItemId of rawItemIds) {
      if (!rawMap.has(rawItemId)) {
        res.status(400).json({ error: `????? raw item #${rawItemId} ?? batch ???` });
        return;
      }
    }

    const prepared = [];
    for (const decision of decisions) {
      const rawItemId = Number(decision?.raw_item_id || 0);
      if (!rawItemId) continue;

      const mode = String(decision?.decision || "skip").trim().toLowerCase();
      const rawItem = rawMap.get(rawItemId);
      if (!rawItem) {
        res.status(400).json({ error: `????? raw item #${rawItemId} ?? batch ???` });
        return;
      }

      const targetItemId = Number(decision?.existing_item_id || 0);
      if (mode === "merge") {
        if (!targetItemId) {
          res.status(400).json({ error: `?????????????????????????? raw #${rawItemId}` });
          return;
        }
        const existingItem = repo.getItem(targetItemId);
        if (!existingItem) {
          res.status(400).json({ error: `???????????????????????? merge (#${targetItemId})` });
          return;
        }
      }

      prepared.push({
        rawItem,
        mode,
        targetItemId,
        adapter: adapter || String(rawItem?.source_type || "manual").trim().toLowerCase(),
        actor: actorEmail(req),
      });
    }

    const result = importCollectedRawItemsTxn(prepared);
    res.json({
      ok: true,
      batch_uid: batchUid,
      adapter: adapter || null,
      imported_count: result.imported_count,
      merged_count: result.merged_count,
      new_count: result.new_count,
      skipped_count: result.skipped_count,
      seeded_evidence_count: result.seeded_evidence_count,
      bridged_image_count: result.bridged_image_count,
      reference_media_count: result.reference_media_count,
      results: result.results,
    });
  } catch (err) {
    res.status(400).json({ error: String(err?.message || "import failed").trim() || "import failed" });
  }
});

app.post("/api/collect", requireAuth, workflowRateLimit, async (req, res, next) => {
  try {
    const currentRole = String(req.authUser?.role || "").trim().toLowerCase();
    if (currentRole !== "owner" && currentRole !== "admin") {
      const errorPayload = { error: "Forbidden" };
      if (String(process.env.NODE_ENV || "development").toLowerCase() !== "production") {
        errorPayload.current_role = currentRole || "unknown";
        errorPayload.auth_source = String(req.authUser?.auth_source || "").trim() || "unknown";
        errorPayload.requires = "admin|owner";
      }
      res.status(403).json(errorPayload);
      return;
    }

    const adapter = String(req.body?.adapter || "manual").trim().toLowerCase();
    const sourceLabel = String(req.body?.source_label || "").trim() || null;
    const autoImport = req.body?.auto_import !== false;
    const payloadInput = req.body?.payload ?? [];
    const aiDiscovery = Boolean(req.body?.ai_discovery);

    const aiQueries =
      aiDiscovery && adapter === "google_maps"
        ? await buildAiCollectQueries(
            req.body?.topic || req.body?.query || "",
            req.body?.category || "attractions",
            req.body?.lang || "th",
            req.body?.max_queries || 5
          )
        : [];

    const payload = normalizeCollectPayload(payloadInput, adapter, aiQueries, req.body?.topic || req.body?.query || "");
    const batchUid = repo.startSourceIngestion(adapter, sourceLabel, "collecting", "Collect started");

    let rawCount = 0;
    let importedCount = 0;
  let bridgedImageCount = 0;
  let referenceMediaCount = 0;
    let signalSummary = summarizeCollectSignals([]);
    let seededEvidenceCount = 0;

    try {
      const collected = await collectRawFromAdapter(adapter, payload);
      signalSummary = summarizeCollectSignals(collected);

      for (const item of collected) {
        const rawItemId = repo.addRawSourceItem(batchUid, item);
        rawCount += 1;

        if (Array.isArray(item.media)) {
          for (const media of item.media) {
            repo.addRawSourceMedia(rawItemId, media);
          }
        }

        if (autoImport) {
          const n = item.normalized_json || {};
          const title = String(n.title || "").trim();
          const desc = String(n.description || "").trim();
          if (!title && !desc) continue;

          const { item: savedItem } = repo.createItemWithWorkflowHead(
            {
              type: n.type || "place",
              category: n.category || "attractions",
              lang: n.lang || "th",
              title: title || desc.slice(0, 120) || `raw-${rawItemId}`,
              description_raw: desc || title,
              description_clean: "",
              image_url: n.image || "",
              latitude: n.latitude,
              longitude: n.longitude,
              map_url: n.map_url || "",
              google_place_id: n.google_place_id || "",
              source_name: n.source_name || adapter,
              source_url: n.source_url || item.source_url || "",
              source_entity_id: n.google_place_id || item.source_ref || "",
              payload_json: item.payload_json?.payload_json || item.payload_json || n || null,
              tags: Array.isArray(n.tags) ? n.tags : [],
              source_type: adapter,
            },
            {
              production_state: "collected",
              publication_state: "draft",
              last_transition_note: "collect auto-import created",
            },
            actorEmail(req),
            {
              actor_role: "system",
              reason_code: "collect_auto_import_created",
              bump_state_version: true,
            }
          );

          if (savedItem?.id) {
            const sourceRecords = repo.listSourceRecordsByItem(savedItem.id);
            const seeded = seedEvidenceBlocksForItem(savedItem, {
              normalized: n,
              sourceType: adapter,
              sourceRecords,
            });
            seededEvidenceCount += Number(seeded?.added || 0);
            const referenceMedia = repo.listReferenceMediaByItem(savedItem.id);
            referenceMediaCount += Number(referenceMedia.length || 0);
          }

          importedCount += 1;
        }
      }

      repo.finishSourceIngestion(batchUid, "collected", rawCount, `Collected ${rawCount}`);

      res.json({
        ok: true,
        batch_uid: batchUid,
        adapter,
        ai_queries: aiQueries,
        raw_count: rawCount,
        imported_count: importedCount,
        bridged_image_count: bridgedImageCount,
        reference_media_count: referenceMediaCount,
        seeded_evidence_count: seededEvidenceCount,
        signal_summary: signalSummary,
        auto_import: autoImport,
      });
    } catch (err) {
      const rawMessage = String(err?.message || "").trim();
      const message = rawMessage || "collect failed";
      repo.finishSourceIngestion(batchUid, "failed", rawCount, message.slice(0, 400));
      const status = /missing|requires|unsupported|invalid|permission|api key|billing|quota|forbidden/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message, batch_uid: batchUid, adapter, raw_count: rawCount, imported_count: importedCount });
    }
  } catch (err) {
    next(err);
  }
});
app.post("/api/run/clean", requireRole("admin"), workflowRateLimit, safeAsync(async (req, res) => {
  const result = await runCleanStage(repo, actorEmail(req));
  res.json(result);
}));

app.post("/api/run/ai-draft", requireRole("admin", "user"), workflowRateLimit, async (req, res) => {
  const mode = "ai";
  const allowFallback = false;
  const contentItemId = Number(req.body?.content_item_id || 0) || null;

  if (!contentItemId) {
    res.status(400).json({ error: "content_item_id is required" });
    return;
  }

  const item = repo.getItem(contentItemId);
  if (!item) {
    res.status(404).json({ error: "Item not found", content_item_id: contentItemId });
    return;
  }
  if (!ensurePrepItemEditAccess(req, res, item)) {
    return;
  }

  const cleanup = purgeUnusedContentAssetsForItem(contentItemId);
  if (cleanup.removed_links > 0 || cleanup.removed_assets > 0 || cleanup.removed_local_files > 0) {
    repo.logAudit(actorEmail(req), "asset.cleanup.purge_unused_before_generate", "content_item", String(contentItemId), cleanup);
  }

  // Clean / Field Pack Draft stage does not hard-block on missing images or cover.
  // Media at this stage is optional/reference/evidence.
  // Submit Admin Review / Release Main still hard-blocks without local usable media.
  const preview = buildCleanStructuredContext(repo, contentItemId);
  const minimum = validateCleanMinimum(repo, contentItemId);
  if (!minimum.ok) {
    res.status(400).json({
      error: (Array.isArray(minimum?.blocking_reasons) && minimum.blocking_reasons[0])
        || "Agent blocked: minimum clean context requirements are not met",
      content_item_id: contentItemId,
      completeness: preview?.completeness || null,
      minimum,
      cleanup,
    });
    return;
  }

  try {
    const aiConfig = getEffectiveAiConfig();
    const aiRuntime = buildAiFeatureRuntimeSnapshot(aiConfig);
    repo.logAudit(actorEmail(req), "ai_draft.run.start", "content_item", String(contentItemId), {
      content_item_id: contentItemId,
      ai_runtime: aiRuntime,
      mode,
      allow_fallback: allowFallback,
    });
    const maxRetries = 2;
    const retryDelaysMs = [1200, 3000];
    let attempt = 0;
    let lastError = null;
    let result = null;
    while (attempt <= maxRetries) {
      try {
        result = await runAiDraftStage(repo, actorEmail(req), { mode, allowFallback, aiConfig, contentItemId });
        break;
      } catch (err) {
        lastError = err;
        if (attempt >= maxRetries || !isRetryableAiDraftError(err)) {
          throw err;
        }
        const delayMs = retryDelaysMs[attempt] || retryDelaysMs[retryDelaysMs.length - 1];
        repo.logAudit(actorEmail(req), "ai_draft.run.retry", "content_item", String(contentItemId), {
          content_item_id: contentItemId,
          ai_runtime: aiRuntime,
          attempt: attempt + 1,
          max_retries: maxRetries,
          delay_ms: delayMs,
          error: String(err?.message || "").trim() || "unknown error",
        });
        await sleep(delayMs);
      }
      attempt += 1;
    }
    if (!result && lastError) throw lastError;

    if ((result.blocked_items || []).length > 0) {
      res.status(400).json({
        error: "Agent blocked: one or more items do not meet clean requirements",
        blocked_items_count: result.blocked_items.length,
        ai_runtime: aiRuntime,
        ...result,
      });
      return;
    }

    res.json({
      ...result,
      ai_runtime: aiRuntime,
    });
  } catch (err) {
    const reason = String(err?.message || "").trim();
    const msg = reason ? `Agent failed: ${reason}` : "Agent failed";
    const aiConfig = getEffectiveAiConfig();
    const aiRuntime = buildAiFeatureRuntimeSnapshot(aiConfig);
    repo.logAudit(actorEmail(req), "ai_draft.run.error", "content_item", String(contentItemId), {
      content_item_id: contentItemId,
      ai_runtime: aiRuntime,
      mode,
      allow_fallback: allowFallback,
      error: msg,
    });
    res.status(400).json({ error: msg, ai_runtime: aiRuntime });
  }
});

app.post("/api/run/quality", requireRole("admin"), workflowRateLimit, safeAsync(async (req, res) => {
  const result = await runQualityStage(repo, actorEmail(req));
  res.json(result);
}));

app.post("/api/review/action", requireRole("admin"), (req, res) => {
  try {
    const result = applyReviewAction(repo, actorEmail(req), req.body || {});
    res.json({ ...result, cleanup });
  } catch (err) {
    const msg = String(err?.message || "Cannot apply review action");
    const status = /invalid .*transition|cannot transition|Invalid review action payload|review prerequisite missing|latest review report is required|review governance conflict/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});
app.post("/api/review/reopen", requireRole("admin"), (req, res) => {
  try {
    const result = reopenReviewDecision(repo, actorEmail(req), req.body || {});
    res.json(result);
  } catch (err) {
    const msg = String(err?.message || "Cannot reopen workflow decision");
    const status = /workflow reopen conflict|invalid .*transition|cannot transition/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/review-queue", (_req, res) => {
  res.json(repo.listReviewQueue());
});

app.post("/api/web-review-feedback", async (req, res) => {
  if (!hasConfiguredWebReviewToken()) {
    res.status(503).json({ error: "COLLECTOR_REVIEW_SYNC_TOKEN is not configured" });
    return;
  }
  const providedToken = String(req.headers["x-review-sync-token"] || "").trim();
  if (!isValidWebReviewSyncToken(providedToken)) {
    res.status(401).json({ error: "Invalid review sync token" });
    return;
  }

  const sourceSystem = String(req.body?.source_system || "").trim().toLowerCase();
  const contentType = String(req.body?.content_type || "").trim().toLowerCase();
  const sourceContentItemId = Number(req.body?.source_content_item_id || 0);
  const status = String(req.body?.status || "").trim().toLowerCase();
  const reviewNote = String(req.body?.review_note || "").trim() || "needs revision from web review";
  const reviewedBy = Number(req.body?.reviewed_by || 0) || null;

  if (sourceSystem !== "collector-app") {
    res.status(400).json({ error: "source_system must be collector-app" });
    return;
  }
  if (contentType !== "place" && contentType !== "event") {
    res.status(400).json({ error: "content_type must be place or event" });
    return;
  }
  if (!Number.isFinite(sourceContentItemId) || sourceContentItemId <= 0) {
    res.status(400).json({ error: "source_content_item_id must be positive" });
    return;
  }
  if (status !== "needs_revision") {
    res.status(400).json({ error: "status must be needs_revision" });
    return;
  }

  const item = repo.getItem(sourceContentItemId);
  if (!item) {
    res.status(404).json({ error: "content item not found" });
    return;
  }

  try {
    const actor = "web-review-sync";
    const workflowBefore = repo.ensureWorkflowModel(sourceContentItemId);
    const nextPublicationState =
      String(workflowBefore?.publication_state || "").trim().toLowerCase() === "published"
        ? "unpublished"
        : "draft";
    const nextProductionState = "needs_revision";
    repo.upsertWorkflowModel(
      sourceContentItemId,
      {
        production_state: nextProductionState,
        publication_state: nextPublicationState,
        last_transition_note: reviewNote,
      },
      actor,
      {
        actor_role: "admin",
        reason_code: "web_review_needs_revision",
      }
    );
    repo.logAudit(actor, "web_review.feedback.needs_revision", "content_item", String(sourceContentItemId), {
      source_system: sourceSystem,
      content_type: contentType,
      previous_production_state: workflowBefore?.production_state || null,
      next_production_state: nextProductionState,
      review_note: reviewNote,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    });
    res.json({ ok: true, source_content_item_id: sourceContentItemId, status: "needs_revision" });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || "cannot persist feedback") });
  }
});

app.post("/api/internal-links/:id/review", requireRole("admin"), (req, res) => {
  const result = reviewInternalLink(repo, actorEmail(req), req.params.id, req.body?.action);
  res.json(result);
});

app.get("/api/internal-links", (req, res) => {
  const contentItemId = Number(req.query.content_item_id || 0) || null;
  const status = String(req.query.status || "").trim();
  res.json(repo.listInternalLinkSuggestions(contentItemId, status));
});

app.post("/api/run/publish", requireRole("admin", "owner"), workflowRateLimit, (req, res) => {
  respondBatchReleaseDisabled(req, res, "/api/run/publish");
});

app.post("/api/run/stage", requireRole("admin", "owner"), workflowRateLimit, (req, res) => {
  respondBatchReleaseDisabled(req, res, "/api/run/stage");
});

app.get("/api/published", (_req, res) => {
  res.json(repo.listPublishedArticles());
});

app.post("/api/items/:id/unpublish", requireRole("admin", "owner"), (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  const item = repo.getItem(id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureItemMutationAccess(req, res, item)) {
    return;
  }
  const workflowBefore = repo.ensureWorkflowModel(id);
  if (String(workflowBefore?.publication_state || "").toLowerCase() !== "published") {
    res.status(409).json({ error: "item is not in published state" });
    return;
  }
  const publishedArticle = repo.getPublishedArticleByItem(id);
  if (!publishedArticle) {
    res.status(409).json({ error: "published article not found for item" });
    return;
  }

  try {
    const reasonCode = String(req.body?.reason_code || "").trim().toLowerCase() || "publish_unpublished";
    const notes = String(req.body?.notes || "").trim() || null;
    const workflowAfter = repo.upsertWorkflowModel(
      id,
      {
        production_state: workflowBefore?.production_state || "completed",
        publication_state: "unpublished",
        last_transition_note: notes || "unpublished by governance action",
      },
      actorEmail(req),
      {
        actor_role: actorPolicyRole(req),
        reason_code: reasonCode,
      }
    );
    repo.setPublishedArticleStatusByItem(id, "unpublished");
    repo.logAudit(actorEmail(req), "publish.unpublish", "content_item", String(id), {
      content_item_id: id,
      draft_id: publishedArticle?.draft_id || null,
      review_report_id: publishedArticle?.review_report_id || null,
      reason_code: reasonCode,
      from_production_state: workflowBefore?.production_state || null,
      to_production_state: workflowAfter?.production_state || null,
      from_publication_state: workflowBefore?.publication_state || null,
      to_publication_state: workflowAfter?.publication_state || null,
    });
    res.json({ ok: true, item_id: id, publication_state: workflowAfter?.publication_state || "unpublished" });
  } catch (err) {
    const msg = String(err?.message || "Cannot unpublish item");
    const status = /published article not found|invalid publication status|invalid .*transition|cannot transition/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get("/api/translations", requireRole("owner", "admin", "editor", "user"), (req, res) => {
  const contentItemId = Number(req.query.content_item_id || 0) || 0;
  if (!contentItemId) {
    res.status(400).json({ error: "content_item_id is required" });
    return;
  }
  const item = repo.getItem(contentItemId);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureArticleProcessReadAccess(req, res, item)) {
    return;
  }
  res.json(repo.listTranslations(contentItemId));
});

app.get("/api/translation-runs", requireRole("owner", "admin"), (_req, res) => {
  res.json(repo.listTranslationRuns());
});

app.post("/api/run/approve", requireRole("admin", "owner"), workflowRateLimit, (req, res) => {
  respondBatchReleaseDisabled(req, res, "/api/run/approve");
});

app.post("/api/run/export", requireRole("owner"), workflowRateLimit, (req, res) => {
  respondBatchReleaseDisabled(req, res, "/api/run/export");
});

app.post("/api/run/sync-backend", requireRole("owner"), workflowRateLimit, (req, res) => {
  respondBatchReleaseDisabled(req, res, "/api/run/sync-backend");
});

app.get("/api/quality", (_req, res) => {
  res.json(repo.listQualityChecks());
});

app.get("/api/staging", (_req, res) => {
  res.json(repo.listStaging());
});

app.get("/api/exports", (_req, res) => {
  res.json(repo.listExports());
});

app.get("/api/assets", (req, res) => {
  const role = actorPolicyRole(req, "");
  const contentItemId = Number(req.query.content_item_id || 0);
  const onlySelected = role === "freelance" || String(req.query.only_selected || "0") === "1";
  const localOnly = String(req.query.local_only || "0") === "1";
  let rows = [];

  if (contentItemId > 0) {
    if (!ensureItemBriefReadAccess(req, res, contentItemId)) {
      return;
    }
    cleanupExpiredAssignmentWorkDraftAssets({ contentItemId, maxAgeMs: ASSIGNMENT_WORK_SYNC_EXPIRY_MS });
  } else if (role !== "owner" && role !== "admin" && role !== "user") {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  if (contentItemId > 0) {
    rows = db
      .prepare(`
      SELECT a.*, ca.content_item_id, ca.role, ca.sort_order, ca.selected_in_clean, ca.is_cover, ca.placement_type,
             ca.assignment_id, ca.assignment_round, ca.assignment_media_type, ca.assignment_slot_key, ca.assignment_surface, ca.assignment_sync_batch_id,
             c.title AS content_title
      FROM assets a
      LEFT JOIN content_assets ca ON ca.asset_id = a.id
      LEFT JOIN content_items c ON c.id = ca.content_item_id
      WHERE ca.content_item_id = ?
      ORDER BY a.id DESC
    `)
      .all(contentItemId);
  } else {
    rows = db
      .prepare(`
      SELECT a.*, ca.content_item_id, ca.role, ca.sort_order, ca.selected_in_clean, ca.is_cover, ca.placement_type,
             ca.assignment_id, ca.assignment_round, ca.assignment_media_type, ca.assignment_slot_key, ca.assignment_surface, ca.assignment_sync_batch_id,
             c.title AS content_title
      FROM assets a
      LEFT JOIN content_assets ca ON ca.asset_id = a.id
      LEFT JOIN content_items c ON c.id = ca.content_item_id
      ORDER BY a.id DESC
    `)
      .all();
  }

  const mapped = rows
    .map((row) => ({
      ...row,
      selected_in_clean: Number(row.selected_in_clean || 0),
      is_cover: Number(row.is_cover || 0),
      placement_type: String(row.placement_type || "unused"),
      slotKey: String(row.assignment_slot_key || "").trim().toLowerCase() || null,
      mediaType: String(row.assignment_media_type || "").trim().toLowerCase() || null,
      public_url: parseAssetPathForUrl(row.storage_path),
    }))
    .filter((row) => isCollectorControlledLocalAssetRow(row))
    .filter((row) => (onlySelected ? row.selected_in_clean === 1 && row.role !== "unused" : true));

  res.json(mapped);
});

app.post("/api/assets/upload", requireRole("owner", "admin", "editor", "user"), uploadRateLimit, upload.array("file", 20), async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    res.status(400).json({ error: "File is required" });
    return;
  }

  const contentItemId = Number(req.body.content_item_id || 0);
  if (!contentItemId) {
    res.status(400).json({ error: "content_item_id is required" });
    return;
  }
  const item = repo.getItem(contentItemId);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureComposerMediaEditAccess(req, res, item)) {
    return;
  }
  const requestedRole = String(req.body.role || "gallery");
  const insert = db.prepare(
    `
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  );
  const linkAsset = db.prepare(
    "INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0)"
  );
  const uploaded = [];

  for (const [index, file] of files.entries()) {
    const fileBuffer = fsSync.readFileSync(file.path);
    if (!isSupportedImageSignature(fileBuffer, String(file.mimetype || "").toLowerCase())) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: "Uploaded file signature does not match mime type" });
      return;
    }

    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const relativePath = path.relative(dirs.mediaDir, file.path);
    const assetUid = crypto.randomUUID();
    const result = insert.run(assetUid, "local", relativePath, file.originalname, file.mimetype, file.size, checksum);
    const assetId = Number(result.lastInsertRowid);
    const role = requestedRole === "cover" && index > 0 ? "gallery" : requestedRole;

    if (contentItemId > 0) {
      const selectedInClean = role === "unused" ? 0 : 1;
      const isCover = role === "cover" ? 1 : 0;
      const placementType = role === "inline" ? "inline" : role === "unused" ? "unused" : "gallery";
      linkAsset.run(contentItemId, assetId, role, selectedInClean, isCover, placementType);
    }

    repo.logAudit(actorEmail(req), "asset.upload", "asset", String(assetId), { contentItemId: contentItemId || null });
    uploaded.push({
      id: assetId,
      asset_uid: assetUid,
      storage_path: relativePath,
      public_url: parseAssetPathForUrl(relativePath),
      file_name: file.originalname,
      mime_type: file.mimetype,
      role,
    });
  }

  const first = uploaded[0] || null;
  res.status(201).json({
    id: first?.id || null,
    asset_uid: first?.asset_uid || null,
    storage_path: first?.storage_path || "",
    public_url: first?.public_url || "",
    uploaded,
  });
});

app.post("/api/assignments/:id/assets/uploads/start", requireRole("owner", "admin", "editor", "user", "freelance"), assignmentChunkUploadRateLimit, async (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  const assignment = await ensureAssignmentUploadAccess(req, res, assignmentId);
  if (!assignment) return;
  await cleanupStaleAssignmentUploadSessions({ maxAgeMs: ASSIGNMENT_CHUNK_SESSION_MAX_AGE_MS }).catch(() => {});

  const fileNameRaw = String(req.body?.file_name || "").trim();
  const mimeType = String(req.body?.mime_type || "").trim().toLowerCase();
  const sizeBytes = Number(req.body?.size_bytes || 0);
  const totalChunks = Number(req.body?.total_chunks || 0);
  const requestedChunkSize = Number(req.body?.chunk_size_bytes || ASSIGNMENT_CHUNK_SIZE_BYTES);
  const chunkSizeBytes = ASSIGNMENT_CHUNK_SIZE_BYTES;
  const syncBatchId = sanitizeAssignmentSyncBatchId(req.body?.sync_batch_id);
  const requestedSlotKey = sanitizeAssignmentCaptureSlotKey(req.body?.slot_key);
  const requestedMediaType = normalizeAssignmentCaptureMediaType(req.body?.media_type);

  if (!fileNameRaw) {
    res.status(400).json({ error: "file_name is required" });
    return;
  }
  if (!isAllowedAssignmentUploadMime(mimeType)) {
    res.status(400).json({ error: "Unsupported upload mime type for assignment work surface" });
    return;
  }
  if (!syncBatchId) {
    res.status(400).json({ error: "sync_batch_id is required" });
    return;
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    res.status(400).json({ error: "size_bytes must be a positive integer" });
    return;
  }
  if (sizeBytes > ASSIGNMENT_UPLOAD_MAX_BYTES) {
    res.status(400).json({ error: "File too large. Max 20GB per assignment upload." });
    return;
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 10000) {
    res.status(400).json({ error: "total_chunks is invalid" });
    return;
  }
  if (!Number.isInteger(requestedChunkSize) || requestedChunkSize !== ASSIGNMENT_CHUNK_SIZE_BYTES) {
    res.status(400).json({ error: "chunk_size_bytes must be 20MB" });
    return;
  }
  const expectedChunks = Math.max(1, Math.ceil(sizeBytes / chunkSizeBytes));
  if (expectedChunks !== totalChunks) {
    res.status(400).json({ error: "size_bytes and total_chunks do not match chunk_size_bytes" });
    return;
  }

  const uploadId = crypto.randomUUID();
  const now = new Date().toISOString();
  const contentItemId = Number(assignment.content_item_id || 0) || 0;
  const assignmentRound = resolveAssignmentCurrentRound(assignment);
  const actorUserId = Number(req.authUser?.id || 0) || 0;
  const tempDir = getAssignmentUploadTempDir(assignmentId, uploadId);
  await fs.mkdir(tempDir, { recursive: true });

  const manifest = {
    version: 1,
    upload_id: uploadId,
    assignment_id: assignmentId,
    actor_user_id: actorUserId,
    content_item_id: contentItemId,
    assignment_round: assignmentRound,
    file_name: sanitizeStoredUploadName(fileNameRaw, "upload.bin"),
    mime_type: mimeType,
    size_bytes: Math.floor(sizeBytes),
    total_chunks: Math.floor(totalChunks),
    chunk_size_bytes: chunkSizeBytes,
    sync_batch_id: syncBatchId,
    slot_key: requestedSlotKey || null,
    media_type: requestedMediaType || null,
    received_chunks: {},
    created_at: now,
    updated_at: now,
  };
  await writeAssignmentUploadManifest(assignmentId, uploadId, manifest);
  res.status(201).json({
    upload_id: uploadId,
    assignment_id: assignmentId,
    chunk_size_bytes: chunkSizeBytes,
    total_chunks: manifest.total_chunks,
  });
});

app.post("/api/assignments/:id/assets/uploads/:uploadId/chunks", requireRole("owner", "admin", "editor", "user", "freelance"), assignmentChunkUploadRateLimit, assignmentChunkUpload.single("chunk"), async (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  const uploadId = String(req.params.uploadId || "").trim();
  const assignment = await ensureAssignmentUploadAccess(req, res, assignmentId);
  if (!assignment) return;
  if (!uploadId) {
    res.status(400).json({ error: "uploadId is required" });
    return;
  }
  if (!isValidAssignmentUploadId(uploadId)) {
    res.status(400).json({ error: "uploadId is invalid" });
    return;
  }

  let manifest;
  try {
    manifest = await readAssignmentUploadManifest(assignmentId, uploadId);
  } catch {
    res.status(404).json({ error: "upload session not found" });
    return;
  }

  const actorUserId = Number(req.authUser?.id || 0) || 0;
  if (Number(manifest?.assignment_id || 0) !== assignmentId || Number(manifest?.actor_user_id || 0) !== actorUserId) {
    res.status(403).json({ error: "upload session access denied" });
    return;
  }

  const chunkIndex = Number(req.body?.chunk_index);
  const totalChunks = Number(manifest.total_chunks || 0);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
    res.status(400).json({ error: "chunk_index is invalid" });
    return;
  }
  const file = req.file;
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    res.status(400).json({ error: "chunk is required" });
    return;
  }
  const chunkSize = Number(file.size || file.buffer.length || 0);
  const expectedChunkSize = Number(manifest.chunk_size_bytes || ASSIGNMENT_CHUNK_SIZE_BYTES);
  const expectedTotalSize = Number(manifest.size_bytes || 0);
  const isLastChunk = chunkIndex === (totalChunks - 1);
  const expectedLastChunkSize = expectedTotalSize - (expectedChunkSize * (totalChunks - 1));
  if (!isLastChunk && chunkSize !== expectedChunkSize) {
    res.status(400).json({ error: "chunk size does not match expected chunk_size_bytes" });
    return;
  }
  if (isLastChunk && chunkSize !== expectedLastChunkSize) {
    res.status(400).json({ error: "last chunk size does not match expected remaining bytes" });
    return;
  }

  const chunkPath = getAssignmentChunkFilePath(assignmentId, uploadId, chunkIndex);
  await fs.writeFile(chunkPath, file.buffer);
  manifest.received_chunks = manifest.received_chunks && typeof manifest.received_chunks === "object"
    ? manifest.received_chunks
    : {};
  manifest.received_chunks[String(chunkIndex)] = {
    size_bytes: chunkSize,
    uploaded_at: new Date().toISOString(),
  };
  manifest.updated_at = new Date().toISOString();
  await writeAssignmentUploadManifest(assignmentId, uploadId, manifest);
  res.status(201).json({
    ok: true,
    upload_id: uploadId,
    chunk_index: chunkIndex,
    received_chunks: Object.keys(manifest.received_chunks).length,
    total_chunks: Number(manifest.total_chunks || 0),
  });
});

app.post("/api/assignments/:id/assets/uploads/:uploadId/finalize", requireRole("owner", "admin", "editor", "user", "freelance"), assignmentChunkUploadRateLimit, async (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  const uploadId = String(req.params.uploadId || "").trim();
  const assignment = await ensureAssignmentUploadAccess(req, res, assignmentId);
  if (!assignment) return;
  if (!uploadId) {
    res.status(400).json({ error: "uploadId is required" });
    return;
  }
  if (!isValidAssignmentUploadId(uploadId)) {
    res.status(400).json({ error: "uploadId is invalid" });
    return;
  }

  let manifest;
  try {
    manifest = await readAssignmentUploadManifest(assignmentId, uploadId);
  } catch {
    res.status(404).json({ error: "upload session not found" });
    return;
  }
  const actorUserId = Number(req.authUser?.id || 0) || 0;
  if (Number(manifest?.assignment_id || 0) !== assignmentId || Number(manifest?.actor_user_id || 0) !== actorUserId) {
    res.status(403).json({ error: "upload session access denied" });
    return;
  }

  const totalChunks = Number(manifest.total_chunks || 0);
  const expectedTotalSize = Number(manifest.size_bytes || 0);
  const expectedChunkSize = Number(manifest.chunk_size_bytes || ASSIGNMENT_CHUNK_SIZE_BYTES);
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(400).json({ error: "upload session total_chunks is invalid" });
    return;
  }
  if (!Number.isInteger(expectedTotalSize) || expectedTotalSize <= 0) {
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(400).json({ error: "upload session size_bytes is invalid" });
    return;
  }
  if (!Number.isInteger(expectedChunkSize) || expectedChunkSize < 1 || expectedChunkSize > ASSIGNMENT_CHUNK_MAX_BYTES) {
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(400).json({ error: "upload session chunk_size_bytes is invalid" });
    return;
  }

  const now = new Date();
  const finalRelativeDir = normalizeRelativeStoragePath(path.join(
    "assignment-originals",
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    `assignment-${assignmentId}`
  ));
  const safeName = sanitizeStoredUploadName(manifest.file_name, "upload.bin");
  const finalRelativePath = normalizeRelativeStoragePath(path.join(finalRelativeDir, `${Date.now()}-${safeName}`));
  const finalDirPath = resolveStoragePath(finalRelativeDir);
  const finalAbsolutePath = resolveStoragePath(finalRelativePath);
  const assemblingAbsolutePath = `${finalAbsolutePath}.assembling`;
  await fs.mkdir(finalDirPath, { recursive: true });

  let checksum = "";
  let normalizedMime = "";
  let assembledSize = 0;
  let output = null;
  try {
    const hash = crypto.createHash("sha256");
    output = fsSync.createWriteStream(assemblingAbsolutePath, { flags: "w" });
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkPath = getAssignmentChunkFilePath(assignmentId, uploadId, index);
      const expectedCurrentChunkSize = index === (totalChunks - 1)
        ? expectedTotalSize - (expectedChunkSize * (totalChunks - 1))
        : expectedChunkSize;
      let stats;
      try {
        stats = await fs.stat(chunkPath);
      } catch {
        throw new Error(`missing chunk ${index + 1}/${totalChunks}`);
      }
      const actualChunkSize = Number(stats?.size || 0);
      if (actualChunkSize !== expectedCurrentChunkSize) {
        throw new Error(`invalid chunk size at ${index + 1}/${totalChunks}`);
      }
      assembledSize += await appendChunkToStream(chunkPath, output, hash);
    }
    await new Promise((resolve, reject) => {
      output.once("error", reject);
      output.end(() => resolve());
    });
    checksum = hash.digest("hex");
    normalizedMime = String(manifest.mime_type || "").trim().toLowerCase();
  } catch (err) {
    if (output && !output.destroyed) {
      output.destroy();
    }
    await fs.unlink(assemblingAbsolutePath).catch(() => {});
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(400).json({ error: String(err?.message || "Cannot finalize upload") });
    return;
  }

  if (assembledSize !== expectedTotalSize) {
    await fs.unlink(assemblingAbsolutePath).catch(() => {});
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(400).json({ error: "assembled upload size mismatch" });
    return;
  }

  const signatureHead = await readFileHeadBytes(assemblingAbsolutePath, 8192);
  if (!isSupportedMediaSignature(signatureHead, normalizedMime)) {
    await fs.unlink(assemblingAbsolutePath).catch(() => {});
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(400).json({ error: "Uploaded file signature does not match mime type" });
    return;
  }

  try {
    await fs.rename(assemblingAbsolutePath, finalAbsolutePath);
  } catch {
    await fs.unlink(assemblingAbsolutePath).catch(() => {});
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(500).json({ error: "Cannot register finalized upload" });
    return;
  }

  const contentItemId = Number(assignment.content_item_id || 0) || 0;
  const assignmentRound = resolveAssignmentCurrentRound(assignment);
  const syncBatchId = sanitizeAssignmentSyncBatchId(manifest?.sync_batch_id);
  const persistedSlotKey = sanitizeAssignmentCaptureSlotKey(manifest?.slot_key);
  if (!syncBatchId) {
    await fs.unlink(finalAbsolutePath).catch(() => {});
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(400).json({ error: "upload session sync_batch_id is invalid" });
    return;
  }
  const insert = db.prepare(
    `
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  );
  const linkAsset = db.prepare(
    "INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order, assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)"
  );
  const assetUid = crypto.randomUUID();
  const mediaType = normalizedMime.startsWith("video/") ? "video" : "image";
  const assetRole = "unused";
  let assetId = 0;
  let transactionBegun = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionBegun = true;
    const insertResult = insert.run(
      assetUid,
      "local",
      finalRelativePath,
      safeName,
      normalizedMime,
      expectedTotalSize,
      checksum
    );
    const insertedAssetId = Number(insertResult.lastInsertRowid || 0) || 0;
    linkAsset.run(
      contentItemId,
      insertedAssetId,
      assetRole,
      0,
      0,
      "unused",
      assignmentId,
      assignmentRound,
      mediaType,
      persistedSlotKey || null,
      "assignment_work",
      syncBatchId
    );
    db.exec("COMMIT");
    transactionBegun = false;
    assetId = insertedAssetId;
  } catch (err) {
    if (transactionBegun) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
    console.error("[assignment.chunk.finalize.register_failed]", {
      assignmentId,
      uploadId,
      contentItemId,
      assignmentRound,
      finalRelativePath,
      finalAbsolutePath,
      normalizedMime,
      syncBatchId,
      expectedTotalSize,
      hasChecksum: Boolean(checksum),
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
    await fs.unlink(finalAbsolutePath).catch(() => {});
    await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
    res.status(500).json({ error: "Cannot register finalized upload" });
    return;
  }

  await removeAssignmentUploadSessionTempDir(assignmentId, uploadId).catch(() => {});
  try {
    repo.logAudit(actorEmail(req), "assignment.asset.upload", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      assignment_round: assignmentRound,
      content_item_id: contentItemId,
      asset_id: assetId,
      mime_type: normalizedMime,
      assignment_media_type: mediaType,
      assignment_slot_key: persistedSlotKey || null,
      assignment_sync_batch_id: syncBatchId,
    }, {
      assignment_id: assignmentId,
    });
  } catch (err) {
    console.error("[assignment.chunk.finalize.audit_failed]", {
      assignmentId,
      uploadId,
      assetId,
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
  const uploadedAsset = {
    id: assetId,
    asset_uid: assetUid,
    storage_path: finalRelativePath,
    public_url: parseAssetPathForUrl(finalRelativePath),
    file_name: safeName,
    mime_type: normalizedMime,
    slotKey: persistedSlotKey || null,
    mediaType,
    assignment_media_type: mediaType,
    assignment_slot_key: persistedSlotKey || null,
    assignment_round: assignmentRound,
    assignment_surface: "assignment_work",
    assignment_sync_batch_id: syncBatchId,
    role: assetRole,
  };
  res.status(201).json({
    id: uploadedAsset.id,
    asset_uid: uploadedAsset.asset_uid,
    storage_path: uploadedAsset.storage_path,
    public_url: uploadedAsset.public_url,
    uploaded: [uploadedAsset],
  });
});

app.post("/api/assignments/:id/assets/upload", requireRole("owner", "admin", "editor", "user", "freelance"), uploadRateLimit, assignmentUpload.array("file", 20), async (req, res) => {
  const assignmentId = Number(req.params.id || 0);
  if (!assignmentId) {
    res.status(400).json({ error: "Invalid assignment id" });
    return;
  }
  const assignment = repo.getAssignmentById(assignmentId);
  if (!assignment) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  if (actorPolicyRole(req) === "editor") {
    res.status(403).json({ error: "editor cannot upload assignment assets from this surface" });
    return;
  }
  if (!hasAssignmentSubmissionAccess(req, assignment)) {
    res.status(403).json({ error: "only assigned contributor can upload files for this assignment" });
    return;
  }
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    res.status(400).json({ error: "File is required" });
    return;
  }

  const contentItemId = Number(assignment.content_item_id || 0) || 0;
  const assignmentRound = resolveAssignmentCurrentRound(assignment);
  const syncBatchId = sanitizeAssignmentSyncBatchId(req.body?.sync_batch_id);
  const requestedSlotKey = sanitizeAssignmentCaptureSlotKey(req.body?.slot_key);
  if (!syncBatchId) {
    res.status(400).json({ error: "sync_batch_id is required" });
    return;
  }
  const insert = db.prepare(
    `
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  );
  const linkAsset = db.prepare(
    "INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order, assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)"
  );
  const uploaded = [];

  for (const file of files) {
    const normalizedMime = String(file.mimetype || "").trim().toLowerCase();
    const mediaType = normalizedMime.startsWith("video/") ? "video" : normalizedMime.startsWith("image/") ? "image" : "";
    if (!mediaType) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: "Unsupported upload mime type for assignment work surface" });
      return;
    }
    if (mediaType === "video" && Number(file.size || 0) > (500 * 1024 * 1024)) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: "Video file is too large. Max 500MB per file." });
      return;
    }
    const fileBuffer = fsSync.readFileSync(file.path);
    if (!isSupportedMediaSignature(fileBuffer, normalizedMime)) {
      await fs.unlink(file.path).catch(() => {});
      res.status(400).json({ error: "Uploaded file signature does not match mime type" });
      return;
    }

    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const relativePath = path.relative(dirs.mediaDir, file.path);
    const assetUid = crypto.randomUUID();
    const result = insert.run(assetUid, "local", relativePath, file.originalname, file.mimetype, file.size, checksum);
    const assetId = Number(result.lastInsertRowid);
    const assetRole = "unused";
    const placementType = "unused";
    linkAsset.run(
      contentItemId,
      assetId,
      assetRole,
      0,
      0,
      placementType,
      assignmentId,
      assignmentRound,
      mediaType,
      requestedSlotKey || null,
      "assignment_work",
      syncBatchId
    );

    repo.logAudit(actorEmail(req), "assignment.asset.upload", "assignment", String(assignmentId), {
      assignment_id: assignmentId,
      assignment_round: assignmentRound,
      content_item_id: contentItemId,
      asset_id: assetId,
      mime_type: file.mimetype || null,
      assignment_media_type: mediaType,
      assignment_slot_key: requestedSlotKey || null,
      assignment_sync_batch_id: syncBatchId,
    }, {
      assignment_id: assignmentId,
    });
    uploaded.push({
      id: assetId,
      asset_uid: assetUid,
      storage_path: relativePath,
      public_url: parseAssetPathForUrl(relativePath),
      file_name: file.originalname,
      mime_type: file.mimetype,
      slotKey: requestedSlotKey || null,
      mediaType,
      assignment_media_type: mediaType,
      assignment_slot_key: requestedSlotKey || null,
      assignment_round: assignmentRound,
      assignment_surface: "assignment_work",
      assignment_sync_batch_id: syncBatchId,
      role: assetRole,
    });
  }

  const first = uploaded[0] || null;
  res.status(201).json({
    id: first?.id || null,
    asset_uid: first?.asset_uid || null,
    storage_path: first?.storage_path || "",
    public_url: first?.public_url || "",
    uploaded,
  });
});

app.post("/api/assets/register", requireRole("owner", "admin", "editor", "user"), uploadRateLimit, (req, res) => {
  const storageDisk = String(req.body.storage_disk || "local").trim();
  const storagePath = String(req.body.storage_path || "").trim();
  const fileName = String(req.body.file_name || path.basename(storagePath || "asset.bin")).trim();
  const mimeType = String(req.body.mime_type || "").trim() || null;
  const sizeBytes = req.body.size_bytes ? Number(req.body.size_bytes) : null;
  const checksum = String(req.body.checksum || "").trim() || null;
  const contentItemId = Number(req.body.content_item_id || 0);
  const role = String(req.body.role || "gallery").trim();

  if (!storagePath) {
    res.status(400).json({ error: "storage_path is required" });
    return;
  }
  if (!contentItemId) {
    res.status(400).json({ error: "content_item_id is required" });
    return;
  }
  const item = repo.getItem(contentItemId);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (!ensureComposerMediaEditAccess(req, res, item)) {
    return;
  }

  const assetUid = crypto.randomUUID();
  const result = db
    .prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(assetUid, storageDisk, storagePath, fileName, mimeType, sizeBytes, checksum);

  const assetId = Number(result.lastInsertRowid);
  if (contentItemId > 0) {
    const selectedInClean = role === "unused" ? 0 : 1;
    const isCover = role === "cover" ? 1 : 0;
    const placementType = role === "inline" ? "inline" : role === "unused" ? "unused" : "gallery";
    db.prepare("INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0)").run(contentItemId, assetId, role, selectedInClean, isCover, placementType);
  }

  repo.logAudit(actorEmail(req), "asset.register", "asset", String(assetId), { contentItemId: contentItemId || null });

  res.status(201).json({
    id: assetId,
    asset_uid: assetUid,
    storage_path: storagePath,
    public_url: parseAssetPathForUrl(storagePath),
  });
});

app.delete("/api/assets/:id", requireRole("owner"), async (req, res) => {
  const id = Number(req.params.id);
  const asset = db.prepare("SELECT * FROM assets WHERE id=?").get(id);
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  db.prepare("DELETE FROM content_assets WHERE asset_id=?").run(id);
  db.prepare("DELETE FROM asset_variants WHERE asset_id=?").run(id);
  db.prepare("DELETE FROM assets WHERE id=?").run(id);

  if (asset.storage_disk === "local" || asset.storage_disk === "nas") {
    try {
      await fs.unlink(resolveStoragePath(asset.storage_path));
    } catch {
      // Keep delete behavior idempotent even if file was already missing.
    }
  }

  repo.logAudit(actorEmail(req), "asset.delete", "asset", String(id), null);
  res.json({ ok: true });
});

app.use((err, req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  const requestPath = String(req?.path || "").trim();
  const isAssignmentUploadPath = requestPath.startsWith("/api/assignments/") && requestPath.endsWith("/assets/upload");
  const isAssignmentChunkPath = requestPath.startsWith("/api/assignments/")
    && /\/assets\/uploads\/[^/]+\/chunks$/.test(requestPath);
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: isAssignmentUploadPath
          ? "File too large. Max 500MB per file."
          : isAssignmentChunkPath
            ? "Chunk too large. Max 30MB per request."
            : "File too large. Max 20MB.",
      });
      return;
    }
    res.status(400).json({ error: String(err.message || "Upload failed") });
    return;
  }
  if (String(err?.message || "") === "Unsupported upload mime type") {
    res.status(400).json({
      error: isAssignmentUploadPath
        ? "Unsupported upload mime type. Use JPEG, PNG, WEBP, GIF, MP4, WEBM, or MOV."
        : "Unsupported upload mime type. Use JPEG, PNG, WEBP, or GIF.",
    });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, bindHost, () => {
  if (slugBackfillResult && (slugBackfillResult.content_items_updated || slugBackfillResult.published_articles_updated)) {
    console.log("[slug.backfill]", slugBackfillResult);
  }
  console.log(`Collector app running on http://${bindHost}:${port}`);
});






































































































