import assert from "node:assert/strict";
import test from "node:test";

import { isJunkMediaUrl, buildFilteredMediaList } from "../collector/sources/media-filter.mjs";
import { normalizeReferenceMediaUrl } from "../db/repository.mjs";

// ============================================================
// Junk filter: rsrc.php is filtered
// ============================================================

test("isJunkMediaUrl: rsrc.php URL is junk", () => {
  assert.equal(
    isJunkMediaUrl("https://static.cdninstagram.com/rsrc.php/yr/r/rzWiSjZRxk5.webp"),
    true,
    "rsrc.php should be junk"
  );
});

test("isJunkMediaUrl: normal content image is not junk", () => {
  assert.equal(
    isJunkMediaUrl("https://img.wongnai.com/p/800x0/2024/01/01/test-photo.jpg"),
    false,
    "normal wongnai content image should not be junk"
  );
});

test("buildFilteredMediaList: rsrc.php filtered out, normal image survives", () => {
  const media = [
    { media_url: "https://static.cdninstagram.com/rsrc.php/yr/r/rzWiSjZRxk5.webp" },
    { media_url: "https://img.wongnai.com/p/800x0/2024/01/01/test-photo.jpg" },
  ];
  const result = buildFilteredMediaList(media);
  assert.equal(result.length, 1);
  assert.ok(result[0].media_url.includes("test-photo.jpg"));
});

// ============================================================
// Wongnai _-x_ normalization
// ============================================================

test("normalizeReferenceMediaUrl: /p/_-x_/ becomes /p/400x0/", () => {
  const input = "https://img.wongnai.com/p/_-x_/2024/01/01/photo.jpg";
  const result = normalizeReferenceMediaUrl(input);
  assert.ok(result.includes("/p/400x0/"), `expected /p/400x0/ in ${result}`);
  assert.ok(!result.includes("_-x_"), `expected no _-x_ in ${result}`);
});

test("normalizeReferenceMediaUrl: /p/1600x0/ stays unchanged", () => {
  const input = "https://img.wongnai.com/p/1600x0/2024/01/01/photo.jpg";
  const result = normalizeReferenceMediaUrl(input);
  assert.ok(result.includes("/p/1600x0/"), `expected /p/1600x0/ in ${result}`);
});

test("normalizeReferenceMediaUrl: other host with _-x_ is not touched", () => {
  const input = "https://example.com/p/_-x_/photo.jpg";
  const result = normalizeReferenceMediaUrl(input);
  assert.ok(result.includes("_-x_"), `expected _-x_ preserved in ${result}`);
});

test("normalizeReferenceMediaUrl: www.img.wongnai.com also normalizes _-x_", () => {
  const input = "https://www.img.wongnai.com/p/_-x_/2024/01/01/photo.jpg";
  const result = normalizeReferenceMediaUrl(input);
  assert.ok(result.includes("/p/400x0/"), `expected /p/400x0/ in ${result}`);
});
