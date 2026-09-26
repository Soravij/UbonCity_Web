import assert from "node:assert/strict";
import test from "node:test";

import { resolveTextQueryLocation, resolveMapsShortLink } from "../collector/sources/adapters/google-maps.mjs";

async function withFetch(mock, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function redirectResponse(location) {
  return { ok: false, status: 302, headers: new Headers({ location }), json: async () => ({}) };
}

test("resolveTextQueryLocation returns lat/lng from first place", async () => {
  const calls = [];
  const result = await withFetch(async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => ({ places: [{ location: { latitude: 15.24, longitude: 104.85 } }] }) };
  }, () => resolveTextQueryLocation("7Q6R+X2 อุบลราชธานี", "test-key"));
  assert.deepEqual(result, { lat: 15.24, lng: 104.85 });
  assert.match(calls[0].url, /places:searchText$/);
  assert.equal(calls[0].body.textQuery, "7Q6R+X2 อุบลราชธานี");
  assert.equal(calls[0].headers["X-Goog-FieldMask"], "places.location");
});

test("resolveTextQueryLocation returns null when no places", async () => {
  const result = await withFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ places: [] }) }),
    () => resolveTextQueryLocation("nowhere", "test-key"),
  );
  assert.equal(result, null);
});

test("resolveMapsShortLink follows maps.app.goo.gl redirect to google.com URL", async () => {
  const calls = [];
  const target = "https://www.google.com/maps/place/X/@1,2,17z";
  const result = await withFetch(async (url, init = {}) => {
    calls.push({ url: String(url), redirect: init.redirect });
    return redirectResponse(target);
  }, () => resolveMapsShortLink("https://maps.app.goo.gl/abc123"));
  assert.equal(result, target);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, "manual");
});

test("resolveMapsShortLink rejects redirect to a non-allowed host", async () => {
  await withFetch(
    async () => redirectResponse("https://evil.example.com/x"),
    async () => {
      await assert.rejects(() => resolveMapsShortLink("https://maps.app.goo.gl/abc123"), /host_not_allowed/);
    },
  );
});

test("resolveMapsShortLink rejects non-https input without fetching", async () => {
  let fetched = 0;
  await withFetch(
    async () => { fetched += 1; return redirectResponse("https://www.google.com/maps"); },
    async () => {
      await assert.rejects(() => resolveMapsShortLink("http://maps.app.goo.gl/x"), /host_not_allowed/);
    },
  );
  assert.equal(fetched, 0);
});

test("resolveMapsShortLink throws too_many_redirects on redirect loop", async () => {
  let fetched = 0;
  await withFetch(
    async () => { fetched += 1; return redirectResponse("https://maps.app.goo.gl/loop"); },
    async () => {
      await assert.rejects(() => resolveMapsShortLink("https://maps.app.goo.gl/loop"), /too_many_redirects/);
    },
  );
  assert.equal(fetched, 5);
});
