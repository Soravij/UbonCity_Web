import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSeoSuggestionPrompt,
  buildSeoSuggestionRequestContext,
  normalizeSeoSuggestion,
  stripHtmlToPlainText,
} from "../services/seo-agent.mjs";

test("stripHtmlToPlainText removes tags and collapses whitespace", () => {
  assert.equal(
    stripHtmlToPlainText("<p>Hello <strong>travelers</strong></p><p>next</p>"),
    "Hello travelers next"
  );
});

test("buildSeoSuggestionPrompt includes saved SEO agent profile and strict JSON contract", () => {
  const prompt = buildSeoSuggestionPrompt({
    item_id: 7,
    item_type: "place",
    item_category: "cafes",
    lang: "th",
    title: "Test Cafe",
    excerpt: "Short summary",
    slug: "test-cafe",
    current_meta_title: "",
    current_meta_description: "",
    body_html: "<p>Body text</p>",
  }, "custom seo profile");

  assert.match(prompt, /custom seo profile/);
  assert.match(prompt, /meta_title, meta_description, suggested_slug/);
  assert.match(prompt, /Return ONLY valid JSON/);
  assert.match(prompt, /Write for real travelers first/);
});

test("normalizeSeoSuggestion trims strings and ignores empty payloads", () => {
  assert.deepEqual(
    normalizeSeoSuggestion({
      meta_title: "  ```json SEO Title```  ",
      meta_description: "  Useful summary  ",
      suggested_slug: " test-slug ",
      extra_field: "ignored",
    }),
    {
      meta_title: "SEO Title",
      meta_description: "Useful summary",
      suggested_slug: "test-slug",
    }
  );

  assert.equal(normalizeSeoSuggestion({ meta_title: "", meta_description: "", suggested_slug: "" }), null);
});

test("buildSeoSuggestionRequestContext preserves intentionally empty browser fields", () => {
  const context = buildSeoSuggestionRequestContext(
    {
      title: "",
      excerpt: "",
      slug: "",
      body: "",
      body_blocks_text: "",
      meta_title: "",
      meta_description: "",
      item_type: "place",
      item_category: "cafes",
      lang: "th",
    },
    {
      id: 42,
      title: "Saved title",
      summary: "Saved excerpt",
      slug: "saved-slug",
      meta_title: "Saved meta title",
      meta_description: "Saved meta description",
      description_clean: "<p>Saved body</p>",
      type: "saved-type",
      category: "saved-category",
      lang: "en",
    },
    (value) => String(value ?? "").trim()
  );

  assert.deepEqual(context, {
    title: "",
    excerpt: "",
    slug: "",
    current_meta_title: "",
    current_meta_description: "",
    body_html: "",
    body_plain_text: "",
    item_id: 42,
    item_type: "place",
    item_category: "cafes",
    lang: "th",
  });
});
