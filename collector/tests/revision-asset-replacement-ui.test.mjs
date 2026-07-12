import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testFilePath = fileURLToPath(import.meta.url);
const testsDir = path.dirname(testFilePath);
const collectorRoot = path.resolve(testsDir, "..");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const indexMjs = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

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

const getAssignmentServerSyncedAssetsForCaptureItemsForTest = new Function(
  "state",
  "getAssignmentById",
  "getAssignmentCurrentRound",
  "normalizeAssignmentCaptureUploadItems",
  "normalizeAssignmentCaptureMediaType",
  "getAssignmentAssetSlotTypeKeyFromAsset",
  "ASSIGNMENT_CAPTURE_MAX_IMAGES_PER_SLOT",
  "ASSIGNMENT_CAPTURE_MAX_VIDEOS_PER_SLOT",
  "ASSIGNMENT_WORK_SYNC_EXPIRY_MS",
  "buildAssignmentServerAssetSyncSignature",
  `${extractNamedFunctionSource(appJs, "getAssignmentServerSyncedAssetsForCaptureItems")}
return getAssignmentServerSyncedAssetsForCaptureItems;`
);

test("server-synced assets keep only the latest replacement batch for a slot", () => {
  const state = { assignments: { assetLookup: [] } };
  const getAssignmentServerSyncedAssetsForCaptureItems = getAssignmentServerSyncedAssetsForCaptureItemsForTest(
    state,
    () => ({ id: 1, revision_round: 2, image_reset_required: 0, video_reset_required: 0 }),
    (assignment) => Number(assignment?.revision_round || 0) || 1,
    (items) => items,
    (mediaType) => String(mediaType || "").trim().toLowerCase(),
    (asset) => {
      const fileName = String(asset?.file_name || "").trim();
      const slug = fileName.includes("__") ? fileName.split("__")[0] : "";
      const mediaType = String(asset?.assignment_media_type || "").trim().toLowerCase();
      return slug && mediaType ? `${slug}|${mediaType}` : "";
    },
    5,
    2,
    999999999,
    () => "sync-sig"
  );

  const now = new Date().toISOString();
  state.assignments.assetLookup = [
    {
      id: 11,
      assignment_id: 1,
      assignment_round: 2,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_sync_batch_id: "batch-old",
      file_name: "shot-a__old.jpg",
      mime_type: "image/jpeg",
      created_at: now,
    },
    {
      id: 12,
      assignment_id: 1,
      assignment_round: 2,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_sync_batch_id: "batch-new",
      file_name: "shot-a__new.jpg",
      mime_type: "image/jpeg",
      created_at: now,
    },
  ];

  const result = getAssignmentServerSyncedAssetsForCaptureItems(1, [
    { slotKey: "shot-a", mediaType: "image", displayIndex: 1, prompt: "Shot A" },
  ]);

  assert.equal(result.assets.length, 1);
  assert.equal(Number(result.assets[0].id || 0), 12);
  assert.equal(result.assets[0].file_name, "shot-a__new.jpg");
});

function buildCaptureItemsResolver(state, assignment) {
  return getAssignmentServerSyncedAssetsForCaptureItemsForTest(
    state,
    () => assignment,
    (a) => Number(a?.revision_round || 0) || 1,
    (items) => items,
    (mediaType) => String(mediaType || "").trim().toLowerCase(),
    (asset) => {
      const fileName = String(asset?.file_name || "").trim();
      const slug = fileName.includes("__") ? fileName.split("__")[0] : "";
      const mediaType = String(asset?.assignment_media_type || "").trim().toLowerCase();
      return slug && mediaType ? `${slug}|${mediaType}` : "";
    },
    5,
    2,
    999999999,
    () => "sync-sig"
  );
}

test("a retained asset from more than one round back still shows once the round window restriction is removed", () => {
  const assignment = { id: 1, revision_round: 4, image_reset_required: 0, video_reset_required: 0 };
  const now = new Date().toISOString();
  const state = { assignments: { assetLookup: [
    {
      id: 21,
      assignment_id: 1,
      assignment_round: 1,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_sync_batch_id: "batch-round-1",
      file_name: "shot-a__kept.jpg",
      mime_type: "image/jpeg",
      created_at: now,
    },
  ] } };
  const fn = buildCaptureItemsResolver(state, assignment);

  const output = fn(1, [{ slotKey: "shot-a", mediaType: "image", displayIndex: 1, prompt: "Shot A" }]);
  assert.equal(output.assets.length, 1);
  assert.equal(Number(output.assets[0].id || 0), 21);
  assert.equal(output.assets[0].assignment_round, 1);
});

test("a superseded batch does not come back once a newer batch exists for the same slot, even across a skipped round", () => {
  const assignment = { id: 1, revision_round: 3, image_reset_required: 0, video_reset_required: 0 };
  const now = new Date().toISOString();
  const state = { assignments: { assetLookup: [
    {
      id: 31,
      assignment_id: 1,
      assignment_round: 1,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_sync_batch_id: "batch-round-1",
      file_name: "shot-b__old.jpg",
      mime_type: "image/jpeg",
      created_at: now,
    },
    {
      id: 32,
      assignment_id: 1,
      assignment_round: 3,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_sync_batch_id: "batch-round-3",
      file_name: "shot-b__new.jpg",
      mime_type: "image/jpeg",
      created_at: now,
    },
  ] } };
  const fn = buildCaptureItemsResolver(state, assignment);

  const output = fn(1, [{ slotKey: "shot-b", mediaType: "image", displayIndex: 1, prompt: "Shot B" }]);
  assert.equal(output.assets.length, 1);
  assert.equal(Number(output.assets[0].id || 0), 32);
  assert.equal(output.assets[0].file_name, "shot-b__new.jpg");
});

test("retained image and video assets for the same slot are kept independent of each other", () => {
  const assignment = { id: 1, revision_round: 3, image_reset_required: 0, video_reset_required: 0 };
  const now = new Date().toISOString();
  const state = { assignments: { assetLookup: [
    {
      id: 41,
      assignment_id: 1,
      assignment_round: 1,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_sync_batch_id: "batch-image",
      file_name: "shot-c__photo.jpg",
      mime_type: "image/jpeg",
      created_at: now,
    },
    {
      id: 42,
      assignment_id: 1,
      assignment_round: 2,
      assignment_surface: "assignment_work",
      assignment_media_type: "video",
      assignment_sync_batch_id: "batch-video",
      file_name: "shot-c__clip.mp4",
      mime_type: "video/mp4",
      created_at: now,
    },
  ] } };
  const fn = buildCaptureItemsResolver(state, assignment);

  const output = fn(1, [
    { slotKey: "shot-c", mediaType: "image", displayIndex: 1, prompt: "Shot C photo" },
    { slotKey: "shot-c", mediaType: "video", displayIndex: 2, prompt: "Shot C video" },
  ]);
  assert.equal(output.assets.length, 2);
  const imageAsset = output.assets.find((a) => a.assignment_media_type === "image");
  const videoAsset = output.assets.find((a) => a.assignment_media_type === "video");
  assert.equal(Number(imageAsset?.id || 0), 41);
  assert.equal(Number(videoAsset?.id || 0), 42);
});

test("current-round-only behavior is unchanged: a same-round asset for an expected slot is returned and readiness still gates on required media", () => {
  const assignment = { id: 1, revision_round: 1, image_reset_required: 1, video_reset_required: 0 };
  const now = new Date().toISOString();
  const state = { assignments: { assetLookup: [
    {
      id: 51,
      assignment_id: 1,
      assignment_round: 1,
      assignment_surface: "assignment_work",
      assignment_media_type: "image",
      assignment_sync_batch_id: "batch-current",
      file_name: "shot-d__photo.jpg",
      mime_type: "image/jpeg",
      created_at: now,
    },
  ] } };
  const fn = buildCaptureItemsResolver(state, assignment);

  const filled = fn(1, [{ slotKey: "shot-d", mediaType: "image", displayIndex: 1, prompt: "Shot D" }]);
  assert.equal(filled.assets.length, 1);
  assert.equal(filled.missing.length, 0);
  assert.equal(filled.complete, true);

  const unfilled = fn(1, [{ slotKey: "shot-e", mediaType: "image", displayIndex: 1, prompt: "Shot E" }]);
  assert.equal(unfilled.assets.length, 0);
  assert.equal(unfilled.missing.length, 1);
  assert.equal(unfilled.complete, false);
});

function getRouteSignatures(source) {
  return (source.match(/app\.(?:get|post|patch|delete|put)\("[^"]+"/g) || []).map((row) => row.trim());
}

function getRouteBlock(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature + " should exist");
  const next = source.indexOf("\napp.", start + signature.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test("index route wiring keeps HEAD route count and replacement helper on assignment upload only", async () => {
  const { execFileSync } = await import("node:child_process");
  const headIndex = execFileSync("git", ["show", "HEAD:collector/server/index.mjs"], { cwd: collectorRoot, encoding: "utf8" });
  const currentRoutes = getRouteSignatures(indexMjs);
  const headRoutes = getRouteSignatures(headIndex);
  assert.equal(currentRoutes.length, headRoutes.length);

  const avatarBlock = getRouteBlock(indexMjs, 'app.post("/api/users/avatar/upload"');
  const directBlock = getRouteBlock(indexMjs, 'app.post("/api/assignments/:id/assets/upload"');
  const finalizeBlock = getRouteBlock(indexMjs, 'app.post("/api/assignments/:id/assets/uploads/:uploadId/finalize"');

  assert.equal(avatarBlock.includes("removeAssignmentWorkReplacementLinksBeforeInsert("), false);
  assert.equal(directBlock.includes("removeAssignmentWorkReplacementLinksBeforeInsert("), true);
  assert.equal(finalizeBlock.includes("removeAssignmentWorkReplacementLinksBeforeInsert("), true);
});
