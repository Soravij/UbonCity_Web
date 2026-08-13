import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { runAiDraftStage } from "../services/workflow.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "AiDraft!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-ai-draft-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve(process.cwd(), "collector", "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItemWithSetup(overrides = {}) {
    const result = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title: "AI Draft Test Place",
      description_raw: "A sufficiently detailed place description for testing. ".repeat(8),
      description_clean: "",
      summary: "",
      meta_title: "AI Draft Test",
      meta_description: "A test place for AI draft generation",
      image_url: "",
      tags: [],
      lang: "th",
      slug: "ai-draft-test-place",
      latitude: 15.2,
      longitude: 104.8,
      ...overrides,
    });
    const itemId = Number(result?.item?.id || 0) || 0;

    db.prepare(`
      UPDATE content_items
      SET description_raw=?, meta_title=?, meta_description=?, slug=?, latitude=?, longitude=?
      WHERE id=?
    `).run(
      "A sufficiently detailed place description for testing. ".repeat(8),
      "AI Draft Test",
      "A test place for AI draft generation that is long enough",
      "ai-draft-test-place",
      15.2,
      104.8,
      itemId
    );

    const coverResult = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes)
      VALUES (?, 'local', 'uploads/test-cover.jpg', 'test-cover.jpg', 'image/jpeg', 1024)
    `).run(`uid-cover-${itemId}`);
    const coverAssetId = Number(coverResult.lastInsertRowid);

    db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'cover', 1, 1, 'gallery', 0)
    `).run(itemId, coverAssetId);

    const galleryResult = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes)
      VALUES (?, 'local', 'uploads/test-gallery.jpg', 'test-gallery.jpg', 'image/jpeg', 1024)
    `).run(`uid-gallery-${itemId}`);
    const galleryAssetId = Number(galleryResult.lastInsertRowid);

    db.prepare(`
      INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order)
      VALUES (?, ?, 'gallery', 1, 0, 'gallery', 1)
    `).run(itemId, galleryAssetId);

    db.prepare(`
      INSERT INTO evidence_blocks (id, content_item_id, block_type, source_type, source_url, source_label, lang, text_value, status)
      VALUES (?, ?, 'fact', 'manual', 'https://example.com', 'test', 'th', 'Test evidence block', 'active')
    `).run(itemId * 100 + 1, itemId);

    db.prepare(`
      INSERT INTO approved_context_blocks (id, content_item_id, evidence_block_id, context_type, selected_text, sort_order, status)
      VALUES (?, ?, ?, 'fact', 'Test approved context text', 1, 'active')
    `).run(itemId * 100 + 1, itemId, itemId * 100 + 1);

    return repo.getItem(itemId);
  }

  function setProductionState(itemId, state) {
    db.prepare(`
      UPDATE content_workflow_models SET production_state=? WHERE content_item_id=?
    `).run(state, itemId);
  }

  return { db, repo, cleanup, createItemWithSetup, setProductionState };
}

function createMockAgentEngine(fieldPackOverride = null) {
  const defaultFieldPack = {
    ai_summary: "AI generated summary for test",
    story_angle: "Test story angle",
    social_hook: "Test social hook",
    field_notes: "Test field notes",
    writer_notes: "Test writer notes",
    writer_angle: "Test writer angle",
    writer_key_points: ["point 1", "point 2"],
    ai_highlights: ["highlight 1"],
    verified_facts: ["fact 1"],
    uncertain_facts: ["uncertain 1"],
    field_pack_checklists: [
      { checklist_type: "must_verify_fact", item_text: "verify opening hours", capture_type: null, item_order: 1, status: "todo", note: "" },
      { checklist_type: "must_capture", item_text: "capture entrance", capture_type: "photo", item_order: 2, status: "todo", note: "" },
      { checklist_type: "must_ask_question", item_text: "ask staff about rules", capture_type: null, item_order: 3, status: "todo", note: "" },
    ],
    ...fieldPackOverride,
  };

  return {
    async generateFieldPack(item, actorEmail) {
      return defaultFieldPack;
    },
    async generateVisualContext(item, actorEmail) {
      return null;
    },
  };
}

test("AI mode produces draft with non-empty body and transitions head to generated", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItemWithSetup();
    ctx.setProductionState(item.id, "analyzed");

    const agentEngine = createMockAgentEngine();
    const result = await runAiDraftStage(ctx.repo, "test@local", {
      mode: "ai",
      contentItemId: item.id,
      agentEngine,
      aiConfig: { model: "test-model", provider: "test" },
    });

    assert.equal(result.count, 1, "must process exactly 1 item");
    assert.equal(result.errorCount, 0, "must have no errors");

    const head = ctx.repo.ensureWorkflowModel(item.id);
    assert.equal(head.production_state, "generated", "head must be generated after AI draft");

    const draft = ctx.repo.latestDraftByItem(item.id);
    assert.ok(draft, "draft must exist");
    assert.ok(String(draft.body || "").trim().length > 0, "draft body must not be empty");
    assert.equal(draft.status, "generated", "draft status must be generated");
  } finally {
    ctx.cleanup();
  }
});

test("AI mode draft failure does not advance head from analyzed", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItemWithSetup();
    ctx.setProductionState(item.id, "analyzed");

    const agentEngine = createMockAgentEngine();

    const originalSaveDraft = ctx.repo.saveDraft.bind(ctx.repo);
    let callCount = 0;
    ctx.repo.saveDraft = function (...args) {
      callCount += 1;
      throw new Error("saveDraft failed intentionally");
    };

    await runAiDraftStage(ctx.repo, "test@local", {
      mode: "ai",
      contentItemId: item.id,
      agentEngine,
      aiConfig: { model: "test-model", provider: "test" },
    });

    assert.ok(callCount >= 1, "saveDraft must have been called at least once");

    const head = ctx.repo.ensureWorkflowModel(item.id);
    assert.equal(head.production_state, "analyzed", "head must stay at analyzed when draft save fails");
  } finally {
    ctx.cleanup();
  }
});

test("AI mode saves field pack before transitioning to generated", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItemWithSetup();
    ctx.setProductionState(item.id, "analyzed");

    const agentEngine = createMockAgentEngine({
      ai_summary: "Custom AI summary for field pack check",
      story_angle: "Custom angle",
    });

    await runAiDraftStage(ctx.repo, "test@local", {
      mode: "ai",
      contentItemId: item.id,
      agentEngine,
      aiConfig: { model: "test-model", provider: "test" },
    });

    const fieldPack = ctx.repo.getCurrentFieldPackByItem(item.id);
    assert.ok(fieldPack, "field pack must be saved");
    assert.ok(String(fieldPack.status || "").trim().length > 0, "field pack must have a status");

    const head = ctx.repo.ensureWorkflowModel(item.id);
    assert.equal(head.production_state, "generated", "head must be generated");
    assert.equal(head.current_field_pack_id, fieldPack.id, "head must reference the saved field pack");
  } finally {
    ctx.cleanup();
  }
});
