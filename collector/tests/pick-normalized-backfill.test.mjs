import assert from "node:assert/strict";
import test from "node:test";

import { pickNormalizedFromSourceRecords } from "../collector/sources/extracted-payload-normalizer.mjs";

test("normalized already has article fields -> returns unchanged", () => {
  const sourceRecords = [{
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
  assert.equal(result.article_body_text, "Existing body");
  assert.deepEqual(result.article_section_texts, ["Section 1"]);
  assert.equal(result.article_page_title, "Existing Page Title");
});

test("normalized exists but missing article fields -> backfills from extracted payload", () => {
  const sourceRecords = [{
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
  assert.equal(result.title, "Test Place", "should preserve existing fields");
  assert.equal(result.description, "Some description", "should preserve existing fields");
  assert.equal(result.article_body_text, "Extracted body text", "should backfill body text");
  assert.deepEqual(result.article_section_texts, ["Extracted section 1", "Extracted section 2"], "should backfill section texts");
  assert.equal(result.article_page_title, "Extracted Page Title", "should backfill page title");
});

test("no normalized_json at all -> falls back to buildNormalizedFromExtractedPayload", () => {
  const sourceRecords = [{
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
  assert.equal(result.title, "Extracted Title");
  assert.equal(result.article_body_text, "Full extracted body");
  assert.deepEqual(result.article_section_texts, ["Full section"]);
  assert.equal(result.article_page_title, "Full page title");
});

test("first row normalized = {} payload = null, second row has data -> picks from second row", () => {
  const sourceRecords = [
    {
      payload_json: {
        normalized_json: {},
        extracted_article: null,
      },
    },
    {
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
  assert.equal(result.title, "Second Row Place");
  assert.equal(result.description, "From second row");
  assert.equal(result.article_body_text, "Article body from second row");
  assert.deepEqual(result.article_section_texts, ["Section A"]);
  assert.equal(result.article_page_title, "Second Page");
});

test("all rows normalized = {} -> returns null without crash", () => {
  const sourceRecords = [
    { payload_json: { normalized_json: {} } },
    { payload_json: { normalized_json: {} } },
    { payload_json: { normalized_json: {} } },
  ];

  const result = pickNormalizedFromSourceRecords(sourceRecords);

  assert.equal(result, null, "should return null when all rows are empty");
});
