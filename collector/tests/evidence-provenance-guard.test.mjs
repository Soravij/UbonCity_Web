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
const buildNormalizedFromExtractedPayload = () => null;
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

const THREE_RECORDS = [
  { id: 200, source_type: "google", source_url: "https://maps.google.com/place/abc", source_entity_id: "g-abc" },
  { id: 50, source_type: "wongnai", source_url: "https://www.wongnai.com/place/123", source_entity_id: "wn-123" },
  { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
];

function assertAllCandidatesHaveSourceRecordId(captured, expectedId, label) {
  assert.ok(captured.length > 0, `${label}: should push evidence blocks`);
  for (const c of captured) {
    assert.equal(
      c.source_record_id,
      expectedId,
      `${label}: expected source_record_id "${expectedId}" but got "${c.source_record_id}"`
    );
  }
}

// ── :6847 revert guard (normalized branch) ─────────────────────

test("seedEvidenceBlocksForItem :6847 — wongnai match picks id=50, not [0] (id=200)", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  seed({ id: 1, source_type: "import", lang: "th" }, {
    normalized: { title: "Test", source_url: "https://www.wongnai.com/place/123", source_name: "wongnai" },
    sourceType: "wongnai",
    sourceRecords: THREE_RECORDS,
  });

  assertAllCandidatesHaveSourceRecordId(captured, "50", ":6847 wongnai match");
});

// ── :6891 revert guard (fallback branch) ───────────────────────

test("seedEvidenceBlocksForItem :6891 — fallback match picks id=50, not [0] (id=200)", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  // Call without options.normalized → enters else branch
  // sourceRecords have no payload_json → for-loop produces 0 candidates
  // → falls back to buildFallbackNormalizedFromItem(item)
  // item.source_url matches wongnai → must pick id=50
  seed({ id: 1, source_type: "import", lang: "th", title: "Test", source_url: "https://www.wongnai.com/place/123" }, {
    sourceType: "wongnai",
    sourceRecords: THREE_RECORDS,
  });

  assertAllCandidatesHaveSourceRecordId(captured, "50", ":6891 fallback match");
});

// ── URL normalization behavioral tests ──────────────────────────

test("URL normalization: trailing slash still matches", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  seed({ id: 1, source_type: "import", lang: "th" }, {
    normalized: { title: "Test", source_url: "https://www.wongnai.com/place/123/" },
    sourceType: "wongnai",
    sourceRecords: THREE_RECORDS,
  });

  assertAllCandidatesHaveSourceRecordId(captured, "50", "trailing slash");
});

test("URL normalization: www vs no-www still matches", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  const records = [
    { id: 50, source_type: "wongnai", source_url: "https://wongnai.com/place/123", source_entity_id: "wn-123" },
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
  ];

  seed({ id: 1, source_type: "import", lang: "th" }, {
    normalized: { title: "Test", source_url: "https://www.wongnai.com/place/123" },
    sourceType: "wongnai",
    sourceRecords: records,
  });

  assertAllCandidatesHaveSourceRecordId(captured, "50", "www vs no-www");
});

test("URL normalization: http vs https still matches", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  const records = [
    { id: 50, source_type: "wongnai", source_url: "https://www.wongnai.com/place/123", source_entity_id: "wn-123" },
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
  ];

  seed({ id: 1, source_type: "import", lang: "th" }, {
    normalized: { title: "Test", source_url: "http://www.wongnai.com/place/123" },
    sourceType: "wongnai",
    sourceRecords: records,
  });

  assertAllCandidatesHaveSourceRecordId(captured, "50", "http vs https");
});

test("URL normalization: query string ignored, still matches", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  const records = [
    { id: 50, source_type: "wongnai", source_url: "https://www.wongnai.com/place/123", source_entity_id: "wn-123" },
    { id: 100, source_type: "facebook", source_url: "https://facebook.com/place/999", source_entity_id: "fb-999" },
  ];

  seed({ id: 1, source_type: "import", lang: "th" }, {
    normalized: { title: "Test", source_url: "https://www.wongnai.com/place/123?ref=search&utm_source=google" },
    sourceType: "wongnai",
    sourceRecords: records,
  });

  assertAllCandidatesHaveSourceRecordId(captured, "50", "query string");
});

// ── No-match fallback ──────────────────────────────────────────

test("seedEvidenceBlocksForItem: no match → null source_record_id", () => {
  const { repo, captured } = makeRepo();
  const seed = createSeedFunction(repo, makeSig);

  seed({ id: 1, source_type: "import", lang: "th" }, {
    normalized: { title: "Test", source_url: "https://unknown.com/place/999" },
    sourceType: "unknown",
    sourceRecords: THREE_RECORDS,
  });

  assertAllCandidatesHaveSourceRecordId(captured, null, "no match");
});
