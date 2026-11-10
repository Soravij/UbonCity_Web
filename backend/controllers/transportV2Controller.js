import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import pool from "../config/db.js";
import { validateTransportBundle, requiredBundleFiles, attachBundleFileUrls } from "../services/transportV2Bundle.js";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

export function requireTransportSyncToken(req, res, next) {
  const expectedRaw = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
  const received = Buffer.from(String(req.headers["x-lifecycle-token"] || "").trim());
  const expected = Buffer.from(expectedRaw);
  if (!expectedRaw || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return res.status(401).json({ error: "invalid sync token" });
  }
  return next();
}

function publicUploadUrl(relPath) {
  const base = String(process.env.BACKEND_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  return `${base}/uploads/${relPath}`;
}

export async function publishTransportMap(req, res) {
  let bundle;
  try { bundle = JSON.parse(String(req.body?.bundle || "")); } catch { return res.status(400).json({ error: "bundle must be JSON" }); }
  const check = validateTransportBundle(bundle);
  if (!check.ok) return res.status(400).json({ error: "invalid bundle", details: check.errors });
  const files = new Map((req.files || []).map((f) => [f.fieldname, f]));
  const names = requiredBundleFiles(bundle);
  const missing = names.filter((name) => !files.has(name));
  if (missing.length) return res.status(400).json({ error: "missing files", details: missing });
  if (!files.get(bundle.base_svg).buffer.subarray(0, 1024).toString("utf8").includes("<svg")) {
    return res.status(400).json({ error: "base_svg is not svg" });
  }
  const [dup] = await pool.query(
    "SELECT id FROM transport_map_publications WHERE map_key=? AND revision=? LIMIT 1",
    [bundle.map_key, bundle.revision]
  );
  if (dup.length) return res.status(409).json({ error: "revision already published", publication_id: dup[0].id });
  const relDir = path.posix.join("transport-v2", bundle.map_key, `r${bundle.revision}`);
  await fs.mkdir(path.join(UPLOADS_DIR, relDir), { recursive: true });
  for (const name of names) await fs.writeFile(path.join(UPLOADS_DIR, relDir, name), files.get(name).buffer);
  const stored = attachBundleFileUrls(bundle, (name) => publicUploadUrl(`${relDir}/${name}`));
  const [result] = await pool.query(
    "INSERT INTO transport_map_publications (map_key, revision, bundle_json, published_by) VALUES (?,?,?,?)",
    [bundle.map_key, bundle.revision, JSON.stringify(stored), String(req.body?.published_by || "").slice(0, 255) || null]
  );
  return res.status(201).json({
    ok: true, publication_id: Number(result.insertId), map_key: bundle.map_key,
    revision: bundle.revision, route_count: bundle.routes.length, label_count: bundle.labels.length,
  });
}

export async function getLatestTransportMap(req, res) {
  const [rows] = await pool.query(
    "SELECT id, bundle_json, created_at FROM transport_map_publications WHERE map_key=? ORDER BY id DESC LIMIT 1",
    [String(req.params.mapKey || "")]
  );
  if (!rows.length) return res.status(404).json({ error: "transport map not published" });
  res.set("Cache-Control", "public, max-age=300");
  return res.json({ publication_id: Number(rows[0].id), published_at: rows[0].created_at, bundle: JSON.parse(rows[0].bundle_json) });
}
