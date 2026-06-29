import test from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORTED_TAXONOMY_CATEGORIES,
  TAXONOMY_CATALOG_VERSION,
  TAXONOMY_CATEGORY_MATRIX,
  getTaxonomyBaseDefinition,
  getTaxonomyCatalogEntriesForCategory,
  getTaxonomyCatalogEntriesForItem,
} from "../server/taxonomy-catalog.mjs";
import {
  filterRequestedChecksForNewHandoff,
  getAiTaxonomySuggestedValue,
  resolveRequestedChecksWithCatalog,
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

function getCategoryCounts(category) {
  const config = TAXONOMY_CATEGORY_MATRIX[category];
  return {
    required: config.required.length,
    agent_triggered: config.agent_triggered.length,
  };
}

test("taxonomy catalog supports exactly six categories and 48 unique keys", () => {
  const uniqueKeys = new Set();
  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    const entries = getTaxonomyCatalogEntriesForCategory(category, "place");
    for (const entry of entries) uniqueKeys.add(entry.taxonomy_key);
  }

  assert.equal(TAXONOMY_CATALOG_VERSION, "taxonomy_catalog_v1");
  assert.deepEqual(SUPPORTED_TAXONOMY_CATEGORIES, [
    "attractions",
    "activities",
    "hotels",
    "cafes",
    "restaurants",
    "transport",
  ]);
  assert.equal(uniqueKeys.size, 48);
});

test("every category returns the exact required and agent-triggered matrix", () => {
  const expectedCounts = {
    attractions: { required: 6, agent_triggered: 5 },
    activities: { required: 8, agent_triggered: 5 },
    hotels: { required: 8, agent_triggered: 6 },
    cafes: { required: 8, agent_triggered: 5 },
    restaurants: { required: 8, agent_triggered: 4 },
    transport: { required: 6, agent_triggered: 5 },
  };

  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    const entries = getTaxonomyCatalogEntriesForCategory(category, "place");
    const requiredKeys = entries.filter((entry) => entry.activation_mode === "required").map((entry) => entry.taxonomy_key);
    const agentKeys = entries.filter((entry) => entry.activation_mode === "agent_triggered").map((entry) => entry.taxonomy_key);
    assert.deepEqual(requiredKeys, TAXONOMY_CATEGORY_MATRIX[category].required);
    assert.deepEqual(agentKeys, TAXONOMY_CATEGORY_MATRIX[category].agent_triggered);
    assert.deepEqual(getCategoryCounts(category), expectedCounts[category]);
  }
});

test("every catalog key exposes Thai metadata, explicit categories, and answer contract", () => {
  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    for (const entry of getTaxonomyCatalogEntriesForCategory(category, "place")) {
      assert.match(entry.label, /[ก-๙]/);
      assert.match(entry.instruction, /[ก-๙]/);
      assert.equal(typeof entry.answer_type, "string");
      assert.equal(typeof entry.condition_prompt, "string");
      assert.equal(typeof entry.evidence_required, "boolean");
      assert.ok(Array.isArray(entry.categories));
      assert.ok(entry.categories.length > 0);
      assert.ok(entry.categories.every((value) => SUPPORTED_TAXONOMY_CATEGORIES.includes(value)));
      assert.deepEqual(entry.item_types, ["place"]);
    }
  }

  assert.deepEqual(getTaxonomyBaseDefinition("setting_type")?.allowed_values, ["indoor", "outdoor", "mixed"]);
  assert.deepEqual(getTaxonomyBaseDefinition("price_level")?.allowed_values, ["budget", "standard", "premium"]);
  assert.deepEqual(getTaxonomyBaseDefinition("physical_difficulty")?.allowed_values, ["easy", "moderate", "hard"]);
  assert.deepEqual(getTaxonomyBaseDefinition("pricing_model")?.allowed_values, ["meter", "fixed_trip", "distance_based", "per_person", "hourly", "daily"]);
  assert.deepEqual(getTaxonomyBaseDefinition("average_price_per_person")?.unit_options, ["THB/person"]);
  assert.deepEqual(getTaxonomyBaseDefinition("typical_duration")?.unit_options, ["minutes", "hours"]);
});

test("taxonomy catalog no longer requires evidence for any active taxonomy key", () => {
  const formerEvidenceKeys = [
    "pet_friendly",
    "wheelchair_accessible",
    "swimming_allowed",
    "age_restriction",
    "religious_dress_code",
  ];

  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    for (const entry of getTaxonomyCatalogEntriesForCategory(category, "place")) {
      assert.equal(entry.evidence_required, false);
    }
  }

  for (const key of formerEvidenceKeys) {
    assert.equal(getTaxonomyBaseDefinition(key)?.evidence_required, false);
  }
});

test("resolver CTA phone schema no longer marks evidence as required", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "cafes" }),
  });

  const ctaGroup = findGroup(result, "cta_contact");
  assert.equal(findCheck(ctaGroup, "phone")?.evidence_required, false);
});

test("events return no place taxonomy", () => {
  assert.deepEqual(getTaxonomyCatalogEntriesForItem({ type: "event", category: "restaurants" }), []);
});

test("resolver required keys are always requested and agent-triggered keys default to false", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "cafes" }),
  });

  const taxonomyGroup = findGroup(result, "taxonomy");
  assert.ok(taxonomyGroup);
  for (const key of TAXONOMY_CATEGORY_MATRIX.cafes.required) {
    assert.equal(findCheck(taxonomyGroup, key)?.requested, true);
  }
  for (const key of TAXONOMY_CATEGORY_MATRIX.cafes.agent_triggered) {
    assert.equal(findCheck(taxonomyGroup, key)?.requested, false);
  }
});

test("resolver keeps CTA suggestions suggestion-only and validates saved CTA suggested values", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            {
              key: "phone",
              requested: true,
              requested_decision: null,
              label: "Phone",
              instruction: "stale",
              answer_type: "phone",
              suggested_value: "4182277082",
              source: { kind: "manual" },
            },
            {
              key: "facebook_url",
              requested: true,
              requested_decision: null,
              label: "Facebook URL",
              instruction: "stale",
              answer_type: "url",
              suggested_value: "https://maps.google.com/?cid=4182277082282715109",
              source: { kind: "manual" },
            },
          ],
        },
      ],
    },
    item: createPlaceItem({ category: "cafes" }),
    aiCtaContact: {
      phone: "4182277082",
      facebook_url: "https://maps.google.com/?cid=4182277082282715109",
      website_url: "https://www.wongnai.com/reviews/842964bb159942f887e7cc5244fda433",
      primary_cta: "facebook",
    },
  });

  const ctaGroup = findGroup(result, "cta_contact");
  assert.ok(ctaGroup);
  assert.equal(findCheck(ctaGroup, "phone")?.requested, true);
  assert.equal(findCheck(ctaGroup, "phone")?.suggested_value, null);
  assert.equal(findCheck(ctaGroup, "facebook_url")?.suggested_value, null);
  assert.equal(findCheck(ctaGroup, "website_url")?.suggested_value, null);
  assert.equal(findCheck(ctaGroup, "primary_cta")?.suggested_value, null);
});

test("resolver preserves valid saved CTA suggested values when AI does not provide a valid replacement", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/contact",
          checks: [
            {
              key: "phone",
              requested: true,
              requested_decision: null,
              label: "Phone",
              instruction: "saved",
              answer_type: "phone",
              suggested_value: "0659391488",
            },
            {
              key: "facebook_url",
              requested: true,
              requested_decision: null,
              label: "Facebook URL",
              instruction: "saved",
              answer_type: "url",
              suggested_value: "https://www.facebook.com/hippieroaster/?locale=th_TH",
            },
          ],
        },
      ],
    },
    item: createPlaceItem({ category: "cafes" }),
    aiCtaContact: {
      phone: "4182277082",
      facebook_url: "https://maps.google.com/?cid=4182277082282715109",
    },
  });

  const ctaGroup = findGroup(result, "cta_contact");
  assert.equal(findCheck(ctaGroup, "phone")?.suggested_value, "0659391488");
  assert.equal(findCheck(ctaGroup, "facebook_url")?.suggested_value, "https://www.facebook.com/hippieroaster/?locale=th_TH");
});

test("resolver preserves explicit editor selection and rejection for agent-triggered keys", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "waterfront", requested: false, requested_decision: "rejected" },
            { key: "specialty_coffee", requested: true, requested_decision: "selected" },
          ],
        },
      ],
    },
    item: createPlaceItem({ category: "cafes" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "waterfront", suggested_value: true },
        { taxonomy_key: "specialty_coffee", suggested_value: true },
      ],
    },
  });

  const taxonomyGroup = findGroup(result, "taxonomy");
  assert.equal(findCheck(taxonomyGroup, "waterfront")?.requested, false);
  assert.equal(findCheck(taxonomyGroup, "waterfront")?.requested_decision, "rejected");
  assert.equal(findCheck(taxonomyGroup, "specialty_coffee")?.requested, true);
  assert.equal(findCheck(taxonomyGroup, "specialty_coffee")?.requested_decision, "selected");
});

test("resolver activates only applicable agent-triggered AI suggestions", () => {
  const cafeResult = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "cafes" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "waterfront", suggested_value: true },
        { taxonomy_key: "private_room_available", suggested_value: true },
      ],
    },
  });

  const taxonomyGroup = findGroup(cafeResult, "taxonomy");
  assert.equal(findCheck(taxonomyGroup, "waterfront")?.requested, true);
  assert.equal(findCheck(taxonomyGroup, "private_room_available"), null);
});

test("resolver ignores unknown AI keys and preserves false suggested values", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "attractions" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "parking", suggested_value: false },
        { taxonomy_key: "unknown_key", suggested_value: true },
      ],
    },
  });

  const taxonomyGroup = findGroup(result, "taxonomy");
  assert.equal(findCheck(taxonomyGroup, "parking")?.suggested_value, false);
  assert.equal(findCheck(taxonomyGroup, "unknown_key"), null);
});

test("resolver drops invalid raw AI suggested_value but still activates valid agent-triggered boolean row", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "cafes" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "waterfront", suggested_value: "yes", condition_note: "from AI" },
      ],
    },
  });

  const waterfront = findCheck(findGroup(result, "taxonomy"), "waterfront");
  assert.equal(waterfront?.requested, true);
  assert.equal(Object.prototype.hasOwnProperty.call(waterfront || {}, "suggested_value"), true);
  assert.equal(waterfront?.suggested_value, null);
  assert.equal(waterfront?.source?.kind, "ai");
});

test("resolver drops invalid raw AI suggested_value for select rows", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "cafes" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "price_level", suggested_value: "luxury", condition_note: "raw invalid select" },
      ],
    },
  });

  const priceLevel = findCheck(findGroup(result, "taxonomy"), "price_level");
  assert.equal(priceLevel?.requested, true);
  assert.equal(priceLevel?.suggested_value, null);
});

test("resolver filters invalid raw AI suggested_value entries for multi_select rows", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "restaurants" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "dietary_options", suggested_value: ["vegan", "unknown-option", "vegan"], condition_note: "raw invalid multi" },
      ],
    },
  });

  const dietaryOptions = findCheck(findGroup(result, "taxonomy"), "dietary_options");
  assert.equal(dietaryOptions?.requested, true);
  assert.deepEqual(dietaryOptions?.suggested_value, ["vegan"]);
});

test("resolver returns null for multi_select rows when no valid AI values remain", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "restaurants" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "dietary_options", suggested_value: ["unknown-option"], condition_note: "raw invalid multi only" },
      ],
    },
  });

  const dietaryOptions = findCheck(findGroup(result, "taxonomy"), "dietary_options");
  assert.equal(dietaryOptions?.requested, true);
  assert.equal(dietaryOptions?.suggested_value, null);
});

test("resolver drops invalid raw AI suggested_value for number_with_unit rows", () => {
  const result = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: createPlaceItem({ category: "cafes" }),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "average_price_per_person", suggested_value: { number: "free", unit: "THB/person" }, condition_note: "raw invalid number" },
      ],
    },
  });

  const averagePrice = findCheck(findGroup(result, "taxonomy"), "average_price_per_person");
  assert.equal(averagePrice?.requested, true);
  assert.equal(averagePrice?.suggested_value, null);
});

test("resolver forces catalog schema and required keys cannot be removed", () => {
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
              requested: false,
              label: "Wrong label",
              instruction: "wrong",
              answer_type: "text",
              condition_prompt: "wrong",
              evidence_required: false,
            },
          ],
        },
      ],
    },
    item: createPlaceItem({ category: "cafes" }),
    aiTaxonomy: {
      suggested_checks: [
        {
          taxonomy_key: "parking",
          suggested_value: true,
          label: "Wrong AI label",
          answer_type: "text",
        },
      ],
    },
  });

  const parking = findCheck(findGroup(result, "taxonomy"), "parking");
  assert.equal(parking?.requested, true);
  assert.match(parking?.label || "", /มีที่จอดรถ/);
  assert.equal(parking?.answer_type, "boolean_with_conditions");
});

test("resolver preserves CTA as place-only and AI CTA stays suggestion-only", () => {
  const placeResult = resolveRequestedChecksWithCatalog({
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
  const eventResult = resolveRequestedChecksWithCatalog({
    requestedChecks: { version: 1, groups: [] },
    item: { type: "event", category: "activities" },
  });

  const ctaGroup = findGroup(placeResult, "cta_contact");
  assert.ok(ctaGroup);
  for (const key of ["phone", "line_url", "facebook_url", "website_url", "primary_cta"]) {
    const row = findCheck(ctaGroup, key);
    assert.equal(row?.requested, true);
    assert.equal(row?.source?.kind, "ai");
  }
  assert.equal(findGroup(eventResult, "cta_contact"), null);
});

test("new handoff output excludes custom groups, reserved placeholders, and unknown taxonomy keys", () => {
  const resolved = resolveRequestedChecksWithCatalog({
    requestedChecks: {
      version: 1,
      groups: [
        {
          group_key: "taxonomy",
          group_label: "Taxonomy",
          checks: [
            { key: "category", requested: true, label: "Category", answer_type: "text" },
            { key: "legacy_unknown", requested: true, label: "Legacy", answer_type: "text" },
          ],
        },
        {
          group_key: "custom",
          group_label: "Custom",
          checks: [{ key: "custom_wifi", requested: true, answer_type: "text" }],
        },
      ],
    },
    item: createPlaceItem({ category: "cafes" }),
    aiTaxonomy: {
      suggested_checks: [{ taxonomy_key: "waterfront", suggested_value: true }],
    },
  });

  const handoff = filterRequestedChecksForNewHandoff(resolved, createPlaceItem({ category: "cafes" }));
  const taxonomyGroup = findGroup(handoff, "taxonomy");
  assert.deepEqual(taxonomyGroup?.checks.map((check) => check.key), [
    ...TAXONOMY_CATEGORY_MATRIX.cafes.required,
    "waterfront",
  ]);
  assert.equal(findGroup(handoff, "custom"), null);
});

test("AI taxonomy helper supports new suggested_checks and legacy top-level keys", () => {
  assert.equal(getAiTaxonomySuggestedValue({
    suggested_checks: [{ taxonomy_key: "waterfront", suggested_value: true }],
  }, "waterfront"), true);
  assert.equal(getAiTaxonomySuggestedValue({
    parking: false,
  }, "parking"), false);
});
