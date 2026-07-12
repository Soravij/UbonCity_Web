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

const listDraftAssignmentWorkAssetRowsForTest = new Function(
  "db",
  `${extractNamedFunctionSource(serverIndexJs, "listDraftAssignmentWorkAssetRows")}
return listDraftAssignmentWorkAssetRows;`
);

const listActiveAssignmentWorkAssetRowsForTest = new Function(
  "db",
  `${extractNamedFunctionSource(serverIndexJs, "listDraftAssignmentWorkAssetRows")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentWorkAssetSlotMediaKey")}
${extractNamedFunctionSource(serverIndexJs, "listActiveAssignmentWorkAssetRows")}
return listActiveAssignmentWorkAssetRows;`
);

const resolveAssignmentCurrentRoundForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentCurrentRound")}
return resolveAssignmentCurrentRound;`
)();


const removeAssignmentWorkReplacementLinksBeforeInsertForTest = new Function(
  "db",
  `${extractNamedFunctionSource(serverIndexJs, "removeAssignmentWorkReplacementLinksBeforeInsert")}
return removeAssignmentWorkReplacementLinksBeforeInsert;`
);
const isCollectorControlledLocalAssetRowForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "isCollectorControlledLocalAssetRow")}
return isCollectorControlledLocalAssetRow;`
)();

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-asset-row-"));
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
    `).run(itemId, assetId, assignmentId, round, mediaType, surface, String(options.assignment_sync_batch_id || options.assignmentSyncBatchId || `sync-${itemId}-${assignmentId}-${round}-${suffix}`));
    return { asset_id: assetId };
  }

  return { db, repo, cleanup, createItem, createUser, createAssignment, createAssignmentWorkAsset };
}

test("listDraftAssignmentWorkAssetRows exposes both id and asset_id equal to the asset primary key", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Asset Row Shape Place");
    const assignee = ctx.createUser("asset-row-shape");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const workAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "shape");

    const rows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: 1 });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].id || 0), workAsset.asset_id);
    assert.equal(Number(rows[0].asset_id || 0), workAsset.asset_id);
    assert.equal(rows[0].assignment_surface, "assignment_work");
  } finally {
    ctx.cleanup();
  }
});

test("listDraftAssignmentWorkAssetRows filters by assignment round", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Asset Row Round Place");
    const assignee = ctx.createUser("asset-row-round");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const roundOneAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "round-one");
    const roundTwoAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 2, "round-two");

    const roundOneRows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: 1 });
    assert.equal(roundOneRows.length, 1);
    assert.equal(Number(roundOneRows[0].asset_id || 0), roundOneAsset.asset_id);

    const roundTwoRows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: 2 });
    assert.equal(roundTwoRows.length, 1);
    assert.equal(Number(roundTwoRows[0].asset_id || 0), roundTwoAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("listActiveAssignmentWorkAssetRows keeps every file in the latest batch", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Batch Asset Place");
    const assignee = ctx.createUser("batch-asset");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "old", {
      slot_key: "shot-a",
      file_name: "shot-a__old.jpg",
      assignment_sync_batch_id: "batch-old",
    });
    const latestOne = ctx.createAssignmentWorkAsset(item.id, assignment.id, 2, "one", {
      slot_key: "shot-a",
      file_name: "shot-a__one.jpg",
      assignment_sync_batch_id: "batch-new",
    });
    const latestTwo = ctx.createAssignmentWorkAsset(item.id, assignment.id, 2, "two", {
      slot_key: "shot-a",
      file_name: "shot-a__two.jpg",
      assignment_sync_batch_id: "batch-new",
    });

    const rows = listActiveAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id });
    assert.deepEqual(rows.map((row) => Number(row.asset_id || 0)).sort((a, b) => a - b), [latestOne.asset_id, latestTwo.asset_id].sort((a, b) => a - b));
  } finally {
    ctx.cleanup();
  }
});
test("resolveAssignmentCurrentRound normalizes revision_round 0 to active round 1, otherwise passes through", () => {
  assert.equal(resolveAssignmentCurrentRoundForTest({ revision_round: 0 }), 1);
  assert.equal(resolveAssignmentCurrentRoundForTest({ revision_round: 1 }), 1);
  assert.equal(resolveAssignmentCurrentRoundForTest({ revision_round: 2 }), 2);
  assert.equal(resolveAssignmentCurrentRoundForTest(null), 1);
});

test("a fresh assignment (revision_round=0) resolves to round 1 for asset filtering, matching how uploads are tagged", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Asset Row First Round Place");
    const assignee = ctx.createUser("asset-row-first-round");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    assert.equal(Number(assignment.revision_round || 0), 0);

    const roundOneAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "first-round");
    const staleRoundAsset = ctx.createAssignmentWorkAsset(item.id, assignment.id, 2, "future-round");

    const canonicalRound = resolveAssignmentCurrentRoundForTest(assignment);
    assert.equal(canonicalRound, 1);

    const rows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: canonicalRound });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].asset_id || 0), roundOneAsset.asset_id);
    assert.notEqual(Number(rows[0].asset_id || 0), staleRoundAsset.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("isCollectorControlledLocalAssetRow allows video only when explicitly requested, and always requires local/nas storage", () => {
  const imageRow = { storage_disk: "local", storage_path: "uploads/a.jpg", mime_type: "image/jpeg" };
  const videoRow = { storage_disk: "local", storage_path: "uploads/a.mp4", mime_type: "video/mp4" };
  const remoteRow = { storage_disk: "local", storage_path: "https://example.com/a.jpg", mime_type: "image/jpeg" };
  const externalDiskRow = { storage_disk: "external", storage_path: "uploads/a.mp4", mime_type: "video/mp4" };

  assert.equal(isCollectorControlledLocalAssetRowForTest(imageRow), true);
  assert.equal(isCollectorControlledLocalAssetRowForTest(videoRow), false);
  assert.equal(isCollectorControlledLocalAssetRowForTest(videoRow, { allowVideo: true }), true);
  assert.equal(isCollectorControlledLocalAssetRowForTest(imageRow, { allowVideo: true }), true);
  assert.equal(isCollectorControlledLocalAssetRowForTest(remoteRow, { allowVideo: true }), false);
  assert.equal(isCollectorControlledLocalAssetRowForTest(externalDiskRow, { allowVideo: true }), false);
});

test("assignment-work asset rows keep both image and video once composed with the allowVideo filter", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Asset Row Video Eligible Place");
    const assignee = ctx.createUser("asset-row-video");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "photo", { mime_type: "image/jpeg", extension: "jpg" });
    ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "clip", { mime_type: "video/mp4", extension: "mp4" });

    const rows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: 1 });
    assert.equal(rows.length, 2);

    const withoutVideo = rows.filter((row) => isCollectorControlledLocalAssetRowForTest(row));
    assert.equal(withoutVideo.length, 1);
    assert.equal(withoutVideo[0].mime_type, "image/jpeg");

    const withVideo = rows.filter((row) => isCollectorControlledLocalAssetRowForTest(row, { allowVideo: true }));
    assert.equal(withVideo.length, 2);
  } finally {
    ctx.cleanup();
  }
});


test("replacement helper preserves the incoming batch and removes the prior batch as a whole", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Batch Replacement Place");
    const assignee = ctx.createUser("batch-replacement");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const round = 2;
    const oldOne = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "old-one", {
      slot_key: "shot-a",
      file_name: "shot-a__old-one.jpg",
      assignment_sync_batch_id: "batch-old",
    });
    const oldTwo = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "old-two", {
      slot_key: "shot-a",
      file_name: "shot-a__old-two.jpg",
      assignment_sync_batch_id: "batch-old",
    });
    const sameBatch = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "new-one", {
      slot_key: "shot-a",
      file_name: "shot-a__new-one.jpg",
      assignment_sync_batch_id: "batch-new",
    });
    const otherSlot = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "other", {
      slot_key: "shot-b",
      file_name: "shot-b__keep.jpg",
      assignment_sync_batch_id: "batch-old",
    });

    const removed = removeAssignmentWorkReplacementLinksBeforeInsertForTest(ctx.db)({
      assignmentId: assignment.id,
      assignmentRound: round,
      contentItemId: item.id,
      fileName: "shot-a__new-two.jpg",
      mediaType: "image",
      assignmentSyncBatchId: "batch-new",
    });

    assert.equal(removed, 2);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(oldOne.asset_id).c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(oldTwo.asset_id).c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(sameBatch.asset_id).c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(otherSlot.asset_id).c || 0), 1);
  } finally {
    ctx.cleanup();
  }
});
test("removeAssignmentWorkReplacementLinksBeforeInsert replaces only the active link for the same slot and media type", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Replacement Slot Place");
    const assignee = ctx.createUser("replacement-slot");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const round = 2;
    const oldImage = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "old-image", {
      slot_key: "shot-a",
      file_name: "shot-a__old.jpg",
      mime_type: "image/jpeg",
      assignment_media_type: "image",
    });
    const oldVideo = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "old-video", {
      slot_key: "shot-a",
      file_name: "shot-a__old.mp4",
      mime_type: "video/mp4",
      assignment_media_type: "video",
    });
    const otherSlot = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "other-slot", {
      slot_key: "shot-b",
      file_name: "shot-b__keep.jpg",
      mime_type: "image/jpeg",
      assignment_media_type: "image",
    });

    const removed = removeAssignmentWorkReplacementLinksBeforeInsertForTest(ctx.db)({
      assignmentId: assignment.id,
      assignmentRound: round,
      contentItemId: item.id,
      fileName: "shot-a__new.jpg",
      mediaType: "image",
    });
    assert.equal(removed, 1);

    const newImage = ctx.createAssignmentWorkAsset(item.id, assignment.id, round, "new-image", {
      slot_key: "shot-a",
      file_name: "shot-a__new.jpg",
      mime_type: "image/jpeg",
      assignment_media_type: "image",
    });

    const rows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: round });
    const imageRows = rows.filter((row) => String(row.file_name || "") === "shot-a__new.jpg");
    const videoRows = rows.filter((row) => String(row.file_name || "") === "shot-a__old.mp4");
    const otherRows = rows.filter((row) => String(row.file_name || "") === "shot-b__keep.jpg");

    assert.equal(imageRows.length, 1);
    assert.equal(Number(imageRows[0].asset_id || 0), newImage.asset_id);
    assert.equal(videoRows.length, 1);
    assert.equal(Number(videoRows[0].asset_id || 0), oldVideo.asset_id);
    assert.equal(otherRows.length, 1);
    assert.equal(Number(otherRows[0].asset_id || 0), otherSlot.asset_id);
  } finally {
    ctx.cleanup();
  }
});

test("removeAssignmentWorkReplacementLinksBeforeInsert does not cross revision rounds", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Revision Round Place");
    const assignee = ctx.createUser("replacement-round");
    const assignment = ctx.createAssignment(item.id, assignee.id);
    const roundOne = ctx.createAssignmentWorkAsset(item.id, assignment.id, 1, "round-one", {
      slot_key: "shot-c",
      file_name: "shot-c__round-one.jpg",
      mime_type: "image/jpeg",
      assignment_media_type: "image",
    });

    const removed = removeAssignmentWorkReplacementLinksBeforeInsertForTest(ctx.db)({
      assignmentId: assignment.id,
      assignmentRound: 2,
      contentItemId: item.id,
      fileName: "shot-c__round-two.jpg",
      mediaType: "image",
    });
    assert.equal(removed, 0);

    const roundTwo = ctx.createAssignmentWorkAsset(item.id, assignment.id, 2, "round-two", {
      slot_key: "shot-c",
      file_name: "shot-c__round-two.jpg",
      mime_type: "image/jpeg",
      assignment_media_type: "image",
    });

    const roundOneRows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: 1 });
    const roundTwoRows = listDraftAssignmentWorkAssetRowsForTest(ctx.db)({ assignmentId: assignment.id, assignmentRound: 2 });

    assert.equal(roundOneRows.length, 1);
    assert.equal(Number(roundOneRows[0].asset_id || 0), roundOne.asset_id);
    assert.equal(roundTwoRows.length, 1);
    assert.equal(Number(roundTwoRows[0].asset_id || 0), roundTwo.asset_id);
  } finally {
    ctx.cleanup();
  }
});