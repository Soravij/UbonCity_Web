import test from "node:test";
import assert from "node:assert/strict";
import * as viewer from "../server/public/transport-map-viewer.js";
import * as decor from "../server/public/transport-v2-leg-decor.js";

const { routeBandSpecs, routeBandPx } = viewer;

test("out_back segments: both centred no chevrons; out/back offset + chevrons; short segs dropped", () => {
  const specs = routeBandSpecs({ path: [[0, 0], [9, 9]], segments: [
    { leg: "both", path: [[0, 0], [1, 0]] },
    { leg: "out", path: [[1, 0], [2, 0]] },
    { leg: "back", path: [[2, 0], [1, 1]] },
    { leg: "out", path: [[5, 5]] },
  ] });
  assert.deepEqual(specs.map((s) => [s.offset, s.chevrons]), [[false, false], [true, true], [true, true]]);
});

test("no segments: route.path offset left with chevrons", () => {
  const path = [[0, 0], [3, 4]];
  assert.deepEqual(routeBandSpecs({ path }), [{ path, offset: true, chevrons: true }]);
  assert.deepEqual(routeBandSpecs({ path, segments: [] }), [{ path, offset: true, chevrons: true }]);
});

test("no drawable path → []", () => {
  assert.deepEqual(routeBandSpecs({ path: [[1, 1]] }), []);
  assert.deepEqual(routeBandSpecs(null), []);
});

test("routeBandPx clamps 3..14 and scales with sqrt(zoom)", () => {
  assert.equal(routeBandPx(0.5), 3.5);
  assert.equal(routeBandPx(1), 3.5);
  assert.equal(routeBandPx(4), 7);
  assert.equal(routeBandPx(100), 14);
});

test("leg-decor re-exports the viewer's geometry", () => {
  assert.equal(decor.offsetPolylineLeft, viewer.offsetPolylineLeft);
  assert.equal(decor.chevronPolylinePoints, viewer.chevronPolylinePoints);
  assert.equal(decor.arrowPositionsInRect, viewer.arrowPositionsInRect);
});

test("offsetPolylineLeft splits an in-and-back spur onto opposite sides", () => {
  assert.deepEqual(viewer.offsetPolylineLeft([[0, 0], [0, 10], [0, 0]], 2), [[2, 0], [-2, 10], [-2, 0]]);
});

test("chevronPolygonPoints builds a solid chevron stripe", () => {
  assert.equal(viewer.chevronPolygonPoints(0, 0, 0, 2, 1, 0.5), "-0.25,1 0.75,0 -0.25,-1 -0.75,-1 0.25,0 -0.75,1");
});
