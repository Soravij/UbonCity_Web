import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRawItem } from "../collector/sources/normalize.mjs";

test("normalizeRawItem preserves numeric zero coordinates", () => {
  const row = normalizeRawItem({ latitude: 0, longitude: 0 });
  assert.equal(row.normalized_json.latitude, 0);
  assert.equal(row.normalized_json.longitude, 0);
});

test("normalizeRawItem preserves string zero coordinates", () => {
  const row = normalizeRawItem({ latitude: "0", longitude: "0" });
  assert.equal(row.normalized_json.latitude, 0);
  assert.equal(row.normalized_json.longitude, 0);
});

test("normalizeRawItem preserves trimmed string zero coordinates", () => {
  const row = normalizeRawItem({ latitude: " 0 ", longitude: " 0 " });
  assert.equal(row.normalized_json.latitude, 0);
  assert.equal(row.normalized_json.longitude, 0);
});

test("normalizeRawItem keeps null empty and whitespace coordinates absent", () => {
  const cases = [
    { latitude: null, longitude: null },
    { latitude: "", longitude: "" },
    { latitude: "   ", longitude: "   " },
    { latitude: undefined, longitude: undefined },
  ];
  for (const input of cases) {
    const row = normalizeRawItem(input);
    assert.equal(row.normalized_json.latitude, null);
    assert.equal(row.normalized_json.longitude, null);
  }
});

test("normalizeRawItem falls back from blank primary coordinates to aliases", () => {
  const row = normalizeRawItem({ latitude: "   ", longitude: "", lat: 15.25, lng: "104.75" });
  assert.equal(row.normalized_json.latitude, 15.25);
  assert.equal(row.normalized_json.longitude, 104.75);
});

test("normalizeRawItem keeps non-zero coordinate behavior unchanged", () => {
  const row = normalizeRawItem({ latitude: 15.25, longitude: 104.75 });
  assert.equal(row.normalized_json.latitude, 15.25);
  assert.equal(row.normalized_json.longitude, 104.75);
});
