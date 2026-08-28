import assert from "node:assert/strict";
import test from "node:test";

function parseCtaJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

const CTA_META_KEYS = new Set(["confidence", "checked", "found", "source", "note"]);

function isEmptyCtaScalar(val) {
  if (val === null || val === undefined) return true;
  if (typeof val === "string") {
    const t = val.trim();
    return t === "" || t === "null" || t === "undefined";
  }
  if (Array.isArray(val)) return val.length === 0;
  return false;
}

function isEmptyCtaEntry(val) {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    if ("value" in val) return isEmptyCtaScalar(val.value);
    return Object.entries(val).every(
      ([k, v]) => CTA_META_KEYS.has(k) || isEmptyCtaEntry(v)
    );
  }
  return isEmptyCtaScalar(val);
}

function hasAnyCtaValue(value) {
  return Object.entries(parseCtaJson(value)).some(
    ([key, val]) => !CTA_META_KEYS.has(key) && !isEmptyCtaEntry(val)
  );
}

function mergeCtaPreservingExisting(previousValue, nextValue) {
  const prev = parseCtaJson(previousValue);
  const next = parseCtaJson(nextValue);
  const merged = { ...prev };
  for (const [key, val] of Object.entries(next)) {
    if (CTA_META_KEYS.has(key) || !isEmptyCtaEntry(val)) merged[key] = val;
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

test("empty array next does not overwrite previous array on non-meta key", () => {
  const prev = { tags: ["outdoor", "family"] };
  const next = { tags: [] };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.deepEqual(result.tags, ["outdoor", "family"]);
});

test("non-empty array next overwrites previous array", () => {
  const prev = { tags: ["outdoor"] };
  const next = { tags: ["family"] };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.deepEqual(result.tags, ["family"]);
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

test("whitespace-only string does not overwrite existing value", () => {
  const prev = { phone: "082-123-4567" };
  const next = { phone: "   " };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.equal(result.phone, "082-123-4567");
});

test("string 'null' does not overwrite existing value", () => {
  const prev = { phone: "082-123-4567", line_url: "https://line.me" };
  const next = { phone: "null", line_url: "null" };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.equal(result.phone, "082-123-4567");
  assert.equal(result.line_url, "https://line.me");
});

test("string 'undefined' does not overwrite existing value", () => {
  const prev = { facebook_url: "https://fb.me" };
  const next = { facebook_url: "undefined" };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.equal(result.facebook_url, "https://fb.me");
});

test("empty object as next value does not overwrite existing value", () => {
  const prev = { extra: { url: "https://a.example" } };
  const next = { extra: {} };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.deepEqual(result.extra, { url: "https://a.example" });
});

test("empty array as next value does not overwrite existing value", () => {
  const prev = { tags: ["outdoor"] };
  const next = { tags: [] };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.deepEqual(result.tags, ["outdoor"]);
});

test("hasAnyCtaValue returns false for pack with all null values", () => {
  const pack = {
    ai_cta_contact_json: { phone: null, line_url: null, facebook_url: null, website_url: null, primary_cta: null, source: null, confidence: null, note: null },
  };
  assert.equal(hasAnyCtaValue(pack.ai_cta_contact_json), false);
});

test("hasAnyCtaValue returns true for pack with facebook_url", () => {
  const pack = {
    ai_cta_contact_json: { phone: null, line_url: null, facebook_url: "https://facebook.com/uboncity", website_url: null, primary_cta: null, source: null, confidence: null, note: null },
  };
  assert.equal(hasAnyCtaValue(pack.ai_cta_contact_json), true);
});

test("hasAnyCtaValue returns false for null input", () => {
  assert.equal(hasAnyCtaValue(null), false);
});

test("hasAnyCtaValue returns false for empty object", () => {
  assert.equal(hasAnyCtaValue({}), false);
});

test("hasAnyCtaValue returns false for JSON string of all nulls", () => {
  assert.equal(hasAnyCtaValue(JSON.stringify({ phone: null, line_url: null })), false);
});

test("hasAnyCtaValue false when only meta keys present (confidence + all nulls)", () => {
  assert.equal(hasAnyCtaValue({ confidence: "unknown", phone: null, facebook_url: null }), false);
});

test("hasAnyCtaValue true when meta keys present with real value", () => {
  assert.equal(hasAnyCtaValue({ confidence: "unknown", facebook_url: "https://fb.com/x" }), true);
});

test("hasAnyCtaValue false for curated default shape (all meta + null value)", () => {
  const curated = {
    phone: { checked: false, found: false, value: null, source: [], note: null },
    line_url: { checked: false, found: false, value: null, source: [], note: null },
    facebook_url: { checked: false, found: false, value: null, source: [], note: null },
    website_url: { checked: false, found: false, value: null, source: [], note: null },
    primary_cta: { checked: false, found: false, value: null, source: [], note: null },
  };
  assert.equal(hasAnyCtaValue(curated), false);
});

test("hasAnyCtaValue true for curated with one real value", () => {
  const curated = {
    phone: { checked: true, found: true, value: "0832894629", source: ["manual"], note: null },
    line_url: { checked: false, found: false, value: null, source: [], note: null },
  };
  assert.equal(hasAnyCtaValue(curated), true);
});

test("merge: next sub-object with value:null does not overwrite prev with real value", () => {
  const prev = { phone: { checked: true, found: true, value: "0832894629", source: [], note: null } };
  const next = { phone: { checked: false, found: false, value: null, source: [], note: null } };
  const result = mergeCtaPreservingExisting(prev, next);
  assert.equal(result.phone.value, "0832894629");
});

test("false is a meaningful value (not empty)", () => {
  assert.equal(isEmptyCtaEntry(false), false);
  assert.equal(hasAnyCtaValue({ some_flag: false }), true);
});

test("0 is a meaningful value (not empty)", () => {
  assert.equal(isEmptyCtaEntry(0), false);
  assert.equal(hasAnyCtaValue({ count: 0 }), true);
});
