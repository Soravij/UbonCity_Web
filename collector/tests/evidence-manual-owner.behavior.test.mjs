// Proposed location: collector/tests/evidence-manual-owner.behavior.test.mjs
// Behavior test: POST /api/items/:id/evidence-blocks (repo.addEvidenceBlock) must reject with 400 when
// source_record_id does not exist, or belongs to another content item. Own record and omitted/null id still pass.
// Paths are resolved from import.meta.url (no hardcoded absolute paths); temp DB only, never collector.db.
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
const authSecret = "evidence-manual-owner-secret";

async function reservePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = Number(probe.address()?.port || 0);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForCollector(baseUrl, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode != null) throw new Error(`collector server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("collector server did not become ready");
}

function adminToken(userId) {
  return jwt.sign(
    { id: userId, email: "evidence-owner-admin@example.test", display_name: "Evidence Admin", role: "admin" },
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
      env: { ...process.env, COLLECTOR_ROOT: collectorRoot, DB_PATH: dbPath, PORT: String(port), BACKEND_JWT_SECRET: authSecret },
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

function createPlace(repo, title) {
  const result = repo.createItemWithWorkflowHead({
    type: "place",
    category: "attractions",
    title,
    description_raw: "raw",
    description_clean: "clean",
    summary: "",
    meta_title: "",
    meta_description: "",
    image_url: "",
    tags: [],
    lang: "th",
    source_type: "manual",
    source_name: "test",
  });
  return Number(result?.item?.id || 0);
}

function addSourceRecord(db, itemId, url, entity) {
  const result = db
    .prepare(
      "INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json) VALUES (?, 'google_maps', 'google-maps', ?, ?, '{}')"
    )
    .run(itemId, url, entity);
  return Number(result.lastInsertRowid);
}

function evidenceCount(db, itemId) {
  return Number(db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE content_item_id=?").get(itemId).c);
}

function makeContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-manual-owner-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);
  return {
    dbPath,
    db,
    repo,
    cleanup() {
      try { db.close(); } catch {}
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function postEvidence(baseUrl, userId, itemId, body) {
  const response = await fetch(`${baseUrl}/api/items/${itemId}/evidence-blocks`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken(userId)}`, "content-type": "application/json" },
    body: JSON.stringify({ block_type: "fact", source_type: "manual", text_value: "manual fact", status: "active", ...body }),
  });
  let json = null;
  try { json = await response.json(); } catch {}
  return { status: response.status, json };
}

test("repo.addEvidenceBlock: rejects nonexistent or foreign source_record_id, accepts own record / omitted id", () => {
  const ctx = makeContext();
  try {
    const itemA = createPlace(ctx.repo, "Item A");
    const itemB = createPlace(ctx.repo, "Item B");
    const recA = addSourceRecord(ctx.db, itemA, "https://maps.example.test/?cid=a", "pid-a");
    const recB = addSourceRecord(ctx.db, itemB, "https://maps.example.test/?cid=b", "pid-b");

    assert.throws(
      () => ctx.repo.addEvidenceBlock(itemA, { block_type: "fact", source_type: "manual", text_value: "x", source_record_type: "source_records", source_record_id: 999999 }),
      /source_record_id does not belong to this item/
    );
    assert.throws(
      () => ctx.repo.addEvidenceBlock(itemA, { block_type: "fact", source_type: "manual", text_value: "x", source_record_type: "source_records", source_record_id: String(recB) }),
      /source_record_id does not belong to this item/
    );
    assert.throws(
      () => ctx.repo.addEvidenceBlock(itemA, { block_type: "fact", source_type: "manual", text_value: "x", source_record_id: "not-a-number" }),
      /source_record_id does not belong to this item/
    );
    assert.equal(evidenceCount(ctx.db, itemA), 0, "rejected calls must not insert rows");

    const own = ctx.repo.addEvidenceBlock(itemA, { block_type: "fact", source_type: "manual", text_value: "own", source_record_type: "source_records", source_record_id: recA });
    assert.equal(String(own.source_record_id), String(recA));
    const padded = ctx.repo.addEvidenceBlock(itemA, { block_type: "fact", source_type: "manual", text_value: "padded", source_record_id: ` ${recA} ` });
    assert.equal(String(padded.source_record_id), String(recA));
    const none = ctx.repo.addEvidenceBlock(itemA, { block_type: "fact", source_type: "manual", text_value: "none" });
    assert.equal(none.source_record_id ?? null, null);
    const nul = ctx.repo.addEvidenceBlock(itemA, { block_type: "fact", source_type: "manual", text_value: "null", source_record_id: null });
    assert.equal(nul.source_record_id ?? null, null);
    assert.equal(evidenceCount(ctx.db, itemA), 4);
  } finally {
    ctx.cleanup();
  }
});

test("POST /api/items/:id/evidence-blocks: 400 for nonexistent / foreign record, 201 for own record and omitted id", async () => {
  const ctx = makeContext();
  let itemA;
  let itemB;
  let recA;
  let recB;
  try {
    itemA = createPlace(ctx.repo, "Item A");
    itemB = createPlace(ctx.repo, "Item B");
    recA = addSourceRecord(ctx.db, itemA, "https://maps.example.test/?cid=a", "pid-a");
    recB = addSourceRecord(ctx.db, itemB, "https://maps.example.test/?cid=b", "pid-b");
    // the route requires the item to be claimed by the acting user (ensurePrepItemEditAccess, index.mjs:4165)
    const userId = Number(
      ctx.db.prepare("INSERT INTO users (email, password_hash, role, display_name) VALUES ('evidence-owner-admin@example.test', 'hash', 'admin', 'Evidence Admin')").run().lastInsertRowid
    );
    ctx.repo.claimItem(itemA, userId, { claim_note: "claimed" });
    const beforeA = evidenceCount(ctx.db, itemA);
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const missing = await postEvidence(baseUrl, userId, itemA, { source_record_type: "source_records", source_record_id: "999999" });
      assert.equal(missing.status, 400, JSON.stringify(missing.json));
      assert.match(String(missing.json?.error || ""), /source_record_id/);

      const foreign = await postEvidence(baseUrl, userId, itemA, { source_record_type: "source_records", source_record_id: String(recB) });
      assert.equal(foreign.status, 400, JSON.stringify(foreign.json));
      assert.match(String(foreign.json?.error || ""), /source_record_id/);

      const own = await postEvidence(baseUrl, userId, itemA, { source_record_type: "source_records", source_record_id: String(recA) });
      assert.equal(own.status, 201, JSON.stringify(own.json));
      assert.equal(String(own.json?.block?.source_record_id), String(recA));

      const omitted = await postEvidence(baseUrl, userId, itemA, {});
      assert.equal(omitted.status, 201, JSON.stringify(omitted.json));
      assert.equal(omitted.json?.block?.source_record_id ?? null, null);

      const explicitNull = await postEvidence(baseUrl, userId, itemA, { source_record_id: null });
      assert.equal(explicitNull.status, 201, JSON.stringify(explicitNull.json));
    });

    const after = openDatabase(ctx.dbPath, schemaPath);
    try {
      assert.equal(evidenceCount(after, itemA) - beforeA, 3, "only the three valid POSTs may insert");
      assert.equal(
        Number(after.prepare("SELECT COUNT(*) AS c FROM evidence_blocks WHERE CAST(source_record_id AS TEXT)=? AND content_item_id<>?").get(String(recB), itemB).c),
        0,
        "no evidence on item A may cite item B's record"
      );
    } finally {
      after.close();
    }
  } finally {
    ctx.cleanup();
  }
});
