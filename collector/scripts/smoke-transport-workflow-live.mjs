import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import dotenv from "dotenv";
import { openDatabase } from "../db/client.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = path.resolve(CWD, "..");
const BACKEND_ENV_PATH = path.join(WORKSPACE_ROOT, "backend", ".env");
const SCHEMA_PATH = path.join(CWD, "database", "schema.sql");
const TRANSPORT_V2_BASE = "/api/v2/transport";
const COLLECTOR_PORT = Number(process.env.COLLECTOR_TRANSPORT_SMOKE_PORT || 5097);
const BACKEND_BASE_URL = String(process.env.COLLECTOR_SYNC_BACKEND_API || "http://127.0.0.1:5000/api").trim().replace(/\/+$/, "");
const TEMP_ROOT = path.join(CWD, "tmp-runtime-transport-workflow-live");

dotenv.config({ path: BACKEND_ENV_PATH, override: false });

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ISSUER = String(process.env.JWT_ISSUER || "uboncity-backend").trim();
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || "");
const LIFECYCLE_SYNC_TOKEN = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
const DEFAULT_TRANSPORT_THUMBNAIL = "/transport-vehicles/bus.svg";
const SMOKE_BASE_MAP_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-labelledby="title desc">
  <title id="title">Smoke Transport Base Map</title>
  <desc id="desc">Synthetic base map for transport v2 smoke</desc>
  <rect x="0" y="0" width="1000" height="1000" fill="#f8fafc" />
  <path d="M120 880 L880 120" stroke="#cbd5e1" stroke-width="18" stroke-linecap="round" />
  <path d="M160 180 L820 820" stroke="#e2e8f0" stroke-width="10" stroke-linecap="round" />
</svg>`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildCollectorEnv() {
  return {
    ...process.env,
    PORT: String(COLLECTOR_PORT),
    DB_PATH: path.join(TEMP_ROOT, "collector.db"),
    RAW_DIR: path.join(TEMP_ROOT, "raw"),
    MEDIA_DIR: path.join(TEMP_ROOT, "media"),
    STAGING_DIR: path.join(TEMP_ROOT, "staging"),
    EXPORT_DIR: path.join(TEMP_ROOT, "staging"),
    COLLECTOR_SYNC_BACKEND_API: BACKEND_BASE_URL,
    BACKEND_JWT_SECRET: JWT_SECRET,
    BACKEND_JWT_ISSUER: JWT_ISSUER,
    COLLECTOR_BACKEND_JWT_AUDIENCE: "uboncity-collector",
  };
}

function runNode(args, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: CWD,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk || "")}`.slice(-12000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk || "")}`.slice(-12000);
    });
    child.on("error", (err) => reject(new Error(`${label} failed to start: ${String(err?.message || err)}`)));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${label} exited with code ${code}. stdout: ${stdout} stderr: ${stderr}`));
    });
  });
}

function startCollector(env) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: CWD,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdoutTail = "";
  let stderrTail = "";
  child.stdout.on("data", (chunk) => {
    stdoutTail = `${stdoutTail}${String(chunk || "")}`.slice(-12000);
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${String(chunk || "")}`.slice(-12000);
  });
  return {
    child,
    getOutput() {
      return { stdoutTail, stderrTail };
    },
  };
}

async function stopCollector(handle) {
  if (!handle?.child) return;
  if (handle.child.exitCode == null) {
    handle.child.kill("SIGTERM");
  }
  const startedAt = Date.now();
  while (handle.child.exitCode == null && Date.now() - startedAt < 5000) {
    await delay(100);
  }
  if (handle.child.exitCode == null) {
    handle.child.kill("SIGKILL");
  }
}

async function waitForHealth(baseUrl, handle = null, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (handle?.child?.exitCode != null) {
      const output = handle.getOutput();
      throw new Error(`service exited early with code ${handle.child.exitCode}. stdout: ${output.stdoutTail} stderr: ${output.stderrTail}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const payload = await response.json();
      if (response.ok && payload?.ok === true) return payload;
    } catch {}
    await delay(500);
  }
  const output = handle?.getOutput?.() || {};
  throw new Error(`health timeout for ${baseUrl}. stdout: ${output.stdoutTail || ""} stderr: ${output.stderrTail || ""}`);
}

async function requestJson(url, { method = "GET", token = "", headers = {}, body } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined && !requestHeaders["content-type"]) requestHeaders["content-type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
}

async function rmTempRoot() {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true });
}

async function writeAndRegisterLocalAsset(env, { relativePath, fileName, mimeType, content }) {
  const normalizedRelativePath = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const fullPath = path.join(env.MEDIA_DIR, normalizedRelativePath);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ""), "utf8");
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);

  const db = openDatabase(env.DB_PATH, SCHEMA_PATH);
  try {
    const assetUid = crypto.randomUUID();
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const result = db
      .prepare(`
        INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
        VALUES (?, 'local', ?, ?, ?, ?, ?)
      `)
      .run(
        assetUid,
        normalizedRelativePath,
        String(fileName || path.basename(normalizedRelativePath) || "asset.bin"),
        String(mimeType || "application/octet-stream"),
        Number(buffer.byteLength || 0),
        checksum
      );
    const assetId = Number(result.lastInsertRowid || 0) || 0;
    assert(assetId > 0, `asset register failed for ${normalizedRelativePath}`);
    return { assetId, storagePath: normalizedRelativePath, fullPath };
  } finally {
    db.close();
  }
}

async function main() {
  assert(BACKEND_BASE_URL, "COLLECTOR_SYNC_BACKEND_API (or default backend URL) is required");
  assert(OWNER_EMAIL, "OWNER_EMAIL is required");
  assert(OWNER_PASSWORD, "OWNER_PASSWORD is required");
  assert(JWT_SECRET, "JWT_SECRET is required");
  assert(LIFECYCLE_SYNC_TOKEN, "LIFECYCLE_SYNC_TOKEN is required");

  await waitForHealth("http://127.0.0.1:5000");

  const env = buildCollectorEnv();
  await rmTempRoot();
  await runNode(["scripts/init-db.mjs"], env, "db:init");

  const collectorHandle = startCollector(env);
  const collectorBaseUrl = `http://127.0.0.1:${COLLECTOR_PORT}`;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let backendOwnerToken = "";
  let collectorOwnerToken = "";
  let backendRouteId = 0;
  let backendPlaceId = 0;

  try {
    await waitForHealth(collectorBaseUrl, collectorHandle);

    const backendOwnerLogin = await requestJson(`${BACKEND_BASE_URL}/login`, {
      method: "POST",
      body: {
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
      },
    });
    assert(backendOwnerLogin.response.ok, `backend owner login failed: ${JSON.stringify(backendOwnerLogin.payload)}`);
    backendOwnerToken = String(backendOwnerLogin.payload?.token || "").trim();
    assert(backendOwnerToken, "backend owner token missing");

    const collectorOwnerLogin = await requestJson(`${collectorBaseUrl}/api/auth/login`, {
      method: "POST",
      body: {
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
      },
    });
    assert(collectorOwnerLogin.response.ok, `collector owner login failed: ${JSON.stringify(collectorOwnerLogin.payload)}`);
    collectorOwnerToken = String(collectorOwnerLogin.payload?.token || "").trim();
    assert(collectorOwnerToken, "collector owner token missing");

    const routeNumber = `SMOKE-${Date.now()}`;
    const baseMapAsset = await writeAndRegisterLocalAsset(env, {
      relativePath: path.join("generated", "transport-v2", "base-maps", `smoke-base-map-${runId}.svg`),
      fileName: `smoke-base-map-${runId}.svg`,
      mimeType: "image/svg+xml",
      content: SMOKE_BASE_MAP_SVG,
    });

    const baseMapCreate = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/base-maps`, {
      method: "POST",
      token: collectorOwnerToken,
      body: {
        key: `smoke-base-map-${runId}`,
        title: "Smoke Transport Base Map",
        bounds: { min_lat: 15.22, min_lng: 104.85, max_lat: 15.24, max_lng: 104.87 },
        viewbox: { x: 0, y: 0, width: 1000, height: 1000 },
        base_svg_asset_id: baseMapAsset.assetId,
      },
    });
    assert(baseMapCreate.response.ok, `transport v2 base map create failed: ${JSON.stringify(baseMapCreate.payload)}`);
    const baseMapId = Number(baseMapCreate.payload?.id || 0) || 0;
    assert(baseMapId > 0, `transport v2 base map id missing: ${JSON.stringify(baseMapCreate.payload)}`);
    assert(Number(baseMapCreate.payload?.annotation_map_asset_id || 0) > 0, `transport v2 base map annotation asset missing: ${JSON.stringify(baseMapCreate.payload)}`);

    const routeCreate = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/routes`, {
      method: "POST",
      token: collectorOwnerToken,
      body: {
        base_map_id: baseMapId,
        route_name: "Smoke Transport Route",
        route_number: routeNumber,
        vehicle_type: "bus",
        color: "#1f6feb",
        description: "Smoke test route",
        workflow_status: "ready_for_sync",
      },
    });
    assert(routeCreate.response.ok, `transport v2 route create failed: ${JSON.stringify(routeCreate.payload)}`);
    const collectorRouteId = Number(routeCreate.payload?.id || 0) || 0;
    assert(collectorRouteId > 0, `transport v2 route id missing: ${JSON.stringify(routeCreate.payload)}`);

    const routeControlPoints = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/routes/${collectorRouteId}/control-points`, {
      method: "PUT",
      token: collectorOwnerToken,
      body: {
        control_points: [
          { lat: 15.2286, lng: 104.8572, label: "Smoke Point A" },
          { lat: 15.2321, lng: 104.8619, label: "Smoke Point B" },
        ],
      },
    });
    assert(routeControlPoints.response.ok, `transport v2 control points failed: ${JSON.stringify(routeControlPoints.payload)}`);

    const routeStops = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/routes/${collectorRouteId}/stops`, {
      method: "PUT",
      token: collectorOwnerToken,
      body: {
        stops: [
          { name: "Smoke Stop A", lat: 15.2286, lng: 104.8572, stop_type: "stop" },
          { name: "Smoke Stop B", lat: 15.2321, lng: 104.8619, stop_type: "stop" },
        ],
      },
    });
    assert(routeStops.response.ok, `transport v2 stops failed: ${JSON.stringify(routeStops.payload)}`);

    const routeResolve = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/routes/${collectorRouteId}/resolve`, {
      method: "POST",
      token: collectorOwnerToken,
    });
    if (!routeResolve.response.ok && Number(routeResolve.response.status || 0) === 503) {
      throw new Error(`transport v2 resolve env blocker: ${JSON.stringify(routeResolve.payload)}`);
    }
    assert(routeResolve.response.ok, `transport v2 resolve failed: ${JSON.stringify(routeResolve.payload)}`);

    const routePoster = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/routes/${collectorRouteId}/render-poster`, {
      method: "POST",
      token: collectorOwnerToken,
    });
    assert(routePoster.response.ok, `transport v2 render poster failed: ${JSON.stringify(routePoster.payload)}`);

    const routeReadiness = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/routes/${collectorRouteId}/review-readiness`, {
      token: collectorOwnerToken,
    });
    assert(routeReadiness.response.ok, `transport v2 review readiness failed: ${JSON.stringify(routeReadiness.payload)}`);
    assert(routeReadiness.payload?.ok === true, `transport v2 route should be ready for review: ${JSON.stringify(routeReadiness.payload)}`);

    const routeRelease = await requestJson(`${collectorBaseUrl}${TRANSPORT_V2_BASE}/routes/${collectorRouteId}/release-main`, {
      method: "POST",
      token: collectorOwnerToken,
      body: {
        note: "transport smoke sync",
      },
    });
    assert(routeRelease.response.ok, `transport v2 release failed: ${JSON.stringify(routeRelease.payload)}`);
    backendRouteId = Number(routeRelease.payload?.backend_sync?.result?.items?.[0]?.route_id || routeRelease.payload?.backend_sync?.result?.routes?.[0]?.id || 0) || 0;
    assert(backendRouteId > 0, `backend route id missing after transport v2 sync: ${JSON.stringify(routeRelease.payload)}`);

    const backendRoute = await requestJson(`${BACKEND_BASE_URL}/transport-routes/${backendRouteId}`);
    assert(backendRoute.response.ok, `backend route fetch failed: ${JSON.stringify(backendRoute.payload)}`);
    assert(
      String(backendRoute.payload?.route_number || backendRoute.payload?.route?.route_number || "").trim() === routeNumber,
      `backend route number mismatch: ${JSON.stringify(backendRoute.payload)}`
    );

    const otherTransportSourceId = 910000 + Math.floor(Math.random() * 100000);
    const otherTransportSlug = `smoke-other-transport-${runId}`;
    const otherTransportImport = await requestJson(`${BACKEND_BASE_URL}/lifecycle/import-published`, {
      method: "POST",
      headers: {
        "x-lifecycle-token": LIFECYCLE_SYNC_TOKEN,
      },
      body: {
        source_system: "collector-app",
        source_base_url: collectorBaseUrl,
        content_item_id: otherTransportSourceId,
        published: [
          {
            source_content_item_id: otherTransportSourceId,
            type: "place",
            category: "transport",
            source_lang: "th",
            slug: otherTransportSlug,
            title: "Smoke Other Transport",
            excerpt: "smoke other transport excerpt",
            body: "smoke other transport body",
            meta_title: "Smoke Other Transport",
            meta_description: "smoke other transport description",
            image: DEFAULT_TRANSPORT_THUMBNAIL,
            transport_subtype: "taxi",
            transport_contact_name: "Smoke Contact",
            transport_contact_phone: "0812345678",
            transport_contact_details: "Open 24 hours",
            transport_link_url: "https://example.com/smoke-transport",
            published_at: new Date().toISOString(),
          },
        ],
        translations: [],
      },
    });
    assert(otherTransportImport.response.ok, `other transport import failed: ${JSON.stringify(otherTransportImport.payload)}`);
    assert(Number(otherTransportImport.payload?.synced || 0) === 1, `other transport import sync count mismatch: ${JSON.stringify(otherTransportImport.payload)}`);

    const reviewQueue = await requestJson(
      `${BACKEND_BASE_URL}/collector-import-reviews?status=pending&source_system=collector-app&source_content_type=place&search=${encodeURIComponent("Smoke Other Transport")}&limit=20&offset=0`,
      {
        token: backendOwnerToken,
      }
    );
    assert(reviewQueue.response.ok, `collector import review queue failed: ${JSON.stringify(reviewQueue.payload)}`);
    const reviewItem = (Array.isArray(reviewQueue.payload?.items) ? reviewQueue.payload.items : []).find(
      (item) => Number(item?.source_content_item_id || 0) === otherTransportSourceId
    );
    assert(reviewItem, `other transport review item not found: ${JSON.stringify(reviewQueue.payload)}`);
    const reviewId = Number(reviewItem.id || 0) || 0;
    backendPlaceId = Number(reviewItem.local_entity_id || 0) || 0;
    assert(reviewId > 0 && backendPlaceId > 0, `invalid review/place ids: ${JSON.stringify(reviewItem)}`);

    const beforePublic = await requestJson(`${BACKEND_BASE_URL}/places?category=transport&lang=th`);
    assert(beforePublic.response.ok, `transport public list before approve failed: ${JSON.stringify(beforePublic.payload)}`);
    const visibleBeforeApprove = (Array.isArray(beforePublic.payload?.items) ? beforePublic.payload.items : []).some(
      (item) => String(item?.slug || "").trim() === otherTransportSlug
    );
    assert(visibleBeforeApprove === false, `other transport should not be public before approve: ${JSON.stringify(beforePublic.payload)}`);

    const approvePlace = await requestJson(`${BACKEND_BASE_URL}/places/${backendPlaceId}/approve`, {
      method: "PATCH",
      token: backendOwnerToken,
      body: {
        review_id: reviewId,
        review_note: "transport smoke approve",
      },
    });
    assert(approvePlace.response.ok, `approve place failed: ${JSON.stringify(approvePlace.payload)}`);

    const afterPublic = await requestJson(`${BACKEND_BASE_URL}/places?category=transport&lang=th`);
    assert(afterPublic.response.ok, `transport public list after approve failed: ${JSON.stringify(afterPublic.payload)}`);
    const visibleAfterApprove = (Array.isArray(afterPublic.payload?.items) ? afterPublic.payload.items : []).some(
      (item) => String(item?.slug || "").trim() === otherTransportSlug
    );
    assert(visibleAfterApprove === true, `other transport should be public after approve: ${JSON.stringify(afterPublic.payload)}`);

    console.log(JSON.stringify({
      ok: true,
      scope: "transport-workflow-live",
      collector_base_url: collectorBaseUrl,
      assertions: [
        "public transport map can be created, approved, and synced into backend transport routes",
        "other transport import lands in admin review queue before public visibility",
        "other transport becomes public only after admin approval",
      ],
      transport_map: {
        collector_item_id: collectorRouteId,
        backend_route_id: backendRouteId,
        route_number: routeNumber,
      },
      other_transport: {
        review_id: reviewId,
        place_id: backendPlaceId,
        slug: otherTransportSlug,
      },
    }, null, 2));
  } finally {
    if (backendRouteId > 0 && backendOwnerToken) {
      await requestJson(`${BACKEND_BASE_URL}/transport-routes/${backendRouteId}`, {
        method: "DELETE",
        token: backendOwnerToken,
      }).catch(() => null);
    }
    if (backendPlaceId > 0 && backendOwnerToken) {
      await requestJson(`${BACKEND_BASE_URL}/places/${backendPlaceId}`, {
        method: "DELETE",
        token: backendOwnerToken,
      }).catch(() => null);
    }
    await stopCollector(collectorHandle).catch(() => null);
  }
}

main().catch((err) => {
  console.error(`smoke-transport-workflow-live: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
