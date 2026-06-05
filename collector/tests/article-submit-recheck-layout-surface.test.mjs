import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("D:/UbonCity_Web/collector");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("article submit review layout stacks the decision grid and keeps source diagnostics collapsed", () => {
  const html = read("server/public/article-submit.html");
  const css = read("server/public/styles.css");
  const server = read("server/index.mjs");

  assert.match(html, /article-review-decision-grid article-review-decision-grid--stacked/);
  assert.match(html, /article-card-translation/);
  assert.match(html, /id="sync-summary" class="readiness-summary hidden"/);
  assert.match(html, /<details class="article-review-diagnostics">[\s\S]*<summary>Source diagnostics<\/summary>[\s\S]*id="review-checklist"/);
  assert.match(html, /src="\/theme-bootstrap\.js\?v=__COLLECTOR_ASSET_VERSION__"/);
  assert.match(html, /src="\/theme-control\.js\?v=__COLLECTOR_ASSET_VERSION__"/);
  assert.match(html, /src="\/article-submit-page\.js\?v=__COLLECTOR_ASSET_VERSION__"/);
  assert.doesNotMatch(html, /article-card-sync/);
  assert.match(css, /\.article-review-decision-grid--stacked/);
  assert.match(css, /\.translation-recheck-summary-line/);
  assert.match(css, /\.translation-recheck-action-note/);
  assert.match(css, /#translation-recheck-panel \.utility-action:disabled/);
  assert.match(css, /#translation-recheck-panel \.utility-action:focus-visible/);
  assert.match(css, /:root\[data-theme="dark"\] #translation-recheck-panel \.translation-recheck-action-note/);
  assert.match(server, /function resolveCollectorAssetVersionForFile/);
  assert.match(server, /function resolveCollectorAssetFilePath/);
  assert.match(server, /function rewriteCollectorHtmlAssetUrls/);
  assert.match(server, /rewriteCollectorModuleSpecifiers\(jsSource, fullPath\)/);
  assert.doesNotMatch(css, /\.translation-recheck-summary-grid/);
  assert.doesNotMatch(css, /\.article-status-block/);
});
