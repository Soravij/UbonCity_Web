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
const authSecret = "reference-media-assets-filter-secret";
const TEST_PREFIX = "__test-assets-filter-";

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "route-assets-filter-"));
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

function insertAsset(db, { disk, storagePath, fileName, mimeType }) {
  const assetUid = `${TEST_PREFIX}asset-${fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return Number(
    db.prepare("INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type) VALUES (?, ?, ?, ?, ?)")
      .run(assetUid, disk, storagePath, fileName, mimeType).lastInsertRowid || 0
  );
}

test("GET /api/assets only returns collector-controlled local image media", async () => {
  const ctx = setupContext();
  try {
    const owner = insertUser(ctx.db, "owner", "owner");
    insertAsset(ctx.db, { disk: "local", storagePath: "test/local-image.jpg", fileName: "local-image.jpg", mimeType: "image/jpeg" });
    insertAsset(ctx.db, { disk: "nas", storagePath: "test/nas-image.png", fileName: "nas-image.png", mimeType: "image/png" });
    insertAsset(ctx.db, { disk: "local", storagePath: "https://example.com/external.jpg", fileName: "http-path.jpg", mimeType: "image/jpeg" });
    insertAsset(ctx.db, { disk: "remote", storagePath: "test/remote-disk.jpg", fileName: "remote-disk.jpg", mimeType: "image/jpeg" });
    insertAsset(ctx.db, { disk: "local", storagePath: "test/clip.mp4", fileName: "local-video.mp4", mimeType: "video/mp4" });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const token = makeToken(owner.id, owner.email, "owner");
      const res = await fetch(`${baseUrl}/api/assets`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(res.status, 200);
      const rows = await res.json();
      assert.deepEqual(rows.map((row) => row.file_name).sort(), ["local-image.jpg", "nas-image.png"]);
      for (const row of rows) {
        assert.ok(["local", "nas"].includes(row.storage_disk), `unexpected disk ${row.storage_disk}`);
        assert.equal(/^https?:\/\//i.test(row.storage_path), false);
        assert.ok(row.mime_type.startsWith("image/"));
      }
    });
  } finally {
    ctx.cleanup();
  }
});
