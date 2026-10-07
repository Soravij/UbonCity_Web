import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
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
});

test("Raw intake per-row decisions build the same payload shape and honor the forced merge target", () => {
  const load = (name) => Function(`return (${extractFunctionSource(appSource, name)});`)();
  const getDefaultChoice = load("getDefaultSourceIntakeChoice");
  const findMissingTarget = load("findSourceIntakeMissingMergeTarget");
  const buildDecisions = load("buildSourceIntakeDecisions");
  const shortLabel = load("shortSourceUrlLabel");
  const matchesFilter = load("sourceIntakeRowMatchesFilter");
  const safeUrl = load("safeHttpUrl");

  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.ok(safeUrl("https://www.google.com/maps/search/?api=1").startsWith("https://www.google.com/maps/search/"));
  assert.equal(safeUrl(""), "");

  const rows = [
    { rawItemId: 1, selectedDecision: "new" },
    { rawItemId: 2, selectedDecision: "merge", selectedMergeItemId: 7 },
    { rawItemId: 3, selectedDecision: "skip" },
  ];
  assert.deepEqual(buildDecisions(rows, 0), [
    { raw_item_id: 1, decision: "new", existing_item_id: null },
    { raw_item_id: 2, decision: "merge", existing_item_id: 7 },
    { raw_item_id: 3, decision: "skip", existing_item_id: null },
  ]);
  assert.deepEqual(buildDecisions(rows, 42), [
    { raw_item_id: 1, decision: "merge", existing_item_id: 42 },
    { raw_item_id: 2, decision: "merge", existing_item_id: 42 },
    { raw_item_id: 3, decision: "skip", existing_item_id: null },
  ]);

  assert.equal(getDefaultChoice({ recommendedDecision: "new" }, 42), "merge");
  assert.equal(getDefaultChoice({ recommendedDecision: "skip" }, 42), "skip");
  assert.equal(getDefaultChoice({ recommendedDecision: "merge" }, 0), "merge");
  assert.equal(getDefaultChoice({ recommendedDecision: "new" }, 0), "new");
  assert.equal(getDefaultChoice({}, 0), "skip");

  const unresolved = [{ rawItemId: 5, selectedDecision: "merge", selectedMergeItemId: 0, title: "A" }];
  assert.equal(findMissingTarget(unresolved, 0).title, "A");
  assert.equal(findMissingTarget(unresolved, 42), null);
  assert.equal(findMissingTarget([{ ...unresolved[0], selectedMergeItemId: 9 }], 0), null);

  assert.equal(shortLabel("https://www.google.com/maps/search/?api=1&query=%E0%B8%81"), "google.com/maps/search");
  assert.equal(shortLabel(""), "");
  assert.equal(shortLabel("not a url"), "not a url");

  assert.equal(matchesFilter({ merge: { rank: 2 } }, "dup"), true);
  assert.equal(matchesFilter({ merge: { rank: 0 } }, "dup"), false);
  assert.equal(matchesFilter({ selectedDecision: "skip" }, "skip"), true);
  assert.equal(matchesFilter({ selectedDecision: "new" }, "all"), true);
});

test("Crawl merge context is consumed by one batch and expires for the next crawl", () => {
  const state = { crawlMergePendingExistingItemId: 42 };
  const historyCalls = [];
  const fakeWindow = {
    location: { href: "https://collector.local/?tab=raw&crawl_merge_item_id=42" },
    history: {
      state: { page: "raw" },
      replaceState: (...args) => historyCalls.push(args),
    },
  };
  const consumeContext = Function(
    "state",
    "window",
    `return (${extractFunctionSource(appSource, "consumePendingCrawlMergeContext")});`
  )(state, fakeWindow);
  const buildClosedState = Function(`return (${extractFunctionSource(appSource, "buildClosedSourceIntakeState")});`)();

  assert.deepEqual(consumeContext("batch-first"), { batchUid: "batch-first", existingItemId: 42 });
  assert.equal(state.crawlMergePendingExistingItemId, 0);
  assert.deepEqual(historyCalls[0], [{ page: "raw" }, "", "/?tab=raw"]);
  assert.deepEqual(consumeContext("batch-second"), { batchUid: "batch-second", existingItemId: 0 });
  assert.deepEqual(buildClosedState(), {
    open: false,
    batchUid: "",
    adapter: "",
    sourceLabel: "",
    query: "",
    filter: "all",
    forcedBatchUid: "",
    forcedExistingItemId: 0,
    candidates: [],
  });
});

test("Locked crawl announces its merge target before opening intake review", () => {
  assert.match(appSource, /กำลังจะรวมเข้า item #\$\{forcedMergeContext\.existingItemId\} ในขั้น review/);
  assert.match(appSource, /forcedMergeContext,/);
  assert.match(appSource, /forcedBatchUid: forcedExistingItemId \? forcedBatchUid : ""/);
});

test("Clean crawl shortcut is absent for role user because it is created only for owner/admin", () => {
  assert.match(editorSource, /if \(!isCleanMode \|\| !isAdminUser\(\) \|\| !state\.itemId\) return;/);
  assert.match(editorSource, /return role === "admin" \|\| role === "owner";/);
  assert.equal(cleanHtml.includes("btn-clean-crawl-merge"), false, "Clean HTML must not render a shortcut before role gating");
});
