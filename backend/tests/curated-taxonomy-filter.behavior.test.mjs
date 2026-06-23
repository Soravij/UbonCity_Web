import assert from "node:assert/strict";
import test from "node:test";

import {
  filterPlacesByCuratedTaxonomy,
  matchesCuratedTaxonomy,
} from "../services/curatedTaxonomyFilterService.js";

test("boolean false matches exactly", () => {
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { parking: false }), true);
});

test("boolean does not match 0 or false string", () => {
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { parking: 0 }), false);
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { parking: "false" }), false);
});

test("numeric 0 matches exactly", () => {
  assert.equal(matchesCuratedTaxonomy({ typical_duration: 0 }, { typical_duration: 0 }), true);
});

test("numeric 0 does not match string 0", () => {
  assert.equal(matchesCuratedTaxonomy({ typical_duration: 0 }, { typical_duration: "0" }), false);
});

test("scalar string matches exactly", () => {
  assert.equal(matchesCuratedTaxonomy({ price_level: "standard" }, { price_level: "standard" }), true);
  assert.equal(matchesCuratedTaxonomy({ price_level: "standard" }, { price_level: "premium" }), false);
});

test("scalar filter matches array membership", () => {
  assert.equal(matchesCuratedTaxonomy({ service_scope: ["city", "airport"] }, { service_scope: "airport" }), true);
  assert.equal(matchesCuratedTaxonomy({ service_scope: ["city", "airport"] }, { service_scope: "rail" }), false);
});

test("array filter requires every requested member", () => {
  assert.equal(matchesCuratedTaxonomy({ service_scope: ["city", "airport"] }, { service_scope: ["city"] }), true);
  assert.equal(matchesCuratedTaxonomy({ service_scope: ["city", "airport"] }, { service_scope: ["city", "rail"] }), false);
});

test("multiple filter keys use AND behavior", () => {
  assert.equal(
    matchesCuratedTaxonomy(
      { parking: false, price_level: "standard", service_scope: ["city", "airport"] },
      { parking: false, price_level: "standard", service_scope: "airport" }
    ),
    true
  );
  assert.equal(
    matchesCuratedTaxonomy(
      { parking: false, price_level: "standard", service_scope: ["city", "airport"] },
      { parking: false, price_level: "premium", service_scope: "airport" }
    ),
    false
  );
});

test("missing key does not match", () => {
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { price_level: "standard" }), false);
});

test("null legacy taxonomy does not match non-empty filters", () => {
  assert.equal(matchesCuratedTaxonomy(null, { parking: false }), false);
});

test("malformed JSON does not throw", () => {
  assert.doesNotThrow(() => matchesCuratedTaxonomy("{not-json", { parking: false }));
  assert.equal(matchesCuratedTaxonomy("{not-json", { parking: false }), false);
});

test("empty filters match", () => {
  assert.equal(matchesCuratedTaxonomy({ parking: false }, {}), true);
  assert.equal(matchesCuratedTaxonomy(null, {}), true);
});

test("unknown and legacy keys cannot be used as filters", () => {
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { unknown_key: "x" }), true);
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { "custom.flag": true }), true);
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { category: "cafes" }), true);
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { subtype: "coffee_shop" }), true);
  assert.equal(matchesCuratedTaxonomy({ parking: false }, { tags: ["coffee"] }), true);
});

test("input rows and objects are not mutated", () => {
  const place = Object.freeze({
    id: 1,
    curated_taxonomy_json: {
      parking: false,
      price_level: "standard",
      service_scope: ["city", "airport"],
    },
  });
  const filters = Object.freeze({
    parking: false,
    price_level: "standard",
  });
  const places = Object.freeze([place]);
  const result = filterPlacesByCuratedTaxonomy(places, filters);

  assert.deepEqual(result, [place]);
  assert.equal(Object.isFrozen(place.curated_taxonomy_json), false);
  assert.deepEqual(place.curated_taxonomy_json, {
    parking: false,
    price_level: "standard",
    service_scope: ["city", "airport"],
  });
  assert.deepEqual(filters, {
    parking: false,
    price_level: "standard",
  });
});

test("filterPlacesByCuratedTaxonomy returns matching row objects and handles invalid place lists", () => {
  const rowA = { id: 1, curated_taxonomy_json: { parking: false, price_level: "standard" } };
  const rowB = { id: 2, curated_taxonomy_json: { parking: true, price_level: "standard" } };
  const result = filterPlacesByCuratedTaxonomy([rowA, rowB], { parking: false });
  assert.deepEqual(result, [rowA]);
  assert.equal(filterPlacesByCuratedTaxonomy(null, { parking: false }).length, 0);
  assert.equal(filterPlacesByCuratedTaxonomy("not-array", { parking: false }).length, 0);
});
