// Proposed location: collector/tests/g2-merge-evidence-guard.test.mjs
// Behavior test (G2): bulk-merge of a raw-stage source deletes its leftover source_records
// (index.mjs mergeContentItems: DELETE FROM source_records WHERE content_item_id=?). No evidence row may
// be left citing a deleted/missing source_records row afterwards.
// Paths resolve from import.meta.url. G2_COLLECTOR_ROOT is only for pointing the spawned server at another
// collector tree (e.g. a patched copy); unset = the collector this file lives in (collector/tests/..).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = process.env.G2_COLLECTOR_ROOT
  ? path.resolve(process.env.G2_COLLECTOR_ROOT)
  : path.dirname(__dirname);
const require = createRequire(path.join(collectorRoot, "package.json"));
const jwt = require("jsonwebtoken");
const { openDatabase } = await import(pathToFileURL(path.join(collectorRoot, "db", "client.mjs")).href);
const { createRepository } = await import(pathToFileURL(path.join(collectorRoot, "db", "repository.mjs")).href);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "g2-merge-evidence-guard-secret";

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

function ownerToken() {
  return jwt.sign(
    { id: 903, email: "g2-merge-guard@example.test", display_name: "G2 Owner", role: "owner" },
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
  return Number(
    db
      .prepare(
        "INSERT INTO source_records (content_item_id, source_type, source_name, source_url, source_entity_id, payload_json) VALUES (?, 'google_maps', 'google-maps', ?, ?, '{}')"
      )
      .run(itemId, url, entity).lastInsertRowid
  );
}

function addEvidence(db, itemId, sourceRecordIdText, text) {
  return Number(
    db
      .prepare(
        "INSERT INTO evidence_blocks (content_item_id, block_type, source_type, source_record_type, source_record_id, text_value, status) VALUES (?, 'fact', 'google_maps', 'source_records', ?, ?, 'active')"
      )
      .run(itemId, String(sourceRecordIdText), text).lastInsertRowid
  );
}

function orphans(db) {
  return db
    .prepare(
      `SELECT eb.id AS evidence_id FROM evidence_blocks eb
       LEFT JOIN source_records sr ON CAST(sr.id AS TEXT) = TRIM(eb.source_record_id)
       WHERE eb.source_record_id IS NOT NULL AND TRIM(eb.source_record_id) <> '' AND sr.id IS NULL
       ORDER BY eb.id`
    )
    .all()
    .map((r) => Number(r.evidence_id));
}

function ownerMismatches(db) {
  return db
    .prepare(
      `SELECT eb.id AS evidence_id FROM evidence_blocks eb
       JOIN source_records sr ON CAST(sr.id AS TEXT) = TRIM(eb.source_record_id)
       WHERE sr.content_item_id <> eb.content_item_id ORDER BY eb.id`
    )
    .all()
    .map((r) => Number(r.evidence_id));
}

function makeContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "g2-merge-guard-"));
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

// Master owns a record for URL U; the raw source owns a padded-URL twin (trim gives the same URL), so the
// merge skips it (cannot move it) and then deletes it during raw cleanup.
function seedDuplicate(ctx, label) {
  const master = createPlace(ctx.repo, `Master ${label}`);
  const source = createPlace(ctx.repo, `Source ${label}`);
  const keeper = addSourceRecord(ctx.db, master, `https://maps.example.test/?cid=${label}`, `pid-m-${label}`);
  const skipped = addSourceRecord(ctx.db, source, `https://maps.example.test/?cid=${label} `, `pid-s-${label}`);
  return { master, source, keeper, skipped };
}

test("merge deleting a skipped raw source_record leaves no orphan evidence (same-item evidence, canonical id)", async () => {
  const ctx = makeContext();
  try {
    const f = seedDuplicate(ctx, "same");
    const ev = addEvidence(ctx.db, f.source, f.skipped, "Name: same");
    const before = Number(ctx.db.prepare("SELECT COUNT(*) c FROM evidence_blocks").get().c);
    assert.deepEqual(orphans(ctx.db), []);
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const body = await bulkMerge(baseUrl, f.master, [f.source]);
      assert.equal(body.counts.source_records_skipped, 1);
      assert.ok(body.counts.source_records_deleted >= 1, "raw cleanup must have run (delete path exercised)");
    });

    const after = openDatabase(ctx.dbPath, schemaPath);
    try {
      assert.equal(after.prepare("SELECT COUNT(*) c FROM source_records WHERE id=?").get(f.skipped).c, 0, "skipped record is deleted");
      const row = after.prepare("SELECT content_item_id i, source_record_id s FROM evidence_blocks WHERE id=?").get(ev);
      assert.equal(Number(row.s), f.keeper);
      assert.equal(Number(row.i), f.master);
      assert.deepEqual(orphans(after), []);
      assert.deepEqual(ownerMismatches(after), []);
      assert.equal(Number(after.prepare("SELECT COUNT(*) c FROM evidence_blocks").get().c), before);
    } finally {
      after.close();
    }
  } finally {
    ctx.cleanup();
  }
});

test("merge deleting a skipped raw source_record leaves no orphan evidence (padded id, evidence owned by another item)", async () => {
  const ctx = makeContext();
  try {
    const f = seedDuplicate(ctx, "gap");
    const other = createPlace(ctx.repo, "Unrelated owner of stray evidence");
    // citing the record with a whitespace-padded id (every audit query in the repo matches with TRIM)
    const evPadded = addEvidence(ctx.db, f.source, ` ${f.skipped} `, "Name: padded id");
    // legacy owner mismatch: evidence of a different item citing the skipped record
    const evStray = addEvidence(ctx.db, other, f.skipped, "Name: stray owner");
    const before = Number(ctx.db.prepare("SELECT COUNT(*) c FROM evidence_blocks").get().c);
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const body = await bulkMerge(baseUrl, f.master, [f.source]);
      assert.equal(body.counts.source_records_skipped, 1);
    });

    const after = openDatabase(ctx.dbPath, schemaPath);
    try {
      assert.deepEqual(orphans(after), [], "no evidence row may cite a source_records row that no longer exists");
      for (const id of [evPadded, evStray]) {
        assert.ok(after.prepare("SELECT 1 x FROM evidence_blocks WHERE id=?").get(id), `evidence ${id} must survive`);
      }
      assert.equal(Number(after.prepare("SELECT COUNT(*) c FROM evidence_blocks").get().c), before);
    } finally {
      after.close();
    }
  } finally {
    ctx.cleanup();
  }
});

test("merge still deletes a leftover raw source_record that no evidence cites", async () => {
  const ctx = makeContext();
  try {
    const f = seedDuplicate(ctx, "uncited");
    ctx.db.close();
    await withServer(ctx.dbPath, async (baseUrl) => {
      const body = await bulkMerge(baseUrl, f.master, [f.source]);
      assert.equal(body.counts.source_records_skipped, 1);
      assert.ok(body.counts.source_records_deleted >= 1);
    });
    const after = openDatabase(ctx.dbPath, schemaPath);
    try {
      assert.equal(after.prepare("SELECT COUNT(*) c FROM source_records WHERE id=?").get(f.skipped).c, 0);
      assert.deepEqual(orphans(after), []);
    } finally {
      after.close();
    }
  } finally {
    ctx.cleanup();
  }
});
