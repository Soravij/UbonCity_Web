import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const serverIndexJs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractNamedFunctionSource(source, name) {
  const asyncMarker = `async function ${name}`;
  const syncMarker = `function ${name}`;
  const asyncStart = source.indexOf(asyncMarker);
  const syncStart = source.indexOf(syncMarker);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
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

function extractRouteBody(source, routeMarker, nextMarker) {
  const start = source.indexOf(routeMarker);
  assert.notEqual(start, -1, `route ${routeMarker} should exist`);
  const end = source.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `next marker ${nextMarker} should exist after ${routeMarker}`);
  const routeSource = source.slice(start, end);
  const bodyStart = routeSource.indexOf("{", routeSource.indexOf("=>"));
  assert.notEqual(bodyStart, -1, `route ${routeMarker} should have a body`);
  const bodyEnd = routeSource.lastIndexOf("});");
  assert.notEqual(bodyEnd, -1, `route ${routeMarker} should end with });`);
  return routeSource.slice(bodyStart + 1, bodyEnd).trim();
}

const nonChunkUploadRouteBody = extractRouteBody(
  serverIndexJs,
  'app.post("/api/assignments/:id/assets/upload"',
  'app.post("/api/assets/register"'
);

const chunkFinalizeRouteBody = extractRouteBody(
  serverIndexJs,
  'app.post("/api/assignments/:id/assets/uploads/:uploadId/finalize"',
  'app.post("/api/assignments/:id/assets/upload"'
);

const buildHandlers = new Function(
  "deps",
  `const {
  db,
  repo,
  dirs,
  fs,
  fsSync,
  crypto,
  path,
  once,
  resolveStoragePath,
  parseAssetPathForUrl,
  actorEmail,
  ensureAssignmentUploadAccess,
  hasAssignmentSubmissionAccess,
  actorPolicyRole,
} = deps;
const ASSIGNMENT_CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
const ASSIGNMENT_CHUNK_MAX_BYTES = 30 * 1024 * 1024;
const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
${extractNamedFunctionSource(serverIndexJs, "sanitizeAssignmentSyncBatchId")}
${extractNamedFunctionSource(serverIndexJs, "sanitizeAssignmentCaptureSlotKey")}
${extractNamedFunctionSource(serverIndexJs, "normalizeAssignmentCaptureMediaType")}
${extractNamedFunctionSource(serverIndexJs, "parseIsoMs")}
${extractNamedFunctionSource(serverIndexJs, "resolveAssignmentCurrentRound")}
${extractNamedFunctionSource(serverIndexJs, "isValidAssignmentUploadId")}
${extractNamedFunctionSource(serverIndexJs, "sanitizeStoredUploadName")}
${extractNamedFunctionSource(serverIndexJs, "normalizeRelativeStoragePath")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentUploadTempDir")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentUploadRootDir")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentUploadManifestPath")}
${extractNamedFunctionSource(serverIndexJs, "getAssignmentChunkFilePath")}
${extractNamedFunctionSource(serverIndexJs, "writeAssignmentUploadManifest")}
${extractNamedFunctionSource(serverIndexJs, "readAssignmentUploadManifest")}
${extractNamedFunctionSource(serverIndexJs, "isPathWithinRoot")}
${extractNamedFunctionSource(serverIndexJs, "removeAssignmentUploadSessionTempDir")}
${extractNamedFunctionSource(serverIndexJs, "readFileHeadBytes")}
${extractNamedFunctionSource(serverIndexJs, "appendChunkToStream")}
${extractNamedFunctionSource(serverIndexJs, "isSupportedImageSignature")}
${extractNamedFunctionSource(serverIndexJs, "isSupportedVideoSignature")}
${extractNamedFunctionSource(serverIndexJs, "isSupportedMediaSignature")}
${extractFunctionSlice(serverIndexJs, "listDraftAssignmentWorkAssetRows", "removeAssignmentWorkRowsByAssetIds")}
${extractFunctionSlice(serverIndexJs, "removeAssignmentWorkRowsByAssetIds", "cleanupSupersededAssignmentWorkAssetSlot")}
${extractFunctionSlice(serverIndexJs, "cleanupSupersededAssignmentWorkAssetSlot", "cleanupExpiredAssignmentWorkDraftAssets")}
const nonChunkUploadHandler = async function(req, res) {
${nonChunkUploadRouteBody}
};
const chunkFinalizeHandler = async function(req, res) {
${chunkFinalizeRouteBody}
};
return {
  nonChunkUploadHandler,
  chunkFinalizeHandler,
  writeAssignmentUploadManifest,
  getAssignmentChunkFilePath,
};`
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

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-working-media-route-"));
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

  function resolveStoragePath(relativePath) {
    return path.join(mediaDir, String(relativePath || "").replace(/\//g, path.sep));
  }

  function createUploadTempFile(fileName, buffer) {
    const relativePath = path.posix.join("incoming", `${Date.now()}-${Math.random().toString(16).slice(2)}-${String(fileName || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    const absolutePath = resolveStoragePath(relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);
    return absolutePath;
  }

  function createItem(title = "Assignment route replacement") {
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

  function createUser(suffix = "route-user") {
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
    const assignmentRound = Number(options.assignmentRound || 1) || 1;
    const mediaType = String(options.mediaType || "image").trim().toLowerCase() || "image";
    const slotKey = String(options.slotKey || "shot-1-storefront-hero").trim().toLowerCase();
    const syncBatchId = String(options.syncBatchId || "batch-old").trim();
    const assignmentSurface = "assignment_work";
    const extension = mediaType === "video" ? "mp4" : "jpg";
    const mimeType = mediaType === "video" ? "video/mp4" : "image/jpeg";
    const relativePath = `uploads/${assignmentId}-${assignmentRound}-${slotKey}-${syncBatchId}.${extension}`;
    const absolutePath = resolveStoragePath(relativePath);
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
    const contentAssetResult = db.prepare(`
      INSERT INTO content_assets (
        content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order,
        assignment_id, assignment_round, assignment_media_type, assignment_slot_key, assignment_surface, assignment_sync_batch_id
      ) VALUES (?, ?, 'unused', 0, 0, 'unused', 0, ?, ?, ?, ?, ?, ?)
    `).run(itemId, assetId, assignmentId, assignmentRound, mediaType, slotKey, assignmentSurface, syncBatchId);
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

  const handlers = buildHandlers({
    db,
    repo,
    dirs: { mediaDir },
    fs: fsPromises,
    fsSync: fs,
    crypto,
    path,
    once,
    resolveStoragePath,
    parseAssetPathForUrl: (relativePath) => `/media/${String(relativePath || "").replace(/\\/g, "/")}`,
    actorEmail: () => "tester@local",
    ensureAssignmentUploadAccess: async (req, res, assignmentId) => {
      const normalizedId = Number(assignmentId || 0);
      if (!normalizedId) {
        res.status(400).json({ error: "Invalid assignment id" });
        return null;
      }
      const assignment = repo.getAssignmentById(normalizedId);
      if (!assignment) {
        res.status(404).json({ error: "assignment not found" });
        return null;
      }
      return assignment;
    },
    hasAssignmentSubmissionAccess: () => true,
    actorPolicyRole: () => "user",
  });

  return {
    db,
    repo,
    mediaDir,
    tempDir,
    cleanup,
    createItem,
    createAssignment,
    createSubmission,
    insertWorkingAsset,
    handlers,
    resolveStoragePath,
    createUploadTempFile,
  };
}

function jpegBytes() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06]);
}

function mp4Bytes() {
  return Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00]);
}

function createAuthReq(assignmentId, actorUserId, extra = {}) {
  return {
    params: { id: String(assignmentId), ...(extra.params || {}) },
    authUser: { id: actorUserId, email: "assignee@local.test", role: "user" },
    body: extra.body || {},
    files: extra.files || [],
  };
}

test("non-chunk assignment upload route replaces only the old unsubmitted working media in the same assignment round slot and type", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Route upload replacement");
    const { assignment, assignee } = ctx.createAssignment(item, "non-chunk-success");
    const assignmentId = Number(assignment.id || 0);
    const oldImage = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
      syncBatchId: "batch-old",
    });
    const otherSlot = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "image",
      slotKey: "shot-2-walkthrough-clip",
      syncBatchId: "batch-other-slot",
    });
    const otherType = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "video",
      slotKey: "shot-1-storefront-hero",
      syncBatchId: "batch-other-type",
    });
    const otherRound = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 2,
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
      syncBatchId: "batch-other-round",
    });
    const otherAssignment = ctx.createAssignment(ctx.createItem("Other assignment"), "other-assignment");
    const otherAssignmentAsset = ctx.insertWorkingAsset(otherAssignment.assignment.content_item_id, {
      assignmentId: Number(otherAssignment.assignment.id || 0),
      assignmentRound: 1,
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
      syncBatchId: "batch-other-assignment",
    });

    const uploadTempPath = ctx.createUploadTempFile("incoming-photo.jpg", jpegBytes());
    const req = createAuthReq(assignmentId, assignee.id, {
      body: { sync_batch_id: "batch-new", slot_key: "shot-1-storefront-hero" },
      files: [{
        path: uploadTempPath,
        originalname: "storefront.jpg",
        mimetype: "image/jpeg",
        size: fs.statSync(uploadTempPath).size,
      }],
    });
    const res = createResponseRecorder();

    await ctx.handlers.nonChunkUploadHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(Array.isArray(res.payload?.uploaded), true);
    assert.equal(res.payload.uploaded.length, 1);
    const newAssetId = Number(res.payload.uploaded[0].id || 0);
    assert.ok(newAssetId > 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(newAssetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(newAssetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(oldImage.assetId)?.c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(oldImage.assetId)?.c || 0), 0);
    assert.equal(fs.existsSync(oldImage.absolutePath), false);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(otherRound.assetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(otherRound.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(otherRound.absolutePath), true);
    assert.equal(fs.existsSync(otherSlot.absolutePath), true);
    assert.equal(fs.existsSync(otherType.absolutePath), true);
    assert.equal(fs.existsSync(otherAssignmentAsset.absolutePath), true);
  } finally {
    ctx.cleanup();
  }
});

test("non-chunk assignment upload route keeps old file when it already has a deliverable reference and leaves failure cases untouched", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Route upload ref guard");
    const { assignment, assignee } = ctx.createAssignment(item, "non-chunk-guard");
    const assignmentId = Number(assignment.id || 0);
    const oldImage = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "image",
      slotKey: "shot-1-storefront-hero",
      syncBatchId: "batch-old",
    });
    const submissionId = ctx.createSubmission(assignmentId, item.id, assignee.id, "submitted");
    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionId, assignmentId);
    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "photos",
      source_asset_id: oldImage.assetId,
    }, "tester@local");

    const uploadTempPath = ctx.createUploadTempFile("incoming-photo-2.jpg", jpegBytes());
    const successReq = createAuthReq(assignmentId, assignee.id, {
      body: { sync_batch_id: "batch-new", slot_key: "shot-1-storefront-hero" },
      files: [{
        path: uploadTempPath,
        originalname: "storefront-2.jpg",
        mimetype: "image/jpeg",
        size: fs.statSync(uploadTempPath).size,
      }],
    });
    const successRes = createResponseRecorder();

    await ctx.handlers.nonChunkUploadHandler(successReq, successRes);

    assert.equal(successRes.statusCode, 201);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(oldImage.assetId)?.c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(oldImage.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(oldImage.absolutePath), true);

    const failureOld = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "image",
      slotKey: "shot-3-signature-fail",
      syncBatchId: "batch-failure-old",
    });
    const invalidTempPath = ctx.createUploadTempFile("bad-photo.jpg", Buffer.from("not-a-jpeg-signature"));
    const failureReq = createAuthReq(assignmentId, assignee.id, {
      body: { sync_batch_id: "batch-failure-new", slot_key: "shot-3-signature-fail" },
      files: [{
        path: invalidTempPath,
        originalname: "bad-photo.jpg",
        mimetype: "image/jpeg",
        size: fs.statSync(invalidTempPath).size,
      }],
    });
    const failureRes = createResponseRecorder();

    await ctx.handlers.nonChunkUploadHandler(failureReq, failureRes);

    assert.equal(failureRes.statusCode, 400);
    assert.match(String(failureRes.payload?.error || ""), /signature/);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(failureOld.assetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(failureOld.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(failureOld.absolutePath), true);
  } finally {
    ctx.cleanup();
  }
});

test("chunk finalize route replaces only the old unsubmitted working media after the new link succeeds", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Chunk finalize replacement");
    const { assignment, assignee } = ctx.createAssignment(item, "chunk-success");
    const assignmentId = Number(assignment.id || 0);
    const oldVideo = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "video",
      slotKey: "shot-2-walkthrough-clip",
      syncBatchId: "batch-old-video",
    });
    const otherRound = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 2,
      mediaType: "video",
      slotKey: "shot-2-walkthrough-clip",
      syncBatchId: "batch-other-round-video",
    });
    const otherImage = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "image",
      slotKey: "shot-2-walkthrough-clip",
      syncBatchId: "batch-image",
    });

    const uploadId = crypto.randomUUID();
    const manifest = {
      assignment_id: assignmentId,
      actor_user_id: assignee.id,
      file_name: "walkthrough.mp4",
      mime_type: "video/mp4",
      size_bytes: mp4Bytes().length,
      total_chunks: 1,
      chunk_size_bytes: mp4Bytes().length,
      sync_batch_id: "batch-new-video",
      slot_key: "shot-2-walkthrough-clip",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      received_chunks: { "0": { size_bytes: mp4Bytes().length, uploaded_at: new Date().toISOString() } },
    };
    const sessionDir = path.dirname(ctx.handlers.getAssignmentChunkFilePath(assignmentId, uploadId, 0));
    fs.mkdirSync(sessionDir, { recursive: true });
    await ctx.handlers.writeAssignmentUploadManifest(assignmentId, uploadId, manifest);
    await fsPromises.writeFile(ctx.handlers.getAssignmentChunkFilePath(assignmentId, uploadId, 0), mp4Bytes());

    const req = {
      params: { id: String(assignmentId), uploadId },
      authUser: { id: assignee.id, email: "assignee@local.test", role: "user" },
    };
    const res = createResponseRecorder();

    await ctx.handlers.chunkFinalizeHandler(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(Array.isArray(res.payload?.uploaded), true);
    assert.equal(res.payload.uploaded.length, 1);
    assert.equal(Number(res.payload?.replacement_cleanup?.removed_links || 0), 1);
    assert.equal(Number(res.payload?.replacement_cleanup?.removed_assets || 0), 1);
    const newAssetId = Number(res.payload.uploaded[0].id || 0);
    assert.ok(newAssetId > 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(newAssetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(oldVideo.assetId)?.c || 0), 0);
    assert.equal(fs.existsSync(oldVideo.absolutePath), false);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(otherRound.assetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(otherRound.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(otherRound.absolutePath), true);
    assert.equal(fs.existsSync(otherImage.absolutePath), true);
  } finally {
    ctx.cleanup();
  }
});

test("chunk finalize route keeps referenced old media and does not delete anything when finalize fails", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem("Chunk finalize guard");
    const { assignment, assignee } = ctx.createAssignment(item, "chunk-guard");
    const assignmentId = Number(assignment.id || 0);
    const oldVideo = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "video",
      slotKey: "shot-2-walkthrough-clip",
      syncBatchId: "batch-old-video",
    });
    const submissionId = ctx.createSubmission(assignmentId, item.id, assignee.id, "submitted");
    ctx.db.prepare("UPDATE content_assignments SET latest_submission_id=? WHERE id=?").run(submissionId, assignmentId);
    ctx.repo.createAssignmentSubmissionDeliverable({
      assignment_id: assignmentId,
      submission_id: submissionId,
      content_item_id: item.id,
      deliverable_type: "videos",
      source_asset_id: oldVideo.assetId,
    }, "tester@local");

    const successUploadId = crypto.randomUUID();
    const successManifest = {
      assignment_id: assignmentId,
      actor_user_id: assignee.id,
      file_name: "walkthrough-success.mp4",
      mime_type: "video/mp4",
      size_bytes: mp4Bytes().length,
      total_chunks: 1,
      chunk_size_bytes: mp4Bytes().length,
      sync_batch_id: "batch-new-video",
      slot_key: "shot-2-walkthrough-clip",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      received_chunks: { "0": { size_bytes: mp4Bytes().length, uploaded_at: new Date().toISOString() } },
    };
    const successSessionDir = path.dirname(ctx.handlers.getAssignmentChunkFilePath(assignmentId, successUploadId, 0));
    fs.mkdirSync(successSessionDir, { recursive: true });
    await ctx.handlers.writeAssignmentUploadManifest(assignmentId, successUploadId, successManifest);
    await fsPromises.writeFile(ctx.handlers.getAssignmentChunkFilePath(assignmentId, successUploadId, 0), mp4Bytes());

    const successReq = {
      params: { id: String(assignmentId), uploadId: successUploadId },
      authUser: { id: assignee.id, email: "assignee@local.test", role: "user" },
    };
    const successRes = createResponseRecorder();

    await ctx.handlers.chunkFinalizeHandler(successReq, successRes);

    assert.equal(successRes.statusCode, 201);
    assert.equal(Number(successRes.payload?.replacement_cleanup?.removed_links || 0), 1);
    assert.equal(Number(successRes.payload?.replacement_cleanup?.removed_assets || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(oldVideo.assetId)?.c || 0), 0);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(oldVideo.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(oldVideo.absolutePath), true);

    const failureOld = ctx.insertWorkingAsset(item.id, {
      assignmentId,
      assignmentRound: 1,
      mediaType: "video",
      slotKey: "shot-4-finalize-fail",
      syncBatchId: "batch-failure-old",
    });
    const failureUploadId = crypto.randomUUID();
    const failureBuffer = Buffer.from("not-an-mp4-signature");
    const failureManifest = {
      assignment_id: assignmentId,
      actor_user_id: assignee.id,
      file_name: "walkthrough-fail.mp4",
      mime_type: "video/mp4",
      size_bytes: failureBuffer.length,
      total_chunks: 1,
      chunk_size_bytes: failureBuffer.length,
      sync_batch_id: "batch-failure-new",
      slot_key: "shot-4-finalize-fail",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      received_chunks: { "0": { size_bytes: mp4Bytes().length, uploaded_at: new Date().toISOString() } },
    };
    const failureSessionDir = path.dirname(ctx.handlers.getAssignmentChunkFilePath(assignmentId, failureUploadId, 0));
    fs.mkdirSync(failureSessionDir, { recursive: true });
    await ctx.handlers.writeAssignmentUploadManifest(assignmentId, failureUploadId, failureManifest);
    await fsPromises.writeFile(ctx.handlers.getAssignmentChunkFilePath(assignmentId, failureUploadId, 0), failureBuffer);

    const failureReq = {
      params: { id: String(assignmentId), uploadId: failureUploadId },
      authUser: { id: assignee.id, email: "assignee@local.test", role: "user" },
    };
    const failureRes = createResponseRecorder();

    await ctx.handlers.chunkFinalizeHandler(failureReq, failureRes);

    assert.equal(failureRes.statusCode, 400);
    assert.match(String(failureRes.payload?.error || ""), /signature/);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assets WHERE asset_id=?").get(failureOld.assetId)?.c || 0), 1);
    assert.equal(Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id=?").get(failureOld.assetId)?.c || 0), 1);
    assert.equal(fs.existsSync(failureOld.absolutePath), true);
  } finally {
    ctx.cleanup();
  }
});
