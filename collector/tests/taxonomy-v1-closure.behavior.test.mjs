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
const COLLECTOR_ACCEPTED_SNAPSHOT_TEST = path.resolve(__dirname, "./review-ingest-handoff-snapshot.behavior.test.mjs");
const COLLECTOR_REVIEW_INGEST_MAPPING = path.resolve(__dirname, "../server/review-ingest-mapping.mjs");
const BACKEND_REVIEW_INGEST_SERVICE = path.resolve(__dirname, "../../backend/services/reviewIngestService.js");
const BACKEND_REVIEW_DECISION_SERVICE = path.resolve(__dirname, "../../backend/services/reviewDecisionService.js");
const BACKEND_HOMEPAGE_CURATION_SERVICE = path.resolve(__dirname, "../../backend/services/homepageCurationService.js");
const BACKEND_HOMEPAGE_CURATION_CONTROLLER = path.resolve(__dirname, "../../backend/controllers/homepageCurationController.js");
const ADMIN_HOMEPAGE_CURATION_PAGE = path.resolve(__dirname, "../../admin/src/pages/HomepageCuration.jsx");
const BACKEND_MIGRATION_FILE = path.resolve(__dirname, "../../backend/migrations/012_review_contents.sql");

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

function getSection(doc, title) {
  const start = doc.indexOf(title);
  assert.ok(start >= 0, `missing section: ${title}`);
  const remainder = doc.slice(start + title.length);
  const next = remainder.indexOf("\n## ");
  return next >= 0 ? remainder.slice(0, next) : remainder;
}

test("catalog parity and place-only scope stay fixed", () => {
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
      assert.ok(Array.isArray(entry.downstream_consumers), `missing downstream consumers for ${entry.taxonomy_key}`);
      assert.ok(entry.downstream_consumers.includes("homepage_signals"), `missing homepage_signals for ${entry.taxonomy_key}`);
      assert.ok(entry.downstream_consumers.includes("content_pool"), `missing content_pool for ${entry.taxonomy_key}`);
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

test("closure matrix document covers the full static acceptance contract", async () => {
  const doc = normalizeText(await readText(MATRIX_DOC));
  const backendKeys = uniqueSorted(getTaxonomyV1KeyList());

  const matrixSection = getSection(doc, "## Canonical Key Matrix");
  const exclusionsSection = getSection(doc, "## Intentional Exclusions");
  const runtimeSection = getSection(doc, "## Runtime Acceptance Checklist");

  const matrixRows = [...matrixSection.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/gm)].map((match) => match[1]);

  assert.equal((doc.match(/Runtime acceptance status: PENDING/g) || []).length, 1);
  assert.doesNotMatch(doc, /Runtime acceptance status:\s*COMPLETE/i);

  assert.deepEqual(uniqueSorted(matrixRows), backendKeys);
  assert.equal(matrixRows.length, backendKeys.length);

  assert.match(matrixSection, /\| Taxonomy key \| Applicable categories \| Answer type \| Confirmed snapshot source \| Backend review storage \| Published destination \| Internal consumer \| Static status \| Runtime status \|/);
  for (const key of backendKeys) {
    const rowPattern = new RegExp(
      String.raw`\|\s*\`${key}\`\s*\|[^|]*\|[^|]*\|\s*accepted field review snapshot\.confirmed_taxonomy_json\s*\|\s*review_contents\.handoff_snapshot_json\s*\|\s*places\.curated_taxonomy_json\s*\|\s*Homepage Signals / Content Pool\s*\|\s*VERIFIED\s*\|\s*PENDING\s*\|`
    );
    assert.match(matrixSection, rowPattern);
  }

  assert.doesNotMatch(matrixSection, /\|\s*`[a-z0-9_]+`\s*\|[^|]*\|\s*YES\s*\|/);
  assert.doesNotMatch(matrixSection, /\|\s*`[a-z0-9_]+`\s*\|[^|]*\|\s*PARTIAL\s*\|/);

  for (const excluded of [
    "`category`",
    "`subtype`",
    "`tags`",
    "`custom.*`",
    "unknown/non-catalog observations",
    "Event taxonomy",
  ]) {
    assert.match(exclusionsSection, new RegExp(excluded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(runtimeSection, /\| Category \| Representative item ID \| Field Pack generated \| Assignment issued \| Work Return accepted \| confirmed_taxonomy_json verified \| Backend review ingest verified \| Approval\/published storage verified \| Candidate API filter verified \| Admin Content Pool verified \| CTA path verified \| Result \|/);
  const runtimeRows = runtimeSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => SUPPORTED_TAXONOMY_CATEGORIES.some((category) => line.startsWith(`| ${category} |`)));

  assert.equal(runtimeRows.length, SUPPORTED_TAXONOMY_CATEGORIES.length);
  for (const row of runtimeRows) {
    assert.match(row, /\| [a-z]+ \| TBD \|/);
    assert.equal((row.match(/\bPENDING\b/g) || []).length, 10);
  }
});

test("source contract guards match the actual transport contract", async () => {
  const collectorAcceptedSnapshotTest = normalizeText(await readText(COLLECTOR_ACCEPTED_SNAPSHOT_TEST));
  const collectorReviewIngestMapping = normalizeText(await readText(COLLECTOR_REVIEW_INGEST_MAPPING));
  const backendReviewIngestService = normalizeText(await readText(BACKEND_REVIEW_INGEST_SERVICE));
  const backendReviewDecisionService = normalizeText(await readText(BACKEND_REVIEW_DECISION_SERVICE));
  const backendHomepageCurationService = normalizeText(await readText(BACKEND_HOMEPAGE_CURATION_SERVICE));
  const backendHomepageCurationController = normalizeText(await readText(BACKEND_HOMEPAGE_CURATION_CONTROLLER));
  const adminHomepageCurationPage = normalizeText(await readText(ADMIN_HOMEPAGE_CURATION_PAGE));
  const backendMigrationFile = normalizeText(await readText(BACKEND_MIGRATION_FILE));

  assert.match(collectorAcceptedSnapshotTest, /confirmed_taxonomy_json/);
  assert.match(collectorReviewIngestMapping, /buildAcceptedFieldReviewSnapshotByItem/);
  assert.match(collectorReviewIngestMapping, /handoff_snapshot_json/);
  assert.match(backendReviewIngestService, /handoffSnapshotJson/);
  assert.match(backendReviewIngestService, /handoff_snapshot_json/);
  assert.match(backendMigrationFile, /handoff_snapshot_json/);
  assert.match(backendReviewDecisionService, /confirmed_taxonomy_json/);
  assert.match(backendReviewDecisionService, /curated_taxonomy_json/);
  assert.match(backendReviewDecisionService, /extractCuratedTaxonomyFromReviewSnapshot/);
  assert.match(backendHomepageCurationService, /curated_taxonomy_json/);
  assert.match(backendHomepageCurationController, /taxonomy_filters/);
  assert.match(adminHomepageCurationPage, /taxonomy_filters/);
});
