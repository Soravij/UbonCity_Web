import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = "D:\\UbonCity_Web\\collector";
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "index.html"), "utf8");
const indexServer = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

test("release tab exposes article queue UI and renders accepted handoff items", () => {
  const requiredAppSnippets = [
    "function isReleaseQueueCandidate(item) {",
    'if (assignmentState === "accepted") return true;',
    "function renderReleaseQueue(items = state.items) {",
    'window.location.href = `/article-workspace.html?id=${id}`;',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `missing app snippet: ${snippet}`);
  }

  const requiredHtmlSnippets = [
    'id="release-queue-summary"',
    'id="table-release-queue"',
  ];
  for (const snippet of requiredHtmlSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `missing html snippet: ${snippet}`);
  }

  assert.equal(appJs.includes("เปิด Article Workspace"), true, "missing release workspace CTA label");
});

test("field assignment acceptance promotes future items into article drafting", () => {
  const requiredServerSnippets = [
    'assignmentKind === "field" && nextState === "accepted"',
    'production_state: "content_in_progress"',
    'reason_code: "field_assignment_accepted_promote_article"',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `missing server snippet: ${snippet}`);
  }
});
