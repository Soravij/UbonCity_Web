import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "D:\\UbonCity_Web\\collector";

test("export item UI uses only item-scoped release route", () => {
  const source = fs.readFileSync(path.join(root, "server", "public", "export-item.js"), "utf8");
  assert.match(source, /\/api\/items\/\$\{state\.itemId\}\/release-main/);
  assert.doesNotMatch(source, /\/api\/run\/publish/);
  assert.doesNotMatch(source, /\/api\/run\/stage/);
  assert.doesNotMatch(source, /\/api\/run\/export/);
  assert.doesNotMatch(source, /\/api\/run\/approve/);
});

test("batch release routes are disabled in the HTTP surface", () => {
  const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
  assert.match(source, /function respondBatchReleaseDisabled/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/publish"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/stage"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/approve"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/export"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/sync-backend"\)/);
});

test("item-scoped release route skips synchronous translation generation", () => {
  const serverSource = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
  const workflowSource = fs.readFileSync(path.join(root, "services", "workflow.mjs"), "utf8");
  assert.match(serverSource, /skipTranslationStage:\s*true/);
  assert.match(workflowSource, /options\.skipTranslationStage === true/);
});
