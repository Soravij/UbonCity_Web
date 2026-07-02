import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAssignmentSubmissionPayload } from "../server/endpoint-schema-mapping.mjs";
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

function extractRouteBody(source, routeMarker, nextMarker) {
  const start = source.indexOf(routeMarker);
  assert.notEqual(start, -1, `route ${routeMarker} should exist`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `next marker ${nextMarker} should exist after ${routeMarker}`);
  const routeSource = source.slice(start, end);
  const bodyStart = routeSource.indexOf("{", routeSource.indexOf("=>"));
  const bodyEnd = routeSource.lastIndexOf("});");
  assert.notEqual(bodyStart, -1, "route should have a body");
  assert.notEqual(bodyEnd, -1, "route should end with });");
  return routeSource.slice(bodyStart + 1, bodyEnd).trim();
}

const submitRouteBody = extractRouteBody(
  serverIndexJs,
  'app.post("/api/assignments/:id/submissions"',
  'app.get("/api/assignments/:id/submissions"'
);

const submitHandlerFactory = new Function(
  "deps",
  `const {
    repo,
    actorEmail,
    actorPolicyRole,
    hasAssignmentSubmissionAccess,
    resolveAssignmentCurrentRound,
    cleanupExpiredAssignmentWorkDraftAssets,
    cleanupSupersededAssignmentWorkAssetsAfterSubmit,
    normalizeAssignmentDraftArticlePayload,
    enforceAssignmentSubmissionRequiredFields,
    enforceResetPerShotRequirements,
    evaluateAssignmentCaptureTopicReadiness,
    resolveAssignmentSubmissionValidationMediaPayload,
    buildSubmissionErrorResponse,
    buildAssignmentSubmissionPayload,
    normalizeEnum,
  } = deps;
  const ASSIGNMENT_SUBMISSION_STATES = new Set(["submitted", "resubmitted"]);
  const ASSIGNMENT_REASON_CODE_DEFAULTS = Object.freeze({ submit: "assignment_submit", resubmit: "assignment_resubmit" });
  const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
  return function submitHandler(req, res) {
${submitRouteBody}
  };
`
);

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
    fieldPack: repo.getCurrentFieldPackByItem(Number(assignment?.content_item_id || 0) || 0) || null,
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

const resolveAssignmentSubmissionValidationMediaPayloadForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentMediaPayloadAssets")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentSubmissionValidationMediaPayload")}
return resolveAssignmentSubmissionValidationMediaPayload;`
)();

const buildSubmissionErrorResponseForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "buildSubmissionErrorResponse")}
return buildSubmissionErrorResponse;`
)();

const buildAssignmentCaptureSlotKeyForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
return buildAssignmentCaptureSlotKey;`
)();

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-submit-route-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title = "Submit Route Item") {
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

  function createUser(handle = "submit-user") {
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, role, display_name)
      VALUES (?, 'hash', 'user', ?)
    `).run(`${handle}-${Date.now()}@example.com`, handle);
    return { id: Number(result.lastInsertRowid || 0) || 0 };
  }

  function createAssignment(title = "Submit Route Assignment") {
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
    repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      field_pack_checklists: [
        { checklist_type: "must_capture", item_text: "Storefront hero", capture_type: "photo", item_order: 0 },
        { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 1 },
      ],
    });
    const assignment = repo.createAssignmentFromReadiness(
      item.id,
      { assignee_user_id: assignee.id, force_override: true, force_reason: "test" },
      assignee.id,
      "tester@local",
      "admin"
    ).assignment;
    return { item, assignee, assignment };
  }

  function currentHandoffSnapshotId(assignmentId) {
    return Number(repo.getLatestAssignmentHandoffByAssignment(assignmentId)?.id || 0) || 0;
  }

  function insertWorkingAsset(itemId, options = {}) {
    const assignmentId = Number(options.assignmentId || 0) || 0;
    const assignmentRound = Number(options.assignmentRound || 1) || 1;
    const slotKey = String(options.slotKey || "shot-1-storefront-hero").trim().toLowerCase();
    const mediaType = String(options.assignmentMediaType || "image").trim().toLowerCase();
    const syncBatchId = String(options.syncBatchId || `batch-${Date.now()}`).trim();
    const relativePath = `uploads/${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}.${mediaType === "video" ? "mp4" : "jpg"}`;
    const assetRes = db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, created_at)
      VALUES (?, 'local', ?, ?, ?, ?, ?, ?)
    `).run(
      `asset-${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}`,
      relativePath,
      path.basename(relativePath),
      mediaType === "video" ? "video/mp4" : "image/jpeg",
      1234,
      `checksum-${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}`,
      new Date().toISOString()
    );
    const assetId = Number(assetRes.lastInsertRowid || 0) || 0;
    db.prepare(`
      INSERT INTO content_assets (
        content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order,
        assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id
      ) VALUES (?, ?, 'unused', 0, 0, 'unused', 0, ?, ?, ?, ?, 'assignment_work', ?)
    `).run(itemId, assetId, assignmentId, assignmentRound, mediaType, slotKey, syncBatchId);
    return assetId;
  }

  const evaluateAssignmentCaptureTopicReadiness = evaluateAssignmentCaptureTopicReadinessForTest(repo);
  const submitHandler = submitHandlerFactory({
    repo,
    actorEmail: () => "tester@local",
    actorPolicyRole: () => "user",
    hasAssignmentSubmissionAccess: () => true,
    resolveAssignmentCurrentRound: () => 1,
    cleanupExpiredAssignmentWorkDraftAssets: () => ({ removed_links: 0, removed_assets: 0, deleted_files: [] }),
    cleanupSupersededAssignmentWorkAssetsAfterSubmit: () => ({ removed_links: 0, removed_assets: 0, deleted_files: [] }),
    normalizeAssignmentDraftArticlePayload: (payload = null) => payload && typeof payload === "object" ? payload : { additional_text: "ready" },
    enforceAssignmentSubmissionRequiredFields: () => {},
    enforceResetPerShotRequirements: () => {},
    evaluateAssignmentCaptureTopicReadiness,
    resolveAssignmentSubmissionValidationMediaPayload: resolveAssignmentSubmissionValidationMediaPayloadForTest,
    buildSubmissionErrorResponse: buildSubmissionErrorResponseForTest,
    buildAssignmentSubmissionPayload,
    normalizeEnum: (value, allowed) => { const normalized = String(value || "").trim().toLowerCase(); return normalized && allowed.has(normalized) ? normalized : ""; },
  });

  return { db, repo, cleanup, createAssignment, currentHandoffSnapshotId, insertWorkingAsset, submitHandler };
}

test("submit route blocks forged payload when DB resolver finds no eligible current-round assets", () => {
  const ctx = createContext();
  try {
    const { assignment, assignee } = ctx.createAssignment("Forged Submit Route");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const beforeCount = ctx.repo.listAssignmentSubmissions(assignment.id).length;
    const req = {
      params: { id: String(assignment.id) },
      authUser: { id: assignee.id },
      body: {
        action: "submit",
        source_handoff_snapshot_id: ctx.currentHandoffSnapshotId(assignment.id),
        article_payload_json: { additional_text: "ready" },
        media_payload_json: {
          assets: [
            { id: 99901, slotKey: storefront, mediaType: "image" },
            { id: 99902, slotKey: walkthrough, mediaType: "video" },
          ],
        },
      },
    };
    const res = createResponseRecorder();

    ctx.submitHandler(req, res);
    console.error("submit forged payload response", { statusCode: res.statusCode, body: res.payload });

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.error, "assignment_capture_requirements_incomplete");
    assert.equal(ctx.repo.listAssignmentSubmissions(assignment.id).length, beforeCount);
    assert.equal(String(ctx.repo.getAssignmentById(assignment.id)?.state || ""), String(assignment.state || ""));
  } finally {
    ctx.cleanup();
  }
});

test("submit route succeeds with real DB assets and clears reset policy without ReferenceError", () => {
  const ctx = createContext();
  try {
    const { item, assignment, assignee } = ctx.createAssignment("Successful Submit Route");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const photoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "image",
      slotKey: storefront,
      syncBatchId: "submit-photo",
    });
    const videoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "video",
      slotKey: walkthrough,
      syncBatchId: "submit-video",
    });
    ctx.repo.updateAssignmentMediaResetPolicy(assignment.id, {
      image_reset_required: true,
      image_reset_reason: "replace photo",
      video_reset_required: true,
      video_reset_reason: "replace video",
    });
    const beforeCount = ctx.repo.listAssignmentSubmissions(assignment.id).length;
    const req = {
      params: { id: String(assignment.id) },
      authUser: { id: assignee.id },
      body: {
        action: "submit",
        source_handoff_snapshot_id: ctx.currentHandoffSnapshotId(assignment.id),
        article_payload_json: { additional_text: "ready" },
        media_payload_json: { assets: [{ id: photoId }, { id: videoId }] },
      },
    };
    const res = createResponseRecorder();

    assert.doesNotThrow(() => ctx.submitHandler(req, res));
    console.error("submit valid assets response", { statusCode: res.statusCode, body: res.payload });
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload?.ok, true);
    assert.equal(ctx.repo.listAssignmentSubmissions(assignment.id).length, beforeCount + 1);
    assert.equal(String(ctx.repo.getAssignmentById(assignment.id)?.state || ""), "submitted");
    const updatedAssignment = ctx.repo.getAssignmentById(assignment.id);
    assert.equal(Number(updatedAssignment?.image_reset_required || 0), 0);
    assert.equal(Number(updatedAssignment?.video_reset_required || 0), 0);
  } finally {
    ctx.cleanup();
  }
});

