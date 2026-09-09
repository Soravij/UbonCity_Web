import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "item-mutation-route-access-secret";
const TEST_PREFIX = "__test-route-access-";

async function reservePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = Number(probe.address()?.port || 0);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForCollector(baseUrl, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`collector server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
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
    await run(baseUrl);
  } finally {
    if (child && child.exitCode == null) {
      child.kill();
      await once(child, "exit");
    }
  }
}

function testContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "route-access-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  const createdItemIds = [];
  const createdUserIds = [];
  const createdAssignmentIds = [];
  const createdAssetIds = [];

  const createUser = (suffix, role = "editor") => {
    const email = `${TEST_PREFIX}${suffix}-${Date.now()}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', ?)
    `).run(email, `Test ${suffix}`, role);
    const id = Number(result.lastInsertRowid || 0);
    createdUserIds.push(id);
    return { id, email };
  };

  const createItem = (title) => {
    const result = repo.createItemWithWorkflowHead({
      type: "place",
      category: "test",
      title: `${TEST_PREFIX}${title}`,
      description_raw: "test",
      source_type: "manual",
      source_name: "test",
    });
    const item = repo.getItem(result.item.id);
    createdItemIds.push(item.id);
    return item;
  };

  const createEditorialAssignment = (itemId, assigneeUserId, state = "assigned") => {
    const assignment = repo.createAssignment({
      content_item_id: itemId,
      assignee_user_id: assigneeUserId,
      assignment_kind: "editorial",
      state,
    }, assigneeUserId);
    createdAssignmentIds.push(assignment.id);
    return assignment;
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

  const cleanup = () => {
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

  return { db, repo, createUser, createItem, createEditorialAssignment, createContentAsset, cleanup, dbPath };
}

test("ensureItemMutationAccess route-level — allowAssignedSelf", async (t) => {

  await t.test("editor + editorial assignment state=assigned → PATCH assets/:assetId/role not 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-ok", "editor");
      const item = ctx.createItem("item-ok");
      ctx.createEditorialAssignment(item.id, user.id, "assigned");
      const asset = ctx.createContentAsset(item.id);
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/assets/${asset.assetTableId}/role`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ role: "cover" }),
        });
        assert.notEqual(res.status, 403, `should not be 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editor without assignment → PATCH assets/:assetId/role returns 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-noassign", "editor");
      const item = ctx.createItem("item-noassign");
      const asset = ctx.createContentAsset(item.id);
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/assets/${asset.assetTableId}/role`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ role: "cover" }),
        });
        assert.equal(res.status, 403, `expected 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editor + editorial assignment state=in_progress → PATCH reference-media/:id/selected not 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-inprog", "editor");
      const item = ctx.createItem("item-editor-inprog");
      const assignment = ctx.createEditorialAssignment(item.id, user.id, "in_progress");
      assert.ok(assignment?.id, "assignment must be created");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const fakeMediaId = "fake-ref-media-id";
        const res = await fetch(`${baseUrl}/api/items/${item.id}/reference-media/${fakeMediaId}/selected`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ selected: true }),
        });
        const body = await res.json().catch(() => ({}));
        assert.notEqual(res.status, 403, `should not be 403, got ${res.status}: ${JSON.stringify(body)}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("owner → PATCH assets/:assetId/role not 403 (control — harness works)", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("owner-ctrl", "owner");
      const item = ctx.createItem("item-owner");
      const asset = ctx.createContentAsset(item.id);
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "owner");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/assets/${asset.assetTableId}/role`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ role: "cover" }),
        });
        assert.notEqual(res.status, 403, `owner should never get 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

});
