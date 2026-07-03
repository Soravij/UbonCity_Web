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
function resolveAssignmentFieldPackFromBrief(assignment = null) {
  const brief = assignment?.brief_json && typeof assignment.brief_json === "object" ? assignment.brief_json : null;
  if (!brief) return null;
  const sourceFieldPackId = Number(brief?.source?.field_pack_id || brief?.source_field_pack_id || 0) || 0;
  if (sourceFieldPackId > 0 && typeof repo?.getFieldPackBundleById === "function") {
    const sourceFieldPack = repo.getFieldPackBundleById(sourceFieldPackId);
    if (sourceFieldPack && typeof sourceFieldPack === "object" && !Array.isArray(sourceFieldPack)) return sourceFieldPack;
  }
  const candidates = [brief.field_pack, brief.fieldPack, brief.current_field_pack, brief.currentFieldPack, brief.context_field_pack, brief.contextFieldPack];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return null;
}
function resolveAssignmentSubmissionPromptContext(assignment = null) {
  const contentItemId = Number(assignment?.content_item_id || 0) || 0;
  const currentFieldPack = contentItemId ? repo.getCurrentFieldPackByItem(contentItemId) : null;
  const embeddedFieldPack = resolveAssignmentFieldPackFromBrief(assignment);
  return {
    brief: assignment?.brief_json || null,
    fieldPack: embeddedFieldPack || currentFieldPack || null,
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

function extractSubmissionSelectedAssetIds(submissionRow) {
  const raw = submissionRow?.media_payload_json ?? submissionRow?.submission_payload_json ?? null;
  const payload = typeof raw === "string"
    ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
    : raw;
  const assets = Array.isArray(payload?.assets) ? payload.assets : [];
  return assets.map((row) => Number(row?.id || 0) || 0).filter((value) => value > 0);
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


test("submit route resubmit uses immutable handoff snapshot instead of later current field pack", () => {
  const ctx = createContext();
  try {
    const { item, assignment, assignee } = ctx.createAssignment("Submit Snapshot Source Of Truth");
    const currentBrief = ctx.repo.getAssignmentById(assignment.id)?.brief_json || {};
    ctx.db.prepare("UPDATE content_assignments SET brief_json=? WHERE id=?").run(
      JSON.stringify({
        ...currentBrief,
        brief_summary: "snapshot ready",
        field_pack: {
          checklists: [
            { checklist_type: "must_capture", item_text: "Storefront hero", capture_type: "photo", item_order: 0 },
            { checklist_type: "must_capture", item_text: "Walkthrough clip", capture_type: "video", item_order: 1 },
          ],
        },
      }),
      assignment.id
    );
    ctx.repo.createFieldPack({
      content_item_id: item.id,
      status: "ready_for_field",
      field_pack_checklists: [
        { checklist_type: "must_capture", item_text: "Current storefront hero", capture_type: "photo", item_order: 0 },
        { checklist_type: "must_capture", item_text: "Current walkthrough clip", capture_type: "video", item_order: 1 },
      ],
    });
    ctx.db.prepare("UPDATE content_assignments SET state=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run("revision_requested", assignment.id);
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const photoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "image",
      slotKey: storefront,
      syncBatchId: "snapshot-photo",
    });
    const videoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "video",
      slotKey: walkthrough,
      syncBatchId: "snapshot-video",
    });
    const beforeCount = ctx.repo.listAssignmentSubmissions(assignment.id).length;
    const req = {
      params: { id: String(assignment.id) },
      authUser: { id: assignee.id },
      body: {
        action: "resubmit",
        source_handoff_snapshot_id: ctx.currentHandoffSnapshotId(assignment.id),
        article_payload_json: { additional_text: "ready" },
        media_payload_json: { assets: [{ id: photoId }, { id: videoId }] },
      },
    };
    const res = createResponseRecorder();

    ctx.submitHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload?.ok, true);
    assert.equal(ctx.repo.listAssignmentSubmissions(assignment.id).length, beforeCount + 1);
    assert.equal(String(ctx.repo.getAssignmentById(assignment.id)?.state || ""), "resubmitted");
  } finally {
    ctx.cleanup();
  }
});

test("submit route accepts multiple current-round files in one slot and blocks previous-round assets", () => {
  const ctx = createContext();
  try {
    const { item, assignment, assignee } = ctx.createAssignment("Submit Multi File Slot");
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const imageIds = [
      ctx.insertWorkingAsset(item.id, { assignmentId: assignment.id, assignmentRound: 1, assignmentMediaType: "image", slotKey: storefront, syncBatchId: "slot-a-1" }),
      ctx.insertWorkingAsset(item.id, { assignmentId: assignment.id, assignmentRound: 1, assignmentMediaType: "image", slotKey: storefront, syncBatchId: "slot-a-2" }),
      ctx.insertWorkingAsset(item.id, { assignmentId: assignment.id, assignmentRound: 1, assignmentMediaType: "image", slotKey: storefront, syncBatchId: "slot-a-3" }),
    ];
    const walkthroughId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "video",
      slotKey: walkthrough,
      syncBatchId: "slot-b-1",
    });
    const currentRoundResolver = resolveCurrentRoundEligibleAssignmentMediaAssetsForTest(ctx.repo);
    const resolved = currentRoundResolver(assignment, assignment.id, 1, {
      assets: [...imageIds, walkthroughId].map((id) => ({ id })),
    });
    const readiness = evaluateAssignmentCaptureTopicReadinessForTest(ctx.repo)(assignment, assignment.id, 1, {
      assets: [...imageIds, walkthroughId].map((id) => ({ id })),
    });
    assert.equal(Array.isArray(resolved.invalid_selections) ? resolved.invalid_selections.length : -1, 0);
    assert.equal(readiness.counts?.required_topics, 2);
    assert.equal(readiness.counts?.fulfilled_topics, 2);
    assert.equal(readiness.counts?.missing_topics, 0);
    assert.equal(resolved.assets.filter((asset) => asset.assignment_slot_key === storefront && asset.assignment_media_type === "image").length, 3);
    assert.equal(resolved.assets.filter((asset) => asset.assignment_slot_key === walkthrough && asset.assignment_media_type === "video").length, 1);
    const beforeCount = ctx.repo.listAssignmentSubmissions(assignment.id).length;
    const req = {
      params: { id: String(assignment.id) },
      authUser: { id: assignee.id },
      body: {
        action: "submit",
        source_handoff_snapshot_id: ctx.currentHandoffSnapshotId(assignment.id),
        article_payload_json: { additional_text: "ready" },
        media_payload_json: { assets: [...imageIds, walkthroughId].map((id) => ({ id })) },
      },
    };
    const res = createResponseRecorder();

    ctx.submitHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload?.ok, true);
    assert.equal(ctx.repo.listAssignmentSubmissions(assignment.id).length, beforeCount + 1);
    const savedSubmissionId = Number(ctx.repo.getAssignmentById(assignment.id)?.latest_submission_id || 0) || 0;
    const savedSubmission = savedSubmissionId ? ctx.repo.getAssignmentSubmissionById(savedSubmissionId) : null;
    const selectedIds = extractSubmissionSelectedAssetIds(savedSubmission).sort((a, b) => a - b);
    assert.deepEqual(selectedIds, [...imageIds, walkthroughId].sort((a, b) => a - b));

    ctx.db.prepare("UPDATE content_assignments SET state=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run("revision_requested", assignment.id);
    const resubmitBeforeCount = ctx.repo.listAssignmentSubmissions(assignment.id).length;
    const resubmitReq = {
      params: { id: String(assignment.id) },
      authUser: { id: assignee.id },
      body: {
        action: "resubmit",
        source_handoff_snapshot_id: ctx.currentHandoffSnapshotId(assignment.id),
        article_payload_json: { additional_text: "ready" },
        media_payload_json: { assets: [...imageIds, walkthroughId].map((id) => ({ id })) },
      },
    };
    const resubmitRes = createResponseRecorder();

    ctx.submitHandler(resubmitReq, resubmitRes);

    assert.equal(resubmitRes.statusCode, 201);
    assert.equal(resubmitRes.payload?.ok, true);
    assert.equal(ctx.repo.listAssignmentSubmissions(assignment.id).length, resubmitBeforeCount + 1);
    const resubmittedSubmissionId = Number(ctx.repo.getAssignmentById(assignment.id)?.latest_submission_id || 0) || 0;
    const resubmittedSubmission = resubmittedSubmissionId ? ctx.repo.getAssignmentSubmissionById(resubmittedSubmissionId) : null;
    const resubmittedSelectedIds = extractSubmissionSelectedAssetIds(resubmittedSubmission).sort((a, b) => a - b);
    assert.deepEqual(resubmittedSelectedIds, [...imageIds, walkthroughId].sort((a, b) => a - b));

    const blocked = ctx.createAssignment("Submit Previous Round Block");
    const blockedStorefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const currentImage = ctx.insertWorkingAsset(blocked.item.id, {
      assignmentId: blocked.assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "image",
      slotKey: blockedStorefront,
      syncBatchId: "blocked-current",
    });
    const previousRelativePath = `uploads/${blocked.assignment.id}-0-${blockedStorefront}-blocked-previous.jpg`;
    const previousImageRes = ctx.db.prepare(`
      INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum, created_at)
      VALUES (?, 'local', ?, ?, ?, ?, ?, ?)
    `).run(
      `blocked-previous-${blocked.assignment.id}`,
      previousRelativePath,
      path.basename(previousRelativePath),
      "image/jpeg",
      1234,
      `blocked-previous-${blocked.assignment.id}`,
      new Date().toISOString()
    );
    const previousImage = Number(previousImageRes.lastInsertRowid || 0) || 0;
    ctx.db.prepare(`
      INSERT INTO content_assets (
        content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order,
        assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id
      ) VALUES (?, ?, 'unused', 0, 0, 'unused', 0, ?, ?, ?, ?, 'assignment_work', ?)
    `).run(blocked.item.id, previousImage, blocked.assignment.id, 0, "image", blockedStorefront, "blocked-previous");
    const blockedResolved = currentRoundResolver(blocked.assignment, blocked.assignment.id, 1, {
      assets: [{ id: currentImage }, { id: previousImage }],
    });
    assert.ok(Array.isArray(blockedResolved.invalid_selections));
    assert.ok(blockedResolved.invalid_selections.length > 0);
    assert.equal(blockedResolved.invalid_selections.some((row) => row.code === "asset_superseded"), false);
  } finally {
    ctx.cleanup();
  }
});

test("submit route surfaces normalization diagnostics when snapshot field pack is malformed", () => {
  const ctx = createContext();
  try {
    const { item, assignment, assignee } = ctx.createAssignment("Submit Snapshot Normalization Failure");
    ctx.db.prepare("UPDATE content_assignments SET brief_json=? WHERE id=?").run(
      JSON.stringify({
        brief_summary: "broken snapshot",
        field_pack: {
          checklists: [
            { checklist_type: "must_capture", item_text: "", capture_type: "photo", item_order: 0 },
          ],
        },
      }),
      assignment.id
    );
    const storefront = buildAssignmentCaptureSlotKeyForTest("Storefront hero", 0, "image", "photo");
    const walkthrough = buildAssignmentCaptureSlotKeyForTest("Walkthrough clip", 1, "video", "video");
    const photoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "image",
      slotKey: storefront,
      syncBatchId: "normalization-photo",
    });
    const videoId = ctx.insertWorkingAsset(item.id, {
      assignmentId: assignment.id,
      assignmentRound: 1,
      assignmentMediaType: "video",
      slotKey: walkthrough,
      syncBatchId: "normalization-video",
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

    ctx.submitHandler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload?.error, "assignment_capture_requirements_incomplete");
    assert.equal(res.payload?.diagnostic_error, "capture_requirements_normalization_failed");
    assert.match(String(res.payload?.message || ""), /normalization/i);
    assert.deepEqual(res.payload?.counts, {
      required_topics: 0,
      fulfilled_topics: 0,
      missing_topics: 0,
    });
    assert.equal(Array.isArray(res.payload?.missing_requirements) ? res.payload.missing_requirements.length : -1, 0);
    assert.ok(Array.isArray(res.payload?.invalid_selections));
    assert.equal(ctx.repo.listAssignmentSubmissions(assignment.id).length, beforeCount);
  } finally {
    ctx.cleanup();
  }
});
