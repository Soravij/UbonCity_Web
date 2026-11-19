import { test } from "node:test";
import assert from "node:assert/strict";
import { offsetPolylineLeft, arrowPositions, arrowPolygonPoints } from "../server/public/transport-v2-leg-decor.js";

const closeTo = (a, b, eps) => Math.abs(a - b) <= eps;
const pointsClose = (pts, expected, eps) => {
  assert.equal(pts.length, expected.length);
  pts.forEach((p, i) => {
    assert.ok(closeTo(p[0], expected[i][0], eps), `x[${i}]: ${p[0]} != ${expected[i][0]}`);
    assert.ok(closeTo(p[1], expected[i][1], eps), `y[${i}]: ${p[1]} != ${expected[i][1]}`);
  });
};

test("offsetPolylineLeft: straight horizontal segment offsets up (-y)", () => {
  pointsClose(offsetPolylineLeft([[0, 0], [10, 0]], 4), [[0, -4], [10, -4]], 1e-9);
});

test("offsetPolylineLeft: straight vertical segment offsets -x for all points", () => {
  const out = offsetPolylineLeft([[0, 10], [0, 0]], 4);
  for (const p of out) assert.ok(closeTo(p[0], -4, 1e-9));
});

test("offsetPolylineLeft: corner vertex uses averaged normal", () => {
  const out = offsetPolylineLeft([[0, 0], [10, 0], [10, 10]], 4);
  pointsClose([out[1]], [[10 + 2.8284271, -2.8284271]], 1e-6);
});

test("offsetPolylineLeft: degenerate duplicate leading point falls back to next valid normal", () => {
  const out = offsetPolylineLeft([[0, 0], [0, 0], [10, 0]], 4);
  for (const p of out) assert.ok(closeTo(p[1], -4, 1e-9));
});

test("offsetPolylineLeft: single point and empty input pass through unchanged", () => {
  assert.deepEqual(offsetPolylineLeft([[1, 2]], 4), [[1, 2]]);
  assert.deepEqual(offsetPolylineLeft([], 4), []);
});

test("arrowPositions: evenly spaced along a straight horizontal line", () => {
  const arrows = arrowPositions([[0, 0], [100, 0]], 22);
  const expectedX = [11, 33, 55, 77, 99];
  assert.equal(arrows.length, expectedX.length);
  arrows.forEach((a, i) => assert.ok(closeTo(a.x, expectedX[i], 1e-9), `x[${i}]: ${a.x} != ${expectedX[i]}`));
  for (const a of arrows) assert.ok(closeTo(a.angleDeg, 0, 1e-9));
});

test("arrowPositions: count is capped for pathologically small spacing", () => {
  const arrows = arrowPositions([[0, 0], [10000, 0]], 1);
  assert.equal(arrows.length, 400);
});

test("arrowPositions: vertical direction reports 90 degrees", () => {
  const arrows = arrowPositions([[0, 0], [0, 10]], 22);
  assert.ok(closeTo(arrows[0].angleDeg, 90, 1e-9));
});

test("arrowPolygonPoints: tip and back corners for angle 0", () => {
  const pts = arrowPolygonPoints(0, 0, 0, 7, 3.5).split(" ").map((s) => s.split(",").map(Number));
  pointsClose(pts, [[7, 0], [-2.8, 3.5], [-2.8, -3.5]], 1e-9);
});
