import assert from "node:assert/strict";
import test from "node:test";

import { applyGoogleCategory } from "../collector/sources/google-category.mjs";

function run(payload_json, hint) {
  const item = { normalized_json: {}, payload_json };
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
