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
import { advancePlaceProductionState } from "./test-helpers/fixture-ladder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverPath = path.join(collectorRoot, "server", "index.mjs");
const authSecret = "backward-autoclose-scope-secret";

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
    { id: 901, email: "autoclose-scope-owner@example.test", display_name: "Autoclose Owner", role: "owner" },
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
  const itemId = Number(result?.item?.id || 0);
  if (productionState !== "collected") {
    advancePlaceProductionState(repo, itemId, productionState);
  }
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

function testContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backward-autoclose-"));
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

test("backward from writing_assigned: editorial closed, field reopened to revision_requested", async () => {
  const ctx = testContext();
  try {
    const place = createPlace(ctx.repo, "writing_assigned");

    const editorialAssignment = ctx.repo.createAssignment({
      content_item_id: place.id,
      assignment_kind: "editorial",
      state: "accepted",
      assignee_name: "editor user",
      assignee_contact: "editor@example.test",
    });

    const fieldAssignment = ctx.repo.createAssignment({
      content_item_id: place.id,
      assignment_kind: "field",
      state: "accepted",
      assignee_name: "field user",
      assignee_contact: "field@example.test",
    });

    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/workflow/backward-transitions`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ reason: "test backward", target_production_state: "field_review" }),
      });
      assert.equal(response.status, 200, "backward transition must succeed");

      const assignmentsResp = await fetch(`${baseUrl}/api/items/${place.id}/assignments`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const assignmentsBody = await assignmentsResp.json();
      const assignments = assignmentsBody.assignments || assignmentsBody;

      const editorial = assignments.find((a) => a.assignment_kind === "editorial");
      const field = assignments.find((a) => a.assignment_kind === "field");

      assert.equal(editorial.state, "closed", "editorial assignment must be closed by backward transition");
      assert.equal(field.state, "revision_requested", "field assignment must be reopened to revision_requested");
    });
  } finally {
    ctx.cleanup();
  }
});

test("backward from in_review to field_review: field closed (closeKind=null closes all kinds)", async () => {
  const ctx = testContext();
  try {
    const place = createPlace(ctx.repo, "in_review");

    const fieldAssignment = ctx.repo.createAssignment({
      content_item_id: place.id,
      assignment_kind: "field",
      state: "accepted",
      assignee_name: "field user",
      assignee_contact: "field@example.test",
    });

    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/workflow/backward-transitions`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ reason: "test regression", target_production_state: "field_review" }),
      });
      assert.equal(response.status, 200, "in_review->field_review backward transition must succeed");

      const assignmentsResp = await fetch(`${baseUrl}/api/items/${place.id}/assignments`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const assignmentsBody = await assignmentsResp.json();
      const assignments = assignmentsBody.assignments || assignmentsBody;

      const field = assignments.find((a) => a.assignment_kind === "field");
      // NOTE: closeKind=null (index.mjs:9215-9227) closes ALL open assignments
      // regardless of kind when fromProductionState is in_review.
      // This records current behavior; correctness not yet decided.
      // What this guards: field must NOT become revision_requested.
      assert.equal(field.state, "closed", "field assignment must be closed (not revision_requested)");
    });
  } finally {
    ctx.cleanup();
  }
});

test("backward from field_working: field closed, no regression", async () => {
  const ctx = testContext();
  try {
    const place = createPlace(ctx.repo, "field_working");

    const fieldAssignment = ctx.repo.createAssignment({
      content_item_id: place.id,
      assignment_kind: "field",
      state: "in_progress",
      assignee_name: "field worker",
      assignee_contact: "worker@example.test",
    });

    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/items/${place.id}/workflow/backward-transitions`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ reason: "test backward field", target_production_state: "ready_for_content" }),
      });
      assert.equal(response.status, 200, "backward transition must succeed");

      const assignmentsResp = await fetch(`${baseUrl}/api/items/${place.id}/assignments`, {
        headers: { authorization: `Bearer ${ownerToken()}` },
      });
      const assignmentsBody = await assignmentsResp.json();
      const assignments = assignmentsBody.assignments || assignmentsBody;

      const field = assignments.find((a) => a.assignment_kind === "field");
      assert.equal(field.state, "closed", "field assignment must be closed by backward transition from field_working");
    });
  } finally {
    ctx.cleanup();
  }
});
