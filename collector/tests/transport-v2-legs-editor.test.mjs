import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLegPoints, legRange, splitPathAtTurn, buildBackFromOut, activeStopIndexes } from "../server/public/transport-v2-legs-editor.js";

const P = (lat, leg, extra = {}) => ({ lat, lng: 0, ...(leg ? { leg } : {}), ...extra });

test("normalizeLegPoints: out_back orders out first, null -> out; loop strips leg keeps label", () => {
  assert.deepEqual(normalizeLegPoints([P(1, "back"), P(2), P(3, "out")], "out_back").map((p) => [p.lat, p.leg]), [[2, "out"], [3, "out"], [1, "back"]]);
  assert.deepEqual(normalizeLegPoints([P(1, "out", { label: "x" })], "loop"), [{ lat: 1, lng: 0, label: "x" }]);
});

test("legRange: out/back ranges; loop = whole array", () => {
  const pts = [P(1, "out"), P(2, "out"), P(3, "back")];
  assert.deepEqual(legRange(pts, "out_back", "out"), { start: 0, end: 2 });
  assert.deepEqual(legRange(pts, "out_back", "back"), { start: 2, end: 3 });
  assert.deepEqual(legRange(pts, "loop", "back"), { start: 0, end: 3 });
});

test("splitPathAtTurn: cuts at turnaround, shared vertex; no turn -> all out", () => {
  const path = [[0, 0], [1, 0], [2, 0], [1, 0.1], [0, 0.1]];
  const s = splitPathAtTurn(path, [2, 0]);
  assert.deepEqual(s.out, [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(s.back, [[2, 0], [1, 0.1], [0, 0.1]]);
  assert.deepEqual(splitPathAtTurn(path, null).back, []);
});

test("buildBackFromOut: reverse out without turnaround, ignores old back", () => {
  assert.deepEqual(buildBackFromOut([P(1, "out"), P(2, "out"), P(3, "out"), P(9, "back")]).map((p) => [p.lat, p.leg]), [[2, "back"], [1, "back"]]);
  assert.deepEqual(buildBackFromOut([P(1, "out")]), []);
  assert.deepEqual(buildBackFromOut([P(1, "out", { label: "A", note: "n" }), P(2, "out")]), [{ lat: 1, lng: 0, leg: "back", label: "A", note: "n" }]);
});

test("activeStopIndexes: null-leg stop active in both legs; loop = all", () => {
  assert.deepEqual(activeStopIndexes([{ leg: "out" }, {}, { leg: "back" }], "out_back", "back"), [1, 2]);
  assert.deepEqual(activeStopIndexes([{ leg: "out" }, { leg: "back" }], "loop", "back"), [0, 1]);
});
