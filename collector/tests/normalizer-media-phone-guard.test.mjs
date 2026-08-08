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

// ── Fix 1a: media carried through buildCollectedImportSeed (:6591) ──

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

// ── Fix 1b: attachCollectedSourceRecord payloadJson (:6614) ──
// Anchors by function name, not line number. If the function or its
// payloadJson assignment is removed/renamed, extraction throws → test fails.

function extractPayloadJsonFromAttachCollectedSourceRecord(source) {
  const fnMarker = "function attachCollectedSourceRecord(";
  const fnStart = source.indexOf(fnMarker);
  if (fnStart === -1) throw new Error("attachCollectedSourceRecord not found in source");
  const fnBodyStart = source.indexOf("{", fnStart);
  let depth = 0, fnEnd = -1;
  for (let i = fnBodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") { depth--; if (depth === 0) { fnEnd = i; break; } }
  }
  if (fnEnd === -1) throw new Error("Could not find end of attachCollectedSourceRecord");
  const fnBody = source.slice(fnStart, fnEnd + 1);
  const assignMarker = "const payloadJson = ";
  const assignIdx = fnBody.indexOf(assignMarker);
  if (assignIdx === -1) throw new Error("const payloadJson not found inside attachCollectedSourceRecord");
  const exprStart = assignIdx + assignMarker.length;
  let parenDepth = 0, braceDepth = 0, bracketDepth = 0, exprEnd = -1;
  for (let i = exprStart; i < fnBody.length; i++) {
    const ch = fnBody[i];
    if (ch === "(") parenDepth++;
    if (ch === ")") parenDepth--;
    if (ch === "{") braceDepth++;
    if (ch === "}") braceDepth--;
    if (ch === "[") bracketDepth++;
    if (ch === "]") bracketDepth--;
    if (ch === ";" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) { exprEnd = i; break; }
  }
  if (exprEnd === -1) throw new Error("Could not find end of payloadJson expression");
  return fnBody.slice(exprStart, exprEnd).trim();
}

const expr6614Src = extractPayloadJsonFromAttachCollectedSourceRecord(serverSource);
if (!expr6614Src) throw new Error("extractPayloadJsonFromAttachCollectedSourceRecord returned empty");

function evalPayloadJson6614(rawItem) {
  const normalized = (rawItem?.normalized_json && typeof rawItem.normalized_json === "object") ? rawItem.normalized_json : {};
  return Function("rawItem", "normalized", `return (${expr6614Src});`)(rawItem, normalized);
}

test("attachCollectedSourceRecord :6614 — expression includes media attachment", () => {
  assert.ok(
    expr6614Src.includes("media"),
    `:6614 expression must reference media, got: ${expr6614Src.slice(0, 120)}`
  );
});

test("attachCollectedSourceRecord :6614 — media survives JSON.stringify round-trip", () => {
  const rawMedia = [
    { media_url: "https://example.com/a.jpg", metadata_json: { source: "manual_url_metadata", role: "hero", order: 0 } },
  ];
  const rawItem = {
    payload_json: {
      payload_json: { title: "inner" },
      media: rawMedia,
    },
  };
  const payloadJson = evalPayloadJson6614(rawItem);
  const roundTripped = JSON.parse(JSON.stringify(payloadJson));

  assert.deepEqual(roundTripped.media, rawMedia, "media must survive serialization into source_records.payload_json");
  assert.equal(roundTripped.title, "inner", "inner fields preserved");
});

test("attachCollectedSourceRecord :6614 — no media when rawItem has none", () => {
  const rawItem = {
    payload_json: {
      payload_json: { title: "inner" },
    },
  };
  const payloadJson = evalPayloadJson6614(rawItem);
  assert.equal(payloadJson.media, undefined, "no media key when rawItem lacks it");
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


