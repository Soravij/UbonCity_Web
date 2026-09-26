import assert from "node:assert/strict";
import test from "node:test";

import { collectFromGoogleMapsPayload } from "../collector/sources/adapters/google-maps.mjs";

const CENTER = { lat: 15.2447, lng: 104.8472 };

function place(id, latitude, longitude) {
  const p = { id, displayName: { text: `Place ${id}` }, formattedAddress: "addr" };
  if (latitude != null) p.location = { latitude, longitude };
  return p;
}

async function run(places, extraPayload) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const detailCalls = [];
  const searchBodies = [];
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith("places:searchText")) {
      searchBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ places }) };
    }
    detailCalls.push(href);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const items = await collectFromGoogleMapsPayload({
      api_key: "test-key",
      query: "cafe",
      location: CENTER,
      radius: 5000,
      ...extraPayload,
    });
    return { items, detailCalls, searchBodies, warnings };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

test("places outside radius are dropped before place details are fetched", async () => {
  const { items, detailCalls, searchBodies, warnings } = await run([
    place("near", 15.2450, 104.8475), // ~50 m
    place("far", 15.3447, 104.8472), // ~11 km
    place("nogeo", null),
  ]);

  assert.equal(searchBodies[0].locationBias.circle.radius, 5000);
  assert.equal(items.length, 1);
  assert.match(items[0].normalized_json.title, /Place near/);
  assert.equal(detailCalls.length, 1);
  assert.match(detailCalls[0], /near/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /nogeo/);
});

test("no filtering when radius is not set", async () => {
  const { items } = await run([place("a", 15.2450, 104.8475), place("b", 16.5, 104.8472)], { radius: 0 });
  assert.equal(items.length, 2);
});
