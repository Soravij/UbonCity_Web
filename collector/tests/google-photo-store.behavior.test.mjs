import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { createGooglePhotoStore, parseGooglePhotoProxyUrl } = await import("../server/google-photo-store.mjs");

const photoUrl = (id, w = 800, h = 600) =>
  `/api/google-maps/photo?name=places/A/photos/${id}&maxWidthPx=${w}&maxHeightPx=${h}`;

async function setup({ apiKey = "test-key", status = 200 } = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gphoto-"));
  const calls = { fetch: 0 };
  const fetchImpl = async () => {
    calls.fetch += 1;
    if (status !== 200) return new Response("nope", { status });
    return new Response(Buffer.from([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  };
  const state = { apiKey };
  const store = createGooglePhotoStore({ mediaDir: tmp, apiKeyProvider: () => state.apiKey, fetchImpl });
  return { tmp, calls, store, state };
}

// fetchAndStore is gated by GOOGLE_PHOTO_FETCH=1; wrap tests that expect an upstream fetch.
const withFetch = (fn) => async (...args) => {
  const prev = process.env.GOOGLE_PHOTO_FETCH;
  process.env.GOOGLE_PHOTO_FETCH = "1";
  try {
    return await fn(...args);
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_PHOTO_FETCH;
    else process.env.GOOGLE_PHOTO_FETCH = prev;
  }
};

const listRef = async (tmp) => fs.readdir(path.join(tmp, "googleRef")).catch(() => []);

test("parseGooglePhotoProxyUrl parses valid url and rejects invalid ones", () => {
  assert.deepEqual(parseGooglePhotoProxyUrl(photoUrl("B")), {
    name: "places/A/photos/B",
    maxWidthPx: 800,
    maxHeightPx: 600,
  });
  assert.equal(parseGooglePhotoProxyUrl("/api/google-maps/photo?name=bad-name"), null);
  assert.equal(parseGooglePhotoProxyUrl("/api/other?name=places/A/photos/B"), null);
});

test("getOrFetch misses once then hits from file", withFetch(async () => {
  const { tmp, calls, store } = await setup();
  const first = await store.getOrFetch("places/A/photos/B", 800, 600);
  assert.equal(first.cache, "miss");
  assert.equal(calls.fetch, 1);
  const second = await store.getOrFetch("places/A/photos/B", 800, 600);
  assert.equal(second.cache, "hit");
  assert.equal(calls.fetch, 1);
  const files = await listRef(tmp);
  assert.equal(files.filter((f) => f.endsWith(".jpg")).length, 1);
}));

test("prefetchUrls dedupes and ignores non-proxy urls", withFetch(async () => {
  const { calls, store } = await setup();
  const r = await store.prefetchUrls([photoUrl("B"), photoUrl("B"), photoUrl("C"), "https://example.com/x.jpg"]);
  assert.equal(calls.fetch, 2);
  assert.equal(r.stored, 2);
  assert.equal(r.failed, 0);
}));

test("deleteUrls removes the file so next getOrFetch misses and refetches", withFetch(async () => {
  const { calls, store } = await setup();
  await store.getOrFetch("places/A/photos/B", 800, 600);
  const d = await store.deleteUrls([photoUrl("B")]);
  assert.equal(d.deleted, 1);
  const again = await store.getOrFetch("places/A/photos/B", 800, 600);
  assert.equal(again.cache, "miss");
  assert.equal(calls.fetch, 2);
}));

test("missing api key: 503 on miss, but cached file is served without key", withFetch(async () => {
  const { calls, store, state } = await setup({ apiKey: "" });
  await assert.rejects(() => store.getOrFetch("places/A/photos/B", 800, 600), (e) => e.status === 503);
  assert.equal(calls.fetch, 0);
  state.apiKey = "k";
  await store.getOrFetch("places/A/photos/B", 800, 600);
  state.apiKey = "";
  const hit = await store.getOrFetch("places/A/photos/B", 800, 600);
  assert.equal(hit.cache, "hit");
}));

test("upstream 404 throws status 404 and writes no file", withFetch(async () => {
  const { tmp, store } = await setup({ status: 404 });
  await assert.rejects(() => store.getOrFetch("places/A/photos/B", 800, 600), (e) => e.status === 404);
  assert.deepEqual(await listRef(tmp), []);
}));

test("concurrent getOrFetch for the same photo fetches once", withFetch(async () => {
  const { calls, store } = await setup();
  const [a, b] = await Promise.all([
    store.getOrFetch("places/A/photos/B", 800, 600),
    store.getOrFetch("places/A/photos/B", 800, 600),
  ]);
  assert.equal(calls.fetch, 1);
  assert.deepEqual(a.body, b.body);
}));

test("unwritable mediaDir does not break getOrFetch", withFetch(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gphoto-"));
  const notADir = path.join(tmp, "plain-file");
  await fs.writeFile(notADir, "x");
  const store = createGooglePhotoStore({
    mediaDir: notADir,
    apiKeyProvider: () => "k",
    fetchImpl: async () => new Response(Buffer.from([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
  });
  const photo = await store.getOrFetch("places/A/photos/B", 800, 600);
  assert.deepEqual([...photo.body], [1, 2, 3]);
}));

test("cache miss without GOOGLE_PHOTO_FETCH throws 404 and does not call fetchImpl", async () => {
  const prev = process.env.GOOGLE_PHOTO_FETCH;
  delete process.env.GOOGLE_PHOTO_FETCH;
  try {
    const { calls, store } = await setup();
    await assert.rejects(() => store.getOrFetch("places/A/photos/B", 800, 600), (e) => e.status === 404);
    assert.equal(calls.fetch, 0);
  } finally {
    if (prev !== undefined) process.env.GOOGLE_PHOTO_FETCH = prev;
  }
});
