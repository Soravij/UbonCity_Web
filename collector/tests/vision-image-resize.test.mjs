import assert from "node:assert/strict";
import test, { describe } from "node:test";
import sharp from "sharp";

import { resizeImageBuffer, _resetSharpCacheForTesting } from "../services/agent-generation.mjs";

async function createLargeJpeg(width = 2000, height = 1500) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 } },
  }).jpeg({ quality: 95 }).toBuffer();
}

async function createSmallJpeg(width = 200, height = 150) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 100, b: 200 } },
  }).jpeg({ quality: 80 }).toBuffer();
}

async function createPngWithAlpha(width = 1200, height = 800) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  }).png().toBuffer();
}

test("resizeImageBuffer: large image is downsized", async () => {
  const original = await createLargeJpeg(2000, 1500);
  const result = await resizeImageBuffer(original, "image/jpeg");

  assert.equal(result.resized, true);
  assert.equal(result.mime, "image/jpeg");
  assert.ok(result.buffer.length < original.length, "resized buffer should be smaller");
  assert.ok(result.meta.originalWidth === 2000);
  assert.ok(result.meta.originalHeight === 1500);
  assert.ok(result.meta.finalWidth <= 768, `final width ${result.meta.finalWidth} should be <= 768`);
  assert.ok(result.meta.finalHeight <= 768, `final height ${result.meta.finalHeight} should be <= 768`);

  const meta = await sharp(result.buffer).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok(meta.width <= 768);
  assert.ok(meta.height <= 768);
});

test("resizeImageBuffer: small image is not enlarged", async () => {
  const original = await createSmallJpeg(200, 150);
  const result = await resizeImageBuffer(original, "image/jpeg");

  assert.equal(result.resized, false);
  assert.equal(result.mime, "image/jpeg");
  assert.equal(result.buffer, original, "should return original buffer reference");
  assert.equal(result.meta.originalWidth, 200);
  assert.equal(result.meta.originalHeight, 150);
  assert.equal(result.meta.finalWidth, 200);
  assert.equal(result.meta.finalHeight, 150);
});

test("resizeImageBuffer: corrupt buffer returns original", async () => {
  const corrupt = Buffer.from("this is not an image at all");
  const result = await resizeImageBuffer(corrupt, "image/jpeg");

  assert.equal(result.resized, false);
  assert.equal(result.mime, "image/jpeg");
  assert.equal(result.buffer, corrupt, "should return original corrupt buffer");
  assert.equal(result.meta, null);
});

describe("resizeImageBuffer: sharp load failure", () => {
  test("returns original buffer when sharp cannot be loaded", async (t) => {
    _resetSharpCacheForTesting();

    t.mock.module("sharp", {
      exports: {},
    });

    const fallback = await import("../services/agent-generation.mjs");

    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x4a, 0x46, 0x49, 0x46]);
    const result = await fallback.resizeImageBuffer(buf, "image/jpeg");

    assert.equal(result.resized, false);
    assert.equal(result.mime, "image/jpeg");
    assert.equal(result.buffer, buf, "should return original buffer");
    assert.equal(result.meta, null);

    _resetSharpCacheForTesting();
  });
});
