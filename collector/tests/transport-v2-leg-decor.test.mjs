import { test } from "node:test";
import assert from "node:assert/strict";
import { offsetPolylineLeft, arrowPositions, arrowPolygonPoints, chevronPolylinePoints, arrowPositionsInRect } from "../server/public/transport-v2-leg-decor.js";

const BIG = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 };
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

test("offsetPolylineLeft: near-180 turn falls back to outgoing normal", () => {
  const out = offsetPolylineLeft([[0, 0], [10, 0], [0, 1e-5]], 4);
  pointsClose([out[1]], [[10, 4]], 1e-3);
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
  assert.ok(closeTo(arrows[0].x, 12.5, 1e-9), `first x: ${arrows[0].x} != 12.5`);
  assert.ok(closeTo(arrows[arrows.length - 1].x, 9987.5, 1e-9), `last x: ${arrows[arrows.length - 1].x} != 9987.5`);
});

test("arrowPositions: vertical direction reports 90 degrees", () => {
  const arrows = arrowPositions([[0, 0], [0, 100]], 22);
  assert.ok(closeTo(arrows[0].angleDeg, 90, 1e-9));
});

test("arrowPositions: path shorter than spacing yields no arrows", () => {
  assert.deepEqual(arrowPositions([[0, 0], [10, 0]], 22), []);
});

test("arrowPolygonPoints: tip and back corners for angle 0", () => {
  const pts = arrowPolygonPoints(0, 0, 0, 7, 3.5).split(" ").map((s) => s.split(",").map(Number));
  pointsClose(pts, [[7, 0], [-2.8, 3.5], [-2.8, -3.5]], 1e-9);
});

test("chevronPolylinePoints: angle 0 back/tip/back corners", () => {
  const pts = chevronPolylinePoints(0, 0, 0, 10, 5).split(" ").map((s) => s.split(",").map(Number));
  pointsClose(pts, [[-2.5, 5], [2.5, 0], [-2.5, -5]], 1e-9);
});

test("chevronPolylinePoints: angle 90 tip point", () => {
  const pts = chevronPolylinePoints(0, 0, 90, 10, 5).split(" ").map((s) => s.split(",").map(Number));
  pointsClose([pts[1]], [[0, 2.5]], 1e-9);
});

test("offsetPolylineLeft: zero offset returns a new array, not the original", () => {
  const input = [[0, 0], [10, 0]];
  const out = offsetPolylineLeft(input, 0);
  assert.deepEqual(out, [[0, 0], [10, 0]]);
  assert.notEqual(out, input);
  assert.notEqual(out[0], input[0]);
});

test("arrowPositionsInRect: unculled straight horizontal line matches arrowPositions", () => {
  const arrows = arrowPositionsInRect([[0, 0], [100, 0]], 22, BIG);
  const expectedX = [11, 33, 55, 77, 99];
  assert.equal(arrows.length, expectedX.length);
  arrows.forEach((a, i) => assert.ok(closeTo(a.x, expectedX[i], 1e-9), `x[${i}]: ${a.x} != ${expectedX[i]}`));
  for (const a of arrows) assert.ok(closeTo(a.angleDeg, 0, 1e-9));
});

test("arrowPositionsInRect: narrow rect keeps only the node inside it", () => {
  const arrows = arrowPositionsInRect([[0, 0], [100, 0]], 22, { x: 40, y: -1, w: 30, h: 2 });
  const expectedX = [55];
  assert.equal(arrows.length, expectedX.length);
  arrows.forEach((a, i) => assert.ok(closeTo(a.x, expectedX[i], 1e-9), `x[${i}]: ${a.x} != ${expectedX[i]}`));
});

test("arrowPositionsInRect: L-shaped polyline reports per-segment angles in order", () => {
  const arrows = arrowPositionsInRect([[0, 0], [10, 0], [10, 30]], 10, BIG);
  pointsClose(arrows.map((a) => [a.x, a.y]), [[5, 0], [10, 5], [10, 15], [10, 25]], 1e-9);
  assert.deepEqual(arrows.map((a) => a.angleDeg), [0, 90, 90, 90]);
});

test("arrowPositionsInRect: rect culls the first leg entirely, keeps matching nodes on the second", () => {
  const arrows = arrowPositionsInRect([[0, 0], [10, 0], [10, 30]], 10, { x: 9, y: 10, w: 2, h: 30 });
  pointsClose(arrows.map((a) => [a.x, a.y]), [[10, 15], [10, 25]], 1e-9);
});

test("arrowPositionsInRect: maxNodes caps output even with a tiny spacing", () => {
  const arrows = arrowPositionsInRect([[0, 0], [1000, 0]], 1, BIG, 3);
  assert.deepEqual(arrows.map((a) => a.x), [0.5, 1.5, 2.5]);
});
