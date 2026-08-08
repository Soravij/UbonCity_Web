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

test("buildEvidenceCandidatesForNormalized: boilerplate in both description and editorial_summary produces 0 blocks", () => {
  const boilerplate = "Find local businesses, view maps and get driving directions in Google Maps.";
  const normalized = {
    title: "Test Place",
    description: boilerplate,
    editorial_summary: boilerplate,
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
    source_url: "https://www.google.com/maps/place/123",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  const matches = texts.filter((t) => t === boilerplate);
  assert.equal(matches.length, 0, "boilerplate must not leak through editorial_summary when description is already filtered");
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
// Fix 4: same-source dup — field-priority dedupe
// description and editorial_summary are always set to the same excerpt
// in buildNormalizedFromExtractedPayload. description (fact, priority 10)
// should win over editorial_summary (mention, priority 20).
// ============================================================

test("buildEvidenceCandidatesForNormalized: same text deduped — description (fact) wins over editorial_summary (mention) by field priority", () => {
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
    "fact (description) should win over mention (editorial_summary) by field priority"
  );
  const winner = candidates.find((c) => c.text_value === text);
  assert.equal(winner.payload_json.field, "description", "winner should be from description field");
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

test("regression guard: unrelated mentions with same prefix must NOT be collapsed", () => {
  // Two completely different texts that happen to start with the same words.
  // This proves exact-match dedupe does not drop legitimate content.
  const normalized = {
    title: "Test Place",
    description: "Great coffee shop by the river with amazing sunset views every evening",
    editorial_summary: "Great coffee shop by the river serves the best latte in town",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const texts = textValues(candidates);
  assert.ok(
    texts.includes("Great coffee shop by the river with amazing sunset views every evening"),
    "description must survive — different content despite same prefix"
  );
  assert.ok(
    texts.includes("Great coffee shop by the river serves the best latte in town"),
    "editorial_summary must survive — different content despite same prefix"
  );
});

test("field priority: article_body_text loses to description when text is the same", () => {
  const normalized = {
    title: "Test Place",
    description: "Shared text from both fields",
    article_body_text: "Shared text from both fields",
    article_section_texts: [],
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const text = "Shared text from both fields";
  const types = blockTypes(candidates, text);
  assert.equal(types.length, 1, "should appear only once");
  const winner = candidates.find((c) => c.text_value === text);
  assert.equal(winner.payload_json.field, "description", "description should win over article_body_text");
});

// ============================================================
// Field-priority proving cases:
// These tests prove that field priority (not block_type) decides the winner.
// Old logic (prefix dedupe + fact-wins-over-mention) would pick the fact;
// new logic (field priority) picks the higher-priority field regardless of block_type.
// Reverting FIELD_PRIORITY to old logic should make these FAIL.
// ============================================================

test("field-priority proof: editorial_summary (mention) beats classification (fact) when field priority is higher", () => {
  // editorial_summary priority 20 < classification priority 55
  // Old logic: classification is fact → fact wins → WRONG
  // New logic: editorial_summary has higher field priority → wins
  const normalized = {
    title: "Test Place",
    editorial_summary: "Place classification",
    category: "Place classification",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const text = "Place classification";
  const winner = candidates.find((c) => c.text_value === text);
  assert.ok(winner, "winner should exist");
  assert.equal(winner.payload_json.field, "editorial_summary", "editorial_summary (mention, priority 20) should beat classification (fact, priority 55) by field priority");
  assert.equal(winner.block_type, "mention", "winner should be mention, not fact");
});

test("field-priority proof: review_snippet beats location (fact) when field priority is higher", () => {
  // review_snippet priority 15 < location priority 60
  // Old logic: location is fact → fact wins → WRONG
  // New logic: review_snippet has higher field priority → wins
  const normalized = {
    title: "Test Place",
    review_snippets: [{ text: "456 River Road, Ubon Ratchathani", rating: 5 }],
    formatted_address: "456 River Road, Ubon Ratchathani",
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  const candidates = buildEvidenceCandidatesForNormalized(normalized, base);
  const text = "456 River Road, Ubon Ratchathani";
  const winner = candidates.find((c) => c.text_value === text);
  assert.ok(winner, "winner should exist");
  assert.equal(winner.payload_json.field, "review_snippet", "review_snippet (priority 15) should beat location (fact, priority 60) by field priority");
  assert.equal(winner.block_type, "review_snippet", "winner should be review_snippet, not fact");
});
