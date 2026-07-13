import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("D:/UbonCity_Web/collector");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("article workspace html renders confirmed metadata as read-only summaries without editable inputs", () => {
  const html = read("server/public/article-workspace.html");
  assert.match(html, /id="btn-toggle-confirmed-meta"/);
  assert.match(html, /id="confirmed-meta-section"/);
  assert.match(html, /id="confirmed-cta-summary"/);
  assert.match(html, /id="confirmed-taxonomy-summary"/);
  assert.match(html, /id="confirmed-meta-status-summary"/);
  assert.doesNotMatch(html, /id="confirmed-phone"/);
  assert.doesNotMatch(html, /id="confirmed-line-url"/);
  assert.doesNotMatch(html, /id="confirmed-facebook-url"/);
  assert.doesNotMatch(html, /id="confirmed-website-url"/);
  assert.doesNotMatch(html, /id="confirmed-primary-cta"/);
  assert.doesNotMatch(html, /id="confirmed-category"/);
  assert.doesNotMatch(html, /id="confirmed-subtype"/);
  assert.doesNotMatch(html, /id="confirmed-tags"/);
  assert.doesNotMatch(html, /id="confirmed-meta-status"(?!-summary)/);
  assert.doesNotMatch(html, /id="confirmed-note"/);
  assert.match(html, /ยืนยันโดยผู้ตรวจเมื่อรับงานภาคสนาม/);
});

test("article workspace source renders read-only confirmed summaries without apply-evidence actions", () => {
  const source = read("server/public/article-workspace-page.js");
  assert.match(source, /renderConfirmedMetaSummary/);
  assert.match(source, /confirmed-cta-summary/);
  assert.match(source, /confirmed-taxonomy-summary/);
  assert.match(source, /confirmed-meta-status-summary/);
  assert.match(source, /defaultConfirmedCtaContact/);
  assert.match(source, /defaultConfirmedTaxonomy/);
  assert.match(source, /renderConfirmedMetaVisibility/);
  assert.match(source, /btn-toggle-confirmed-meta/);
  assert.doesNotMatch(source, /apply-field-return-evidence/);
  assert.doesNotMatch(source, /applyFieldReturnEvidenceByKey/);
  assert.doesNotMatch(source, /handleFieldReturnEvidencePanelClick/);
  assert.doesNotMatch(source, /fillField\("confirmed-/);
});
