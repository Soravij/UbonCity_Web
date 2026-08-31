import test from "node:test";
import assert from "node:assert/strict";

import { parseNumber, classify, checksumOf } from "../scripts/migrate.js";

test("parseNumber extracts leading integer", () => {
  assert.equal(parseNumber("000_baseline_schema.sql"), 0);
  assert.equal(parseNumber("001_schema_alignment_core.sql"), 1);
  assert.equal(parseNumber("025_align_category_translations.sql"), 25);
  assert.equal(parseNumber("123_something.sql"), 123);
});

test("parseNumber returns null for non-matching filenames", () => {
  assert.equal(parseNumber("backup"), null);
  assert.equal(parseNumber("reference"), null);
  assert.equal(parseNumber("readme.txt"), null);
  assert.equal(parseNumber("_no_number.sql"), null);
});

test("classify returns baseline for n <= 24", () => {
  assert.equal(classify("000_baseline_schema.sql"), "baseline");
  assert.equal(classify("010_homepage_curation_layouts.sql"), "baseline");
  assert.equal(classify("024_ai_usage_log.sql"), "baseline");
});

test("classify returns manual for n = 25 or 26", () => {
  assert.equal(classify("025_align_category_translations.sql"), "manual");
  assert.equal(classify("026_users_role_default.sql"), "manual");
});

test("classify returns runner for n >= 27", () => {
  assert.equal(classify("027_future_migration.sql"), "runner");
  assert.equal(classify("099_another.sql"), "runner");
});

test("classify returns null for non-parseable filenames", () => {
  assert.equal(classify("backup"), null);
  assert.equal(classify("readme.txt"), null);
});

test("checksumOf returns 64-char sha256 hex", () => {
  const hash = checksumOf("hello");
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("checksumOf is deterministic", () => {
  assert.equal(checksumOf("test"), checksumOf("test"));
});

test("checksumOf differs for different inputs", () => {
  assert.notEqual(checksumOf("a"), checksumOf("b"));
});

test("classify boundary: 024 is baseline, 027 is runner", () => {
  assert.equal(classify("024_ai_usage_log.sql"), "baseline");
  assert.equal(classify("027_x.sql"), "runner");
});

test("gate condition: classify(f) !== 'runner' blocks non-runner files", () => {
  const shouldBlock = [
    "000_baseline_schema.sql",
    "023_drop_lifecycle_tables.sql",
    "024_ai_usage_log.sql",
    "025_align_category_translations.sql",
    "026_users_role_default.sql",
  ];
  for (const f of shouldBlock) {
    assert.equal(classify(f) !== "runner", true, `expected ${f} to be blocked`);
  }

  const shouldPass = ["027_audit_probe.sql"];
  for (const f of shouldPass) {
    assert.equal(classify(f) !== "runner", false, `expected ${f} to pass`);
  }
});
