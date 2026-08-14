import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import jwt from "jsonwebtoken";

import { openDatabase } from "../db/client.mjs";
import { createRepository, PRODUCTION_STATES } from "../db/repository.mjs";
import { advancePlaceProductionState } from "./test-helpers/fixture-ladder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "field-pack-ready-guard-route-secret";

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
    { id: 901, email: "field-pack-guard-owner@example.test", display_name: "Guard Owner", role: "owner" },
    authSecret,
    { issuer: "uboncity-backend", audience: "uboncity-collector" }
  );
}

function createPlace(repo, productionState) {
  const result = repo.createItemWithWorkflowHead({
    type: "place",
    category: "attractions",
    title: `Place head=${productionState}`,
    description_raw: "test description",
    description_clean: "test description",
    summary: "",
    meta_title: "",
    meta_description: "",
    image_url: "",
    tags: [],
    lang: "th",
    source_type: "manual",
    source_name: "test",
  });
  const itemId = Number(result?.item?.id || 0) || 0;
  assert.ok(PRODUCTION_STATES.has(productionState), `"${productionState}" must be a real production_state enum value`);
  if (productionState !== "collected") {
    advancePlaceProductionState(repo, itemId, productionState);
  }
  return repo.getItem(itemId);
}

function createEvent(repo) {
  const result = repo.createItemWithWorkflowHead({
    type: "event",
    category: "attractions",
    title: "Event head=collected",
    description_raw: "test description",
    description_clean: "test description",
    summary: "",
    meta_title: "",
    meta_description: "",
    image_url: "",
    tags: [],
    lang: "th",
    source_type: "manual",
    source_name: "test",
  });
  const itemId = Number(result?.item?.id || 0) || 0;
  return repo.getItem(itemId);
}

// Regenerate hits buildCleanStructuredContext()'s minimum-required gate before it ever reaches the
// AI agent call, so a bare createPlace() place (no lat/long, no approved context) 400s there before
// the production-state guard is even in play. This gives it a title + traceable reference (lat/long)
// + one approved context block so the request actually reaches the agent call.
function createPlaceWithCleanContext(ctx, productionState) {
  const place = createPlace(ctx.repo, productionState);
  ctx.db.prepare(`UPDATE content_items SET latitude=15.2, longitude=104.8 WHERE id=?`).run(place.id);
  const evidenceId = place.id * 100 + 1;
  ctx.db.prepare(`
    INSERT INTO evidence_blocks (id, content_item_id, block_type, source_type, source_url, source_label, lang, text_value, status)
    VALUES (?, ?, 'fact', 'manual', 'https://example.com', 'test', 'th', 'Test evidence block', 'active')
  `).run(evidenceId, place.id);
  ctx.db.prepare(`
    INSERT INTO approved_context_blocks (id, content_item_id, evidence_block_id, context_type, selected_text, sort_order, status)
    VALUES (?, ?, ?, 'fact', 'Test approved context text', 1, 'active')
  `).run(evidenceId, place.id, evidenceId);
  return ctx.repo.getItem(place.id);
}

// editor-work's guard now resolves previousStatus from fieldPackPayload.id -- the exact pack
// repo.saveItemWithFieldPack() is about to write -- not from content_workflow_models.current_field_pack_id
// (see index.mjs:8876-8884). This helper still also sets current_field_pack_id so fixtures reflect a
// realistic "pointer aligned with is_current" DB state; it is no longer load-bearing for this guard,
// but nothing else in the write paths keeps it in sync either, so setting it here still matches reality.
function createFieldPackWithCurrentPointer(ctx, itemId, status) {
  const fieldPack = ctx.repo.createFieldPack({
    content_item_id: itemId,
    status,
    ai_summary: "test pack",
  });
  ctx.repo.upsertWorkflowModel(
    itemId,
    { current_field_pack_id: fieldPack.id },
    "test@local",
    { actor_role: "system", reason_code: "test_fixture_current_pack_pointer" }
  );
  return fieldPack;
}

async function withServer(dbPath, run, extraEnv = {}) {
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
        ...extraEnv,
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

function fieldPackRequestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "field-pack-ready-guard-"));
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

test("PUT field pack: place head=analyzed rejects ready_for_field with 409 and leaves the pack unchanged", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "draft",
      ai_summary: "test pack",
    });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/field-packs/${fieldPack.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "ready_for_field" }),
      });
      assert.equal(response.status, 409);

      const current = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/current`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const currentBody = await current.json();
      assert.equal(currentBody.field_pack.status, "draft", "field pack status must stay unchanged after the 409");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT field pack: place head=generated allows ready_for_field", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "generated");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "draft",
      ai_summary: "test pack",
    });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/field-packs/${fieldPack.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "ready_for_field" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "ready_for_field");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT field pack: place head=analyzed still allows setting status draft (guard does not block non-ready statuses)", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "draft",
      ai_summary: "test pack",
    });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/field-packs/${fieldPack.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "draft", field_notes: "still drafting" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "draft");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT field pack: event head=collected allows ready_for_field (guard is place-only)", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const event = createEvent(ctx.repo);
    assert.equal(event.production_state, "collected");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: event.id,
      status: "draft",
      ai_summary: "test pack",
    });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/field-packs/${fieldPack.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "ready_for_field" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "ready_for_field");
    });
  } finally {
    ctx.cleanup();
  }
});

test("POST field pack create: place head=analyzed rejects ready_for_field with 409 and creates no field pack", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/field-packs`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "ready_for_field", ai_summary: "test pack" }),
      });
      assert.equal(response.status, 409);

      const current = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/current`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const currentBody = await current.json();
      assert.equal(currentBody.field_pack, null, "no field pack should have been created");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT field pack: place head=analyzed resaving pack already at ready_for_field with the same value -> 200, DB unchanged", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "ready_for_field",
      ai_summary: "already ready",
    });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/field-packs/${fieldPack.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "ready_for_field", ai_summary: "already ready" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "ready_for_field");

      const current = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/current`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const currentBody = await current.json();
      assert.equal(currentBody.field_pack.status, "ready_for_field", "resave with the same value must not be blocked");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT field pack: place head=analyzed downgrading pack from ready_for_field to draft -> 200", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const fieldPack = ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "ready_for_field",
      ai_summary: "was ready",
    });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/field-packs/${fieldPack.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "draft", "downgrading away from ready_for_field must never be blocked by this guard");
    });
  } finally {
    ctx.cleanup();
  }
});

// --- POST /api/items/:id/field-pack/regenerate guard wiring -----------------------------------
//
// Every real agentEngine.generateFieldPack/reviseFieldPack call (internal AND external, see
// collector/services/agent-generation.mjs:964-1008 and :852-915) already routes its response through
// normalizeFieldPack (agent-generation.mjs:138-224), which force-downgrades a missing OR an explicit
// ready_for_field/ready_for_handoff status to "draft" (lines 168-176) before the regenerate route ever
// calls buildFieldPackUpdatePayloadFromAgent(). That means buildFieldPackUpdatePayloadFromAgent's own
// "ready_for_field" default (collector/server/endpoint-schema-mapping.mjs:10) — and therefore the
// production-state guard now wired to it in this route — cannot currently be triggered through a real
// HTTP call. The two tests below pin both halves of that fact: the guard composition is correct (WIRING
// CHECK), and today's live route still returns 200/draft for the same input (PINNED BEHAVIOR).

async function withMockExternalAgent(run) {
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}/run`;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/run") {
      res.writeHead(404).end();
      return;
    }
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      // Deliberately no "status" key, to simulate "the agent doesn't send status".
      res.end(JSON.stringify({
        field_pack: {
          ai_summary: "mock external agent field pack (no status field sent)",
          story_angle: "test angle",
        },
      }));
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("PINNED BEHAVIOR (today's actual live route, not the guard wiring): POST regenerate where the agent sends no status -> 200, pack status stays draft", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlaceWithCleanContext(ctx, "analyzed");
    ctx.db.close();

    await withMockExternalAgent(async (externalAgentUrl) => {
      await withServer(ctx.dbPath, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/regenerate`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
          body: JSON.stringify({ revision_note: "test regenerate, agent sends no status" }),
        });
        const body = await response.json();
        // If this starts failing (e.g. 409 instead of 200), normalizeFieldPack stopped downgrading a
        // missing/ready_for_field status to "draft" before buildFieldPackUpdatePayloadFromAgent runs --
        // which means the WIRING CHECK test below just became live/reachable through this real route.
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.equal(body.field_pack.status, "draft");
      }, {
        COLLECTOR_AGENT_ENGINE: "external",
        COLLECTOR_EXTERNAL_AGENT_URL: externalAgentUrl,
      });
    });
  } finally {
    ctx.cleanup();
  }
});

test("regenerate: place head=analyzed with an existing ready_for_field pack, agent sends no status -> 200, pack downgrades to draft (never blocked)", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlaceWithCleanContext(ctx, "analyzed");
    ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "ready_for_field",
      ai_summary: "already ready before regenerate",
    });
    ctx.db.close();

    await withMockExternalAgent(async (externalAgentUrl) => {
      await withServer(ctx.dbPath, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/regenerate`, {
          method: "POST",
          headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
          body: JSON.stringify({ revision_note: "regenerate over an already-ready pack" }),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.field_pack.status, "draft");
      }, {
        COLLECTOR_AGENT_ENGINE: "external",
        COLLECTOR_EXTERNAL_AGENT_URL: externalAgentUrl,
      });
    });
  } finally {
    ctx.cleanup();
  }
});

// Note: regenerate cannot exercise the "resave" (old=ready_for_field, new=ready_for_field) or
// "block" (old=draft, new=ready_for_field) scenarios through a real HTTP call at all -- see the
// PINNED BEHAVIOR comment block above. normalizeFieldPack forces every real agent response's status
// down to draft/field_in_progress/field_done/on_hold before it reaches this route's guard call, so
// "new === ready_for_field" is structurally unreachable here. Those two scenarios are covered at the
// guard-composition level by the WIRING CHECK test below instead.

const wiringProbeSource = String.raw`
process.chdir(process.env.COLLECTOR_ROOT);
const { buildFieldPackUpdatePayloadFromAgent } = await import(process.env.ENDPOINT_SCHEMA_MAPPING_MODULE_URL);
const { assertFieldPackReadyProductionGate } = await import(process.env.SERVER_MODULE_URL);
const payload = buildFieldPackUpdatePayloadFromAgent({});
let threw = false;
let code = null;
try {
  assertFieldPackReadyProductionGate({ type: "place", production_state: "analyzed" }, null, payload.status);
} catch (err) {
  threw = true;
  code = (err && err.code) || null;
}
process.stdout.write(JSON.stringify({ payloadStatus: payload.status, threw, code }));
process.exit(0);
`;

test("WIRING CHECK (composition test, NOT today's live behavior -- see PINNED BEHAVIOR test above): assertFieldPackReadyProductionGate blocks place head=analyzed given buildFieldPackUpdatePayloadFromAgent's own ready_for_field default when the agent object carries no status", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "field-pack-guard-wiring-"));
  const runnerPath = path.join(tempDir, "runner.mjs");
  const dbPath = path.join(tempDir, "collector.sqlite");
  fs.writeFileSync(runnerPath, wiringProbeSource, "utf8");
  try {
    const result = spawnSync(process.execPath, [runnerPath], {
      cwd: collectorRoot,
      env: {
        ...process.env,
        COLLECTOR_ROOT: collectorRoot,
        DB_PATH: dbPath,
        BACKEND_JWT_SECRET: authSecret,
        SERVER_MODULE_URL: pathToFileURL(serverPath).href,
        ENDPOINT_SCHEMA_MAPPING_MODULE_URL: pathToFileURL(path.join(collectorRoot, "server", "endpoint-schema-mapping.mjs")).href,
        COLLECTOR_DISABLE_LISTEN: "1",
      },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `wiring probe failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const output = JSON.parse(String(result.stdout || "").trim());
    assert.equal(output.payloadStatus, "ready_for_field", "buildFieldPackUpdatePayloadFromAgent must default to ready_for_field when the agent sends no status");
    assert.equal(output.threw, true, "assertFieldPackReadyProductionGate must throw for place head=analyzed given that default");
    assert.equal(output.code, "FIELD_PACK_HEAD_NOT_GENERATED");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

const oldNewComboProbeSource = String.raw`
process.chdir(process.env.COLLECTOR_ROOT);
const { assertFieldPackReadyProductionGate } = await import(process.env.SERVER_MODULE_URL);

function check(label, item, previousStatus, requestedStatus) {
  let threw = false;
  let code = null;
  try {
    assertFieldPackReadyProductionGate(item, previousStatus, requestedStatus);
  } catch (err) {
    threw = true;
    code = (err && err.code) || null;
  }
  return { label, threw, code };
}

const analyzed = { type: "place", production_state: "analyzed" };
const generated = { type: "place", production_state: "generated" };

const results = [
  check("resave: ready_for_field -> ready_for_field, head=analyzed", analyzed, "ready_for_field", "ready_for_field"),
  check("block: draft -> ready_for_field, head=analyzed", analyzed, "draft", "ready_for_field"),
  check("create: null -> ready_for_field, head=analyzed", analyzed, null, "ready_for_field"),
  check("downgrade: ready_for_field -> draft, head=analyzed", analyzed, "ready_for_field", "draft"),
  check("generated head allows a fresh ready_for_field request", generated, null, "ready_for_field"),
];
process.stdout.write(JSON.stringify(results));
process.exit(0);
`;

test("WIRING CHECK: old-vs-new status combinations (resave/block/create/downgrade) match the spec exactly", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "field-pack-guard-combo-"));
  const runnerPath = path.join(tempDir, "runner.mjs");
  const dbPath = path.join(tempDir, "collector.sqlite");
  fs.writeFileSync(runnerPath, oldNewComboProbeSource, "utf8");
  try {
    const result = spawnSync(process.execPath, [runnerPath], {
      cwd: collectorRoot,
      env: {
        ...process.env,
        COLLECTOR_ROOT: collectorRoot,
        DB_PATH: dbPath,
        BACKEND_JWT_SECRET: authSecret,
        SERVER_MODULE_URL: pathToFileURL(serverPath).href,
        COLLECTOR_DISABLE_LISTEN: "1",
      },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `combo probe failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const results = JSON.parse(String(result.stdout || "").trim());
    const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));

    assert.equal(byLabel["resave: ready_for_field -> ready_for_field, head=analyzed"].threw, false, "resaving the same ready value must be a no-op regardless of head");

    assert.equal(byLabel["block: draft -> ready_for_field, head=analyzed"].threw, true, "switching draft -> ready_for_field before generated must be blocked");
    assert.equal(byLabel["block: draft -> ready_for_field, head=analyzed"].code, "FIELD_PACK_HEAD_NOT_GENERATED");

    assert.equal(byLabel["create: null -> ready_for_field, head=analyzed"].threw, true, "creating fresh at ready_for_field before generated must be blocked, same as before this change");
    assert.equal(byLabel["create: null -> ready_for_field, head=analyzed"].code, "FIELD_PACK_HEAD_NOT_GENERATED");

    assert.equal(byLabel["downgrade: ready_for_field -> draft, head=analyzed"].threw, false, "downgrading away from ready_for_field must never be touched by this guard");

    assert.equal(byLabel["generated head allows a fresh ready_for_field request"].threw, false, "once head reaches generated, a fresh ready_for_field request must be allowed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- PUT /api/items/:id/editor-work guard wiring ---------------------------------------------
// This is the real Save-button write path (see audit/field-pack-guard-impact.md) that was
// missing the guard entirely; the guard is now called at index.mjs before repo.saveItemWithFieldPack().

test("PUT editor-work: place head=analyzed setting field pack to ready_for_field -> 409, pack status unchanged", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { status: "ready_for_field", ai_summary: "test pack" } }),
      });
      assert.equal(response.status, 409);

      const current = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/current`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const currentBody = await current.json();
      assert.equal(currentBody.field_pack, null, "no field pack should have been created");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT editor-work: place head=generated setting field pack to ready_for_field -> succeeds", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "generated");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { status: "ready_for_field", ai_summary: "test pack" } }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "ready_for_field");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT editor-work: event head=collected setting field pack to ready_for_field -> succeeds (guard is place-only)", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const event = createEvent(ctx.repo);
    assert.equal(event.production_state, "collected");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${event.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { status: "ready_for_field", ai_summary: "test pack" } }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "ready_for_field");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT editor-work: place head=analyzed saving without touching field pack status -> succeeds normally", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: { title: "Updated title only" } }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.item.title, "Updated title only");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT editor-work: place head=analyzed, target pack already ready_for_field, resaving the same value -> 200, DB unchanged (this is the reported item-14/pack-11 bug)", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const fieldPack = createFieldPackWithCurrentPointer(ctx, place.id, "ready_for_field");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { id: fieldPack.id, status: "ready_for_field", ai_summary: "test pack" } }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "ready_for_field");

      const current = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/current`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const currentBody = await current.json();
      assert.equal(currentBody.field_pack.status, "ready_for_field", "resave with the same value must not be blocked");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT editor-work: place head=analyzed, target pack is draft, switching to ready_for_field -> 409, pack status unchanged", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const fieldPack = createFieldPackWithCurrentPointer(ctx, place.id, "draft");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { id: fieldPack.id, status: "ready_for_field", ai_summary: "test pack" } }),
      });
      assert.equal(response.status, 409);

      const current = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/current`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const currentBody = await current.json();
      assert.equal(currentBody.field_pack.status, "draft", "field pack status must stay unchanged after the 409");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT editor-work: place head=analyzed, target pack already ready_for_field, downgrading to draft -> 200", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const fieldPack = createFieldPackWithCurrentPointer(ctx, place.id, "ready_for_field");
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { id: fieldPack.id, status: "draft", ai_summary: "test pack" } }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.field_pack.status, "draft", "downgrading away from ready_for_field must never be blocked by this guard");
    });
  } finally {
    ctx.cleanup();
  }
});

// --- Divergent pointer: current_field_pack_id (pack A) != fieldPackPayload.id (pack B) ----------
// These two deliberately do NOT use createFieldPackWithCurrentPointer to keep the pointer and the
// payload's target pack aligned -- they reproduce the real-world case (nothing in the write paths
// keeps current_field_pack_id synced to the pack a save actually targets) that the earlier version
// of this guard got wrong: it read previousStatus off pack A (via current_field_pack_id) while
// repo.saveItemWithFieldPack() was actually about to write pack B (via fieldPackPayload.id).

test("PUT editor-work: current_field_pack_id points at pack A (ready_for_field) but the payload targets pack B (draft) -> 409, pack B's own status must gate this, not pack A's", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const packA = ctx.repo.createFieldPack({ content_item_id: place.id, status: "ready_for_field", ai_summary: "pack A" });
    ctx.repo.upsertWorkflowModel(
      place.id,
      { current_field_pack_id: packA.id },
      "test@local",
      { actor_role: "system", reason_code: "test_fixture_divergent_pointer" }
    );
    const packB = ctx.repo.createFieldPack({ content_item_id: place.id, status: "draft", ai_summary: "pack B" });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { id: packB.id, status: "ready_for_field", ai_summary: "pack B" } }),
      });
      assert.equal(
        response.status,
        409,
        "trusting pack A's already-ready status here would let pack B skip the production-state check entirely"
      );

      const current = await fetch(`${baseUrl}/api/items/${place.id}/field-pack/current`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const currentBody = await current.json();
      assert.equal(currentBody.field_pack.id, packB.id);
      assert.equal(currentBody.field_pack.status, "draft", "pack B must stay unchanged after the 409");
    });
  } finally {
    ctx.cleanup();
  }
});

test("PUT editor-work: current_field_pack_id points at pack A (draft) but the payload resaves pack B (already ready_for_field) with the same value -> 200", async () => {
  const ctx = fieldPackRequestContext();
  try {
    const place = createPlace(ctx.repo, "analyzed");
    const packA = ctx.repo.createFieldPack({ content_item_id: place.id, status: "draft", ai_summary: "pack A" });
    ctx.repo.upsertWorkflowModel(
      place.id,
      { current_field_pack_id: packA.id },
      "test@local",
      { actor_role: "system", reason_code: "test_fixture_divergent_pointer" }
    );
    const packB = ctx.repo.createFieldPack({ content_item_id: place.id, status: "ready_for_field", ai_summary: "pack B" });
    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/editor-work`, {
        method: "PUT",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ item: {}, field_pack: { id: packB.id, status: "ready_for_field", ai_summary: "pack B" } }),
      });
      assert.equal(
        response.status,
        200,
        "trusting pack A's draft status here would wrongly 409 a legitimate resave of pack B -- the exact item-14 bug shape"
      );
      const body = await response.json();
      assert.equal(body.field_pack.id, packB.id);
      assert.equal(body.field_pack.status, "ready_for_field");
    });
  } finally {
    ctx.cleanup();
  }
});
