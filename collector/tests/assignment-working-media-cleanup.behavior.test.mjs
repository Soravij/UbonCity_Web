import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverIndexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractNamedFunctionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function extractFunctionSlice(source, name, nextName) {
  const marker = `function ${name}`;
  const nextMarker = `function ${nextName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return source.slice(start, end).trimEnd();
}

const buildAssignmentWorkCleanupHarness = new Function(
  "db",
  "fsSync",
  "resolveStoragePath",
  `const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
${extractNamedFunctionSource(serverIndexJs, "sanitizeAssignmentSyncBatchId")}
${extractNamedFunctionSource(serverIndexJs, "sanitizeAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "parseIsoMs")}
${extractFunctionSlice(serverIndexJs, "listDraftAssignmentWorkAssetRows", "removeAssignmentWorkRowsByAssetIds")}
${extractFunctionSlice(serverIndexJs, "removeAssignmentWorkRowsByAssetIds", "cleanupSupersededAssignmentWorkAssetSlot")}
${extractFunctionSlice(serverIndexJs, "cleanupSupersededAssignmentWorkAssetSlot", "cleanupExpiredAssignmentWorkDraftAssets")}
${extractFunctionSlice(serverIndexJs, "cleanupExpiredAssignmentWorkDraftAssets", "cleanupSupersededAssignmentWorkAssetsAfterSubmit")}
return {
  cleanupSupersededAssignmentWorkAssetSlot,
  cleanupExpiredAssignmentWorkDraftAssets,
};`
);

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-working-media-cleanup-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);
  const mediaDir = path.join(tempDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title = "Assignment cleanup test") {
    return repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title,
      description_raw: `${title} raw`,
      source_type: "manual",
      source_name: "manual",
      source_url: `https://${title.toLowerCase().replace(/\s+/g, "-")}.example.com`,
    }).item;
  }

  function createUser(suffix = "working-media") {
    const email = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', 'user')
    `).run(email, `User ${suffix}`);
    return { id: Number(result.lastInsertRowid || 0), email };
  }

  function createReadinessBrief(itemId, suffix = "A") {
    const result = db.prepare(`
      INSERT INTO content_readiness_briefs (
        content_item_id,
        readiness_json,
        brief_json,
        reasons_json,
        blockers_json,
        missing_requirements_json,
        computed_by
      ) VALUES (?, ?, ?, '[]', '[]', '[]', 'tester@local')
    `).run(
      itemId,
      JSON.stringify({ ready_for_content: true, ready_for_publish: false, blockers: [], missing_requirements: [], label: `Readiness ${suffix}` }),
      JSON.stringify({ brief_summary: `Readiness brief ${suffix}` })
    );
    return Number(result.lastInsertRowid || 0) || 0;
  }

  function createAssignment(item, suffix = "A") {
    const assignee = createUser(`assignee-${suffix}`);
    createReadinessBrief(item.id, suffix);
    const result = repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    );
    return { assignment: result.assignment, assignee };
  }

  function createSubmission(assignmentId, itemId, userId, state = "submitted") {
    const result = db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state,
        article_payload_json, media_payload_json, contributor_note, reviewer_note, reviewed_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, NULL)
    `).run(assignmentId, itemId, userId, state, `submission ${state}`);
    return Number(result.lastInsertRowid || 0) || 0;
  }

  function insertWorkingAsset(itemId, options = {}) {
    const assignmentId = Number(options.assignmentId || 24) || 24;
    const assignmentRound = Number(options.assignmentRound || 2) || 2;
    const mediaType = String(options.mediaType || "image").trim().toLowerCase() || "image";
    const slotKey = String(options.slotKey || "shot-1-storefront-hero").trim().toLowerCase();
    const syncBatchId = String(options.syncBatchId || "batch-a").trim();
    const createdAt = String(options.createdAt || "2026-06-30T00:00:00.000Z");
    const extension = mediaType === "video" ? "mp4" : "jpg";
    const mimeType = mediaType === "video" ? "video/mp4" : "image/jpeg";
    const relativePath = `uploads/${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}.${extension}`;
    const absolutePath = path.join(mediaDir, relativePath.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.from(`${mediaType}:${syncBatchId}`));
    const assetResult = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, 'local', ?, ?, ?, ?, ?)
    `).run(
      `asset-${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}`,
      relativePath,
      path.basename(relativePath),
      mimeType,
      fs.statSync(absolutePath).size,
      `checksum-${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}`
    );
    const assetId = Number(assetResult.lastInsertRowid || 0) || 0;
    db.prepare("UPDATE assets SET created_at=? WHERE id=?").run(createdAt, assetId);
    const contentAssetResult = db.prepare(`
      INSERT INTO content_assets (
        content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order,
        assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id
      ) VALUES (?, ?, 'unused', 0, 0, 'unused', 0, ?, ?, ?, ?, 'assignment_work', ?)
    `).run(itemId, assetId, assignmentId, assignmentRound, mediaType, slotKey, syncBatchId);
    return {
      assetId,
      contentAssetId: Number(contentAssetResult.lastInsertRowid || 0) || 0,
      relativePath,
      absolutePath,
      assignmentId,
      assignmentRound,
      mediaType,
      slotKey,
      syncBatchId,
    };
  }

  const harness = buildAssignmentWorkCleanupHarness(
    db,
    fs,
    (relativePath) => path.join(mediaDir, String(relativePath || "").replace(/\//g, path.sep))
  );

  return {
    db,
    repo,
    mediaDir,
    cleanup,
    createItem,
    createAssignment,
    createSubmission,
    insertWorkingAsset,
    harness,
  };
}

test("replacement cleanup hard-deletes superseded unsubmitted media in the same slot and type only", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    const oldImage = ctx.insertWorkingAsset(item.id, { syncBatchId: "batch-old", mediaType: "image", slotKey: "shot-1-storefront-hero" });
    const newImage = ctx.insertWorkingAsset(item.id, { syncBatchId: "batch-new", mediaType: "image", slotKey: "shot-1-storefront-hero" });
    const otherType = ctx.insertWorkingAsset(item.id, { syncBatchId: "batch-video", mediaType: "video", slotKey: "shot-1-storefront-hero" });

    const result = ctx.harness.cleanupSupersededAssignmentWorkAssetSlot({
      assignmentId: newImage.assignmentId,
      assignmentRound: newImage.assignmentRound,
      assignmentSlotKey: newImage.slotKey,
      assignmentMediaType: newImage.mediaType,
      assignmentSyncBatchId: newImage.syncBatchId,
      keepAssetIds: [newImage.assetId],
    });

    assert.equal(result.removed_links, 1);
    assert.equal(result.removed_assets, 1);
    assert.deepEqual(result.deleted_files, [oldImage.relativePath]);
    assert.equal(fs.existsSync(oldImage.absolutePath), false);
    assert.equal(fs.existsSync(newImage.absolutePath), true);
    assert.equal(fs.existsSync(otherType.absolutePath), true);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(oldImage.assetId)?.c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(newImage.assetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(otherType.assetId)?.c || 0), 1);
  } finally {
    ctx.cleanup();
  }
});

test("replacement cleanup removes only the working link when old media already has a submission deliverable reference", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Replacement deliverable ref");
    const { assignment, assignee } = ctx.createAssignment(item, "deliverable-ref");
    const oldImage = ctx.insertWorkingAsset(item.id, {
      assignmentId: Number(assignment.id || 0),
      assignmentRound: 1,
      syncBatchId: "batch-old",
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
    });
    const submissionId = ctx.createSubmission(Number(assignment.id || 0), item.id, assignee.id, "submitted");
    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionId, Number(assignment.id || 0));
    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: Number(assignment.id || 0),
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "photos",
      source_asset_id: oldImage.assetId,
    }, "tester@local");
    const newImage = ctx.insertWorkingAsset(item.id, {
      assignmentId: Number(assignment.id || 0),
      assignmentRound: 1,
      syncBatchId: "batch-new",
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
    });

    const result = ctx.harness.cleanupSupersededAssignmentWorkAssetSlot({
      assignmentId: Number(assignment.id || 0),
      assignmentRound: 1,
      assignmentSlotKey: newImage.slotKey,
      assignmentMediaType: newImage.mediaType,
      assignmentSyncBatchId: newImage.syncBatchId,
      keepAssetIds: [newImage.assetId],
    });

    assert.equal(result.removed_links, 1);
    assert.equal(result.removed_assets, 0);
    assert.deepEqual(result.deleted_files, []);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(oldImage.assetId)?.c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(oldImage.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(oldImage.absolutePath), true);
  } finally {
    ctx.cleanup();
  }
});

test("expired working media older than 24 hours is hard-deleted only when it has no submission deliverable reference", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Expired working media");
    const stale = ctx.insertWorkingAsset(item.id, {
      assignmentId: 99,
      assignmentRound: 2,
      syncBatchId: "batch-stale",
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
      createdAt: "2026-06-28T00:00:00.000Z",
    });
    const { assignment, assignee } = ctx.createAssignment(item, "expiry-ref");
    const retained = ctx.insertWorkingAsset(item.id, {
      assignmentId: Number(assignment.id || 0),
      assignmentRound: 1,
      syncBatchId: "batch-retained",
      mediaType: "video",
      slotKey: "shot-2-walkthrough-clip",
      createdAt: "2026-06-28T00:00:00.000Z",
    });
    const submissionId = ctx.createSubmission(Number(assignment.id || 0), item.id, assignee.id, "submitted");
    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionId, Number(assignment.id || 0));
    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: Number(assignment.id || 0),
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "videos",
      source_asset_id: retained.assetId,
    }, "tester@local");

    const result = ctx.harness.cleanupExpiredAssignmentWorkDraftAssets({ contentItemId: item.id, maxAgeMs: 24 * 60 * 60 * 1000 });

    assert.equal(result.removed_links, 1);
    assert.equal(result.removed_assets, 1);
    assert.deepEqual(result.deleted_files, [stale.relativePath]);
    assert.equal(fs.existsSync(stale.absolutePath), false);
    assert.equal(fs.existsSync(retained.absolutePath), true);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(stale.assetId)?.c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(retained.assetId)?.c || 0), 1);
  } finally {
    ctx.cleanup();
  }
});

test("revision reset keeps referenced submitted media asset rows and physical files while removing the working link", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Revision reset guard");
    const { assignment, assignee } = ctx.createAssignment(item, "revision-reset");
    ctx.db.prepare("UPDATE content_assignments SET revision_round=1 WHERE id=?").run(Number(assignment.id || 0));
    const linkedImage = ctx.insertWorkingAsset(item.id, {
      assignmentId: Number(assignment.id || 0),
      assignmentRound: 1,
      syncBatchId: "batch-reset",
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
    });
    const submissionId = ctx.createSubmission(Number(assignment.id || 0), item.id, assignee.id, "submitted");
    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionId, Number(assignment.id || 0));
    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: Number(assignment.id || 0),
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "photos",
      source_asset_id: linkedImage.assetId,
    }, "tester@local");

    const result = ctx.repo.deleteAssignmentRoundAssetsByType(Number(assignment.id || 0), 1, "image");

    assert.equal(result.removed_content_assets, 1);
    assert.equal(result.removed_assets, 0);
    assert.deepEqual(result.deleted_files, []);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(linkedImage.assetId)?.c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(linkedImage.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(linkedImage.absolutePath), true);
  } finally {
    ctx.cleanup();
  }
});
