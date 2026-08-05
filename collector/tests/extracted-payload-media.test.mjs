import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildNormalizedFromExtractedPayload } from "../collector/sources/extracted-payload-normalizer.mjs";
import { buildFilteredMediaList } from "../collector/sources/media-filter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

function buildPayloadWithMedia(fixture) {
  return {
    extracted_metadata: { title: "Test place" },
    media: fixture.media,
  };
}

test("buildNormalizedFromExtractedPayload: returns .media array from payload", () => {
  const fixture = loadFixture("media-lukmatcha.json");
  const payload = buildPayloadWithMedia(fixture);
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.ok(result, "should return a candidate");
  assert.ok(Array.isArray(result.media), "should have media array");
  assert.equal(result.media.length, fixture.media.length, "should preserve all raw media entries");
  assert.equal(result.media[0].media_url, fixture.media[0].media_url);
  assert.deepEqual(result.media[0].metadata_json, fixture.media[0].metadata_json);
});

test("buildNormalizedFromExtractedPayload: media passes through buildFilteredMediaList — lukmatcha 10/10", () => {
  const fixture = loadFixture("media-lukmatcha.json");
  const payload = buildPayloadWithMedia(fixture);
  const normalized = buildNormalizedFromExtractedPayload(payload);

  const filtered = buildFilteredMediaList(normalized.media, { fallbackImageUrl: fixture.normalized_image_fallback });
  assert.equal(filtered.length, fixture.expected_surviving_count, "all 10 real content photos should survive");
});

test("buildNormalizedFromExtractedPayload: media passes through buildFilteredMediaList — instagram 1/7", () => {
  const fixture = loadFixture("media-instagram.json");
  const payload = buildPayloadWithMedia(fixture);
  const normalized = buildNormalizedFromExtractedPayload(payload);

  const filtered = buildFilteredMediaList(normalized.media, { fallbackImageUrl: fixture.normalized_image_fallback });
  assert.equal(filtered.length, fixture.expected_surviving_count, "only 1 scontent photo should survive");
  assert.ok(filtered[0].media_url.includes(fixture.expected_surviving_url_substring));
});

test("buildNormalizedFromExtractedPayload: media passes through buildFilteredMediaList — ryoiireview 0/10", () => {
  const fixture = loadFixture("media-ryoiireview.json");
  const payload = buildPayloadWithMedia(fixture);
  const normalized = buildNormalizedFromExtractedPayload(payload);

  const filtered = buildFilteredMediaList(normalized.media, { fallbackImageUrl: fixture.normalized_image_fallback });
  assert.equal(filtered.length, fixture.expected_surviving_count, "all /images/menu/ nav icons should be dropped");
});

test("buildNormalizedFromExtractedPayload: empty media when payload has no media field", () => {
  const payload = { extracted_metadata: { title: "No media" } };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.ok(result, "should return a candidate");
  assert.deepEqual(result.media, [], "media should be empty array");
});

test("buildNormalizedFromExtractedPayload: media entries with metadata_json preserved", () => {
  const payload = {
    extracted_metadata: { title: "Test" },
    media: [
      { media_url: "https://example.com/a.jpg", metadata_json: { source: "manual_url_metadata", role: "hero", order: 0 } },
      { media_url: "https://example.com/b.jpg", metadata_json: { source: "manual_url_metadata", role: "gallery", order: 1 } },
    ],
  };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.equal(result.media.length, 2);
  assert.equal(result.media[0].metadata_json.role, "hero");
  assert.equal(result.media[1].metadata_json.role, "gallery");
  assert.equal(result.media[1].metadata_json.order, 1);
});

test("buildNormalizedFromExtractedPayload: normalizes media_url from url field", () => {
  const payload = {
    extracted_metadata: { title: "Test" },
    media: [
      { url: "https://example.com/from-url.jpg" },
    ],
  };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].media_url, "https://example.com/from-url.jpg");
});

test("buildNormalizedFromExtractedPayload: filters out entries without media_url", () => {
  const payload = {
    extracted_metadata: { title: "Test" },
    media: [
      { media_url: "https://example.com/valid.jpg" },
      { media_url: "" },
      { url: "" },
      {},
    ],
  };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].media_url, "https://example.com/valid.jpg");
});
