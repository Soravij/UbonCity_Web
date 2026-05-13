import pool from "../config/db.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { LIMITS, cleanPlainText, cleanRichText, cleanUrl } from "../validators/inputSanitizer.js";
import { assertBackendIntegrationReadiness } from "../services/integrationReadinessService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let transportSchemaReady = false;
const REQUEST_STATUSES = ["pending", "approved", "rejected", "applied"];
const LIFECYCLE_SYNC_TOKEN = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
const DEFAULT_COLLECTOR_SOURCE_BASE = String(
  process.env.COLLECTOR_PUBLIC_BASE_URL || process.env.COLLECTOR_PUBLIC_URL || "http://127.0.0.1:5062"
).trim();
const BACKEND_UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const VEHICLE_TYPES = ["songthaew", "minibus", "van", "bus"];
const LEGACY_ROUTE_TYPES = ["songthaew", "bus", "van"];
const DEFAULT_VEHICLE_IMAGES = {
  songthaew: "/transport-vehicles/songthaew.svg",
  minibus: "/transport-vehicles/minibus.svg",
  van: "/transport-vehicles/van.svg",
  bus: "/transport-vehicles/bus.svg",
};

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function sanitizeStopName(value, idx) {
    return cleanPlainText(value || `Stop ${idx + 1}`, { field: "stop name", max: LIMITS.SHORT_TEXT_MAX });
}

function normalizeVehicleType(input) {
  const value = String(input || "songthaew").trim().toLowerCase();
  if (VEHICLE_TYPES.includes(value)) return value;
  if (value === "mini_bus" || value === "mini-bus") return "minibus";
  if (value === "songtaew") return "songthaew";
  return "songthaew";
}

function toLegacyRouteType(vehicleType) {
  const type = normalizeVehicleType(vehicleType);
  if (LEGACY_ROUTE_TYPES.includes(type)) return type;
  if (type === "minibus") return "bus";
  return "songthaew";
}

function normalizeVehicleImage(input, vehicleType) {
  const value = String(input || "").trim();
  if (value) return value;
  return DEFAULT_VEHICLE_IMAGES[normalizeVehicleType(vehicleType)] || DEFAULT_VEHICLE_IMAGES.songthaew;
}

function normalizeColor(input, fallback = "#ff6600") {
  const value = String(input || "").trim();
  if (!value) return fallback;

  const withHash = value.startsWith("#") ? value : `#${value}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toLowerCase();
  return fallback;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeBaseUrl(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return fallback;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function resolveCollectorSourceBaseUrl(rawValue) {
  return normalizeBaseUrl(rawValue, normalizeBaseUrl(DEFAULT_COLLECTOR_SOURCE_BASE, "http://127.0.0.1:5062"));
}

function toBackendUploadUrl(fileName) {
  const safeFileName = String(fileName || "").trim();
  if (!safeFileName) return null;
  const base = String(process.env.BACKEND_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (base) return `${base}/uploads/${safeFileName}`;
  return `/uploads/${safeFileName}`;
}

function sanitizeFileName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extFromContentType(contentType, fallback = ".jpg") {
  const normalized = String(contentType || "").trim().toLowerCase();
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/webp")) return ".webp";
  if (normalized.includes("image/gif")) return ".gif";
  if (normalized.includes("image/avif")) return ".avif";
  if (normalized.includes("image/svg+xml")) return ".svg";
  return fallback;
}

function extFromUrl(rawUrl, fallback = ".jpg") {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    const ext = path.extname(parsed.pathname || "").trim().toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function resolveMediaSourceUrl(sourceUrl, sourceBaseUrl) {
  const raw = String(sourceUrl || "").trim();
  if (!raw) throw new Error("media source_url is required");
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = resolveCollectorSourceBaseUrl(sourceBaseUrl);
  const normalizedPath = raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
  return new URL(normalizedPath, `${base}/`).toString();
}

function isDefaultVehicleImage(value = "") {
  const normalized = String(value || "").trim();
  return Object.values(DEFAULT_VEHICLE_IMAGES).includes(normalized);
}

async function ensureUploadsDir() {
  await fs.mkdir(BACKEND_UPLOADS_DIR, { recursive: true });
}

async function mirrorTransportImageToBackendStorage(sourceUrl, sourceBaseUrl) {
  const resolvedSourceUrl = resolveMediaSourceUrl(sourceUrl, sourceBaseUrl);
  const response = await fetch(resolvedSourceUrl);
  if (!response.ok) {
    throw new Error(`cannot fetch media (${response.status})`);
  }

  const contentType = String(response.headers.get("content-type") || "").trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`unsupported media content-type: ${contentType || "unknown"}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("empty media payload");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("media payload too large");

  await ensureUploadsDir();

  const ext = extFromContentType(contentType, extFromUrl(resolvedSourceUrl, ".jpg"));
  const fileName = sanitizeFileName(`transport-sync-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  await fs.writeFile(path.join(BACKEND_UPLOADS_DIR, fileName), buffer);
  return toBackendUploadUrl(fileName);
}

function calculateDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  let total = 0;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];

    const lat1 = toNumber(prev.lat);
    const lng1 = toNumber(prev.lng);
    const lat2 = toNumber(curr.lat);
    const lng2 = toNumber(curr.lng);

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    total += earthKm * c;
  }

  return Number(total.toFixed(2));
}

async function ensureColumn(columnName, alterSql) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM transport_routes LIKE '${columnName}'`);
  if (!Array.isArray(rows) || !rows.length) {
    await pool.query(alterSql);
  }
}

async function ensureUniqueIndex(indexName, columnName) {
  const [rows] = await pool.query("SHOW INDEX FROM transport_routes WHERE Key_name = ?", [indexName]);
  if (!Array.isArray(rows) || !rows.length) {
    await pool.query(`ALTER TABLE transport_routes ADD UNIQUE KEY ${indexName} (${columnName})`);
  }
}

async function ensureTransportSchema() {
  if (transportSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transport_routes (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      route_code VARCHAR(120) NOT NULL,
      route_number VARCHAR(120) NULL,
      route_name VARCHAR(255) NULL,
      route_type VARCHAR(32) NOT NULL,
      vehicle_type VARCHAR(32) NULL,
      vehicle_image VARCHAR(500) NULL,
      color VARCHAR(16) NOT NULL DEFAULT '#ff6600',
      description TEXT NULL,
      start_stop VARCHAR(255) NULL,
      end_stop VARCHAR(255) NULL,
      raw_points JSON NULL,
      distance_km DECIMAL(8,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_transport_route_code (route_code),
      KEY idx_transport_route_type_created (route_type, created_at)
    ) ENGINE=InnoDB
  `);

  await ensureColumn("route_number", "ALTER TABLE transport_routes ADD COLUMN route_number VARCHAR(120) NULL AFTER route_code");
  await ensureColumn("route_name", "ALTER TABLE transport_routes ADD COLUMN route_name VARCHAR(255) NULL AFTER route_number");
  await ensureColumn("vehicle_type", "ALTER TABLE transport_routes ADD COLUMN vehicle_type VARCHAR(32) NULL AFTER route_type");
  await ensureColumn("vehicle_image", "ALTER TABLE transport_routes ADD COLUMN vehicle_image VARCHAR(500) NULL AFTER vehicle_type");
  await ensureColumn("raw_points", "ALTER TABLE transport_routes ADD COLUMN raw_points JSON NULL AFTER end_stop");
  await ensureColumn(
    "collector_source_item_id",
    "ALTER TABLE transport_routes ADD COLUMN collector_source_item_id BIGINT UNSIGNED NULL AFTER raw_points"
  );
  await ensureColumn(
    "sync_source_system",
    "ALTER TABLE transport_routes ADD COLUMN sync_source_system VARCHAR(64) NULL AFTER collector_source_item_id"
  );
  await ensureColumn(
    "sync_updated_at",
    "ALTER TABLE transport_routes ADD COLUMN sync_updated_at TIMESTAMP NULL AFTER sync_source_system"
  );
  await ensureUniqueIndex("uq_transport_collector_source_item_id", "collector_source_item_id");

  await pool.query("ALTER TABLE transport_routes MODIFY COLUMN route_type VARCHAR(32) NOT NULL");

  await pool.query(`
    UPDATE transport_routes
    SET route_number = COALESCE(NULLIF(route_number, ''), route_code),
        route_name = COALESCE(NULLIF(route_name, ''), name),
        vehicle_type = COALESCE(NULLIF(vehicle_type, ''), route_type),
        vehicle_image = COALESCE(
          NULLIF(vehicle_image, ''),
          CASE COALESCE(NULLIF(vehicle_type, ''), route_type)
            WHEN 'songthaew' THEN '${DEFAULT_VEHICLE_IMAGES.songthaew}'
            WHEN 'minibus' THEN '${DEFAULT_VEHICLE_IMAGES.minibus}'
            WHEN 'van' THEN '${DEFAULT_VEHICLE_IMAGES.van}'
            WHEN 'bus' THEN '${DEFAULT_VEHICLE_IMAGES.bus}'
            ELSE '${DEFAULT_VEHICLE_IMAGES.songthaew}'
          END
        )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transport_route_points (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      route_id BIGINT UNSIGNED NOT NULL,
      lat DECIMAL(10,7) NOT NULL,
      lng DECIMAL(10,7) NOT NULL,
      point_order INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_transport_points_route
        FOREIGN KEY (route_id) REFERENCES transport_routes(id)
        ON DELETE CASCADE,
      KEY idx_transport_points_order (route_id, point_order)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transport_route_stops (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      route_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(255) NOT NULL,
      lat DECIMAL(10,7) NOT NULL,
      lng DECIMAL(10,7) NOT NULL,
      stop_order INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_transport_stops_route
        FOREIGN KEY (route_id) REFERENCES transport_routes(id)
        ON DELETE CASCADE,
      KEY idx_transport_stops_order (route_id, stop_order)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transport_route_audit_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      route_id BIGINT UNSIGNED NULL,
      action ENUM('create','update','delete','import_geojson','export') NOT NULL,
      admin_user_id BIGINT UNSIGNED NULL,
      admin_email VARCHAR(255) NULL,
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      before_data JSON NULL,
      after_data JSON NULL,
      metadata JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_transport_audit_route (route_id),
      KEY idx_transport_audit_admin (admin_user_id),
      KEY idx_transport_audit_created (created_at)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transport_add_line_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      payload_json JSON NOT NULL,
      submitted_by_user_id BIGINT UNSIGNED NULL,
      submitted_by_email VARCHAR(255) NULL,
      reviewed_by_user_id BIGINT UNSIGNED NULL,
      reviewed_by_email VARCHAR(255) NULL,
      review_note TEXT NULL,
      applied_route_id BIGINT UNSIGNED NULL,
      reviewed_at TIMESTAMP NULL,
      applied_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_transport_add_line_status_created (status, created_at),
      KEY idx_transport_add_line_submitted_by (submitted_by_user_id)
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transport_add_line_request_audit_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      request_id BIGINT UNSIGNED NOT NULL,
      action ENUM('submit','approve','reject','apply') NOT NULL,
      actor_user_id BIGINT UNSIGNED NULL,
      actor_email VARCHAR(255) NULL,
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      metadata JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_transport_add_line_audit_request (request_id),
      KEY idx_transport_add_line_audit_created (created_at)
    ) ENGINE=InnoDB
  `);

  transportSchemaReady = true;
}

function parsePayload(payload = {}) {
  const rawPointsInput = Array.isArray(payload.raw_points) ? payload.raw_points : [];
  if (rawPointsInput.length > LIMITS.ROUTE_POINTS_MAX) {
    throw new Error(`raw_points exceeds max size (${LIMITS.ROUTE_POINTS_MAX})`);
  }

  const pathInput = Array.isArray(payload.path) ? payload.path : [];
  if (pathInput.length > LIMITS.ROUTE_POINTS_MAX) {
    throw new Error(`path exceeds max size (${LIMITS.ROUTE_POINTS_MAX})`);
  }

  const stopsInput = Array.isArray(payload.stops) ? payload.stops : [];
  if (stopsInput.length > LIMITS.ROUTE_STOPS_MAX) {
    throw new Error(`stops exceeds max size (${LIMITS.ROUTE_STOPS_MAX})`);
  }

  const rawPoints = rawPointsInput
    .map((p, idx) => ({ lat: toNumber(p?.lat), lng: toNumber(p?.lng), point_order: idx }))
    .filter((p) => isValidLatLng(p.lat, p.lng));

  const path = pathInput
    .map((p, idx) => ({ lat: toNumber(p?.lat), lng: toNumber(p?.lng), point_order: idx }))
    .filter((p) => isValidLatLng(p.lat, p.lng));

  const stops = stopsInput
    .map((s, idx) => ({
      name: sanitizeStopName(s?.name, idx),
      lat: toNumber(s?.lat),
      lng: toNumber(s?.lng),
      stop_order: idx,
    }))
    .filter((s) => isValidLatLng(s.lat, s.lng));

  const routeName = cleanPlainText(payload.route_name || payload.name, {
    field: "route_name",
    max: LIMITS.TITLE_MAX,
    required: true,
  });

  const routeNumber = cleanPlainText(payload.route_number || payload.route_code, {
    field: "route_number",
    max: 120,
    required: true,
  });

  const vehicleType = normalizeVehicleType(payload.vehicle_type || payload.route_type);

  let vehicleImage = normalizeVehicleImage(payload.vehicle_image, vehicleType);
  if (vehicleImage) {
    vehicleImage = cleanUrl(vehicleImage, { field: "vehicle_image" });
  }

  const startStop = payload.start_stop
    ? cleanPlainText(payload.start_stop, { field: "start_stop", max: LIMITS.SHORT_TEXT_MAX })
    : stops[0]?.name || "";

  const endStop = payload.end_stop
    ? cleanPlainText(payload.end_stop, { field: "end_stop", max: LIMITS.SHORT_TEXT_MAX })
    : stops[stops.length - 1]?.name || "";

  return {
    route_name: routeName,
    route_number: routeNumber,
    vehicle_type: vehicleType,
    vehicle_image: vehicleImage,
    name: routeName,
    route_code: routeNumber,
    route_type: toLegacyRouteType(vehicleType),
    color: normalizeColor(payload.color, "#ff6600"),
    description: payload.description
      ? cleanRichText(payload.description, { field: "description", max: LIMITS.DESCRIPTION_MAX })
      : "",
    start_stop: startStop,
    end_stop: endStop,
    raw_points: rawPoints,
    path,
    stops,
  };
}

function parseGeoJsonBody(input) {
  const payload = input || {};
  const feature = payload.type === "FeatureCollection" ? payload.features?.[0] : payload;

  if (!feature || feature.type !== "Feature") {
    throw new Error("GeoJSON must be a Feature or FeatureCollection");
  }

  const geometry = feature.geometry || {};
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw new Error("GeoJSON geometry must be LineString");
  }

  if (geometry.coordinates.length > LIMITS.ROUTE_POINTS_MAX) {
    throw new Error(`GeoJSON path exceeds max size (${LIMITS.ROUTE_POINTS_MAX})`);
  }

  const properties = feature.properties || {};
  const path = geometry.coordinates
    .map((coord) => ({ lat: toNumber(coord?.[1]), lng: toNumber(coord?.[0]) }))
    .filter((p) => isValidLatLng(p.lat, p.lng));

  const rawStops = Array.isArray(properties.stops) ? properties.stops : [];
  if (rawStops.length > LIMITS.ROUTE_STOPS_MAX) {
    throw new Error(`GeoJSON stops exceeds max size (${LIMITS.ROUTE_STOPS_MAX})`);
  }

  const stops = rawStops
    .map((s, idx) => ({
      name: sanitizeStopName(s?.name, idx),
      lat: toNumber(s?.lat),
      lng: toNumber(s?.lng),
    }))
    .filter((s) => isValidLatLng(s.lat, s.lng));

  if (!path.length) throw new Error("GeoJSON coordinates are empty or invalid");

  return {
    route_name: properties.route_name || properties.name || payload.route_name,
    route_number: properties.route_number || properties.route_code || payload.route_number || payload.route_code,
    vehicle_type:
      properties.vehicle_type || properties.route_type || payload.vehicle_type || payload.route_type || "songthaew",
    vehicle_image: properties.vehicle_image || payload.vehicle_image || "",
    color: String(properties.color || payload.color || "#ff6600"),
    description: properties.description || payload.description || "",
    start_stop: properties.start_stop || stops[0]?.name || "",
    end_stop: properties.end_stop || stops[stops.length - 1]?.name || "",
    path,
    stops,
  };
}


async function findRouteById(routeId) {
  const [rows] = await pool.query("SELECT * FROM transport_routes WHERE id=? LIMIT 1", [routeId]);
  if (!rows.length) return null;

  const route = rows[0];
  const [pathRows] = await pool.query(
    "SELECT lat,lng,point_order FROM transport_route_points WHERE route_id=? ORDER BY point_order ASC",
    [routeId]
  );
  const [stopRows] = await pool.query(
    "SELECT name,lat,lng,stop_order FROM transport_route_stops WHERE route_id=? ORDER BY stop_order ASC",
    [routeId]
  );

  const vehicleType = normalizeVehicleType(route.vehicle_type || route.route_type);
  const routeName = String(route.route_name || route.name || "").trim();
  const routeNumber = String(route.route_number || route.route_code || "").trim();

  return {
    ...route,
    route_name: routeName,
    route_number: routeNumber,
    vehicle_type: vehicleType,
    vehicle_image: normalizeVehicleImage(route.vehicle_image, vehicleType),
    name: routeName,
    route_code: routeNumber,
    route_type: toLegacyRouteType(vehicleType),
    path: pathRows.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), point_order: p.point_order })),
    stops: stopRows.map((s) => ({
      name: s.name,
      lat: Number(s.lat),
      lng: Number(s.lng),
      stop_order: s.stop_order,
    })),
  };
}

async function logAudit(req, { action, routeId = null, beforeData = null, afterData = null, metadata = null }) {
  try {
    await pool.query(
      `INSERT INTO transport_route_audit_logs
       (route_id, action, admin_user_id, admin_email, ip_address, user_agent, before_data, after_data, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        routeId,
        action,
        req.user?.id || null,
        req.user?.email || null,
        req.ip || null,
        String(req.headers["user-agent"] || "").slice(0, 255) || null,
        beforeData ? JSON.stringify(beforeData) : null,
        afterData ? JSON.stringify(afterData) : null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch {
    // keep silent in production flow
  }
}

function parseJsonField(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function toRequestDto(row) {
  return {
    id: Number(row.id),
    status: String(row.status || "pending"),
    payload: parseJsonField(row.payload_json, {}) || {},
    submitted_by_user_id: row.submitted_by_user_id == null ? null : Number(row.submitted_by_user_id),
    submitted_by_email: row.submitted_by_email || null,
    reviewed_by_user_id: row.reviewed_by_user_id == null ? null : Number(row.reviewed_by_user_id),
    reviewed_by_email: row.reviewed_by_email || null,
    review_note: row.review_note || null,
    applied_route_id: row.applied_route_id == null ? null : Number(row.applied_route_id),
    reviewed_at: row.reviewed_at || null,
    applied_at: row.applied_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function logAddLineRequestAudit(req, { requestId, action, metadata = null }) {
  try {
    await pool.query(
      `INSERT INTO transport_add_line_request_audit_logs
       (request_id, action, actor_user_id, actor_email, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        requestId,
        action,
        req.user?.id || null,
        req.user?.email || null,
        req.ip || null,
        String(req.headers["user-agent"] || "").slice(0, 255) || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch {
    // keep silent in production flow
  }
}

async function findAddLineRequestById(requestId) {
  const [rows] = await pool.query("SELECT * FROM transport_add_line_requests WHERE id=? LIMIT 1", [requestId]);
  if (!Array.isArray(rows) || !rows.length) return null;
  return toRequestDto(rows[0]);
}

async function saveRoute(payload, routeId = null, externalConn = null) {
  const parsed = parsePayload(payload);

  if (!parsed.route_name) throw new Error("Route name is required");
  if (!parsed.route_number) throw new Error("Route number is required");
  if (!parsed.path.length) throw new Error("Path points are required");

  const distanceKm = calculateDistanceKm(parsed.path);

  const conn = externalConn || (await pool.getConnection());
  const useOwnTransaction = !externalConn;
  try {
    if (useOwnTransaction) {
      await conn.beginTransaction();
    }

    let targetId = routeId;

    if (!routeId) {
      const [result] = await conn.query(
        `INSERT INTO transport_routes
          (name, route_code, route_number, route_name, route_type, vehicle_type, vehicle_image, color, description, start_stop, end_stop, raw_points, distance_km)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          parsed.route_name,
          parsed.route_number,
          parsed.route_number,
          parsed.route_name,
          toLegacyRouteType(parsed.vehicle_type),
          parsed.vehicle_type,
          normalizeVehicleImage(parsed.vehicle_image, parsed.vehicle_type),
          parsed.color,
          parsed.description,
          parsed.start_stop,
          parsed.end_stop,
          JSON.stringify(parsed.raw_points || []),
          distanceKm,
        ]
      );
      targetId = result.insertId;
    } else {
      await conn.query(
        `UPDATE transport_routes
         SET name=?, route_code=?, route_number=?, route_name=?, route_type=?, vehicle_type=?, vehicle_image=?, color=?, description=?, start_stop=?, end_stop=?, raw_points=?, distance_km=?
         WHERE id=?`,
        [
          parsed.route_name,
          parsed.route_number,
          parsed.route_number,
          parsed.route_name,
          toLegacyRouteType(parsed.vehicle_type),
          parsed.vehicle_type,
          normalizeVehicleImage(parsed.vehicle_image, parsed.vehicle_type),
          parsed.color,
          parsed.description,
          parsed.start_stop,
          parsed.end_stop,
          JSON.stringify(parsed.raw_points || []),
          distanceKm,
          routeId,
        ]
      );

      await conn.query("DELETE FROM transport_route_points WHERE route_id=?", [routeId]);
      await conn.query("DELETE FROM transport_route_stops WHERE route_id=?", [routeId]);
    }

    if (parsed.path.length) {
      const values = parsed.path.map((p) => [targetId, p.lat, p.lng, p.point_order]);
      await conn.query("INSERT INTO transport_route_points (route_id, lat, lng, point_order) VALUES ?", [values]);
    }

    if (parsed.stops.length) {
      const values = parsed.stops.map((s) => [targetId, s.name, s.lat, s.lng, s.stop_order]);
      await conn.query("INSERT INTO transport_route_stops (route_id, name, lat, lng, stop_order) VALUES ?", [values]);
    }

    if (useOwnTransaction) {
      await conn.commit();
    }
    return targetId;
  } catch (err) {
    if (useOwnTransaction) {
      await conn.rollback();
    }
    throw err;
  } finally {
    if (useOwnTransaction) {
      conn.release();
    }
  }
}

function isValidLifecycleSyncToken(providedToken) {
  if (!LIFECYCLE_SYNC_TOKEN) return false;
  const expected = Buffer.from(LIFECYCLE_SYNC_TOKEN);
  const received = Buffer.from(String(providedToken || "").trim());
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export async function getTransportConfig(_req, res) {
  // Browser key only: do not expose server-side API keys here.
  const mapsApiKey = String(process.env.GOOGLE_MAPS_BROWSER_KEY || "").trim();
  res.json({ mapsApiKey });
}

export async function getTransportRoutes(req, res) {
  try {
    await ensureTransportSchema();

    const includePath = String(req.query?.include_path || "") === "1";
    const includeStops = String(req.query?.include_stops || "") === "1";

    if (!includePath && !includeStops) {
      const [rows] = await pool.query(
        `SELECT
           r.id,
           COALESCE(NULLIF(r.route_name, ''), r.name) AS route_name,
           COALESCE(NULLIF(r.route_number, ''), r.route_code) AS route_number,
           COALESCE(NULLIF(r.vehicle_type, ''), r.route_type) AS vehicle_type,
           r.vehicle_image,
           COALESCE(NULLIF(r.route_name, ''), r.name) AS name,
           COALESCE(NULLIF(r.route_number, ''), r.route_code) AS route_code,
           r.route_type,
           r.color,
           r.description,
           r.start_stop,
           r.end_stop,
           r.distance_km,
           r.created_at,
           COUNT(DISTINCT p.id) AS point_count,
           COUNT(DISTINCT s.id) AS stop_count
         FROM transport_routes r
         LEFT JOIN transport_route_points p ON p.route_id=r.id
         LEFT JOIN transport_route_stops s ON s.route_id=r.id
         GROUP BY r.id
         ORDER BY r.created_at DESC`
      );

      return res.json({
        items: rows.map((item) => {
          const vehicleType = normalizeVehicleType(item.vehicle_type || item.route_type);
          return {
            ...item,
            vehicle_type: vehicleType,
            vehicle_image: normalizeVehicleImage(item.vehicle_image, vehicleType),
            route_type: toLegacyRouteType(vehicleType),
          };
        }),
      });
    }

    const [rows] = await pool.query("SELECT id FROM transport_routes ORDER BY created_at DESC");
    const items = [];

    for (const row of rows) {
      const item = await findRouteById(row.id);
      if (!item) continue;

      items.push({
        ...item,
        path: includePath ? item.path : undefined,
        stops: includeStops ? item.stops : undefined,
      });
    }

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getTransportRouteById(req, res) {
  try {
    await ensureTransportSchema();
    const routeId = Number(req.params.id || 0);
    if (!routeId) return res.status(400).json({ error: "Invalid route id" });

    const item = await findRouteById(routeId);
    if (!item) return res.status(404).json({ error: "Route not found" });

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function createTransportRoute(req, res) {
  try {
    await ensureTransportSchema();
    const routeId = await saveRoute(req.body || null, null);
    const item = await findRouteById(routeId);

    await logAudit(req, { action: "create", routeId, afterData: item });

    res.status(201).json(item);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("required") || msg.includes("max size") || msg.includes("invalid") || msg.includes("GeoJSON")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateTransportRoute(req, res) {
  try {
    await ensureTransportSchema();
    const routeId = Number(req.params.id || 0);
    if (!routeId) return res.status(400).json({ error: "Invalid route id" });

    const before = await findRouteById(routeId);
    if (!before) return res.status(404).json({ error: "Route not found" });

    await saveRoute(req.body || null, routeId);
    const item = await findRouteById(routeId);

    await logAudit(req, { action: "update", routeId, beforeData: before, afterData: item });

    res.json(item);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("required") || msg.includes("max size") || msg.includes("invalid") || msg.includes("GeoJSON")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteTransportRoute(req, res) {
  try {
    await ensureTransportSchema();
    const routeId = Number(req.params.id || 0);
    if (!routeId) return res.status(400).json({ error: "Invalid route id" });

    const before = await findRouteById(routeId);
    if (!before) return res.status(404).json({ error: "Route not found" });

    await pool.query("DELETE FROM transport_routes WHERE id=?", [routeId]);
    await logAudit(req, { action: "delete", routeId, beforeData: before });

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function importTransportGeoJson(req, res) {
  try {
    await ensureTransportSchema();
    const payload = parseGeoJsonBody(req.body || {});
    if (!payload.route_name) return res.status(400).json({ error: "route_name is required" });
    if (!payload.route_number) return res.status(400).json({ error: "route_number is required" });

    const routeId = await saveRoute(payload, null);
    const item = await findRouteById(routeId);

    await logAudit(req, {
      action: "import_geojson",
      routeId,
      afterData: item,
      metadata: { source: "geojson" },
    });

    res.status(201).json(item);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("required") || msg.includes("max size") || msg.includes("invalid") || msg.includes("GeoJSON")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: "Internal server error" });
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function exportTransportRoutes(req, res) {
  try {
    await ensureTransportSchema();

    const [rows] = await pool.query("SELECT id FROM transport_routes ORDER BY created_at DESC");
    const items = [];
    for (const row of rows) {
      const item = await findRouteById(row.id);
      if (item) items.push(item);
    }

    const grouped = { songthaew: [], minibus: [], van: [], bus: [] };
    for (const item of items) {
      const vehicleType = normalizeVehicleType(item.vehicle_type || item.route_type);
      const routeName = String(item.route_name || item.name || "").trim();
      const routeNumber = String(item.route_number || item.route_code || "").trim();

      const route = {
        id: item.id,
        route_name: routeName,
        route_number: routeNumber,
        vehicle_type: vehicleType,
        vehicle_image: normalizeVehicleImage(item.vehicle_image, vehicleType),
        route_code: routeNumber,
        route_type: toLegacyRouteType(vehicleType),
        color: item.color,
        description: item.description,
        start_stop: item.start_stop,
        end_stop: item.end_stop,
        distance_km: Number(item.distance_km || 0),
        stops: item.stops.map((s) => ({ name: s.name, lat: Number(s.lat), lng: Number(s.lng) })),
        path: item.path.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })),
      };

      if (!grouped[route.vehicle_type]) continue;
      grouped[route.vehicle_type].push(route);
    }

    const outputRoot = path.resolve(__dirname, "..", "transport");
    await writeJson(path.join(outputRoot, "routes.json"), grouped);

    for (const type of Object.keys(grouped)) {
      for (const route of grouped[type]) {
        const slug = slugify(route.route_number || route.route_name || `route-${route.id}`) || `route-${route.id}`;

        await writeJson(path.join(outputRoot, type, `${slug}.json`), route);
        await writeJson(path.join(outputRoot, "geojson", `${type}-${slug}.geojson`), {
          type: "Feature",
          properties: {
            id: route.id,
            route_name: route.route_name,
            route_number: route.route_number,
            route_code: route.route_number,
            vehicle_type: route.vehicle_type,
            vehicle_image: route.vehicle_image,
            route_type: route.route_type,
            color: route.color,
            distance_km: route.distance_km,
            start_stop: route.start_stop,
            end_stop: route.end_stop,
            stops: route.stops,
          },
          geometry: {
            type: "LineString",
            coordinates: route.path.map((p) => [p.lng, p.lat]),
          },
        });
      }
    }

    await writeJson(path.join(outputRoot, "pages", "manifest.json"), {
      generated_at: new Date().toISOString(),
      main_page: { path: "/transport", sections: ["songthaew", "minibus", "van", "bus"] },
      category_pages: ["songthaew", "minibus", "van", "bus"].map((type) => ({
        path: `/transport/${type}`,
        type,
        total_routes: grouped[type].length,
      })),
      route_pages: ["songthaew", "minibus", "van", "bus"].flatMap((type) =>
        grouped[type].map((route) => {
          const slug = slugify(route.route_number || route.route_name || `route-${route.id}`) || `route-${route.id}`;
          return {
            id: route.id,
            path: `/transport/${type}/${slug}`,
            type,
            route_name: route.route_name,
            route_number: route.route_number,
            route_code: route.route_number,
            vehicle_type: route.vehicle_type,
            vehicle_image: route.vehicle_image,
            color: route.color,
            distance_km: route.distance_km,
            stop_count: route.stops.length,
          };
        })
      ),
    });

    await logAudit(req, {
      action: "export",
      metadata: {
        total_routes: grouped.songthaew.length + grouped.minibus.length + grouped.bus.length + grouped.van.length,
        by_type: {
          songthaew: grouped.songthaew.length,
          minibus: grouped.minibus.length,
          bus: grouped.bus.length,
          van: grouped.van.length,
        },
      },
    });

    res.json({
      ok: true,
      output_dir: outputRoot,
      total_routes: grouped.songthaew.length + grouped.minibus.length + grouped.bus.length + grouped.van.length,
      by_type: {
        songthaew: grouped.songthaew.length,
        minibus: grouped.minibus.length,
        bus: grouped.bus.length,
        van: grouped.van.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function importCollectorTransportRoutes(req, res) {
  let conn = null;
  try {
    await ensureTransportSchema();

    assertBackendIntegrationReadiness(["collector_transport_import"]);

    if (!isValidLifecycleSyncToken(req.headers["x-lifecycle-token"])) {
      return res.status(401).json({ error: "Invalid lifecycle sync token" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const routes = Array.isArray(body.routes) ? body.routes : [];
    if (!routes.length) {
      return res.status(400).json({ error: "routes is required" });
    }
    if (routes.length > LIMITS.IMPORT_ITEMS_MAX) {
      return res.status(400).json({ error: `routes exceeds max size (${LIMITS.IMPORT_ITEMS_MAX})` });
    }

    const sourceSystem = cleanPlainText(body.source_system || "collector-app", {
      field: "source_system",
      max: 64,
      required: true,
    });
    const sourceBaseUrl = resolveCollectorSourceBaseUrl(body.source_base_url);

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const synced = [];
    for (const rawRoute of routes) {
      const route = rawRoute && typeof rawRoute === "object" ? rawRoute : {};
      const collectorItemId = Number(route.collector_item_id || route.source_content_item_id || route.id || 0);
      if (!Number.isInteger(collectorItemId) || collectorItemId <= 0) {
        throw new Error("collector_item_id is required");
      }

      const normalized = parsePayload(route);
      const hasExplicitVehicleImage = String(route.vehicle_image || "").trim().length > 0;
      let vehicleImage = normalizeVehicleImage(normalized.vehicle_image, normalized.vehicle_type);
      if (vehicleImage && !isDefaultVehicleImage(vehicleImage)) {
        vehicleImage = await mirrorTransportImageToBackendStorage(vehicleImage, sourceBaseUrl);
      }

      const [collectorRows] = await conn.query(
        "SELECT id FROM transport_routes WHERE collector_source_item_id=? LIMIT 1",
        [collectorItemId]
      );
      const existingByCollector = Array.isArray(collectorRows) && collectorRows.length ? Number(collectorRows[0].id) : null;

      let targetRouteId = existingByCollector;
      if (!targetRouteId) {
        const [routeCodeRows] = await conn.query("SELECT id FROM transport_routes WHERE route_code=? LIMIT 1", [
          normalized.route_number,
        ]);
        if (Array.isArray(routeCodeRows) && routeCodeRows.length) {
          throw new Error(`collector sync conflict for route_number ${normalized.route_number}: existing backend route is not bound to collector_source_item_id`);
        }
      }

      if (targetRouteId && !hasExplicitVehicleImage) {
        const existingRoute = await findRouteById(targetRouteId);
        const existingVehicleImage = String(existingRoute?.vehicle_image || "").trim();
        if (existingVehicleImage) {
          vehicleImage = existingVehicleImage;
        }
      }

      targetRouteId = await saveRoute({ ...normalized, vehicle_image: vehicleImage }, targetRouteId, conn);
      await conn.query(
        `UPDATE transport_routes
         SET collector_source_item_id=?, sync_source_system=?, sync_updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [collectorItemId, sourceSystem, targetRouteId]
      );

      const routeRow = await findRouteById(targetRouteId);
      synced.push({
        route_id: targetRouteId,
        collector_item_id: collectorItemId,
        route_number: routeRow?.route_number || normalized.route_number,
        route_name: routeRow?.route_name || normalized.route_name,
      });
    }

    await conn.commit();
    conn.release();
    conn = null;

    return res.json({
      ok: true,
      synced_count: synced.length,
      items: synced,
    });
  } catch (err) {
    if (conn) {
      await conn.rollback().catch(() => {});
      conn.release();
    }
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}

export async function submitAddLineRequest(req, res) {
  try {
    await ensureTransportSchema();
    const parsed = parsePayload(req.body || {});
    if (parsed.path.length < 2) {
      return res.status(400).json({ error: "At least 2 path points are required" });
    }
    if (parsed.stops.length < 2) {
      return res.status(400).json({ error: "At least 2 stops are required" });
    }

    const [result] = await pool.query(
      `INSERT INTO transport_add_line_requests
       (status, payload_json, submitted_by_user_id, submitted_by_email)
       VALUES ('pending', ?, ?, ?)`,
      [JSON.stringify(parsed), req.user?.id || null, req.user?.email || null]
    );

    const requestId = Number(result.insertId || 0);
    await logAddLineRequestAudit(req, {
      requestId,
      action: "submit",
      metadata: {
        route_number: parsed.route_number,
        route_name: parsed.route_name,
        stop_count: parsed.stops.length,
        point_count: parsed.path.length,
      },
    });

    const row = await findAddLineRequestById(requestId);
    res.status(201).json(row);
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback error
      }
    }
    const msg = String(err?.message || "");
    if (msg.includes("required") || msg.includes("max size") || msg.includes("invalid")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (conn) {
      try {
        conn.release();
      } catch {
        // ignore release error
      }
    }
  }
}

export async function listAddLineRequests(req, res) {
  try {
    await ensureTransportSchema();
    const status = String(req.query?.status || "").trim().toLowerCase();
    if (status && !REQUEST_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status filter" });
    }

    const [rows] = status
      ? await pool.query("SELECT * FROM transport_add_line_requests WHERE status=? ORDER BY created_at DESC", [status])
      : await pool.query("SELECT * FROM transport_add_line_requests ORDER BY created_at DESC");

    res.json({ items: (rows || []).map((row) => toRequestDto(row)) });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function reviewAddLineRequest(req, res) {
  try {
    await ensureTransportSchema();
    const requestId = Number(req.params.id || 0);
    if (!requestId) return res.status(400).json({ error: "Invalid request id" });

    const action = String(req.body?.action || "").trim().toLowerCase();
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "action must be approve or reject" });
    }

    const row = await findAddLineRequestById(requestId);
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.status === "applied") {
      return res.status(409).json({ error: "Request already applied" });
    }

    const nextStatus = action === "approve" ? "approved" : "rejected";
    const reviewNote = String(req.body?.note || "").trim() || null;
    await pool.query(
      `UPDATE transport_add_line_requests
       SET status=?, reviewed_by_user_id=?, reviewed_by_email=?, review_note=?, reviewed_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [nextStatus, req.user?.id || null, req.user?.email || null, reviewNote, requestId]
    );

    await logAddLineRequestAudit(req, {
      requestId,
      action,
      metadata: { note: reviewNote, previous_status: row.status, next_status: nextStatus },
    });

    const updated = await findAddLineRequestById(requestId);
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function applyAddLineRequest(req, res) {
  let conn = null;
  try {
    await ensureTransportSchema();
    const requestId = Number(req.params.id || 0);
    if (!requestId) return res.status(400).json({ error: "Invalid request id" });

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT id, status, payload_json FROM transport_add_line_requests WHERE id=? FOR UPDATE",
      [requestId]
    );
    if (!Array.isArray(rows) || !rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Request not found" });
    }

    const lockedRow = rows[0];
    if (String(lockedRow.status || "") !== "approved") {
      await conn.rollback();
      return res.status(409).json({ error: "Only approved requests can be applied" });
    }

    const payload = parseJsonField(lockedRow.payload_json, {}) || {};
    const routeId = await saveRoute(payload, null, conn);

    const [updateResult] = await conn.query(
      `UPDATE transport_add_line_requests
       SET status='applied', applied_route_id=?, applied_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='approved'`,
      [routeId, requestId]
    );
    if (Number(updateResult?.affectedRows || 0) !== 1) {
      await conn.rollback();
      return res.status(409).json({ error: "Request state changed before apply" });
    }

    await conn.commit();
    conn.release();
    conn = null;

    const route = await findRouteById(routeId);

    await logAddLineRequestAudit(req, {
      requestId,
      action: "apply",
      metadata: { route_id: routeId },
    });

    await logAudit(req, {
      action: "create",
      routeId,
      afterData: route,
      metadata: { source: "add_line_request", request_id: requestId },
    });

    const updated = await findAddLineRequestById(requestId);
    res.json({ request: updated, route });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("required") || msg.includes("max size") || msg.includes("invalid")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: "Internal server error" });
  }
}






