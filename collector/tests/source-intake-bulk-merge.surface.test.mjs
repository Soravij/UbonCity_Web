import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const appSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

function mergeBranch() {
  const anchor = appSource.indexOf('getElementById("source-intake-bulk-merge-id")');
  assert.notEqual(anchor, -1, "bulk merge handler should read the target id");
  const start = appSource.lastIndexOf('if (choice === "merge") {', anchor);
  assert.notEqual(start, -1, "bulk merge branch should exist");
  return appSource.slice(start, start + 900);
}

test("Bulk merge control is rendered", () => {
  assert.ok(appSource.includes('data-intake-bulk="merge"'));
  assert.ok(appSource.includes('id="source-intake-bulk-merge-id"'));
});

test("Bulk merge skips google_maps rows", () => {
  assert.match(mergeBranch(), /sourceType[^\n]*"google_maps"[^\n]*\)\s*continue;/);
});

test("Bulk merge sets selectedMergeItemId", () => {
  assert.match(mergeBranch(), /candidate\.selectedMergeItemId = targetId/);
});
