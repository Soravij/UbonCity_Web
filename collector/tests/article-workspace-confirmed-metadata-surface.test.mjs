import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("D:/UbonCity_Web/collector");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("article workspace html includes compact confirmed metadata card", () => {
  const html = read("server/public/article-workspace.html");
  assert.match(html, /id="confirmed-meta-section"/);
  assert.match(html, /ช่องทางติดต่อและข้อมูลคัดกรอง/);
  assert.match(html, /id="confirmed-phone"/);
  assert.match(html, /id="confirmed-line-url"/);
  assert.match(html, /id="confirmed-facebook-url"/);
  assert.match(html, /id="confirmed-website-url"/);
  assert.match(html, /id="confirmed-primary-cta"/);
  assert.match(html, /id="confirmed-taxonomy-summary"/);
  assert.doesNotMatch(html, /id="btn-toggle-confirmed-meta"/);
  assert.doesNotMatch(html, /id="confirmed-category"/);
  assert.doesNotMatch(html, /id="confirmed-subtype"/);
  assert.doesNotMatch(html, /id="confirmed-tags"/);
  assert.doesNotMatch(html, /id="confirmed-meta-status"/);
  assert.doesNotMatch(html, /id="confirmed-note"/);
});

test("article workspace source wires compact confirmed metadata rendering", () => {
  const source = read("server/public/article-workspace-page.js");
  assert.match(source, /defaultConfirmedCtaContact/);
  assert.match(source, /defaultConfirmedTaxonomy/);
  assert.match(source, /renderConfirmedMetaSummary/);
  assert.match(source, /renderFieldReturnCompactValue/);
  assert.match(source, /confirmed-taxonomy-summary/);
  assert.match(source, /fieldReturnEvidence/);
  assert.match(source, /return "—";/);
});
