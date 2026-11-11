import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { baseStrokeScale, clampView, latLngToViewbox, viewboxToLatLng, viewForBounds, zoomAt, zoomLevel } from "../server/public/transport-map-viewer.js";
import { projectToViewbox } from "../server/transport-v2-publish.mjs";

const bounds = { min_lat: 15.1083, min_lng: 104.8068, max_lat: 15.3117, max_lng: 104.972 };
const full = { x: 0, y: 0, width: 4000, height: 5600 };
const fullView = { x: 0, y: 0, w: 4000, h: 5600 };

test("projection round-trips and matches the publish builder", () => {
  const [x, y] = latLngToViewbox(15.24, 104.85, bounds, full);
  const back = viewboxToLatLng(x, y, bounds, full);
  assert.ok(Math.abs(back.lat - 15.24) < 1e-9 && Math.abs(back.lng - 104.85) < 1e-9);
  const [bx, by] = projectToViewbox(15.24, 104.85, bounds, full);
  assert.ok(Math.abs(bx - x) <= 0.05 && Math.abs(by - y) <= 0.05);
});

test("zoomAt keeps the anchor point and doubles zoom", () => {
  const v = zoomAt(fullView, full, 2, 2000, 2800);
  assert.deepEqual(v, { x: 1000, y: 1400, w: 2000, h: 2800 });
  assert.equal(zoomLevel(v, full), 2);
});

test("clampView limits zoom range and keeps the view inside the map", () => {
  const v = clampView({ x: -500, y: 9999, w: 10, h: 14 }, full);
  assert.ok(Math.abs(v.w - 4000 / 40) < 1e-9);
  assert.equal(v.x, 0);
  assert.ok(Math.abs(v.y + v.h - 5600) < 1e-9);
  assert.deepEqual(clampView({ x: 10, y: 10, w: 99999, h: 1 }, full), fullView);
});

test("viewForBounds centers a short route after clamping to max zoom", () => {
  const v = viewForBounds({ minX: 1998, minY: 2798, maxX: 2002, maxY: 2802 }, full);
  assert.ok(Math.abs(v.w - 4000 / 40) < 1e-9);
  assert.ok(Math.abs(v.x + v.w / 2 - 2000) < 1e-9);
  assert.ok(Math.abs(v.y + v.h / 2 - 2800) < 1e-9);
});

test("frontend copy is byte-identical", () => {
  const a = fs.readFileSync(new URL("../server/public/transport-map-viewer.js", import.meta.url));
  const b = fs.readFileSync(new URL("../../frontend/lib/transportMapViewer.js", import.meta.url));
  assert.ok(a.equals(b));
});

test("baseStrokeScale grows with zoom and caps at 8x", () => {
  assert.equal(baseStrokeScale(1), 1);
  assert.equal(baseStrokeScale(0.5), 1);
  assert.equal(baseStrokeScale(100), baseStrokeScale(32));
  assert.ok(baseStrokeScale(4) > 1 && baseStrokeScale(4) < 4);
});
