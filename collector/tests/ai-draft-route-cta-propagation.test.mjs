import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { runAiDraftStage } from "../services/workflow.mjs";

const collectorDir = path.dirname(fileURLToPath(new URL("../server/index.mjs", import.meta.url)));
const schemaPath = fileURLToPath(new URL("../database/schema.sql", import.meta.url));
const indexSource = fs.readFileSync(path.join(collectorDir, "index.mjs"), "utf8");

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-ai-draft-cta-"));
  const dbPath = path.join(tempDir, "collector.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);
  return {
    tempDir,
    db,
    repo,
    cleanup() {
      try {
        db.close();
      } catch {}
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function createEligibleItem(repo, title) {
  const created = repo.createItemWithWorkflowHead({
    type: "place",
    category: "cafes",
    title,
    description_raw: `${title} raw`,
    latitude: 15.244,
    longitude: 104.847,
  });
  repo.upsertWorkflowModel(created.item.id, {
    production_state: "generated",
  }, "tester@local", {
    actor_role: "system",
    reason_code: "test_seed_generated",
    skip_production_transition_validation: true,
  });
  return created.item;
}

function seedSelectedImage(db, itemId, suffix = "cover") {
  const assetResult = db.prepare(`
    INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
    VALUES (?, 'local', ?, ?, 'image/jpeg', 100, ?)
  `).run(
    `asset-${itemId}-${suffix}`,
    `uploads/${itemId}-${suffix}.jpg`,
    `${itemId}-${suffix}.jpg`,
    `checksum-${itemId}-${suffix}`
  );
  const assetId = Number(assetResult.lastInsertRowid || 0) || 0;
  db.prepare(`
    INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
    VALUES (?, ?, 'cover', 1, 1, 'gallery', 0)
  `).run(itemId, assetId);
}

function seedGoldenHourContext(repo, itemId) {
  const evidence = repo.addEvidenceBlock(itemId, {
    block_type: "mention",
    text_value: "Phone: 080 441 5224",
    source_url: "https://example.com/golden-hour-phone",
    status: "active",
  });
  repo.addApprovedContextBlock(itemId, {
    evidence_block_id: evidence.id,
    context_type: "mention",
    selected_text: "Phone: 080 441 5224",
    status: "active",
    provenance_json: {
      evidence_source_url: "https://example.com/golden-hour-phone",
    },
  });
}

function seedNonCtaApprovedContext(repo, itemId) {
  const evidence = repo.addEvidenceBlock(itemId, {
    block_type: "fact",
    text_value: "Open daily from morning until evening.",
    source_url: "https://example.com/non-cta-fact",
    status: "active",
  });
  repo.addApprovedContextBlock(itemId, {
    evidence_block_id: evidence.id,
    context_type: "fact",
    selected_text: "Open daily from morning until evening.",
    status: "active",
    provenance_json: {
      evidence_source_url: "https://example.com/non-cta-fact",
    },
  });
}

function createAiConfig() {
  return {
    enabled: true,
    agentEngine: "internal",
    backendApiBase: "https://backend.example/api",
    backendSyncToken: "sync-token",
    features: {
      visualContext: { provider: "google", model: "gemini-2.5-flash-lite", backendApiBase: "https://backend.example/api", backendSyncToken: "sync-token" },
      fieldPack: { provider: "openai", model: "gpt-5.4-mini", backendApiBase: "https://backend.example/api", backendSyncToken: "sync-token" },
    },
  };
}

function mockBackendFieldPackFetch(fieldPack = null) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url || "");
    if (target === "https://backend.example/api/internal/ai/json") {
      return Response.json({
        output_text: JSON.stringify({
          field_pack: fieldPack || {
            status: "draft",
            ai_summary: "field brief",
            story_angle: "coffee stop",
            social_hook: "sunset coffee stop",
            ai_cta_contact_json: {
              phone: "1498607143",
            },
            checklists: {
              must_verify_fact: ["verify opening hours"],
              must_capture: [{ capture_type: "photo", item_text: "capture storefront" }],
              must_ask_question: ["ask staff about signature drink"],
            },
          },
        }),
      });
    }
    throw new Error(`unexpected fetch ${target}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function captureTraceLogs() {
  const originalError = console.error;
  let buffer = "";
  console.error = (...args) => {
    buffer += `${args.map((value) => String(value)).join(" ")}\n`;
  };
  return {
    read() {
      return buffer;
    },
    restore() {
      console.error = originalError;
    },
  };
}

test("workflow integration behind /api/run/ai-draft preserves CTA phone through actual save payload and reload", async () => {
  const ctx = createTestContext();
  const restoreFetch = mockBackendFieldPackFetch();
  const trace = captureTraceLogs();
  const originalTraceFlag = process.env.COLLECTOR_CTA_TRACE;
  process.env.COLLECTOR_CTA_TRACE = "1";
  try {
    const item = createEligibleItem(ctx.repo, "Golden Hour Coffee");
    seedSelectedImage(ctx.db, item.id, "cover");
    seedGoldenHourContext(ctx.repo, item.id);

    await runAiDraftStage(ctx.repo, "tester@local", {
      mode: "ai",
      allowFallback: false,
      aiConfig: createAiConfig(),
      contentItemId: item.id,
    });

    const saved = ctx.repo.getCurrentFieldPackByItem(item.id);
    assert.equal(saved.ai_cta_contact_json.phone, "0804415224");

    const logs = trace.read();
    assert.match(logs, /\[collector-cta-trace\] normalizeFieldPack\.after_merge/);
    assert.match(logs, /"cta_phone_last4":"5224"/);
    assert.match(logs, /\[collector-cta-trace\] actualFieldPackSavePayload/);
    assert.match(logs, /"caller_path":"\/api\/run\/ai-draft"/);
    assert.match(logs, /\[collector-cta-trace\] repository\.createFieldPack\.normalized/);
  } finally {
    process.env.COLLECTOR_CTA_TRACE = originalTraceFlag;
    trace.restore();
    restoreFetch();
    ctx.cleanup();
  }
});

test("workflow integration behind /api/run/ai-draft keeps existing handoff snapshots immutable", async () => {
  const ctx = createTestContext();
  const restoreFetch = mockBackendFieldPackFetch();
  try {
    const item = createEligibleItem(ctx.repo, "Golden Hour Snapshot");
    seedSelectedImage(ctx.db, item.id, "cover");
    seedGoldenHourContext(ctx.repo, item.id);
    const assigneeResult = ctx.db.prepare(`
      INSERT INTO users (email, display_name, profile_json, password_hash, managed_by_user_id, role)
      VALUES ('assignee-route@local', 'Assignee Route', '{}', '', NULL, 'user')
    `).run();
    const assigneeId = Number(assigneeResult.lastInsertRowid || 0) || 0;
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      ai_summary: "existing brief",
      story_angle: "existing angle",
      social_hook: "existing hook",
      requested_checks_json: {
        version: 1,
        groups: [
          {
            group_key: "cta_contact",
            group_label: "CTA contact",
            checks: [
              {
                key: "phone",
                requested: true,
                label: "Phone",
                instruction: "Confirm phone",
                answer_type: "text",
                suggested_value: "0999999999",
              },
            ],
          },
        ],
      },
      updated_by: "tester@local",
    });
    const assignmentResult = ctx.repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assigneeId },
      assigneeId,
      "tester@local",
      "admin"
    );
    const assignmentId = Number(assignmentResult.assignment.id || 0) || 0;
    const snapshotBefore = ctx.db.prepare(`
      SELECT handoff_package_json
      FROM content_assignment_handoff_snapshots
      WHERE assignment_id=?
      ORDER BY id DESC
      LIMIT 1
    `).get(assignmentId)?.handoff_package_json || "";

    await runAiDraftStage(ctx.repo, "tester@local", {
      mode: "ai",
      allowFallback: false,
      aiConfig: createAiConfig(),
      contentItemId: item.id,
    });

    const snapshotAfter = ctx.db.prepare(`
      SELECT handoff_package_json
      FROM content_assignment_handoff_snapshots
      WHERE assignment_id=?
      ORDER BY id DESC
      LIMIT 1
    `).get(assignmentId)?.handoff_package_json || "";
    const saved = ctx.repo.getCurrentFieldPackByItem(item.id);

    assert.equal(snapshotAfter, snapshotBefore);
    assert.equal(saved.ai_cta_contact_json.phone, "0804415224");
  } finally {
    restoreFetch();
    ctx.cleanup();
  }
});

test("workflow integration clears stale phone but may preserve confidence metadata when current generation has no valid phone", async () => {
  const ctx = createTestContext();
  const restoreFetch = mockBackendFieldPackFetch({
    status: "draft",
    ai_summary: "field brief",
    story_angle: "coffee stop",
    social_hook: "sunset coffee stop",
    ai_cta_contact_json: {
      phone: "1498607143",
    },
    checklists: {
      must_verify_fact: ["verify opening hours"],
      must_capture: [{ capture_type: "photo", item_text: "capture storefront" }],
      must_ask_question: ["ask staff about signature drink"],
    },
  });
  const trace = captureTraceLogs();
  const originalTraceFlag = process.env.COLLECTOR_CTA_TRACE;
  process.env.COLLECTOR_CTA_TRACE = "1";
  try {
    const item = createEligibleItem(ctx.repo, "CTA Reset A");
    seedSelectedImage(ctx.db, item.id, "cover");
    seedNonCtaApprovedContext(ctx.repo, item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "draft",
      ai_summary: "old",
      story_angle: "old",
      social_hook: "old",
      ai_cta_contact_json: {
        phone: "1498607143",
        confidence: "medium",
      },
      updated_by: "tester@local",
    });

    await runAiDraftStage(ctx.repo, "tester@local", {
      mode: "ai",
      allowFallback: false,
      aiConfig: createAiConfig(),
      contentItemId: item.id,
    });

    const logs = trace.read();
    assert.match(logs, /actualFieldPackSavePayload .*"cta_keys":\["confidence"\]/);
    assert.doesNotMatch(logs, /actualFieldPackSavePayload .*"cta_keys":\[[^\]]*"phone"/);
    const saved = ctx.repo.getCurrentFieldPackByItem(item.id);
    assert.equal(saved.ai_cta_contact_json.phone, null);
    assert.equal(saved.ai_cta_contact_json.confidence, "medium");
  } finally {
    process.env.COLLECTOR_CTA_TRACE = originalTraceFlag;
    trace.restore();
    restoreFetch();
    ctx.cleanup();
  }
});

test("workflow integration removes stale website and LINE values when current generation omits them", async () => {
  const ctx = createTestContext();
  const restoreFetch = mockBackendFieldPackFetch({
    status: "draft",
    ai_summary: "field brief",
    story_angle: "coffee stop",
    social_hook: "sunset coffee stop",
    ai_cta_contact_json: {},
    checklists: {
      must_verify_fact: ["verify opening hours"],
      must_capture: [{ capture_type: "photo", item_text: "capture storefront" }],
      must_ask_question: ["ask staff about signature drink"],
    },
  });
  const trace = captureTraceLogs();
  const originalTraceFlag = process.env.COLLECTOR_CTA_TRACE;
  process.env.COLLECTOR_CTA_TRACE = "1";
  try {
    const item = createEligibleItem(ctx.repo, "CTA Reset B");
    seedSelectedImage(ctx.db, item.id, "cover");
    seedNonCtaApprovedContext(ctx.repo, item.id);
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "draft",
      ai_summary: "old",
      story_angle: "old",
      social_hook: "old",
      ai_cta_contact_json: {
        line_url: "https://line.me/stale",
        website_url: "https://stale.example",
        confidence: "low",
      },
      updated_by: "tester@local",
    });

    await runAiDraftStage(ctx.repo, "tester@local", {
      mode: "ai",
      allowFallback: false,
      aiConfig: createAiConfig(),
      contentItemId: item.id,
    });

    const logs = trace.read();
    assert.match(logs, /actualFieldPackSavePayload .*"cta_keys":\["confidence"\]/);
    assert.doesNotMatch(logs, /actualFieldPackSavePayload .*line_url/);
    assert.doesNotMatch(logs, /actualFieldPackSavePayload .*website_url/);
    const saved = ctx.repo.getCurrentFieldPackByItem(item.id);
    assert.equal(saved.ai_cta_contact_json.line_url, null);
    assert.equal(saved.ai_cta_contact_json.website_url, null);
  } finally {
    process.env.COLLECTOR_CTA_TRACE = originalTraceFlag;
    trace.restore();
    restoreFetch();
    ctx.cleanup();
  }
});

test("route wiring for POST /api/run/ai-draft delegates to runAiDraftStage with ai mode and no fallback", () => {
  assert.match(indexSource, /app\.post\("\/api\/run\/ai-draft", requireRole\("admin", "user"\), workflowRateLimit, async \(req, res\) => \{/);
  assert.match(indexSource, /const mode = "ai";/);
  assert.match(indexSource, /const allowFallback = false;/);
  assert.match(indexSource, /result = await runAiDraftStage\(repo, actorEmail\(req\), \{ mode, allowFallback, aiConfig, contentItemId \}\);/);
});
