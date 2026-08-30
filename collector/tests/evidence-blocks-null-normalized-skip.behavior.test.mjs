import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEvidenceCandidatesForNormalized, normalizeUrlForComparison } from "../server/evidence-candidates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "..", "server", "index.mjs");
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

// buildNormalizedFromExtractedPayload: returns null when payload has no usable content
function buildNormalizedFromExtractedPayload(payload, _sourceRecord) {
  const candidate = {
    title: payload?.title || "",
    description: payload?.description || "",
    image: payload?.image || "",
    address: payload?.address || "",
    article_body_text: payload?.article_body_text || "",
    article_section_texts: Array.isArray(payload?.article_section_texts) ? payload.article_section_texts : [],
    review_snippets: Array.isArray(payload?.review_snippets) ? payload.review_snippets : [],
  };
  if (
    !candidate.title &&
    !candidate.description &&
    !candidate.image &&
    !candidate.address &&
    !candidate.article_body_text &&
    !candidate.article_section_texts.length &&
    !candidate.review_snippets.length
  ) {
    return null;
  }
  return candidate;
}

const buildFallbackNormalizedFromItem = loadNamedFunction(serverSource, "buildFallbackNormalizedFromItem", {});

function createSeedFunction(repo, makeEvidenceSignature) {
  return loadNamedFunction(serverSource, "seedEvidenceBlocksForItem", {
    parseObjectCandidate,
    normalizeEvidenceSourceType,
    buildEvidenceCandidatesForNormalized,
    buildNormalizedFromExtractedPayload,
    buildFallbackNormalizedFromItem,
    normalizeUrlForComparison,
    repo,
    makeEvidenceSignature,
  });
}

// ── Shared fixtures ────────────────────────────────────────────

function makeRepo() {
  const captured = [];
  const repo = {
    listEvidenceBlocks: () => [],
    addEvidenceBlock: (_itemId, candidate) => captured.push(candidate),
  };
  return { repo, captured };
}
const makeSig = (c) => `${c.block_type}-${c.source_record_id}-${c.text_value}`;

// ── Test: null normalized from one source record should be skipped ──

test("seedEvidenceBlocksForItem: source_record with empty payload (null normalized) is skipped, other records still produce evidence blocks", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  const item = { id: 42, source_type: "import", lang: "th", title: "Test Place", source_url: "https://example.com/place/42" };

  // Record A: empty payload → buildNormalizedFromExtractedPayload returns null
  const recordA = {
    id: 101,
    source_type: "google",
    source_url: "https://maps.google.com/place/a",
    source_entity_id: "g-a",
    payload_json: { title: "", description: "", image: "" },
  };

  // Record B: valid payload with title → produces candidates
  const recordB = {
    id: 102,
    source_type: "wongnai",
    source_url: "https://www.wongnai.com/place/b",
    source_entity_id: "wn-b",
    payload_json: { title: "Good Restaurant", description: "Nice food" },
  };

  // Record C: also empty → skipped
  const recordC = {
    id: 103,
    source_type: "facebook",
    source_url: "https://facebook.com/place/c",
    source_entity_id: "fb-c",
    payload_json: {},
  };

  // Should not throw
  assert.doesNotThrow(() => {
    seed(item, { sourceRecords: [recordA, recordB, recordC] });
  });

  // Should have produced evidence blocks from recordB only
  assert.ok(captured.length > 0, "should produce evidence blocks from valid record");

  for (const c of captured) {
    assert.equal(
      c.source_record_id,
      "102",
      `expected source_record_id "102" (recordB) but got "${c.source_record_id}"`
    );
  }
});

test("seedEvidenceBlocksForItem: all source_records produce null normalized → falls back to item", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  const item = { id: 42, source_type: "import", lang: "th", title: "Fallback Place", source_url: "https://example.com/place/42" };

  const recordA = {
    id: 201,
    source_type: "google",
    source_url: "https://maps.google.com/place/x",
    source_entity_id: "g-x",
    payload_json: { title: "", description: "" },
  };
  const recordB = {
    id: 202,
    source_type: "wongnai",
    source_url: "https://www.wongnai.com/place/y",
    source_entity_id: "wn-y",
    payload_json: {},
  };

  // Should not throw
  assert.doesNotThrow(() => {
    seed(item, { sourceRecords: [recordA, recordB] });
  });

  // Falls back to buildFallbackNormalizedFromItem → produces candidates
  assert.ok(captured.length > 0, "should produce evidence blocks from fallback");
});
