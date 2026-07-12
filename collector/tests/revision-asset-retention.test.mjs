import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const testFilePath = fileURLToPath(import.meta.url);
const testsDir = path.dirname(testFilePath);
const collectorRoot = path.resolve(testsDir, "..");
const serverIndexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

// Brace-matching that skips the parameter list (parens) first, so default
// object-literal params like `(options = {})` don't terminate extraction early.
function extractNamedFunctionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const parenStart = start + marker.length - 1;
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = parenStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  assert.notEqual(paramsEnd, -1, `${name} should have a parameter list`);
  const bodyStart = source.indexOf("{", paramsEnd);
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

const listActiveAssignmentWorkAssetRowsForTest = new Function(
  "db",
  `${extractNamedFunctionSource(serverIndexJs, "listDraftAssignmentWorkAssetRows")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentWorkAssetSlotMediaKey")}
${extractNamedFunctionSource(serverIndexJs, "listActiveAssignmentWorkAssetRows")}
return listActiveAssignmentWorkAssetRows;`
);

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-asset-retention-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.join(collectorRoot, "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title) {
    const created = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title,
      description_raw: `${title} raw`,
      source_type: "manual",
      source_name: "manual",
      source_url: `https://${title.toLowerCase().replace(/\s+/g, "-")}.example.com`,
    });
    return created.item;
  }

  function createUser(suffix = "user") {
    const email = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', 'user')
    `).run(email, `User ${suffix}`);
    return { id: Number(result.lastInsertRowid || 0), email };
  }

  function createAssignment(itemId, assigneeUserId) {
    return repo.createAssignment({
      content_item_id: itemId,
      assignee_user_id: assigneeUserId,
      assignment_kind: "field",
      state: "assigned",
      due_at: new Date(Date.now() + 86400000).toISOString(),
    }, assigneeUserId, {
      actor_email: "tester@local",
      actor_role: "admin",
      reason_code: "test_assignment_created",
    });
  }

  function createAssignmentWorkAsset(itemId, assignmentId, round, suffix = "A", options = {}) {
    const mimeType = String(options.mime_type || "image/jpeg");
    const extension = String(options.extension || (mimeType.startsWith("video/") ? "mp4" : "jpg"));
    const storageDisk = String(options.storage_disk || "local");
    const slotKey = String(options.slot_key || options.slotKey || `${itemId}-${assignmentId}-${round}-${suffix}`).trim();
    const fileName = String(options.file_name || (slotKey ? `${slotKey}__${suffix}.${extension}` : `${itemId}-${assignmentId}-${round}-${suffix}.${extension}`)).trim();
    const storagePath = String(options.storage_path || `uploads/${fileName}`).trim();
    const assetResult = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum)
      VALUES (?, ?, ?, ?, ?, 100, ?)
    `).run(
      `work-asset-${itemId}-${assignmentId}-${round}-${suffix}`,
      storageDisk,
      storagePath,
      fileName,
      mimeType,
      `work-checksum-${itemId}-${assignmentId}-${round}-${suffix}`
    );
    const assetId = Number(assetResult.lastInsertRowid || 0);
    const surface = String(options.assignment_surface || "assignment_work").trim() || "assignment_work";
    const mediaType = String(options.assignment_media_type || (mimeType.startsWith("video/") ? "video" : "image")).trim().toLowerCase();
    db.prepare(`
      INSERT INTO content_assets (
        content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order,
        assignment_id, assignment_round, assignment_media_type, assignment_surface, assignment_sync_batch_id
      ) VALUES (?, ?, 'gallery', 1, 0, 'gallery', 0, ?, ?, ?, ?, ?)
    `).run(itemId, assetId, assignmentId, round, mediaType, surface, `sync-${itemId}-${assignmentId}-${round}-${suffix}`);
    return { asset_id: assetId };
  }

  function requestRevision(assignmentId, payload = {}) {
    return repo.requestAssignmentRevisionWithReset(assignmentId, "reviewer@local", {
      actor_role: "admin",
      reason_code: "test_revision_requested",
      ...payload,
    });
  }

  // Advances the assignment through two revision-request cycles so the canonical
  // round moves from 1 to 2 (the first revision_requested transition only bumps
  // revision_round 0 -> 1, which still canonically resolves to round 1).
  function advanceToRoundTwo(assignmentId) {
    repo.updateAssignmentState(assignmentId, "submitted", "tester@local", { actor_role: "admin", reason_code: "test_submit" });
    requestRevision(assignmentId);
    repo.updateAssignmentState(assignmentId, "resubmitted", "tester@local", { actor_role: "admin", reason_code: "test_resubmit" });
    return requestRevision(assignmentId);
  }

  return {
    db, repo, cleanup, createItem, createUser, createAssignment, createAssignmentWorkAsset,
    requestRevision, advanceToRoundTwo,
  };
}

test("assignment work retains a prior-round asset across a revision as the active asset for its slot", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Retention Basic Place");
    const assignee = ctx.createUser("retention-basic");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const roundOneAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "kept", {
      slot_key: "shot-a",
      file_name: "shot-a__kept.jpg",
      assignment_media_type: "image",
    });

    ctx.advanceToRoundTwo(assignment.id);
    const refreshed = ctx.repo.getAssignmentById(assignment.id);
    assert.equal(Number(refreshed.revision_round || 0), 2);

    const activeRows = listActiveAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id });
    assert.equal(activeRows.length, 1);
    assert.equal(Number(activeRows[0].asset_id || 0), roundOneAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("assignment work keeps retaining an untouched asset across multiple revisions", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Retention Multi Place");
    const assignee = ctx.createUser("retention-multi");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const roundOneAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "kept", {
      slot_key: "shot-a",
      file_name: "shot-a__kept.jpg",
      assignment_media_type: "image",
    });

    ctx.advanceToRoundTwo(assignment.id);
    ctx.repo.updateAssignmentState(assignment.id, "resubmitted", "tester@local", { actor_role: "admin", reason_code: "test_resubmit" });
    ctx.requestRevision(assignment.id);
    ctx.repo.updateAssignmentState(assignment.id, "resubmitted", "tester@local", { actor_role: "admin", reason_code: "test_resubmit" });
    ctx.requestRevision(assignment.id);

    const refreshed = ctx.repo.getAssignmentById(assignment.id);
    assert.equal(Number(refreshed.revision_round || 0), 4);

    const activeRows = listActiveAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id });
    assert.equal(activeRows.length, 1);
    assert.equal(Number(activeRows[0].asset_id || 0), roundOneAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("a new upload for the same slot and media type in a later round supersedes the older retained asset", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Cross Round Replace Place");
    const assignee = ctx.createUser("cross-round-replace");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const oldAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "old", {
      slot_key: "shot-b",
      file_name: "shot-b__old.jpg",
      assignment_media_type: "image",
    });

    ctx.advanceToRoundTwo(assignment.id);
    const newAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 2, "new", {
      slot_key: "shot-b",
      file_name: "shot-b__new.jpg",
      assignment_media_type: "image",
    });

    const activeRows = listActiveAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id });
    assert.equal(activeRows.length, 1);
    assert.equal(Number(activeRows[0].asset_id || 0), newAsset.asset_id);
    assert.notEqual(Number(activeRows[0].asset_id || 0), oldAsset.asset_id);

    // Cross-round replacement does not hard-delete the superseded row; it is only excluded from "active".
    const oldStillLinked = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(oldAsset.asset_id);
    assert.equal(Number(oldStillLinked.c || 0) > 0, true);
  } finally {
    ctx.cleanup();
  }
});

test("image_reset_required removes only image assignment-work assets; retained video stays", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Reset Split Place");
    const assignee = ctx.createUser("reset-split");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const imageAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "img", {
      slot_key: "shot-c",
      file_name: "shot-c__img.jpg",
      mime_type: "image/jpeg",
      assignment_media_type: "image",
    });
    const videoAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "vid", {
      slot_key: "shot-c",
      file_name: "shot-c__vid.mp4",
      mime_type: "video/mp4",
      assignment_media_type: "video",
    });

    ctx.repo.updateAssignmentState(assignment.id, "submitted", "tester@local", { actor_role: "admin", reason_code: "test_submit" });
    ctx.requestRevision(assignment.id, {
      image_reset_required: true,
      image_reset_reason: "blurry photos",
    });

    const imageLinked = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(imageAsset.asset_id);
    assert.equal(Number(imageLinked.c || 0), 0);
    const videoLinked = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(videoAsset.asset_id);
    assert.equal(Number(videoLinked.c || 0), 1);
  } finally {
    ctx.cleanup();
  }
});

test("reset targets the canonical current round, not revision_round + 1, and still reaches a retained older-round asset", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Reset Round Targeting Place");
    const assignee = ctx.createUser("reset-round-target");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const roundOneImage = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "img", {
      slot_key: "shot-d",
      file_name: "shot-d__img.jpg",
      assignment_media_type: "image",
    });

    ctx.repo.updateAssignmentState(assignment.id, "submitted", "tester@local", { actor_role: "admin", reason_code: "test_submit" });
    ctx.requestRevision(assignment.id); // revision_round 0 -> 1, no reset; asset stays untouched at round 1
    ctx.repo.updateAssignmentState(assignment.id, "resubmitted", "tester@local", { actor_role: "admin", reason_code: "test_resubmit" });
    const result = ctx.requestRevision(assignment.id, {
      image_reset_required: true,
      image_reset_reason: "still not usable",
    }); // revision_round 1 -> 2; canonical round before this call was 1, not 2

    assert.equal(result.round_before_revision, 1);
    const imageLinked = ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(roundOneImage.asset_id);
    assert.equal(Number(imageLinked.c || 0), 0);
  } finally {
    ctx.cleanup();
  }
});

test("a retained prior-round asset that was never replaced or reset can be bound to a deliverable", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Bind Retained Place");
    const assignee = ctx.createUser("bind-retained");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const retainedAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "kept", {
      slot_key: "shot-e",
      file_name: "shot-e__kept.jpg",
      assignment_media_type: "image",
    });

    ctx.repo.addAssignmentSubmission({ assignment_id: assignment.id, submitted_by_user_id: assignee.id, submission_state: "submitted" });
    ctx.advanceToRoundTwo(assignment.id);
    const resubmitted = ctx.repo.addAssignmentSubmission({ assignment_id: assignment.id, submitted_by_user_id: assignee.id, submission_state: "resubmitted" });

    const created = ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignment.id,
      submission_id: resubmitted.id,
      deliverable_type: "photos",
      source_asset_id: retainedAsset.asset_id,
    }, "tester@local");
    assert.equal(Number(created.source_asset_id || 0), retainedAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("a superseded (cross-round replaced) asset cannot be bound to a deliverable; only the latest active one can", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Bind Superseded Place");
    const assignee = ctx.createUser("bind-superseded");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const oldAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "old", {
      slot_key: "shot-f",
      file_name: "shot-f__old.jpg",
      assignment_media_type: "image",
    });

    ctx.repo.addAssignmentSubmission({ assignment_id: assignment.id, submitted_by_user_id: assignee.id, submission_state: "submitted" });
    ctx.advanceToRoundTwo(assignment.id);
    const resubmitted = ctx.repo.addAssignmentSubmission({ assignment_id: assignment.id, submitted_by_user_id: assignee.id, submission_state: "resubmitted" });

    const newAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 2, "new", {
      slot_key: "shot-f",
      file_name: "shot-f__new.jpg",
      assignment_media_type: "image",
    });

    assert.throws(() => {
      ctx.repo.createAssignmentSubmissionDeliverable({
        assignment_id: assignment.id,
        submission_id: resubmitted.id,
        deliverable_type: "photos",
        source_asset_id: oldAsset.asset_id,
      }, "tester@local");
    }, /source_asset_id does not belong to current assignment round/);

    const created = ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignment.id,
      submission_id: resubmitted.id,
      deliverable_type: "photos",
      source_asset_id: newAsset.asset_id,
    }, "tester@local");
    assert.equal(Number(created.source_asset_id || 0), newAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("a reset asset no longer exists and cannot be bound to a deliverable", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Bind Reset Place");
    const assignee = ctx.createUser("bind-reset");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const imageAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "img", {
      slot_key: "shot-g",
      file_name: "shot-g__img.jpg",
      assignment_media_type: "image",
    });

    ctx.repo.addAssignmentSubmission({ assignment_id: assignment.id, submitted_by_user_id: assignee.id, submission_state: "submitted" });
    ctx.repo.updateAssignmentState(assignment.id, "submitted", "tester@local", { actor_role: "admin", reason_code: "test_submit" });
    ctx.requestRevision(assignment.id, {
      image_reset_required: true,
      image_reset_reason: "not usable",
    });
    const resubmitted = ctx.repo.addAssignmentSubmission({ assignment_id: assignment.id, submitted_by_user_id: assignee.id, submission_state: "resubmitted" });

    assert.throws(() => {
      ctx.repo.createAssignmentSubmissionDeliverable({
        assignment_id: assignment.id,
        submission_id: resubmitted.id,
        deliverable_type: "photos",
        source_asset_id: imageAsset.asset_id,
      }, "tester@local");
    }, /source_asset_id does not belong to content item/);
  } finally {
    ctx.cleanup();
  }
});
