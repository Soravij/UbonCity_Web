import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const controller = fs.readFileSync(path.join(root, "controllers", "mediaController.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "routes", "mediaRoutes.js"), "utf8");

test("backend media endpoints cannot author usage captions", () => {
  assert.doesNotMatch(routes, /router\.patch\("\/media-usages\/:id"/);
  assert.doesNotMatch(controller, /export const updateMediaUsageCaption/);
  assert.match(controller, /caption is managed by Collector release snapshots/);
  assert.match(controller, /\[assetId, entityType, entityId, usageType, position, null, asInt\(req\.user\?\.id\)\]/);
});
