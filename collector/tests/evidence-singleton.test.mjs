import test from "node:test";
import assert from "node:assert/strict";
import { singletonEvidenceKey } from "../server/evidence-singleton.mjs";

test("A: numeric/string record id and object/JSON-string payload give the same non-empty key", () => {
  const a = singletonEvidenceKey(
    { block_type: "fact", source_record_type: "source_records", source_record_id: 531 },
    { field: "location" },
  );
  const b = singletonEvidenceKey(
    { block_type: "fact", source_record_type: "source_records", source_record_id: "531" },
    '{"field":"location"}',
  );
  assert.notEqual(a, "");
  assert.equal(a, b);
});

test("B: non-singleton field yields empty key", () => {
  const key = singletonEvidenceKey(
    { block_type: "fact", source_record_type: "source_records", source_record_id: 531 },
    { field: "article_section" },
  );
  assert.equal(key, "");
});

test("C: null or non-JSON string payload yields empty key", () => {
  const block = { block_type: "fact", source_record_type: "source_records", source_record_id: 531 };
  assert.equal(singletonEvidenceKey(block, null), "");
  assert.equal(singletonEvidenceKey(block, "not json"), "");
});

test("D: different records with same field yield different keys", () => {
  const mk = (id) => singletonEvidenceKey(
    { block_type: "fact", source_record_type: "source_records", source_record_id: id },
    { field: "classification" },
  );
  assert.notEqual(mk(531), mk(532));
});

test("E1: location with different text in the same record yields different keys", () => {
  const mk = (text) => singletonEvidenceKey(
    { block_type: "fact", source_record_type: "source_records", source_record_id: 531, text_value: text },
    { field: "location" },
  );
  assert.notEqual(mk("Location link available"), mk("61-63 ถนนยุทธภัณฑ์"));
});

test("E2: location with the same text but different list yields the same key", () => {
  const block = {
    block_type: "fact", source_record_type: "source_records", source_record_id: 531,
    text_value: "61-63 ถนนยุทธภัณฑ์",
  };
  const a = singletonEvidenceKey(block, { field: "location", value: ["a"] });
  const b = singletonEvidenceKey(block, { field: "location", value: ["b", "c"] });
  assert.notEqual(a, "");
  assert.equal(a, b);
});
