import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveActiveAssignmentWorkBatchRows } from "../db/repository.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");

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

function buildCountActiveAssignmentWorkAssetsByType(mockStmt) {
  return new Function(
    "listAssignmentWorkAssetsByAssignmentAndTypeStmt",
    "resolveActiveAssignmentWorkBatchRows",
    `${extractNamedFunctionSource(repositoryJs, "countActiveAssignmentWorkAssetsByType")}
return countActiveAssignmentWorkAssetsByType;`
  )(mockStmt, resolveActiveAssignmentWorkBatchRows);
}

function makeAssetRow({ id, assignmentRound, mediaType, batchId, fileName }) {
  return {
    id,
    assignment_round: assignmentRound,
    assignment_media_type: mediaType,
    assignment_sync_batch_id: batchId,
    file_name: fileName,
  };
}

test("submit gate counts active batch assets across rounds — revision_round=2 with round=1 assets passes", () => {
  const imageAssets = [
    makeAssetRow({ id: 101, assignmentRound: 1, mediaType: "image", batchId: "batch-1", fileName: "slot1__img.jpg" }),
    makeAssetRow({ id: 102, assignmentRound: 1, mediaType: "image", batchId: "batch-1", fileName: "slot2__img.jpg" }),
  ];
  const videoAssets = [
    makeAssetRow({ id: 201, assignmentRound: 1, mediaType: "video", batchId: "batch-1", fileName: "slot1__vid.mp4" }),
  ];

  const mockStmt = {
    all(assignmentId, contentItemId, mediaType) {
      return mediaType === "image" ? imageAssets : videoAssets;
    },
  };

  const countActiveAssignmentWorkAssetsByType = buildCountActiveAssignmentWorkAssetsByType(mockStmt);
  const result = countActiveAssignmentWorkAssetsByType(29, 39);

  assert.equal(result.image, 2, "should count 2 active image assets from round 1");
  assert.equal(result.video, 1, "should count 1 active video asset from round 1");
  assert.ok(result.image + result.video >= 1, "submit gate would pass (>= 1 deliverable)");
});

test("submit gate blocks submission when no assets exist at all", () => {
  const mockStmt = {
    all() {
      return [];
    },
  };

  const countActiveAssignmentWorkAssetsByType = buildCountActiveAssignmentWorkAssetsByType(mockStmt);
  const result = countActiveAssignmentWorkAssetsByType(29, 39);

  assert.equal(result.image, 0, "should count 0 image assets");
  assert.equal(result.video, 0, "should count 0 video assets");
  assert.equal(result.image + result.video, 0, "submit gate would block (0 deliverables)");
});
