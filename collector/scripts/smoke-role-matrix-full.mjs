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
const authSecret = "role-matrix-full-smoke-secret";
const TEST_PREFIX = "__test-rm-full-";

const results = [];
let passCount = 0;
let failCount = 0;

function record(name, pass, detail = "") {
  if (pass) { passCount++; results.push({ name, status: "PASS", detail }); }
  else { failCount++; results.push({ name, status: "FAIL", detail }); }
  console.error(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
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
      env: { ...process.env, COLLECTOR_ROOT: collectorRoot, DB_PATH: dbPath, PORT: String(port), BACKEND_JWT_SECRET: authSecret },
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

async function getProdState(baseUrl, itemId, token) {
  const res = await api(baseUrl, "GET", `/api/items/${itemId}/workflow-model`, token);
  if (!res.ok) return null;
  const data = await res.json();
  return data.model?.production_state;
}

function testContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-full-"));
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

  const createItem = (title, type, claimedByUserId, prodState) => {
    const result = repo.createItemWithWorkflowHead({
      type: type || "place",
      category: "test",
      title: `${TEST_PREFIX}${title}`,
      description_raw: "test description",
      source_type: "manual",
      source_name: "smoke-test",
    });
    const item = repo.getItem(result.item.id);
    createdItemIds.push(item.id);
    if (claimedByUserId) {
      db.prepare("UPDATE content_items SET claimed_by_user_id=?, claimed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(claimedByUserId, item.id);
    }
    if (prodState) {
      db.prepare("UPDATE content_workflow_models SET production_state=? WHERE content_item_id=?")
        .run(prodState, item.id);
    }
    return item;
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

  const createDraft = (itemId, title, body) => {
    const uid = `${TEST_PREFIX}draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body, status) VALUES (?, ?, ?, ?, 'generated')`)
      .run(itemId, uid, title || "Smoke Draft", body || "smoke body");
  };

  const createAssignmentWorkAsset = (assignmentId, contentItemId) => {
    const assetUid = `${TEST_PREFIX}work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const assetResult = db.prepare(`INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type) VALUES (?, 'local', 'test/path', 'shot_01.jpg', 'image/jpeg')`)
      .run(assetUid);
    const assetId = Number(assetResult.lastInsertRowid || 0);
    createdAssetIds.push(assetId);
    db.prepare(`INSERT INTO content_assets (content_item_id, asset_id, assignment_id, assignment_surface, assignment_media_type, assignment_round, role, selected_in_clean) VALUES (?, ?, ?, 'assignment_work', 'image', 1, 'gallery', 1)`)
      .run(contentItemId, assetId, assignmentId);
    return assetId;
  };

  const itemA = createItem("lifecycle-A", "place", managerA1.id, "collected");
  createFieldPack(itemA.id);
  const itemBField = createItem("assign-field-B1", "place", managerA1.id, "ready_for_content");
  createFieldPack(itemBField.id);
  const itemBEditorial = createItem("assign-ed-B2", "place", managerA1.id, "ready_for_writer");
  createFieldPack(itemBEditorial.id);
  createDraft(itemBEditorial.id, "Editorial Draft", "editorial body content for smoke test");
  const itemChainB = createItem("chainB-iso", "place", managerB1.id, "collected");
  const itemChainA2 = createItem("chainA2-iso", "place", managerA2.id, "collected");
  const itemEditorB1 = createItem("edB1-iso", "place", managerB1.id, "ready_for_writer");
  createFieldPack(itemEditorB1.id);
  const edB1Uid = `${TEST_PREFIX}edB1-${Date.now()}`;
  const edB1Result = db.prepare(`INSERT INTO content_assignments (assignment_uid, content_item_id, assignee_user_id, assignment_kind, state) VALUES (?, ?, ?, 'editorial', 'assigned')`)
    .run(edB1Uid, itemEditorB1.id, editorB1.id);
  createdAssignmentIds.push(Number(edB1Result.lastInsertRowid || 0));
  const itemCross = createItem("cross-assign-D", "place", editorA1.id, "ready_for_content");
  createFieldPack(itemCross.id);

  const users = { owner, adminA, adminB, managerA1, managerA2, managerB1, managerB2, editorA1, freelanceA1, editorA2, freelanceA2, editorB1, freelanceB1, editorB2, freelanceB2 };
  const items = { itemA, itemBField, itemBEditorial, itemChainB, itemChainA2, itemEditorB1, itemCross };

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
      try { db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_items WHERE id=?").run(id); } catch {}
    }
    for (const id of createdUserIds) {
      try { db.prepare("DELETE FROM users WHERE id=?").run(id); } catch {}
    }
    try { db.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  };

  return { db, repo, dbPath, tempDir, tokens, users, items, createFieldPack, createDraft, createAssignmentWorkAsset, cleanup };
}

async function testGroupA(baseUrl, ctx) {
  const t = ctx.tokens;
  const itemId = ctx.items.itemA.id;

  async function step(name, method, pathStr, token, body) {
    const res = await api(baseUrl, method, pathStr, token, body);
    record(`A: ${name}`, res.ok, `status=${res.status}`);
    let json = null;
    try { const text = await res.text(); json = text ? JSON.parse(text) : null; } catch {}
    return { res, json };
  }

  async function verify(name, expected) {
    const state = await getProdState(baseUrl, itemId, t.owner);
    record(`A: verify ${name}`, state === expected, `expected=${expected} actual=${state}`);
  }

  await step("collected→analyzed", "PUT", `/api/items/${itemId}/workflow-model`, t.owner, { production_state: "analyzed", last_transition_note: "smoke A" });
  await verify("analyzed", "analyzed");

  await step("analyzed→generated", "PUT", `/api/items/${itemId}/workflow-model`, t.owner, { production_state: "generated", last_transition_note: "smoke A" });
  await verify("generated", "generated");

  await step("generated→ready_for_content", "PUT", `/api/items/${itemId}/workflow-model`, t.owner, { production_state: "ready_for_content", last_transition_note: "smoke A" });
  await verify("ready_for_content", "ready_for_content");

  const faRes = await step("field assign freelanceA1", "POST", `/api/items/${itemId}/assignments`, t.adminA, {
    assignee_user_id: ctx.users.freelanceA1.id, assignment_kind: "field",
  });
  const fieldAssignId = faRes.json?.assignment?.id;

  await step("→field_working", "PUT", `/api/items/${itemId}/workflow-model`, t.adminA, { production_state: "field_working", last_transition_note: "smoke A" });
  await verify("field_working", "field_working");

  await step("field in_progress", "PATCH", `/api/assignments/${fieldAssignId}/state`, t.adminA, { state: "in_progress" });

  ctx.createAssignmentWorkAsset(fieldAssignId, itemId);

  await step("field submit", "POST", `/api/assignments/${fieldAssignId}/submissions`, t.freelanceA1, { action: "submit", article_payload_json: { additional_text: "smoke test field submission" } });

  await step("→field_review", "PUT", `/api/items/${itemId}/workflow-model`, t.adminA, { production_state: "field_review", last_transition_note: "smoke A" });
  await verify("field_review", "field_review");

  await step("accept field→ready_for_writer", "PATCH", `/api/assignments/${fieldAssignId}/state`, t.adminA, { action: "accept_submission" });
  await verify("ready_for_writer", "ready_for_writer");

  const eaRes = await step("editorial assign editorA1", "POST", `/api/items/${itemId}/article-editorial-assignments`, t.adminA, {
    assignee_user_id: ctx.users.editorA1.id,
  });
  await verify("writing_assigned", "writing_assigned");

  await step("save draft", "PUT", `/api/items/${itemId}/editor-work`, t.editorA1, {
    draft: { body: "Smoke test article body content for lifecycle test", draft_title: "Smoke Lifecycle Article" },
  });

  await step("→writing", "PUT", `/api/items/${itemId}/workflow-model`, t.adminA, { production_state: "writing", last_transition_note: "smoke A" });
  await verify("writing", "writing");

  await step("submit-review→in_review", "POST", `/api/items/${itemId}/article-process/submit-review`, t.editorA1, {});
  await verify("in_review", "in_review");

  const readyForSyncRes = await api(baseUrl, "POST", `/api/items/${itemId}/article-process/transition`, t.adminA, { status: "ready_for_sync" });
  record("A: quality gate blocks as expected", readyForSyncRes.status === 409, `status=${readyForSyncRes.status}`);

  await step("→in_review (recover)", "PUT", `/api/items/${itemId}/workflow-model`, t.adminA, { production_state: "in_review", last_transition_note: "smoke A recover" });

  await step("→ready_for_publish", "PUT", `/api/items/${itemId}/workflow-model`, t.adminA, { production_state: "ready_for_publish", publication_state: "approved", last_transition_note: "smoke A" });
  await verify("ready_for_publish", "ready_for_publish");

  await step("→submitted_for_admin_review", "PUT", `/api/items/${itemId}/workflow-model`, t.adminA, { production_state: "submitted_for_admin_review", publication_state: "approved", last_transition_note: "smoke A" });
  await verify("submitted_for_admin_review", "submitted_for_admin_review");

  await step("→completed+published", "PUT", `/api/items/${itemId}/workflow-model`, t.adminA, {
    production_state: "completed", publication_state: "published", last_transition_note: "smoke A published",
  });
  await verify("completed", "completed");
}

async function testGroupB(baseUrl, ctx) {
  const t = ctx.tokens;

  async function testB1Field() {
    const itemId = ctx.items.itemBField.id;

    const res = await api(baseUrl, "POST", `/api/items/${itemId}/assignments`, t.adminA, {
      assignee_user_id: ctx.users.freelanceA1.id, assignment_kind: "field",
    });
    record("B1: field assign", res.ok, `status=${res.status}`);
    const assignId = res.ok ? (await res.json()).assignment?.id : null;

    let r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { state: "in_progress" });
    record("B1: in_progress", r.ok, `status=${r.status}`);

    ctx.createAssignmentWorkAsset(assignId, itemId);

    r = await api(baseUrl, "POST", `/api/assignments/${assignId}/submissions`, t.freelanceA1, { action: "submit", article_payload_json: { additional_text: "smoke B1 submit" } });
    record("B1: submit", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { action: "request_revision" });
    record("B1: request_revision", r.ok, `status=${r.status}`);

    ctx.createAssignmentWorkAsset(assignId, itemId);

    r = await api(baseUrl, "POST", `/api/assignments/${assignId}/submissions`, t.freelanceA1, { action: "resubmit", article_payload_json: { additional_text: "smoke B1 resubmit" } });
    record("B1: resubmit", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { action: "accept_submission" });
    record("B1: accept", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.owner, { action: "close_assignment" });
    record("B1: close", r.ok, `status=${r.status}`);

    const finalRes = await api(baseUrl, "GET", `/api/assignments/${assignId}`, t.owner);
    const finalData = finalRes.ok ? await finalRes.json() : null;
    record("B1: verify closed", finalData?.assignment?.state === "closed", `state=${finalData?.assignment?.state}`);
  }

  async function testB2Editorial() {
    const itemId = ctx.items.itemBEditorial.id;

    const res = await api(baseUrl, "POST", `/api/items/${itemId}/article-editorial-assignments`, t.adminA, {
      assignee_user_id: ctx.users.editorA1.id,
    });
    record("B2: editorial assign", res.ok, `status=${res.status}`);
    const assignId = res.ok ? (await res.json()).assignment?.id : null;

    let r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { state: "in_progress" });
    record("B2: in_progress", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "POST", `/api/items/${itemId}/article-process/submit-review`, t.editorA1, {});
    record("B2: submit-review", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "POST", `/api/items/${itemId}/article-editorial-assignments/${assignId}/request-revision`, t.adminA, {});
    record("B2: request_revision", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "POST", `/api/items/${itemId}/article-process/submit-review`, t.editorA1, {});
    record("B2: resubmit-review", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.adminA, { action: "accept_submission" });
    record("B2: accept", r.ok, `status=${r.status}`);

    r = await api(baseUrl, "PATCH", `/api/assignments/${assignId}/state`, t.owner, { action: "close_assignment" });
    record("B2: close", r.ok, `status=${r.status}`);

    const finalRes = await api(baseUrl, "GET", `/api/assignments/${assignId}`, t.owner);
    const finalData = finalRes.ok ? await finalRes.json() : null;
    record("B2: verify closed", finalData?.assignment?.state === "closed", `state=${finalData?.assignment?.state}`);
  }

  await testB1Field();
  await testB2Editorial();
}

async function testGroupC(baseUrl, ctx) {
  const t = ctx.tokens;

  let r = await api(baseUrl, "GET", `/api/items/${ctx.items.itemChainB.id}`, t.adminA);
  record("C: adminA→chainB item 403", r.status === 403, `status=${r.status}`);

  r = await api(baseUrl, "GET", `/api/items/${ctx.items.itemChainA2.id}`, t.managerA1);
  record("C: managerA1→managerA2 item 403", r.status === 403, `status=${r.status}`);

  r = await api(baseUrl, "GET", `/api/items/${ctx.items.itemEditorB1.id}`, t.editorA1);
  record("C: editorA1→editorB1 item 403", r.status === 403, `status=${r.status}`);
}

async function testGroupD(baseUrl, ctx) {
  const t = ctx.tokens;
  const itemId = ctx.items.itemCross.id;

  const r = await api(baseUrl, "POST", `/api/items/${itemId}/assignments`, t.managerA1, {
    assignee_user_id: ctx.users.editorB1.id, assignment_kind: "editorial",
  });
  record("D: managerA1→editorB1 cross-chain rejected", r.status === 403, `status=${r.status}`);
}

async function main() {
  const ctx = testContext();
  try {
    await withServer(ctx.dbPath, async (baseUrl) => {
      await testGroupA(baseUrl, ctx);
      await testGroupB(baseUrl, ctx);
      await testGroupC(baseUrl, ctx);
      await testGroupD(baseUrl, ctx);
    });

    console.log(JSON.stringify({
      ok: failCount === 0,
      summary: { pass: passCount, fail: failCount, total: passCount + failCount },
      results,
    }, null, 2));

    if (failCount > 0) process.exitCode = 1;
  } finally {
    ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(`smoke-role-matrix-full: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
