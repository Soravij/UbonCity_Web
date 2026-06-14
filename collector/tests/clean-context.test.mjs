import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCleanStructuredContext,
  buildCleanContextSummary,
  buildFieldPackContractFromCleanContext,
  validateCleanMinimum,
} from "../services/clean-context.mjs";

function createMockRepo({
  item,
  approvedContext = [],
  evidenceBlocks = [],
  selectedAssets = [],
  selectedReferenceMedia = [],
  localImageContext = null,
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
    listApprovedLocalImageContext(contentItemId) {
      if (!item || Number(item.id) !== Number(contentItemId)) {
        return { cover_url: null, selected_urls: [], gallery_urls: [], inline_urls: [], assets: [] };
      }
      return localImageContext
        ? {
            ...localImageContext,
            selected_urls: Array.isArray(localImageContext.selected_urls) ? [...localImageContext.selected_urls] : [],
            gallery_urls: Array.isArray(localImageContext.gallery_urls) ? [...localImageContext.gallery_urls] : [],
            inline_urls: Array.isArray(localImageContext.inline_urls) ? [...localImageContext.inline_urls] : [],
            assets: Array.isArray(localImageContext.assets) ? localImageContext.assets.map((row) => ({ ...row })) : [],
          }
        : { cover_url: null, selected_urls: [], gallery_urls: [], inline_urls: [], assets: [] };
    },
    listReferenceMediaByItem(contentItemId, options = {}) {
      if (!item || Number(item.id) !== Number(contentItemId)) return [];
      const rows = selectedReferenceMedia.map((row) => ({ ...row }));
      if (options?.selectedOnly === true) return rows.filter((row) => row.selected_for_ai === true);
      return rows;
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

function buildContractFromRepo(repo, contentItemId = 59) {
  const cleanContext = buildCleanStructuredContext(repo, contentItemId);
  return buildFieldPackContractFromCleanContext(cleanContext);
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
    localImageContext: {
      cover_url: "https://example.com/cover.jpg",
      selected_urls: ["https://example.com/cover.jpg"],
      gallery_urls: ["https://example.com/cover.jpg"],
      inline_urls: [],
      assets: [
        {
          asset_id: 901,
          role: "cover",
          selected_in_clean: 1,
          is_cover: 1,
          public_url: "https://example.com/cover.jpg",
        },
      ],
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
    localImageContext: {
      cover_url: "https://example.com/cover.jpg",
      selected_urls: ["https://example.com/cover.jpg"],
      gallery_urls: ["https://example.com/cover.jpg"],
      inline_urls: [],
      assets: [
        {
          asset_id: 1001,
          role: "cover",
          selected_in_clean: 1,
          is_cover: 1,
          public_url: "https://example.com/cover.jpg",
        },
      ],
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
    "reference_media_context",
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

test("buildCleanStructuredContext keeps selected reference media outside image_context", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [createApprovedBlock(1, 801)],
    evidenceBlocks: [createEvidenceBlock(801, { block_type: "media" })],
    selectedAssets: [],
    selectedReferenceMedia: [
      {
        reference_media_id: "rm:1234567890abcdef",
        source_kind: "evidence_block",
        source_label: "facebook",
        url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
        preview_url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
        file_name: "example.jpg",
        selected_for_ai: true,
        is_external: true,
      },
    ],
    localImageContext: {
      cover_url: null,
      selected_urls: [],
      gallery_urls: [],
      inline_urls: [],
      assets: [],
    },
  });

  const context = buildCleanStructuredContext(repo, 59);

  assert.equal(context.image_context.selected_count, 0);
  assert.equal(context.image_context.cover_url, null);
  assert.equal(context.reference_media_context.selected_count, 1);
  assert.deepEqual(context.reference_media_context.selected_urls, ["https://scontent.fubp1-1.fna.fbcdn.net/example.jpg"]);
  assert.equal(context.reference_media_context.assets[0].reference_media_id, "rm:1234567890abcdef");
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
    localImageContext: {
      cover_url: null,
      selected_urls: ["https://example.com/gallery.jpg"],
      gallery_urls: ["https://example.com/gallery.jpg"],
      inline_urls: [],
      assets: [
        {
          asset_id: 999,
          role: "gallery",
          selected_in_clean: 1,
          is_cover: 0,
          public_url: "https://example.com/gallery.jpg",
        },
      ],
    },
  });

  const first = buildCleanStructuredContext(repo, 59);
  const second = buildCleanStructuredContext(repo, 59);

  assert.deepEqual(second, first);
});

test("buildCleanStructuredContext excludes polluted external content assets from image_context", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [createApprovedBlock(1, 901)],
    evidenceBlocks: [createEvidenceBlock(901)],
    selectedAssets: [
      {
        asset_id: 1101,
        role: "gallery",
        selected_in_clean: 1,
        is_cover: 0,
        public_url: "https://static2.wongnai.com/static2/images/XWU7FL1.png",
        storage_disk: "remote",
        storage_path: "https://static2.wongnai.com/static2/images/XWU7FL1.png",
        mime_type: "image/png",
      },
    ],
    localImageContext: {
      cover_url: null,
      selected_urls: [],
      gallery_urls: [],
      inline_urls: [],
      assets: [],
    },
  });

  const context = buildCleanStructuredContext(repo, 59);

  assert.equal(context.image_context.cover_url, null);
  assert.equal(context.image_context.cover_count, 0);
  assert.equal(context.image_context.selected_count, 0);
  assert.deepEqual(context.image_context.selected_urls, []);
  assert.deepEqual(context.image_context.gallery_urls, []);
  assert.deepEqual(context.image_context.assets, []);
  assert.ok(context.completeness.quality_gaps.includes("image_context"));
});

test("buildCleanStructuredContext keeps only local publish assets in image_context when polluted rows exist", () => {
  const localUrl = "/media/uploads/local-gallery.jpg";
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [createApprovedBlock(1, 902)],
    evidenceBlocks: [createEvidenceBlock(902)],
    selectedAssets: [
      {
        asset_id: 1201,
        role: "gallery",
        selected_in_clean: 1,
        is_cover: 0,
        public_url: "https://static2.wongnai.com/static2/images/XWU7FL1.png",
        storage_disk: "remote",
        storage_path: "https://static2.wongnai.com/static2/images/XWU7FL1.png",
        mime_type: "image/png",
      },
      {
        asset_id: 1202,
        role: "gallery",
        selected_in_clean: 1,
        is_cover: 0,
        public_url: localUrl,
        storage_disk: "local",
        storage_path: "uploads/local-gallery.jpg",
        mime_type: "image/jpeg",
      },
    ],
    selectedReferenceMedia: [
      {
        reference_media_id: "rm:1234567890abcdef",
        source_kind: "evidence_block",
        source_label: "facebook",
        url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
        preview_url: "https://scontent.fubp1-1.fna.fbcdn.net/example.jpg",
        file_name: "example.jpg",
        selected_for_ai: true,
        is_external: true,
      },
    ],
    localImageContext: {
      cover_url: null,
      selected_urls: [localUrl],
      gallery_urls: [localUrl],
      inline_urls: [],
      assets: [
        {
          asset_id: 1202,
          role: "gallery",
          selected_in_clean: 1,
          is_cover: 0,
          public_url: localUrl,
        },
      ],
    },
  });

  const context = buildCleanStructuredContext(repo, 59);

  assert.deepEqual(context.image_context.selected_urls, [localUrl]);
  assert.deepEqual(context.image_context.gallery_urls, [localUrl]);
  assert.equal(context.image_context.selected_count, 1);
  assert.equal(context.image_context.assets.length, 1);
  assert.equal(context.image_context.assets[0].asset_id, 1202);
  assert.deepEqual(context.reference_media_context.selected_urls, ["https://scontent.fubp1-1.fna.fbcdn.net/example.jpg"]);
  assert.equal(context.reference_media_context.selected_count, 1);
});

test("field pack contract does not add hotel or event blockers to cafe/place items", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      map_url: "https://maps.google.com/?q=15.2246,104.8645",
      google_place_id: "place-123",
    }),
    approvedContext: [
      createApprovedBlock(1, 601, {
        context_type: "fact",
        selected_text: "name: TREE CAFE Rim Moon",
      }),
      createApprovedBlock(2, 602, {
        context_type: "ambience",
        selected_text: "สวนร่มรื่นและมีมุมถ่ายรูป",
      }),
      createApprovedBlock(3, 603, {
        context_type: "tip",
        selected_text: "แนะนำมาช่วงบ่ายแก่",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);
  const blockers = contract.verification.publish_blockers;
  const needs = contract.verification.needs_verification;

  assert.equal(contract.taxonomy_version, "page_curation_taxonomy_v1");
  assert.ok(!blockers.includes("price_range"));
  assert.ok(!blockers.includes("restaurant_features"));
  assert.ok(!blockers.includes("hotel_amenities"));
  assert.ok(!blockers.includes("event_date_hints"));
  assert.ok(!blockers.includes("ticket_hints"));
  assert.ok(needs.includes("price_range"));
  assert.ok(needs.includes("restaurant_features"));
  assert.ok(!needs.includes("hotel_amenities"));
  assert.ok(!needs.includes("event_date_hints"));
  assert.ok(!needs.includes("ticket_hints")); // cafe/place scope should not include event checks
});

test("field pack contract keeps hotel checks scoped to hotel categories", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      type: "place",
      category: "hotel",
      map_url: "https://maps.google.com/?q=15.2246,104.8645",
      google_place_id: "place-123",
    }),
    approvedContext: [
      createApprovedBlock(1, 701, {
        context_type: "fact",
        selected_text: "name: Riverside Stay",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);
  const blockers = contract.verification.publish_blockers;
  const needs = contract.verification.needs_verification;

  assert.ok(needs.includes("hotel_amenities"));
  assert.ok(needs.includes("checkin_checkout"));
  assert.ok(!blockers.includes("hotel_amenities"));
  assert.ok(!blockers.includes("checkin_checkout"));
  assert.ok(!blockers.includes("event_date_hints"));
  assert.ok(!blockers.includes("ticket_hints"));
});

test("field pack contract keeps event checks scoped to event items", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      type: "event",
      category: "event",
      map_url: "https://maps.google.com/?q=15.2246,104.8645",
      google_place_id: "place-123",
    }),
    approvedContext: [
      createApprovedBlock(1, 801, {
        context_type: "fact",
        selected_text: "name: Lantern Festival",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);
  const blockers = contract.verification.publish_blockers;
  const needs = contract.verification.needs_verification;

  assert.ok(needs.includes("event_date_hints"));
  assert.ok(needs.includes("ticket_hints"));
  assert.ok(!blockers.includes("ticket_hints"));
  assert.ok(blockers.includes("event_date_hints"));
  assert.ok(!blockers.includes("hotel_amenities"));
  assert.ok(!blockers.includes("checkin_checkout"));
});

test("field pack contract keeps editorial ambience and tip text out of verified facts", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      map_url: "https://maps.google.com/?q=15.2246,104.8645",
      google_place_id: "place-123",
    }),
    approvedContext: [
      createApprovedBlock(1, 901, {
        context_type: "ambience",
        selected_text: "บรรยากาศสวนร่มรื่น",
      }),
      createApprovedBlock(2, 902, {
        context_type: "tip",
        selected_text: "ควรมาช่วงเย็น",
      }),
      createApprovedBlock(3, 903, {
        context_type: "fact",
        selected_text: "name: TREE CAFE Rim Moon",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.ok(!contract.verification.verified_facts.some((text) => text.includes("บรรยากาศสวนร่มรื่น")));
  assert.ok(!contract.verification.verified_facts.some((text) => text.includes("ควรมาช่วงเย็น")));
  assert.ok(contract.verification.verified_facts.some((text) => text.includes("name: TREE CAFE Rim Moon")));
});

test("field pack contract moves editor_note into local notes", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      map_url: "https://maps.google.com/?q=15.2246,104.8645",
      google_place_id: "place-123",
    }),
    approvedContext: [
      createApprovedBlock(1, 1001, {
        context_type: "fact",
        selected_text: "name: TREE CAFE Rim Moon",
        editor_note: "เสียงดีตอนบ่ายและควรชี้มุมถ่ายรูปฝั่งสวน",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.ok(contract.universal_curation_profile.local_notes.includes("เสียงดีตอนบ่ายและควรชี้มุมถ่ายรูปฝั่งสวน"));
});


test("field pack contract rejects URL values from photo spots taxonomy", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 1101, {
        context_type: "photo_spot",
        selected_text: "https://example.com/gallery/front-corner",
      }),
      createApprovedBlock(2, 1102, {
        context_type: "photo_spot",
        selected_text: "corner table photo spot",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.deepEqual(contract.place_profile.photo_spots, ["corner table photo spot"]);
  assert.ok(!contract.place_profile.photo_spots.some((value) => value.includes("https://")));
});

test("field pack contract rejects URL values from good to know taxonomy", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 1201, {
        context_type: "tip",
        selected_text: "https://example.com/opening-hours",
      }),
      createApprovedBlock(2, 1202, {
        context_type: "tip",
        selected_text: "Check opening hours before visiting",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.deepEqual(contract.universal_curation_profile.good_to_know, ["Check opening hours before visiting"]);
  assert.ok(!contract.universal_curation_profile.good_to_know.some((value) => value.includes("https://")));
});

test("field pack contract keeps generic tips out of restaurant features", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 1301, {
        context_type: "tip",
        selected_text: "Best to visit in the late afternoon",
      }),
      createApprovedBlock(2, 1302, {
        context_type: "restaurant_feature",
        selected_text: "Dessert and coffee counter with several drink choices",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.deepEqual(contract.restaurant_profile.restaurant_features, ["Dessert and coffee counter with several drink choices"]);
  assert.ok(!contract.restaurant_profile.restaurant_features.some((value) => value.includes("late afternoon")));
});

test("field pack contract only derives price signals from price contexts", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 1401, {
        context_type: "tip",
        selected_text: "This photo corner gets more attention than the food price",
      }),
      createApprovedBlock(2, 1402, {
        context_type: "price",
        selected_text: "Price starts around 80 THB",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.equal(contract.restaurant_profile.price_signals, "Price starts around 80 THB");
});

test("field pack contract only derives cuisine type from cuisine_type context", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 1451, {
        context_type: "fact",
        selected_text: "Thai fusion cafe with varied menu",
      }),
      createApprovedBlock(2, 1452, {
        context_type: "cuisine_type",
        selected_text: "Thai fusion",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.equal(contract.restaurant_profile.cuisine_type, "Thai fusion");
});

test("field pack contract only derives view type from view_type context", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 1461, {
        context_type: "fact",
        selected_text: "4.5 stars and popular scenic stop",
      }),
      createApprovedBlock(2, 1462, {
        context_type: "fact",
        selected_text: "https://example.com/source/river-view",
      }),
      createApprovedBlock(3, 1463, {
        context_type: "view_type",
        selected_text: "river view",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.equal(contract.place_profile.view_type, "river view");
});

test("field pack contract only derives visit duration from visit_duration context", () => {
  const repo = createMockRepo({
    item: createBaseItem(),
    approvedContext: [
      createApprovedBlock(1, 1471, {
        context_type: "opening_hours",
        selected_text: "Open 09:00-18:00 daily",
      }),
      createApprovedBlock(2, 1472, {
        context_type: "visit_duration",
        selected_text: "about 1-2 hours",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.equal(contract.place_profile.visit_duration, "about 1-2 hours");
});

test("field pack contract adds category mismatch as warning only without changing category", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      category: "attractions",
      title: "Matcha Garden Cafe",
    }),
    approvedContext: [
      createApprovedBlock(1, 1501, {
        context_type: "menu",
        selected_text: "Matcha and coffee menu",
      }),
      createApprovedBlock(2, 1502, {
        context_type: "restaurant_feature",
        selected_text: "Seating area for cafe visitors",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.equal(contract.core_factual_fields.category, "attractions");
  assert.ok(contract.curation_signals.content_risks.includes("category_mismatch"));
  assert.ok(contract.verification.needs_verification.includes("category"));
  assert.ok(!contract.verification.publish_blockers.includes("category_mismatch"));
});

test("field pack contract keeps ticket hints as warning only while event date remains blocker", () => {
  const repo = createMockRepo({
    item: createBaseItem({
      type: "event",
      category: "event",
    }),
    approvedContext: [
      createApprovedBlock(1, 1601, {
        context_type: "ticketing",
        selected_text: "",
        selected_list_json: "[]",
      }),
    ],
  });

  const contract = buildContractFromRepo(repo);

  assert.ok(contract.verification.needs_verification.includes("ticket_hints"));
  assert.ok(contract.verification.publish_blockers.includes("event_date_hints"));
  assert.ok(!contract.verification.publish_blockers.includes("ticket_hints"));
});
