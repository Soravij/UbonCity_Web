import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const router = read("../server/transport-v2-router.mjs");
test("v2 router: every endpoint is owner-only", () => {
  const all = [...router.matchAll(/router\.(get|post|put|patch|delete)\(/g)];
  const calls = [...router.matchAll(/router\.(get|post|put|patch|delete)\([^,]+,\s*allow\(([^)]*)\)/g)];
  assert.equal(all.length, 29);
  assert.equal(calls.length, all.length);
  for (const m of calls) assert.equal(m[2].trim(), '"owner"', m[0]);
});
test("v2 router: render-poster removed", () => {
  assert.ok(!router.includes("render-poster"));
});
test("v2 pages: owner-only", () => {
  for (const f of ["path-editor-page", "routes-review-page", "review-page", "routes-page", "base-maps-page", "preview-page", "landmarks-page"]) {
    const src = read(`../server/public/transport-v2-${f}.js`);
    assert.match(src, /allowRoles:\s*\[\s*"owner"\s*\]/, f);
    assert.ok(!/allowRoles:\s*\[[^\]]*"admin"/.test(src), f);
    assert.ok(!src.includes("redirectFor"), f);
  }
});

test("transport hub: v2 steps owner-only", () => {
  const html = read("../server/public/transport.html");
  const js = read("../server/public/transport-page.js");
  assert.match(html, /<ol class="transport-steps hidden" id="transport-steps">/);
  for (const href of ["/transport-v2-base-maps.html", "/transport-v2-routes.html", "/transport-v2-preview.html"]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  assert.match(js, /currentRole\(user\) === "owner"[\s\S]*transport-steps/);
});

test("routes page: no render-published / routes-review entry points; preview reachable", () => {
  const html = read("../server/public/transport-v2-routes.html");
  assert.ok(!html.includes("btn-render-published-map"));
  assert.ok(!html.includes("btn-open-routes-review"));
  assert.ok(!html.includes("btn-open-selected-review"));
  assert.match(html, /id="btn-open-preview"/);
  assert.equal((html.match(/btn-home/g) || []).length, 1);
  const js = read("../server/public/transport-v2-routes-page.js");
  assert.ok(!js.includes("render-published"));
  assert.ok(!js.includes("annotation_map_url"));
});
test("home transport button enabled", () => {
  const html = read("../server/public/index.html");
  assert.match(html, /<button id="btn-home-transport" class="primary" type="button">/);
  assert.ok(!html.includes("ยังไม่เปิดใช้ในเวอร์ชันนี้"));
});

test("path editor page uses the shared viewer, not the old editor module", () => {
  const js = read("../server/public/transport-v2-path-editor-page.js");
  assert.match(js, /from "\.\/transport-map-viewer\.js"/);
  assert.ok(!js.includes("transport-v2-path-editor.js"));
  const html = read("../server/public/transport-v2-path-editor.html");
  assert.equal((html.match(/btn-home/g) || []).length, 1);
});
