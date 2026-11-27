import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { processRoutePhoto, ROUTE_PHOTO_W, ROUTE_PHOTO_H } from "../server/transport-v2-photo.mjs";

test("processRoutePhoto crops+compresses to 640x480 webp", async () => {
  const input = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: { r: 120, g: 80, b: 40 } },
  }).png().toBuffer();

  const result = await processRoutePhoto(input);
  assert.equal(result.ext, ".webp");
  assert.equal(result.mime, "image/webp");
  assert.equal(result.width, ROUTE_PHOTO_W);
  assert.equal(result.height, ROUTE_PHOTO_H);

  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 480);
});
