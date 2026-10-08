import assert from "node:assert/strict";
import test from "node:test";

import { applyGoogleCategory } from "../collector/sources/google-category.mjs";

function run(inner, hint, tags = []) {
  const item = {
    payload_json: inner === null ? {} : { payload_json: inner },
    normalized_json: { category: "attractions", tags },
  };
  applyGoogleCategory(item, hint);
  return item.normalized_json.category;
}

test("primaryType cafe maps to cafes", () => {
  assert.equal(run({ primaryType: "cafe" }), "cafes");
});

test("empty primaryType falls back to types suffix _restaurant", () => {
  assert.equal(run({ primaryType: "", types: ["thai_restaurant", "food"] }), "restaurants");
});

test("unmapped types use the hint", () => {
  assert.equal(run({ types: ["food", "point_of_interest"] }, "restaurants"), "restaurants");
});

test("unknown types and invalid hint default to attractions", () => {
  assert.equal(run({ types: ["foo", "bar_baz"] }, "xyz"), "attractions");
});

test("google types win over hint", () => {
  assert.equal(run({ primaryType: "lodging" }, "cafes"), "hotels");
});

test("item without normalized_json does not throw", () => {
  assert.doesNotThrow(() => applyGoogleCategory({ payload_json: { primaryType: "cafe" } }, "cafes"));
  assert.doesNotThrow(() => applyGoogleCategory(null, "cafes"));
});

test("primaryType wins over types", () => {
  assert.equal(run({ primaryType: "cafe", types: ["tourist_attraction", "cafe"] }), "cafes");
});

test("falls back to normalized_json.tags when no nested payload", () => {
  assert.equal(run(null, undefined, ["restaurant", "food"]), "restaurants");
});

test("hint is trimmed and lowercased", () => {
  assert.equal(run({ types: ["foo"] }, "  Restaurants "), "restaurants");
});
