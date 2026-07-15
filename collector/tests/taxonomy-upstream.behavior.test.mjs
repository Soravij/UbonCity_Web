import assert from "node:assert/strict";
import test from "node:test";

import { getTaxonomyCatalogEntriesForItem } from "../server/taxonomy-catalog.mjs";
import {
  getTaxonomyCatalogPromptChecks,
  normalizeAiTaxonomySuggestions,
  resolveTaxonomyRequestedChecksGroup,
} from "../server/taxonomy-resolver.mjs";
import { buildPromptInput, normalizeFieldPack } from "../services/agent-generation.mjs";
import { buildFieldPackPayloadFromAgent } from "../services/workflow.mjs";

function item(overrides = {}) {
  return {
    id: 1,
    type: "place",
    category: "cafes",
    title: "Taxonomy test cafe",
    lang: "th",
    ...overrides,
  };
}

function pack(overrides = {}) {
  return {
    ai_summary: "brief",
    story_angle: "angle",
    checklists: {
      must_verify_fact: ["verify"],
      must_capture: [{ capture_type: "photo", item_text: "entrance" }],
      must_ask_question: ["ask"],
    },
    ...overrides,
  };
}

function keysOf(group) {
  return (group?.checks || []).map((check) => check.key);
}

test("the catalog only applies to place items in a supported category", () => {
  assert.equal(getTaxonomyCatalogEntriesForItem(item()).length > 0, true);
  assert.deepEqual(getTaxonomyCatalogEntriesForItem(item({ type: "event" })), []);
  assert.deepEqual(getTaxonomyCatalogEntriesForItem(item({ category: "not-a-category" })), []);
});

test("AI cannot invent a taxonomy key, cross a category, or break a key's answer contract", () => {
  const suggestions = normalizeAiTaxonomySuggestions({
    suggested_checks: [
      { taxonomy_key: "wifi_available", suggested_value: true },
      // real catalog key, but it belongs to transport/activities, not to a cafe
      { taxonomy_key: "charter_available", suggested_value: true },
      // not a catalog key at all
      { taxonomy_key: "has_unicorn", suggested_value: true },
      // reserved Clean-owned metadata, never a Curation question
      { taxonomy_key: "category", suggested_value: "cafes" },
      // price_level is a select: "very cheap" is not one of its allowed values
      { taxonomy_key: "price_level", suggested_value: "very cheap" },
      // a row that activates a key but says nothing is noise, not a suggestion
      { taxonomy_key: "parking" },
    ],
  }, item());
  assert.deepEqual(suggestions, [{ taxonomy_key: "wifi_available", suggested_value: true }]);
});

test("a valid select, multi_select and number_with_unit suggestion survives normalization", () => {
  const suggestions = normalizeAiTaxonomySuggestions({
    suggested_checks: [
      { taxonomy_key: "price_level", suggested_value: "budget" },
      { taxonomy_key: "average_price_per_person", suggested_value: { number: 120, unit: "THB/person" } },
      { taxonomy_key: "outdoor_seating", suggested_value: false, condition_note: "เฉพาะโซนหลังร้าน" },
    ],
  }, item());
  assert.deepEqual(suggestions, [
    { taxonomy_key: "price_level", suggested_value: "budget" },
    { taxonomy_key: "average_price_per_person", suggested_value: { number: 120, unit: "THB/person" } },
    { taxonomy_key: "outdoor_seating", suggested_value: false, condition_note: "เฉพาะโซนหลังร้าน" },
  ]);
});

test("the prompt carries the catalog so the agent cannot invent keys, and stays empty for a non-place item", () => {
  const promptChecks = buildPromptInput(item()).taxonomy_catalog_checks;
  assert.equal(promptChecks.some((check) => check.taxonomy_key === "specialty_coffee"), true);
  const priceLevel = promptChecks.find((check) => check.taxonomy_key === "price_level");
  assert.equal(priceLevel.answer_type, "select");
  assert.deepEqual(priceLevel.allowed_values, ["budget", "standard", "premium"]);
  assert.deepEqual(buildPromptInput(item({ type: "event" })).taxonomy_catalog_checks, []);
  assert.deepEqual(getTaxonomyCatalogPromptChecks({ type: "event" }), []);
});

test("field pack normalization keeps only catalog-legal taxonomy suggestions", () => {
  const normalized = normalizeFieldPack(pack({
    ai_taxonomy_json: {
      confidence: "medium",
      suggested_checks: [
        { taxonomy_key: "wifi_available", suggested_value: true },
        { taxonomy_key: "has_unicorn", suggested_value: true },
      ],
    },
  }), { item: item() });
  assert.deepEqual(normalized.ai_taxonomy_json, {
    suggested_checks: [{ taxonomy_key: "wifi_available", suggested_value: true }],
    confidence: "medium",
  });
});

test("a non-place item generates no taxonomy suggestions at all", () => {
  const normalized = normalizeFieldPack(pack({
    ai_taxonomy_json: { suggested_checks: [{ taxonomy_key: "wifi_available", suggested_value: true }] },
  }), { item: item({ type: "event" }) });
  assert.deepEqual(normalized.ai_taxonomy_json, {});
});

test("required category defaults are always asked; agent-triggered keys only when AI switches them on", () => {
  const group = resolveTaxonomyRequestedChecksGroup({
    item: item(),
    aiTaxonomy: { suggested_checks: [{ taxonomy_key: "specialty_coffee", suggested_value: true }] },
  });
  const requested = group.checks.filter((check) => check.requested === true).map((check) => check.key);
  // the 8 required cafes defaults, plus the one agent-triggered key the AI activated
  assert.deepEqual(requested.sort(), [
    "air_conditioning",
    "average_price_per_person",
    "outdoor_seating",
    "parking",
    "pet_friendly",
    "price_level",
    "specialty_coffee",
    "wifi_available",
    "work_power_outlets",
  ]);
  // an agent-triggered key nobody activated is present but not asked
  assert.equal(group.checks.find((check) => check.key === "kids_area").requested, false);
});

test("a yes/no suggestion prefills the qualifier, never a ใช่/ไม่ใช่ answer", () => {
  const group = resolveTaxonomyRequestedChecksGroup({
    item: item(),
    aiTaxonomy: {
      confidence: "medium",
      suggested_checks: [
        { taxonomy_key: "outdoor_seating", suggested_value: true, condition_note: "โซนหลังร้าน" },
        { taxonomy_key: "wifi_available", suggested_value: true },
      ],
    },
  });
  // The tick carries ใช่. The input next to it holds the qualifier, so that is what gets prefilled.
  const outdoor = group.checks.find((entry) => entry.key === "outdoor_seating");
  assert.equal(outdoor.suggested_value, "โซนหลังร้าน");
  assert.deepEqual(outdoor.source, { kind: "ai", confidence: "medium", note: null });

  // A yes with no qualifier has nothing to prefill, but the AI badge still tells the worker it looked.
  const wifi = group.checks.find((entry) => entry.key === "wifi_available");
  assert.equal(wifi.suggested_value, null);
  assert.equal(wifi.source.kind, "ai");

  // Nothing in a resolved check reads as an answer: the worker's tick is still the only thing that
  // turns a suggestion into a confirmed fact (§7A).
  group.checks.forEach((check) => {
    assert.equal(Object.hasOwn(check, "checked"), false);
    assert.equal(Object.hasOwn(check, "found"), false);
  });
});

test("an AI 'no' on a yes/no check is not a suggestion: an unticked check already says ไม่มี", () => {
  const group = resolveTaxonomyRequestedChecksGroup({
    item: item(),
    aiTaxonomy: {
      suggested_checks: [
        { taxonomy_key: "specialty_coffee", suggested_value: false },
        { taxonomy_key: "kids_area", suggested_value: false, condition_note: "มีเฉพาะวันเสาร์" },
      ],
    },
  });
  // A bare "no" would arrive looking AI-assisted while showing the worker nothing, so it never
  // activates the key at all.
  const specialty = group.checks.find((check) => check.key === "specialty_coffee");
  assert.equal(specialty.requested, false);
  assert.equal(specialty.source, null);
  // A qualified "no" does carry information, so it activates the key and prefills the qualifier.
  const kids = group.checks.find((check) => check.key === "kids_area");
  assert.equal(kids.requested, true);
  assert.equal(kids.suggested_value, "มีเฉพาะวันเสาร์");
});

test("the curator can reject an agent-triggered key and the AI cannot switch it back on", () => {
  const group = resolveTaxonomyRequestedChecksGroup({
    existingGroup: {
      group_key: "taxonomy",
      checks: [{ key: "specialty_coffee", requested: false }],
    },
    item: item(),
    aiTaxonomy: { suggested_checks: [{ taxonomy_key: "specialty_coffee", suggested_value: true }] },
  });
  assert.equal(group.checks.find((check) => check.key === "specialty_coffee").requested, false);
});

test("a required key stays asked even when the curator's stored row says otherwise", () => {
  const group = resolveTaxonomyRequestedChecksGroup({
    existingGroup: { group_key: "taxonomy", checks: [{ key: "parking", requested: false }] },
    item: item(),
  });
  // §7A: required category defaults are the baseline for Curation and cannot be silently removed.
  assert.equal(group.checks.find((check) => check.key === "parking").requested, true);
});

test("a regenerate the approved context no longer supports clears the stale taxonomy suggestion", () => {
  const stale = {
    group_key: "taxonomy",
    checks: [{ key: "wifi_available", requested: true, suggested_value: true, source: { kind: "ai" } }],
  };
  // this run produced no taxonomy suggestion at all
  const group = resolveTaxonomyRequestedChecksGroup({ existingGroup: stale, item: item(), aiTaxonomy: {} });
  const check = group.checks.find((entry) => entry.key === "wifi_available");
  // §7A: suggestions are a snapshot of the latest run, not an accumulator. A value nobody can vouch for
  // any more must not keep prefilling the worker's form.
  assert.equal(check.suggested_value, null);
  assert.equal(check.source, null);
  assert.equal(check.requested, true);
});

test("an agent-triggered key's AI-attributed activation does not outlive the evidence that produced it", () => {
  const stale = {
    group_key: "taxonomy",
    checks: [{ key: "specialty_coffee", requested: true, suggested_value: true, source: { kind: "ai" } }],
  };
  // this run produced no suggestion for this key at all
  const group = resolveTaxonomyRequestedChecksGroup({ existingGroup: stale, item: item(), aiTaxonomy: {} });
  // §7A: suggestions are a snapshot of the latest run, not an accumulator. A `requested: true` that only
  // ever existed because the AI activated it must reset along with the suggestion it came from, or an
  // agent-triggered key stays permanently asked once AI happens to notice it once.
  assert.equal(group.checks.find((check) => check.key === "specialty_coffee").requested, false);
});

test("a curator's own activation of an agent-triggered key stays sticky without this run's AI evidence", () => {
  const saved = {
    group_key: "taxonomy",
    checks: [{ key: "specialty_coffee", requested: true, suggested_value: null, source: null }],
  };
  const group = resolveTaxonomyRequestedChecksGroup({ existingGroup: saved, item: item(), aiTaxonomy: {} });
  // Only an AI-attributed activation expires with its evidence. A curator's own decision to ask this
  // question has no such expiry — it stays asked until the curator changes it.
  assert.equal(group.checks.find((check) => check.key === "specialty_coffee").requested, true);
});

test("the deterministic/no-AI path never erases stored taxonomy suggestions", () => {
  const existing = {
    id: 9,
    ai_taxonomy_json: { suggested_checks: [{ taxonomy_key: "wifi_available", suggested_value: true }] },
  };
  const saved = buildFieldPackPayloadFromAgent(null, existing, { item: item() });
  assert.deepEqual(saved.ai_taxonomy_json, existing.ai_taxonomy_json);
});

test("an AI run replaces the stored taxonomy suggestions wholesale", () => {
  const existing = {
    id: 9,
    ai_taxonomy_json: { suggested_checks: [{ taxonomy_key: "wifi_available", suggested_value: true }] },
  };
  const aiPack = normalizeFieldPack(pack({
    ai_taxonomy_json: { suggested_checks: [{ taxonomy_key: "parking", suggested_value: true, condition_note: "จอดริมถนน" }] },
  }), { item: item() });
  const saved = buildFieldPackPayloadFromAgent(aiPack, existing, { item: item() });
  assert.deepEqual(saved.ai_taxonomy_json.suggested_checks, [
    { taxonomy_key: "parking", suggested_value: true, condition_note: "จอดริมถนน" },
  ]);
});

test("an item with no catalog keeps the curator's legacy taxonomy rows instead of losing them", () => {
  const legacy = {
    group_key: "taxonomy",
    group_label: "หมวดหมู่",
    checks: [{ key: "stage_setup", requested: true, label: "เวที", answer_type: "text", suggested_value: "outdoor" }],
  };
  const group = resolveTaxonomyRequestedChecksGroup({ existingGroup: legacy, item: item({ type: "event" }) });
  assert.deepEqual(keysOf(group), ["stage_setup"]);
  assert.equal(group.checks[0].suggested_value, "outdoor");
  // and with neither a catalog nor a legacy row there is nothing to ask, so the Curation section hides
  assert.equal(resolveTaxonomyRequestedChecksGroup({ item: item({ type: "event" }) }), null);
});

test("the catalog owns the schema of a catalog key, but never deletes a curator's own key", () => {
  const group = resolveTaxonomyRequestedChecksGroup({
    existingGroup: {
      group_key: "taxonomy",
      checks: [
        // same key as the catalog's, but hand-written with the wrong shape
        { key: "parking", requested: true, label: "ที่จอด", answer_type: "text", suggested_value: "เยอะ" },
        // a key the catalog knows nothing about
        { key: "roast_profile", requested: true, label: "โปรไฟล์คั่ว", answer_type: "text", suggested_value: "medium" },
      ],
    },
    item: item(),
  });
  const parking = group.checks.find((check) => check.key === "parking");
  assert.equal(parking.answer_type, "boolean_with_conditions");
  assert.equal(parking.label, "มีที่จอดรถ");
  assert.equal(parking.suggested_value, null);
  const roast = group.checks.find((check) => check.key === "roast_profile");
  assert.equal(roast.answer_type, "text");
  assert.equal(roast.suggested_value, "medium");
});
