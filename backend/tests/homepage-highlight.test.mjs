import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultBlocks, sanitizeBlocks } from "../services/homepageCurationService.js";

test("createDefaultBlocks includes highlight with type place-list, enabled false, max_items 3", () => {
  const blocks = createDefaultBlocks("th");
  const highlight = blocks.find((b) => b.key === "highlight");

  assert.ok(highlight, "highlight block must exist");
  assert.equal(highlight.type, "place-list");
  assert.equal(highlight.enabled, false);
  assert.equal(highlight.max_items, 3);
  assert.equal(highlight.min_items, 0);
});

test("sanitizeBlocks inserts highlight at index 1 when input has [hero, scenarios, featured_events]", () => {
  const input = [
    { key: "hero", type: "hero", enabled: true, position: 1 },
    { key: "scenarios", type: "scenario-grid", enabled: true, position: 2 },
    { key: "featured_events", type: "event-list", enabled: true, position: 3 },
  ];

  const result = sanitizeBlocks(input, "th");
  const keys = result.map((b) => b.key);

  assert.deepEqual(keys, ["hero", "highlight", "scenarios", "featured_events"]);
  assert.equal(result[1].key, "highlight");
});

test("sanitizeBlockByKey clamps highlight max_items: 500->9, 7->6, 1->3", () => {
  const cases = [
    { input: 500, expected: 9 },
    { input: 7, expected: 6 },
    { input: 1, expected: 3 },
    { input: 3, expected: 3 },
    { input: 6, expected: 6 },
    { input: 9, expected: 9 },
  ];

  for (const { input, expected } of cases) {
    const blocks = sanitizeBlocks(
      [{ key: "hero" }, { key: "highlight", max_items: input }, { key: "scenarios" }, { key: "featured_events" }],
      "th"
    );
    const highlight = blocks.find((b) => b.key === "highlight");
    assert.equal(highlight.max_items, expected, `max_items ${input} should become ${expected}`);
  }
});
