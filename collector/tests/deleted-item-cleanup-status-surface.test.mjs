import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("collector");
const serverSource = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");
const appSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

test("deleted-item cleanup API supplies flat canonical state consumed by the cleanup panel", () => {
  assert.match(serverSource, /LEFT JOIN content_workflow_models wm ON wm\.content_item_id=i\.id/);
  assert.match(serverSource, /wm\.production_state, wm\.publication_state/);
  assert.match(serverSource, /production_state: row\.production_state \|\| null/);
  assert.match(serverSource, /publication_state: row\.publication_state \|\| null/);
  assert.match(appSource, /const productionState = String\(row\?\.production_state \|\| ""\)\.trim\(\);/);
  assert.match(appSource, /const publicationState = String\(row\?\.publication_state \|\| ""\)\.trim\(\);/);
  assert.doesNotMatch(appSource, /row\?\.workflow_model\?\.production_state/);
});
