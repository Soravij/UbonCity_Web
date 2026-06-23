import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SUPPORTED_TAXONOMY_CATEGORIES,
  getTaxonomyCatalogEntriesForCategory,
} from "../server/taxonomy-catalog.mjs";
import {
  getTaxonomyV1KeyList,
  isKnownTaxonomyCatalogKey,
} from "../../backend/constants/taxonomyCatalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MATRIX_DOC = path.resolve(__dirname, "../docs/taxonomy-v1-end-to-end-matrix.md");
const COLLECTOR_REVIEW_INGEST_MAPPING = path.resolve(__dirname, "../server/review-ingest-mapping.mjs");
const BACKEND_REVIEW_INGEST_SERVICE = path.resolve(__dirname, "../../backend/services/reviewIngestService.js");
const BACKEND_REVIEW_DECISION_SERVICE = path.resolve(__dirname, "../../backend/services/reviewDecisionService.js");
const BACKEND_HOMEPAGE_CURATION_SERVICE = path.resolve(__dirname, "../../backend/services/homepageCurationService.js");
const BACKEND_HOMEPAGE_CURATION_CONTROLLER = path.resolve(__dirname, "../../backend/controllers/homepageCurationController.js");
const BACKEND_HOMEPAGE_CURATION_ROUTES = path.resolve(__dirname, "../../backend/routes/homepageCurationRoutes.js");
const ADMIN_HOMEPAGE_CURATION_PAGE = path.resolve(__dirname, "../../admin/src/pages/HomepageCuration.jsx");

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

function getCollectorTaxonomyKeys() {
  const keys = [];
  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    const entries = getTaxonomyCatalogEntriesForCategory(category, "place");
    for (const entry of entries) {
      keys.push(entry.taxonomy_key);
    }
  }
  return uniqueSorted(keys);
}

test("taxonomy catalog categories and place-only entries match the approved scope", () => {
  assert.deepEqual([...SUPPORTED_TAXONOMY_CATEGORIES], [
    "attractions",
    "activities",
    "hotels",
    "cafes",
    "restaurants",
    "transport",
  ]);

  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    const entries = getTaxonomyCatalogEntriesForCategory(category, "place");
    assert.ok(entries.length > 0, `missing entries for ${category}`);

    for (const entry of entries) {
      assert.equal(typeof entry.taxonomy_key, "string");
      assert.equal(typeof entry.answer_type, "string");
      assert.ok(Array.isArray(entry.categories), `missing categories for ${entry.taxonomy_key}`);
      assert.ok(entry.categories.includes(category), `entry ${entry.taxonomy_key} missing ${category}`);
      assert.ok(Array.isArray(entry.downstream_consumers), `missing downstream_consumers for ${entry.taxonomy_key}`);
      assert.ok(entry.downstream_consumers.includes("homepage_signals"), `missing homepage_signals for ${entry.taxonomy_key}`);
      assert.ok(entry.downstream_consumers.includes("content_pool"), `missing content_pool for ${entry.taxonomy_key}`);
      assert.ok(Array.isArray(entry.item_types), `missing item_types for ${entry.taxonomy_key}`);
      assert.deepEqual(entry.item_types, ["place"]);
      assert.notEqual(entry.taxonomy_key, "category");
      assert.notEqual(entry.taxonomy_key, "subtype");
      assert.notEqual(entry.taxonomy_key, "tags");
      assert.equal(entry.taxonomy_key.startsWith("custom."), false);
    }
  }
});

test("collector and backend taxonomy key lists stay in parity", () => {
  const collectorKeys = getCollectorTaxonomyKeys();
  const backendKeys = uniqueSorted(getTaxonomyV1KeyList());

  assert.deepEqual(collectorKeys, backendKeys);
  assert.equal(collectorKeys.length, 48);
  assert.equal(backendKeys.length, 48);

  for (const key of backendKeys) {
    assert.equal(isKnownTaxonomyCatalogKey(key), true, `backend key should be approved: ${key}`);
  }

  for (const forbidden of ["category", "subtype", "tags"]) {
    assert.equal(backendKeys.includes(forbidden), false, `forbidden canonical key should be absent: ${forbidden}`);
    assert.equal(collectorKeys.includes(forbidden), false, `forbidden canonical key should be absent: ${forbidden}`);
  }

  assert.equal(backendKeys.some((key) => String(key).startsWith("custom.")), false);
  assert.equal(collectorKeys.some((key) => String(key).startsWith("custom.")), false);
});

test("closure matrix document contains one row per approved key and keeps runtime acceptance pending", async () => {
  const doc = normalizeText(await readText(MATRIX_DOC));
  const backendKeys = uniqueSorted(getTaxonomyV1KeyList());
  const matrixStart = doc.indexOf("## Taxonomy Key Closure Matrix");
  const runtimeStart = doc.indexOf("## Runtime Acceptance Checklist");
  assert.ok(matrixStart >= 0, "missing taxonomy key closure matrix section");
  assert.ok(runtimeStart > matrixStart, "missing runtime acceptance checklist section");
  const matrixSection = doc.slice(matrixStart, runtimeStart);
  const runtimeSection = doc.slice(runtimeStart);
  const matrixRows = [...matrixSection.matchAll(/^\|\s*([a-z0-9_]+)\s*\|/gm)].map((match) => match[1]);

  assert.match(doc, /Static acceptance status: COMPLETE/);
  assert.match(doc, /Runtime acceptance status: PENDING/);
  assert.doesNotMatch(doc, /Runtime acceptance status:\s*COMPLETE/i);

  assert.deepEqual(uniqueSorted(matrixRows), backendKeys);
  assert.equal(matrixRows.length, backendKeys.length);

  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    assert.match(runtimeSection, new RegExp(`\\|\\s*${category}\\s*\\|\\s*representative place fixture\\s*\\|\\s*PENDING\\s*\\|`));
  }

  for (const marker of [
    "collector/server/taxonomy-catalog.mjs",
    "collector/server/review-ingest-mapping.mjs",
    "backend/services/reviewIngestService.js",
    "backend/services/reviewDecisionService.js",
    "backend/services/homepageCurationService.js",
    "backend/controllers/homepageCurationController.js",
    "backend/routes/homepageCurationRoutes.js",
    "admin/src/pages/HomepageCuration.jsx",
  ]) {
    assert.match(doc, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("source contract markers are present across collector, backend, route, and admin layers", async () => {
  const collectorReviewIngestMapping = normalizeText(await readText(COLLECTOR_REVIEW_INGEST_MAPPING));
  const backendReviewIngestService = normalizeText(await readText(BACKEND_REVIEW_INGEST_SERVICE));
  const backendReviewDecisionService = normalizeText(await readText(BACKEND_REVIEW_DECISION_SERVICE));
  const backendHomepageCurationService = normalizeText(await readText(BACKEND_HOMEPAGE_CURATION_SERVICE));
  const backendHomepageCurationController = normalizeText(await readText(BACKEND_HOMEPAGE_CURATION_CONTROLLER));
  const backendHomepageCurationRoutes = normalizeText(await readText(BACKEND_HOMEPAGE_CURATION_ROUTES));
  const adminHomepageCurationPage = normalizeText(await readText(ADMIN_HOMEPAGE_CURATION_PAGE));

  assert.match(collectorReviewIngestMapping, /review_source_kind/);
  assert.match(backendReviewIngestService, /review_source_kind/);
  assert.match(backendReviewIngestService, /handoff_snapshot_json/);
  assert.match(backendReviewDecisionService, /curated_taxonomy_json/);
  assert.match(backendHomepageCurationService, /curated_taxonomy_json/);
  assert.match(backendHomepageCurationController, /taxonomy_filters/);
  assert.match(adminHomepageCurationPage, /taxonomy_filters/);

  const compactRoutes = backendHomepageCurationRoutes.replace(/\s+/g, " ");
  assert.match(
    compactRoutes,
    /router\.get\("\/homepage-curation\/taxonomy-options", protect, authorizeAdmin, getHomepageCurationTaxonomyOptionsHandler\)/
  );
  assert.match(
    compactRoutes,
    /router\.get\("\/homepage-curation\/candidates", protect, authorizeAdmin, searchHomepageCurationCandidatesHandler\)/
  );
});
