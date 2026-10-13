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
const authSecret = "asset-delete-deliverable-guard-secret";
const TEST_PREFIX = "__test-asset-delete-";

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

function setupContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "route-asset-delete-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);
  const cleanup = () => {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  };
  return { db, repo, dbPath, cleanup };
}

function insertUser(db, suffix, role) {
  const email = `${TEST_PREFIX}${suffix}-${Date.now()}@local.test`;
  const id = Number(
    db.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, 'hash', ?)")
      .run(email, `Test ${suffix}`, role).lastInsertRowid || 0
  );
  return { id, email };
}

function insertAsset(db, suffix) {
  const assetUid = `${TEST_PREFIX}asset-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return Number(
    db.prepare("INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type) VALUES (?, 'local', 'test/path', 'test.jpg', 'image/jpeg')")
      .run(assetUid).lastInsertRowid || 0
  );
}

function countRows(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.c || 0);
}

test("DELETE /api/assets/:id returns 409 and keeps the asset while a submission deliverable references it", async () => {
  const ctx = setupContext();
  let owner;
  let assetId;
  try {
    owner = insertUser(ctx.db, "owner-409", "owner");
    const item = ctx.repo.createItemWithWorkflowHead({
      type: "place",
      category: "test",
      title: `${TEST_PREFIX}referenced-item`,
      description_raw: "test",
      source_type: "manual",
      source_name: "test",
    }).item;
    const assignmentId = Number(
      ctx.db.prepare("INSERT INTO content_assignments (assignment_uid, content_item_id) VALUES (?, ?)")
        .run(`${TEST_PREFIX}asg-409-${Date.now()}`, item.id).lastInsertRowid
    );
    const submissionId = Number(
      ctx.db.prepare("INSERT INTO content_assignment_submissions (assignment_id, content_item_id, submitted_by_user_id) VALUES (?, ?, ?)")
        .run(assignmentId, item.id, owner.id).lastInsertRowid
    );
    assetId = insertAsset(ctx.db, "referenced");
    ctx.db.prepare(
      "INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean) VALUES (?, ?, 'gallery', 1)"
    ).run(item.id, assetId);
    ctx.db.prepare(`
      INSERT INTO content_assignment_submission_deliverables
        (assignment_id, submission_id, content_item_id, deliverable_type, source_asset_id, created_by)
      VALUES (?, ?, ?, 'photos', ?, ?)
    `).run(assignmentId, submissionId, item.id, assetId, "route-test@local");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const token = makeToken(owner.id, owner.email, "owner");
      const res = await fetch(`${baseUrl}/api/assets/${assetId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      assert.equal(res.status, 409);
      assert.equal(body.error, "Asset is referenced by submission deliverables");
      assert.deepEqual(body.blocked_references, ["content_assignment_submission_deliverables"]);
    });

    const db = openDatabase(ctx.dbPath, schemaPath);
    try {
      assert.equal(countRows(db, "SELECT COUNT(*) AS c FROM assets WHERE id=?", assetId), 1, "asset row must survive a 409");
      assert.equal(countRows(db, "SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?", assetId), 1, "content_assets row must survive a 409");
    } finally {
      db.close();
    }
  } finally {
    ctx.cleanup();
  }
});

test("DELETE /api/assets/:id succeeds for an asset with no deliverable references", async () => {
  const ctx = setupContext();
  let owner;
  let assetId;
  try {
    owner = insertUser(ctx.db, "owner-ok", "owner");
    assetId = insertAsset(ctx.db, "unreferenced");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const token = makeToken(owner.id, owner.email, "owner");
      const res = await fetch(`${baseUrl}/api/assets/${assetId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
    });

    const db = openDatabase(ctx.dbPath, schemaPath);
    try {
      assert.equal(countRows(db, "SELECT COUNT(*) AS c FROM assets WHERE id=?", assetId), 0);
    } finally {
      db.close();
    }
  } finally {
    ctx.cleanup();
  }
});

test("DELETE /api/assets/:id returns 404 for an unknown id", async () => {
  const ctx = setupContext();
  let owner;
  try {
    owner = insertUser(ctx.db, "owner-404", "owner");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const token = makeToken(owner.id, owner.email, "owner");
      const res = await fetch(`${baseUrl}/api/assets/999999`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: "Asset not found" });
    });
  } finally {
    ctx.cleanup();
  }
});

test("DELETE /api/assets/:id is owner-only", async () => {
  const ctx = setupContext();
  let editor;
  let assetId;
  try {
    editor = insertUser(ctx.db, "editor-403", "editor");
    assetId = insertAsset(ctx.db, "owner-only");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const token = makeToken(editor.id, editor.email, "editor");
      const res = await fetch(`${baseUrl}/api/assets/${assetId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 403);
    });
  } finally {
    ctx.cleanup();
  }
});
