import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "D:\\UbonCity_Web\\collector";

test("batch release routes are disabled in the HTTP surface", () => {
  const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");
  assert.match(source, /function respondBatchReleaseDisabled/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/publish"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/stage"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/approve"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/export"\)/);
  assert.match(source, /respondBatchReleaseDisabled\(req, res, "\/api\/run\/sync-backend"\)/);
});
