import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("D:/UbonCity_Web/collector");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("article submit review layout stacks the decision grid and hosts sync summary in the status block", () => {
  const html = read("server/public/article-submit.html");
  const css = read("server/public/styles.css");

  assert.match(html, /article-review-decision-grid article-review-decision-grid--stacked/);
  assert.match(html, /article-card-translation/);
  assert.match(html, /id="sync-summary" class="readiness-summary hidden"/);
  assert.doesNotMatch(html, /article-card-sync/);
  assert.match(css, /\.article-review-decision-grid--stacked/);
  assert.doesNotMatch(css, /\.article-status-block/);
});
