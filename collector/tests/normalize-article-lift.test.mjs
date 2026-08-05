import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRawItem } from "../collector/sources/normalize.mjs";

// Structural fixture mirroring the real payload shape produced by
// adapters/manual.mjs's enrichManualRow(): article data lands one level under
// input.payload_json.extracted_article, not at the top level.
function buildManualRowWithArticle(article) {
  return {
    title: "Test place",
    source_url: "https://example.com/place",
    payload_json: {
      submitted_url: "https://example.com/place",
      fetched_url: "https://example.com/place",
      extracted_article: article,
    },
  };
}

test("normalizeRawItem lifts article_body_text and article_section_texts into normalized_json", () => {
  const row = normalizeRawItem(
    buildManualRowWithArticle({
      headline: "Headline",
      excerpt: "Excerpt",
      body_text: "Full article body text.",
      section_texts: ["Section one text.", "Section two text."],
      page_title: "Page title",
    }),
    "manual"
  );

  assert.equal(row.normalized_json.article_body_text, "Full article body text.");
  assert.deepEqual(row.normalized_json.article_section_texts, ["Section one text.", "Section two text."]);
});

test("normalizeRawItem also accepts extracted_article at the top level of input", () => {
  const row = normalizeRawItem(
    {
      title: "Test place",
      extracted_article: {
        body_text: "Top-level body.",
        section_texts: ["Only section."],
      },
    },
    "manual"
  );

  assert.equal(row.normalized_json.article_body_text, "Top-level body.");
  assert.deepEqual(row.normalized_json.article_section_texts, ["Only section."]);
});

test("normalizeRawItem defaults article fields to empty when no article was extracted", () => {
  const row = normalizeRawItem({ title: "No article here" }, "manual");
  assert.equal(row.normalized_json.article_body_text, "");
  assert.deepEqual(row.normalized_json.article_section_texts, []);
});

test("normalizeRawItem lifts the full media list into normalized_json.media, preserving metadata_json", () => {
  const row = normalizeRawItem(
    {
      title: "Test place",
      media: [
        { media_url: "https://example.com/a.jpg", metadata_json: { source: "manual_url_metadata", role: "hero", order: 0 } },
        { media_url: "https://example.com/b.jpg", metadata_json: { source: "manual_url_metadata", role: "gallery", order: 1 } },
      ],
    },
    "manual"
  );

  assert.equal(row.normalized_json.media.length, 2);
  assert.equal(row.normalized_json.media[0].media_url, "https://example.com/a.jpg");
  assert.equal(row.normalized_json.media[0].metadata_json.role, "hero");
  assert.deepEqual(row.normalized_json.media, row.media);
});
