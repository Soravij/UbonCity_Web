import assert from "node:assert/strict";
import test from "node:test";
import { pickLeastUsed, pathsNear, pickForPath } from "../server/public/transport-v2-palette.js";

const A = [{ lat: 15.24, lng: 104.85 }, { lat: 15.25, lng: 104.86 }];
const B = [{ lat: 15.2409, lng: 104.85 }, { lat: 15.2509, lng: 104.86 }];
const C = [{ lat: 15.10, lng: 104.70 }, { lat: 15.11, lng: 104.71 }];

test("pickLeastUsed: returns next unused color in palette order", () => {
  assert.equal(pickLeastUsed([]), "#1d4ed8");
  assert.equal(pickLeastUsed(["#1d4ed8"]), "#c2410c");
  assert.equal(pickLeastUsed(["#1D4ED8", "#c2410c"]), "#047857");
});

test("pathsNear: detects near-coincident paths, rejects distant ones", () => {
  assert.equal(pathsNear(A, B), true);
  assert.equal(pathsNear(A, C), false);
});

test("pickForPath: avoids colors in use on nearby paths, otherwise least-used", () => {
  assert.notEqual(pickForPath(A, [{ color: "#1d4ed8", path: B }]), "#1d4ed8");
  assert.equal(pickForPath(A, [{ color: "#1d4ed8", path: C }]), "#c2410c");
});
