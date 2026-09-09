import assert from "node:assert/strict";
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
const authSecret = "role-matrix-smoke-secret";
const TEST_PREFIX = "__test-rm-smoke-";

const results = [];
let passCount = 0;
let failCount = 0;

function record(name, pass, detail = "") {
  if (pass) {
    passCount++;
    results.push({ name, status: "PASS", detail });
  } else {
    failCount++;
    results.push({ name, status: "FAIL", detail });
  }
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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`collector exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("collector server did not become ready");
}

function makeToken(userId, email, role) {
  return jwt.sign(
    { id: userId, email, display_name: `Test ${role}`, role },
    authSecret,
    { issuer: "uboncity-backend", audience: "uboncity-collector" }
  );
}

async function withServer(dbPath, run) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child = null;
  try {
    child = spawn(process.execPath, [serverPath], {
      cwd: collectorRoot,
      env: {
        ...process.env,
        COLLECTOR_ROOT: collectorRoot,
        DB_PATH: dbPath,
        PORT: String(port),
        BACKEND_JWT_SECRET: authSecret,
      },
      stdio: "ignore",
    });
    await waitForCollector(baseUrl, child);
    await run(baseUrl, port);
  } finally {
    if (child && child.exitCode == null) {
      child.kill();
      await once(child, "exit");
    }
  }
}

function testContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-smoke-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  const createdItemIds = [];
  const createdUserIds = [];
  const createdAssignmentIds = [];
  const createdAssetIds = [];
  const createdDraftIds = [];

  const createUser = (suffix, role = "editor", managerUserId = null) => {
    const email = `${TEST_PREFIX}${suffix}-${Date.now()}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role, managed_by_user_id)
      VALUES (?, ?, 'hash', ?, ?)
    `).run(email, `Test ${suffix}`, role, managerUserId);
    const id = Number(result.lastInsertRowid || 0);
    createdUserIds.push(id);
    return { id, email };
  };

  const createItem = (title, type = "place", claimedByUserId = null) => {
    const result = repo.createItemWithWorkflowHead({
      type,
      category: "test",
      title: `${TEST_PREFIX}${title}`,
      description_raw: "test description",
      source_type: "manual",
      source_name: "test",
    });
    const item = repo.getItem(result.item.id);
    createdItemIds.push(item.id);
    if (claimedByUserId) {
      db.prepare("UPDATE content_items SET claimed_by_user_id=?, claimed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(claimedByUserId, item.id);
    }
    return item;
  };

  const setProductionState = (itemId, state) => {
    db.prepare(`
      UPDATE content_workflow_models SET production_state = ? WHERE content_item_id = ?
    `).run(state, itemId);
  };

  const setArticleProcessState = (itemId, state) => {
    const uid = `${TEST_PREFIX}ap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT OR REPLACE INTO content_workflow_models (content_item_id, production_state, article_process_state, updated_by, last_actor_email)
      SELECT content_item_id, production_state, ?, 'smoke-test', 'smoke@test'
      FROM content_workflow_models WHERE content_item_id = ?
    `).run(state, itemId);
  };

  const createEditorialAssignment = (itemId, assigneeUserId, state = "assigned") => {
    const uid = `${TEST_PREFIX}assign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = db.prepare(`
      INSERT INTO content_assignments (assignment_uid, content_item_id, assignee_user_id, assignment_kind, state)
      VALUES (?, ?, ?, 'editorial', ?)
    `).run(uid, itemId, assigneeUserId, state);
    const id = Number(result.lastInsertRowid || 0);
    createdAssignmentIds.push(id);
    return { id, uid };
  };

  const createContentAsset = (itemId) => {
    const assetUid = `${TEST_PREFIX}asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const assetResult = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type)
      VALUES (?, 'local', 'test/path', 'test.jpg', 'image/jpeg')
    `).run(assetUid);
    const assetTableId = Number(assetResult.lastInsertRowid || 0);
    createdAssetIds.push(assetTableId);
    const caResult = db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean)
      VALUES (?, ?, 'gallery', 1)
    `).run(itemId, assetTableId);
    return { assetTableId, contentAssetId: Number(caResult.lastInsertRowid || 0) };
  };

  const createDraft = (itemId) => {
    const uid = `${TEST_PREFIX}draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = db.prepare(`
      INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body, status)
      VALUES (?, ?, 'Smoke Draft', 'smoke body', 'generated')
    `).run(itemId, uid);
    const id = Number(result.lastInsertRowid || 0);
    createdDraftIds.push(id);
    return id;
  };

  const createFieldPack = (itemId) => {
    const fpResult = db.prepare(`
      INSERT INTO field_packs (content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json, updated_by)
      VALUES (?, 'ready_for_field', 1, 'smoke', '[]', '[]', '[]', '[]', '[]', '[]', 'smoke')
    `).run(itemId);
    const fpId = Number(fpResult.lastInsertRowid || 0);
    db.prepare(`UPDATE content_workflow_models SET current_field_pack_id = ? WHERE content_item_id = ?`).run(fpId, itemId);
    return fpId;
  };

  const cleanup = () => {
    for (const id of createdDraftIds) {
      try { db.prepare("DELETE FROM content_drafts WHERE id = ?").run(id); } catch {}
    }
    for (const id of createdAssetIds) {
      try { db.prepare("DELETE FROM content_assets WHERE asset_id = ?").run(id); } catch {}
      try { db.prepare("DELETE FROM asset_variants WHERE asset_id = ?").run(id); } catch {}
      try { db.prepare("DELETE FROM assets WHERE id = ?").run(id); } catch {}
    }
    for (const id of createdAssignmentIds) {
      try { db.prepare("DELETE FROM content_workflow_transitions WHERE assignment_id = ?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_assignments WHERE id = ?").run(id); } catch {}
    }
    for (const id of createdItemIds) {
      try { db.prepare("DELETE FROM field_packs WHERE content_item_id = ?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id = ?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_workflow_models WHERE content_item_id = ?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_assets WHERE content_item_id = ?").run(id); } catch {}
      try { db.prepare("DELETE FROM content_items WHERE id = ?").run(id); } catch {}
    }
    for (const id of createdUserIds) {
      try { db.prepare("DELETE FROM users WHERE id = ?").run(id); } catch {}
    }
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  return { db, repo, createUser, createItem, setProductionState, setArticleProcessState,
    createEditorialAssignment, createContentAsset, createDraft, createFieldPack, cleanup, dbPath };
}

// F1: editor with assignment → asset/reference-media routes should NOT be 403
async function testF1(baseUrl, tokens) {
  const routes = [
    { method: "PATCH", path: (itemId, assetId) => `/api/items/${itemId}/assets/${assetId}/role`, body: { role: "cover" }, label: "assets/:id/role" },
    { method: "PATCH", path: (itemId, assetId) => `/api/items/${itemId}/assets/${assetId}/selected`, body: { selected: true }, label: "assets/:id/selected" },
    { method: "PATCH", path: (itemId, assetId) => `/api/items/${itemId}/assets/${assetId}/caption`, body: { caption: "test" }, label: "assets/:id/caption" },
    { method: "PATCH", path: (itemId) => `/api/items/${itemId}/reference-media/fake-ref-id/selected`, body: { selected: true }, label: "reference-media/:id/selected" },
  ];

  for (const route of routes) {
    const res = await fetch(`${baseUrl}${route.path(tokens.itemId, tokens.assetId)}`, {
      method: route.method,
      headers: { authorization: `Bearer ${tokens.editorToken}`, "content-type": "application/json" },
      body: JSON.stringify(route.body),
    });
    record(`F1: editor+assignment ${route.label} not 403`, res.status !== 403, `status=${res.status}`);
  }

  // control: editor WITHOUT assignment → should be 403
  const noAssignRes = await fetch(`${baseUrl}/api/items/${tokens.itemIdNoAssignment}/assets/${tokens.assetIdNoAssignment}/role`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${tokens.editorNoAssignToken}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "cover" }),
  });
  record("F1: editor NO assignment → assets/role 403", noAssignRes.status === 403, `status=${noAssignRes.status}`);

  // control: owner → should NOT be 403
  const ownerRes = await fetch(`${baseUrl}/api/items/${tokens.itemId}/assets/${tokens.assetId}/role`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${tokens.ownerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "cover" }),
  });
  record("F1: owner → assets/role not 403", ownerRes.status !== 403, `status=${ownerRes.status}`);
}

// F2: editor submit-review — Gate A/B state intersection
async function testF2(baseUrl, tokens) {
  const submitPath = (itemId) => `/api/items/${itemId}/article-process/submit-review`;

  // states that should PASS (assigned, in_progress, revision_requested)
  for (const state of ["assigned", "in_progress", "revision_requested"]) {
    const res = await fetch(`${baseUrl}${submitPath(tokens.f2Items[state])}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.editorToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    record(`F2: editor submit-review state=${state} not 403`, res.status !== 403, `status=${res.status}`);
  }

  // states that should FAIL (submitted, resubmitted)
  for (const state of ["submitted", "resubmitted"]) {
    const res = await fetch(`${baseUrl}${submitPath(tokens.f2Items[state])}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.editorToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    record(`F2: editor submit-review state=${state} → 403`, res.status === 403, `status=${res.status}`);
  }

  // control: no assignment → 403
  const noAssignRes = await fetch(`${baseUrl}${submitPath(tokens.f2Items.noAssignment)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.editorToken}`, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  record("F2: editor no assignment → submit-review 403", noAssignRes.status === 403, `status=${noAssignRes.status}`);

  // control: owner → not 403
  const ownerRes = await fetch(`${baseUrl}${submitPath(tokens.f2Items.assigned)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.ownerToken}`, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  record("F2: owner → submit-review not 403", ownerRes.status !== 403, `status=${ownerRes.status}`);
}

// F3: return-to-clean blocked when editorial assignment is in OPEN_FIELD_ROUND_STATES
async function testF3(baseUrl, tokens) {
  const openStates = ["assigned", "in_progress", "submitted", "resubmitted", "revision_requested", "accepted"];
  for (const state of openStates) {
    const res = await fetch(`${baseUrl}/api/items/${tokens.f3Items[state]}/field-pack/return-to-clean`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ comment: `smoke F3 state=${state}` }),
    });
    record(`F3: return-to-clean blocked (409) when assignment=${state}`, res.status === 409, `status=${res.status}`);
  }

  // control: no open assignment → should succeed (200)
  const cleanRes = await fetch(`${baseUrl}/api/items/${tokens.f3Items.clean}/field-pack/return-to-clean`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.ownerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ comment: "smoke F3 clean" }),
  });
  const cleanBody = await cleanRes.json().catch(() => ({}));
  record("F3: return-to-clean succeeds when no open assignment", cleanRes.ok, `status=${cleanRes.status} body=${JSON.stringify(cleanBody)}`);
}

// :7355-7403: freelance blocked on routes outside allowlist
async function testFreelanceMiddleware(baseUrl, tokens) {
  // Routes that should be BLOCKED (not in allowlist)
  const blockedRoutes = [
    { method: "GET", path: "/api/workflow-states", label: "GET /workflow-states" },
    { method: "GET", path: `/api/items/${tokens.itemId}`, label: "GET /items/:id" },
    { method: "GET", path: `/api/items/${tokens.itemId}/intelligence-model/latest`, label: "GET /items/:id/intelligence-model" },
    { method: "GET", path: `/api/items/${tokens.itemId}/readiness/latest`, label: "GET /items/:id/readiness" },
    { method: "GET", path: `/api/items/${tokens.itemId}/search-enrichment`, label: "GET /items/:id/search-enrichment" },
    { method: "GET", path: `/api/items/${tokens.itemId}/content-direction`, label: "GET /items/:id/content-direction" },
    { method: "GET", path: `/api/items/${tokens.itemId}/evidence-blocks`, label: "GET /items/:id/evidence-blocks" },
    { method: "GET", path: `/api/items/${tokens.itemId}/approved-context`, label: "GET /items/:id/approved-context" },
    { method: "GET", path: `/api/items/${tokens.itemId}/reference-media`, label: "GET /items/:id/reference-media" },
    { method: "GET", path: `/api/items/${tokens.itemId}/export-readiness`, label: "GET /items/:id/export-readiness" },
    { method: "GET", path: `/api/items/${tokens.itemId}/field-pack/current`, label: "GET /items/:id/field-pack/current (no brief access)" },
  ];

  for (const route of blockedRoutes) {
    const res = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: { authorization: `Bearer ${tokens.freelanceToken}` },
    });
    const body = await res.json().catch(() => ({}));
    const isBlocked = res.status === 403 && /freelance access is limited/i.test(String(body?.error || ""));
    record(`:7355 freelance blocked: ${route.label}`, isBlocked, `status=${res.status}`);
  }

  // Routes that should be ALLOWED (in allowlist)
  const assignmentId = tokens.assignmentIdForFreelance;
  const allowedRoutes = [
    { method: "GET", path: "/api/auth/me", label: "GET /auth/me" },
    { method: "GET", path: "/api/assignments/mine", label: "GET /assignments/mine" },
    { method: "GET", path: `/api/assignments/${assignmentId}`, label: "GET /assignments/:id" },
    { method: "GET", path: `/api/assignments/${assignmentId}/draft`, label: "GET /assignments/:id/draft" },
    { method: "GET", path: `/api/assignments/${assignmentId}/submissions`, label: "GET /assignments/:id/submissions" },
  ];

  for (const route of allowedRoutes) {
    const res = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: { authorization: `Bearer ${tokens.freelanceToken}` },
    });
    const isFreelanceBlocked = res.status === 403 && /freelance access/i.test(
      await res.text().catch(() => "")
    );
    record(`:7355 freelance allowed: ${route.label}`, !isFreelanceBlocked, `status=${res.status}`);
  }
}

// POST /api/collect: owner+admin can create; editor/freelance blocked
async function testCollectAuth(baseUrl, tokens) {
  // owner should succeed
  const ownerRes = await fetch(`${baseUrl}/api/collect`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.ownerToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      url: `https://smoke-test-${Date.now()}.example.com`,
      title: `Smoke collect owner`,
      type: "place",
    }),
  });
  record("POST /api/collect owner → 200", ownerRes.ok, `status=${ownerRes.status}`);

  // editor blocked by route handler (:14040 requires owner|admin)
  const editorRes = await fetch(`${baseUrl}/api/collect`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.editorToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      url: `https://smoke-test-editor-${Date.now()}.example.com`,
      title: `Smoke collect editor`,
      type: "place",
    }),
  });
  const editorBody = await editorRes.json().catch(() => ({}));
  const editorBlocked = editorRes.status === 403 && /admin\|owner/i.test(String(editorBody?.requires || ""));
  record("POST /api/collect editor → 403 (requires admin|owner)", editorBlocked, `status=${editorRes.status}`);

  // freelance blocked by :7355 middleware
  const freelanceRes = await fetch(`${baseUrl}/api/collect`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokens.freelanceToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      url: `https://smoke-test-freelance-${Date.now()}.example.com`,
      title: `Smoke collect freelance`,
      type: "place",
    }),
  });
  const freelanceBody = await freelanceRes.text().catch(() => "");
  const freelanceBlocked = freelanceRes.status === 403 && /freelance access is limited/i.test(freelanceBody);
  record("POST /api/collect freelance → blocked by :7355", freelanceBlocked, `status=${freelanceRes.status}`);
}

async function main() {
  const ctx = testContext();
  try {
    // Create users
    const owner = ctx.createUser("owner", "owner");
    const manager = ctx.createUser("manager", "user", owner.id);
    const editor = ctx.createUser("editor", "editor", manager.id);
    const editorNoAssign = ctx.createUser("editor-noassign", "editor", manager.id);
    const freelance = ctx.createUser("freelance", "freelance", manager.id);

    const ownerToken = makeToken(owner.id, owner.email, "owner");
    const editorToken = makeToken(editor.id, editor.email, "editor");
    const editorNoAssignToken = makeToken(editorNoAssign.id, editorNoAssign.email, "editor");
    const freelanceToken = makeToken(freelance.id, freelance.email, "freelance");

    // F1 items
    const f1Item = ctx.createItem("f1-item");
    const f1Asset = ctx.createContentAsset(f1Item.id);
    ctx.createEditorialAssignment(f1Item.id, editor.id, "assigned");

    const f1ItemNoAssign = ctx.createItem("f1-item-noassign");
    const f1AssetNoAssign = ctx.createContentAsset(f1ItemNoAssign.id);

    // F2 items: one per assignment state + one without
    const f2States = ["assigned", "in_progress", "revision_requested", "submitted", "resubmitted"];
    const f2Items = {};
    for (const state of f2States) {
      const item = ctx.createItem(`f2-${state}`);
      ctx.createDraft(item.id);
      ctx.createEditorialAssignment(item.id, editor.id, state);
      f2Items[state] = item.id;
    }
    const f2ItemNoAssign = ctx.createItem("f2-noassign");
    ctx.createDraft(f2ItemNoAssign.id);
    f2Items.noAssignment = f2ItemNoAssign.id;

    // F3 items: one per OPEN_FIELD_ROUND_STATE + one clean
    const openStates = ["assigned", "in_progress", "submitted", "resubmitted", "revision_requested", "accepted"];
    const f3Items = {};
    for (const state of openStates) {
      const item = ctx.createItem(`f3-${state}`, "place", owner.id);
      ctx.createFieldPack(item.id);
      ctx.setProductionState(item.id, "in_review");
      ctx.createEditorialAssignment(item.id, editor.id, state);
      f3Items[state] = item.id;
    }
    const f3ItemClean = ctx.createItem("f3-clean", "place", owner.id);
    ctx.createFieldPack(f3ItemClean.id);
    ctx.setProductionState(f3ItemClean.id, "in_review");
    f3Items.clean = f3ItemClean.id;

    // Freelance assignment for allowlist routes
    const freelanceAssignItem = ctx.createItem("freelance-assign");
    const freelanceAssignment = ctx.createEditorialAssignment(freelanceAssignItem.id, freelance.id, "assigned");

    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const tokenBundle = {
        ownerToken,
        editorToken,
        editorNoAssignToken,
        freelanceToken,
        itemId: f1Item.id,
        assetId: f1Asset.assetTableId,
        itemIdNoAssignment: f1ItemNoAssign.id,
        assetIdNoAssignment: f1AssetNoAssign.assetTableId,
        f2Items,
        f3Items,
        assignmentIdForFreelance: freelanceAssignment.id,
      };

      await testF1(baseUrl, tokenBundle);
      await testF2(baseUrl, tokenBundle);
      await testF3(baseUrl, tokenBundle);
      await testFreelanceMiddleware(baseUrl, tokenBundle);
      await testCollectAuth(baseUrl, tokenBundle);
    });

    console.log(JSON.stringify({
      ok: failCount === 0,
      summary: { pass: passCount, fail: failCount, total: passCount + failCount },
      results,
    }, null, 2));

    if (failCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(`smoke-role-matrix: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
