import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { collectFromManualPayload } from "../collector/sources/adapters/manual.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

function loadFixture(name) {
  return readFileSync(path.join(fixturesDir, name), "utf-8");
}

function createMockResponse({ url, html, contentType = "text/html; charset=utf-8" }) {
  return {
    ok: true,
    status: 200,
    url,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async arrayBuffer() {
      return new TextEncoder().encode(html).buffer;
    },
  };
}

async function withFetchMock(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withImmediateTimers(run) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay > 1000) {
      return originalSetTimeout(callback, 0, ...args);
    }
    queueMicrotask(() => {
      if (typeof callback === "function") callback(...args);
    });
    return 1;
  };
  globalThis.clearTimeout = () => {};
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
}

test("wongnai review extraction: 1 review returns items with 4 fields", async () => {
  const html = loadFixture("wongnai-one-review.html");
  const url = "https://www.wongnai.com/restaurants/999999test-test-restaurant";
  const result = await withImmediateTimers(() =>
    withFetchMock(
      async (fetchUrl) => createMockResponse({ url: fetchUrl, html }),
      async () => {
        const [row] = await collectFromManualPayload([{ source_url: url }]);
        return row;
      }
    )
  );
  const reviews = result?.payload_json?.payload_json?.extracted_reviews;
  assert.ok(reviews, "extracted_reviews should exist");
  assert.equal(reviews.count_found, 1, "should find exactly 1 review");
  assert.equal(reviews.items.length, 1, "should have 1 item");
  const item = reviews.items[0];
  assert.ok(item.text.length > 0, "text should not be empty");
  assert.equal(typeof item.author, "string", "author should be string");
  assert.ok(item.rating > 0, "rating should be positive");
  assert.ok(item.relative_time.length > 0, "relative_time (date) should not be empty");
});

test("wongnai review extraction: neighbor shop reviews must not leak into items", async () => {
  const html = loadFixture("wongnai-with-neighbors.html");
  const url = "https://www.wongnai.com/restaurants/target-shop";
  const result = await withImmediateTimers(() =>
    withFetchMock(
      async (fetchUrl) => createMockResponse({ url: fetchUrl, html }),
      async () => {
        const [row] = await collectFromManualPayload([{ source_url: url }]);
        return row;
      }
    )
  );
  const reviews = result?.payload_json?.payload_json?.extracted_reviews;
  assert.ok(reviews, "extracted_reviews should exist");
  assert.equal(reviews.items.length, 2, "should have exactly 2 items (only Target Shop reviews)");
  for (const item of reviews.items) {
    assert.ok(
      !item.text.includes("Neighbor Cafe") && !item.text.includes("Delicious Place"),
      `review text should not contain neighbor shop names: "${item.text}"`
    );
  }
});

test("wongnai review extraction: no reviews returns empty items without throwing", async () => {
  const html = loadFixture("wongnai-no-reviews.html");
  const url = "https://www.wongnai.com/restaurants/empty-reviews-shop";
  const result = await withImmediateTimers(() =>
    withFetchMock(
      async (fetchUrl) => createMockResponse({ url: fetchUrl, html }),
      async () => {
        const [row] = await collectFromManualPayload([{ source_url: url }]);
        return row;
      }
    )
  );
  const reviews = result?.payload_json?.payload_json?.extracted_reviews;
  assert.ok(reviews, "extracted_reviews should exist");
  assert.equal(reviews.count_found, 0, "count_found should be 0");
  assert.deepEqual(reviews.items, [], "items should be empty array");
});

test("wongnai scope: filters by business id, not just name", async () => {
  const html = loadFixture("wongnai-with-neighbors.html");
  const url = "https://www.wongnai.com/restaurants/target-shop";
  const result = await withImmediateTimers(() =>
    withFetchMock(
      async (fetchUrl) => createMockResponse({ url: fetchUrl, html }),
      async () => {
        const [row] = await collectFromManualPayload([{ source_url: url }]);
        return row;
      }
    )
  );
  const reviews = result?.payload_json?.payload_json?.extracted_reviews;
  assert.ok(reviews, "extracted_reviews should exist");
  assert.equal(reviews.items.length, 2, "should have exactly 2 items (only Target Shop id=888888)");
  for (const item of reviews.items) {
    assert.ok(
      !item.text.includes("Neighbor Cafe") && !item.text.includes("Delicious Place"),
      `review text should not contain neighbor shop names: "${item.text}"`
    );
  }
});

test("wongnai signal: extraction_note when state exists but 0 reviews matched scope", async () => {
  const html = loadFixture("wongnai-mismatch-id.html");
  const url = "https://www.wongnai.com/restaurants/mismatch-shop";
  const result = await withImmediateTimers(() =>
    withFetchMock(
      async (fetchUrl) => createMockResponse({ url: fetchUrl, html }),
      async () => {
        const [row] = await collectFromManualPayload([{ source_url: url }]);
        return row;
      }
    )
  );
  const reviews = result?.payload_json?.payload_json?.extracted_reviews;
  assert.ok(reviews, "extracted_reviews should exist");
  assert.equal(reviews.count_found, 0, "count_found should be 0");
  assert.deepEqual(reviews.items, [], "items should be empty array");
  assert.ok(reviews.extraction_note, "extraction_note should be set when state exists but 0 matched");
  assert.ok(
    reviews.extraction_note.includes("raw_reviews_but_0_matched_scope"),
    `extraction_note should indicate scope mismatch: "${reviews.extraction_note}"`
  );
});
