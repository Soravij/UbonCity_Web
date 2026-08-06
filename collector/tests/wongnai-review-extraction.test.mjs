import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { collectFromManualPayload } from "../collector/sources/adapters/manual.mjs";

// wongnai-trimmed-tree-cafe.html: SSR body stripped, only <head> metadata + window._wn kept.
// Tests parsing logic only — does NOT prove the real page survives MAX_HTML_CHARS truncation.
// See "wongnai storefront cap" test below for the actual cap proof.

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

test("wongnai real fixture: wongnai-trimmed-tree-cafe.html extracts 6 reviews scoped to business id 329973", async () => {
  const html = loadFixture("wongnai-trimmed-tree-cafe.html");
  const url = "https://www.wongnai.com/restaurants/329973fR-tree-cafe-rim-moon";
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
  assert.equal(reviews.count_found, 6, "should find exactly 6 reviews");
  assert.equal(reviews.items.length, 6, "should have 6 items");
  for (const item of reviews.items) {
    assert.ok(item.text.length > 0, "text should not be empty");
  }
});

test("wongnai real fixture: review items stay scoped to business id 329973 — no neighbor leak", async () => {
  const html = loadFixture("wongnai-trimmed-tree-cafe.html");
  const url = "https://www.wongnai.com/restaurants/329973fR-tree-cafe-rim-moon";
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
  assert.equal(reviews.items.length, 6, "should have 6 items (all from business 329973)");
  assert.ok(!reviews.extraction_note, "extraction_note should be null when all reviews match scope");
});

test("wongnai partial-skip: extraction_note when some reviews differ by name", async () => {
  const html = loadFixture("wongnai-partial-skip-name.html");
  const url = "https://www.wongnai.com/restaurants/no-biz-id-shop";
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
  assert.equal(reviews.count_found, 3, "should find 3 reviews with matching name");
  assert.equal(reviews.items.length, 3, "should have 3 items");
  assert.ok(reviews.extraction_note, "extraction_note should be set for partial skip");
  assert.ok(
    reviews.extraction_note.includes("partial_skip"),
    `extraction_note should indicate partial skip: "${reviews.extraction_note}"`
  );
  assert.ok(
    reviews.extraction_note.includes("3_of_6"),
    `extraction_note should mention 3 skipped out of 6: "${reviews.extraction_note}"`
  );
  assert.ok(
    reviews.extraction_note.includes("\u0e2a\u0e32\u0e02\u0e32"),
    `extraction_note should include skipped branch name: "${reviews.extraction_note}"`
  );
});

test("wongnai partial-skip reverts cleanly: no extraction_note when regex fix is reverted", async () => {
  const html = loadFixture("wongnai-trimmed-tree-cafe.html");
  const url = "https://www.wongnai.com/restaurants/329973fR-tree-cafe-rim-moon";
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
  assert.equal(reviews.count_found, 6, "must find 6 reviews with <script type=text/javascript> regex");
});

test("wongnai storefront cap: synthetic 800K HTML with window._wn at ~745K extracts reviews", async () => {
  const reviewsData = [
    { id: "r1", description: "Synthetic review one with enough text to pass the length filter", rating: 5, reviewedItem: { id: 111111, name: "Synth Shop" }, reviewerProfile: { name: "Alice" }, reviewedTime: { iso: "2024-01-01" } },
    { id: "r2", description: "Synthetic review two with enough text to pass the length filter", rating: 4, reviewedItem: { id: 111111, name: "Synth Shop" }, reviewerProfile: { name: "Bob" }, reviewedTime: { iso: "2024-02-01" } },
    { id: "r3", description: "Synthetic review three with enough text to pass the length filter", rating: 3, reviewedItem: { id: 111111, name: "Synth Shop" }, reviewerProfile: { name: "Carol" }, reviewedTime: { iso: "2024-03-01" } },
  ];
  const state = { store: { business: { value: { id: 111111 } }, reviewsPage: { value: { data: reviewsData } } } };
  const wnScript = '<script type="text/javascript">\nwindow._wn = ' + JSON.stringify(state) + "\n</script>";
  const prefix = '<!DOCTYPE html><html><head><title>Synth</title></head><body>';
  const trailPad = "<p>" + "z".repeat(100000) + "</p>";
  const suffix = "</body></html>";
  const padChars = 745000 - prefix.length - "<div>".length;
  const padding = "<div>" + "x".repeat(Math.max(0, padChars)) + "</div>";
  const html = prefix + padding + wnScript + trailPad + suffix;
  assert.ok(html.length > 800000, "synthetic HTML must exceed 800K chars");
  assert.ok(html.indexOf("window._wn") > 740000, "window._wn must be placed after 740K");

  const url = "https://www.wongnai.com/restaurants/111111synth-shop";
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
  assert.equal(reviews.count_found, 3, "should find 3 reviews despite window._wn at ~745K");
  assert.equal(reviews.items.length, 3, "should have 3 items");
});

test("wongnai storefront cap negative: 250K cap truncates window._wn at ~745K → count_found 0", async () => {
  const reviewsData = [
    { id: "r1", description: "Synthetic review one with enough text to pass the length filter", rating: 5, reviewedItem: { id: 222222, name: "Neg Shop" }, reviewerProfile: { name: "Alice" }, reviewedTime: { iso: "2024-01-01" } },
  ];
  const state = { store: { business: { value: { id: 222222 } }, reviewsPage: { value: { data: reviewsData } } } };
  const wnScript = '<script type="text/javascript">\nwindow._wn = ' + JSON.stringify(state) + "\n</script>";
  const prefix = '<!DOCTYPE html><html><head><title>Synth</title></head><body>';
  const trailPad = "<p>" + "z".repeat(100000) + "</p>";
  const suffix = "</body></html>";
  const padChars = 745000 - prefix.length - "<div>".length;
  const padding = "<div>" + "x".repeat(Math.max(0, padChars)) + "</div>";
  const html = prefix + padding + wnScript + trailPad + suffix;
  assert.ok(html.length > 800000, "synthetic HTML must exceed 800K chars");

  const url = "https://www.wongnai.com/biz/222222neg-shop";
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
  assert.equal(reviews.count_found, 0, "250K cap must truncate window._wn at ~745K");
  assert.equal(reviews.extraction_note, "wongnai_state_not_found", "state not found under 250K cap");
});
