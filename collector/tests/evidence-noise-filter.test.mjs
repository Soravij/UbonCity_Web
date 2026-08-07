import assert from "node:assert/strict";
import test from "node:test";

import { isJunkMediaUrl } from "../collector/sources/media-filter.mjs";
import { buildEvidenceCandidatesForNormalized, isBoilerplateDescription } from "../server/evidence-candidates.mjs";

// Helper to get text_values from evidence candidates
function textValues(candidates) {
  return candidates.map((c) => c.text_value).filter(Boolean);
}

function blockTypes(candidates, textValue) {
  return candidates
    .filter((c) => c.text_value === textValue)
    .map((c) => c.block_type);
}

// ============================================================
// Fix 1: media junk — static2.wongnai.com/static2/images/ must be filtered
// ============================================================

test("isJunkMediaUrl: static2.wongnai.com/static2/images/ is junk", () => {
  assert.ok(
    isJunkMediaUrl("https://static2.wongnai.com/static2/images/XWU7FL1.png"),
    "static2.wongnai.com/static2/images/ should be junk"
  );
});

test("isJunkMediaUrl: static.cdninstagram.com/rsrc.php is still junk", () => {
  assert.ok(
    isJunkMediaUrl("https://static.cdninstagram.com/rsrc.php/yr/r/rzWiSjZRxk5.webp"),
    "static.cdninstagram.com/rsrc.php should still be junk"
  );
});

test("isJunkMediaUrl: normal content image is not junk", () => {
  assert.ok(
    !isJunkMediaUrl("https://img.wongnai.com/p/800x0/2024/01/01/test-photo.jpg"),
    "normal wongnai content image should not be junk"
  );
});

// ============================================================
// Fix 2: self-referential — "Website: X" skipped when X === source_url
// (now with normalized comparison)
// ============================================================

test("buildEvidenceCandidatesForNormalized: no 'Website: X' when website equals source_url", () => {
  const normalized = {
    title: "Test Place",
    website_url: "https://www.example.com/place/123",
    source_url: "https://www.example.com/place/123",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
    source_url: "https://www.example.com/place/123",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  assert.ok(
    !texts.some((t) => t.startsWith("Website:")),
    "should not create Website block when it equals source_url"
  );
});

test("buildEvidenceCandidatesForNormalized: 'Website: X' created when website differs from source_url", () => {
  const normalized = {
    title: "Test Place",
    website_url: "https://www.example.com/different",
    source_url: "https://www.example.com/place/123",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
    source_url: "https://www.example.com/place/123",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  assert.ok(
    texts.includes("Website: https://www.example.com/different"),
    "should create Website block when it differs from source_url"
  );
});

test("website gate: trailing slash difference is normalized", () => {
  const normalized = {
    title: "Test",
    website_url: "https://example.com/place/",
    source_url: "https://example.com/place",
  };
  const base = { content_item_id: 1, source_record_id: 1, source_record_type: "source_records", source_url: "https://example.com/place" };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  assert.ok(!textValues(candidates).some((t) => t.startsWith("Website:")), "trailing slash should not cause duplicate Website block");
});

test("website gate: www difference is normalized", () => {
  const normalized = {
    title: "Test",
    website_url: "https://www.example.com/page",
    source_url: "https://example.com/page",
  };
  const base = { content_item_id: 1, source_record_id: 1, source_record_type: "source_records", source_url: "https://example.com/page" };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  assert.ok(!textValues(candidates).some((t) => t.startsWith("Website:")), "www difference should not cause duplicate Website block");
});

test("website gate: http vs https difference is normalized", () => {
  const normalized = {
    title: "Test",
    website_url: "http://example.com/page",
    source_url: "https://example.com/page",
  };
  const base = { content_item_id: 1, source_record_id: 1, source_record_type: "source_records", source_url: "https://example.com/page" };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  assert.ok(!textValues(candidates).some((t) => t.startsWith("Website:")), "http vs https should not cause duplicate Website block");
});

test("website gate: query string difference is normalized", () => {
  const normalized = {
    title: "Test",
    website_url: "https://example.com/page?utm_source=google&utm_medium=cpc",
    source_url: "https://example.com/page",
  };
  const base = { content_item_id: 1, source_record_id: 1, source_record_type: "source_records", source_url: "https://example.com/page" };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  assert.ok(!textValues(candidates).some((t) => t.startsWith("Website:")), "query string should not cause duplicate Website block");
});

test("website gate: fragment difference is normalized", () => {
  const normalized = {
    title: "Test",
    website_url: "https://example.com/page#section",
    source_url: "https://example.com/page",
  };
  const base = { content_item_id: 1, source_record_id: 1, source_record_type: "source_records", source_url: "https://example.com/page" };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  assert.ok(!textValues(candidates).some((t) => t.startsWith("Website:")), "fragment should not cause duplicate Website block");
});

// ============================================================
// Fix 3: boilerplate — meta description boilerplate filtered out
// ============================================================

test("isBoilerplateDescription: Google Maps boilerplate returns matched=true", () => {
  const result = isBoilerplateDescription("Find local businesses, view maps and get driving directions in Google Maps.", "https://www.google.com/maps/place/123");
  assert.equal(result.matched, true, "should match known Google Maps boilerplate");
  assert.equal(result.note, undefined, "matched=true should not have note");
});

test("isBoilerplateDescription: non-google source, non-boilerplate returns matched=false no note", () => {
  const result = isBoilerplateDescription("A cozy cafe near the river.", "https://www.wongnai.com/restaurants/123");
  assert.equal(result.matched, false);
  assert.equal(result.note, undefined);
});

test("isBoilerplateDescription: google.com source with unknown description returns extraction_note", () => {
  const result = isBoilerplateDescription("Some new Google description text.", "https://www.google.com/maps/place/456");
  assert.equal(result.matched, false, "unknown text should not match");
  assert.equal(result.note, "google_description_not_in_boilerplate_list", "google.com source should get extraction_note");
});

test("isBoilerplateDescription: maps.google.com source also gets note", () => {
  const result = isBoilerplateDescription("Updated Google boilerplate wording.", "https://maps.google.com/maps/place/789");
  assert.equal(result.matched, false);
  assert.equal(result.note, "google_description_not_in_boilerplate_list", "maps.google.com should also trigger note");
});

test("isBoilerplateDescription: no sourceUrl returns matched=false no note", () => {
  const result = isBoilerplateDescription("Whatever text.", "");
  assert.equal(result.matched, false);
  assert.equal(result.note, undefined);
});

test("buildEvidenceCandidatesForNormalized: Google Maps boilerplate description filtered", () => {
  const normalized = {
    title: "Test Place",
    description: "Find local businesses, view maps and get driving directions in Google Maps.",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  assert.ok(
    !texts.includes("Find local businesses, view maps and get driving directions in Google Maps."),
    "should filter Google Maps boilerplate description"
  );
});

test("buildEvidenceCandidatesForNormalized: real description is kept", () => {
  const normalized = {
    title: "Test Place",
    description: "A cozy cafe near the river with great coffee.",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  assert.ok(
    texts.includes("A cozy cafe near the river with great coffee."),
    "should keep real description"
  );
});

test("buildEvidenceCandidatesForNormalized: google.com unknown description gets extraction_note in payload_json", () => {
  const normalized = {
    title: "Test Place",
    description: "New Google wording here.",
    source_url: "https://www.google.com/maps/place/123",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
    source_url: "https://www.google.com/maps/place/123",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const descCandidate = candidates.find((c) => c.payload_json?.field === "description");
  assert.ok(descCandidate, "should have description candidate");
  assert.equal(
    descCandidate.payload_json.extraction_note,
    "google_description_not_in_boilerplate_list",
    "should carry extraction_note for google.com unknown description"
  );
});

// ============================================================
// Fix 4: same-source dup — dedupe with prefix truncation handling
// ============================================================

test("buildEvidenceCandidatesForNormalized: same text deduped — fact wins over mention", () => {
  const normalized = {
    title: "Test Place",
    description: "Great coffee shop by the river",
    editorial_summary: "Great coffee shop by the river",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const text = "Great coffee shop by the river";
  const types = blockTypes(candidates, text);

  assert.equal(types.length, 1, `text "${text}" should appear only once, got ${types.length}`);
  assert.ok(
    types.includes("fact") && !types.includes("mention"),
    "fact should win over mention when text is the same"
  );
});

test("buildEvidenceCandidatesForNormalized: different texts keep both fact and mention", () => {
  const normalized = {
    title: "Test Place",
    description: "Great coffee shop by the river",
    editorial_summary: "Popular spot for locals and tourists alike",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  assert.ok(texts.includes("Great coffee shop by the river"), "should keep description");
  assert.ok(texts.includes("Popular spot for locals and tourists alike"), "should keep editorial_summary");
});

test("dedupe prefix: truncated version ending with ... is dropped when full version exists", () => {
  const normalized = {
    title: "Test Place",
    description: "This is a long description about a place that goes on for quite a while",
    editorial_summary: "This is a long description about a place that goes on for quite a...",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  const fullText = "This is a long description about a place that goes on for quite a while";
  const shortText = "This is a long description about a place that goes on for quite a...";

  assert.ok(texts.includes(fullText), "full version should be kept");
  assert.ok(!texts.includes(shortText), "truncated ... version should be dropped");
});

test("dedupe prefix: full version replaces truncated version when truncated comes first", () => {
  const normalized = {
    title: "Test Place",
    editorial_summary: "This is a long description about a place that goes on for quite a...",
    description: "This is a long description about a place that goes on for quite a while",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  const fullText = "This is a long description about a place that goes on for quite a while";
  const shortText = "This is a long description about a place that goes on for quite a...";

  assert.ok(texts.includes(fullText), "full version should be kept regardless of order");
  assert.ok(!texts.includes(shortText), "truncated ... version should be dropped regardless of order");
});

test("dedupe prefix: unrelated ... text is not deduped", () => {
  const normalized = {
    title: "Test Place",
    description: "Something completely different...",
    editorial_summary: "Another unrelated text that is not a prefix at all",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  assert.ok(texts.includes("Something completely different..."), "unrelated ... text should be kept");
  assert.ok(texts.includes("Another unrelated text that is not a prefix at all"), "unrelated text should be kept");
});
