import assert from "node:assert/strict";
import test from "node:test";
import { buildLegSegments } from "../server/transport-v2-segments.mjs";

const TOL = 20;
const MIN_RUN = 30;

const line = (x0, y0, x1, y1, step = 10) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step;
  return Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
};
const out = line(0, 0, 300, 0);
const legs = (s) => s.map((x) => x.leg);

test("empty back -> single out segment, path unchanged", () => {
  const segs = buildLegSegments(out, [], TOL, MIN_RUN);
  assert.deepEqual(legs(segs), ["out"]);
  assert.deepEqual(segs[0].path, out);
});

test("back is reversed out -> fully shared", () => {
  const back = [...out].reverse();
  const segs = buildLegSegments(out, back, TOL, MIN_RUN);
  assert.deepEqual(legs(segs), ["both"]);
});

test("back diverges in the middle -> both/out/both/back", () => {
  const back = [
    ...line(300, 0, 200, 0),
    ...line(200, 10, 200, 100),
    ...line(190, 100, 100, 100),
    ...line(100, 90, 100, 0),
    ...line(90, 0, 0, 0),
  ];
  const segs = buildLegSegments(out, back, TOL, MIN_RUN);
  assert.deepEqual(legs(segs), ["both", "out", "both", "back"]);
});

test("short divergence below minRun is smoothed into shared", () => {
  const back = out.map(([x, y]) => (x === 150 ? [150, 25] : [x, y])).reverse();
  const segs = buildLegSegments(out, back, TOL, MIN_RUN);
  assert.deepEqual(legs(segs), ["both"]);
});

test("minRun larger than every run keeps the original split unsmoothed", () => {
  const back = [
    ...line(300, 0, 200, 0),
    ...line(200, 10, 200, 100),
    ...line(190, 100, 100, 100),
    ...line(100, 90, 100, 0),
    ...line(90, 0, 0, 0),
  ];
  const segs = buildLegSegments(out, back, TOL, 1000);
  assert.deepEqual(legs(segs), ["both", "out", "both", "back"]);
});
