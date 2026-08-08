import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildNormalizedFromExtractedPayload } from "../collector/sources/extracted-payload-normalizer.mjs";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const serverSource = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${functionName} not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`Could not extract ${functionName}`);
}

function loadNamedFunction(sourceText, functionName, deps = {}) {
  const src = extractFunctionSource(sourceText, functionName);
  const names = Object.keys(deps);
  return Function(...names, `return (${src});`)(...Object.values(deps));
}

const parseObjectCandidate = (v) => {
  if (!v || typeof v !== "object") return null;
  return v;
};
const buildCollectedImportSeed = loadNamedFunction(serverSource, "buildCollectedImportSeed", { parseObjectCandidate });

// ── revert-guard hash ────────────────────────────────────────
const GUARD_HASH = "r2-media-phone-7a3f9c";

// ── Fix 1: media carried through buildCollectedImportSeed ────

test("buildCollectedImportSeed: attaches media from rawItem.payload_json.media into payload_json", () => {
  const rawMedia = [
    { media_url: "https://example.com/a.jpg", metadata_json: { source: "manual_url_metadata", role: "hero", order: 0 } },
    { media_url: "https://example.com/b.jpg", metadata_json: { source: "manual_url_metadata", role: "gallery", order: 1 } },
  ];
  const rawItem = {
    id: 99,
    title_raw: "Test Place",
    payload_json: {
      payload_json: { title: "inner", category: "cafe" },
      media: rawMedia,
    },
    normalized_json: { title: "Test Place", category: "cafe" },
  };
  const result = buildCollectedImportSeed(rawItem, "manual");

  assert.ok(result.itemInput.payload_json, "payload_json should not be null");
  assert.deepEqual(
    result.itemInput.payload_json.media,
    rawMedia,
    "media from rawItem.payload_json.media should be attached to payload_json"
  );
  assert.equal(result.itemInput.payload_json.title, "inner", "inner payload fields should be preserved");
});

test("buildCollectedImportSeed: no media key when rawItem.payload_json has no media", () => {
  const rawItem = {
    id: 100,
    title_raw: "No Media",
    payload_json: {
      payload_json: { title: "inner" },
    },
    normalized_json: { title: "No Media" },
  };
  const result = buildCollectedImportSeed(rawItem, "manual");

  assert.ok(result.itemInput.payload_json, "payload_json should not be null");
  assert.equal(
    result.itemInput.payload_json.media,
    undefined,
    "media key should not exist when rawItem.payload_json.media is absent"
  );
});

test("buildCollectedImportSeed: does not overwrite existing media in inner payload_json", () => {
  const innerMedia = [{ media_url: "https://inner.com/x.jpg" }];
  const outerMedia = [{ media_url: "https://outer.com/y.jpg" }];
  const rawItem = {
    id: 101,
    title_raw: "Has Inner Media",
    payload_json: {
      payload_json: { title: "inner", media: innerMedia },
      media: outerMedia,
    },
    normalized_json: { title: "Has Inner Media" },
  };
  const result = buildCollectedImportSeed(rawItem, "manual");

  assert.deepEqual(
    result.itemInput.payload_json.media,
    innerMedia,
    "existing media in inner payload_json should NOT be overwritten"
  );
});

// ── Fix 2: national_phone_number in extracted normalizer ─────

test("buildNormalizedFromExtractedPayload: national_phone_number from extractedMetadata.phone", () => {
  const payload = {
    extracted_metadata: { title: "Test", phone: "0812345678" },
  };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.ok(result, "should return a candidate");
  assert.equal(result.national_phone_number, "0812345678");
});

test("buildNormalizedFromExtractedPayload: national_phone_number from extractedMetadata.phone_normalized", () => {
  const payload = {
    extracted_metadata: { title: "Test", phone_normalized: "0899999999" },
  };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.ok(result, "should return a candidate");
  assert.equal(result.national_phone_number, "0899999999");
});

test("buildNormalizedFromExtractedPayload: phone takes precedence over phone_normalized", () => {
  const payload = {
    extracted_metadata: { title: "Test", phone: "0811111111", phone_normalized: "0899999999" },
  };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.equal(result.national_phone_number, "0811111111", "phone should take precedence");
});

test("buildNormalizedFromExtractedPayload: national_phone_number is null when no phone fields", () => {
  const payload = {
    extracted_metadata: { title: "Test" },
  };
  const result = buildNormalizedFromExtractedPayload(payload);

  assert.ok(result, "should return a candidate");
  assert.equal(result.national_phone_number, null, "should be null when no phone data");
});

// ── guard hash assertion ─────────────────────────────────────

test("revert-guard hash: if this fails, a behavioral contract was broken", () => {
  assert.equal(GUARD_HASH, "r2-media-phone-7a3f9c", "guard hash mismatch — check which contract broke");
});
