import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("D:/UbonCity_Web/collector");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("article workspace html includes confirmed metadata editor fields", () => {
  const html = read("server/public/article-workspace.html");
  assert.match(html, /id="btn-toggle-confirmed-meta"/);
  assert.match(html, /id="confirmed-meta-section"/);
  assert.match(html, /id="confirmed-phone"/);
  assert.match(html, /id="confirmed-line-url"/);
  assert.match(html, /id="confirmed-facebook-url"/);
  assert.match(html, /id="confirmed-website-url"/);
  assert.match(html, /id="confirmed-primary-cta"/);
  assert.match(html, /id="confirmed-category"/);
  assert.match(html, /id="confirmed-subtype"/);
  assert.match(html, /id="confirmed-tags"/);
  assert.match(html, /id="confirmed-meta-status"/);
  assert.match(html, /id="confirmed-note"/);
  assert.match(html, /ลิงก์ LINE/);
  assert.match(html, /ลิงก์ Facebook/);
  assert.match(html, /ลิงก์เว็บไซต์/);
});

test("article workspace source wires confirmed metadata inputs with Thai labels", () => {
  const source = read("server/public/article-workspace-page.js");
  assert.match(source, /defaultConfirmedCtaContact/);
  assert.match(source, /defaultConfirmedTaxonomy/);
  assert.match(source, /renderConfirmedMetaVisibility/);
  assert.match(source, /btn-toggle-confirmed-meta/);
  assert.match(source, /confirmed-phone/);
  assert.match(source, /confirmed-meta-status/);
  assert.match(source, /normalizeCommaSeparatedTags/);
  assert.match(source, /\["confirmed-phone", "confirmed-line-url", "confirmed-facebook-url", "confirmed-website-url", "confirmed-category", "confirmed-subtype", "confirmed-note"\]/);
  assert.match(source, /\\u0e25\\u0e34\\u0e07\\u0e01\\u0e4c LINE/);
  assert.match(source, /\\u0e25\\u0e34\\u0e07\\u0e01\\u0e4c Facebook/);
  assert.match(source, /\\u0e25\\u0e34\\u0e07\\u0e01\\u0e4c\\u0e40\\u0e27\\u0e47\\u0e1a\\u0e44\\u0e0b\\u0e15\\u0e4c/);
});
