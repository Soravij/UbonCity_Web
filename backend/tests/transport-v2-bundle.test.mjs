import test from "node:test";
import assert from "node:assert/strict";
import { validateTransportBundle, requiredBundleFiles, attachBundleFileUrls } from "../services/transportV2Bundle.js";

const valid = () => ({
  schema_version: 1, map_key: "ubon-city", title: "Ubon City", revision: 1731200000000,
  viewbox: { x: 0, y: 0, width: 4000, height: 5600 }, base_svg: "base.svg",
  labels: [{ key: "l1", category: "landmark", x: 10, y: 20, priority: 1, texts: { th: "ทุ่งศรีเมือง", en: "Thung Si Mueang" } }],
  overlays: [{ id: "o1", file: "overlay-o1.png", x: 1, y: 2, width: 30, height: 30 }],
  routes: [{ id: 7, number: "2", name: "สาย 2", vehicle_type: "songthaew", color: "#ff6600",
    path: [[0, 0], [100, 100]], stops: [{ order: 1, name: "ตลาดใหญ่", x: 5, y: 5 }] }],
});

test("valid bundle passes", () => assert.deepEqual(validateTransportBundle(valid()), { ok: true, errors: [] }));
test("rejects path traversal file names", () => {
  const b = valid(); b.base_svg = "../x.svg";
  assert.equal(validateTransportBundle(b).ok, false);
  const c = valid(); c.overlays[0].file = "a/b.png";
  assert.equal(validateTransportBundle(c).ok, false);
});
test("rejects label without th text", () => {
  const b = valid(); b.labels[0].texts = { en: "only en" };
  assert.deepEqual(validateTransportBundle(b).errors, ["labels[0] invalid"]);
});
test("rejects duplicate route id and short path", () => {
  const b = valid(); b.routes.push({ ...b.routes[0] });
  assert.ok(validateTransportBundle(b).errors.includes("routes[1] invalid"));
  const c = valid(); c.routes[0].path = [[0, 0]];
  assert.ok(validateTransportBundle(c).errors.includes("routes[0] invalid"));
});
test("required files and url attach", () => {
  const b = valid();
  assert.deepEqual(requiredBundleFiles(b), ["base.svg", "overlay-o1.png"]);
  const out = attachBundleFileUrls(b, (n) => `/uploads/x/${n}`);
  assert.equal(out.base_svg_url, "/uploads/x/base.svg");
  assert.equal(out.overlays[0].url, "/uploads/x/overlay-o1.png");
});
