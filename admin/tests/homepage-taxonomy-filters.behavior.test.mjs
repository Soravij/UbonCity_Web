import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaxonomyFilters,
  createTaxonomyFilterRow,
  hasMeaningfulTaxonomyFilterRow,
  formatTaxonomyValue,
} from "../src/utils/homepageTaxonomyFilters.js";

const ALLOWED_KEYS = [
  "parking",
  "price_level",
  "service_scope",
  "typical_duration",
];

test("createTaxonomyFilterRow returns the expected blank row shape", () => {
  assert.deepEqual(createTaxonomyFilterRow(), {
    key: "",
    value_type: "string",
    value: "",
  });
});

test("buildTaxonomyFilters normalizes boolean, number, string, and list values", () => {
  const result = buildTaxonomyFilters(
    [
      { key: "parking", value_type: "boolean", value: "false" },
      { key: "typical_duration", value_type: "number", value: "0" },
      { key: "price_level", value_type: "string", value: " standard " },
      { key: "service_scope", value_type: "list", value: " city, airport " },
    ],
    ALLOWED_KEYS
  );

  assert.deepEqual(result, {
    filters: {
      parking: false,
      typical_duration: 0,
      price_level: "standard",
      service_scope: ["city", "airport"],
    },
    error: "",
  });
});

test("buildTaxonomyFilters rejects invalid and disallowed rows", () => {
  assert.deepEqual(buildTaxonomyFilters([{ key: "", value_type: "string", value: "x" }], ALLOWED_KEYS), {
    filters: null,
    error: "Select a taxonomy key",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "parking", value_type: "boolean", value: "maybe" }], ALLOWED_KEYS), {
    filters: null,
    error: "Invalid boolean value",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "parking", value_type: "number", value: "abc" }], ALLOWED_KEYS), {
    filters: null,
    error: "Invalid number value",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "parking", value_type: "list", value: " , " }], ALLOWED_KEYS), {
    filters: null,
    error: "Invalid list value",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "unknown_key", value_type: "string", value: "x" }], ALLOWED_KEYS), {
    filters: null,
    error: "Unsupported taxonomy key",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "custom.flag", value_type: "string", value: "x" }], ALLOWED_KEYS), {
    filters: null,
    error: "Unsupported taxonomy key",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "category", value_type: "string", value: "cafes" }], ALLOWED_KEYS), {
    filters: null,
    error: "Unsupported taxonomy key",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "subtype", value_type: "string", value: "coffee_shop" }], ALLOWED_KEYS), {
    filters: null,
    error: "Unsupported taxonomy key",
  });
  assert.deepEqual(buildTaxonomyFilters([{ key: "tags", value_type: "list", value: "coffee" }], ALLOWED_KEYS), {
    filters: null,
    error: "Unsupported taxonomy key",
  });
});

test("buildTaxonomyFilters keeps empty row sets nullable and does not mutate inputs", () => {
  const rows = Object.freeze([
    Object.freeze({ key: "parking", value_type: "boolean", value: false }),
  ]);
  const result = buildTaxonomyFilters(rows, ALLOWED_KEYS);

  assert.deepEqual(result, {
    filters: { parking: false },
    error: "",
  });
  assert.deepEqual(rows[0], {
    key: "parking",
    value_type: "boolean",
    value: false,
  });
});

test("hasMeaningfulTaxonomyFilterRow ignores blank untouched rows and keeps partial rows", () => {
  assert.equal(hasMeaningfulTaxonomyFilterRow({ key: "", value_type: "string", value: "" }), false);
  assert.equal(hasMeaningfulTaxonomyFilterRow({ key: "parking", value_type: "boolean", value: "" }), true);
  assert.equal(hasMeaningfulTaxonomyFilterRow({ key: "", value_type: "string", value: "x" }), true);
});

test("formatTaxonomyValue renders primitives and arrays safely", () => {
  assert.equal(formatTaxonomyValue(false), "false");
  assert.equal(formatTaxonomyValue(0), "0");
  assert.equal(formatTaxonomyValue("standard"), "standard");
  assert.equal(formatTaxonomyValue(["city", "airport"]), "city, airport");
  assert.equal(formatTaxonomyValue(null), "-");
  assert.equal(formatTaxonomyValue({ parking: false }), "-");
});
