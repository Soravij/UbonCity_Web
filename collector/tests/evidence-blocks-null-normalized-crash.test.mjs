import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEvidenceCandidatesForNormalized, normalizeUrlForComparison } from "../server/evidence-candidates.mjs";
import { buildNormalizedFromExtractedPayload } from "../collector/sources/extracted-payload-normalizer.mjs";
import { makeEvidenceSignature } from "../server/evidence-signature.mjs";

// Regression coverage for the crash proved on Runtime:
//   GET /api/items/28/evidence-blocks -> 500
//   TypeError: Cannot read properties of null (reading 'source_url')
//     at seedEvidenceBlocksForItem (collector/server/index.mjs:6876:39)
// Root cause: buildNormalizedFromExtractedPayload() returns null (by contract,
// see extracted-payload-normalizer.mjs:85-95) when a source_record's payload_json
// exists but the crawl produced no usable content (fetch failure). index.mjs
// dereferenced normalized.source_url without checking for that null first.
// This file exercises the REAL buildNormalizedFromExtractedPayload and
// buildEvidenceCandidatesForNormalized (not mocked), unlike
// evidence-provenance-guard.test.mjs, specifically to prove the null contract
// and the index.mjs call site agree with each other end to end.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "..", "server", "index.mjs");
const serverSource = fs.readFileSync(serverPath, "utf8");

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
// Simplified stand-in matching index.mjs's normalizeEvidenceSourceType fallback
// behavior for unrecognized source types (same shim used in
// evidence-provenance-guard.test.mjs) -- the real function depends on a
// module-level Set that can't be pulled out with source extraction, and its
// exact mapping table is not what this fix is about.
const normalizeEvidenceSourceType = (v) => String(v || "import").trim().toLowerCase();
const buildFallbackNormalizedFromItem = loadNamedFunction(serverSource, "buildFallbackNormalizedFromItem", {});

function createSeedFunction(repo) {
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

function makeRepo() {
  const captured = [];
  const repo = {
    listEvidenceBlocks: () => [],
    addEvidenceBlock: (_itemId, candidate) => captured.push(candidate),
  };
  return { repo, captured };
}

// ── Fixture matching record 131 (item 28, touronthai.com) ──────
// payload_json is not null (a crawl attempt happened) but it failed:
// metadata_fetch_error set, extracted_metadata empty, extracted_article
// null, zero reviews. buildNormalizedFromExtractedPayload's own contract
// (extracted-payload-normalizer.mjs:85-95) returns null for exactly this
// shape because there is no usable content in any field it checks.
const FAILED_CRAWL_PAYLOAD = {
  submitted_url: "https://www.touronthai.com/place/999",
  fetched_url: "https://www.touronthai.com/place/999",
  metadata_fetch_error: "fetch failed",
  extracted_metadata: {},
  extracted_article: null,
  extracted_reviews: { items: [] },
  media: [],
};

test("seedEvidenceBlocksForItem: record-131-style failed crawl (payload present, normalized null) does not throw and seeds nothing", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo);

  const item = { id: 28, source_type: "import", lang: "th" };
  const sourceRecords = [
    {
      id: 131,
      source_type: "touronthai",
      source_url: "https://www.touronthai.com/place/999",
      payload_json: FAILED_CRAWL_PAYLOAD,
    },
  ];

  // Pre-fix, this line threw: TypeError: Cannot read properties of null (reading 'source_url')
  let result;
  assert.doesNotThrow(() => {
    result = seed(item, { sourceRecords });
  }, "seeding must not crash on a failed-crawl source_record");

  assert.equal(result.added, 0, "a failed crawl has no evidence to seed -- record must be skipped, not faked");
  assert.equal(captured.length, 0);
});

test("seedEvidenceBlocksForItem: record-130-style normal payload still seeds evidence blocks", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo);

  const item = { id: 28, source_type: "import", lang: "th" };
  const sourceRecords = [
    {
      id: 130,
      source_type: "touronthai",
      source_url: "https://www.touronthai.com/place/998",
      payload_json: {
        normalized_json: {
          title: "Wat Test",
          description: "A well-documented temple.",
          source_url: "https://www.touronthai.com/place/998",
          source_name: "touronthai",
        },
      },
    },
  ];

  const result = seed(item, { sourceRecords });

  assert.ok(result.added > 0, "a normal payload with usable content must still seed blocks");
  assert.ok(captured.length > 0);
  for (const c of captured) {
    assert.equal(c.source_record_id, "130");
  }
});

test("seedEvidenceBlocksForItem: item with no source_record at all does not throw", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo);

  const item = { id: 42, source_type: "import", lang: "th" };

  let result;
  assert.doesNotThrow(() => {
    result = seed(item, { sourceRecords: [] });
  });

  assert.equal(result.added, 0);
  assert.equal(captured.length, 0);
});

test("seedEvidenceBlocksForItem: mixed sourceRecords -- failed crawl record is skipped, healthy record still seeds", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo);

  const item = { id: 28, source_type: "import", lang: "th" };
  const sourceRecords = [
    {
      id: 131,
      source_type: "touronthai",
      source_url: "https://www.touronthai.com/place/999",
      payload_json: FAILED_CRAWL_PAYLOAD,
    },
    {
      id: 130,
      source_type: "touronthai",
      source_url: "https://www.touronthai.com/place/998",
      payload_json: {
        normalized_json: {
          title: "Wat Test",
          description: "A well-documented temple.",
          source_url: "https://www.touronthai.com/place/998",
          source_name: "touronthai",
        },
      },
    },
  ];

  let result;
  assert.doesNotThrow(() => {
    result = seed(item, { sourceRecords });
  });

  assert.ok(result.added > 0);
  for (const c of captured) {
    assert.equal(c.source_record_id, "130", "no evidence should be attributed to the failed-crawl record 131");
  }
});
