import assert from "node:assert/strict";
import test from "node:test";
import { bearingOf, buildBearings, detourWarnings } from "../server/transport-v2-osrm.mjs";

test("bearingOf: north and east", () => {
  assert.equal(bearingOf({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 0);
  assert.equal(bearingOf({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 90);
});

test("buildBearings: joins per-point bearing,range strings", () => {
  assert.equal(
    buildBearings([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0, lng: 0.02 }]),
    "90,60;90,60;90,60",
  );
});

test("buildBearings: identical consecutive points yield empty segments", () => {
  assert.equal(buildBearings([{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }]), ";");
});

test("detourWarnings: flags a leg far longer than the straight-line distance", () => {
  const out = detourWarnings([{ distance: 1000 }], [{ location: [0, 0] }, { location: [0, 0.001] }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].ratio > 8);
});

test("detourWarnings: ignores a leg close to the straight-line distance", () => {
  const out = detourWarnings([{ distance: 120 }], [{ location: [0, 0] }, { location: [0, 0.001] }]);
  assert.equal(out.length, 0);
});
