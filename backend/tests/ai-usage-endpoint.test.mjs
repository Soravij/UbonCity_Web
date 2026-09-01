import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAiUsageDateRange, nextDay } from "../controllers/analyticsController.js";

test("normalizeAiUsageDateRange returns { from: null, to: null } for empty query", () => {
  assert.deepEqual(normalizeAiUsageDateRange({}), { from: null, to: null });
});

test("normalizeAiUsageDateRange returns { from: null, to: null } for undefined fields", () => {
  assert.deepEqual(normalizeAiUsageDateRange({ from: undefined, to: undefined }), { from: null, to: null });
});

test("normalizeAiUsageDateRange returns { from: null, to: null } for empty strings", () => {
  assert.deepEqual(normalizeAiUsageDateRange({ from: "", to: "" }), { from: null, to: null });
});

test("normalizeAiUsageDateRange accepts valid from+to", () => {
  assert.deepEqual(normalizeAiUsageDateRange({ from: "2026-08-01", to: "2026-08-31" }), { from: "2026-08-01", to: "2026-08-31" });
});

test("normalizeAiUsageDateRange accepts from only", () => {
  assert.deepEqual(normalizeAiUsageDateRange({ from: "2026-08-01" }), { from: "2026-08-01", to: null });
});

test("normalizeAiUsageDateRange accepts to only", () => {
  assert.deepEqual(normalizeAiUsageDateRange({ to: "2026-08-31" }), { from: null, to: "2026-08-31" });
});

test("normalizeAiUsageDateRange throws for bad format '2026-8-1'", () => {
  assert.throws(() => normalizeAiUsageDateRange({ from: "2026-8-1" }), /from is invalid/);
});

test("normalizeAiUsageDateRange throws for 'abc'", () => {
  assert.throws(() => normalizeAiUsageDateRange({ from: "abc" }), /from is invalid/);
});

test("normalizeAiUsageDateRange throws for '2026-08-32'", () => {
  assert.throws(() => normalizeAiUsageDateRange({ to: "2026-08-32" }), /to is invalid/);
});

test("normalizeAiUsageDateRange throws when from > to", () => {
  assert.throws(() => normalizeAiUsageDateRange({ from: "2026-09-01", to: "2026-08-01" }), /from must be before to/);
});

test("normalizeAiUsageDateRange throws for '2026-02-30'", () => {
  assert.throws(() => normalizeAiUsageDateRange({ from: "2026-02-30" }), /from is invalid/);
});

test("normalizeAiUsageDateRange throws for '2026-13-01'", () => {
  assert.throws(() => normalizeAiUsageDateRange({ to: "2026-13-01" }), /to is invalid/);
});

test("nextDay('2026-08-31') -> '2026-09-01 00:00:00'", () => {
  assert.equal(nextDay("2026-08-31"), "2026-09-01 00:00:00");
});

test("nextDay('2026-12-31') -> '2027-01-01 00:00:00'", () => {
  assert.equal(nextDay("2026-12-31"), "2027-01-01 00:00:00");
});

test("nextDay('2028-02-28') -> '2028-02-29 00:00:00' (leap year)", () => {
  assert.equal(nextDay("2028-02-28"), "2028-02-29 00:00:00");
});

test("nextDay('2100-02-28') -> '2100-03-01 00:00:00' (not leap year)", () => {
  assert.equal(nextDay("2100-02-28"), "2100-03-01 00:00:00");
});
