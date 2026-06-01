import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(path.resolve("collector", "data", "collector.db"));

const BASE_MAP = {
  key: "ubon-city-base-map-v1",
  title: "Ubon City Base Map V1",
  status: "active",
  version: 1,
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
  projection_type: "linear-bbox-fit",
};

const svgFullPath = path.resolve("collector", "media", "generated", "transport-v2", "base-maps", "ubon-city-base-map-v1-r1.svg");
const metaFullPath = path.resolve("collector", "media", "generated", "transport-v2", "base-maps", "ubon-city-base-map-v1-r1.meta.json");
const storagePath = "generated/transport-v2/base-maps/ubon-city-base-map-v1-r1.svg";

const svgBuffer = readFileSync(svgFullPath);
const meta = JSON.parse(readFileSync(metaFullPath, "utf8"));
const stat = statSync(svgFullPath);
const checksum = crypto.createHash("sha256").update(svgBuffer).digest("hex");

const existingAsset = db.prepare("SELECT * FROM assets WHERE storage_path = ? LIMIT 1").get(storagePath);

let assetId = Number(existingAsset?.id || 0) || 0;
if (!assetId) {
  const result = db.prepare(`
    INSERT INTO assets (
      asset_uid,
      storage_disk,
      storage_path,
      file_name,
      mime_type,
      size_bytes,
      checksum,
      created_at,
      updated_at
    ) VALUES (?, 'local', ?, ?, 'image/svg+xml', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    crypto.randomUUID(),
    storagePath,
    path.basename(storagePath),
    Number(stat.size || 0),
    checksum
  );
  assetId = Number(result.lastInsertRowid || 0) || 0;
} else {
  db.prepare(`
    UPDATE assets
    SET file_name=?,
        mime_type='image/svg+xml',
        size_bytes=?,
        checksum=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    path.basename(storagePath),
    Number(stat.size || 0),
    checksum,
    assetId
  );
}

const metadataJson = JSON.stringify({
  label_dictionary: {},
  source_svg: storagePath,
  generated_meta: meta,
}, null, 2);

const existingBaseMap = db.prepare("SELECT * FROM transport_base_maps_v2 WHERE map_key=? LIMIT 1").get(BASE_MAP.key);

let baseMapId = Number(existingBaseMap?.id || 0) || 0;
if (!baseMapId) {
  const result = db.prepare(`
    INSERT INTO transport_base_maps_v2 (
      map_key,
      title,
      version,
      status,
      bounds_min_lat,
      bounds_min_lng,
      bounds_max_lat,
      bounds_max_lng,
      viewbox_x,
      viewbox_y,
      viewbox_width,
      viewbox_height,
      projection_type,
      base_svg_asset_id,
      preview_asset_id,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    BASE_MAP.key,
    BASE_MAP.title,
    BASE_MAP.version,
    BASE_MAP.status,
    BASE_MAP.bounds.min_lat,
    BASE_MAP.bounds.min_lng,
    BASE_MAP.bounds.max_lat,
    BASE_MAP.bounds.max_lng,
    BASE_MAP.viewbox.x,
    BASE_MAP.viewbox.y,
    BASE_MAP.viewbox.width,
    BASE_MAP.viewbox.height,
    BASE_MAP.projection_type,
    assetId,
    metadataJson
  );
  baseMapId = Number(result.lastInsertRowid || 0) || 0;
} else {
  db.prepare(`
    UPDATE transport_base_maps_v2
    SET title=?,
        version=?,
        status=?,
        bounds_min_lat=?,
        bounds_min_lng=?,
        bounds_max_lat=?,
        bounds_max_lng=?,
        viewbox_x=?,
        viewbox_y=?,
        viewbox_width=?,
        viewbox_height=?,
        projection_type=?,
        base_svg_asset_id=?,
        preview_asset_id=NULL,
        metadata_json=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    BASE_MAP.title,
    BASE_MAP.version,
    BASE_MAP.status,
    BASE_MAP.bounds.min_lat,
    BASE_MAP.bounds.min_lng,
    BASE_MAP.bounds.max_lat,
    BASE_MAP.bounds.max_lng,
    BASE_MAP.viewbox.x,
    BASE_MAP.viewbox.y,
    BASE_MAP.viewbox.width,
    BASE_MAP.viewbox.height,
    BASE_MAP.projection_type,
    assetId,
    metadataJson,
    baseMapId
  );
}

const summary = db.prepare(`
  SELECT
    id,
    map_key,
    title,
    status,
    base_svg_asset_id,
    preview_asset_id
  FROM transport_base_maps_v2
  WHERE id=?
  LIMIT 1
`).get(baseMapId);

process.stdout.write(JSON.stringify({
  asset_id: assetId,
  base_map_id: baseMapId,
  storage_path: storagePath,
  base_map: summary,
}, null, 2));
