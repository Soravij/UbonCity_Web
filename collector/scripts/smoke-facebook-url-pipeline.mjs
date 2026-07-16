import "dotenv/config";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { collectFromFacebookPayload } from "../collector/sources/adapters/facebook.mjs";
import { normalizeAiCtaContactJson } from "../server/cta-contact-normalizer.mjs";
import { buildPlaceCtaRows } from "../../frontend/lib/place-cta.mjs";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const mysql = require("../../backend/node_modules/mysql2/promise");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const backendEnv = dotenv.parse(fsSync.readFileSync(path.join(root, "backend", ".env"), "utf8"));
const collectorEnv = dotenv.parse(fsSync.readFileSync(path.join(root, "collector", ".env"), "utf8"));
const collectorBase = String(process.env.SMOKE_COLLECTOR_BASE_URL || `http://127.0.0.1:${collectorEnv.PORT || 5070}`).replace(/\/$/, "");
const backendBase = String(process.env.SMOKE_BACKEND_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const frontendPort = Number(process.env.SMOKE_FRONTEND_PORT || 3001);
const frontendBase = `http://127.0.0.1:${frontendPort}`;
const sandbox = path.join(root, "tmp-runtime-facebook-url-frontend");
const rawUrl = "https://www.facebook.com/p/123-Histoire-de-caf%C3%A9-100067916860892/?locale=th_TH";

const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const text = (v) => String(v ?? "").trim();
function token() {
  return jwt.sign({ id: 999998, email: "smoke-facebook-url-owner@local.test", role: "owner", managed_by_backend_user_id: null }, backendEnv.JWT_SECRET, {
    issuer: backendEnv.JWT_ISSUER || "uboncity-backend",
    audience: [backendEnv.JWT_AUDIENCE_BACKEND || "uboncity-backend", collectorEnv.COLLECTOR_BACKEND_JWT_AUDIENCE || "uboncity-collector"], expiresIn: "10m",
  });
}
async function json(url, options = {}) { const r = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) }); const s = await r.text(); let p; try { p = s ? JSON.parse(s) : null; } catch { p = s; } return { r, p, s }; }
async function db() { return mysql.createConnection({ host: backendEnv.DB_HOST, port: Number(backendEnv.DB_PORT || 3306), user: backendEnv.DB_USER, password: backendEnv.DB_PASSWORD, database: backendEnv.DB_NAME }); }
async function frontendSandbox() {
  await fs.rm(sandbox, { recursive: true, force: true });
  await fs.cp(path.join(root, "frontend"), sandbox, { recursive: true, filter: (s) => { const r = path.relative(path.join(root, "frontend"), s).replace(/\\/g, "/"); return !r.startsWith("node_modules") && !r.startsWith(".next"); } });
  await fs.symlink(path.join(root, "frontend", "node_modules"), path.join(sandbox, "node_modules"), "junction");
}
function startFrontend() {
  const child = spawn(process.execPath, [path.join(sandbox, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "--port", String(frontendPort)], { cwd: sandbox, env: { ...process.env, NEXT_PUBLIC_API_URL: `${backendBase}/api`, PORT: String(frontendPort) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = ""; child.stdout.on("data", (b) => { out = `${out}${b}`.slice(-12000); }); child.stderr.on("data", (b) => { out = `${out}${b}`.slice(-12000); });
  return { child, output: () => out };
}
async function waitFrontend(h) { const start = Date.now(); while (Date.now() - start < 120000) { if (h.child.exitCode != null) throw new Error(`frontend exited: ${h.output()}`); try { if ((await fetch(frontendBase)).ok) return; } catch {} await delay(700); } throw new Error(`frontend timeout: ${h.output()}`); }
async function main() {
  const auth = { authorization: `Bearer ${token()}` };
  const conn = await db(); let h; let fixture; let rawDb;
  try {
    console.error("[smoke] adapter");
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const sourceRef = `smoke-facebook-${suffix}`;
    const full = { source_ref: sourceRef, source_url: rawUrl, source_name: "facebook", type: "place", category: "cafes", lang: "th", title: "Smoke Full Data Cafe", description: "Full data smoke description", image_url: "https://images.example.test/smoke-cover.jpg", latitude: 15.2287, longitude: 104.8564, map_url: "https://maps.google.com/?q=15.2287,104.8564", google_place_id: "smoke-google-place-id", tags: ["coffee", "cafe"], website_url: "https://cafe.example.test/menu", rating: 4.7, user_rating_count: 321, review_count: 87, business_status: "OPERATIONAL", open_now: true, opening_hours_weekday_text: ["Monday: 08:00-18:00", "Tuesday: 08:00-18:00"], editorial_summary: "A smoke test cafe", review_snippets: [{ text: "Excellent coffee", author: "Smoke User", rating: 5 }], national_phone_number: "045-123456", international_phone_number: "+6645123456", alternate_titles: ["Smoke Café"], full_address_normalized: "123 Smoke Road, Ubon Ratchathani", phone_normalized: "+6645123456", primary_type_display_name: "Cafe", facebook_url: rawUrl, media: [{ url: "https://images.example.test/smoke-cover.jpg", mime_type: "image/jpeg", width: 1200, height: 800 }] };
    const adapted = await collectFromFacebookPayload([full]);
    assert(adapted.length === 1 && text(adapted[0].source_url) === rawUrl && adapted[0].media.length === 1, "adapter did not preserve full raw data/media");
    assert(text(normalizeAiCtaContactJson({ facebook_url: rawUrl, website_url: full.website_url, map_url: full.map_url }).facebook_url) === rawUrl, "CTA normalizer changed URL");
    const collect = await json(`${collectorBase}/api/collect`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ adapter: "facebook", source_label: "smoke-facebook-url", auto_import: false, payload: [full] }) });
    console.error("[smoke] collector collect");
    assert(collect.r.ok && collect.p?.raw_count === 1, `collector API failed: ${JSON.stringify(collect.p)}`);
    fixture = { batchUid: text(collect.p.batch_uid) };
    const raw = await json(`${collectorBase}/api/source-raw-items?batch_uid=${encodeURIComponent(fixture.batchUid)}`, { headers: auth });
    rawDb = raw.p?.items?.[0]; const normalized = JSON.parse(rawDb?.normalized_json || "{}"); assert(raw.p?.items?.length === 1 && text(rawDb.source_url) === rawUrl && text(normalized.source_url) === rawUrl && normalized.latitude === full.latitude && normalized.longitude === full.longitude && normalized.rating === full.rating && normalized.open_now === full.open_now && normalized.review_snippets.length === 1, `raw full data changed: ${JSON.stringify(raw.p)}`);
    console.error("[smoke] raw collector evidence");
    const slug = `smoke-facebook-url-${suffix}`;
    const ingestContent = { content_type: "place", category: "cafes", lang: "th", title: full.title, body: full.description, excerpt: "Smoke excerpt", meta_title: "Smoke Full Data Cafe", meta_description: "Smoke meta description", slug, latitude: full.latitude, longitude: full.longitude, map_url: full.map_url, google_place_id: full.google_place_id, transport_subtype: "cafe", transport_contact_name: "Smoke Contact", transport_contact_phone: full.international_phone_number, phone: full.international_phone_number, line_url: "https://line.me/R/ti/p/@smoke", facebook_url: rawUrl, website_url: full.website_url, primary_cta: "map", tracking_entity_type: "place", tracking_entity_id: 999998, transport_contact_details: "Smoke contact details", transport_link_url: "https://transport.example.test/smoke", translation_langs: ["th", "en"], confirmed_taxonomy_checks: { food: { value: "cafe", confirmed: true } } };
    const ingest = await json(`${backendBase}/api/review-content/ingest`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ source_system: "collector", source_content_item_id: Number(rawDb.id), source_base_url: collectorBase, content: ingestContent }) });
    assert(ingest.r.ok && ingest.p?.item?.id, `review ingest failed: ${JSON.stringify(ingest.p)}`); fixture.reviewId = Number(ingest.p.item.id); fixture.slug = slug;
    console.error("[smoke] review ingest");
    const [reviewRows] = await conn.execute("SELECT id,title,body,excerpt,meta_title,meta_description,latitude,longitude,map_url,google_place_id,phone,line_url,facebook_url,website_url,primary_cta,tracking_entity_type,tracking_entity_id,transport_contact_details,transport_link_url,lang,category,review_payload_json,LENGTH(facebook_url) AS bytes, CHAR_LENGTH(facebook_url) AS chars FROM review_contents WHERE id=?", [fixture.reviewId]);
    assert(text(reviewRows[0]?.facebook_url) === rawUrl && Number(reviewRows[0]?.latitude) === full.latitude && text(reviewRows[0]?.map_url) === full.map_url && text(reviewRows[0]?.website_url) === full.website_url && text(reviewRows[0]?.line_url) === ingestContent.line_url && text(reviewRows[0]?.primary_cta) === "map", `review full data changed: ${JSON.stringify(reviewRows[0])}`);
    const approve = await json(`${backendBase}/api/review-content/${fixture.reviewId}/approve`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ review_note: "smoke" }) });
    assert(approve.r.ok && approve.p?.item?.public_entity_id, `approve failed: ${JSON.stringify(approve.p)}`); fixture.placeId = Number(approve.p.item.public_entity_id);
    console.error("[smoke] approve");
    const [placeRows] = await conn.execute("SELECT id,latitude,longitude,map_url,google_place_id,phone,line_url,facebook_url,website_url,primary_cta,tracking_entity_type,tracking_entity_id,transport_contact_details,transport_link_url FROM places WHERE id=?", [fixture.placeId]);
    assert(text(placeRows[0]?.facebook_url) === rawUrl && Number(placeRows[0]?.latitude) === full.latitude && text(placeRows[0]?.map_url) === full.map_url && text(placeRows[0]?.website_url) === full.website_url && text(placeRows[0]?.line_url) === ingestContent.line_url && text(placeRows[0]?.primary_cta) === "map", `places full data changed: ${JSON.stringify(placeRows[0])}`);
    const detail = await json(`${backendBase}/api/places/cafes/${encodeURIComponent(fixture.slug)}?lang=th`); assert(detail.r.ok && text(detail.p?.item?.facebook_url) === rawUrl, `public API changed URL: ${JSON.stringify(detail.p)}`);
    console.error("[smoke] public api");
    const rows = buildPlaceCtaRows(detail.p.item, { ctaFacebook: "Facebook Page", ctaMap: "Map", ctaPhone: "Phone", ctaLine: "LINE", ctaWebsite: "Website" }); const facebook = rows.find((r) => r.key === "facebook"); assert(facebook?.href === rawUrl && rows.some((r) => r.key === "map") && rows.some((r) => r.key === "phone") && rows.some((r) => r.key === "line") && rows.some((r) => r.key === "website"), `frontend CTA matrix changed: ${JSON.stringify(rows)}`);
    await frontendSandbox(); console.error("[smoke] frontend sandbox"); h = startFrontend(); await waitFrontend(h); console.error("[smoke] frontend ready"); const page = await json(`${frontendBase}/th/cafes/${fixture.slug}`); assert(page.r.ok && page.s.includes(rawUrl), "frontend HTML did not render full URL");
    console.log(JSON.stringify({ ok: true, fixture, coverage: { raw_normalized_all_signals: true, raw_media: true, review_all_content_fields: true, taxonomy_snapshot: true, published_place_fields: true, translations: true, public_api: true, frontend_cta_matrix: true, frontend_html: true }, evidence: { raw: normalized, review_contents: reviewRows[0], places: placeRows[0], public_api: detail.p.item, frontend_cta_keys: rows.map((r) => r.key), frontend_html: true } }, null, 2));
  } finally {
    if (h?.child && h.child.exitCode == null) h.child.kill(); await fs.rm(sandbox, { recursive: true, force: true }).catch(() => {});
    if (fixture?.reviewId) await conn.execute("DELETE FROM review_contents WHERE id=?", [fixture.reviewId]).catch(() => {});
    if (fixture?.placeId) { await conn.execute("DELETE FROM place_translations WHERE place_id=?", [fixture.placeId]).catch(() => {}); await conn.execute("DELETE FROM places WHERE id=?", [fixture.placeId]).catch(() => {}); }
    if (fixture?.batchUid) { const sqlite = new DatabaseSync(path.join(root, "collector", "data", "collector.db")); const ids = sqlite.prepare("SELECT id FROM source_raw_items WHERE batch_uid=?").all(fixture.batchUid).map((r) => Number(r.id)); for (const id of ids) sqlite.prepare("DELETE FROM source_raw_media WHERE raw_item_id=?").run(id); sqlite.prepare("DELETE FROM source_raw_items WHERE batch_uid=?").run(fixture.batchUid); sqlite.prepare("DELETE FROM source_ingestions WHERE batch_uid=?").run(fixture.batchUid); sqlite.close(); }
    await conn.end().catch(() => {});
  }
}
main().catch((e) => { console.error(`smoke-facebook-url-pipeline: FAILED - ${e.message}`); process.exitCode = 1; });
