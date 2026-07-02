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
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") paramsDepth += 1;
    if (char === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
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

const buildAssignmentCaptureSlotKeyForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
return buildAssignmentCaptureSlotKey;`
)();

const resolveCurrentRoundEligibleAssignmentMediaAssetsForTest = new Function(
  "repo",
  `const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "parseIsoMs")}
${extractNamedFunctionSource(serverIndexJs, "resolveSelectedAssignmentMediaAssetIds")}
${extractNamedFunctionSource(serverIndexJs, "resolveCurrentRoundEligibleAssignmentMediaAssets")}
return resolveCurrentRoundEligibleAssignmentMediaAssets;`
);

const evaluateAssignmentCaptureTopicReadinessForTest = new Function(
  "repo",
  `const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
function resolveAssignmentSubmissionPromptContext(assignment = null) {
  return {
    brief: assignment?.brief_json || null,
    fieldPack: assignment?.fieldPack || null,
  };
}
${extractNamedFunctionSource(serverIndexJs, "uniqueAssignmentPromptStrings")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(serverIndexJs, "getStructuredFieldPackCaptureItems")}
${extractNamedFunctionSource(serverIndexJs, "parseIsoMs")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentCaptureAssetSlotTypeKey")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "resolveSelectedAssignmentMediaAssetIds")}
${extractNamedFunctionSource(serverIndexJs, "resolveCurrentRoundEligibleAssignmentMediaAssets")}
${extractNamedFunctionSource(serverIndexJs, "evaluateAssignmentCaptureTopicReadinessFromAssets")}
${extractNamedFunctionSource(serverIndexJs, "evaluateAssignmentCaptureTopicReadiness")}
return evaluateAssignmentCaptureTopicReadiness;`
);

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-assignment-resolver-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title = "Resolver Item") {
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

  function createUser(handle = "resolver-user") {
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, role, display_name)
      VALUES (?, 'hash', 'user', ?)
    `).run(`${handle}-${Date.now()}@example.com`, handle);
    return { id: Number(result.lastInsertRowid || 0) || 0 };
  }

  function createAssignment(title = "Resolver Assignment") {
    const item = createItem(title);
    const assignee = createUser(title.toLowerCase().replace(/\s+/g, "-"));
    db.prepare(`
      INSERT INTO content_readiness_briefs (
        content_item_id, readiness_json, brief_json, reasons_json, blockers_json, missing_requirements_json, computed_by
      ) VALUES (?, ?, ?, '[]', '[]', '[]', 'tester@local')
    `).run(
      item.id,
      JSON.stringify({ ready_for_content: true, ready_for_publish: false, blockers: [], missing_requirements: [] }),
      JSON.stringify({ brief_summary: "ready" })
    );
    const assignment = repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    return { item, assignee, assignment };
  }

  function insertAsset(itemId, options = {}) {
    const assignmentId = Number(options.assignmentId || 0) || 0;
    const assignmentRound = Number(options.assignmentRound || 1) || 1;
    const slotKey = String(options.slotKey || "shot-1-storefront-hero").trim().toLowerCase();
    const mediaType = String(options.assignmentMediaType || options.mediaType || "image").trim().toLowerCase();
    const assignmentSurface = String(options.assignmentSurface || "assignment_work").trim();
    const syncBatchId = String(options.syncBatchId || `batch-${Date.now()}`).trim();
    const storagePath = String(options.storagePath || `uploads/${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}.${mediaType === "video" ? "mp4" : "jpg"}`);
    const fileName = String(options.fileName || path.basename(storagePath)).trim();
    const mimeType = String(options.mimeType || (mediaType === "video" ? "video/mp4" : "image/jpeg")).trim();
    const createdAt = String(options.createdAt || new Date().toISOString());
    const assetRes = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `asset-${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}`,
      String(options.storageDisk || "local"),
      storagePath,
      fileName,
      mimeType,
      Number(options.sizeBytes || 1234) || 1234,
      `checksum-${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}`,
      createdAt
    );
    const assetId = Number(assetRes.lastInsertRowid || 0) || 0;
    db.prepare(`
      INSERT INTO content_assets (
        content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order,
        assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id
      ) VALUES (?, ?, 'unused', 0, 0, 'unused', 0, ?, ?, ?, ?, ?, ?)
    `).run(itemId, assetId, assignmentId || null, assignmentRound, mediaType, slotKey, assignmentSurface, syncBatchId);
    return assetId;
  }

  return { db, repo, cleanup, createAssignment, insertAsset };
}

test("authoritative current-round resolver rejects invalid, expired, mismatched, and superseded assets", () => {
  const ctx = createContext();
  try {
    const primary = ctx.createAssignment("Primary Resolver");
    const secondary = ctx.createAssignment("Secondary Resolver");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const mimeMismatchSlot = buildAssignmentCaptureSlotKeyForTest("Mismatch clip", 2, "video", "video");
    const run = resolveCurrentRoundEligibleAssignmentMediaAssetsForTest(ctx.repo);

    const validPhotoId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 2,
      slotKey: storefront,
      assignmentMediaType: "image",
      mimeType: "image/jpeg",
      syncBatchId: "valid-photo",
    });
    const validVideoId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 2,
      slotKey: walkthrough,
      assignmentMediaType: "video",
      mimeType: "video/mp4",
      syncBatchId: "valid-video",
    });
    const otherAssignmentId = ctx.insertAsset(secondary.item.id, {
      assignmentId: secondary.assignment.id,
      assignmentRound: 2,
      slotKey: storefront,
      assignmentMediaType: "image",
      mimeType: "image/jpeg",
      syncBatchId: "other-assignment",
    });
    const oldRoundId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 1,
      slotKey: storefront,
      assignmentMediaType: "image",
      mimeType: "image/jpeg",
      syncBatchId: "old-round",
    });
    const wrongSurfaceId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 2,
      slotKey: storefront,
      assignmentMediaType: "image",
      assignmentSurface: "article_workspace",
      mimeType: "image/jpeg",
      syncBatchId: "wrong-surface",
    });
    const expiredId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 2,
      slotKey: storefront,
      assignmentMediaType: "image",
      mimeType: "image/jpeg",
      createdAt: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
      syncBatchId: "expired",
    });
    const mimeMismatchId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 2,
      slotKey: mimeMismatchSlot,
      assignmentMediaType: "video",
      mimeType: "image/jpeg",
      syncBatchId: "mime-mismatch",
    });
    const supersededOldId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 2,
      slotKey: storefront,
      assignmentMediaType: "image",
      mimeType: "image/jpeg",
      syncBatchId: "superseded-old",
    });
    const supersededNewId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 2,
      slotKey: storefront,
      assignmentMediaType: "image",
      mimeType: "image/jpeg",
      syncBatchId: "superseded-new",
    });

    const result = run(primary.assignment, primary.assignment.id, 2, {
      assets: [
        { id: 999999 },
        { id: otherAssignmentId },
        { id: oldRoundId },
        { id: wrongSurfaceId },
        { id: expiredId },
        { id: mimeMismatchId },
        { id: supersededOldId },
        { id: validVideoId },
        { id: supersededNewId },
      ],
    });

    assert.deepEqual(result.assets.map((asset) => Number(asset.id || 0)).sort((a, b) => a - b), [supersededNewId, validVideoId].sort((a, b) => a - b));
    assert.deepEqual(
      result.invalid_selections.map((entry) => ({ asset_id: entry.asset_id, code: entry.code })).sort((a, b) => a.asset_id - b.asset_id),
      [
        { asset_id: 999999, code: "asset_not_found" },
        { asset_id: otherAssignmentId, code: "asset_not_found" },
        { asset_id: oldRoundId, code: "round_mismatch" },
        { asset_id: wrongSurfaceId, code: "asset_not_found" },
        { asset_id: expiredId, code: "asset_expired" },
        { asset_id: mimeMismatchId, code: "mime_type_mismatch" },
        { asset_id: supersededOldId, code: "asset_superseded" },
      ].sort((a, b) => a.asset_id - b.asset_id)
    );
    assert.equal(result.authoritative, true);
    assert.deepEqual(result.selected_asset_ids.length, 9);
    assert.ok(validPhotoId > 0);
  } finally {
    ctx.cleanup();
  }
});

test("authoritative current-round resolver plus readiness accepts complete persisted topic set only", () => {
  const ctx = createContext();
  try {
    const primary = ctx.createAssignment("Complete Resolver");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const photoId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 3,
      slotKey: storefront,
      assignmentMediaType: "image",
      mimeType: "image/jpeg",
      syncBatchId: "photo-complete",
    });
    const videoId = ctx.insertAsset(primary.item.id, {
      assignmentId: primary.assignment.id,
      assignmentRound: 3,
      slotKey: walkthrough,
      assignmentMediaType: "video",
      mimeType: "video/mp4",
      syncBatchId: "video-complete",
    });
    const evaluate = evaluateAssignmentCaptureTopicReadinessForTest(ctx.repo);
    const assignment = {
      ...primary.assignment,
      assignment_kind: "field",
      fieldPack: {
        checklists: [
          { checklist_type: "must_capture", item_text: "Storefront hero", capture_type: "photo", item_order: 0 },
          { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 1 },
        ],
      },
    };

    const result = evaluate(assignment, primary.assignment.id, 3, {
      assets: [
        { id: photoId, slotKey: storefront, mediaType: "image" },
        { id: videoId, slotKey: walkthrough, mediaType: "video" },
      ],
    });

    assert.equal(result.can_submit, true);
    assert.equal(result.counts.required_topics, 2);
    assert.equal(result.counts.fulfilled_topics, 2);
    assert.equal(result.counts.missing_topics, 0);
    assert.deepEqual(result.invalid_selections, []);
    assert.deepEqual(result.missing_requirements, []);
  } finally {
    ctx.cleanup();
  }
});
