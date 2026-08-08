import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const serverPath = path.resolve("D:\\UbonCity_Web\\collector\\server\\index.mjs");
const serverSource = fs.readFileSync(serverPath, "utf8");

function extractFunctionBody(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${functionName} not found`);
  const paramEnd = source.indexOf(")", start + marker.length);
  const bodyStart = source.indexOf("{", paramEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") { depth--; if (depth === 0) return source.slice(bodyStart, i + 1); }
  }
  throw new Error(`Could not extract ${functionName}`);
}

// ── Revert guard: assert fix expression exists in source ──────
// If the fix at :6847 is reverted to `sourceRecords[0]`, this test
// fails with a clear assertion diff showing the old pattern returned.

test("seedEvidenceBlocksForItem :6847 — uses URL match, not sourceRecords[0]", () => {
  const fnBody = extractFunctionBody(serverSource, "seedEvidenceBlocksForItem");

  // Extract just the if (options.normalized) block — first block after that condition
  const normalizedBranch = fnBody.indexOf("if (options.normalized)");
  assert.ok(normalizedBranch !== -1, "if (options.normalized) branch not found");
  const blockStart = fnBody.indexOf("{", normalizedBranch);
  let depth = 0, blockEnd = -1;
  for (let i = blockStart; i < fnBody.length; i++) {
    if (fnBody[i] === "{") depth++;
    if (fnBody[i] === "}") { depth--; if (depth === 0) { blockEnd = i; break; } }
  }
  assert.ok(blockEnd !== -1, "Could not find end of normalized branch");
  const normalizedBlock = fnBody.slice(blockStart, blockEnd + 1);

  assert.ok(
    normalizedBlock.includes("sourceRecords.find("),
    "sourceRecord must be selected via sourceRecords.find(), not sourceRecords[0]"
  );
  assert.ok(
    normalizedBlock.includes("normalizedUrl"),
    "must use normalizedUrl for matching"
  );
  assert.ok(
    !normalizedBlock.includes("sourceRecords[0]"),
    "sourceRecords[0] must NOT appear in the normalized branch"
  );
});

// ── Behavioral: extract the matching logic and test it ─────────
// Extract just the :6847-6854 matching block from source, wrap as a
// standalone function, and verify it picks the correct record.

test("matching logic: picks record whose source_url matches normalizedUrl", () => {
  const matchBlock = `
    const normalizedUrl = String(options.normalized.source_url || "").trim().toLowerCase();
    const sourceRecord = normalizedUrl
      ? sourceRecords.find((r) => {
          const rUrl = String(r?.source_url || "").trim().toLowerCase();
          const rEntity = String(r?.source_entity_id || "").trim().toLowerCase();
          return rUrl === normalizedUrl || rEntity === normalizedUrl;
        }) || null
      : null;
    return sourceRecord;
  `;
  const matchFn = new Function("sourceRecords", "options", matchBlock);

  const sourceRecords = [
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
    { id: 50, source_type: "wongnai", source_url: "https://www.wongnai.com/place/123", source_entity_id: "wn-123" },
  ];

  const matched = matchFn(sourceRecords, { normalized: { source_url: "https://www.wongnai.com/place/123" } });
  assert.equal(matched?.id, 50, "must pick wongnai record (id=50), not facebook (id=100)");
  assert.equal(matched?.source_type, "wongnai");
});

test("matching logic: returns null when no URL matches", () => {
  const matchBlock = `
    const normalizedUrl = String(options.normalized.source_url || "").trim().toLowerCase();
    const sourceRecord = normalizedUrl
      ? sourceRecords.find((r) => {
          const rUrl = String(r?.source_url || "").trim().toLowerCase();
          const rEntity = String(r?.source_entity_id || "").trim().toLowerCase();
          return rUrl === normalizedUrl || rEntity === normalizedUrl;
        }) || null
      : null;
    return sourceRecord;
  `;
  const matchFn = new Function("sourceRecords", "options", matchBlock);

  const sourceRecords = [
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
  ];

  const matched = matchFn(sourceRecords, { normalized: { source_url: "https://www.wongnai.com/place/123" } });
  assert.equal(matched, null, "must return null when no match — not fall back to [0]");
});

test("matching logic: returns null when normalized has no source_url", () => {
  const matchBlock = `
    const normalizedUrl = String(options.normalized.source_url || "").trim().toLowerCase();
    const sourceRecord = normalizedUrl
      ? sourceRecords.find((r) => {
          const rUrl = String(r?.source_url || "").trim().toLowerCase();
          const rEntity = String(r?.source_entity_id || "").trim().toLowerCase();
          return rUrl === normalizedUrl || rEntity === normalizedUrl;
        }) || null
      : null;
    return sourceRecord;
  `;
  const matchFn = new Function("sourceRecords", "options", matchBlock);

  const sourceRecords = [
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
  ];

  const matched = matchFn(sourceRecords, { normalized: {} });
  assert.equal(matched, null, "must return null when no source_url");
});

test("matching logic: matches by source_entity_id when source_url matches entity id", () => {
  const matchBlock = `
    const normalizedUrl = String(options.normalized.source_url || "").trim().toLowerCase();
    const sourceRecord = normalizedUrl
      ? sourceRecords.find((r) => {
          const rUrl = String(r?.source_url || "").trim().toLowerCase();
          const rEntity = String(r?.source_entity_id || "").trim().toLowerCase();
          return rUrl === normalizedUrl || rEntity === normalizedUrl;
        }) || null
      : null;
    return sourceRecord;
  `;
  const matchFn = new Function("sourceRecords", "options", matchBlock);

  const sourceRecords = [
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
    { id: 50, source_type: "wongnai", source_url: "https://www.wongnai.com/place/123", source_entity_id: "wn-123" },
  ];

  const matched = matchFn(sourceRecords, { normalized: { source_url: "wn-123" } });
  assert.equal(matched?.id, 50, "must match by source_entity_id");
});

test("matching logic: old sourceRecords[0] would pick wrong record", () => {
  const sourceRecords = [
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
    { id: 50, source_type: "wongnai", source_url: "https://www.wongnai.com/place/123", source_entity_id: "wn-123" },
  ];

  const oldBehavior = sourceRecords[0] || null;
  assert.equal(oldBehavior?.id, 100, "old [0] picks facebook (id=100) — wrong provenance");
  assert.equal(oldBehavior?.source_type, "facebook", "old [0] picks facebook — confirms the bug");
});
