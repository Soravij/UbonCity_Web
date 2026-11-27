import assert from "node:assert/strict";
import test from "node:test";
import { LANDMARK_ICONS, glyphTransform, landmarkLayout, landmarkScale } from "../server/public/transport-map-viewer.js";

test("landmarkScale clamps between 1 and 2.5 following sqrt(zoom)", () => {
  assert.equal(landmarkScale(1), 1);
  assert.equal(landmarkScale(4), 2);
  assert.equal(landmarkScale(100), 2.5);
  assert.equal(landmarkScale(0.25), 1);
});

test("every LANDMARK_ICONS entry has usable geometry", () => {
  for (const [, icon] of Object.entries(LANDMARK_ICONS)) {
    assert.ok(icon.w > 0);
    assert.ok(icon.h > 0);
    assert.ok(icon.d.length > 20);
  }
});

test("landmarkLayout keeps icon-to-text distance proportional to font size across zoom levels", () => {
  const label = { x: 100, y: 50, category: "hospital" };
  const atZ1 = landmarkLayout(label, 0.5, 1);
  const atZ4 = landmarkLayout(label, 0.5, 4);
  assert.equal(atZ1.ty, 50);
  assert.equal(atZ4.ty, 50);
  assert.ok(atZ1.icon);
  assert.ok(atZ4.icon);
  const ratio1 = (atZ1.tx - 100) / atZ1.font;
  const ratio4 = (atZ4.tx - 100) / atZ4.font;
  assert.ok(Math.abs(ratio1 - ratio4) < 1e-9);
});

test("glyphTransform centers the icon's bounding box on the given point", () => {
  const icon = { w: 640, h: 512 };
  const size = 10;
  const transform = glyphTransform(icon, 100, 50, size);
  const m = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/);
  assert.ok(m);
  const [, tx, ty, s] = m.map(Number);
  assert.ok(Math.abs((tx + (icon.w * s) / 2) - 100) < 1e-9);
  assert.ok(Math.abs((ty + (icon.h * s) / 2) - 50) < 1e-9);
});

test("landmarkLayout: area category has no icon and centers the name on the point", () => {
  const L = landmarkLayout({ x: 100, y: 50, category: "area" }, 1, 1);
  assert.equal(L.icon, null);
  assert.equal(L.tx, 100);
  assert.equal(L.anchor, "middle");
});

test("landmarkLayout: unknown category falls back to a dot with no icon", () => {
  const L = landmarkLayout({ x: 100, y: 50, category: "unknown" }, 1, 1);
  assert.equal(L.icon, null);
  assert.ok(L.r > 0);
  assert.equal(L.anchor, "start");
});
