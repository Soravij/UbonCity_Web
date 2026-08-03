import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const cleanHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "clean-item.html"), "utf8");
const editorSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.js"), "utf8");
const appSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${functionName} should close`);
}

test("Clean crawl shortcut sends the current item as an explicit merge context", () => {
  assert.equal(cleanHtml.includes('id="btn-prev-step"'), false, "Clean must not retain the misleading raw-navigation button");
  const buildUrl = Function(`return (${extractFunctionSource(editorSource, "buildCleanCrawlMergeUrl")});`)();
  assert.equal(buildUrl(42), "/?tab=raw&crawl_merge_item_id=42");
  assert.match(editorSource, /button\.id = "btn-clean-crawl-merge"/);
  assert.match(editorSource, /if \(!isCleanMode \|\| !isAdminUser\(\) \|\| !state\.itemId\) return;/);
});

test("Raw intake context locks merge mode and injects the target independent of dashboard options", () => {
  assert.match(appSource, /function getCrawlMergeExistingItemId\(\)/);
  assert.match(appSource, /forcedExistingItemId: 0/);
  assert.match(appSource, /prioritized\.push\(\{ id: forcedExistingItemId, title: "รายการจากหน้า Clean" \}\)/);
  assert.match(appSource, /selectedMode: forcedExistingItemId \? "merge"/);
  assert.match(appSource, /selectedExistingItemId: forcedExistingItemId \|\| chooseDefaultSourceIntakeExistingItemId/);
  assert.match(appSource, /<select id="source-intake-mode" \$\{forcedExistingItemId \? "disabled" : ""\}>/);
  assert.match(appSource, /<select id="source-intake-existing-item" \$\{forcedExistingItemId \? "disabled" : ""\}>/);
  assert.match(appSource, /state\.sourceIntake\.selectedMode = forcedExistingItemId \|\| hasMergeRecommendation \? "merge" : "new";/);
  assert.match(appSource, /const existingItemId = forcedExistingItemId \|\| Number\(state\.sourceIntake\.selectedExistingItemId \|\| 0\) \|\| 0;/);
});

test("Clean crawl shortcut is absent for role user because it is created only for owner/admin", () => {
  assert.match(editorSource, /if \(!isCleanMode \|\| !isAdminUser\(\) \|\| !state\.itemId\) return;/);
  assert.match(editorSource, /return role === "admin" \|\| role === "owner";/);
  assert.equal(cleanHtml.includes("btn-clean-crawl-merge"), false, "Clean HTML must not render a shortcut before role gating");
});
