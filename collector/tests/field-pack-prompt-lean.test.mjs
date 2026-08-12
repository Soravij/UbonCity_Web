import assert from "node:assert/strict";
import test from "node:test";

import { buildPromptInput } from "../services/agent-generation.mjs";

function createItem(overrides = {}) {
  return {
    id: 10,
    title: "Lean Test Place",
    type: "place",
    category: "cafes",
    lang: "th",
    structured_context: {
      item: {
        id: 10,
        title: "Lean Test Place",
        type: "place",
        category: "cafes",
        lang: "th",
        slug: "lean-test-place",
        description_clean: "clean text",
      },
      approved_context: [
        { id: 1, context_type: "fact", selected_text: "approved" },
      ],
      evidence_blocks: [
        {
          id: 99,
          block_type: "text",
          source_type: "manual",
          source_url: "https://example.com/src",
          source_label: "example",
          lang: "th",
          attribution_text: "attr",
          text_value: "evidence text",
          numeric_value: null,
          list_value: [],
          status: "approved",
        },
      ],
      image_context: {
        selected_urls: ["https://example.com/photo.jpg"],
        gallery_urls: [],
        inline_urls: [],
        selected_count: 1,
      },
      reference_media_context: {
        selected_urls: [],
        selected_count: 0,
        assets: [],
      },
      completeness: {
        has_minimum_required: true,
        minimum_missing: [],
        quality_gaps: [],
      },
      evidence_policy: {
        primary_source: "owner",
        secondary_sources: [],
      },
      task: {
        mode: "field_pack",
        instructions: ["go"],
      },
    },
    ...overrides,
  };
}

test("lean on (default): buildPromptInput removes specified top-level keys and trims evidence_blocks fields when COLLECTOR_FIELD_PACK_LEAN is unset", () => {
  delete process.env.COLLECTOR_FIELD_PACK_LEAN;
  const result = buildPromptInput(createItem());

  const removedTopKeys = [
    "completeness",
    "evidence_policy",
    "cta_contact_candidates",
    "visual_context_counts",
    "context_counts",
    "visual_image_count",
  ];
  for (const key of removedTopKeys) {
    assert.ok(!(key in result), `expected top-level key "${key}" to be removed when lean is on (default)`);
  }

  const keptTopKeys = [
    "item",
    "approved_context",
    "evidence_blocks",
    "image_context",
    "reference_media_context",
    "task",
    "agent_profile",
    "taxonomy_catalog_checks",
    "visual_context",
  ];
  for (const key of keptTopKeys) {
    assert.ok(key in result, `expected top-level key "${key}" to be kept when lean is on (default)`);
  }

  const block = result.evidence_blocks[0];
  const keptBlockKeys = ["block_type", "source_type", "text_value", "numeric_value", "list_value"];
  for (const key of keptBlockKeys) {
    assert.ok(key in block, `expected evidence_block key "${key}" to be kept when lean is on (default)`);
  }

  const removedBlockKeys = ["id", "source_url", "source_label", "lang", "attribution_text", "status"];
  for (const key of removedBlockKeys) {
    assert.ok(!(key in block), `expected evidence_block key "${key}" to be removed when lean is on (default)`);
  }
});

test("lean off: buildPromptInput returns all top-level keys and full evidence_blocks fields when COLLECTOR_FIELD_PACK_LEAN=0", () => {
  process.env.COLLECTOR_FIELD_PACK_LEAN = "0";
  try {
    const result = buildPromptInput(createItem());

    const expectedTopKeys = [
      "item",
      "approved_context",
      "evidence_blocks",
      "image_context",
      "reference_media_context",
      "completeness",
      "evidence_policy",
      "task",
      "agent_profile",
      "cta_contact_candidates",
      "taxonomy_catalog_checks",
      "visual_context",
      "visual_context_counts",
      "context_counts",
      "visual_image_count",
    ];
    for (const key of expectedTopKeys) {
      assert.ok(key in result, `expected top-level key "${key}" when lean is off (COLLECTOR_FIELD_PACK_LEAN=0)`);
    }

    const block = result.evidence_blocks[0];
    const expectedBlockKeys = [
      "id",
      "block_type",
      "source_type",
      "source_url",
      "source_label",
      "lang",
      "attribution_text",
      "text_value",
      "numeric_value",
      "list_value",
      "status",
    ];
    for (const key of expectedBlockKeys) {
      assert.ok(key in block, `expected evidence_block key "${key}" when lean is off (COLLECTOR_FIELD_PACK_LEAN=0)`);
    }
  } finally {
    delete process.env.COLLECTOR_FIELD_PACK_LEAN;
  }
});
