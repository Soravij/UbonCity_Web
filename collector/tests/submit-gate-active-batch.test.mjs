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
const authSecret = "submit-gate-active-batch-secret";

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
    { id: 902, email: "submit-gate-owner@example.test", display_name: "Submit Gate Owner", role: "owner" },
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

function testContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "submit-gate-active-batch-"));
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

function createFieldItem(repo) {
  const result = repo.createItemWithWorkflowHead({
    type: "place",
    category: "attractions",
    title: "Submit gate test place",
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
  return Number(result?.item?.id || 0);
}

function insertAssetAndLink(db, { contentItemId, assignmentId, assignmentRound, mediaType, batchId, fileName }) {
  const insertAsset = db.prepare(
    "INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const assetUid = `test-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mime = mediaType === "video" ? "video/mp4" : "image/jpeg";
  const assetResult = insertAsset.run(assetUid, "local", `/test/${fileName}`, fileName, mime, 1024, "test-checksum");
  const assetId = Number(assetResult.lastInsertRowid);

  const linkAsset = db.prepare(
    "INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order, assignment_id, assignment_round, assignment_media_type, assignment_surface, assignment_sync_batch_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)"
  );
  linkAsset.run(contentItemId, assetId, "unused", 0, 0, "unused", assignmentId, assignmentRound, mediaType, "assignment_work", batchId);
  return assetId;
}

test("revision_round=2 with round=1 assets passes submit gate (active batch semantics)", async () => {
  const ctx = testContext();
  try {
    const itemId = createFieldItem(ctx.repo);
    advancePlaceProductionState(ctx.repo, itemId, "field_review");
    const assignment = ctx.repo.createAssignment({
      content_item_id: itemId,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "field contributor",
      assignee_contact: "field@example.test",
    });
    const assignmentId = Number(assignment.id);

    ctx.db.prepare("UPDATE content_assignments SET revision_round=2 WHERE id=?").run(assignmentId);

    const batchId = `batch-${Date.now()}`;
    try {
      insertAssetAndLink(ctx.db, { contentItemId: itemId, assignmentId, assignmentRound: 1, mediaType: "image", batchId, fileName: "slot1__img.jpg" });
      insertAssetAndLink(ctx.db, { contentItemId: itemId, assignmentId, assignmentRound: 1, mediaType: "image", batchId, fileName: "slot2__img.jpg" });
      insertAssetAndLink(ctx.db, { contentItemId: itemId, assignmentId, assignmentRound: 1, mediaType: "video", batchId, fileName: "slot1__vid.mp4" });
    } catch (insertErr) {
      console.error("[TEST] insertAssetAndLink FAILED:", insertErr);
      throw insertErr;
    }

    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/assignments/${assignmentId}/submissions`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          article_payload_json: { additional_text: "test submission" },
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 201, `expected 201 but got ${response.status}: ${JSON.stringify(body)}`);
      assert.ok(body.submission || body.assignment, "response must contain submission or assignment");
    });
  } finally {
    ctx.cleanup();
  }
});

test("no assets at all -> 409 deliverables gate", async () => {
  const ctx = testContext();
  try {
    const itemId = createFieldItem(ctx.repo);
    const assignment = ctx.repo.createAssignment({
      content_item_id: itemId,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "field contributor",
      assignee_contact: "field@example.test",
    });
    const assignmentId = Number(assignment.id);

    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/assignments/${assignmentId}/submissions`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          article_payload_json: { additional_text: "test submission" },
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 409, `expected 409 but got ${response.status}: ${JSON.stringify(body)}`);
      assert.ok(
        String(body.error || "").includes("ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง"),
        `error must mention deliverables gate, got: ${body.error}`
      );
    });
  } finally {
    ctx.cleanup();
  }
});

test("no assets with image_reset_required=1 -> 409 deliverables gate (not reset gate)", async () => {
  const ctx = testContext();
  try {
    const itemId = createFieldItem(ctx.repo);
    const assignment = ctx.repo.createAssignment({
      content_item_id: itemId,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "field contributor",
      assignee_contact: "field@example.test",
    });
    const assignmentId = Number(assignment.id);

    ctx.repo.updateAssignmentMediaResetPolicy(assignmentId, { image_reset_required: 1 });

    ctx.db.close();

    await withServer(ctx.dbPath, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/assignments/${assignmentId}/submissions`, {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken()}`, "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          article_payload_json: { additional_text: "test submission" },
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 409, `expected 409 but got ${response.status}: ${JSON.stringify(body)}`);
      assert.ok(
        String(body.error || "").includes("ต้องแนบผลงานอย่างน้อย 1 รายการก่อนส่ง"),
        `error must mention deliverables gate, got: ${body.error}`
      );
    });
  } finally {
    ctx.cleanup();
  }
});
