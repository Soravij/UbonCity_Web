import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import {
  getBooleanCompatibleTaxonomyCatalog,
  normalizeTaxonomyTrueKeys,
  parseConfirmedTaxonomyChecks,
  searchHomepageCurationCandidates,
} from "../services/homepageCurationService.js";
import {
  getHomepageCurationTaxonomyCatalogHandler,
  searchHomepageCurationCandidatesHandler,
} from "../controllers/homepageCurationController.js";

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Mirrors the real candidate query's `LIMIT ? OFFSET ?` tail so pagination is actually exercised
// instead of every page returning the same rows.
async function withMockedPool(rows, run) {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    const offset = Number(params.at(-1) || 0);
    const limit = Number(params.at(-2) || rows.length);
    return [rows.slice(offset, offset + limit)];
  };
  try {
    return await run(calls);
  } finally {
    pool.query = originalQuery;
  }
}

const candidateRows = [
  {
    id: 1,
    entity_type: "place",
    title: "Both true",
    review_payload_json: JSON.stringify({
      confirmed_taxonomy_checks: { parking: true, air_conditioning: true },
      ai_taxonomy: { parking: false },
      curated_taxonomy: { parking: false },
    }),
  },
  {
    id: 2,
    entity_type: "place",
    title: "Parking false",
    review_payload_json: JSON.stringify({ confirmed_taxonomy_checks: { parking: false, air_conditioning: true } }),
  },
  {
    id: 3,
    entity_type: "place",
    title: "Missing parking",
    review_payload_json: JSON.stringify({ confirmed_taxonomy_checks: { air_conditioning: true } }),
  },
  {
    id: 4,
    entity_type: "place",
    title: "Raw only",
    review_payload_json: JSON.stringify({ ai_taxonomy: { parking: true }, curated_taxonomy: { parking: true } }),
  },
  { id: 5, entity_type: "place", title: "Malformed", review_payload_json: "not-json" },
];

test("homepage curation taxonomy true filters", async (t) => {
  await t.test("catalog exposes only boolean-compatible entries", () => {
    const catalog = getBooleanCompatibleTaxonomyCatalog();
    assert.ok(catalog.length > 0);
    assert.ok(catalog.some((entry) => entry.key === "parking"));
    assert.ok(catalog.every((entry) => ["boolean", "boolean_with_conditions"].includes(entry.answer_type)));
    assert.equal(catalog.some((entry) => entry.key === "setting_type"), false);
  });

  await t.test("canonical parser reads only confirmed_taxonomy_checks", () => {
    assert.deepEqual(
      parseConfirmedTaxonomyChecks(JSON.stringify({
        confirmed_taxonomy_checks: { parking: true },
        ai_taxonomy: { parking: false },
        curated_taxonomy: { parking: false },
      })),
      { parking: true }
    );
    assert.deepEqual(parseConfirmedTaxonomyChecks("malformed"), {});
    assert.deepEqual(parseConfirmedTaxonomyChecks(JSON.stringify({ ai_taxonomy: { parking: true } })), {});
  });

  await t.test("one selected key matches only canonical true and returns selected summary", async () => {
    await withMockedPool(candidateRows, async (calls) => {
      const items = await searchHomepageCurationCandidates({ taxonomyTrue: " parking " });
      assert.deepEqual(items.map((item) => item.id), [1]);
      assert.deepEqual(items[0].taxonomy_summary, { parking: true });
      assert.equal(calls.length, 1);
      assert.match(calls[0].sql, /p\.updated_at/);
      assert.equal(calls[0].sql.includes("parking"), false, "taxonomy key must not be interpolated into SQL");
    });
  });

  await t.test("multiple selected keys use AND; false, missing, null and raw-only values do not match", async () => {
    const rows = [...candidateRows, {
      id: 6,
      entity_type: "place",
      title: "Null parking",
      review_payload_json: JSON.stringify({ confirmed_taxonomy_checks: { parking: null, air_conditioning: true } }),
    }];
    await withMockedPool(rows, async () => {
      const items = await searchHomepageCurationCandidates({ taxonomyTrue: "parking,air_conditioning,parking" });
      assert.deepEqual(items.map((item) => item.id), [1]);
      assert.deepEqual(items[0].taxonomy_summary, { parking: true, air_conditioning: true });
    });
  });

  await t.test("scans past the first page so an older matching place is still found", async () => {
    // Every row of the first scan page fails the filter and the only match sits well beyond it —
    // the exact shape that a filter-after-LIMIT implementation drops on the floor.
    const rows = Array.from({ length: 150 }, (_, index) => ({
      id: 1000 - index,
      entity_type: "place",
      title: `No parking ${index}`,
      review_payload_json: JSON.stringify({ confirmed_taxonomy_checks: { parking: false } }),
    }));
    rows[120] = {
      id: 880,
      entity_type: "place",
      title: "Old matching place",
      review_payload_json: JSON.stringify({ confirmed_taxonomy_checks: { parking: true } }),
    };

    await withMockedPool(rows, async (calls) => {
      const items = await searchHomepageCurationCandidates({ taxonomyTrue: "parking", limit: 5 });
      assert.deepEqual(items.map((item) => item.id), [880]);
      assert.ok(calls.length > 1, "must page past the first scan window");
      assert.ok(calls.every((call) => call.sql.includes("ORDER BY p.id DESC")), "scan must keep the original order");
      assert.deepEqual(calls.map((call) => call.params.at(-1)), [0, 100], "pages must advance by offset");
    });
  });

  await t.test("stops at the requested limit and never returns more than it", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: 500 - index,
      entity_type: "place",
      title: `Match ${index}`,
      review_payload_json: JSON.stringify({ confirmed_taxonomy_checks: { parking: true } }),
    }));

    await withMockedPool(rows, async (calls) => {
      const items = await searchHomepageCurationCandidates({ taxonomyTrue: "parking", limit: 3 });
      assert.equal(items.length, 3);
      assert.deepEqual(items.map((item) => item.id), [500, 499, 498]);
      assert.equal(calls.length, 1);
    });
  });

  await t.test("missing or empty parameter preserves unfiltered candidate flow", async () => {
    await withMockedPool(candidateRows, async () => {
      const omitted = await searchHomepageCurationCandidates({});
      const empty = await searchHomepageCurationCandidates({ taxonomyTrue: " , " });
      assert.deepEqual(omitted.map((item) => item.id), [1, 2, 3, 4, 5]);
      assert.deepEqual(empty.map((item) => item.id), [1, 2, 3, 4, 5]);
      assert.equal(Object.hasOwn(omitted[0], "taxonomy_summary"), false);
    });
  });

  await t.test("invalid and non-boolean keys are rejected with HTTP 400", async () => {
    assert.throws(() => normalizeTaxonomyTrueKeys("unknown_key"), /Invalid boolean taxonomy key/);
    assert.throws(() => normalizeTaxonomyTrueKeys("setting_type"), /Invalid boolean taxonomy key/);

    const res = createMockRes();
    await searchHomepageCurationCandidatesHandler({ query: { taxonomy_true: "setting_type" } }, res);
    assert.equal(res.statusCode, 400);
  });

  await t.test("catalog handler returns the UI contract", async () => {
    const res = createMockRes();
    await getHomepageCurationTaxonomyCatalogHandler({ query: { entity_type: "place" } }, res);
    assert.ok(Array.isArray(res.body?.items));
    assert.ok(res.body.items.every((entry) => Object.keys(entry).sort().join(",") === "answer_type,key,label"));
  });
});
