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
const authSecret = "return-to-clean-assignment-guard-secret";
const TEST_PREFIX = "__test-rtc-guard-";

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtc-guard-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  const createdItemIds = [];
  const createdUserIds = [];
  const createdAssignmentIds = [];
  const createdFieldPackIds = [];

  const createUser = (suffix, role = "owner") => {
    const email = `${TEST_PREFIX}${suffix}-${Date.now()}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', ?)
    `).run(email, `Test ${suffix}`, role);
    const id = Number(result.lastInsertRowid || 0);
    createdUserIds.push(id);
    return { id, email };
  };

  const createPlaceItem = (title, userId) => {
    const result = repo.createItemWithWorkflowHead(
      {
        type: "place",
        category: "test",
        title: `${TEST_PREFIX}${title}`,
        description_raw: "test",
        source_type: "manual",
        source_name: "test",
      },
      { production_state: "generated" }
    );
    const item = repo.getItem(result.item.id);
    repo.claimItem(item.id, userId);
    createdItemIds.push(item.id);
    return item;
  };

  const createFieldPack = (itemId) => {
    const pack = repo.createFieldPack({
      content_item_id: itemId,
      is_current: 1,
    });
    createdFieldPackIds.push(pack.id);
    return pack;
  };

  const createEditorialAssignment = (itemId, assigneeUserId, state = "submitted") => {
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
    for (const id of createdFieldPackIds) {
      try { db.prepare("DELETE FROM field_packs WHERE id = ?").run(id); } catch {}
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

  return { db, repo, createUser, createPlaceItem, createFieldPack, createEditorialAssignment, createdItemIds, cleanup, dbPath };
}

test("return-to-clean assignment guard", async (t) => {

  await t.test("editorial assignment state=submitted → POST return-to-clean returns 409", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("blocked", "owner");
      const item = ctx.createPlaceItem("blocked", user.id);
      ctx.createFieldPack(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "submitted");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "owner");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/field-pack/return-to-clean`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ comment: "test return" }),
        });
        assert.equal(res.status, 409, `expected 409, got ${res.status}`);
        const body = await res.json();
        assert.match(body.error, /assignment/i, "error should mention assignment");
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editorial assignment state=closed → POST return-to-clean is not 409", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("closed", "owner");
      const item = ctx.createPlaceItem("closed", user.id);
      ctx.createFieldPack(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "closed");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "owner");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/field-pack/return-to-clean`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ comment: "test return" }),
        });
        assert.notEqual(res.status, 409, `should not be 409 for closed assignment, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("no assignment + field pack current → POST return-to-clean is not 409", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("noassign", "owner");
      const item = ctx.createPlaceItem("noassign", user.id);
      ctx.createFieldPack(item.id);
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "owner");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/field-pack/return-to-clean`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ comment: "test return" }),
        });
        assert.notEqual(res.status, 409, `should not be 409 when no assignment exists, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("editorial assignment state=accepted → POST return-to-clean returns 409", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("accepted", "owner");
      const item = ctx.createPlaceItem("accepted", user.id);
      ctx.createFieldPack(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "accepted");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "owner");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/field-pack/return-to-clean`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ comment: "test return" }),
        });
        assert.equal(res.status, 409, `expected 409 for accepted assignment, got ${res.status}`);
      });
    } finally {
      ctx.cleanup();
    }
  });

  await t.test("place item in_review + editorial assignment state=submitted → POST return-to-clean returns 409", async () => {
    const ctx = testContext();
    try {
      const user = ctx.createUser("in-review", "owner");
      const result = ctx.repo.createItemWithWorkflowHead(
        {
          type: "place",
          category: "test",
          title: `${TEST_PREFIX}in-review-${Date.now()}`,
          description_raw: "test",
          source_type: "manual",
          source_name: "test",
        },
        { production_state: "in_review" }
      );
      const item = ctx.repo.getItem(result.item.id);
      ctx.repo.claimItem(item.id, user.id);
      ctx.createdItemIds.push(item.id);
      ctx.createFieldPack(item.id);
      ctx.createEditorialAssignment(item.id, user.id, "submitted");
      ctx.db.close();

      await withServer(ctx.dbPath, async (baseUrl) => {
        const token = makeToken(user.id, user.email, "owner");
        const res = await fetch(`${baseUrl}/api/items/${item.id}/field-pack/return-to-clean`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ comment: "test return in_review" }),
        });
        assert.equal(res.status, 409, `expected 409 for in_review with open assignment, got ${res.status}`);
        const body = await res.json();
        assert.match(body.error, /assignment/i, "error should mention assignment");
      });
    } finally {
      ctx.cleanup();
    }
  });

});
