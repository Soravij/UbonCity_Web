import assert from "node:assert/strict";
import test from "node:test";

import { pickNormalizedFromSourceRecords, buildNormalizedFromExtractedPayload, hasUsableNormalizedKeys } from "../collector/sources/extracted-payload-normalizer.mjs";
import { makeEvidenceSignature } from "../server/evidence-signature.mjs";

test("normalized already has article fields -> returns unchanged", () => {
  const sourceRecords = [{
    id: 10,
    payload_json: {
      normalized_json: {
        title: "Test Place",
        article_body_text: "Existing body",
        article_section_texts: ["Section 1"],
        article_page_title: "Existing Page Title",
      },
      extracted_article: {
        body_text: "Should NOT overwrite",
        section_texts: ["Should NOT overwrite"],
        page_title: "Should NOT overwrite",
      },
    },
  }];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.ok(result, "should return a result");
  assert.ok(result.normalized, "should have normalized");
  assert.equal(result.normalized.article_body_text, "Existing body");
  assert.deepEqual(result.normalized.article_section_texts, ["Section 1"]);
  assert.equal(result.normalized.article_page_title, "Existing Page Title");
  assert.equal(result.articleSourceRecordId, 10);
});

test("normalized exists but missing article fields -> backfills from extracted payload", () => {
  const sourceRecords = [{
    id: 20,
    payload_json: {
      normalized_json: {
        title: "Test Place",
        description: "Some description",
      },
      extracted_article: {
        body_text: "Extracted body text",
        section_texts: ["Extracted section 1", "Extracted section 2"],
        page_title: "Extracted Page Title",
      },
    },
  }];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.ok(result, "should return a result");
  assert.ok(result.normalized, "should have normalized");
  assert.equal(result.normalized.title, "Test Place", "should preserve existing fields");
  assert.equal(result.normalized.description, "Some description", "should preserve existing fields");
  assert.equal(result.normalized.article_body_text, "Extracted body text", "should backfill body text");
  assert.deepEqual(result.normalized.article_section_texts, ["Extracted section 1", "Extracted section 2"], "should backfill section texts");
  assert.equal(result.normalized.article_page_title, "Extracted Page Title", "should backfill page title");
  assert.equal(result.articleSourceRecordId, 20);
});

test("no normalized_json at all -> falls back to buildNormalizedFromExtractedPayload", () => {
  const sourceRecords = [{
    id: 30,
    payload_json: {
      extracted_metadata: {
        title: "Extracted Title",
        description: "Extracted description",
      },
      extracted_article: {
        body_text: "Full extracted body",
        section_texts: ["Full section"],
        page_title: "Full page title",
      },
    },
  }];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.ok(result, "should return a result");
  assert.ok(result.normalized, "should have normalized");
  assert.equal(result.normalized.title, "Extracted Title");
  assert.equal(result.normalized.article_body_text, "Full extracted body");
  assert.deepEqual(result.normalized.article_section_texts, ["Full section"]);
  assert.equal(result.normalized.article_page_title, "Full page title");
  assert.equal(result.articleSourceRecordId, 30);
});

test("first row normalized = {} payload = null, second row has data -> picks from second row", () => {
  const sourceRecords = [
    {
      id: 41,
      payload_json: {
        normalized_json: {},
        extracted_article: null,
      },
    },
    {
      id: 42,
      payload_json: {
        normalized_json: {
          title: "Second Row Place",
          description: "From second row",
        },
        extracted_article: {
          body_text: "Article body from second row",
          section_texts: ["Section A"],
          page_title: "Second Page",
        },
      },
    },
  ];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.ok(result, "should return a result");
  assert.ok(result.normalized, "should have normalized");
  assert.equal(result.normalized.title, "Second Row Place");
  assert.equal(result.normalized.description, "From second row");
  assert.equal(result.normalized.article_body_text, "Article body from second row");
  assert.deepEqual(result.normalized.article_section_texts, ["Section A"]);
  assert.equal(result.normalized.article_page_title, "Second Page");
  assert.equal(result.articleSourceRecordId, 42);
});

test("all rows normalized = {} -> returns null without crash", () => {
  const sourceRecords = [
    { id: 51, payload_json: { normalized_json: {} } },
    { id: 52, payload_json: { normalized_json: {} } },
    { id: 53, payload_json: { normalized_json: {} } },
  ];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.equal(result, null, "should return null when all rows are empty");
});

test("article comes from record B but normalized picked from record A -> articleSourceRecordId = B", () => {
  const sourceRecords = [
    {
      id: 61,
      payload_json: {
        normalized_json: {
          title: "Place from Record A",
          description: "Picked record",
        },
      },
    },
    {
      id: 62,
      payload_json: {
        normalized_json: {
          title: "Place from Record B",
        },
        extracted_article: {
          body_text: "Article body from Record B",
          section_texts: ["Section from B"],
          page_title: "Page from B",
        },
      },
    },
  ];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.ok(result, "should return a result");
  assert.ok(result.normalized, "should have normalized");
  assert.equal(result.normalized.title, "Place from Record A", "should pick from first row with usable normalized");
  assert.equal(result.normalized.article_body_text, "Article body from Record B", "should backfill article from row B");
  assert.deepEqual(result.normalized.article_section_texts, ["Section from B"], "should backfill sections from row B");
  assert.equal(result.normalized.article_page_title, "Page from B", "should backfill page title from row B");
  assert.equal(result.articleSourceRecordId, 62, "articleSourceRecordId must be record B (62), not record A (61)");
});

test("makeEvidenceSignature: same text from different source_record_id produces different signatures", () => {
  const blockA = {
    block_type: "mention",
    source_type: "google_maps",
    source_url: "https://example.com",
    text_value: "Same text content",
    numeric_value: null,
    list_value: [],
    source_record_id: "10",
  };
  const blockB = {
    block_type: "mention",
    source_type: "google_maps",
    source_url: "https://example.com",
    text_value: "Same text content",
    numeric_value: null,
    list_value: [],
    source_record_id: "20",
  };

  const sigA = makeEvidenceSignature(blockA);
  const sigB = makeEvidenceSignature(blockB);

  assert.notEqual(sigA, sigB, "same text from different source_record_id must produce different signatures");
});

test("makeEvidenceSignature: same text from same source_record_id produces same signature", () => {
  const blockA = {
    block_type: "mention",
    source_type: "google_maps",
    source_url: "https://example.com",
    text_value: "Same text content",
    numeric_value: null,
    list_value: [],
    source_record_id: "10",
  };
  const blockB = {
    block_type: "mention",
    source_type: "google_maps",
    source_url: "https://example.com",
    text_value: "Same text content",
    numeric_value: null,
    list_value: [],
    source_record_id: "10",
  };

  const sigA = makeEvidenceSignature(blockA);
  const sigB = makeEvidenceSignature(blockB);

  assert.equal(sigA, sigB, "same text from same source_record_id must produce same signature");
});

test("buildNormalizedFromExtractedPayload: 3 records from different sources each produce usable normalized", () => {
  const records = [
    {
      id: 101,
      source_type: "google_maps",
      source_url: "https://maps.google.com/1",
      source_name: "Google Maps",
      payload_json: {
        extracted_metadata: { title: "Place A", description: "Desc A" },
        extracted_article: { body_text: "Body A", section_texts: ["S1A"], page_title: "Page A" },
      },
    },
    {
      id: 102,
      source_type: "facebook",
      source_url: "https://facebook.com/2",
      source_name: "Facebook",
      payload_json: {
        extracted_metadata: { title: "Place B", description: "Desc B" },
        extracted_article: { body_text: "Body B", section_texts: ["S1B"], page_title: "Page B" },
      },
    },
    {
      id: 103,
      source_type: "ryoiireview",
      source_url: "https://ryoiireview.com/3",
      source_name: "Ryoiireview",
      payload_json: {
        extracted_metadata: { title: "Place C", description: "Desc C" },
        extracted_article: { body_text: "Body C", section_texts: ["S1C"], page_title: "Page C" },
      },
    },
  ];

  const results = records.map((r) => ({
    id: r.id,
    normalized: buildNormalizedFromExtractedPayload(r.payload_json, r),
  }));

  for (const r of results) {
    assert.ok(r.normalized, `record ${r.id} should produce usable normalized`);
    assert.ok(r.normalized.title, `record ${r.id} should have title`);
  }

  assert.equal(results[0].normalized.title, "Place A");
  assert.equal(results[1].normalized.title, "Place B");
  assert.equal(results[2].normalized.title, "Place C");
});

test("pickNormalizedFromSourceRecords: first row normalized = {} skips, second row with extracted_metadata still works", () => {
  const sourceRecords = [
    {
      id: 201,
      payload_json: {
        normalized_json: {},
      },
    },
    {
      id: 202,
      payload_json: {
        extracted_metadata: {
          title: "From Extracted",
          description: "Extracted desc",
        },
        extracted_article: {
          body_text: "Extracted body",
          section_texts: ["Extracted section"],
          page_title: "Extracted page",
        },
      },
    },
  ];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.ok(result, "should return a result");
  assert.ok(result.normalized, "should have normalized");
  assert.equal(result.normalized.title, "From Extracted");
  assert.equal(result.normalized.article_body_text, "Extracted body");
  assert.equal(result.articleSourceRecordId, 202);
});

test("hasUsableNormalizedKeys: empty object returns false", () => {
  assert.equal(hasUsableNormalizedKeys({}), false, "empty object must be rejected");
  assert.equal(hasUsableNormalizedKeys(null), false, "null must be rejected");
  assert.equal(hasUsableNormalizedKeys(undefined), false, "undefined must be rejected");
  assert.equal(hasUsableNormalizedKeys(123), false, "non-object must be rejected");
});

test("hasUsableNormalizedKeys: object with only source_url returns true", () => {
  assert.equal(hasUsableNormalizedKeys({ source_url: "https://example.com" }), true);
});

test("hasUsableNormalizedKeys: object with title returns true", () => {
  assert.equal(hasUsableNormalizedKeys({ title: "Place" }), true);
});

test("pickNormalizedFromSourceRecords: all rows normalized = {} with source_url in payload -> returns null", () => {
  const sourceRecords = [
    { id: 301, payload_json: { normalized_json: {}, source_url: "https://a.com" } },
    { id: 302, payload_json: { normalized_json: {}, source_url: "https://b.com" } },
  ];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.equal(result, null, "all-empty normalized should return null even if payload has source_url");
});

test("hasUsableNormalizedKeys: whitespace-only string fields return false", () => {
  assert.equal(hasUsableNormalizedKeys({ title: "   " }), false, "whitespace-only title must be rejected");
  assert.equal(hasUsableNormalizedKeys({ description: "  \t  " }), false, "whitespace-only description must be rejected");
  assert.equal(hasUsableNormalizedKeys({ source_url: " " }), false, "whitespace-only source_url must be rejected");
});

test("hasUsableNormalizedKeys: numeric 0 is valid for latitude/longitude/rating", () => {
  assert.equal(hasUsableNormalizedKeys({ latitude: 0 }), true, "latitude=0 must be accepted");
  assert.equal(hasUsableNormalizedKeys({ longitude: 0 }), true, "longitude=0 must be accepted");
  assert.equal(hasUsableNormalizedKeys({ rating: 0 }), true, "rating=0 must be accepted");
});

test("hasUsableNormalizedKeys: normal object with real title returns true", () => {
  assert.equal(hasUsableNormalizedKeys({ title: "Real Place" }), true);
  assert.equal(hasUsableNormalizedKeys({ description: "A description" }), true);
  assert.equal(hasUsableNormalizedKeys({ image: "https://img.url" }), true);
});
