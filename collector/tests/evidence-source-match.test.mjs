import assert from "node:assert/strict";
import test from "node:test";
import { findSourceRecordForNormalized } from "../server/evidence-source-match.mjs";

const url = (cid) => `https://maps.google.com/?cid=${cid}&g_mp=x`;

test("place id match wins over earlier loose url match", () => {
  const records = [
    { id: 116, source_entity_id: "PB", source_url: url(2) },
    { id: 4, source_entity_id: "PA", source_url: url(1) },
  ];
  const found = findSourceRecordForNormalized(records, { google_place_id: "PA", source_url: url(1) });
  assert.equal(found?.id, 4);
});

test("no place id: exact source_url match", () => {
  const records = [
    { id: 116, source_entity_id: "PB", source_url: url(2) },
    { id: 4, source_entity_id: "PA", source_url: url(1) },
  ];
  assert.equal(findSourceRecordForNormalized(records, { source_url: url(1) })?.id, 4);
});

test("place id not in list: falls back to exact source_url", () => {
  const records = [
    { id: 116, source_entity_id: "PB", source_url: url(2) },
    { id: 4, source_entity_id: "PA", source_url: url(1) },
  ];
  assert.equal(findSourceRecordForNormalized(records, { google_place_id: "PX", source_url: url(1) })?.id, 4);
});

test("no place id: ambiguous loose match across two records returns null", () => {
  const records = [
    { id: 116, source_entity_id: "PB", source_url: url(2) },
    { id: 4, source_entity_id: "PA", source_url: url(1) },
  ];
  assert.equal(findSourceRecordForNormalized(records, { source_url: url(3) }), null);
});

test("no place id: single loose match returns that record", () => {
  const records = [{ id: 4, source_entity_id: "PA", source_url: url(1) }];
  assert.equal(findSourceRecordForNormalized(records, { source_url: url(3) })?.id, 4);
});

test("empty or null normalized returns null", () => {
  const records = [{ id: 4, source_entity_id: "PA", source_url: url(1) }];
  assert.equal(findSourceRecordForNormalized(records, {}), null);
  assert.equal(findSourceRecordForNormalized(records, null), null);
});

test("place id wins over exact source_url match on another record", () => {
  const records = [
    { id: 1, source_entity_id: "PX", source_url: "https://maps.google.com/?cid=1&g_mp=x" },
    { id: 2, source_entity_id: "PA", source_url: "https://maps.google.com/?cid=2&g_mp=x" },
  ];
  const found = findSourceRecordForNormalized(records, {
    google_place_id: "PA",
    source_url: "https://maps.google.com/?cid=1&g_mp=x",
  });
  assert.equal(found?.id, 2);
});

test("loose match via source_entity_id returns the single record", () => {
  const records = [{ id: 7, source_entity_id: "https://www.wongnai.com/place/9", source_url: "" }];
  const found = findSourceRecordForNormalized(records, { source_url: "https://wongnai.com/place/9?ref=x" });
  assert.equal(found?.id, 7);
});
