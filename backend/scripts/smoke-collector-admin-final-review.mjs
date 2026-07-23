// Runtime-only, self-cleaning HTTP smoke for the Collector -> review-content final-review path.
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COLLECTOR_DIR = path.join(ROOT, "collector");
const { openDatabase } = await import(new URL("../../collector/db/client.mjs", import.meta.url));
const { createRepository } = await import(new URL("../../collector/db/repository.mjs", import.meta.url));
const { getCurrentTranslationSourceFingerprint } = await import(new URL("../../collector/services/workflow.mjs", import.meta.url));
const COLLECTOR_SCHEMA = path.join(COLLECTOR_DIR, "database/schema.sql");

const BACKEND_BASE_URL = String(process.env.BACKEND_FINAL_REVIEW_SMOKE_BASE_URL || process.env.BACKEND_PUBLIC_URL || "http://127.0.0.1:5000").replace(/\/+$/, "") + "/api";
const JWT_SECRET = String(process.env.JWT_SECRET || process.env.BACKEND_JWT_SECRET || "").trim();
const COLLECTOR_PORT = Number(process.env.BACKEND_FINAL_REVIEW_SMOKE_COLLECTOR_PORT || 5698);
const COLLECTOR_BASE_URL = String(process.env.COLLECTOR_PUBLIC_BASE_URL || `http://127.0.0.1:${COLLECTOR_PORT}`).replace(/\/+$/, "");
const DB_CONFIG = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 2 };
const FIXTURE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmJ0AAAAASUVORK5CYII=", "base64");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-final-review-smoke-"));
const collectorDbPath = path.join(tempDir, "collector.db");
const fixturePrefix = `final-review-smoke-${Date.now()}`;
let collectorProcess = null;
let pool = null;

function assertOk(value, message) { assert.ok(value, message); }
function collectorToken() { return jwt.sign({ id: 1, email: "final-review-smoke@local.test", role: "owner" }, JWT_SECRET, { issuer: process.env.JWT_ISSUER || "uboncity-backend", audience: "uboncity-collector", expiresIn: "10m" }); }
function backendToken() { return jwt.sign({ id: 1, email: "final-review-smoke@local.test", role: "owner" }, JWT_SECRET, { issuer: process.env.JWT_ISSUER || "uboncity-backend", audience: process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend", expiresIn: "10m" }); }
function auth(token, json = true) { return { authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) }; }
async function http(url, options = {}) { const response = await fetch(url, options); const payload = await response.json().catch(() => ({})); return { response, payload }; }
async function waitFor(url) { for (let i = 0; i < 80; i += 1) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error(`health timeout: ${url}`); }
function stopCollector() { if (collectorProcess?.pid) spawnSync("taskkill", ["/PID", String(collectorProcess.pid), "/T", "/F"], { stdio: "ignore" }); collectorProcess = null; }
async function assertBackendHealthy() {
  try {
    const result = await http(`${BACKEND_BASE_URL}/health`);
    assertOk(result.response.ok && result.payload?.ok === true, `backend health endpoint returned ${result.response.status}`);
  } catch (error) {
    throw new Error(`backend is required at ${BACKEND_BASE_URL}; start it before this smoke (${String(error?.message || error)})`);
  }
}
async function cleanupPublishedMediaArtifacts(entityType, entityIds = []) {
  const ids = [...new Set(entityIds.map((id) => Number(id || 0)).filter(Boolean))];
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const [assetRows] = await pool.query(
    `SELECT DISTINCT ma.id, ma.storage_path, ma.file_name
     FROM media_assets ma
     LEFT JOIN content_image_usages ciu ON ciu.asset_id=ma.id
     WHERE (ciu.entity_type=? AND ciu.entity_id IN (${placeholders}))
        OR (ma.related_type=? AND ma.related_id IN (${placeholders}))`,
    [entityType, ...ids, entityType, ...ids]
  );
  await pool.query(`DELETE FROM content_image_usages WHERE entity_type=? AND entity_id IN (${placeholders})`, [entityType, ...ids]);
  const assetIds = [...new Set(assetRows.map((row) => Number(row?.id || 0)).filter(Boolean))];
  if (assetIds.length) await pool.query(`DELETE FROM media_assets WHERE id IN (${assetIds.map(() => "?").join(",")})`, assetIds);
  for (const row of assetRows) {
    const storagePath = String(row?.storage_path || "").trim().replace(/\\/g, "/");
    const diskPath = storagePath.startsWith("uploads/") ? path.join(process.cwd(), storagePath) : path.join(process.cwd(), "uploads", String(row?.file_name || "").trim());
    if (!diskPath) continue;
    try { await fsp.unlink(diskPath); } catch {}
  }
}

function withRepo(fn) { const db = openDatabase(collectorDbPath, COLLECTOR_SCHEMA); try { return fn(createRepository(db), db); } finally { db.close(); } }
function translationLangs(fixture, version) { return fixture[version].translation_langs; }
function prepareFixture(fixture, version) {
  withRepo((repo, db) => {
    if (!fixture.itemId) {
      const item = repo.createItemWithWorkflowHead({ type: fixture.type, category: fixture.type === "event" ? "events" : "attractions", lang: "th", title: fixture.v1.title, slug: fixture.slug, description_raw: fixture.v1.body, description_clean: fixture.v1.body, summary: fixture.v1.excerpt, meta_title: fixture.v1.title, meta_description: fixture.v1.meta_description, source_type: "manual", source_name: "final review smoke", source_url: "https://example.test/final-review-smoke" }, { production_state: "ready_for_publish", publication_state: "approved" }, "final-review-smoke@local.test", { actor_role: "owner", reason_code: "smoke_fixture" }).item;
      fixture.itemId = Number(item.id);
      const mediaDir = path.join(tempDir, "media", "uploads"); fs.mkdirSync(mediaDir, { recursive: true });
      for (const name of [fixture.coverV1, fixture.coverV2]) fs.writeFileSync(path.join(mediaDir, name), FIXTURE_PNG);
      for (const [name, cover] of [[fixture.coverV1, 1], [fixture.coverV2, 0]]) {
        const asset = db.prepare("INSERT INTO assets(asset_uid,storage_disk,storage_path,file_name,mime_type,size_bytes,checksum) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(), "local", `uploads/${name}`, name, "image/png", FIXTURE_PNG.length, crypto.createHash("sha256").update(name).digest("hex"));
        db.prepare("INSERT INTO content_assets(content_item_id,asset_id,role,selected_in_clean,is_cover,placement_type,sort_order) VALUES(?,?,?,1,?,?,?)").run(fixture.itemId, Number(asset.lastInsertRowid), cover ? "cover" : "gallery", cover, cover ? "cover" : "gallery", cover ? 0 : 1);
      }
    }
    const content = fixture[version];
    const item = repo.getItem(fixture.itemId);
    const draft = repo.saveDraft(fixture.itemId, `smoke-${fixture.key}-${version}`, { draft_title: content.title, excerpt: content.excerpt, body: content.body, meta_title: content.meta_title, meta_description: content.meta_description, status: "generated" });
    const review = repo.addReviewReport(fixture.itemId, draft.id, { status: "approved", total_score: 100, issues: [] });
    repo.upsertWorkflowModel(fixture.itemId, { production_state: "ready_for_publish", publication_state: "approved", current_draft_id: draft.id, current_review_report_id: review.id }, "final-review-smoke@local.test", { actor_role: "owner", reason_code: "smoke_prepare", skip_production_transition_validation: true, skip_publication_transition_validation: true });
    db.prepare("DELETE FROM content_translations WHERE source_content_item_id=?").run(fixture.itemId);
    const fingerprint = getCurrentTranslationSourceFingerprint(repo, fixture.itemId);
    for (const lang of translationLangs(fixture, version)) { const label = lang.toUpperCase(); repo.upsertTranslation({ source_content_item_id: fixture.itemId, source_published_article_id: null, source_draft_id: draft.id, source_review_report_id: review.id, source_fingerprint: fingerprint, lang, translated_title: `${content.title} ${label}`, translated_excerpt: `${content.excerpt} ${label}`, translated_body: `<p>${content.body} ${label}</p>`, translated_meta_title: `${content.title} ${label}`, translated_meta_description: `${content.meta_description} ${label}`, translation_status: "ready", automatic_check_status: "passed", translation_recheck_status: "passed", translation_recheck_score: 100, rechecked_at: new Date().toISOString() }); }
  });
}

// Required between every submit: submit-admin-review transitions this workflow to submitted_for_admin_review.
// Coverage boundary: this smoke exercises only the multipart path of
// POST /api/items/:id/submit-admin-review. reviewIngestService's
// mirrorImageToBackendStorage still has direct-JSON /review-content/ingest and
// /review-content/event-queue/enqueue callers; this smoke does not cover them.
function resetWorkflowOnly(itemId) { withRepo((repo) => { const model = repo.ensureWorkflowModel(itemId); repo.upsertWorkflowModel(itemId, { production_state: "ready_for_publish", publication_state: "approved", current_draft_id: model.current_draft_id, current_review_report_id: model.current_review_report_id }, "final-review-smoke@local.test", { actor_role: "owner", reason_code: "smoke_reset", skip_production_transition_validation: true, skip_publication_transition_validation: true }); }); }
async function submitAdminReview(fixture, version, prepare = true) {
  if (prepare) prepareFixture(fixture, version);
  resetWorkflowOnly(fixture.itemId);
  const result = await http(`${COLLECTOR_BASE_URL}/api/items/${fixture.itemId}/submit-admin-review`, { method: "POST", headers: auth(collectorToken()), body: "{}" });
  assertOk(result.response.ok, `${fixture.key} ${version} submit-admin-review failed: ${JSON.stringify(result.payload)}`); // old rows 1/26/49/63/74/83/91/99; 18 and 21
  const id = Number(result.payload?.backend_ingest?.result?.item?.id || 0);
  assertOk(id > 0, `${fixture.key} ${version} review content id missing`); // old rows 19 and 22
  return id;
}
async function reviewQueue() { const result = await http(`${BACKEND_BASE_URL}/collector-import-reviews?status=all`, { headers: auth(backendToken(), false) }); assertOk(result.response.ok, `review queue failed: ${JSON.stringify(result.payload)}`); return result.payload?.items || []; }
async function detail(id) { const result = await http(`${BACKEND_BASE_URL}/review-content/${id}`, { headers: auth(backendToken(), false) }); assertOk(result.response.ok, `review detail failed: ${JSON.stringify(result.payload)}`); return result.payload?.item || result.payload; }
async function decide(id, action) { const result = await http(`${BACKEND_BASE_URL}/review-content/${id}/${action}`, { method: "POST", headers: auth(backendToken()), body: JSON.stringify({ review_note: `smoke ${action}` }) }); assertOk(result.response.ok, `${action} failed: ${JSON.stringify(result.payload)}`); return result.payload; }
async function publicList(fixture, lang = "th") { const result = await http(`${BACKEND_BASE_URL}/${fixture.type === "event" ? "events" : "places"}?category=${fixture.type === "event" ? "events" : "attractions"}&lang=${encodeURIComponent(lang)}`); assertOk(result.response.ok, `public list failed: ${JSON.stringify(result.payload)}`); return result.payload?.items || []; }
async function assertPublicTranslation(fixture, lang, expectedTitle) { const entry = (await publicList(fixture, lang)).find((item) => item.slug === fixture.slug); assertOk(entry, `${fixture.key}: public ${lang} entry missing`); assert.equal(entry.title, expectedTitle, `${fixture.key}: public ${lang} title`); }
async function startCollector(langs) {
  stopCollector();
  collectorProcess = spawn(process.execPath, ["server/index.mjs"], { cwd: COLLECTOR_DIR, env: { ...process.env, PORT: String(COLLECTOR_PORT), DB_PATH: collectorDbPath, RAW_DIR: path.join(tempDir, "raw"), MEDIA_DIR: path.join(tempDir, "media"), STAGING_DIR: path.join(tempDir, "staging"), EXPORT_DIR: path.join(tempDir, "staging"), COLLECTOR_SYNC_BACKEND_API: BACKEND_BASE_URL, COLLECTOR_PUBLIC_BASE_URL: COLLECTOR_BASE_URL, COLLECTOR_REVIEW_SYNC_TOKEN: process.env.COLLECTOR_REVIEW_SYNC_TOKEN, TRANSLATION_TARGET_LANGS: langs.join(",") }, stdio: "ignore" });
  await waitFor(`${COLLECTOR_BASE_URL}/api/health`);
}
async function expectDetail(item, fixture, version) {
  const expected = fixture[version];
  assertOk(item && typeof item === "object", `${fixture.key} ${version}: detail item missing`); // old row 5
  assert.equal(item.title, expected.title, `${fixture.key} ${version}: title`); // 6
  assert.equal(item.body, expected.body, `${fixture.key} ${version}: body`); // 7
  assert.equal(item.meta_title, expected.meta_title, `${fixture.key} ${version}: meta_title`); // 8
  assert.equal(item.meta_description, expected.meta_description, `${fixture.key} ${version}: meta_description`); // 9
  assertOk(Number(item.source_content_item_id) > 0, `${fixture.key} ${version}: source id missing`); // 20
  const asset = item.assets?.cover || item.assets?.gallery?.[0] || item.assets?.inline?.[0];
  assertOk(asset?.url, `${fixture.key} ${version}: media url missing`); // 10
  assert.notEqual(asset.url, `${COLLECTOR_BASE_URL}/uploads/${version === "v1" ? fixture.coverV1 : fixture.coverV2}`, `${fixture.key} ${version}: source media leaked`); // 11
  if (/^https?:/i.test(asset.url)) assert.equal(new URL(asset.url).origin, new URL(BACKEND_BASE_URL).origin, `${fixture.key} ${version}: asset origin`); // 12
  const assetUrl = new URL(asset.url, BACKEND_BASE_URL).toString();
  assertOk(new URL(assetUrl).pathname.includes("/uploads/"), `${fixture.key} ${version}: asset upload path`); // 13
  const fetched = await fetch(assetUrl); assertOk(fetched.ok, `${fixture.key} ${version}: asset fetch`); // 14
  assertOk(String(fetched.headers.get("content-type") || "").startsWith("image/"), `${fixture.key} ${version}: asset mime`); // 15
  if (fixture.type === "place") { assert.equal(item.slug, fixture.slug, `${fixture.key} ${version}: slug`); assert.equal(item.category, "attractions", `${fixture.key} ${version}: category`); } // 16/17
}
function assertHistory(item, previousStatus) { assertOk((item.history || []).some((row) => row.action_type === "reingested" && row.previous_status === previousStatus && row.next_status === "pending_review"), `missing reingested from ${previousStatus}`); }

export async function runCollectorAdminFinalReviewSmoke() {
  assertOk(JWT_SECRET, "JWT_SECRET is required"); assertOk(DB_CONFIG.user && DB_CONFIG.database, "DB_USER and DB_NAME are required");
  pool = mysql.createPool(DB_CONFIG);
  const runId = `${Date.now()}`;
  const fixtures = ["approve", "reject", "eventApprove", "eventReject"].map((key, index) => {
    const type = key.startsWith("event") ? "event" : "place"; const label = `${key}-${runId}`;
    return { key, type, itemId: 0, slug: `final-review-${label}`, coverV1: `${label}-v1.png`, coverV2: `${label}-v2.png`, v1: { title: `${label} V1`, body: `<p>${label} body V1</p>`, excerpt: `${label} excerpt V1`, meta_title: `${label} meta V1`, meta_description: `${label} description V1`, translation_langs: ["en", "lo"] }, v2: { title: `${label} V2`, body: `<p>${label} body V2</p>`, excerpt: `${label} excerpt V2`, meta_title: `${label} meta V2`, meta_description: `${label} description V2`, translation_langs: ["en"] } };
  });
  const [approve, reject, eventApprove, eventReject] = fixtures;
  try {
    await assertBackendHealthy();
    await startCollector(translationLangs(approve, "v1"));
    const ids = {};
    // Retired old rows 4/29/52/66/78/87/95/103: queue-detail rejects synthetic negative IDs.
    // Their detail coverage is ported below through GET /review-content/:id.
    for (const fixture of fixtures) { ids[fixture.key] = await submitAdminReview(fixture, "v1"); const queue = await reviewQueue(); const row = queue.find((entry) => Number(entry.source_content_item_id) === fixture.itemId); assertOk(row && Number(row.id) === -ids[fixture.key] && row.review_status === "pending", `${fixture.key}: pending synthetic queue visibility`); await expectDetail(await detail(ids[fixture.key]), fixture, "v1"); }
    // N1/N2: public visibility before approval; new review-content entities must not exist publicly.
    for (const fixture of fixtures) { const items = await publicList(fixture); assertOk(!items.some((entry) => entry.slug === fixture.slug), `${fixture.key}: public before approve`); }
    await decide(ids.approve, "approve"); await decide(ids.eventApprove, "approve"); await decide(ids.reject, "reject"); await decide(ids.eventReject, "reject");
    for (const fixture of [approve, eventApprove]) { const queue = await reviewQueue(); assertOk(queue.some((entry) => Number(entry.source_content_item_id) === fixture.itemId && entry.review_status === "approved"), `${fixture.key}: approved queue status`); }
    for (const fixture of [reject, eventReject]) { const queue = await reviewQueue(); assertOk(queue.some((entry) => Number(entry.source_content_item_id) === fixture.itemId && entry.review_status === "rejected"), `${fixture.key}: rejected queue status`); }
    // N3/N4: public list stays HTTP-only and confirms visibility only after RDEC approve.
    const v1PublicEntityIds = {};
    for (const fixture of [approve, eventApprove]) { const items = await publicList(fixture); assertOk(items.some((entry) => entry.slug === fixture.slug), `${fixture.key}: public after approve`); const item = await detail(ids[fixture.key]); v1PublicEntityIds[fixture.key] = Number(item.public_entity_id || 0); assertOk(v1PublicEntityIds[fixture.key] > 0, `${fixture.key}: V1 public entity id missing`); await assertPublicTranslation(fixture, "th", fixture.v1.title); await assertPublicTranslation(fixture, "en", `${fixture.v1.title} EN`); await assertPublicTranslation(fixture, "lo", `${fixture.v1.title} LO`); }
    await startCollector(translationLangs(approve, "v2"));
    for (const fixture of fixtures) { ids[fixture.key] = await submitAdminReview(fixture, "v2"); const queue = await reviewQueue(); assertOk(queue.some((entry) => Number(entry.source_content_item_id) === fixture.itemId && Number(entry.id) === -ids[fixture.key] && entry.review_status === "pending"), `${fixture.key}: V2 pending synthetic queue`); const item = await detail(ids[fixture.key]); await expectDetail(item, fixture, "v2"); assertHistory(item, fixture === approve || fixture === eventApprove ? "published" : "rejected"); }
    for (const fixture of [approve, eventApprove]) { await decide(ids[fixture.key], "approve"); const item = await detail(ids[fixture.key]); assert.equal(Number(item.public_entity_id || 0), v1PublicEntityIds[fixture.key], `${fixture.key}: V2 public entity identity`); await assertPublicTranslation(fixture, "th", fixture.v2.title); await assertPublicTranslation(fixture, "en", `${fixture.v2.title} EN`); await assertPublicTranslation(fixture, "lo", fixture.v2.title); }
    // Retired old rows 75/84/92/100: lifecycle review_resets counter no longer exists; history checks above are the user-visible revision proof.
    // Retired old rows 108-117: collector_import_reviews search belonged only to the deleted lifecycle queue table.
    // Accepted loss: old other-transport row 8 PATCH /places/:id/approve is a retained dead-endpoint candidate, not review-content coverage.
    return { ok: true, scope: "collector-backend-admin-final-review", assertions: ["ported legacy rows 1-107 except retired lifecycle-only rows", "N1-N4 public visibility arc"], fixture_ids: Object.fromEntries(fixtures.map((fixture) => [fixture.key, { item_id: fixture.itemId, review_content_id: ids[fixture.key] }])) };
  } finally {
    stopCollector();
    try {
      // Cleanup is fixture teardown only; smoke assertions above use HTTP exclusively. Translations precede entities for FK safety.
      for (const fixture of fixtures) { const [rows] = await pool.query("SELECT id, public_entity_type, public_entity_id FROM review_contents WHERE source_system='collector-app' AND source_content_item_id=?", [fixture.itemId]); for (const row of rows) { if (row.public_entity_type === "place" && row.public_entity_id) { await pool.query("DELETE FROM place_translations WHERE place_id=?", [row.public_entity_id]); await cleanupPublishedMediaArtifacts("place", [row.public_entity_id]); await pool.query("DELETE FROM places WHERE id=?", [row.public_entity_id]); } if (row.public_entity_type === "event" && row.public_entity_id) { await pool.query("DELETE FROM event_translations WHERE event_id=?", [row.public_entity_id]); await cleanupPublishedMediaArtifacts("event", [row.public_entity_id]); await pool.query("DELETE FROM events WHERE id=?", [row.public_entity_id]); } } await pool.query("DELETE FROM review_contents WHERE source_system='collector-app' AND source_content_item_id=?", [fixture.itemId]); }
    } finally { if (pool) { await pool.end(); pool = null; } await fsp.rm(tempDir, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCollectorAdminFinalReviewSmoke().then((result) => console.log(JSON.stringify(result, null, 2))).catch(async (error) => { try { if (pool) await pool.end(); } finally { stopCollector(); await fsp.rm(tempDir, { recursive: true, force: true }); } console.error(error); process.exitCode = 1; });
