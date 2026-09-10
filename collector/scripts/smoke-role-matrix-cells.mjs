import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "role-matrix-cells-smoke-secret";
const reviewSyncToken = "smoke-cells-review-sync-token";
const TEST_PREFIX = "__test-rmc-";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const results = [];
let passCount = 0;
let failCount = 0;
const mismatches = [];

function record(name, pass, detail = "") {
  if (pass) { passCount++; results.push({ name, status: "PASS", detail }); }
  else { failCount++; results.push({ name, status: "FAIL", detail }); }
  console.error(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function recordMismatch(route, role, expected, actual) {
  mismatches.push({ route, role, expected, actual });
}

async function reservePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = Number(probe.address()?.port || 0);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForCollector(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode != null) throw new Error(`collector exited early with ${child.exitCode}`);
    try { const r = await fetch(`${baseUrl}/api/health`); if (r.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("collector server did not become ready");
}

function makeToken(userId, email, role, managedByUserId) {
  const payload = { id: userId, email, display_name: `Test ${role}`, role };
  if (managedByUserId != null) {
    payload.managed_by_user_id = managedByUserId;
  }
  return jwt.sign(payload, authSecret, { issuer: "uboncity-backend", audience: "uboncity-collector" });
}

async function withServer(dbPath, run) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child = null;
  try {
    child = spawn(process.execPath, [serverPath], {
      cwd: collectorRoot,
      env: { ...process.env, COLLECTOR_ROOT: collectorRoot, DB_PATH: dbPath, PORT: String(port), BACKEND_JWT_SECRET: authSecret, COLLECTOR_REVIEW_SYNC_TOKEN: reviewSyncToken, COLLECTOR_SYNC_BACKEND_API: "http://127.0.0.1:5000/api", COLLECTOR_PUBLIC_BASE_URL: `http://127.0.0.1:${port}` },
      stdio: "ignore",
    });
    await waitForCollector(baseUrl, child);
    await run(baseUrl, port);
  } finally {
    if (child && child.exitCode == null) { child.kill(); await once(child, "exit"); }
  }
}

async function api(baseUrl, method, pathStr, token, body) {
  const opts = { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(`${baseUrl}${pathStr}`, opts);
}

async function apiMultipart(baseUrl, pathStr, token, formData) {
  return fetch(`${baseUrl}${pathStr}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: formData,
  });
}

async function assertCell(baseUrl, name, method, pathStr, token, expected, body) {
  const res = await api(baseUrl, method, pathStr, token, body);
  const status = res.status;
  let pass;
  let detail;
  if (expected === "non403") {
    pass = status !== 403;
    detail = `status=${status}`;
    if (!pass) {
      const parts = name.split("×");
      recordMismatch((parts[0] || "").trim(), (parts[1] || "").trim(), "non-403", String(status));
    }
  } else if (expected === "200/409") {
    pass = status === 200 || status === 409;
    detail = `status=${status}`;
    if (!pass) {
      const parts = name.split("×");
      recordMismatch((parts[0] || "").trim(), (parts[1] || "").trim(), "200/409", String(status));
    }
  } else {
    pass = status === expected;
    detail = `status=${status} expected=${expected}`;
    if (!pass) {
      const parts = name.split("×");
      recordMismatch((parts[0] || "").trim(), (parts[1] || "").trim(), String(expected), String(status));
    }
  }
  record(name, pass, detail);
  return status;
}

async function assertMultipart(baseUrl, name, pathStr, token, formData, expected) {
  const res = await apiMultipart(baseUrl, pathStr, token, formData);
  const status = res.status;
  let pass;
  let detail;
  if (expected === "non403") {
    pass = status !== 403;
    detail = `status=${status}`;
    if (!pass) {
      const parts = name.split("×");
      recordMismatch((parts[0] || "").trim(), (parts[1] || "").trim(), "non-403", String(status));
    }
  } else {
    pass = status === expected;
    detail = `status=${status} expected=${expected}`;
    if (!pass) {
      const parts = name.split("×");
      recordMismatch((parts[0] || "").trim(), (parts[1] || "").trim(), String(expected), String(status));
    }
  }
  record(name, pass, detail);
  return status;
}

function testContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rmc-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  const createdUserIds = [];
  const createdItemIds = [];
  const createdAssetIds = [];
  const createdAssignmentIds = [];

  const createUser = (suffix, role, managerUserId) => {
    const email = `${TEST_PREFIX}${suffix}-${Date.now()}@local.test`.toLowerCase();
    const result = db.prepare(
      `INSERT INTO users (email, display_name, password_hash, role, managed_by_user_id) VALUES (?, ?, '', ?, ?)`
    ).run(email, `Test ${suffix}`, role, managerUserId);
    const id = Number(result.lastInsertRowid || 0);
    db.prepare(`UPDATE users SET profile_json=? WHERE id=?`)
      .run(JSON.stringify({ _auth_sync: { user_id: id, provider: "backend", directory_active: true } }), id);
    createdUserIds.push(id);
    return { id, email };
  };

  const owner = createUser("owner", "owner", null);
  const adminA = createUser("adminA", "admin", owner.id);
  const adminB = createUser("adminB", "admin", owner.id);
  const managerA1 = createUser("mgrA1", "user", adminA.id);
  const managerA2 = createUser("mgrA2", "user", adminA.id);
  const managerB1 = createUser("mgrB1", "user", adminB.id);
  const managerB2 = createUser("mgrB2", "user", adminB.id);
  const editorA1 = createUser("edA1", "editor", managerA1.id);
  const freelanceA1 = createUser("flA1", "freelance", managerA1.id);
  const editorA2 = createUser("edA2", "editor", managerA2.id);
  const freelanceA2 = createUser("flA2", "freelance", managerA2.id);
  const editorB1 = createUser("edB1", "editor", managerB1.id);
  const freelanceB1 = createUser("flB1", "freelance", managerB1.id);
  const editorB2 = createUser("edB2", "editor", managerB2.id);
  const freelanceB2 = createUser("flB2", "freelance", managerB2.id);

  const tokens = {
    owner: makeToken(owner.id, owner.email, "owner", null),
    adminA: makeToken(adminA.id, adminA.email, "admin", owner.id),
    adminB: makeToken(adminB.id, adminB.email, "admin", owner.id),
    managerA1: makeToken(managerA1.id, managerA1.email, "user", adminA.id),
    managerA2: makeToken(managerA2.id, managerA2.email, "user", adminA.id),
    managerB1: makeToken(managerB1.id, managerB1.email, "user", adminB.id),
    managerB2: makeToken(managerB2.id, managerB2.email, "user", adminB.id),
    editorA1: makeToken(editorA1.id, editorA1.email, "editor", managerA1.id),
    freelanceA1: makeToken(freelanceA1.id, freelanceA1.email, "freelance", managerA1.id),
    editorA2: makeToken(editorA2.id, editorA2.email, "editor", managerA2.id),
    freelanceA2: makeToken(freelanceA2.id, freelanceA2.email, "freelance", managerA2.id),
    editorB1: makeToken(editorB1.id, editorB1.email, "editor", managerB1.id),
    freelanceB1: makeToken(freelanceB1.id, freelanceB1.email, "freelance", managerB1.id),
    editorB2: makeToken(editorB2.id, editorB2.email, "editor", managerB2.id),
    freelanceB2: makeToken(freelanceB2.id, freelanceB2.email, "freelance", managerB2.id),
  };

  const createItem = (title, claimedByUserId, prodState, pubState, placeReviewFlag) => {
    const result = repo.createItemWithWorkflowHead({
      type: "place",
      category: "cafes",
      title,
      description_raw: title,
      source_type: "manual",
      source_name: "smoke-test",
    });
    const item = repo.getItem(result.item.id);
    createdItemIds.push(item.id);
    if (claimedByUserId) {
      db.prepare("UPDATE content_items SET claimed_by_user_id=?, claimed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(claimedByUserId, item.id);
    }
    const updates = [];
    const params = [];
    if (prodState) { updates.push("production_state=?"); params.push(prodState); }
    if (pubState) { updates.push("publication_state=?"); params.push(pubState); }
    if (placeReviewFlag) { updates.push("place_review_flag=?"); params.push(placeReviewFlag); }
    if (updates.length) {
      params.push(item.id);
      db.prepare(`UPDATE content_workflow_models SET ${updates.join(", ")} WHERE content_item_id=?`).run(...params);
    }
    return item;
  };

  const createAsset = (itemId) => {
    const assetUid = `${TEST_PREFIX}asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const coverDir = path.join(tempDir, "uploads", "img");
    fs.mkdirSync(coverDir, { recursive: true });
    const filePath = path.join(coverDir, `${assetUid}.jpg`);
    fs.writeFileSync(filePath, Buffer.alloc(512, 0xFF));
    const storagePath = path.relative(collectorRoot, filePath).replace(/\\/g, "/");
    const assetResult = db.prepare(`INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes) VALUES (?, 'local', ?, 'cover.jpg', 'image/jpeg', 512)`)
      .run(assetUid, storagePath);
    const assetId = Number(assetResult.lastInsertRowid || 0);
    createdAssetIds.push(assetId);
    db.prepare(`INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover) VALUES (?, ?, 'cover', 1, 1)`)
      .run(itemId, assetId);
    return assetId;
  };

  const createReferenceMedia = (itemId) => {
    const refMediaId = `${TEST_PREFIX}ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO content_reference_media_selections (content_item_id, reference_media_id, selected_for_ai) VALUES (?, ?, 1)`)
      .run(itemId, refMediaId);
    return refMediaId;
  };

  const createAssignment = (itemId, assigneeUserId, kind, state) => {
    const uid = `${TEST_PREFIX}assign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = db.prepare(`INSERT INTO content_assignments (assignment_uid, content_item_id, assignee_user_id, assignment_kind, state) VALUES (?, ?, ?, ?, ?)`)
      .run(uid, itemId, assigneeUserId, kind, state || "assigned");
    const id = Number(result.lastInsertRowid || 0);
    createdAssignmentIds.push(id);
    return id;
  };

  const createReviewReport = (itemId) => {
    const result = db.prepare(`INSERT INTO review_reports (content_item_id, total_score, status) VALUES (?, 80, 'pending')`)
      .run(itemId);
    const reportId = Number(result.lastInsertRowid || 0);
    db.prepare(`UPDATE content_workflow_models SET current_review_report_id=? WHERE content_item_id=?`).run(reportId, itemId);
    return reportId;
  };

  const createDraft = (itemId, title, body) => {
    const uid = `${TEST_PREFIX}draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body, status) VALUES (?, ?, ?, ?, 'generated')`)
      .run(itemId, uid, title || "Smoke Draft", body || "smoke body content for testing");
    const draft = repo.latestDraftByItem(itemId);
    if (draft?.id) {
      db.prepare(`UPDATE content_workflow_models SET current_draft_id=? WHERE content_item_id=?`).run(draft.id, itemId);
    }
  };

  const createPublishedArticle = (itemId, slug) => {
    db.prepare(`INSERT INTO published_articles (content_item_id, slug, title, body, status) VALUES (?, ?, ?, ?, 'published')`)
      .run(itemId, slug || `smoke-published-${Date.now()}`, "Smoke Published", "Smoke published body");
  };

  const createFieldPack = (itemId) => {
    const fpResult = db.prepare(`
      INSERT INTO field_packs (content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json, updated_by)
      VALUES (?, 'ready_for_field', 1, 'smoke', '[]', '[]', '[]', '[]', '[]', '[]', 'smoke')
    `).run(itemId);
    const fpId = Number(fpResult.lastInsertRowid || 0);
    db.prepare(`UPDATE content_workflow_models SET current_field_pack_id=? WHERE content_item_id=?`).run(fpId, itemId);
    return fpId;
  };

  // ── Items ──

  // itemA1: in-line for chain A
  const itemA1 = createItem("คาเฟ่สวนกลางเมือง A1", managerA1.id, "collected");
  const assetA1 = createAsset(itemA1.id);
  const refMediaA1 = createReferenceMedia(itemA1.id);
  const assignEdA1 = createAssignment(itemA1.id, editorA1.id, "editorial");
  const assignFlA1 = createAssignment(itemA1.id, freelanceA1.id, "field");

  // itemB1: cross-line for chain B
  const itemB1 = createItem("ร้านก๋วยเตี๋ยวเรือ B1", managerB1.id, "collected");
  const assetB1 = createAsset(itemB1.id);
  const assignEdB1 = createAssignment(itemB1.id, editorB1.id, "editorial");
  const assignFlB1 = createAssignment(itemB1.id, freelanceB1.id, "field");

  // ② state items
  const itemClean = createItem("ร้านกาแฟ clean", managerA1.id, "collected");
  createFieldPack(itemClean.id);

  const itemInReview = createItem("ร้านอาหาร in_review", managerA1.id, "in_review");
  createFieldPack(itemInReview.id);
  createReviewReport(itemInReview.id);

  const itemRejected = createItem("ร้านเบเกอรี่ rejected", managerA1.id, "rejected", null, "rejected");
  createFieldPack(itemRejected.id);
  createReviewReport(itemRejected.id);

  const itemPublished = createItem("ร้านส้มตำ published", managerA1.id, "completed", "published");
  createFieldPack(itemPublished.id);
  createPublishedArticle(itemPublished.id, "smoke-published-article");

  const itemEditorial = createItem("ร้านอาหารไทย editorial", managerA1.id, "content_in_progress");
  createFieldPack(itemEditorial.id);
  createDraft(itemEditorial.id, "ร้านอาหารไทย editorial draft", "ร้านอาหารไทยเป็นร้านอาหารที่มีชื่อเสียงในอุบลราชธานี ".repeat(5));
  const assignEdA1Editorial = createAssignment(itemEditorial.id, editorA1.id, "editorial", "in_progress");

  // Separate item for D2.8 submit-review② × Ea (D2.7 transition② pollutes assignment state)
  const itemEditorial2 = createItem("ร้านอาหาร editorial2", managerA1.id, "content_in_progress");
  createFieldPack(itemEditorial2.id);
  createDraft(itemEditorial2.id, "editorial2 draft", "บทความทดสอบ ".repeat(5));
  const assignEdA1Editorial2 = createAssignment(itemEditorial2.id, editorA1.id, "editorial", "in_progress");

  // Extra assignment for submissions ②
  const assignFlA1ForSubmissions = createAssignment(itemA1.id, freelanceA1.id, "field", "assigned");

  const users = { owner, adminA, adminB, managerA1, managerA2, managerB1, managerB2, editorA1, freelanceA1, editorA2, freelanceA2, editorB1, freelanceB1, editorB2, freelanceB2 };
  const items = { itemA1, itemB1, itemClean, itemInReview, itemRejected, itemPublished, itemEditorial, itemEditorial2 };
  const assets = { assetA1, assetB1 };
  const refMedia = { refMediaA1 };
  const assignments = { assignEdA1, assignFlA1, assignEdB1, assignFlB1, assignEdA1Editorial, assignEdA1Editorial2, assignFlA1ForSubmissions };

  const cleanup = () => {
    for (const id of createdAssetIds) {
      try { db.prepare("DELETE FROM content_assets WHERE asset_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM assets WHERE id=?").run(id); } catch {}
    }
    for (const id of createdAssignmentIds) {
      try { db.prepare("DELETE FROM content_assignments WHERE id=?").run(id); } catch {}
    }
    for (const id of createdItemIds) {
      try { db.prepare("DELETE FROM field_packs WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_drafts WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM review_reports WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM review_actions WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM published_articles WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_reference_media_selections WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_items WHERE id=?").run(id); } catch {}
    }
    for (const id of createdUserIds) {
      try { db.prepare("DELETE FROM users WHERE id=?").run(id); } catch {}
    }
    try { db.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  };

  return { db, repo, dbPath, tempDir, tokens, users, items, assets, refMedia, assignments, cleanup };
}

// ════════════════════════════════════════════════════════════════
// ① cells — fire with minimal fixture, no production_state needed
// ════════════════════════════════════════════════════════════════

async function fireD1Group1(baseUrl, ctx) {
  const t = ctx.tokens;
  const itemId = ctx.items.itemA1.id;
  const collectBody = { adapter: "manual", payload: [{ title: "Smoke collect rmc", type: "place", category: "cafes" }] };

  // D1.1 POST /api/collect
  await assertCell(baseUrl, "D1.1 collect × O", "POST", "/api/collect", t.owner, "non403", collectBody);
  await assertCell(baseUrl, "D1.1 collect × A", "POST", "/api/collect", t.adminA, "non403", collectBody);
  await assertCell(baseUrl, "D1.1 collect × U", "POST", "/api/collect", t.managerA1, 403);
  await assertCell(baseUrl, "D1.1 collect × Ea", "POST", "/api/collect", t.editorA1, 403);
  await assertCell(baseUrl, "D1.1 collect × Eu", "POST", "/api/collect", t.editorA2, 403);
  await assertCell(baseUrl, "D1.1 collect × F", "POST", "/api/collect", t.freelanceA1, 403);

  // D1.2 POST /api/run/clean (① deny)
  await assertCell(baseUrl, "D1.2 clean × U", "POST", "/api/run/clean", t.managerA1, 403);
  await assertCell(baseUrl, "D1.2 clean × Ea", "POST", "/api/run/clean", t.editorA1, 403);
  await assertCell(baseUrl, "D1.2 clean × Eu", "POST", "/api/run/clean", t.editorA2, 403);
  await assertCell(baseUrl, "D1.2 clean × F", "POST", "/api/run/clean", t.freelanceA1, 403);

  // D1.3 POST /api/run/ai-draft (① deny, positive path ③)
  await assertCell(baseUrl, "D1.3 ai-draft × Ea", "POST", "/api/run/ai-draft", t.editorA1, 403, { content_item_id: itemId });
  await assertCell(baseUrl, "D1.3 ai-draft × Eu", "POST", "/api/run/ai-draft", t.editorA2, 403, { content_item_id: itemId });
  await assertCell(baseUrl, "D1.3 ai-draft × F", "POST", "/api/run/ai-draft", t.freelanceA1, 403, { content_item_id: itemId });

  // D1.4 POST /api/run/quality (① deny, positive path ③)
  await assertCell(baseUrl, "D1.4 quality × U", "POST", "/api/run/quality", t.managerA1, 403);
  await assertCell(baseUrl, "D1.4 quality × Ea", "POST", "/api/run/quality", t.editorA1, 403);
  await assertCell(baseUrl, "D1.4 quality × Eu", "POST", "/api/run/quality", t.editorA2, 403);
  await assertCell(baseUrl, "D1.4 quality × F", "POST", "/api/run/quality", t.freelanceA1, 403);

  // D1.5 POST /api/review/action (① deny)
  const reviewBody = { content_item_id: itemId, action: "approve", notes: "smoke" };
  await assertCell(baseUrl, "D1.5 review/action × U", "POST", "/api/review/action", t.managerA1, 403, reviewBody);
  await assertCell(baseUrl, "D1.5 review/action × Ea", "POST", "/api/review/action", t.editorA1, 403, reviewBody);
  await assertCell(baseUrl, "D1.5 review/action × Eu", "POST", "/api/review/action", t.editorA2, 403, reviewBody);
  await assertCell(baseUrl, "D1.5 review/action × F", "POST", "/api/review/action", t.freelanceA1, 403, reviewBody);

  // D1.6 POST /api/review/reopen (① deny)
  const reopenBody = { content_item_id: itemId };
  await assertCell(baseUrl, "D1.6 review/reopen × U", "POST", "/api/review/reopen", t.managerA1, 403, reopenBody);
  await assertCell(baseUrl, "D1.6 review/reopen × Ea", "POST", "/api/review/reopen", t.editorA1, 403, reopenBody);
  await assertCell(baseUrl, "D1.6 review/reopen × Eu", "POST", "/api/review/reopen", t.editorA2, 403, reopenBody);
  await assertCell(baseUrl, "D1.6 review/reopen × F", "POST", "/api/review/reopen", t.freelanceA1, 403, reopenBody);

  // D1.7 POST /api/items/:id/unpublish (① deny)
  await assertCell(baseUrl, "D1.7 unpublish × U", "POST", `/api/items/${itemId}/unpublish`, t.managerA1, 403);
  await assertCell(baseUrl, "D1.7 unpublish × Ea", "POST", `/api/items/${itemId}/unpublish`, t.editorA1, 403);
  await assertCell(baseUrl, "D1.7 unpublish × Eu", "POST", `/api/items/${itemId}/unpublish`, t.editorA2, 403);
  await assertCell(baseUrl, "D1.7 unpublish × F", "POST", `/api/items/${itemId}/unpublish`, t.freelanceA1, 403);
}

async function fireD2Group1(baseUrl, ctx) {
  const t = ctx.tokens;
  const iA = ctx.items.itemA1.id;
  const iB = ctx.items.itemB1.id;
  const aA = ctx.assets.assetA1;
  const aB = ctx.assets.assetB1;
  const rA = ctx.refMedia.refMediaA1;

  // ── Row 1: PATCH assets/:assetId/role ──
  const r1pA = `/api/items/${iA}/assets/${aA}/role`;
  const r1pB = `/api/items/${iB}/assets/${aB}/role`;
  const r1b = { role: "gallery" };
  await assertCell(baseUrl, "D2.1 role × O", "PATCH", r1pA, t.owner, "non403", r1b);
  await assertCell(baseUrl, "D2.1 role × A✓", "PATCH", r1pA, t.adminA, "non403", r1b);
  await assertCell(baseUrl, "D2.1 role × A✗", "PATCH", r1pB, t.adminA, 403, r1b);
  await assertCell(baseUrl, "D2.1 role × U✓", "PATCH", r1pA, t.managerA1, "non403", r1b);
  await assertCell(baseUrl, "D2.1 role × Ea", "PATCH", r1pA, t.editorA1, "non403", r1b);
  await assertCell(baseUrl, "D2.1 role × Eu", "PATCH", r1pA, t.editorA2, 403, r1b);
  await assertCell(baseUrl, "D2.1 role × F", "PATCH", r1pA, t.freelanceA1, 403, r1b);

  // ── Row 2: PATCH assets/:assetId/selected ──
  const r2pA = `/api/items/${iA}/assets/${aA}/selected`;
  const r2pB = `/api/items/${iB}/assets/${aB}/selected`;
  const r2b = { selected: 1 };
  await assertCell(baseUrl, "D2.2 selected × O", "PATCH", r2pA, t.owner, "non403", r2b);
  await assertCell(baseUrl, "D2.2 selected × A✓", "PATCH", r2pA, t.adminA, "non403", r2b);
  await assertCell(baseUrl, "D2.2 selected × A✗", "PATCH", r2pB, t.adminA, 403, r2b);
  await assertCell(baseUrl, "D2.2 selected × U✓", "PATCH", r2pA, t.managerA1, "non403", r2b);
  await assertCell(baseUrl, "D2.2 selected × Ea", "PATCH", r2pA, t.editorA1, "non403", r2b);
  await assertCell(baseUrl, "D2.2 selected × Eu", "PATCH", r2pA, t.editorA2, 403, r2b);
  await assertCell(baseUrl, "D2.2 selected × F", "PATCH", r2pA, t.freelanceA1, 403, r2b);

  // ── Row 3: PATCH assets/:assetId/caption ──
  const r3pA = `/api/items/${iA}/assets/${aA}/caption`;
  const r3pB = `/api/items/${iB}/assets/${aB}/caption`;
  const r3b = { caption: "smoke test caption" };
  await assertCell(baseUrl, "D2.3 caption × O", "PATCH", r3pA, t.owner, "non403", r3b);
  await assertCell(baseUrl, "D2.3 caption × A✓", "PATCH", r3pA, t.adminA, "non403", r3b);
  await assertCell(baseUrl, "D2.3 caption × A✗", "PATCH", r3pB, t.adminA, 403, r3b);
  await assertCell(baseUrl, "D2.3 caption × U✓", "PATCH", r3pA, t.managerA1, "non403", r3b);
  await assertCell(baseUrl, "D2.3 caption × Ea", "PATCH", r3pA, t.editorA1, "non403", r3b);
  await assertCell(baseUrl, "D2.3 caption × Eu", "PATCH", r3pA, t.editorA2, 403, r3b);
  await assertCell(baseUrl, "D2.3 caption × F", "PATCH", r3pA, t.freelanceA1, 403, r3b);

  // ── Row 4: PATCH reference-media/:id/selected ──
  const r4pA = `/api/items/${iA}/reference-media/${rA}/selected`;
  const r4pB = `/api/items/${iB}/reference-media/fake-ref/selected`;
  const r4b = { selected_for_ai: 1 };
  await assertCell(baseUrl, "D2.4 ref-sel × O", "PATCH", r4pA, t.owner, "non403", r4b);
  await assertCell(baseUrl, "D2.4 ref-sel × A✓", "PATCH", r4pA, t.adminA, "non403", r4b);
  await assertCell(baseUrl, "D2.4 ref-sel × A✗", "PATCH", r4pB, t.adminA, 403, r4b);
  await assertCell(baseUrl, "D2.4 ref-sel × U✓", "PATCH", r4pA, t.managerA1, "non403", r4b);
  await assertCell(baseUrl, "D2.4 ref-sel × Ea", "PATCH", r4pA, t.editorA1, "non403", r4b);
  await assertCell(baseUrl, "D2.4 ref-sel × Eu", "PATCH", r4pA, t.editorA2, 403, r4b);
  await assertCell(baseUrl, "D2.4 ref-sel × F", "PATCH", r4pA, t.freelanceA1, 403, r4b);

  // ── Row 5a: POST /api/assets/upload ──
  async function testUpload(name, token, itemId, expected) {
    const fd = new FormData();
    fd.append("file", new Blob([PNG_1X1], { type: "image/png" }), "test.png");
    fd.append("content_item_id", String(itemId));
    return assertMultipart(baseUrl, name, "/api/assets/upload", token, fd, expected);
  }
  await testUpload("D2.5a upload × O", t.owner, iA, "non403");
  await testUpload("D2.5a upload × A✓", t.adminA, iA, "non403");
  await testUpload("D2.5a upload × A✗", t.adminA, iB, 403);
  await testUpload("D2.5a upload × U✓", t.managerA1, iA, "non403");
  await testUpload("D2.5a upload × Ea", t.editorA1, iA, "non403");
  await testUpload("D2.5a upload × Eu", t.editorA2, iA, 403);
  await testUpload("D2.5a upload × F", t.freelanceA1, iA, 403);

  // ── Row 5b: POST /api/assets/register ──
  const regBody = (itemId) => ({ storage_path: "test/path.jpg", file_name: "test.jpg", mime_type: "image/jpeg", content_item_id: itemId });
  await assertCell(baseUrl, "D2.5b register × O", "POST", "/api/assets/register", t.owner, "non403", regBody(iA));
  await assertCell(baseUrl, "D2.5b register × A✓", "POST", "/api/assets/register", t.adminA, "non403", regBody(iA));
  await assertCell(baseUrl, "D2.5b register × A✗", "POST", "/api/assets/register", t.adminA, 403, regBody(iB));
  await assertCell(baseUrl, "D2.5b register × U✓", "POST", "/api/assets/register", t.managerA1, "non403", regBody(iA));
  await assertCell(baseUrl, "D2.5b register × Ea", "POST", "/api/assets/register", t.editorA1, "non403", regBody(iA));
  await assertCell(baseUrl, "D2.5b register × Eu", "POST", "/api/assets/register", t.editorA2, 403, regBody(iA));
  await assertCell(baseUrl, "D2.5b register × F", "POST", "/api/assets/register", t.freelanceA1, 403, regBody(iA));

  // ── Row 6: PUT editor-work (① deny: A✗, Eu, F) ──
  const edBody = { draft: { body: "t", draft_title: "t" } };
  await assertCell(baseUrl, "D2.6 editor-work × A✗", "PUT", `/api/items/${iB}/editor-work`, t.adminA, 403, edBody);
  await assertCell(baseUrl, "D2.6 editor-work × Eu", "PUT", `/api/items/${iA}/editor-work`, t.editorA2, 403, edBody);
  await assertCell(baseUrl, "D2.6 editor-work × F", "PUT", `/api/items/${iA}/editor-work`, t.freelanceA1, 403, edBody);

  // ── Row 7: POST article-process/transition (① deny: A✗, Eu, F) ──
  const transBody = { status: "drafting" };
  await assertCell(baseUrl, "D2.7 transition × A✗", "POST", `/api/items/${iB}/article-process/transition`, t.adminA, 403, transBody);
  await assertCell(baseUrl, "D2.7 transition × Eu", "POST", `/api/items/${iA}/article-process/transition`, t.editorA2, 403, transBody);
  await assertCell(baseUrl, "D2.7 transition × F", "POST", `/api/items/${iA}/article-process/transition`, t.freelanceA1, 403, transBody);

  // ── Row 8: POST article-process/submit-review (① deny: A✗, Eu, F) ──
  await assertCell(baseUrl, "D2.8 submit-review × A✗", "POST", `/api/items/${iB}/article-process/submit-review`, t.adminA, 403);
  await assertCell(baseUrl, "D2.8 submit-review × Eu", "POST", `/api/items/${iA}/article-process/submit-review`, t.editorA2, 403);
  await assertCell(baseUrl, "D2.8 submit-review × F", "POST", `/api/items/${iA}/article-process/submit-review`, t.freelanceA1, 403);

  // ── Row 9: POST submit-admin-review (① deny: A✗, U, Ea, Eu, F) ──
  await assertCell(baseUrl, "D2.9 submit-admin-review × A✗", "POST", `/api/items/${iB}/submit-admin-review`, t.adminA, 403);
  await assertCell(baseUrl, "D2.9 submit-admin-review × U", "POST", `/api/items/${iA}/submit-admin-review`, t.managerA1, 403);
  await assertCell(baseUrl, "D2.9 submit-admin-review × Ea", "POST", `/api/items/${iA}/submit-admin-review`, t.editorA1, 403);
  await assertCell(baseUrl, "D2.9 submit-admin-review × Eu", "POST", `/api/items/${iA}/submit-admin-review`, t.editorA2, 403);
  await assertCell(baseUrl, "D2.9 submit-admin-review × F", "POST", `/api/items/${iA}/submit-admin-review`, t.freelanceA1, 403);
}

async function fireD3Group1(baseUrl, ctx) {
  const t = ctx.tokens;
  const eA = ctx.assignments.assignEdA1;
  const fA = ctx.assignments.assignFlA1;
  const eB = ctx.assignments.assignEdB1;
  const fB = ctx.assignments.assignFlB1;

  // ── Row 1: PUT assignments/:id/draft ──
  // hasAssignmentDraftAccess only allows assignee — O/A✓/U✓ are not assignee → 403
  const draftBody = { draft: { body: "smoke draft body" } };
  await assertCell(baseUrl, "D3.1 draft × O", "PUT", `/api/assignments/${eA}/draft`, t.owner, 403, draftBody);
  await assertCell(baseUrl, "D3.1 draft × A✓", "PUT", `/api/assignments/${eA}/draft`, t.adminA, 403, draftBody);
  await assertCell(baseUrl, "D3.1 draft × A✗", "PUT", `/api/assignments/${eB}/draft`, t.adminA, 403, draftBody);
  await assertCell(baseUrl, "D3.1 draft × U✓", "PUT", `/api/assignments/${eA}/draft`, t.managerA1, 403, draftBody);
  await assertCell(baseUrl, "D3.1 draft × Ea", "PUT", `/api/assignments/${eA}/draft`, t.editorA1, "non403", draftBody);
  await assertCell(baseUrl, "D3.1 draft × F", "PUT", `/api/assignments/${fA}/draft`, t.freelanceA1, "non403", draftBody);
  await assertCell(baseUrl, "D3.1 draft × Eu", "PUT", `/api/assignments/${eB}/draft`, t.editorA1, 403, draftBody);

  // ── Row 2: POST assignments/:id/submissions (① deny: A✗, Eu) ──
  const subBody = { action: "submit" };
  await assertCell(baseUrl, "D3.2 submissions × A✗", "POST", `/api/assignments/${eB}/submissions`, t.adminA, 403, subBody);
  await assertCell(baseUrl, "D3.2 submissions × Eu", "POST", `/api/assignments/${eB}/submissions`, t.editorA1, 403, subBody);

  // ── Row 3: POST assignments/:id/assets/upload ──
  async function testAssignUpload(name, token, assignId, expected) {
    const fd = new FormData();
    fd.append("file", new Blob([PNG_1X1], { type: "image/png" }), "test.png");
    return assertMultipart(baseUrl, name, `/api/assignments/${assignId}/assets/upload`, token, fd, expected);
  }
  await testAssignUpload("D3.3 assign-upload × O", t.owner, eA, "non403");
  await testAssignUpload("D3.3 assign-upload × A✓", t.adminA, eA, "non403");
  await testAssignUpload("D3.3 assign-upload × A✗", t.adminA, eB, 403);
  await testAssignUpload("D3.3 assign-upload × U✓", t.managerA1, eA, "non403");
  await testAssignUpload("D3.3 assign-upload × Ea", t.editorA1, eA, 403);
  await testAssignUpload("D3.3 assign-upload × F", t.freelanceA1, fA, "non403");
  await testAssignUpload("D3.3 assign-upload × Eu", t.editorA1, eB, 403);

  // ── Row 4: GET assignments/:id/deliverables/summary ──
  await assertCell(baseUrl, "D3.4 summary × O", "GET", `/api/assignments/${eA}/deliverables/summary`, t.owner, "non403");
  await assertCell(baseUrl, "D3.4 summary × A✓", "GET", `/api/assignments/${eA}/deliverables/summary`, t.adminA, "non403");
  await assertCell(baseUrl, "D3.4 summary × A✗", "GET", `/api/assignments/${eB}/deliverables/summary`, t.adminA, 403);
  await assertCell(baseUrl, "D3.4 summary × U✓", "GET", `/api/assignments/${eA}/deliverables/summary`, t.managerA1, "non403");
  await assertCell(baseUrl, "D3.4 summary × Ea", "GET", `/api/assignments/${eA}/deliverables/summary`, t.editorA1, 403);
  await assertCell(baseUrl, "D3.4 summary × F", "GET", `/api/assignments/${fA}/deliverables/summary`, t.freelanceA1, 403);
  await assertCell(baseUrl, "D3.4 summary × Eu", "GET", `/api/assignments/${eB}/deliverables/summary`, t.editorA1, 403);

  // ════════════════════════════════════════════════════
  // §5 scope tests — 17 routes × in-line vs cross-line
  // (already covered by D2/D3 A✓/A✗ above; add U✗ + extra)
  // ════════════════════════════════════════════════════

  const iA = ctx.items.itemA1.id;
  const iB = ctx.items.itemB1.id;

  // §5-11 GET /api/items/:id
  await assertCell(baseUrl, "§5 GET item × O", "GET", `/api/items/${iA}`, t.owner, "non403");
  await assertCell(baseUrl, "§5 GET item × A✓", "GET", `/api/items/${iA}`, t.adminA, "non403");
  await assertCell(baseUrl, "§5 GET item × A✗", "GET", `/api/items/${iB}`, t.adminA, 403);
  await assertCell(baseUrl, "§5 GET item × U✓", "GET", `/api/items/${iA}`, t.managerA1, "non403");
  await assertCell(baseUrl, "§5 GET item × U✗", "GET", `/api/items/${iB}`, t.managerA1, 403);
  await assertCell(baseUrl, "§5 GET item × Ea", "GET", `/api/items/${iA}`, t.editorA1, "non403");
  await assertCell(baseUrl, "§5 GET item × F", "GET", `/api/items/${iA}`, t.freelanceA1, 403);
  await assertCell(baseUrl, "§5 GET item × Eu", "GET", `/api/items/${iB}`, t.editorA1, 403);

  // §5-10 POST /api/items/:id/field-pack/return-to-clean
  await assertCell(baseUrl, "§5 return-to-clean × O", "POST", `/api/items/${iA}/field-pack/return-to-clean`, t.owner, "non403");
  await assertCell(baseUrl, "§5 return-to-clean × A✓", "POST", `/api/items/${iA}/field-pack/return-to-clean`, t.adminA, "non403");
  await assertCell(baseUrl, "§5 return-to-clean × A✗", "POST", `/api/items/${iB}/field-pack/return-to-clean`, t.adminA, 403);
  await assertCell(baseUrl, "§5 return-to-clean × U✓", "POST", `/api/items/${iA}/field-pack/return-to-clean`, t.managerA1, "non403");
  await assertCell(baseUrl, "§5 return-to-clean × U✗", "POST", `/api/items/${iB}/field-pack/return-to-clean`, t.managerA1, 403);

  // §5-16 POST /api/items/:id/assignments (scope: assignee must be in assigner's downline)
  const assignBodyInLine = { assignee_user_id: ctx.users.freelanceA1.id, assignment_kind: "field" };
  const assignBodyCrossLine = { assignee_user_id: ctx.users.editorB1.id, assignment_kind: "editorial" };
  await assertCell(baseUrl, "§5 assignments × A✓", "POST", `/api/items/${iA}/assignments`, t.adminA, "non403", assignBodyInLine);
  await assertCell(baseUrl, "§5 assignments × A✗", "POST", `/api/items/${iA}/assignments`, t.adminA, 403, assignBodyCrossLine);
  await assertCell(baseUrl, "§5 assignments × U✓", "POST", `/api/items/${iA}/assignments`, t.managerA1, "non403", assignBodyInLine);
  await assertCell(baseUrl, "§5 assignments × U✗", "POST", `/api/items/${iA}/assignments`, t.managerA1, 403, assignBodyCrossLine);

  // §5-17 POST /api/items/:id/article-editorial-assignments
  const edAssignBodyInLine = { assignee_user_id: ctx.users.editorA1.id };
  const edAssignBodyCrossLine = { assignee_user_id: ctx.users.editorB1.id };
  await assertCell(baseUrl, "§5 article-ed-assign × A✓", "POST", `/api/items/${iA}/article-editorial-assignments`, t.adminA, "non403", edAssignBodyInLine);
  await assertCell(baseUrl, "§5 article-ed-assign × A✗", "POST", `/api/items/${iA}/article-editorial-assignments`, t.adminA, 403, edAssignBodyCrossLine);
  await assertCell(baseUrl, "§5 article-ed-assign × U✓", "POST", `/api/items/${iA}/article-editorial-assignments`, t.managerA1, "non403", edAssignBodyInLine);
  await assertCell(baseUrl, "§5 article-ed-assign × U✗", "POST", `/api/items/${iA}/article-editorial-assignments`, t.managerA1, 403, edAssignBodyCrossLine);
}

// ════════════════════════════════════════════════════════════════
// ② cells — need item parked in specific production_state
// ════════════════════════════════════════════════════════════════

async function fireD1Group2(baseUrl, ctx) {
  const t = ctx.tokens;

  // D1.2 clean②: O, A on itemClean (state=collected)
  await assertCell(baseUrl, "D1.2 clean② × O", "POST", "/api/run/clean", t.owner, "non403", {});
  await assertCell(baseUrl, "D1.2 clean② × A", "POST", "/api/run/clean", t.adminA, "non403", {});

  // D1.5 review/action②: O, A on itemInReview (state=in_review + review report)
  const reviewBody2 = { content_item_id: ctx.items.itemInReview.id, action: "approve", notes: "smoke approve" };
  await assertCell(baseUrl, "D1.5 review/action② × O", "POST", "/api/review/action", t.owner, "non403", reviewBody2);
  await assertCell(baseUrl, "D1.5 review/action② × A", "POST", "/api/review/action", t.adminA, "non403", reviewBody2);

  // D1.6 review/reopen②: O, A on itemRejected (place_review_flag=rejected)
  const reopenBody2 = { content_item_id: ctx.items.itemRejected.id };
  await assertCell(baseUrl, "D1.6 review/reopen② × O", "POST", "/api/review/reopen", t.owner, "non403", reopenBody2);
  await assertCell(baseUrl, "D1.6 review/reopen② × A", "POST", "/api/review/reopen", t.adminA, "non403", reopenBody2);

  // D1.7 unpublish②: O, A on itemPublished (publication_state=published)
  await assertCell(baseUrl, "D1.7 unpublish② × O", "POST", `/api/items/${ctx.items.itemPublished.id}/unpublish`, t.owner, "200/409");
  await assertCell(baseUrl, "D1.7 unpublish② × A", "POST", `/api/items/${ctx.items.itemPublished.id}/unpublish`, t.adminA, "200/409");
}

async function fireD2Group2(baseUrl, ctx) {
  const t = ctx.tokens;
  const iE = ctx.items.itemEditorial.id;
  const iE2 = ctx.items.itemEditorial2.id;

  // D2.6 editor-work②: O, A✓, U✓, Ea on itemEditorial (state=content_in_progress + editorial assignment)
  const edWorkBody = { draft: { body: "ทดสอบเขียนบทความ " + "ก".repeat(200), draft_title: "บททดสอบ" } };
  await assertCell(baseUrl, "D2.6 editor-work② × O", "PUT", `/api/items/${iE}/editor-work`, t.owner, "non403", edWorkBody);
  await assertCell(baseUrl, "D2.6 editor-work② × A✓", "PUT", `/api/items/${iE}/editor-work`, t.adminA, "non403", edWorkBody);
  await assertCell(baseUrl, "D2.6 editor-work② × U✓", "PUT", `/api/items/${iE}/editor-work`, t.managerA1, "non403", edWorkBody);
  await assertCell(baseUrl, "D2.6 editor-work② × Ea", "PUT", `/api/items/${iE}/editor-work`, t.editorA1, "non403", edWorkBody);

  // D2.8 submit-review② × Ea — fires BEFORE D2.7 on a SEPARATE item (itemEditorial2)
  // because D2.7 transition② changes assignment state to "submitted" which breaks Gate B
  await assertCell(baseUrl, "D2.8 submit-review② × Ea", "POST", `/api/items/${iE2}/article-process/submit-review`, t.editorA1, "non403");

  // D2.7 transition②: O, A✓, U✓, Ea — drafting→drafting (no-op, state stays content_in_progress)
  const transBody2 = { status: "drafting" };
  await assertCell(baseUrl, "D2.7 transition② × O", "POST", `/api/items/${iE}/article-process/transition`, t.owner, "non403", transBody2);
  await assertCell(baseUrl, "D2.7 transition② × A✓", "POST", `/api/items/${iE}/article-process/transition`, t.adminA, "non403", transBody2);
  await assertCell(baseUrl, "D2.7 transition② × U✓", "POST", `/api/items/${iE}/article-process/transition`, t.managerA1, "non403", transBody2);
  await assertCell(baseUrl, "D2.7 transition② × Ea", "POST", `/api/items/${iE}/article-process/transition`, t.editorA1, "non403", transBody2);

  // D2.8 submit-review②: O, A✓, U✓ on itemEditorial (Ea already fired above on itemEditorial2)
  await assertCell(baseUrl, "D2.8 submit-review② × O", "POST", `/api/items/${iE}/article-process/submit-review`, t.owner, "non403");
  await assertCell(baseUrl, "D2.8 submit-review② × A✓", "POST", `/api/items/${iE}/article-process/submit-review`, t.adminA, "non403");
  await assertCell(baseUrl, "D2.8 submit-review② × U✓", "POST", `/api/items/${iE}/article-process/submit-review`, t.managerA1, "non403");
}

async function fireD3Group2(baseUrl, ctx) {
  const t = ctx.tokens;
  const fSub = ctx.assignments.assignFlA1ForSubmissions;
  const eA = ctx.assignments.assignEdA1;
  const fA = ctx.assignments.assignFlA1;

  // D3.2 submissions②: O, A✓, U✓, Ea, F
  const subBody2 = { action: "submit", article_payload_json: { additional_text: "smoke submission" } };
  await assertCell(baseUrl, "D3.2 submissions② × O", "POST", `/api/assignments/${fSub}/submissions`, t.owner, "non403", subBody2);
  await assertCell(baseUrl, "D3.2 submissions② × A✓", "POST", `/api/assignments/${fSub}/submissions`, t.adminA, "non403", subBody2);
  await assertCell(baseUrl, "D3.2 submissions② × U✓", "POST", `/api/assignments/${fSub}/submissions`, t.managerA1, "non403", subBody2);
  await assertCell(baseUrl, "D3.2 submissions② × Ea", "POST", `/api/assignments/${eA}/submissions`, t.editorA1, 403, subBody2);
  await assertCell(baseUrl, "D3.2 submissions② × F", "POST", `/api/assignments/${fSub}/submissions`, t.freelanceA1, "non403", subBody2);
}

// ════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════

async function main() {
  const ctx = testContext();
  try {
    await withServer(ctx.dbPath, async (baseUrl) => {
      await fireD1Group1(baseUrl, ctx);
      await fireD2Group1(baseUrl, ctx);
      await fireD3Group1(baseUrl, ctx);
      await fireD1Group2(baseUrl, ctx);
      await fireD2Group2(baseUrl, ctx);
      await fireD3Group2(baseUrl, ctx);
    });

    const mismatchTable = mismatches.length > 0
      ? "| route | role | expected | actual |\n|---|---|---|---|\n" + mismatches.map(m => `| ${m.route} | ${m.role} | ${m.expected} | ${m.actual} |`).join("\n")
      : "(none)";

    console.log(JSON.stringify({
      ok: failCount === 0,
      summary: { pass: passCount, fail: failCount, total: passCount + failCount },
      mismatches: mismatches.length > 0 ? mismatches : undefined,
      mismatchTable: mismatches.length > 0 ? mismatchTable : undefined,
      results,
    }, null, 2));

    if (failCount > 0) process.exitCode = 1;
  } finally {
    ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(`smoke-role-matrix-cells: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
