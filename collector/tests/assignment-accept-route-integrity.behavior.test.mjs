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

const patchStateRouteBody = extractRouteBody(
  serverIndexJs,
  'app.patch("/api/assignments/:id/state"',
  'app.post("/api/assignments/:id/submissions"'
);

const buildAssignmentCaptureSlotKeyForTest = new Function(
  `${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "buildAssignmentCaptureSlotKey")}
return buildAssignmentCaptureSlotKey;`
)();

const evaluateLatestAssignmentSubmissionCaptureTopicReadinessFactory = new Function(
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
${extractNamedFunctionSource(serverIndexJs, "evaluateLatestAssignmentSubmissionCaptureTopicReadiness")}
return evaluateLatestAssignmentSubmissionCaptureTopicReadiness;`
);

const patchStateHandlerFactory = new Function(
  "deps",
  `const {
    repo,
    actorEmail,
    actorPolicyRole,
    normalizeEnum,
    resolveRevisionMediaResetPayload,
    evaluateLatestAssignmentSubmissionCaptureTopicReadiness,
    resolveAssignmentCurrentRound,
    clearExternalUsableMediaAtHandoff,
    fs,
    resolveStoragePath,
  } = deps;
  const ASSIGNMENT_STATES = new Set(["assigned", "in_progress", "submitted", "revision_requested", "resubmitted", "accepted", "closed"]);
  const ASSIGNMENT_ACTION_TO_STATE = Object.freeze({
    start_progress: "in_progress",
    request_revision: "revision_requested",
    accept_submission: "accepted",
    close_assignment: "closed",
  });
  const ASSIGNMENT_REASON_CODE_DEFAULTS = Object.freeze({
    start_progress: "assignment_start_progress",
    request_revision: "assignment_revision_requested",
    accept_submission: "assignment_submission_accepted",
    close_assignment: "assignment_closed",
  });
  const ASSIGNMENT_STATE_AUDIT_ACTIONS = Object.freeze({
    start_progress: "assignment.state.start_progress",
    request_revision: "assignment.state.request_revision",
    accept_submission: "assignment.state.accept_submission",
    close_assignment: "assignment.state.close_assignment",
  });
  return async function patchStateHandler(req, res) {
${patchStateRouteBody}
  };
`
);

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

function createContext(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-accept-route-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), schemaPath);
  const repo = createRepository(db);
  const updateCalls = [];

  function cleanup() {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem(title = "Accept Route Item") {
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

  function createUser(handle = "accept-user") {
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, role, display_name)
      VALUES (?, 'hash', 'user', ?)
    `).run(`${handle}-${Date.now()}@example.com`, handle);
    return { id: Number(result.lastInsertRowid || 0) || 0 };
  }

  function createAssignment(title = "Accept Route Assignment") {
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

  function createSubmission(assignment, assignee, mediaAssetIds = []) {
    return repo.addAssignmentSubmission(buildAssignmentSubmissionPayload({
      assignmentId: assignment.id,
      sourceHandoffSnapshotId: currentHandoffSnapshotId(assignment.id),
      submittedByUserId: assignee.id,
      submissionState: "submitted",
      articlePayloadJson: { additional_text: "ready" },
      mediaPayloadJson: { assets: mediaAssetIds.map((id) => ({ id })) },
    }));
  }

  function attachDeliverable(assignment, submission, type, assetId) {
    return repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignment.id,
      submission_id: submission.id,
      deliverable_type: type,
      source_asset_id: assetId,
      status: "submitted",
    }, "tester@local");
  }

  const evaluateLatestAssignmentSubmissionCaptureTopicReadiness = evaluateLatestAssignmentSubmissionCaptureTopicReadinessFactory(repo);
  const repoProxy = {
    ...repo,
    updateAssignmentState(...args) {
      updateCalls.push(args);
      if (typeof options.updateAssignmentState === "function") {
        return options.updateAssignmentState(...args);
      }
      throw new Error("accept validation reached");
    },
    logAudit() {},
    ensureWorkflowModel() {
      return { production_state: "ready_for_content", publication_state: "draft" };
    },
    upsertWorkflowModel() {
      return null;
    },
  };
  const patchStateHandler = patchStateHandlerFactory({
    repo: repoProxy,
    actorEmail: () => "reviewer@local",
    actorPolicyRole: () => "admin",
    normalizeEnum: (value, allowed) => {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized && allowed.has(normalized) ? normalized : "";
    },
    resolveRevisionMediaResetPayload: () => ({ image_reset_required: false, video_reset_required: false }),
    evaluateLatestAssignmentSubmissionCaptureTopicReadiness,
    resolveAssignmentCurrentRound: () => 1,
    clearExternalUsableMediaAtHandoff: () => {},
    fs: { unlink: async () => {} },
    resolveStoragePath: (value) => value,
  });

  return {
    db,
    repo,
    cleanup,
    createAssignment,
    insertWorkingAsset,
    createSubmission,
    attachDeliverable,
    patchStateHandler,
    updateCalls,
  };
}

test("accept route blocks when latest submission payload looks complete but latest deliverables are missing", async () => {
  const ctx = createContext();
  try {
    const { item, assignment, assignee } = ctx.createAssignment("Accept Latest Payload Missing Deliverables");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const photoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "image",
      slotKey: storefront,
      syncBatchId: "accept-missing-photo",
    });
    const videoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "video",
      slotKey: walkthrough,
      syncBatchId: "accept-missing-video",
    });
    ctx.createSubmission(assignment, assignee, [photoId, videoId]);
    const req = { params: { id: String(assignment.id) }, body: { action: "accept_submission" } };
    const res = createResponseRecorder();

    await ctx.patchStateHandler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.error, "assignment_capture_requirements_incomplete");
    assert.equal(ctx.updateCalls.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test("accept route blocks when an older submission is complete but the latest submission is missing deliverables", async () => {
  const ctx = createContext();
  try {
    const { item, assignment, assignee } = ctx.createAssignment("Accept Old Complete Latest Missing");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const photoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "image",
      slotKey: storefront,
      syncBatchId: "accept-old-photo",
    });
    const videoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "video",
      slotKey: walkthrough,
      syncBatchId: "accept-old-video",
    });
    const oldSubmission = ctx.createSubmission(assignment, assignee, [photoId, videoId]);
    ctx.attachDeliverable(assignment, oldSubmission, "photos", photoId);
    ctx.attachDeliverable(assignment, oldSubmission, "videos", videoId);
    ctx.createSubmission(assignment, assignee, [photoId, videoId]);
    const req = { params: { id: String(assignment.id) }, body: { action: "accept_submission" } };
    const res = createResponseRecorder();

    await ctx.patchStateHandler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.error, "assignment_capture_requirements_incomplete");
    assert.equal(ctx.updateCalls.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test("accept route reaches downstream accept validation when latest deliverables and source assets are current-round valid", async () => {
  const ctx = createContext();
  try {
    const { item, assignment, assignee } = ctx.createAssignment("Accept Latest Deliverables Valid");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const photoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "image",
      slotKey: storefront,
      syncBatchId: "accept-valid-photo",
    });
    const videoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "video",
      slotKey: walkthrough,
      syncBatchId: "accept-valid-video",
    });
    const latestSubmission = ctx.createSubmission(assignment, assignee, [photoId, videoId]);
    ctx.attachDeliverable(assignment, latestSubmission, "photos", photoId);
    ctx.attachDeliverable(assignment, latestSubmission, "videos", videoId);
    const req = { params: { id: String(assignment.id) }, body: { action: "accept_submission" } };
    const res = createResponseRecorder();

    await ctx.patchStateHandler(req, res);

    assert.equal(ctx.updateCalls.length, 1);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload?.error, "accept validation reached");
    assert.notEqual(res.payload?.error, "assignment_capture_requirements_incomplete");
  } finally {
    ctx.cleanup();
  }
});
