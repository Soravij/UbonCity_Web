import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const router = read("../server/transport-v2-router.mjs");
test("v2 router: every endpoint is owner-only", () => {
  const all = [...router.matchAll(/router\.(get|post|put|patch|delete)\(/g)];
  const calls = [...router.matchAll(/router\.(get|post|put|patch|delete)\([^,]+,\s*allow\(([^)]*)\)/g)];
  assert.equal(all.length, 24);
  assert.equal(calls.length, all.length);
  for (const m of calls) assert.equal(m[2].trim(), '"owner"', m[0]);
});
test("v2 router: render-poster removed", () => {
  assert.ok(!router.includes("render-poster"));
});
test("v2 pages: owner-only", () => {
  for (const f of ["path-editor-page", "routes-review-page", "review-page", "routes-page", "base-maps-page"]) {
    const src = read(`../server/public/transport-v2-${f}.js`);
    assert.match(src, /allowRoles:\s*\[\s*"owner"\s*\]/, f);
    assert.ok(!/allowRoles:\s*\[[^\]]*"admin"/.test(src), f);
    assert.ok(!src.includes("redirectFor"), f);
  }
});

test("transport hub: v2 button owner-only", () => {
  const html = read("../server/public/transport.html");
  assert.match(html, /id="btn-open-transport-map-manager" class="primary hidden"/);
  const js = read("../server/public/transport-page.js");
  assert.match(js, /if \(role === "owner"\) \{[^}]*btn-open-transport-map-manager[^}]*\}/s);
});
