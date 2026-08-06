import assert from "node:assert/strict";
import test from "node:test";

import { pickNormalizedFromSourceRecords } from "../collector/sources/extracted-payload-normalizer.mjs";

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
