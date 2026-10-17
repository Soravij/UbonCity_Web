import assert from "node:assert/strict";
import test from "node:test";

import { collectFromGoogleMapsPayload } from "../collector/sources/adapters/google-maps.mjs";

// searchResponses: ordered searchText bodies; failDetailIds: place ids whose details fetch rejects.
async function run(searchResponses, adapterOptions, failDetailIds = [], emptyDetailIds = []) {
  const originalFetch = globalThis.fetch;
  const searchMasks = [];
  const detailIds = [];
  let searchCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith("places:searchText")) {
      searchMasks.push(init.headers["X-Goog-FieldMask"]);
      const body = searchResponses[searchCount++] || {};
      return { ok: true, status: 200, json: async () => body };
    }
    const id = href.split("/places/")[1].split("?")[0];
    detailIds.push(id);
    if (failDetailIds.includes(id)) throw new Error("network down");
    if (emptyDetailIds.includes(id)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ id, displayName: { text: `Place ${id}` }, formattedAddress: "addr" }) };
  };
  try {
    const items = await collectFromGoogleMapsPayload(
      { api_key: "test-key", queries: ["q1", "q2"], radius: 0 },
      adapterOptions
    );
    return { items, searchMasks, detailIds };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const ids = (...list) => ({ places: list.map((id) => ({ id })) });

test("searchText always requests the id-only field mask", async () => {
  const { searchMasks } = await run([ids("A"), ids("B")], {});
  assert.deepEqual(searchMasks, ["places.id,nextPageToken", "places.id,nextPageToken"]);
});

test("overlapping and known ids are not sent to place details", async () => {
  const { items, detailIds } = await run([ids("A", "B"), ids("B", "C")], { isKnownPlaceId: (id) => id === "C" });
  assert.deepEqual(detailIds, ["A", "B"]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.collect_stats, {
    search_ids: 4,
    skipped_duplicate: 1,
    skipped_known: 1,
    details_called: 2,
    details_failed: 0,
  });
});

test("a throwing place details call is counted and does not fail the request", async () => {
  const { items, detailIds } = await run([ids("A", "B"), ids()], {}, ["A"]);
  assert.deepEqual(detailIds, ["A", "B"]);
  assert.equal(items.length, 1);
  assert.equal(items.collect_stats.details_failed, 1);
  assert.equal(items.collect_stats.details_called, 1);
});

test("a non-OK place details response drops the row and counts as failed", async () => {
  const { items, detailIds } = await run([ids("A", "B"), ids()], {}, [], ["A"]);
  assert.deepEqual(detailIds, ["A", "B"]);
  assert.equal(items.length, 1);
  assert.match(items[0].normalized_json.title, /Place B/);
  assert.equal(items.collect_stats.details_failed, 1);
  assert.equal(items.collect_stats.details_called, 1);
});
