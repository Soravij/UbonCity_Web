import assert from "node:assert/strict";
import test from "node:test";
import { bearingOf, buildBearings, detourWarnings, hasBearings, fetchRouteWithFallback } from "../server/transport-v2-osrm.mjs";

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const next = responses[calls.length - 1];
    if (next.throw) throw next.throw;
    return {
      ok: next.ok,
      json: async () => {
        if (next.jsonThrow) throw new Error("bad json");
        return next.body;
      },
    };
  };
  return { fetchImpl, calls };
}

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

test("hasBearings: detects at least one non-empty bearing segment", () => {
  assert.equal(hasBearings(";"), false);
  assert.equal(hasBearings("90,60;"), true);
});

test("bearingOf: rounds below 360 instead of wrapping to it", () => {
  assert.ok(bearingOf({ lat: 0, lng: 0 }, { lat: 1, lng: -0.0000001 }) < 360);
});

test("fetchRouteWithFallback: network error on bearings attempt falls back without bearings", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { throw: new Error("network down") },
    { ok: true, body: { code: "Ok" } },
  ]);
  const r = await fetchRouteWithFallback("http://osrm/route", "90,60;90,60", { fetchImpl });
  assert.equal(r.bearingsUsed, false);
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].includes("bearings="));
});

test("fetchRouteWithFallback: bearings attempt succeeds on first try", async () => {
  const { fetchImpl, calls } = fakeFetch([{ ok: true, body: { code: "Ok" } }]);
  const r = await fetchRouteWithFallback("http://osrm/route", "90,60;90,60", { fetchImpl });
  assert.equal(r.bearingsUsed, true);
  assert.equal(calls.length, 1);
});

test("fetchRouteWithFallback: OSRM code other than Ok triggers fallback", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { ok: true, body: { code: "NoSegment" } },
    { ok: true, body: { code: "Ok" } },
  ]);
  const r = await fetchRouteWithFallback("http://osrm/route", "90,60;90,60", { fetchImpl });
  assert.equal(r.bearingsUsed, false);
  assert.equal(calls.length, 2);
});

test("fetchRouteWithFallback: unreadable body on both attempts reports parseError", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { ok: true, jsonThrow: true },
    { ok: true, jsonThrow: true },
  ]);
  const r = await fetchRouteWithFallback("http://osrm/route", "90,60;90,60", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.parseError, true);
  assert.equal(calls.length, 2);
});

test("fetchRouteWithFallback: all-empty bearings string skips the bearings attempt", async () => {
  const { fetchImpl, calls } = fakeFetch([{ ok: true, body: { code: "Ok" } }]);
  const r = await fetchRouteWithFallback("http://osrm/route", ";", { fetchImpl });
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes("bearings="));
});
