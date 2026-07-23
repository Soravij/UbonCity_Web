// Runtime-only, self-cleaning E2E harness for translation promotion.
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "../..");
const { openDatabase } = await import(new URL("../../collector/db/client.mjs", import.meta.url));
const { createRepository } = await import(new URL("../../collector/db/repository.mjs", import.meta.url));
const { getCurrentTranslationSourceFingerprint } = await import(new URL("../../collector/services/workflow.mjs", import.meta.url));
const schema = path.join(root, "collector/database/schema.sql");
const require = createRequire(path.join(root, "collector/package.json"));
const collectorJwt = require("jsonwebtoken");
const backendBase = String(process.env.BACKEND_PUBLIC_URL || "http://127.0.0.1:5000").replace(/\/+$/, "") + "/api";
const secret = String(process.env.JWT_SECRET || process.env.BACKEND_JWT_SECRET || "");
const fixtureId = Number(`77${Date.now().toString().slice(-10)}`);
const collectorPort = 5699;
const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 2 });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-promote-translations-"));
let child = null; let itemId = 0; const report = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function must(x, m) { assert.ok(x, m); }
function token() { return collectorJwt.sign({ id: 1, email: "runtime-harness@local.test", role: "owner" }, secret, { issuer: process.env.JWT_ISSUER || "uboncity-backend", audience: "uboncity-collector", expiresIn: "10m" }); }
function stop() { if (child?.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); child = null; }
function prepare(version, langs, { reuseEditorial = false } = {}) {
  const db = openDatabase(path.join(temp, "collector.db"), schema);
  try {
    const repo = createRepository(db);
    if (!itemId) {
      db.prepare("INSERT OR REPLACE INTO sqlite_sequence(name,seq) VALUES('content_items',?)").run(fixtureId - 1);
      const item = repo.createItemWithWorkflowHead({ type: "place", category: "attractions", lang: "th", title: `Runtime promotion ${fixtureId}`, slug: `runtime-promotion-${fixtureId}`, description_raw: "<p>TH <img src=\"/uploads/inline.png\"></p>", description_clean: "<p>TH <img src=\"/uploads/inline.png\"></p>", summary: "runtime summary", meta_title: "runtime meta", meta_description: "runtime desc", source_type: "manual", source_name: "runtime", source_url: "https://example.test" }, { production_state: "ready_for_publish", publication_state: "approved" }, "owner@local", { actor_role: "owner", reason_code: "runtime_harness" }).item;
      itemId = Number(item.id);
      const uploads = path.join(temp, "media/uploads"); fs.mkdirSync(uploads, { recursive: true }); fs.writeFileSync(path.join(uploads, "cover.jpg"), "cover"); fs.writeFileSync(path.join(uploads, "inline.png"), "inline");
      for (const [role, name, cover] of [["cover", "cover.jpg", 1], ["inline", "inline.png", 0]]) { const a = db.prepare("INSERT INTO assets(asset_uid,storage_disk,storage_path,file_name,mime_type,size_bytes,checksum) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(), "local", `uploads/${name}`, name, "image/png", 6, crypto.createHash("sha256").update(name).digest("hex")); db.prepare("INSERT INTO content_assets(content_item_id,asset_id,role,selected_in_clean,is_cover,placement_type,sort_order) VALUES(?,?,?,1,?,?,?)").run(itemId, Number(a.lastInsertRowid), role, cover, role, cover ? 0 : 1); }
    }
    const item = repo.getItem(itemId); const body = `<p>TH ${version} <img src="/uploads/inline.png"></p>`;
    const existingDraft = reuseEditorial ? repo.latestDraftByItem(itemId) : null;
    const existingReview = reuseEditorial ? repo.latestApprovedReviewByItem(itemId) : null;
    const draft = existingDraft || repo.saveDraft(itemId, `runtime-${version}`, { draft_title: item.title, excerpt: "runtime summary", body, meta_title: "runtime meta", meta_description: "runtime desc", status: "generated" });
    const reviewId = Number(existingReview?.id || 0) || repo.addReviewReport(itemId, draft.id, { status: "approved", total_score: 100, issues: [] });
    repo.upsertWorkflowModel(itemId, { production_state: "ready_for_publish", publication_state: "approved", current_draft_id: draft.id, current_review_report_id: reviewId }, "owner@local", { actor_role: "owner", reason_code: "runtime_harness", skip_production_transition_validation: true, skip_publication_transition_validation: true });
    db.prepare("DELETE FROM content_translations WHERE source_content_item_id=?").run(itemId);
    const fp = getCurrentTranslationSourceFingerprint(repo, itemId);
    for (const lang of langs) repo.upsertTranslation({ source_content_item_id: itemId, source_published_article_id: null, source_draft_id: draft.id, source_review_report_id: reviewId, source_fingerprint: fp, lang, translated_title: `${lang} ${version}`, translated_excerpt: `${lang} excerpt`, translated_body: `<p>${lang} ${version} <img src="/uploads/inline.png"></p>`, translated_meta_title: `${lang} meta`, translated_meta_description: `${lang} desc`, translation_status: "ready", automatic_check_status: "passed", translation_recheck_status: "passed", translation_recheck_score: 100, rechecked_at: new Date().toISOString() });
  } finally { db.close(); }
}
function resetWorkflowOnly() {
  const db = openDatabase(path.join(temp, "collector.db"), schema);
  try {
    const repo = createRepository(db);
    const model = repo.ensureWorkflowModel(itemId);
    repo.upsertWorkflowModel(itemId, {
      production_state: "ready_for_publish",
      publication_state: "approved",
      current_draft_id: model.current_draft_id,
      current_review_report_id: model.current_review_report_id,
    }, "owner@local", { actor_role: "owner", reason_code: "runtime_harness_reset", skip_production_transition_validation: true, skip_publication_transition_validation: true });
  } finally { db.close(); }
}
function snapshotDiagnostics() {
  const db = openDatabase(path.join(temp, "collector.db"), schema);
  try {
    return db.prepare("SELECT submission_id, manifest_hash, superseded_at FROM review_submission_snapshots WHERE content_item_id=? ORDER BY created_at, rowid").all(itemId);
  } finally { db.close(); }
}
async function submit(version, langs, { prepareState = true, reuseEditorial = false } = {}) {
  if (prepareState) prepare(version, langs, { reuseEditorial }); const port = collectorPort;
  child = spawn(process.execPath, ["server/index.mjs"], { cwd: path.join(root, "collector"), env: { ...process.env, PORT: String(port), DB_PATH: path.join(temp, "collector.db"), RAW_DIR: path.join(temp, "raw"), MEDIA_DIR: path.join(temp, "media"), STAGING_DIR: path.join(temp, "staging"), EXPORT_DIR: path.join(temp, "staging"), COLLECTOR_SYNC_BACKEND_API: backendBase, COLLECTOR_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, TRANSLATION_TARGET_LANGS: langs.join(",") }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await sleep(250); if (i === 79) throw new Error("collector boot timeout"); }
  const headers = { authorization: `Bearer ${token()}`, "content-type": "application/json" };
  const [readinessResponse, workflowResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/items/${itemId}/export-readiness`, { headers }),
    fetch(`http://127.0.0.1:${port}/api/items/${itemId}/workflow-model`, { headers }),
  ]);
  const readiness = await readinessResponse.json(); const workflow = await workflowResponse.json();
  const r = await fetch(`http://127.0.0.1:${port}/api/items/${itemId}/submit-admin-review`, { method: "POST", headers, body: "{}" }); const b = await r.json();
  if (!r.ok) console.error(JSON.stringify({ version, readiness, workflow, submit: b }, null, 2));
  stop(); must(r.ok, `submit ${version}: ${b.error}`); return b;
}
async function approve(id) { const r = await fetch(`${backendBase}/review-content/${id}/approve`, { method: "POST", headers: { authorization: `Bearer ${jwt.sign({ id: 1, email: "runtime-harness@local.test", role: "owner" }, secret, { issuer: process.env.JWT_ISSUER || "uboncity-backend", audience: process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend", expiresIn: "10m" })}`, "content-type": "application/json" }, body: JSON.stringify({ review_note: "runtime harness" }) }); const b = await r.json(); must(r.ok, `approve: ${b.error}`); return b; }
async function rows(sql, p) { const [r] = await pool.query(sql, p); return r; }
try {
  const v1 = await submit("V1", ["en", "lo"]); const rc = Number(v1.backend_ingest.result.item.id); let a = await rows("SELECT batch_uid,lang,status FROM review_content_translations WHERE review_content_id=? ORDER BY lang", [rc]); must(a.length === 2 && a.every(x => x.status === "review_ready"), "V1 staging"); const batchA = a[0].batch_uid; report.push([1,"pass"]);
  const beforeRetry = { route_action: v1.review_submission_snapshot_action, source_submission_id: v1.review_submission_snapshot?.submission_id, manifest_hash: v1.review_submission_snapshot?.manifest_hash, snapshots: snapshotDiagnostics(), staging: await rows("SELECT batch_uid,status,COUNT(*) AS count FROM review_content_translations WHERE review_content_id=? GROUP BY batch_uid,status ORDER BY batch_uid,status", [rc]), current_batch_uid: (await rows("SELECT current_batch_uid FROM review_contents WHERE id=?", [rc]))[0]?.current_batch_uid };
  resetWorkflowOnly(); const retry = await submit("V1", ["en", "lo"], { prepareState: false }); a = await rows("SELECT * FROM review_content_translations WHERE review_content_id=?", [rc]); const afterRetry = { route_action: retry.review_submission_snapshot_action, source_submission_id: retry.review_submission_snapshot?.submission_id, manifest_hash: retry.review_submission_snapshot?.manifest_hash, snapshots: snapshotDiagnostics(), staging: await rows("SELECT batch_uid,status,COUNT(*) AS count FROM review_content_translations WHERE review_content_id=? GROUP BY batch_uid,status ORDER BY batch_uid,status", [rc]), current_batch_uid: (await rows("SELECT current_batch_uid FROM review_contents WHERE id=?", [rc]))[0]?.current_batch_uid }; console.error(JSON.stringify({ retry_diagnostics: { beforeRetry, afterRetry } }, null, 2)); must(retry.review_submission_snapshot_action === "retry" && a.length === 2, "retry rows"); report.push([2,"pass"]);
  await approve(rc); a = await rows("SELECT lang,status FROM review_content_translations WHERE review_content_id=?", [rc]); must(a.every(x => x.status === "published"), "V1 published staging"); const content = (await rows("SELECT public_entity_type,public_entity_id FROM review_contents WHERE id=?", [rc]))[0]; const publicEntityId = Number(content.public_entity_id || 0); must(content.public_entity_type === "place" && publicEntityId > 0, "V1 public identity"); let pub = await rows("SELECT lang,description FROM place_translations WHERE place_id=? ORDER BY lang", [publicEntityId]); must(pub.map(x=>x.lang).join(",") === "en,lo,th" && pub.every(x=>String(x.description).includes("/uploads/")), "V1 public inline"); report.push([3,"pass"]);
  const v2 = await submit("V2", ["en"], { reuseEditorial: true }); const v2ReingestReview = (await rows("SELECT current_batch_uid,public_entity_type,public_entity_id FROM review_contents WHERE id=?", [rc]))[0]; const b = v2ReingestReview.current_batch_uid; must(v2ReingestReview.public_entity_type === "place" && Number(v2ReingestReview.public_entity_id) === publicEntityId, "V2 reingest preserves public identity"); a = await rows("SELECT batch_uid,lang,status FROM review_content_translations WHERE review_content_id=? ORDER BY batch_uid,lang", [rc]); must(a.filter(x=>x.batch_uid===batchA).length===2 && a.filter(x=>x.batch_uid===batchA).every(x=>x.status==="published") && a.some(x=>x.batch_uid===b&&x.lang==="en"&&x.status==="review_ready"), "V2 batches"); report.push([4,"pass"]);
  const v2Before = { public: await rows("SELECT lang,LEFT(description,80) AS description FROM place_translations WHERE place_id=? ORDER BY lang", [publicEntityId]), public_timestamp_columns: "not present in Runtime place_translations schema", staging: await rows("SELECT batch_uid,lang,status FROM review_content_translations WHERE review_content_id=? ORDER BY batch_uid,lang", [rc]), review: (await rows("SELECT current_batch_uid,lang,public_entity_type,public_entity_id FROM review_contents WHERE id=?", [rc]))[0] };
  const historical = [...new Set(v2Before.staging.filter(x=>x.status==="published").map(x=>x.lang))]; const current = [...new Set(v2Before.staging.filter(x=>x.batch_uid===b&&x.status==="review_ready").map(x=>x.lang))]; const sourceLang = v2Before.review.lang; const wouldDelete = historical.filter(lang=>lang!==sourceLang&&!current.includes(lang));
  await approve(rc); const v2After = { public: await rows("SELECT lang,LEFT(description,80) AS description FROM place_translations WHERE place_id=? ORDER BY lang", [publicEntityId]), public_timestamp_columns: "not present in Runtime place_translations schema", staging: await rows("SELECT batch_uid,lang,status FROM review_content_translations WHERE review_content_id=? ORDER BY batch_uid,lang", [rc]), review: (await rows("SELECT current_batch_uid,lang,public_entity_type,public_entity_id FROM review_contents WHERE id=?", [rc]))[0] }; console.error(JSON.stringify({ v2_approve_diagnostics: { before: v2Before, computed: { historical, current, sourceLang, wouldDelete }, after: v2After } }, null, 2)); must(v2After.review.public_entity_type === "place" && Number(v2After.review.public_entity_id) === publicEntityId, "V2 approve preserves public identity"); pub = v2After.public; must(pub.map(x=>x.lang).join(",") === "en,th", "V2 removes lo"); report.push([5,"pass"]);
  await pool.query("INSERT INTO place_translations(place_id,lang,title,description,meta_title,meta_description) VALUES(?,?,?,?,?,?)", [publicEntityId,"fr","lifecycle fr","lifecycle","fr","fr"]); const v3 = await submit("V3", ["en"]); await approve(rc); pub = await rows("SELECT lang FROM place_translations WHERE place_id=? ORDER BY lang", [publicEntityId]); must(pub.map(x=>x.lang).join(",") === "en,fr,th", "fr preserved"); report.push([6,"pass"]);
  const v4 = await submit("V4", ["en"]); const batchD = (await rows("SELECT current_batch_uid FROM review_contents WHERE id=?", [rc]))[0].current_batch_uid; const r = await fetch(`${backendBase}/review-content/${rc}/reject`, { method:"POST", headers:{authorization:`Bearer ${jwt.sign({id:1,email:"runtime-harness@local.test",role:"owner"},secret,{issuer:process.env.JWT_ISSUER||"uboncity-backend",audience:process.env.JWT_AUDIENCE_BACKEND||"uboncity-backend",expiresIn:"10m"})}`,"content-type":"application/json"},body:JSON.stringify({review_note:"runtime harness reject"})}); must(r.ok,"reject"); a=await rows("SELECT status FROM review_content_translations WHERE review_content_id=? AND batch_uid=?",[rc,batchD]); must(a.every(x=>x.status==="deleted"),"V4 deleted"); pub=await rows("SELECT lang FROM place_translations WHERE place_id=? ORDER BY lang",[publicEntityId]); must(pub.map(x=>x.lang).join(",") === "en,fr,th","public unchanged"); report.push([7,"pass"]);
  console.log(JSON.stringify({ ok:true, item_id:itemId, review_content_id:rc, checks:report }, null, 2));
} finally { stop(); try { const ids=await rows("SELECT id,public_entity_id FROM review_contents WHERE source_system='collector-app' AND source_content_item_id=?",[itemId]); for(const x of ids) if(x.public_entity_id) { await pool.query("DELETE FROM place_translations WHERE place_id=?",[x.public_entity_id]); await pool.query("DELETE FROM places WHERE id=?",[x.public_entity_id]); } await pool.query("DELETE FROM review_contents WHERE source_system='collector-app' AND source_content_item_id=?",[itemId]); const [leftReviews]=await pool.query("SELECT COUNT(*) AS count FROM review_contents WHERE source_system='collector-app' AND source_content_item_id=?",[itemId]); must(Number(leftReviews[0].count)===0,"fixture review cleanup"); } finally { await pool.end(); await fsp.rm(temp,{recursive:true,force:true}); } }
