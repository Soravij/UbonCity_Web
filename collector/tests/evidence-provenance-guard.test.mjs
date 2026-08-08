import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildEvidenceCandidatesForNormalized } from "../server/evidence-candidates.mjs";

const serverPath = path.resolve("D:\\UbonCity_Web\\collector\\server\\index.mjs");
const serverSource = fs.readFileSync(serverPath, "utf8");

// ── Extract functions from source ──────────────────────────────

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${functionName} not found`);
  const paramEnd = source.indexOf(")", start + marker.length);
  const bodyStart = source.indexOf("{", paramEnd);
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

const normalizeEvidenceSourceType = (v) => String(v || "import").trim().toLowerCase();
const buildNormalizedFromExtractedPayload = () => null;

const buildFallbackNormalizedFromItem = loadNamedFunction(serverSource, "buildFallbackNormalizedFromItem", {});

function createSeedFunction(repo, makeEvidenceSignature) {
  return loadNamedFunction(serverSource, "seedEvidenceBlocksForItem", {
    parseObjectCandidate,
    normalizeEvidenceSourceType,
    buildEvidenceCandidatesForNormalized,
    buildNormalizedFromExtractedPayload,
    buildFallbackNormalizedFromItem,
    repo,
    makeEvidenceSignature,
  });
}

// ── Behavioral revert guard ────────────────────────────────────
// 3 source_records: google (id=200), wongnai (id=50), facebook (id=100)
// ORDER BY id DESC → [0] would be facebook (id=100)
// normalized.source_url matches wongnai → must pick id=50

test("seedEvidenceBlocksForItem: wongnai normalized gets wongnai source_record_id, not facebook [0]", () => {
  const captured = [];
  const repo = {
    listEvidenceBlocks: () => [],
    addEvidenceBlock: (_itemId, candidate) => captured.push(candidate),
  };
  const makeEvidenceSignature = (c) => `${c.block_type}-${c.source_record_id}-${c.text_value}`;
  const seedEvidenceBlocksForItem = createSeedFunction(repo, makeEvidenceSignature);

  const item = { id: 1, source_type: "import", lang: "th" };
  const sourceRecords = [
    { id: 200, source_type: "google", source_url: "https://maps.google.com/place/abc", source_entity_id: "g-abc" },
    { id: 50, source_type: "wongnai", source_url: "https://www.wongnai.com/place/123", source_entity_id: "wn-123" },
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
  ];
  const normalized = {
    title: "Test Place",
    source_url: "https://www.wongnai.com/place/123",
    source_name: "wongnai",
  };

  const result = seedEvidenceBlocksForItem(item, {
    normalized,
    sourceType: "wongnai",
    sourceRecords,
  });

  assert.ok(result.added > 0, "should produce candidates");
  assert.ok(captured.length > 0, "should push evidence blocks");

  for (const candidate of captured) {
    assert.equal(
      candidate.source_record_id,
      "50",
      `expected source_record_id "50" (wongnai) but got "${candidate.source_record_id}" — [0] would give "100" (facebook)`
    );
    assert.equal(
      candidate.source_record_type,
      "source_records",
      "source_record_type must be source_records when match found"
    );
  }
});

test("seedEvidenceBlocksForItem: no match → null source_record_id (not [0])", () => {
  const captured = [];
  const repo = {
    listEvidenceBlocks: () => [],
    addEvidenceBlock: (_itemId, candidate) => captured.push(candidate),
  };
  const makeEvidenceSignature = (c) => `${c.block_type}-${c.source_record_id}-${c.text_value}`;
  const seedEvidenceBlocksForItem = createSeedFunction(repo, makeEvidenceSignature);

  const item = { id: 1, source_type: "import", lang: "th" };
  const sourceRecords = [
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
  ];
  const normalized = {
    title: "Test Place",
    source_url: "https://www.wongnai.com/place/123",
    source_name: "wongnai",
  };

  const result = seedEvidenceBlocksForItem(item, {
    normalized,
    sourceType: "wongnai",
    sourceRecords,
  });

  assert.ok(result.added > 0, "should still produce candidates");

  for (const candidate of captured) {
    assert.equal(
      candidate.source_record_id,
      null,
      `expected null source_record_id when no match but got "${candidate.source_record_id}" — [0] would give "100" (facebook)`
    );
    assert.equal(
      candidate.source_record_type,
      null,
      "source_record_type must be null when no match"
    );
  }
});
