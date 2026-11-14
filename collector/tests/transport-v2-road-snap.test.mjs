import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePathD, buildRoadIndex, nearestOnRoads } from "../server/public/transport-v2-road-snap.js";

test("parsePathD handles absolute M/L", () => {
  assert.deepEqual(parsePathD("M0 0L10 0L10 10"), [[[0, 0], [10, 0], [10, 10]]]);
});

test("parsePathD handles relative l/h/v", () => {
  assert.deepEqual(parsePathD("m1,1l2,0h3v-1"), [[[1, 1], [3, 1], [6, 1], [6, 0]]]);
});

test("parsePathD splits multiple subpaths", () => {
  const lines = parsePathD("M0 0L1 0M5 5L6 5");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines, [[[0, 0], [1, 0]], [[5, 5], [6, 5]]]);
});

test("parsePathD handles compact decimals and negatives", () => {
  assert.deepEqual(parsePathD("M1.5.5L2-1"), [[[1.5, 0.5], [2, -1]]]);
});

test("nearestOnRoads finds nearest point within range", () => {
  const index = buildRoadIndex([[[0, 0], [100, 0]]], 10);
  const hit = nearestOnRoads(index, 50, 3, 5);
  assert.equal(hit.x, 50);
  assert.equal(hit.y, 0);
});

test("nearestOnRoads returns null outside maxDist", () => {
  const index = buildRoadIndex([[[0, 0], [100, 0]]], 10);
  assert.equal(nearestOnRoads(index, 50, 8, 5), null);
});

test("nearestOnRoads works across multiple grid cells", () => {
  const index = buildRoadIndex([[[0, 0], [100, 0]]], 10);
  const hit = nearestOnRoads(index, 95, -2, 5);
  assert.equal(hit.x, 95);
});
