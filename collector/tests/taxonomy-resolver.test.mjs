import test from "node:test";
import assert from "node:assert/strict";

import {
  TAXONOMY_CATALOG_VERSION,
  getTaxonomyCatalogEntriesForItem,
} from "../server/taxonomy-catalog.mjs";
import {
  resolveRequestedChecksWithCatalog,
  getAiTaxonomySuggestedValue,
} from "../server/taxonomy-resolver.mjs";

function createPlaceItem(overrides = {}) {
  return {
    type: "place",
    category: "cafes",
    ...overrides,
  };
}

function findGroup(result, groupKey) {
  return result.groups.find((group) => group.group_key === groupKey) || null;
}

function findCheck(group, key) {
  return (group?.checks || []).find((check) => check.key === key) || null;
}

test("taxonomy catalog exports stable actionable keys only", () => {
  const keys = getTaxonomyCatalogEntriesForItem(createPlaceItem()).map((entry) => entry.taxonomy_key);
  assert.equal(TAXONOMY_CATALOG_VERSION, "taxonomy_catalog_v1");
  assert.deepEqual(keys, [
    "waterfront",
    "price_level",
    "average_price_per_person",
    "air_conditioning",
    "parking",
    "outdoor_seating",
    "pet_friendly",
    "work_power_outlets",
  ]);
  assert.equal(keys.includes("category"), false);
  assert.equal(keys.includes("subtype"), false);
  assert.equal(keys.includes("tags"), false);
});

test("resolver emits required and mapped taxonomy checks without AI", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem(),
  });

  const taxonomyGroup = findGroup(result, "taxonomy");
  assert.ok(taxonomyGroup);
  assert.deepEqual(taxonomyGroup.checks.map((check) => check.key), [
    "waterfront",
    "price_level",
    "average_price_per_person",
    "air_conditioning",
    "parking",
    "outdoor_seating",
    "pet_friendly",
    "work_power_outlets",
  ]);
  assert.equal(findCheck(taxonomyGroup, "waterfront")?.requested, true);
  assert.equal(findCheck(taxonomyGroup, "parking")?.requested, true);
});

test("resolver preserves required taxonomy checks even when saved rows try to remove them", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            {
              key: "waterfront",
              requested: false,
              label: "Edited waterfront",
              instruction: "edited",
              answer_type: "text",
            },
          ],
        },
      ],
    },
    item: createPlaceItem(),
  });

  const waterfront = findCheck(findGroup(result, "taxonomy"), "waterfront");
  assert.equal(waterfront?.requested, true);
  assert.equal(waterfront?.label, "Waterfront");
  assert.equal(waterfront?.answer_type, "boolean_with_conditions");
});

test("resolver accepts AI additive suggestions but cannot override catalog schema", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem(),
    aiTaxonomy: {
      suggested_checks: [
        {
          taxonomy_key: "waterfront",
          suggested_value: true,
          answer_type: "text",
          label: "Wrong AI label",
          instruction: "Wrong AI instruction",
        },
      ],
    },
  });

  const waterfront = findCheck(findGroup(result, "taxonomy"), "waterfront");
  assert.equal(waterfront?.answer_type, "boolean_with_conditions");
  assert.equal(waterfront?.label, "Waterfront");
  assert.equal(waterfront?.instruction, "Confirm whether the place has a real waterfront setting visible to visitors.");
  assert.equal(waterfront?.suggested_value, true);
});

test("resolver dedupes by stable key and preserves boolean false suggestions", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            {
              key: "parking",
              requested: true,
              label: "Parking legacy",
              instruction: "legacy",
              answer_type: "text",
            },
          ],
        },
      ],
    },
    item: createPlaceItem(),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "parking", suggested_value: false },
        { taxonomy_key: "parking", suggested_value: true },
      ],
    },
  });

  const parkingRows = findGroup(result, "taxonomy").checks.filter((check) => check.key === "parking");
  assert.equal(parkingRows.length, 1);
  assert.equal(parkingRows[0].suggested_value, false);
  assert.equal(parkingRows[0].answer_type, "boolean_with_conditions");
});

test("resolver preserves custom rows and hidden legacy taxonomy placeholders", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", instruction: "legacy", answer_type: "text" },
            { key: "tags", requested: true, label: "Tags", instruction: "legacy", answer_type: "multi_select" },
          ],
        },
        {
          group_key: "custom",
          group_label: "Custom",
          checks: [
            { key: "wifi_password", requested: true, label: "Wi-Fi password", instruction: "ask", answer_type: "text" },
          ],
        },
      ],
    },
    item: createPlaceItem(),
  });

  const taxonomyGroup = findGroup(result, "taxonomy");
  assert.ok(findCheck(taxonomyGroup, "category"));
  assert.ok(findCheck(taxonomyGroup, "tags"));
  assert.ok(findCheck(findGroup(result, "custom"), "wifi_password"));
});

test("resolver drops stale known catalog keys when category applicability changes but preserves legacy placeholders", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "price_level", requested: true, label: "Old price", instruction: "legacy", answer_type: "text" },
            { key: "work_power_outlets", requested: true, label: "Old outlets", instruction: "legacy", answer_type: "text" },
            { key: "category", requested: true, label: "Category", instruction: "legacy", answer_type: "text" },
          ],
        },
      ],
    },
    item: createPlaceItem({ category: "attractions" }),
  });

  const taxonomyGroup = findGroup(result, "taxonomy");
  assert.equal(findCheck(taxonomyGroup, "price_level"), null);
  assert.equal(findCheck(taxonomyGroup, "work_power_outlets"), null);
  assert.ok(findCheck(taxonomyGroup, "category"));
});

test("resolver preserves CTA as place-only", () => {
  const placeResult = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [{ group_key: "cta_contact", group_label: "CTA", checks: [{ key: "phone", requested: true }] }] },
    item: createPlaceItem(),
  });
  const eventResult = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [{ group_key: "cta_contact", group_label: "CTA", checks: [{ key: "phone", requested: true }] }] },
    item: { type: "event", category: "activities" },
  });

  assert.ok(findGroup(placeResult, "cta_contact"));
  assert.equal(findGroup(eventResult, "cta_contact"), null);
});

test("resolver keeps AI CTA suggestions suggestion-only for every CTA key", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem(),
    aiCtaContact: {
      phone: "0812345678",
      line_url: "https://line.me/example",
      facebook_url: "https://facebook.com/example",
      website_url: "https://example.com",
      primary_cta: "phone",
      confidence: "high",
    },
  });

  const ctaGroup = findGroup(result, "cta_contact");
  assert.ok(ctaGroup);
  assert.deepEqual(ctaGroup.checks.map((check) => check.key), [
    "phone",
    "line_url",
    "facebook_url",
    "website_url",
    "primary_cta",
  ]);
  for (const key of ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]) {
    const row = findCheck(ctaGroup, key);
    assert.equal(row?.requested, false);
    assert.equal(row?.source?.kind, "ai");
  }
});

test("resolver forces known catalog schema even when saved row tries to override it", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            {
              key: "parking",
              requested: true,
              label: "Wrong saved label",
              instruction: "Wrong saved instruction",
              answer_type: "text",
              condition_prompt: "Wrong saved prompt",
              evidence_required: false,
              suggested_value: false,
              source: { kind: "manual" },
            },
          ],
        },
      ],
    },
    item: createPlaceItem(),
    aiTaxonomy: {
      suggested_checks: [
        {
          taxonomy_key: "parking",
          suggested_value: true,
          label: "Wrong AI label",
          instruction: "Wrong AI instruction",
          answer_type: "number_with_unit",
        },
      ],
    },
  });

  const parking = findCheck(findGroup(result, "taxonomy"), "parking");
  assert.equal(parking?.label, "Parking");
  assert.equal(parking?.instruction, "Confirm whether visitor parking is available on-site or nearby.");
  assert.equal(parking?.answer_type, "boolean_with_conditions");
  assert.equal(parking?.condition_prompt, "If parking is limited, paid, shared, or street-only, note the condition.");
  assert.equal(parking?.evidence_required, false);
  assert.equal(parking?.requested, true);
  assert.equal(parking?.suggested_value, true);
});

test("resolver applies restaurant facets for restaurant category", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "restaurants" }),
  });
  const keys = findGroup(result, "taxonomy").checks.map((check) => check.key);
  assert.ok(keys.includes("price_level"));
  assert.ok(keys.includes("average_price_per_person"));
  assert.ok(keys.includes("outdoor_seating"));
  assert.ok(keys.includes("pet_friendly"));
  assert.equal(keys.includes("work_power_outlets"), false);
});

test("resolver applies cafe facets for cafe category aliases", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "cafe" }),
  });
  const keys = findGroup(result, "taxonomy").checks.map((check) => check.key);
  assert.ok(keys.includes("price_level"));
  assert.ok(keys.includes("average_price_per_person"));
  assert.ok(keys.includes("outdoor_seating"));
  assert.ok(keys.includes("work_power_outlets"));
});

test("resolver excludes restaurant cafe facets for unrelated place categories", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "attractions" }),
  });
  const keys = findGroup(result, "taxonomy").checks.map((check) => check.key);
  assert.ok(keys.includes("waterfront"));
  assert.ok(keys.includes("parking"));
  assert.equal(keys.includes("price_level"), false);
  assert.equal(keys.includes("average_price_per_person"), false);
  assert.equal(keys.includes("outdoor_seating"), false);
  assert.equal(keys.includes("work_power_outlets"), false);
});

test("resolver excludes taxonomy catalog for non-place items even with category aliases", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: { type: "event", category: "restaurants" },
  });
  assert.equal(findGroup(result, "taxonomy"), null);
});

test("AI taxonomy helper supports new suggested_checks and legacy top-level keys", () => {
  assert.equal(getAiTaxonomySuggestedValue({
    suggested_checks: [{ taxonomy_key: "waterfront", suggested_value: true }],
  }, "waterfront"), true);
  assert.equal(getAiTaxonomySuggestedValue({
    parking: false,
  }, "parking"), false);
});
