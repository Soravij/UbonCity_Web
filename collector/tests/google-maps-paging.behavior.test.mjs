import assert from "node:assert/strict";
import test from "node:test";

import { collectFromGoogleMapsPayload } from "../collector/sources/adapters/google-maps.mjs";

function makePlaces(from, count) {
  return Array.from({ length: count }, (_, i) => {
    const id = `p${from + i}`;
    return { id, displayName: { text: `Place ${id}` }, formattedAddress: "addr" };
  });
}

// pages: ordered searchText responses; each is { status, body }.
async function run(pages, extraPayload) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const searchBodies = [];
  console.warn = () => {};
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith("places:searchText")) {
      searchBodies.push(JSON.parse(init.body));
      const page = pages[searchBodies.length - 1] || { status: 200, body: {} };
      return {
        ok: page.status >= 200 && page.status < 300,
        status: page.status,
        statusText: page.status === 500 ? "Internal Server Error" : "OK",
        json: async () => page.body,
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const items = await collectFromGoogleMapsPayload({
      api_key: "test-key",
      query: "cafe",
      radius: 0,
      ...extraPayload,
    });
    return { items, searchBodies };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

test("follows nextPageToken until no token is returned", async () => {
  const { items, searchBodies } = await run(
    [
      { status: 200, body: { places: makePlaces(1, 20), nextPageToken: "t1" } },
      { status: 200, body: { places: makePlaces(21, 5) } },
    ],
    { max_results_per_query: 60 }
  );

  assert.equal(items.length, 25);
  assert.equal(searchBodies.length, 2);
  assert.equal(searchBodies[0].pageToken, undefined);
  assert.equal(searchBodies[1].pageToken, "t1");
  assert.equal(searchBodies[1].pageSize, 20);
});

test("does not fetch a second page when the first already satisfies the limit", async () => {
  const { items, searchBodies } = await run(
    [{ status: 200, body: { places: makePlaces(1, 20), nextPageToken: "t1" } }],
    { max_results_per_query: 20 }
  );

  assert.equal(items.length, 20);
  assert.equal(searchBodies.length, 1);
});

test("a failing later page keeps results already collected", async () => {
  const { items, searchBodies } = await run(
    [
      { status: 200, body: { places: makePlaces(1, 20), nextPageToken: "t1" } },
      { status: 500, body: { error: { message: "boom" } } },
    ],
    { max_results_per_query: 60 }
  );

  assert.equal(items.length, 20);
  assert.equal(searchBodies.length, 2);
});

test("a failing first page throws", async () => {
  await assert.rejects(
    run([{ status: 500, body: { error: { message: "boom" } } }], { max_results_per_query: 60 }),
    /Google Places \(New\) error/
  );
});
