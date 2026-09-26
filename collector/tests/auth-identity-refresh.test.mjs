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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "auth-identity-refresh-secret";

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

function makeToken({ id, email, role, displayName }) {
  return jwt.sign(
    { id, email, display_name: displayName, role },
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

function setup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-identity-refresh-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const cleanup = () => {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  };
  return { db, dbPath, cleanup };
}

async function getUsers(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  await response.json();
}

function countAction(db, email, action) {
  return Number(
    db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE actor_email=? AND action=?").get(email, action).n
  );
}

function readUser(db, email) {
  const row = db.prepare("SELECT role, display_name, profile_json FROM users WHERE email=?").get(email);
  return { ...row, syncedAt: JSON.parse(row.profile_json)?._auth_sync?.synced_at };
}

test("same token twice: provisioned once, no refresh, synced_at stable", async () => {
  const { db, dbPath, cleanup } = setup();
  try {
    const email = "refresh-a@local.test";
    const token = makeToken({ id: 9001, email, role: "admin", displayName: "Refresh A" });
    await withServer(dbPath, async (baseUrl) => {
      await getUsers(baseUrl, token);
      const first = readUser(db, email);
      assert.ok(first.syncedAt);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await getUsers(baseUrl, token);
      const second = readUser(db, email);

      assert.equal(countAction(db, email, "auth.backend_identity_provisioned"), 1);
      assert.equal(countAction(db, email, "auth.backend_identity_refresh"), 0);
      assert.equal(second.syncedAt, first.syncedAt);
    });
  } finally {
    cleanup();
  }
});

test("role change on second request: role updated and refresh audited", async () => {
  const { db, dbPath, cleanup } = setup();
  try {
    const email = "refresh-b@local.test";
    await withServer(dbPath, async (baseUrl) => {
      await getUsers(baseUrl, makeToken({ id: 9002, email, role: "admin", displayName: "Refresh B" }));
      await getUsers(baseUrl, makeToken({ id: 9002, email, role: "owner", displayName: "Refresh B" }));

      assert.equal(readUser(db, email).role, "owner");
      assert.equal(countAction(db, email, "auth.backend_identity_refresh"), 1);
      const audit = db
        .prepare("SELECT details_json FROM audit_logs WHERE actor_email=? AND action='auth.backend_identity_refresh'")
        .get(email);
      assert.equal(JSON.parse(audit.details_json).role, "owner");
    });
  } finally {
    cleanup();
  }
});

test("display_name change on second request: name updated and refresh audited", async () => {
  const { db, dbPath, cleanup } = setup();
  try {
    const email = "refresh-c@local.test";
    await withServer(dbPath, async (baseUrl) => {
      await getUsers(baseUrl, makeToken({ id: 9003, email, role: "admin", displayName: "Old Name" }));
      await getUsers(baseUrl, makeToken({ id: 9003, email, role: "admin", displayName: "New Name" }));

      assert.equal(readUser(db, email).display_name, "New Name");
      assert.equal(countAction(db, email, "auth.backend_identity_refresh"), 1);
    });
  } finally {
    cleanup();
  }
});
