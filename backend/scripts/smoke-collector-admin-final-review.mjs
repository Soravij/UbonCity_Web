import "dotenv/config";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const CLI_ARGS = process.argv.slice(2);

function readArgValue(name) {
  const prefix = `${name}=`;
  const match = CLI_ARGS.find((arg) => String(arg || "").startsWith(prefix));
  return match ? String(match.slice(prefix.length)).trim() : "";
}

function hasArg(name) {
  return CLI_ARGS.includes(name);
}

function printHelp() {
  console.log(
    [
      "collector-admin-final-review smoke",
      "",
      "Usage:",
      "  node scripts/smoke-collector-admin-final-review.mjs",
      "  node scripts/smoke-collector-admin-final-review.mjs --spawn --port=5098",
      "  node scripts/smoke-collector-admin-final-review.mjs --external-base-url=http://127.0.0.1:5000/api",
      "  node scripts/smoke-collector-admin-final-review.mjs --report-file=runtime/final-review-smoke.json",
      "",
      "Options:",
      "  --help                     Show this help text",
      "  --spawn                    Force starting a temporary local backend",
      "  --port=<number>            Port for temporary backend when spawning locally",
      "  --external-base-url=<url>  Use an already running backend instead of spawning one",
      "  --collector-sync-base-url=<url>",
      "                           Collector feedback base URL for --external-base-url mode",
      "  --collector-sync-token=<token>",
      "                           Collector feedback token for --external-base-url mode",
      "  --report-file=<path>       Write JSON result artifact to the given file",
      "",
      "Env fallbacks:",
      "  BACKEND_FINAL_REVIEW_SMOKE_BASE_URL",
      "  BACKEND_FINAL_REVIEW_SMOKE_PORT",
      "  BACKEND_FINAL_REVIEW_SMOKE_REPORT_FILE",
      "  BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_SYNC_BASE_URL",
      "  BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_SYNC_TOKEN",
      "  DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME",
      "  JWT_SECRET JWT_ISSUER JWT_AUDIENCE_BACKEND",
    ].join("\n")
  );
}

if (hasArg("--help")) {
  printHelp();
  process.exit(0);
}

const EXTERNAL_BASE_URL = String(
  readArgValue("--external-base-url") || process.env.BACKEND_FINAL_REVIEW_SMOKE_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");
const SMOKE_PORT = Number(readArgValue("--port") || process.env.BACKEND_FINAL_REVIEW_SMOKE_PORT || 5098);
const DB_HOST = String(process.env.DB_HOST || "127.0.0.1");
const DB_USER = String(process.env.DB_USER || "");
const DB_PASSWORD = String(process.env.DB_PASSWORD || "");
const DB_NAME = String(process.env.DB_NAME || "");
const DB_PORT = Number(process.env.DB_PORT || 3306);
const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ISSUER = String(process.env.JWT_ISSUER || "uboncity-backend").trim();
const JWT_AUDIENCE_BACKEND = String(process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend").trim();
const LIFECYCLE_SYNC_TOKEN = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
const EXTERNAL_COLLECTOR_SYNC_BASE_URL = String(
  readArgValue("--collector-sync-base-url") || process.env.BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_SYNC_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");
const EXTERNAL_COLLECTOR_SYNC_TOKEN = String(
  readArgValue("--collector-sync-token") || process.env.BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_SYNC_TOKEN || ""
).trim();
const BASE_URL = EXTERNAL_BASE_URL || `http://127.0.0.1:${SMOKE_PORT}/api`;
const REPORT_FILE = String(
  readArgValue("--report-file") || process.env.BACKEND_FINAL_REVIEW_SMOKE_REPORT_FILE || ""
).trim();
const BASE_URL_ORIGIN = new URL(BASE_URL).origin;
const SPAWN_BACKEND_PUBLIC_URL = `http://127.0.0.1:${SMOKE_PORT}`;
const DIRECT_RUN_STARTED_AT_MS = Date.now();
const DIRECT_RUN_STARTED_AT_ISO = new Date(DIRECT_RUN_STARTED_AT_MS).toISOString();
const SMOKE_REVIEW_SYNC_TOKEN = "smoke-review-sync-token";
const SMOKE_COVER_IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmJ0AAAAASUVORK5CYII=",
  "base64"
);
const BACKEND_UPLOADS_DIR = path.join(process.cwd(), "uploads");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toUploadsDiskPath(storagePath, fileName = "") {
  const normalizedStoragePath = String(storagePath || "").trim().replace(/\\/g, "/");
  if (normalizedStoragePath.startsWith("uploads/")) {
    return path.join(process.cwd(), normalizedStoragePath);
  }
  const normalizedFileName = String(fileName || "").trim();
  return normalizedFileName ? path.join(BACKEND_UPLOADS_DIR, normalizedFileName) : "";
}

async function cleanupPublishedMediaArtifacts(db, entityType, entityIds = []) {
  const normalizedEntityType = String(entityType || "").trim().toLowerCase();
  const normalizedIds = Array.from(
    new Set((Array.isArray(entityIds) ? entityIds : []).map((id) => Number(id || 0) || 0).filter(Boolean))
  );
  if (!normalizedIds.length) return;

  const placeholders = normalizedIds.map(() => "?").join(",");
  const [assetRows] = await db.query(
    `SELECT DISTINCT ma.id, ma.storage_path, ma.file_name
     FROM media_assets ma
     LEFT JOIN content_image_usages ciu ON ciu.asset_id = ma.id
     WHERE (ciu.entity_type=? AND ciu.entity_id IN (${placeholders}))
        OR (ma.related_type=? AND ma.related_id IN (${placeholders}))`,
    [normalizedEntityType, ...normalizedIds, normalizedEntityType, ...normalizedIds]
  );

  await db.query(
    `DELETE FROM content_image_usages
     WHERE entity_type=? AND entity_id IN (${placeholders})`,
    [normalizedEntityType, ...normalizedIds]
  );

  const assetIds = Array.from(
    new Set((Array.isArray(assetRows) ? assetRows : []).map((row) => Number(row?.id || 0) || 0).filter(Boolean))
  );
  if (assetIds.length > 0) {
    const assetPlaceholders = assetIds.map(() => "?").join(",");
    await db.query(`DELETE FROM media_assets WHERE id IN (${assetPlaceholders})`, assetIds);
  }

  for (const assetRow of Array.isArray(assetRows) ? assetRows : []) {
    const diskPath = toUploadsDiskPath(assetRow?.storage_path, assetRow?.file_name);
    if (!diskPath) continue;
    try {
      await fs.unlink(diskPath);
    } catch {}
  }
}

function createManifestWithCover(coverSourceUrl) {
  const normalizedCover = String(coverSourceUrl || "").trim();
  assert(normalizedCover, "cover source URL is required for smoke media fixture");
  return {
    authority: "release_main_selected_assets",
    cover: {
      source_url: normalizedCover,
      role: "cover",
      selected: true,
    },
    gallery: [],
    inline: [],
    video: [],
  };
}

function pickMediaSourceUrl(entry) {
  return String(entry?.source_url || entry?.backend_url || entry?.url || "").trim();
}

function buildReviewIngestPayloadFromQueueDetail(detailItem, sourceBaseUrl) {
  const snapshot = detailItem?.article_snapshot || {};
  const media = snapshot?.media_manifest || {};
  const coverSource = pickMediaSourceUrl(media?.cover);
  const gallery = Array.isArray(media?.gallery) ? media.gallery : [];
  const inline = Array.isArray(media?.inline) ? media.inline : [];
  const sourceContentType = String(detailItem?.source_content_type || "").trim().toLowerCase() === "event" ? "event" : "place";
  const sourceLang = String(detailItem?.source_lang || "th").trim().toLowerCase() || "th";

  return {
    source_system: "collector-app",
    source_content_item_id: Number(detailItem?.source_content_item_id || 0) || 0,
    source_base_url: String(sourceBaseUrl || "").trim() || undefined,
    content: {
      content_type: sourceContentType,
      lang: sourceLang,
      category: sourceContentType === "event" ? "event" : (snapshot?.category || detailItem?.category || "attractions"),
      slug: snapshot?.slug || detailItem?.slug || null,
      title: snapshot?.title || detailItem?.title || "",
      body: snapshot?.description || detailItem?.description || "",
      excerpt: snapshot?.excerpt || null,
      meta_title: snapshot?.meta_title || detailItem?.meta_title || null,
      meta_description: snapshot?.meta_description || detailItem?.meta_description || null,
      event_period_text: snapshot?.event_period_text || null,
      location_text: snapshot?.location_text || null,
      latitude: snapshot?.latitude ?? null,
      longitude: snapshot?.longitude ?? null,
      map_url: snapshot?.map_url || null,
      google_place_id: snapshot?.google_place_id || null,
      transport_subtype: snapshot?.transport_subtype || null,
      transport_contact_name: snapshot?.transport_contact_name || null,
      transport_contact_phone: snapshot?.transport_contact_phone || null,
      transport_contact_details: snapshot?.transport_contact_details || null,
      transport_link_url: snapshot?.transport_link_url || null,
      public_entity_type: sourceContentType,
      public_entity_id: Number(detailItem?.local_entity_id || detailItem?.entity_id || 0) || null,
      translation_langs: Array.isArray(detailItem?.translation_langs) ? detailItem.translation_langs : [],
    },
    media_manifest: {
      cover: coverSource ? { source_url: coverSource, role: "cover", selected: true } : null,
      gallery: gallery
        .map((entry) => pickMediaSourceUrl(entry))
        .filter(Boolean)
        .map((source_url) => ({ source_url, role: "gallery", selected: true })),
      inline: inline
        .map((entry) => pickMediaSourceUrl(entry))
        .filter(Boolean)
        .map((source_url) => ({ source_url, role: "inline", selected: true })),
    },
  };
}

async function writeReportArtifact(payload) {
  if (!REPORT_FILE) return;
  const targetPath = path.resolve(process.cwd(), REPORT_FILE);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createSyntheticOwnerToken() {
  return jwt.sign(
    {
      id: 999998,
      email: "synthetic-final-review-owner@local.test",
      role: "owner",
      managed_by_backend_user_id: null,
    },
    JWT_SECRET,
    {
      expiresIn: "10m",
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_BACKEND,
    }
  );
}

async function requestJson(pathname, { method = "GET", token = "", body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders["content-type"] = "application/json";

  let response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const message = String(error?.message || error || "unknown fetch error");
    throw new Error(`request failed ${method.toUpperCase()} ${BASE_URL}${pathname}: ${message}`);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
}

async function ensureReviewContentDraftFromQueue({
  queueRow,
  ownerToken,
  sourceBaseUrl,
}) {
  const detailRes = await requestJson(`/collector-import-reviews/${Number(queueRow?.id || 0) || 0}`, {
    token: ownerToken,
  });
  assert(detailRes.response.ok, `review queue detail fetch failed: ${JSON.stringify(detailRes.payload)}`);
  const detailItem = detailRes.payload?.item || null;
  assert(detailItem, "review queue detail item missing");
  const payload = buildReviewIngestPayloadFromQueueDetail(detailItem, sourceBaseUrl);
  assert(payload.source_content_item_id > 0, "review ingest payload source id missing");
  const ingestRes = await requestJson("/review-content/ingest", {
    method: "POST",
    token: ownerToken,
    body: payload,
  });
  assert(ingestRes.response.ok, `review ingest failed: ${JSON.stringify(ingestRes.payload)}`);
  const reviewContentId = Number(ingestRes.payload?.item?.id || 0) || 0;
  assert(reviewContentId > 0, "review content id missing after ingest");
  return { reviewContentId, detailItem };
}

async function seedCollectorImportReview(db, importPayload) {
  return requestJson("/lifecycle/import-published", {
    method: "POST",
    headers: { "x-lifecycle-token": LIFECYCLE_SYNC_TOKEN },
    body: importPayload,
  });
}

function buildImportPayload({
  sourceContentItemId,
  title,
  body,
  publishedAt,
  type = "place",
  category = "restaurants",
  mediaManifest,
  sourceBaseUrl = "",
}) {
  const normalizedType = String(type || "place").trim().toLowerCase() === "event" ? "event" : "place";
  const normalizedManifest = mediaManifest && typeof mediaManifest === "object" ? mediaManifest : null;
  assert(normalizedManifest, "buildImportPayload requires mediaManifest for smoke verification");
  const releaseId = crypto.randomUUID();
  const manifestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizedManifest))
    .digest("hex");
  return {
    source_system: "collector-app",
    source_base_url: String(sourceBaseUrl || "").trim() || undefined,
    content_item_id: null,
    published: [
      {
        source_content_item_id: sourceContentItemId,
        type: normalizedType,
        source_lang: "th",
        category: normalizedType === "place" ? category : "",
        slug: normalizedType === "place" ? `final-review-smoke-${sourceContentItemId}` : `event-${sourceContentItemId}`,
        title,
        excerpt: body.slice(0, 60),
        body,
        meta_title: title,
        meta_description: body.slice(0, 120),
        image: String(normalizedManifest?.cover?.source_url || "").trim(),
        media_manifest: normalizedManifest,
        release_id: releaseId,
        manifest_hash: manifestHash,
        published_at: publishedAt,
      },
    ],
    translations: [
      {
        source_content_item_id: sourceContentItemId,
        lang: "en",
        title: `${title} EN`,
        excerpt: "English excerpt",
        body: `${body} EN`,
        meta_title: `${title} EN`,
        meta_description: "English meta description",
      },
    ],
  };
}

function expectedSourceImageFromImportArticle(payloadArticle) {
  return String(payloadArticle?.media_manifest?.cover?.source_url || "").trim();
}

async function expectBackendOwnedImage(detailItem, payloadArticle, messagePrefix) {
  const actualImage = String(detailItem?.image || "").trim();
  const expectedSourceImage = expectedSourceImageFromImportArticle(payloadArticle);
  assert(actualImage, `${messagePrefix}: image missing`);
  assert(actualImage !== expectedSourceImage, `${messagePrefix}: expected backend-owned image, got source URL`);
  const isAbsoluteImageUrl = /^https?:\/\//i.test(actualImage);
  if (isAbsoluteImageUrl) {
    const absoluteOrigin = new URL(actualImage).origin;
    assert(
      absoluteOrigin === BASE_URL_ORIGIN,
      `${messagePrefix}: absolute image origin mismatch | expected=${BASE_URL_ORIGIN} actual=${absoluteOrigin}`
    );
  }

  let parsedImageUrl;
  try {
    parsedImageUrl = new URL(actualImage, BASE_URL_ORIGIN);
  } catch {
    throw new Error(`${messagePrefix}: image URL cannot be parsed: ${JSON.stringify(actualImage)}`);
  }
  const normalizedPath = `${parsedImageUrl.pathname || ""}${parsedImageUrl.search || ""}`;
  assert(/\/uploads\//i.test(normalizedPath), `${messagePrefix}: expected uploads image path, got ${JSON.stringify(actualImage)}`);

  const fetchUrl = new URL(normalizedPath || "/uploads", BASE_URL_ORIGIN).toString();
  let response;
  try {
    response = await fetch(fetchUrl);
  } catch (error) {
    const message = String(error?.message || error || "unknown fetch error");
    throw new Error(`${messagePrefix}: backend image fetch threw (${message}) ${fetchUrl}`);
  }
  assert(response.ok, `${messagePrefix}: backend image fetch failed (${response.status}) ${fetchUrl}`);
  const contentType = String(response.headers.get("content-type") || "").trim().toLowerCase();
  assert(contentType.startsWith("image/"), `${messagePrefix}: backend image content-type mismatch (${contentType || "unknown"})`);
}

async function expectDetailMatchesImport(detailItem, payloadArticle, messagePrefix) {
  assert(detailItem && typeof detailItem === "object", `${messagePrefix}: detail item missing`);
  assert(
    String(detailItem.title || "") === String(payloadArticle.title || ""),
    `${messagePrefix}: title mismatch | expected=${JSON.stringify(String(payloadArticle.title || ""))} actual=${JSON.stringify(String(detailItem.title || ""))}`
  );
  assert(
    String(detailItem.description || "") === String(payloadArticle.body || ""),
    `${messagePrefix}: body mismatch | expected=${JSON.stringify(String(payloadArticle.body || ""))} actual=${JSON.stringify(String(detailItem.description || ""))}`
  );
  assert(
    String(detailItem.meta_title || "") === String(payloadArticle.meta_title || ""),
    `${messagePrefix}: meta_title mismatch | expected=${JSON.stringify(String(payloadArticle.meta_title || ""))} actual=${JSON.stringify(String(detailItem.meta_title || ""))}`
  );
  assert(
    String(detailItem.meta_description || "") === String(payloadArticle.meta_description || ""),
    `${messagePrefix}: meta_description mismatch | expected=${JSON.stringify(String(payloadArticle.meta_description || ""))} actual=${JSON.stringify(String(detailItem.meta_description || ""))}`
  );
  await expectBackendOwnedImage(detailItem, payloadArticle, messagePrefix);
  if (String(payloadArticle.type || "").trim().toLowerCase() === "place") {
    assert(
      String(detailItem.slug || "") === String(payloadArticle.slug || ""),
      `${messagePrefix}: slug mismatch | expected=${JSON.stringify(String(payloadArticle.slug || ""))} actual=${JSON.stringify(String(detailItem.slug || ""))}`
    );
    assert(
      String(detailItem.category || "") === String(payloadArticle.category || ""),
      `${messagePrefix}: category mismatch | expected=${JSON.stringify(String(payloadArticle.category || ""))} actual=${JSON.stringify(String(detailItem.category || ""))}`
    );
  }
}

async function startMediaFixtureServer() {
  const server = http.createServer((req, res) => {
    const pathname = String(req?.url || "").split("?")[0] || "/";
    if (pathname === "/smoke-cover-v1.png" || pathname === "/smoke-cover-v2.png") {
      res.statusCode = 200;
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "no-store");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(SMOKE_COVER_IMAGE_BYTES);
      return;
    }
    res.statusCode = 404;
    res.end("not-found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("cannot resolve smoke media fixture server address");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function startCollectorReviewFeedbackServer({ baseUrl = "", expectedToken = SMOKE_REVIEW_SYNC_TOKEN } = {}) {
  const configuredBaseUrl = String(baseUrl || "").trim();
  const parsedBaseUrl = configuredBaseUrl ? new URL(configuredBaseUrl) : null;
  const listenHost = parsedBaseUrl?.hostname || "127.0.0.1";
  const listenPort = parsedBaseUrl?.port ? Number(parsedBaseUrl.port) : 0;
  const basePathname = parsedBaseUrl?.pathname ? parsedBaseUrl.pathname.replace(/\/+$/, "") : "";
  const expectedPathname = `${basePathname || ""}/api/web-review-feedback`;
  const server = http.createServer(async (req, res) => {
    const pathname = String(req?.url || "").split("?")[0] || "/";
    if (pathname !== expectedPathname || req.method !== "POST") {
      res.statusCode = 404;
      res.end("not-found");
      return;
    }
    const token = String(req.headers["x-review-sync-token"] || "").trim();
    if (token !== String(expectedToken || "").trim()) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "invalid token" }));
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("cannot resolve collector feedback mock server address");
  }
  return {
    server,
    baseUrl: configuredBaseUrl || `http://127.0.0.1:${address.port}`,
  };
}

async function stopMediaFixtureServer(handle) {
  if (!handle?.server) return;
  await new Promise((resolve) => {
    handle.server.close(() => resolve());
  });
}

async function stopCollectorReviewFeedbackServer(handle) {
  if (!handle?.server) return;
  await new Promise((resolve) => {
    handle.server.close(() => resolve());
  });
}

function startBackendServer({ collectorSyncBaseUrl = "" } = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(SMOKE_PORT),
      BACKEND_PUBLIC_URL: SPAWN_BACKEND_PUBLIC_URL,
      COLLECTOR_SYNC_BASE_URL: String(collectorSyncBaseUrl || "").trim(),
      COLLECTOR_REVIEW_SYNC_TOKEN: SMOKE_REVIEW_SYNC_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutTail = "";
  let stderrTail = "";
  child.stdout.on("data", (chunk) => {
    stdoutTail = `${stdoutTail}${String(chunk || "")}`.slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${String(chunk || "")}`.slice(-4000);
  });

  return {
    child,
    getOutput() {
      return { stdoutTail, stderrTail };
    },
  };
}

async function waitForHealth(serverHandle, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (serverHandle.child.exitCode != null) {
      const output = serverHandle.getOutput();
      throw new Error(
        `backend server exited early with code ${serverHandle.child.exitCode}. stdout tail: ${output.stdoutTail} stderr tail: ${output.stderrTail}`
      );
    }
    try {
      const response = await fetch(`${BASE_URL}/health`);
      const payload = await response.json();
      if (response.ok && payload?.ok === true) {
        return;
      }
    } catch {}
    await delay(400);
  }
  const output = serverHandle.getOutput();
  throw new Error(`backend health did not become ready. stdout tail: ${output.stdoutTail} stderr tail: ${output.stderrTail}`);
}

async function stopBackendServer(serverHandle) {
  if (!serverHandle?.child || serverHandle.child.exitCode != null) return;
  serverHandle.child.kill("SIGTERM");
  const startedAt = Date.now();
  while (serverHandle.child.exitCode == null && Date.now() - startedAt < 8000) {
    await delay(200);
  }
  if (serverHandle.child.exitCode == null) {
    serverHandle.child.kill("SIGKILL");
  }
}

export async function runCollectorAdminFinalReviewSmoke() {
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  assert(DB_USER && DB_NAME, "DB_USER and DB_NAME must be set for final review smoke");
  assert(JWT_SECRET, "JWT_SECRET must be set for final review smoke");
  assert(LIFECYCLE_SYNC_TOKEN, "LIFECYCLE_SYNC_TOKEN must be set for final review smoke");
  const ownerToken = createSyntheticOwnerToken();
  const usingExternalBackend = Boolean(EXTERNAL_BASE_URL) && !hasArg("--spawn");
  if (usingExternalBackend) {
    assert(
      EXTERNAL_COLLECTOR_SYNC_BASE_URL && EXTERNAL_COLLECTOR_SYNC_TOKEN,
      "external smoke mode requires --collector-sync-base-url and --collector-sync-token (or BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_SYNC_* envs)"
    );
  }
  let db = null;
  let serverHandle = null;
  let mediaFixtureHandle = null;
  let collectorFeedbackHandle = null;
  let mediaManifestV1 = null;
  let mediaManifestV2 = null;
  const runId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const sourceIdBase = (Date.now() % 1_000_000_000) * 10 + Math.floor(Math.random() * 8);
  const approveSourceId = Number(sourceIdBase + 1);
  const rejectSourceId = Number(sourceIdBase + 2);
  const eventSourceId = Number(sourceIdBase + 3);
  const eventRejectSourceId = Number(sourceIdBase + 4);
  const touchedReviewIds = new Set();
  const touchedReviewContentIds = new Set();
  const touchedPlaceIds = new Set();
  const touchedEventIds = new Set();
  const importPayloads = {};

  try {
    db = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      port: DB_PORT,
    });

    if (usingExternalBackend) {
      collectorFeedbackHandle = await startCollectorReviewFeedbackServer({
        baseUrl: EXTERNAL_COLLECTOR_SYNC_BASE_URL,
        expectedToken: EXTERNAL_COLLECTOR_SYNC_TOKEN,
      });
      serverHandle = null;
    } else {
      collectorFeedbackHandle = await startCollectorReviewFeedbackServer();
      serverHandle = startBackendServer({ collectorSyncBaseUrl: collectorFeedbackHandle.baseUrl });
    }
    mediaFixtureHandle = await startMediaFixtureServer();
    mediaManifestV1 = createManifestWithCover(`${mediaFixtureHandle.baseUrl}/smoke-cover-v1.png`);
    mediaManifestV2 = createManifestWithCover(`${mediaFixtureHandle.baseUrl}/smoke-cover-v2.png`);

    importPayloads.approveV1 = buildImportPayload({
      sourceContentItemId: approveSourceId,
      title: `Approve Smoke ${runId}`,
      body: "Approve smoke body version one",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV1,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    importPayloads.rejectV1 = buildImportPayload({
      sourceContentItemId: rejectSourceId,
      title: `Reject Smoke ${runId}`,
      body: "Reject smoke body version one",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV1,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    importPayloads.eventV1 = buildImportPayload({
      sourceContentItemId: eventSourceId,
      type: "event",
      title: `Event Smoke ${runId}`,
      body: "Event smoke body version one",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV1,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    importPayloads.eventRejectV1 = buildImportPayload({
      sourceContentItemId: eventRejectSourceId,
      type: "event",
      title: `Event Reject Smoke ${runId}`,
      body: "Event reject smoke body version one",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV1,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    importPayloads.approveV2 = buildImportPayload({
      sourceContentItemId: approveSourceId,
      title: `Approve Smoke ${runId} Updated`,
      body: "Approve smoke body version two updated",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV2,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    importPayloads.rejectV2 = buildImportPayload({
      sourceContentItemId: rejectSourceId,
      title: `Reject Smoke ${runId} Updated`,
      body: "Reject smoke body version two updated",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV2,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    importPayloads.eventV2 = buildImportPayload({
      sourceContentItemId: eventSourceId,
      type: "event",
      title: `Event Smoke ${runId} Updated`,
      body: "Event smoke body version two updated",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV2,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    importPayloads.eventRejectV2 = buildImportPayload({
      sourceContentItemId: eventRejectSourceId,
      type: "event",
      title: `Event Reject Smoke ${runId} Updated`,
      body: "Event reject smoke body version two updated",
      publishedAt: new Date().toISOString(),
      mediaManifest: mediaManifestV2,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });

    if (serverHandle) {
      await waitForHealth(serverHandle);
    }

    const health = await requestJson("/health");
    assert(health.response.ok && health.payload?.ok === true, `backend health failed: ${JSON.stringify(health.payload)}`);

    const approveImport = await seedCollectorImportReview(db, importPayloads.approveV1);
    assert(approveImport.response.ok, `approve import failed: ${JSON.stringify(approveImport.payload)}`);

    const pendingAfterApproveImport = await requestJson("/collector-import-reviews", {
      token: ownerToken,
      headers: {},
    });
    assert(pendingAfterApproveImport.response.ok, `pending queue fetch failed: ${JSON.stringify(pendingAfterApproveImport.payload)}`);
    const approveRow = (pendingAfterApproveImport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === approveSourceId
    );
    assert(approveRow, `approve review row missing from pending queue: ${JSON.stringify(pendingAfterApproveImport.payload)}`);
    touchedReviewIds.add(Number(approveRow.id || 0));
    touchedPlaceIds.add(Number(approveRow.local_entity_id || 0));

    const approveDetailBeforeDecision = await requestJson(`/collector-import-reviews/${approveRow.id}`, {
      token: ownerToken,
    });
    assert(approveDetailBeforeDecision.response.ok, `approve detail fetch failed: ${JSON.stringify(approveDetailBeforeDecision.payload)}`);
    await expectDetailMatchesImport(
      approveDetailBeforeDecision.payload?.item,
      importPayloads.approveV1.published[0],
      "approve detail before decision"
    );

    const approveDraft = await ensureReviewContentDraftFromQueue({
      queueRow: approveRow,
      ownerToken,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    touchedReviewContentIds.add(approveDraft.reviewContentId);
    const approveDecision = await requestJson(`/review-content/${approveDraft.reviewContentId}/approve`, {
      method: "POST",
      token: ownerToken,
      body: { review_note: "Approved in smoke test" },
    });
    assert(approveDecision.response.ok, `approve decision failed: ${JSON.stringify(approveDecision.payload)}`);

    const approvedQueue = await requestJson("/collector-import-reviews?status=approved", {
      token: ownerToken,
    });
    assert(approvedQueue.response.ok, `approved queue fetch failed: ${JSON.stringify(approvedQueue.payload)}`);
    const approvedRow = (approvedQueue.payload?.items || []).find(
      (item) => Number(item?.id || 0) === Number(approveRow.id || 0)
    );
    assert(approvedRow && approvedRow.review_status === "approved", `approved row missing after decision: ${JSON.stringify(approvedQueue.payload)}`);

    const eventImport = await seedCollectorImportReview(db, importPayloads.eventV1);
    assert(eventImport.response.ok, `event import failed: ${JSON.stringify(eventImport.payload)}`);

    const pendingAfterEventImport = await requestJson("/collector-import-reviews?status=pending", {
      token: ownerToken,
    });
    assert(pendingAfterEventImport.response.ok, `pending queue after event import failed: ${JSON.stringify(pendingAfterEventImport.payload)}`);
    const eventRow = (pendingAfterEventImport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === eventSourceId
    );
    assert(eventRow, `event review row missing from pending queue: ${JSON.stringify(pendingAfterEventImport.payload)}`);
    touchedReviewIds.add(Number(eventRow.id || 0));
    touchedEventIds.add(Number(eventRow.local_entity_id || 0));

    const eventDetailBeforeDecision = await requestJson(`/collector-import-reviews/${eventRow.id}`, {
      token: ownerToken,
    });
    assert(eventDetailBeforeDecision.response.ok, `event detail fetch failed: ${JSON.stringify(eventDetailBeforeDecision.payload)}`);
    await expectDetailMatchesImport(
      eventDetailBeforeDecision.payload?.item,
      importPayloads.eventV1.published[0],
      "event detail before decision"
    );

    const eventApproveDraft = await ensureReviewContentDraftFromQueue({
      queueRow: eventRow,
      ownerToken,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    touchedReviewContentIds.add(eventApproveDraft.reviewContentId);
    const eventApproveDecision = await requestJson(`/review-content/${eventApproveDraft.reviewContentId}/approve`, {
      method: "POST",
      token: ownerToken,
      body: { review_note: "Approved event in smoke test" },
    });
    assert(eventApproveDecision.response.ok, `event approve decision failed: ${JSON.stringify(eventApproveDecision.payload)}`);

    const approvedQueueAfterEvent = await requestJson("/collector-import-reviews?status=approved", {
      token: ownerToken,
    });
    assert(approvedQueueAfterEvent.response.ok, `approved queue after event approve failed: ${JSON.stringify(approvedQueueAfterEvent.payload)}`);
    const approvedEventRow = (approvedQueueAfterEvent.payload?.items || []).find(
      (item) => Number(item?.id || 0) === Number(eventRow.id || 0)
    );
    assert(approvedEventRow && approvedEventRow.review_status === "approved", `approved event row missing after decision: ${JSON.stringify(approvedQueueAfterEvent.payload)}`);

    const eventRejectImport = await seedCollectorImportReview(db, importPayloads.eventRejectV1);
    assert(eventRejectImport.response.ok, `event reject import failed: ${JSON.stringify(eventRejectImport.payload)}`);

    const pendingAfterEventRejectImport = await requestJson("/collector-import-reviews?status=pending", {
      token: ownerToken,
    });
    assert(
      pendingAfterEventRejectImport.response.ok,
      `pending queue after event reject import failed: ${JSON.stringify(pendingAfterEventRejectImport.payload)}`
    );
    const eventRejectRow = (pendingAfterEventRejectImport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === eventRejectSourceId
    );
    assert(eventRejectRow, `event reject review row missing from pending queue: ${JSON.stringify(pendingAfterEventRejectImport.payload)}`);
    touchedReviewIds.add(Number(eventRejectRow.id || 0));
    touchedEventIds.add(Number(eventRejectRow.local_entity_id || 0));

    const eventRejectDetailBeforeDecision = await requestJson(`/collector-import-reviews/${eventRejectRow.id}`, {
      token: ownerToken,
    });
    assert(
      eventRejectDetailBeforeDecision.response.ok,
      `event reject detail fetch failed: ${JSON.stringify(eventRejectDetailBeforeDecision.payload)}`
    );
    await expectDetailMatchesImport(
      eventRejectDetailBeforeDecision.payload?.item,
      importPayloads.eventRejectV1.published[0],
      "event reject detail before decision"
    );

    const eventRejectDraft = await ensureReviewContentDraftFromQueue({
      queueRow: eventRejectRow,
      ownerToken,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    touchedReviewContentIds.add(eventRejectDraft.reviewContentId);
    const eventRejectDecision = await requestJson(`/review-content/${eventRejectDraft.reviewContentId}/reject`, {
      method: "POST",
      token: ownerToken,
      body: { review_note: "Rejected event in smoke test" },
    });
    assert(eventRejectDecision.response.ok, `event reject decision failed: ${JSON.stringify(eventRejectDecision.payload)}`);

    const rejectedQueueAfterEventReject = await requestJson("/collector-import-reviews?status=rejected", {
      token: ownerToken,
    });
    assert(
      rejectedQueueAfterEventReject.response.ok,
      `rejected queue after event reject failed: ${JSON.stringify(rejectedQueueAfterEventReject.payload)}`
    );
    const rejectedEventRow = (rejectedQueueAfterEventReject.payload?.items || []).find(
      (item) => Number(item?.id || 0) === Number(eventRejectRow.id || 0)
    );
    assert(
      rejectedEventRow && rejectedEventRow.review_status === "rejected",
      `rejected event row missing after decision: ${JSON.stringify(rejectedQueueAfterEventReject.payload)}`
    );

    const rejectImport = await seedCollectorImportReview(db, importPayloads.rejectV1);
    assert(rejectImport.response.ok, `reject import failed: ${JSON.stringify(rejectImport.payload)}`);

    const pendingAfterRejectImport = await requestJson("/collector-import-reviews?status=pending", {
      token: ownerToken,
    });
    assert(pendingAfterRejectImport.response.ok, `pending queue after reject import failed: ${JSON.stringify(pendingAfterRejectImport.payload)}`);
    const rejectRow = (pendingAfterRejectImport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === rejectSourceId
    );
    assert(rejectRow, `reject review row missing from pending queue: ${JSON.stringify(pendingAfterRejectImport.payload)}`);
    touchedReviewIds.add(Number(rejectRow.id || 0));
    touchedPlaceIds.add(Number(rejectRow.local_entity_id || 0));

    const rejectDetailBeforeDecision = await requestJson(`/collector-import-reviews/${rejectRow.id}`, {
      token: ownerToken,
    });
    assert(rejectDetailBeforeDecision.response.ok, `reject detail fetch failed: ${JSON.stringify(rejectDetailBeforeDecision.payload)}`);
    await expectDetailMatchesImport(
      rejectDetailBeforeDecision.payload?.item,
      importPayloads.rejectV1.published[0],
      "reject detail before decision"
    );

    const rejectDraft = await ensureReviewContentDraftFromQueue({
      queueRow: rejectRow,
      ownerToken,
      sourceBaseUrl: mediaFixtureHandle.baseUrl,
    });
    touchedReviewContentIds.add(rejectDraft.reviewContentId);
    const rejectDecision = await requestJson(`/review-content/${rejectDraft.reviewContentId}/reject`, {
      method: "POST",
      token: ownerToken,
      body: { review_note: "Rejected in smoke test" },
    });
    assert(rejectDecision.response.ok, `reject decision failed: ${JSON.stringify(rejectDecision.payload)}`);

    const rejectedQueue = await requestJson("/collector-import-reviews?status=rejected", {
      token: ownerToken,
    });
    assert(rejectedQueue.response.ok, `rejected queue fetch failed: ${JSON.stringify(rejectedQueue.payload)}`);
    const rejectedRow = (rejectedQueue.payload?.items || []).find(
      (item) => Number(item?.id || 0) === Number(rejectRow.id || 0)
    );
    assert(rejectedRow && rejectedRow.review_status === "rejected", `rejected row missing after decision: ${JSON.stringify(rejectedQueue.payload)}`);

    const reimportApproved = await seedCollectorImportReview(db, importPayloads.approveV2);
    assert(reimportApproved.response.ok, `re-import failed: ${JSON.stringify(reimportApproved.payload)}`);
    assert(Number(reimportApproved.payload?.review_resets || 0) >= 1, `expected review_resets >= 1: ${JSON.stringify(reimportApproved.payload)}`);

    const pendingAfterReimport = await requestJson("/collector-import-reviews?status=pending", {
      token: ownerToken,
    });
    assert(pendingAfterReimport.response.ok, `pending queue after reimport failed: ${JSON.stringify(pendingAfterReimport.payload)}`);
    const resetRow = (pendingAfterReimport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === approveSourceId
    );
    assert(resetRow && resetRow.review_status === "pending", `re-import did not reset to pending: ${JSON.stringify(pendingAfterReimport.payload)}`);

    const approvedResetDetail = await requestJson(`/collector-import-reviews/${resetRow.id}`, {
      token: ownerToken,
    });
    assert(approvedResetDetail.response.ok, `approved reset detail fetch failed: ${JSON.stringify(approvedResetDetail.payload)}`);
    await expectDetailMatchesImport(
      approvedResetDetail.payload?.item,
      importPayloads.approveV2.published[0],
      "approved item detail after reimport reset"
    );
    const history = Array.isArray(approvedResetDetail.payload?.item?.history) ? approvedResetDetail.payload.item.history : [];
    assert(
      history.some((entry) => String(entry?.action_type || "") === "approved") &&
        history.some((entry) => String(entry?.action_type || "") === "reimported"),
      `expected approved/reimported history entries on approved item: ${JSON.stringify(approvedResetDetail.payload)}`
    );

    const reimportEvent = await seedCollectorImportReview(db, importPayloads.eventV2);
    assert(reimportEvent.response.ok, `event re-import failed: ${JSON.stringify(reimportEvent.payload)}`);
    assert(Number(reimportEvent.payload?.review_resets || 0) >= 1, `expected event review_resets >= 1: ${JSON.stringify(reimportEvent.payload)}`);

    const pendingAfterEventReimport = await requestJson("/collector-import-reviews?status=pending", {
      token: ownerToken,
    });
    assert(pendingAfterEventReimport.response.ok, `pending queue after event reimport failed: ${JSON.stringify(pendingAfterEventReimport.payload)}`);
    const eventResetRow = (pendingAfterEventReimport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === eventSourceId
    );
    assert(eventResetRow && eventResetRow.review_status === "pending", `event re-import did not reset to pending: ${JSON.stringify(pendingAfterEventReimport.payload)}`);

    const eventResetDetail = await requestJson(`/collector-import-reviews/${eventResetRow.id}`, {
      token: ownerToken,
    });
    assert(eventResetDetail.response.ok, `event reset detail fetch failed: ${JSON.stringify(eventResetDetail.payload)}`);
    await expectDetailMatchesImport(
      eventResetDetail.payload?.item,
      importPayloads.eventV2.published[0],
      "event detail after reimport reset"
    );
    const eventHistory = Array.isArray(eventResetDetail.payload?.item?.history) ? eventResetDetail.payload.item.history : [];
    assert(
      eventHistory.some((entry) => String(entry?.action_type || "") === "approved") &&
        eventHistory.some((entry) => String(entry?.action_type || "") === "reimported"),
      `expected approved/reimported history entries on event item: ${JSON.stringify(eventResetDetail.payload)}`
    );

    const reimportRejectedEvent = await seedCollectorImportReview(db, importPayloads.eventRejectV2);
    assert(reimportRejectedEvent.response.ok, `event reject re-import failed: ${JSON.stringify(reimportRejectedEvent.payload)}`);
    assert(
      Number(reimportRejectedEvent.payload?.review_resets || 0) >= 1,
      `expected event reject review_resets >= 1: ${JSON.stringify(reimportRejectedEvent.payload)}`
    );

    const pendingAfterEventRejectReimport = await requestJson("/collector-import-reviews?status=pending", {
      token: ownerToken,
    });
    assert(
      pendingAfterEventRejectReimport.response.ok,
      `pending queue after event reject reimport failed: ${JSON.stringify(pendingAfterEventRejectReimport.payload)}`
    );
    const eventRejectedResetRow = (pendingAfterEventRejectReimport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === eventRejectSourceId
    );
    assert(
      eventRejectedResetRow && eventRejectedResetRow.review_status === "pending",
      `event reject re-import did not reset to pending: ${JSON.stringify(pendingAfterEventRejectReimport.payload)}`
    );

    const eventRejectedResetDetail = await requestJson(`/collector-import-reviews/${eventRejectedResetRow.id}`, {
      token: ownerToken,
    });
    assert(
      eventRejectedResetDetail.response.ok,
      `event rejected reset detail fetch failed: ${JSON.stringify(eventRejectedResetDetail.payload)}`
    );
    await expectDetailMatchesImport(
      eventRejectedResetDetail.payload?.item,
      importPayloads.eventRejectV2.published[0],
      "event rejected detail after reimport reset"
    );
    const eventRejectHistory = Array.isArray(eventRejectedResetDetail.payload?.item?.history)
      ? eventRejectedResetDetail.payload.item.history
      : [];
    assert(
      eventRejectHistory.some((entry) => String(entry?.action_type || "") === "rejected") &&
        eventRejectHistory.some((entry) => String(entry?.action_type || "") === "reimported"),
      `expected rejected/reimported history entries on rejected event item: ${JSON.stringify(eventRejectedResetDetail.payload)}`
    );

    const reimportRejected = await seedCollectorImportReview(db, importPayloads.rejectV2);
    assert(reimportRejected.response.ok, `reject re-import failed: ${JSON.stringify(reimportRejected.payload)}`);
    assert(Number(reimportRejected.payload?.review_resets || 0) >= 1, `expected reject review_resets >= 1: ${JSON.stringify(reimportRejected.payload)}`);

    const pendingAfterRejectReimport = await requestJson("/collector-import-reviews?status=pending", {
      token: ownerToken,
    });
    assert(
      pendingAfterRejectReimport.response.ok,
      `pending queue after reject reimport failed: ${JSON.stringify(pendingAfterRejectReimport.payload)}`
    );
    const rejectedResetRow = (pendingAfterRejectReimport.payload?.items || []).find(
      (item) => Number(item?.source_content_item_id || 0) === rejectSourceId
    );
    assert(
      rejectedResetRow && rejectedResetRow.review_status === "pending",
      `reject re-import did not reset to pending: ${JSON.stringify(pendingAfterRejectReimport.payload)}`
    );

    const rejectedResetDetail = await requestJson(`/collector-import-reviews/${rejectedResetRow.id}`, {
      token: ownerToken,
    });
    assert(rejectedResetDetail.response.ok, `rejected reset detail fetch failed: ${JSON.stringify(rejectedResetDetail.payload)}`);
    await expectDetailMatchesImport(
      rejectedResetDetail.payload?.item,
      importPayloads.rejectV2.published[0],
      "rejected item detail after reimport reset"
    );
    const rejectHistory = Array.isArray(rejectedResetDetail.payload?.item?.history) ? rejectedResetDetail.payload.item.history : [];
    assert(
      rejectHistory.some((entry) => String(entry?.action_type || "") === "rejected") &&
        rejectHistory.some((entry) => String(entry?.action_type || "") === "reimported"),
      `expected rejected/reimported history entries on rejected item: ${JSON.stringify(rejectedResetDetail.payload)}`
    );

    const searchByTitle = await requestJson(`/collector-import-reviews?status=pending&search=${encodeURIComponent(importPayloads.approveV2.published[0].title)}`, {
      token: ownerToken,
    });
    assert(searchByTitle.response.ok, `search by title failed: ${JSON.stringify(searchByTitle.payload)}`);
    assert(
      (searchByTitle.payload?.items || []).some((item) => Number(item?.source_content_item_id || 0) === approveSourceId),
      `search by title did not return expected review row: ${JSON.stringify(searchByTitle.payload)}`
    );

    const searchBySourceItem = await requestJson(`/collector-import-reviews?status=pending&search=${encodeURIComponent(String(rejectSourceId))}`, {
      token: ownerToken,
    });
    assert(searchBySourceItem.response.ok, `search by source item failed: ${JSON.stringify(searchBySourceItem.payload)}`);
    assert(
      (searchBySourceItem.payload?.items || []).some((item) => Number(item?.source_content_item_id || 0) === rejectSourceId),
      `search by source item did not return expected row: ${JSON.stringify(searchBySourceItem.payload)}`
    );

    const searchByReviewId = await requestJson(`/collector-import-reviews?status=pending&search=${encodeURIComponent(String(resetRow.id))}`, {
      token: ownerToken,
    });
    assert(searchByReviewId.response.ok, `search by review id failed: ${JSON.stringify(searchByReviewId.payload)}`);
    assert(
      (searchByReviewId.payload?.items || []).some((item) => Number(item?.id || 0) === Number(resetRow.id || 0)),
      `search by review id did not return expected row: ${JSON.stringify(searchByReviewId.payload)}`
    );

    const searchEventByTitle = await requestJson(`/collector-import-reviews?status=pending&search=${encodeURIComponent(importPayloads.eventV2.published[0].title)}`, {
      token: ownerToken,
    });
    assert(searchEventByTitle.response.ok, `search event by title failed: ${JSON.stringify(searchEventByTitle.payload)}`);
    assert(
      (searchEventByTitle.payload?.items || []).some((item) => Number(item?.source_content_item_id || 0) === eventSourceId),
      `search event by title did not return expected row: ${JSON.stringify(searchEventByTitle.payload)}`
    );

    const searchRejectedEventByTitle = await requestJson(
      `/collector-import-reviews?status=pending&search=${encodeURIComponent(importPayloads.eventRejectV2.published[0].title)}`,
      { token: ownerToken }
    );
    assert(
      searchRejectedEventByTitle.response.ok,
      `search rejected event by title failed: ${JSON.stringify(searchRejectedEventByTitle.payload)}`
    );
    assert(
      (searchRejectedEventByTitle.payload?.items || []).some(
        (item) => Number(item?.source_content_item_id || 0) === eventRejectSourceId
      ),
      `search rejected event by title did not return expected row: ${JSON.stringify(searchRejectedEventByTitle.payload)}`
    );

    const result = {
      ok: true,
      scope: "collector-backend-admin-final-review",
      base_url: BASE_URL,
      used_external_backend: usingExternalBackend,
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAtMs,
      assertions: [
        "collector import creates pending final review row",
        "admin review detail returns import snapshot with backend-owned fetchable image before decision",
        "approve moves review row to approved",
        "event approve and event reject work through the same review surface",
        "reject moves review row to rejected",
        "re-import resets approved place and event reviews back to pending and refreshes detail snapshot",
        "re-import resets rejected place and event reviews back to pending and refreshes detail snapshot",
        "review history records approve or reject and reimport actions on each item",
        "queue search finds rows by title source item id and review id across place and event",
      ],
    };
    await writeReportArtifact(result);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    try {
      if (db) {
        try {
          const placeSourceIds = [approveSourceId, rejectSourceId];
          const eventSourceIds = [eventSourceId, eventRejectSourceId];
          const allSourceIds = [...placeSourceIds, ...eventSourceIds];
          const placePlaceholders = placeSourceIds.map(() => "?").join(",");
          const eventPlaceholders = eventSourceIds.map(() => "?").join(",");
          const allReviewIds = [...touchedReviewIds];
          const [mappedPlaceRows] = await db.query(
            `SELECT local_entity_id
             FROM lifecycle_content_map
             WHERE source_system='collector-app' AND source_content_type='place' AND source_content_item_id IN (${placePlaceholders})`,
            placeSourceIds
          );
          for (const row of mappedPlaceRows || []) {
            const placeId = Number(row?.local_entity_id || 0);
            if (placeId > 0) touchedPlaceIds.add(placeId);
          }

          const [mappedEventRows] = await db.query(
            `SELECT local_entity_id
             FROM lifecycle_content_map
             WHERE source_system='collector-app' AND source_content_type='event' AND source_content_item_id IN (${eventPlaceholders})`,
            eventSourceIds
          );
          for (const row of mappedEventRows || []) {
            const eventId = Number(row?.local_entity_id || 0);
            if (eventId > 0) touchedEventIds.add(eventId);
          }

          if (allReviewIds.length > 0) {
            const reviewPlaceholders = allReviewIds.map(() => "?").join(",");
            await db.query(`DELETE FROM collector_import_review_actions WHERE review_id IN (${reviewPlaceholders})`, allReviewIds);
            await db.query(`DELETE FROM collector_import_reviews WHERE id IN (${reviewPlaceholders})`, allReviewIds);
          } else if (allSourceIds.length > 0) {
            const allSourcePlaceholders = allSourceIds.map(() => "?").join(",");
            await db.query(
              `DELETE FROM collector_import_reviews
               WHERE source_system='collector-app' AND source_content_item_id IN (${allSourcePlaceholders})`,
              allSourceIds
            );
          }

          const allReviewContentIds = [...touchedReviewContentIds].filter((id) => Number(id || 0) > 0);
          if (allReviewContentIds.length > 0) {
            const reviewContentPlaceholders = allReviewContentIds.map(() => "?").join(",");
            const [assetRows] = await db.query(
              `SELECT storage_path, file_name
               FROM review_content_assets
               WHERE review_content_id IN (${reviewContentPlaceholders})`,
              allReviewContentIds
            );
            for (const assetRow of Array.isArray(assetRows) ? assetRows : []) {
              const relative = String(assetRow?.storage_path || "").trim().replace(/\\/g, "/");
              const fileName = String(assetRow?.file_name || "").trim();
              const diskPath = relative.startsWith("uploads/")
                ? path.join(process.cwd(), relative)
                : fileName
                  ? path.join(process.cwd(), "uploads", fileName)
                  : "";
              if (!diskPath) continue;
              try {
                await fs.unlink(diskPath);
              } catch {}
            }

            await db.query(`DELETE FROM review_actions WHERE review_content_id IN (${reviewContentPlaceholders})`, allReviewContentIds);
            await db.query(`DELETE FROM review_content_assets WHERE review_content_id IN (${reviewContentPlaceholders})`, allReviewContentIds);
            await db.query(`DELETE FROM review_contents WHERE id IN (${reviewContentPlaceholders})`, allReviewContentIds);
          }

          await db.query(
            `DELETE FROM lifecycle_content_map
             WHERE source_system='collector-app' AND source_content_type='place' AND source_content_item_id IN (${placePlaceholders})`,
            placeSourceIds
          );
          await db.query(
            `DELETE FROM lifecycle_content_map
             WHERE source_system='collector-app' AND source_content_type='event' AND source_content_item_id IN (${eventPlaceholders})`,
            eventSourceIds
          );

          if (touchedPlaceIds.size > 0) {
            const placeIds = [...touchedPlaceIds];
            const placePlaceholders = placeIds.map(() => "?").join(",");
            await cleanupPublishedMediaArtifacts(db, "place", placeIds);
            await db.query(`DELETE FROM place_translations WHERE place_id IN (${placePlaceholders})`, placeIds);
            await db.query(`DELETE FROM places WHERE id IN (${placePlaceholders})`, placeIds);
          }

          if (touchedEventIds.size > 0) {
            const eventIds = [...touchedEventIds];
            const eventIdPlaceholders = eventIds.map(() => "?").join(",");
            await cleanupPublishedMediaArtifacts(db, "event", eventIds);
            await db.query(`DELETE FROM event_translations WHERE event_id IN (${eventIdPlaceholders})`, eventIds);
            await db.query(`DELETE FROM events WHERE id IN (${eventIdPlaceholders})`, eventIds);
          }
        } finally {
          await db.end();
        }
      }
    } finally {
      await stopCollectorReviewFeedbackServer(collectorFeedbackHandle);
      await stopMediaFixtureServer(mediaFixtureHandle);
      if (serverHandle) {
        await stopBackendServer(serverHandle);
      }
    }
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  runCollectorAdminFinalReviewSmoke().catch(async (err) => {
    const finishedAtMs = Date.now();
    const failure = {
      ok: false,
      scope: "collector-backend-admin-final-review",
      base_url: BASE_URL,
      used_external_backend: Boolean(EXTERNAL_BASE_URL) && !hasArg("--spawn"),
      started_at: DIRECT_RUN_STARTED_AT_ISO,
      finished_at: new Date(finishedAtMs).toISOString(),
      duration_ms: finishedAtMs - DIRECT_RUN_STARTED_AT_MS,
      error: String(err?.message || err),
    };
    try {
      await writeReportArtifact(failure);
    } catch {}
    console.error(`smoke-collector-admin-final-review: FAILED - ${failure.error}`);
    process.exitCode = 1;
  });
}
