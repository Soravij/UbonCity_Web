// Proposed location: collector/tests/merge-evidence-owner.behavior.test.mjs
// Behavior test: หลัง POST /api/items/bulk-merge ทุกแถว evidence_blocks ที่อ้าง source_record
// ต้องมี content_item_id ตรงกับ owner ปัจจุบันของ record นั้น (ไม่ hardcode path — resolve จาก import.meta.url)
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
const authSecret = "merge-evidence-owner-secret";

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

function ownerToken() {
  return jwt.sign(
    { id: 902, email: "merge-evidence-owner@example.test", display_name: "Merge Owner", role: "owner" },
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

function addEvidence(db, itemId, sourceRecordId, text) {
  const result = db
    .prepare(
      "INSERT INTO evidence_blocks (content_item_id, block_type, source_type, source_record_type, source_record_id, text_value, status) VALUES (?, 'fact', 'google_maps', 'source_records', ?, ?, 'active')"
    )
    .run(itemId, String(sourceRecordId), text);
  return Number(result.lastInsertRowid);
}

function mismatches(db) {
  return db
    .prepare(
      `SELECT eb.id AS evidence_id, eb.content_item_id AS evidence_item, eb.source_record_id, sr.content_item_id AS record_owner
       FROM evidence_blocks eb
       LEFT JOIN source_records sr ON CAST(sr.id AS TEXT) = TRIM(eb.source_record_id)
       WHERE eb.source_record_id IS NOT NULL AND TRIM(eb.source_record_id) <> ''
         AND (sr.id IS NULL OR sr.content_item_id <> eb.content_item_id)
       ORDER BY eb.id`
    )
    .all();
}

function makeContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-evidence-owner-"));
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

async function bulkMerge(baseUrl, masterItemId, sourceItemIds) {
  const response = await fetch(`${baseUrl}/api/items/bulk-merge`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ master_item_id: masterItemId, source_item_ids: sourceItemIds }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

test("bulk-merge 2 items: every evidence row citing a moved record follows the record's new owner", async () => {
  const ctx = makeContext();
  try {
    const master = createPlace(ctx.repo, "Master place");
    const srcA = createPlace(ctx.repo, "Source A");
    const srcB = createPlace(ctx.repo, "Source B");

    const masterRecord = addSourceRecord(ctx.db, master, "https://maps.example.test/?cid=1", "pid-master");
    const recA1 = addSourceRecord(ctx.db, srcA, "https://maps.example.test/?cid=2", "pid-a1");
    const recA2 = addSourceRecord(ctx.db, srcA, "https://maps.example.test/?cid=3", "pid-a2");
    const recB1 = addSourceRecord(ctx.db, srcB, "https://maps.example.test/?cid=4", "pid-b1");

    const evMaster = addEvidence(ctx.db, master, masterRecord, "Name: master");
    const evA1 = [addEvidence(ctx.db, srcA, recA1, "Name: a1"), addEvidence(ctx.db, srcA, recA1, "Rating: a1")];
    const evA2 = [addEvidence(ctx.db, srcA, recA2, "Name: a2")];
    const evB1 = [addEvidence(ctx.db, srcB, recB1, "Name: b1")];

    assert.deepEqual(mismatches(ctx.db), [], "fixture must start consistent");
    const totalBefore = Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM evidence_blocks").get().c);
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const body = await bulkMerge(baseUrl, master, [srcA, srcB]);
      assert.equal(body.counts.source_records_moved, 3);
    });

    const after = openDatabase(ctx.dbPath, schemaPath);
    try {
      for (const recordId of [recA1, recA2, recB1]) {
        const owner = Number(after.prepare("SELECT content_item_id AS c FROM source_records WHERE id=?").get(recordId).c);
        assert.equal(owner, master, `record ${recordId} should now belong to master`);
      }
      for (const evidenceId of [evMaster, ...evA1, ...evA2, ...evB1]) {
        const row = after.prepare("SELECT content_item_id AS c FROM evidence_blocks WHERE id=?").get(evidenceId);
        assert.ok(row, `evidence ${evidenceId} must not be deleted by merge`);
        assert.equal(Number(row.c), master, `evidence ${evidenceId} must follow its record to master`);
      }
      assert.deepEqual(mismatches(after), [], "no evidence row may cite a record owned by another item or a missing record");
      assert.equal(Number(after.prepare("SELECT COUNT(*) AS c FROM evidence_blocks").get().c), totalBefore);
    } finally {
      after.close();
    }
  } finally {
    ctx.cleanup();
  }
});

test("bulk-merge: record skipped because its trimmed URL is already owned by master — evidence is re-pointed, not left dangling", async () => {
  const ctx = makeContext();
  try {
    const master = createPlace(ctx.repo, "Master place");
    const source = createPlace(ctx.repo, "Source with padded URL");

    const masterRecord = addSourceRecord(ctx.db, master, "https://maps.example.test/?cid=dup", "pid-master");
    // trailing space: unique index treats it as a different URL, mergeSourceRecordsIntoMaster trims it (index.mjs:2096)
    const paddedRecord = addSourceRecord(ctx.db, source, "https://maps.example.test/?cid=dup ", "pid-source");
    const evidenceId = addEvidence(ctx.db, source, paddedRecord, "Name: padded");
    assert.deepEqual(mismatches(ctx.db), [], "fixture must start consistent");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const body = await bulkMerge(baseUrl, master, [source]);
      assert.equal(body.counts.source_records_skipped, 1);
    });

    const after = openDatabase(ctx.dbPath, schemaPath);
    try {
      const row = after.prepare("SELECT content_item_id AS item, source_record_id AS sr FROM evidence_blocks WHERE id=?").get(evidenceId);
      assert.ok(row, "evidence must survive the merge");
      assert.equal(Number(row.item), master);
      assert.equal(Number(row.sr), masterRecord, "evidence must cite the record that holds the URL under master");
      assert.deepEqual(mismatches(after), []);
    } finally {
      after.close();
    }
  } finally {
    ctx.cleanup();
  }
});
