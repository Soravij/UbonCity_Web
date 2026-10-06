import assert from "node:assert/strict";
import test from "node:test";

import { collectFromJsonPayload } from "../collector/sources/adapters/json.mjs";
import { collectRawFromAdapter } from "../collector/sources/index.mjs";

test("array of two distinct rows yields two items with matching titles", async () => {
  const out = await collectFromJsonPayload([
    { name: "ร้าน ก", address: "อุบล", latitude: 15.24, longitude: 104.85 },
    { name: "ร้าน ข", address: "วารินฯ", latitude: 15.2, longitude: 104.9 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].normalized_json.title, "ร้าน ก");
  assert.equal(out[1].normalized_json.title, "ร้าน ข");
});

test("schema wrapper accepted; other schema rejected", async () => {
  const out = await collectFromJsonPayload({
    schema: "uboncity.places.v1",
    places: [{ name: "ร้าน ก" }],
  });
  assert.equal(out.length, 1);
  await assert.rejects(
    collectFromJsonPayload({ schema: "other.v9", places: [{ name: "x" }] }),
    /schema ไม่รองรับ/
  );
});

test("string payload is parsed; broken string rejected", async () => {
  const out = await collectFromJsonPayload(JSON.stringify([{ name: "ร้าน ก" }]));
  assert.equal(out.length, 1);
  await assert.rejects(collectFromJsonPayload("{not json"), /JSON ไม่ถูกต้อง/);
});

test("rows without a name are dropped; all nameless rejects", async () => {
  const out = await collectFromJsonPayload([{ address: "x" }, { name: "ร้าน ก" }, null]);
  assert.equal(out.length, 1);
  await assert.rejects(collectFromJsonPayload([{ address: "x" }, {}]), /ไม่มีรายการที่ใช้ได้/);
});

test("dedupe by google_place_id", async () => {
  const out = await collectFromJsonPayload([
    { name: "A", google_place_id: "pid1" },
    { name: "B", google_place_id: "pid1" },
  ]);
  assert.equal(out.length, 1);
});

test("dedupe by name + coordinates rounded to 4 decimals", async () => {
  const out = await collectFromJsonPayload([
    { name: "A", latitude: 15.24001, longitude: 104.85001 },
    { name: "A", latitude: 15.240012, longitude: 104.850008 },
  ]);
  assert.equal(out.length, 1);
});

test("same name with different address and no coordinates stays two", async () => {
  const out = await collectFromJsonPayload([
    { name: "A", address: "addr 1" },
    { name: "A", address: "addr 2" },
  ]);
  assert.equal(out.length, 2);
});

test("out-of-range latitude keeps item but nulls coordinates", async () => {
  const out = await collectFromJsonPayload([{ name: "A", latitude: 200, longitude: 104.85 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].normalized_json.latitude, null);
  assert.equal(out[0].normalized_json.longitude, null);
});

test("source_url differs per row even with identical found_at and never uses photo proxy", async () => {
  const out = await collectFromJsonPayload([
    { name: "A", address: "1", found_at: "https://example.com/list" },
    { name: "B", address: "2", found_at: "https://example.com/list" },
  ]);
  assert.notEqual(out[0].source_url, out[1].source_url);
  for (const row of out) assert.ok(!row.source_url.includes("/api/google-maps/photo"));
});

test("same-name rows without address or place id but distinct coordinates get distinct source_url", async () => {
  const out = await collectFromJsonPayload([
    { name: "7-Eleven", latitude: 15.24, longitude: 104.84 },
    { name: "7-Eleven", latitude: 15.3, longitude: 104.9 },
  ]);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].source_url, out[1].source_url);
});

test("empty or whitespace string payload gives a clear error", async () => {
  await assert.rejects(collectFromJsonPayload(""), /ยังไม่ได้วาง JSON/);
  await assert.rejects(collectFromJsonPayload("   "), /ยังไม่ได้วาง JSON/);
});

test("found_at drops photo-proxy and non-http(s) urls", async () => {
  const out = await collectFromJsonPayload([
    {
      name: "A",
      found_at: [
        "https://example.com/ok",
        "https://host/api/google-maps/photo?x=1",
        "ftp://example.com/file",
        "javascript:alert(1)",
        "not a url",
      ],
    },
  ]);
  assert.deepEqual(out[0].payload_json.payload_json.found_at, ["https://example.com/ok"]);
});

test("more than 500 rows rejected", async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ name: `P${i}` }));
  await assert.rejects(collectFromJsonPayload(rows), /เกิน 500/);
});

test("collectRawFromAdapter('json') matches direct call", async () => {
  const payload = [{ name: "A", address: "1", latitude: 15.24, longitude: 104.85 }];
  const viaIndex = await collectRawFromAdapter("json", payload);
  const direct = await collectFromJsonPayload(payload);
  assert.deepEqual(viaIndex, direct);
});
