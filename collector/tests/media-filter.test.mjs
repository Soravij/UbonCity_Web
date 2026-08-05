import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { isJunkMediaUrl, buildFilteredMediaList } from "../collector/sources/media-filter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
}

test("lukmatcha.com: all 10 real content photos survive the junk filter", () => {
  const fixture = loadFixture("media-lukmatcha.json");
  const result = buildFilteredMediaList(fixture.media, { fallbackImageUrl: fixture.normalized_image_fallback });
  assert.equal(result.length, fixture.expected_surviving_count);
  assert.deepEqual(result.map((m) => m.media_url), fixture.media.map((m) => m.media_url));
});

test("instagram: 6 of 7 rsrc.php UI assets are dropped, only the scontent photo survives", () => {
  const fixture = loadFixture("media-instagram.json");
  const result = buildFilteredMediaList(fixture.media, { fallbackImageUrl: fixture.normalized_image_fallback });
  assert.equal(result.length, fixture.expected_surviving_count);
  assert.ok(result[0].media_url.includes(fixture.expected_surviving_url_substring));
});

test("ryoiireview.com: all 10 /images/menu/ nav icons are dropped, no fallback taken", () => {
  const fixture = loadFixture("media-ryoiireview.json");
  const result = buildFilteredMediaList(fixture.media, { fallbackImageUrl: fixture.normalized_image_fallback });
  assert.equal(result.length, fixture.expected_surviving_count);
});

test("isJunkMediaUrl: extension, filename keyword, path segment, and data-uri rules", () => {
  assert.equal(isJunkMediaUrl("https://example.com/a/b.svg"), true);
  assert.equal(isJunkMediaUrl("https://example.com/a/b.ico"), true);
  assert.equal(isJunkMediaUrl("https://example.com/uploads/site-logo.jpg"), true);
  assert.equal(isJunkMediaUrl("https://example.com/uploads/favicon-32.png"), true);
  assert.equal(isJunkMediaUrl("https://example.com/icons/pin.png"), true);
  assert.equal(isJunkMediaUrl("https://example.com/logos/brand.png"), true);
  assert.equal(isJunkMediaUrl("https://example.com/static/hero.jpg"), true);
  assert.equal(isJunkMediaUrl("https://example.com/assets/ui/spinner.png"), true);
  assert.equal(isJunkMediaUrl("https://static.cdninstagram.com/rsrc.php/yr/r/x.webp"), true);
  assert.equal(isJunkMediaUrl("https://example.com/images/menu/home.png"), true);
  assert.equal(isJunkMediaUrl("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(isJunkMediaUrl(""), true);
  assert.equal(isJunkMediaUrl("https://example.com/uploads/gallery/photo-01.jpg"), false);
});

test("isJunkMediaUrl: real content URLs with home/banner substrings must NOT be filtered", () => {
  // These are actual content images that the audit found were false positives
  // when "home" and "banner" were simple substring matches.
  assert.equal(isJunkMediaUrl("https://example.com/images/hero/banner-shot.jpg"), false);
  assert.equal(isJunkMediaUrl("https://example.com/uploads/homemade-dessert.jpg"), false);
  assert.equal(isJunkMediaUrl("https://example.com/uploads/home-cooked-meal.jpg"), false);
  assert.equal(isJunkMediaUrl("https://example.com/uploads/chome-street-view.jpg"), false);
  assert.equal(isJunkMediaUrl("https://example.com/uploads/urban-banner-district.jpg"), false);
});

test("buildFilteredMediaList: fallback to normalized.image only applies when the media list was empty from the start", () => {
  const junkFallback = "https://example.com/images/menu/home.png";
  const cleanFallback = "https://example.com/uploads/photo.jpg";

  // Media list has entries but every one is junk -> filtered to zero -> must NOT fall back.
  const filteredToZero = buildFilteredMediaList(
    [{ media_url: "https://example.com/icons/a.png" }, { media_url: "https://example.com/logos/b.png" }],
    { fallbackImageUrl: cleanFallback }
  );
  assert.equal(filteredToZero.length, 0);

  // Media list was empty from the start -> fallback applies, but must still pass the junk filter.
  const emptyFromStartJunkFallback = buildFilteredMediaList([], { fallbackImageUrl: junkFallback });
  assert.equal(emptyFromStartJunkFallback.length, 0);

  const emptyFromStartCleanFallback = buildFilteredMediaList([], { fallbackImageUrl: cleanFallback });
  assert.equal(emptyFromStartCleanFallback.length, 1);
  assert.equal(emptyFromStartCleanFallback[0].media_url, cleanFallback);
});

test("buildFilteredMediaList: dedupes URLs and caps at 30 per source", () => {
  const duped = buildFilteredMediaList([
    { media_url: "https://example.com/uploads/a.jpg", metadata_json: { order: 0 } },
    { media_url: "https://example.com/uploads/a.jpg", metadata_json: { order: 1 } },
  ]);
  assert.equal(duped.length, 1);

  const many = Array.from({ length: 40 }, (_, i) => ({
    media_url: `https://example.com/uploads/photo-${i}.jpg`,
    metadata_json: { order: i },
  }));
  const capped = buildFilteredMediaList(many);
  assert.equal(capped.length, 30);
});
