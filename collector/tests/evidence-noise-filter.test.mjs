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
    !texts.includes("Website: https://www.example.com/place/123"),
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

// ============================================================
// Fix 3: boilerplate — meta description boilerplate filtered out
// ============================================================

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

// ============================================================
// Fix 4: same-source dup — same text must not appear as both fact and mention
// ============================================================

test("buildEvidenceCandidatesForNormalized: same text deduped — fact wins over mention", () => {
  // Use a normalized object that would produce same text in different block types
  // The description field creates a "fact" block, and editorial_summary creates a "mention" block
  // If they have the same text, only fact should survive
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

  // Should only appear once
  assert.equal(types.length, 1, `text "${text}" should appear only once, got ${types.length}`);

  // Should be fact, not mention
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
  assert.ok(
    texts.includes("Great coffee shop by the river"),
    "should keep description"
  );
  assert.ok(
    texts.includes("Popular spot for locals and tourists alike"),
    "should keep editorial_summary"
  );
});
