import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

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

test("syncAssignmentSubmissionUploads calls loadAssignmentAssets after upload success before re-render gate", () => {
  const src = extractNamedFunctionSource(appJs, "syncAssignmentSubmissionUploads");

  const uploadCallIdx = src.indexOf("uploadAssignmentSubmissionFiles(");
  assert.ok(uploadCallIdx !== -1, "should contain uploadAssignmentSubmissionFiles call");

  const loadAssetsCallIdx = src.indexOf("loadAssignmentAssets({ showStatus: false })");
  assert.ok(loadAssetsCallIdx !== -1, "should contain loadAssignmentAssets({ showStatus: false }) call");
  assert.ok(loadAssetsCallIdx > uploadCallIdx, "loadAssignmentAssets must appear after uploadAssignmentSubmissionFiles");

  const gatePanelIdx = src.indexOf("renderAssignmentSubmissionGatePanel(", loadAssetsCallIdx);
  assert.ok(gatePanelIdx !== -1, "should contain renderAssignmentSubmissionGatePanel call after loadAssignmentAssets");
  assert.ok(loadAssetsCallIdx < gatePanelIdx, "loadAssignmentAssets must appear before renderAssignmentSubmissionGatePanel");

  const catchPattern = src.indexOf(".catch(() => {})", loadAssetsCallIdx);
  assert.ok(catchPattern !== -1 && catchPattern < gatePanelIdx, "loadAssignmentAssets call must have .catch(() => {}) before gate panel render");
});

test("syncAssignmentSubmissionUploads calls loadAssignmentAssets in server-synced path before re-render gate", () => {
  const src = extractNamedFunctionSource(appJs, "syncAssignmentSubmissionUploads");

  const serverSyncedIdx = src.indexOf("applyAssignmentServerSyncedAssets(");
  assert.ok(serverSyncedIdx !== -1, "should contain applyAssignmentServerSyncedAssets call");

  const loadAssetsCalls = [];
  let searchFrom = 0;
  while (true) {
    const idx = src.indexOf("loadAssignmentAssets({ showStatus: false })", searchFrom);
    if (idx === -1) break;
    loadAssetsCalls.push(idx);
    searchFrom = idx + 1;
  }
  assert.ok(loadAssetsCalls.length >= 2, `expected at least 2 loadAssignmentAssets calls, found ${loadAssetsCalls.length}`);

  const serverPathLoad = loadAssetsCalls.find((idx) => idx > serverSyncedIdx);
  assert.ok(serverPathLoad !== undefined, "loadAssignmentAssets must appear after applyAssignmentServerSyncedAssets");

  const gatePanelAfterServer = src.indexOf("renderAssignmentSubmissionGatePanel(", serverSyncedIdx);
  assert.ok(serverPathLoad < gatePanelAfterServer, "loadAssignmentAssets must appear before gate panel render in server-synced path");
});
