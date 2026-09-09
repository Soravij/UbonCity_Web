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
const authSecret = "editor-submit-review-gate-secret";
const TEST_PREFIX = "__test-submit-review-";

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "submit-review-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  const createdItemIds = [];
  const createdUserIds = [];
  const createdAssignmentIds = [];
  const createdDraftIds = [];

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

  const createDraftWithBody = (itemId) => {
    const uid = `${TEST_PREFIX}draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = db.prepare(`
      INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body, status)
      VALUES (?, ?, ?, ?, 'generated')
    `).run(itemId, uid, "Test Draft", "test body content");
    const draftId = Number(result.lastInsertRowid || 0);
    createdDraftIds.push(draftId);
    return draftId;
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

  const cleanup = () => {
    for (const id of createdDraftIds) {
      try { db.prepare("DELETE FROM content_drafts WHERE id = ?").run(id); } catch {}
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

  return { db, repo, createUser, createItem, createDraftWithBody, createEditorialAssignment, cleanup, dbPath };
}

test("editor submit-review route — Gate A / Gate B state intersection", async (t) => {

  await t.test("editor + editorial assignment state=assigned → POST submit-review not 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-assigned", "editor");
      const item = ctx.createItem("item-assigned");
      ctx.createDraftWithBody(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "assigned");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/article-process/submit-review`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.notEqual(res.status, 403, `should not be 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editor + editorial assignment state=in_progress → POST submit-review not 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-inprog", "editor");
      const item = ctx.createItem("item-inprog");
      ctx.createDraftWithBody(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "in_progress");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/article-process/submit-review`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.notEqual(res.status, 403, `should not be 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editor + editorial assignment state=revision_requested → POST submit-review not 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-revreq", "editor");
      const item = ctx.createItem("item-revreq");
      ctx.createDraftWithBody(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "revision_requested");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/article-process/submit-review`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.notEqual(res.status, 403, `should not be 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editor + editorial assignment state=submitted → POST submit-review returns 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-submitted", "editor");
      const item = ctx.createItem("item-submitted");
      ctx.createDraftWithBody(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "submitted");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/article-process/submit-review`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 403, `expected 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editor without editorial assignment → POST submit-review returns 403", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("editor-noassign", "editor");
      const item = ctx.createItem("item-noassign");
      ctx.createDraftWithBody(item.id);
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "editor");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/article-process/submit-review`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 403, `expected 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("owner → POST submit-review not 403 (control)", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("owner-ctrl", "owner");
      const item = ctx.createItem("item-owner");
      ctx.createDraftWithBody(item.id);
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "owner");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/article-process/submit-review`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.notEqual(res.status, 403, `owner should never get 403, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

});
