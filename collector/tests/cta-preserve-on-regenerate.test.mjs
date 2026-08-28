import assert from "node:assert/strict";
import test from "node:test";

function parseCtaJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value) || {}; } catch { return {}; }
}

function mergeCtaPreservingExisting(previousValue, nextValue) {
  const prev = parseCtaJson(previousValue);
  const next = parseCtaJson(nextValue);
  const merged = { ...prev };
  for (const [key, val] of Object.entries(next)) {
    const isEmpty = val === null || val === undefined || val === ""
      || (Array.isArray(val) && val.length === 0);
    if (!isEmpty) merged[key] = val;
  }
  return merged;
}

test("new empty values preserve previous values", () => {
  const prev = { phone: "082-123-4567", line_url: "https://line.me/ti/p/test" };
  const next = { phone: "", line_url: null, facebook_url: undefined };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.equal(result.phone, "082-123-4567");
  assert.equal(result.line_url, "https://line.me/ti/p/test");
  assert.equal(result.facebook_url, undefined);
});

test("new non-empty values overwrite previous values", () => {
  const prev = { phone: "082-111-1111", line_url: "https://old.example" };
  const next = { phone: "082-999-9999", line_url: "https://new.example" };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.equal(result.phone, "082-999-9999");
  assert.equal(result.line_url, "https://new.example");
});

test("empty object next preserves all previous values", () => {
  const prev = { phone: "082-123-4567", line_url: "https://line.me", facebook_url: "https://fb.me", website_url: "https://example.com" };
  const result = mergeCtaPreservingExisting(prev, {});
  assert.deepEqual(result, prev);
});

test("JSON string input works correctly", () => {
  const prev = JSON.stringify({ phone: "082-111-1111", line_url: "https://old.example" });
  const next = JSON.stringify({ phone: "082-222-2222", facebook_url: "https://fb.new" });
  const result = mergeCtaPreservingExisting(prev, next);
  assert.equal(result.phone, "082-222-2222");
  assert.equal(result.line_url, "https://old.example");
  assert.equal(result.facebook_url, "https://fb.new");
});

test("empty array next does not overwrite previous array", () => {
  const prev = { source: ["https://a.example", "https://b.example"] };
  const next = { source: [] };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.deepEqual(result.source, ["https://a.example", "https://b.example"]);
});

test("non-empty array next overwrites previous array", () => {
  const prev = { source: ["https://old.example"] };
  const next = { source: ["https://new.example"] };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.deepEqual(result.source, ["https://new.example"]);
});

test("null previous returns next values", () => {
  const next = { phone: "082-333-3333", line_url: "https://line.me" };
  const result = mergeCtaPreservingExisting(null, next);
  assert.equal(result.phone, "082-333-3333");
  assert.equal(result.line_url, "https://line.me");
});

test("both null returns empty object", () => {
  const result = mergeCtaPreservingExisting(null, null);
  assert.deepEqual(result, {});
});
