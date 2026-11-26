import test from "node:test";
import assert from "node:assert/strict";
import { buildLegSegments } from "../server/transport-v2-segments.mjs";

const out = [[0, 0], [10, 0], [20, 0], [30, 0]];

test("back run ends are pinned onto the out line", () => {
  const back = [[30, 1], [20, 1], [20, 10], [10, 10], [10, 1], [0, 1]];
  const segs = buildLegSegments(out, back, 2, 0.5);
  assert.deepEqual(segs, [
    { leg: "both", path: out },
    { leg: "back", path: [[20, 0], [20, 10], [10, 10], [10, 0]] },
  ]);
});

test("back run that ends the route keeps its free end", () => {
  const back = [[30, 1], [20, 1], [20, 10]];
  const segs = buildLegSegments(out, back, 2, 0);
  assert.deepEqual(segs.filter((s) => s.leg === "back"), [{ leg: "back", path: [[20, 0], [20, 10]] }]);
});
