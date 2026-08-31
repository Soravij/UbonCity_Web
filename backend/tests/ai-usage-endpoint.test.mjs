import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAiUsageRangeDays } from "../controllers/analyticsController.js";

test("normalizeAiUsageRangeDays returns 'all' for 'all'", () => {
  assert.equal(normalizeAiUsageRangeDays("all"), "all");
});

test("normalizeAiUsageRangeDays returns 7 for 7", () => {
  assert.equal(normalizeAiUsageRangeDays(7), 7);
});

test("normalizeAiUsageRangeDays returns 30 for 30", () => {
  assert.equal(normalizeAiUsageRangeDays(30), 30);
});

test("normalizeAiUsageRangeDays returns 90 for 90", () => {
  assert.equal(normalizeAiUsageRangeDays(90), 90);
});

test("normalizeAiUsageRangeDays returns 'all' for undefined", () => {
  assert.equal(normalizeAiUsageRangeDays(undefined), "all");
});

test("normalizeAiUsageRangeDays returns 'all' for null", () => {
  assert.equal(normalizeAiUsageRangeDays(null), "all");
});

test("normalizeAiUsageRangeDays returns 'all' for empty string", () => {
  assert.equal(normalizeAiUsageRangeDays(""), "all");
});

test("normalizeAiUsageRangeDays throws for 15", () => {
  assert.throws(() => normalizeAiUsageRangeDays(15), /range_days is invalid/);
});

test("normalizeAiUsageRangeDays throws for 'abc'", () => {
  assert.throws(() => normalizeAiUsageRangeDays("abc"), /range_days is invalid/);
});

test("normalizeAiUsageRangeDays throws for 0", () => {
  assert.throws(() => normalizeAiUsageRangeDays(0), /range_days is invalid/);
});

test("normalizeAiUsageRangeDays throws for -7", () => {
  assert.throws(() => normalizeAiUsageRangeDays(-7), /range_days is invalid/);
});
