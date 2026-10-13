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

// Route under test: POST /api/run/ai-draft (collector/server/index.mjs:14423).
//   400 #1 (index.mjs:14448-14458): validateCleanMinimum fails -> purge (14461) not reached.
//   400 #2 (index.mjs:14518-14530): runAiDraftStage throws (e.g. item not in an ai-draft eligible
//          production_state, workflow.mjs:2231-2235) -> but purgeUnusedContentAssetsForItem
//          (index.mjs:14461, defined 6313) has ALREADY deleted unselected assets.
// A rejected request must leave state unchanged; test #2 demonstrates the current violation.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "ai-draft-400-state-unchanged-secret";
const TEST_PREFIX = "__test-ai-draft-400-";

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

function makeToken(userId, email, role) {
  return jwt.sign(
    { id: userId, email, display_name: `Test ${role}`, role },
    authSecret,
    { issuer: "uboncity-backend", audience: "uboncity-collector" }
  );
}

async function withServer(ctx, run) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child = null;
  try {
    child = spawn(process.execPath, [serverPath], {
      cwd: collectorRoot,
      env: {
        ...process.env,
        COLLECTOR_ROOT: collectorRoot,
        DB_PATH: ctx.dbPath,
        // keep any file side-effects inside the temp dir, never the real media dir
        MEDIA_DIR: path.join(ctx.tempDir, "media"),
        RAW_DIR: path.join(ctx.tempDir, "raw"),
        STAGING_DIR: path.join(ctx.tempDir, "staging"),
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "route-ai-draft-400-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);
  const cleanup = () => {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  };
  return { db, repo, dbPath, tempDir, cleanup };
}

function insertClaimingUser(db) {
  const email = `${TEST_PREFIX}admin-${Date.now()}@local.test`;
  const id = Number(
    db.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES (?, 'Test admin', 'hash', 'admin')")
      .run(email).lastInsertRowid || 0
  );
  return { id, email };
}

function insertAssetLink(db, itemId, suffix, { selected }) {
  const assetId = Number(
    db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes)
      VALUES (?, 'local', ?, ?, 'image/jpeg', 1)
    `).run(`${TEST_PREFIX}asset-${suffix}-${Date.now()}`, `__test-ai-draft-400/${suffix}.jpg`, `${suffix}.jpg`).lastInsertRowid
  );
  const linkId = Number(
    db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, ?, ?, 0, ?, 0)
    `).run(itemId, assetId, selected ? "gallery" : "unused", selected ? 1 : 0, selected ? "gallery" : "unused").lastInsertRowid
  );
  return { assetId, linkId };
}

function seedItem(ctx, { withApprovedContext, productionState }) {
  const user = insertClaimingUser(ctx.db);
  const item = ctx.repo.createItemWithWorkflowHead({
    type: "place",
    category: "attractions",
    title: `${TEST_PREFIX}place`,
    description_raw: "test description ".repeat(10),
    source_type: "manual",
    source_name: "test",
    latitude: 15.2,
    longitude: 104.8,
  }).item;
  ctx.db.prepare("UPDATE content_items SET claimed_by_user_id=?, latitude=15.2, longitude=104.8 WHERE id=?").run(user.id, item.id);
  ctx.db.prepare("UPDATE content_workflow_models SET production_state=? WHERE content_item_id=?").run(productionState, item.id);

  if (withApprovedContext) {
    const evId = Number(
      ctx.db.prepare(`
        INSERT INTO evidence_blocks (content_item_id, block_type, source_type, source_url, source_label, lang, text_value, status)
        VALUES (?, 'fact', 'manual', 'https://example.com', 'test', 'th', 'evidence text', 'active')
      `).run(item.id).lastInsertRowid
    );
    ctx.db.prepare(`
      INSERT INTO approved_context_blocks (content_item_id, evidence_block_id, context_type, selected_text, sort_order, status)
      VALUES (?, ?, 'fact', 'approved context text', 1, 'active')
    `).run(item.id, evId);
  }

  const selected = insertAssetLink(ctx.db, item.id, "selected", { selected: true });
  const unselected = insertAssetLink(ctx.db, item.id, "unselected", { selected: false });
  return { user, item, selected, unselected };
}

function countRows(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.c || 0);
}

function assertAssetsUntouched(dbPath, seed) {
  const db = openDatabase(dbPath, schemaPath);
  try {
    for (const [label, a] of [["selected", seed.selected], ["unselected", seed.unselected]]) {
      assert.equal(countRows(db, "SELECT COUNT(*) AS c FROM assets WHERE id=?", a.assetId), 1, `${label} asset row must survive a 400`);
      assert.equal(countRows(db, "SELECT COUNT(*) AS c FROM content_assets WHERE id=?", a.linkId), 1, `${label} content_assets link must survive a 400`);
    }
    const row = db.prepare("SELECT selected_in_clean FROM content_assets WHERE id=?").get(seed.unselected.linkId);
    assert.equal(Number(row.selected_in_clean), 0, "unselected asset must stay unselected");
    const sel = db.prepare("SELECT selected_in_clean FROM content_assets WHERE id=?").get(seed.selected.linkId);
    assert.equal(Number(sel.selected_in_clean), 1, "selected asset must stay selected");
  } finally {
    db.close();
  }
}

test("POST /api/run/ai-draft 400 on missing clean minimum leaves unselected asset untouched", async () => {
  const ctx = setupContext();
  try {
    const seed = seedItem(ctx, { withApprovedContext: false, productionState: "analyzed" });
    ctx.db.close();

    await withServer(ctx, async (baseUrl) => {
      const token = makeToken(seed.user.id, seed.user.email, "admin");
      const res = await fetch(`${baseUrl}/api/run/ai-draft`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ content_item_id: seed.item.id }),
      });
      const body = await res.json();
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(body.minimum?.ok, false, "must be the clean-minimum 400 (index.mjs:14448)");
    });

    assertAssetsUntouched(ctx.dbPath, seed);
  } finally {
    ctx.cleanup();
  }
});

test("POST /api/run/ai-draft 400 from stage failure leaves unselected asset untouched", async () => {
  // Gate passes (title + coordinates + approved context) but production_state "collected" is not an
  // ai-draft candidate state, so runAiDraftStage throws (workflow.mjs:2231-2235) and the route
  // answers 400 "Agent failed: ..." (index.mjs:14530).
  // KNOWN-BUG DEMO: purgeUnusedContentAssetsForItem (index.mjs:14461) runs BEFORE the stage, so the
  // unselected asset is already deleted when the 400 is returned. This test FAILS until the purge
  // is moved after a successful stage run (or made conditional on success).
  const ctx = setupContext();
  try {
    const seed = seedItem(ctx, { withApprovedContext: true, productionState: "collected" });
    ctx.db.close();

    await withServer(ctx, async (baseUrl) => {
      const token = makeToken(seed.user.id, seed.user.email, "admin");
      const res = await fetch(`${baseUrl}/api/run/ai-draft`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ content_item_id: seed.item.id }),
      });
      const body = await res.json();
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(String(body.error), /^Agent failed:/, "must be the stage-failure 400 (index.mjs:14530)");
    });

    assertAssetsUntouched(ctx.dbPath, seed);
  } finally {
    ctx.cleanup();
  }
});
