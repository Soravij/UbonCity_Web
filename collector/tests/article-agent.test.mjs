import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArticleSuggestionPrompt,
  buildArticleSuggestionRequestContext,
  normalizeArticleSuggestion,
} from "../services/article-agent.mjs";

test("buildArticleSuggestionRequestContext preserves intentionally empty browser fields", () => {
  const context = buildArticleSuggestionRequestContext(
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
      id: 11,
      title: "Saved title",
      summary: "Saved summary",
      slug: "saved-slug",
      description_clean: "<p>Saved body</p>",
      meta_title: "Saved meta title",
      meta_description: "Saved meta description",
      type: "event",
      category: "attractions",
      lang: "en",
    },
    (value) => String(value ?? "").trim()
  );

  assert.deepEqual(context, {
    title: "",
    excerpt: "",
    slug: "",
    body_html: "",
    body_blocks_text: "",
    current_meta_title: "",
    current_meta_description: "",
    item_id: 11,
    item_type: "place",
    item_category: "cafes",
    lang: "th",
    item_title: "Saved title",
    item_summary: "Saved summary",
    field_pack: null,
    publishable_source: null,
    selected_assets: [],
  });
});

test("buildArticleSuggestionRequestContext prefers server-selected assets over browser payload", () => {
  const context = buildArticleSuggestionRequestContext(
    {
      title: "Draft title",
      selected_assets: [{ id: "browser-asset" }],
    },
    {
      id: 22,
      title: "Saved title",
    },
    (value) => String(value ?? "").trim(),
    [{ id: "server-selected-asset" }]
  );

  assert.deepEqual(context.selected_assets, [{ id: "server-selected-asset" }]);
});

test("buildArticleSuggestionPrompt includes profile text and type/category context", () => {
  const prompt = buildArticleSuggestionPrompt({
    item_id: 5,
    item_type: "place",
    item_category: "cafes",
    lang: "th",
    title: "Current title",
    excerpt: "Current excerpt",
    slug: "current-slug",
    body_html: "<p>Body text</p>",
    body_blocks_text: "Body text",
    item_title: "Saved item title",
    item_summary: "Saved item summary",
    field_pack: { writer_angle: "Cafe by the river" },
  }, "custom article profile");

  assert.match(prompt, /custom article profile/);
  assert.match(prompt, /"type": "place"/);
  assert.match(prompt, /"category": "cafes"/);
  assert.match(prompt, /restaurant\/cafe: atmosphere and who it suits/);
  assert.match(prompt, /Return ONLY valid JSON/);
});

test("normalizeArticleSuggestion trims valid JSON output and keeps editor notes as array", () => {
  assert.deepEqual(
    normalizeArticleSuggestion({
      title: "  ```json Draft Title``` ",
      excerpt: " Useful excerpt ",
      body: " <p>Useful body</p> ",
      suggested_slug: " draft-title ",
      editor_notes: [" note one ", "", "```json note two```"],
      ignored: "field",
    }),
    {
      title: "Draft Title",
      excerpt: "Useful excerpt",
      body: "<p>Useful body</p>",
      suggested_slug: "draft-title",
      editor_notes: ["note one", "note two"],
    }
  );
});

test("normalizeArticleSuggestion preserves plain-text paragraph breaks in body", () => {
  const suggestion = normalizeArticleSuggestion({
    title: "Draft Title",
    excerpt: "Useful excerpt",
    body: " First paragraph\n\nSecond paragraph\n\n- bullet one\n- bullet two ",
  });

  assert.equal(
    suggestion?.body,
    "First paragraph\n\nSecond paragraph\n\n- bullet one\n- bullet two"
  );
});

test("normalizeArticleSuggestion preserves basic html structure in body", () => {
  const suggestion = normalizeArticleSuggestion({
    title: "Draft Title",
    excerpt: "Useful excerpt",
    body: "\n<p>Intro</p>\n<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>\n",
  });

  assert.equal(
    suggestion?.body,
    "<p>Intro</p>\n<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>"
  );
});

test("normalizeArticleSuggestion rejects invalid or empty output safely", () => {
  assert.equal(normalizeArticleSuggestion(null), null);
  assert.equal(normalizeArticleSuggestion({}), null);
  assert.equal(
    normalizeArticleSuggestion({
      title: "",
      excerpt: "",
      body: "",
      suggested_slug: "",
      editor_notes: [],
    }),
    null
  );
});
