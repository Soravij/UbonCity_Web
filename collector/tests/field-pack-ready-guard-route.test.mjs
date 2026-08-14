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
