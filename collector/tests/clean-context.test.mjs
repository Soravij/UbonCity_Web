import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCleanStructuredContext,
  buildCleanContextSummary,
  validateCleanMinimum,
} from "../services/clean-context.mjs";

function createMockRepo({
  item,
  approvedContext = [],
  evidenceBlocks = [],
  selectedAssets = [],
  imageContext = null,
} = {}) {
  return {
    getItem(contentItemId) {
      if (!item || Number(item.id) !== Number(contentItemId)) return null;
      return { ...item };
    },
    listApprovedContextBlocks(contentItemId) {
      if (!item || Number(item.id) !== Number(contentItemId)) return [];
      return approvedContext.map((row) => ({ ...row }));
    },
    listEvidenceBlocks(contentItemId) {
      if (!item || Number(item.id) !== Number(contentItemId)) return [];
      return evidenceBlocks.map((row) => ({ ...row }));
    },
    listContentAssetsByItem(contentItemId) {
      if (!item || Number(item.id) !== Number(contentItemId)) return [];
      return selectedAssets.map((row) => ({ ...row }));
    },
    listApprovedImageContext(contentItemId) {
      if (!item || Number(item.id) !== Number(contentItemId)) {
        return { cover_url: null, selected_urls: [], gallery_urls: [], inline_urls: [] };
      }
      return imageContext
        ? { ...imageContext }
        : { cover_url: null, selected_urls: [], gallery_urls: [], inline_urls: [] };
    },
  };
}

function createBaseItem(overrides = {}) {
  return {
    id: 59,
    title: "TREE CAFE Rim Moon",
    type: "place",
    category: "cafes",
    lang: "th",
    slug: "tree-cafe-rim-moon",
    summary: "",
    description_raw: "raw description",
    description_clean: "",
    tags: ["manual-url", "wongnai.com"],
    source_name: "wongnai.com",
    source_url: "https://www.wongnai.com/restaurants/329973fR-tree-cafe-rim-moon",
    latitude: 15.224643237159952,
    longitude: 104.86452546627038,
    map_url: "",
    google_place_id: "",
    ...overrides,
  };
}

function createApprovedBlock(id, evidenceBlockId, overrides = {}) {
  return {
    id,
    evidence_block_id: evidenceBlockId,
    context_type: "fact",
    selected_text: `approved-${id}`,
    selected_numeric: null,
    selected_list_json: "[]",
    note: "",
    editor_note: "",
    sort_order: id,
    confidence: null,
    status: "active",
    evidence_block_type: "fact",
    evidence_source_type: "manual",
    evidence_source_url: "https://example.com/source",
    evidence_source_label: "example",
    evidence_source_record_type: null,
    evidence_source_record_id: null,
    evidence_lang: "th",
    ...overrides,
  };
}

function createEvidenceBlock(id, overrides = {}) {
  return {
    id,
    block_type: "fact",
    source_type: "manual",
    source_url: "https://example.com/source",
    source_label: "example",
    lang: "th",
    attribution_text: "",
    text_value: `raw-${id}`,
    numeric_value: null,
    list_value_json: "[]",
    status: "active",
    ...overrides,
  };
}

test("buildCleanStructuredContext returns full completeness for rich clean context", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 101, { editor_note: "lead with atmosphere" }),
      createApprovedBlock(2, 102),
      createApprovedBlock(3, 103),
      createApprovedBlock(4, 104),
    ],
    evidenceBlocks: [
      createEvidenceBlock(101),
      createEvidenceBlock(102),
      createEvidenceBlock(103),
      createEvidenceBlock(104),
      createEvidenceBlock(105, { status: "inactive" }),
    ],
    selectedAssets: [
      {
        asset_id: 901,
        role: "cover",
        selected_in_clean: 1,
        is_cover: 1,
        public_url: "https://example.com/cover.jpg",
      },
    ],
    imageContext: {
      cover_url: "https://example.com/cover.jpg",
      selected_urls: ["https://example.com/cover.jpg"],
      gallery_urls: ["https://example.com/cover.jpg"],
      inline_urls: [],
    },
  });

  const context = buildCleanStructuredContext(repo, 59);

  assert.equal(context.completeness.has_minimum_required, true);
  assert.equal(context.completeness.completeness_level, "full");
  assert.deepEqual(context.completeness.minimum_missing, []);
  assert.deepEqual(context.completeness.quality_gaps, []);
  assert.equal(context.evidence_policy.primary_source, "approved_context");
  assert.equal(context.approved_context.length, 4);
  assert.equal(context.evidence_blocks.length, 4);
  assert.equal(context.image_context.selected_count, 1);
  assert.equal(context.evidence_blocks[0].id, 104);
});

test("buildCleanStructuredContext matches structured context v1 contract", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      description_raw: "legacy raw should not leak",
      description_clean: "clean description",
      summary: "legacy summary should not leak",
      map_url: "https://maps.google.com/?q=15.2246,104.8645",
      google_place_id: "place-123",
    }),
    approvedContext: [
      createApprovedBlock(1, 701, { editor_note: "keep this as the primary source" }),
      createApprovedBlock(2, 702, { context_type: "review_snippet" }),
    ],
    evidenceBlocks: [
      createEvidenceBlock(701, { block_type: "fact" }),
      createEvidenceBlock(702, { block_type: "review_snippet" }),
    ],
    selectedAssets: [
      {
        asset_id: 1001,
        role: "cover",
        selected_in_clean: 1,
        is_cover: 1,
        public_url: "https://example.com/cover.jpg",
      },
    ],
    imageContext: {
      cover_url: "https://example.com/cover.jpg",
      selected_urls: ["https://example.com/cover.jpg"],
      gallery_urls: ["https://example.com/cover.jpg"],
      inline_urls: [],
    },
  });

  const context = buildCleanStructuredContext(repo, 59);

  assert.deepEqual(Object.keys(context), [
    "context_version",
    "content_item_id",
    "source",
    "item",
    "approved_context",
    "evidence_blocks",
    "image_context",
    "completeness",
    "evidence_policy",
    "task",
  ]);
  assert.deepEqual(Object.keys(context.item), [
    "id",
    "title",
    "type",
    "category",
    "lang",
    "slug",
    "description_clean",
    "tags",
    "source_name",
    "source_url",
    "latitude",
    "longitude",
    "map_url",
    "google_place_id",
  ]);
  assert.equal(context.item.description_clean, "clean description");
  assert.equal(Object.hasOwn(context.item, "description_raw"), false);
  assert.equal(Object.hasOwn(context.item, "summary"), false);
  assert.equal(context.evidence_policy.primary_source, "approved_context");
  assert.deepEqual(context.evidence_policy.secondary_sources, ["item", "image_context"]);
  assert.deepEqual(context.evidence_policy.supporting_sources, ["evidence_blocks"]);
  assert.equal(context.task.mode, "agent_generation_from_clean");
  assert.equal(context.task.output_contract, "existing");
  assert.equal(context.task.must_ground_in_approved_context, true);
  assert.equal(context.image_context.selected_count, 1);
  assert.equal(context.image_context.cover_count, 1);
});

test("buildCleanStructuredContext keeps all active evidence blocks from clean state", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [createApprovedBlock(1, 501)],
    evidenceBlocks: [
      createEvidenceBlock(501, { block_type: "fact" }),
      createEvidenceBlock(502, { block_type: "mention" }),
      createEvidenceBlock(503, { block_type: "media", text_value: "https://example.com/noisy.jpg" }),
      createEvidenceBlock(504, { block_type: "fact", status: "inactive" }),
    ],
  });

  const context = buildCleanStructuredContext(repo, 59);

  assert.deepEqual(context.evidence_blocks.map((row) => row.id), [503, 502, 501]);
  assert.ok(context.evidence_blocks.some((row) => row.block_type === "media"));
});

test("buildCleanStructuredContext keeps thin items usable without blocking", () => {
  const repo = createMockRepo({
    item: createBaseItem({ map_url: "https://maps.google.com/?q=15.2246,104.8645", source_url: "" }),
    approvedContext: [
      createApprovedBlock(1, 201, {
        selected_text: "",
        selected_numeric: 3.8,
      }),
    ],
    evidenceBlocks: [
      createEvidenceBlock(201, {
        block_type: "social_proof",
        text_value: "rating",
        numeric_value: 3.8,
      }),
    ],
  });

  const context = buildCleanStructuredContext(repo, 59);
  const validation = validateCleanMinimum(repo, 59);

  assert.equal(context.completeness.has_minimum_required, true);
  assert.equal(context.completeness.completeness_level, "thin");
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.missing, []);
  assert.deepEqual(validation.minimum_missing, []);
  assert.ok(validation.quality_gaps.includes("image_context"));
  assert.ok(validation.quality_gaps.includes("editor_note_richness"));
  assert.ok(context.completeness.missing_sections.includes("image_context"));
  assert.ok(context.completeness.missing_sections.includes("editor_note_richness"));
  assert.equal(context.image_context.selected_count, 0);
});

test("validateCleanMinimum blocks missing reference and missing approved context", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      source_url: "",
      map_url: "",
      google_place_id: "",
      latitude: null,
      longitude: null,
    }),
    approvedContext: [],
    evidenceBlocks: [createEvidenceBlock(301)],
  });

  const validation = validateCleanMinimum(repo, 59);
  const summary = buildCleanContextSummary(repo, 59);

  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("place_reference"));
  assert.ok(validation.missing.includes("approved_context"));
  assert.ok(validation.minimum_missing.includes("place_reference"));
  assert.ok(validation.minimum_missing.includes("approved_context"));
  assert.deepEqual(validation.quality_gaps, ["image_context", "editor_note_richness", "context_depth"]);
  assert.equal(validation.blocking_reasons.length, 2);
  assert.ok(validation.blocking_reasons.every((reason) => String(reason || "").includes("Agent")));
  assert.equal(summary.has_minimum_required, false);
  assert.equal(summary.completeness_level, "minimal");
  assert.deepEqual(summary.quality_gaps, ["image_context", "editor_note_richness", "context_depth"]);
});

test("buildCleanStructuredContext is stable across repeated calls with same repo data", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 401, { editor_note: "focus on route utility" }),
      createApprovedBlock(2, 402),
    ],
    evidenceBlocks: [
      createEvidenceBlock(401),
      createEvidenceBlock(402),
      createEvidenceBlock(403),
    ],
    selectedAssets: [
      {
        asset_id: 999,
        role: "gallery",
        selected_in_clean: 1,
        is_cover: 0,
        public_url: "https://example.com/gallery.jpg",
      },
    ],
    imageContext: {
      cover_url: null,
      selected_urls: ["https://example.com/gallery.jpg"],
      gallery_urls: ["https://example.com/gallery.jpg"],
      inline_urls: [],
    },
  });

  const first = buildCleanStructuredContext(repo, 59);
  const second = buildCleanStructuredContext(repo, 59);

  assert.deepEqual(second, first);
});
