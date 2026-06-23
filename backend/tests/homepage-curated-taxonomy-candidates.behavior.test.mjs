import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import pool from "../config/db.js";
import {
  getHomepageCurationTaxonomyOptionsHandler,
  searchHomepageCurationCandidatesHandler,
} from "../controllers/homepageCurationController.js";
import { searchHomepageCurationCandidates } from "../services/homepageCurationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_FILE = path.resolve(__dirname, "../services/homepageCurationService.js");
const ROUTE_FILE = path.resolve(__dirname, "../routes/homepageCurationRoutes.js");

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function withPoolQueryMock(handler) {
  const original = pool.query;
  pool.query = handler;
  return () => {
    pool.query = original;
  };
}

function normalizeSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

test("controller passes valid taxonomy_filters object to service", async () => {
  let captured = null;
  const req = {
    query: {
      entity_type: "place",
      lang: "th",
      q: "coffee",
      limit: "10",
      taxonomy_filters: JSON.stringify({
        parking: false,
        price_level: "standard",
      }),
    },
  };
  const res = createRes();

  await searchHomepageCurationCandidatesHandler(req, res, {
    searchHomepageCurationCandidates: async (args) => {
      captured = args;
      return [{ id: 1 }];
    },
  });

  assert.deepEqual(captured, {
    entityType: "place",
    lang: "th",
    q: "coffee",
    limit: "10",
    taxonomyFilters: {
      parking: false,
      price_level: "standard",
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { items: [{ id: 1 }] });
});

test("controller passes missing taxonomy_filters as null to service", async () => {
  let captured = null;
  const req = {
    query: {
      entity_type: "place",
      lang: "th",
      q: "",
      limit: "5",
    },
  };
  const res = createRes();

  await searchHomepageCurationCandidatesHandler(req, res, {
    searchHomepageCurationCandidates: async (args) => {
      captured = args;
      return [];
    },
  });

  assert.deepEqual(captured, {
    entityType: "place",
    lang: "th",
    q: "",
    limit: "5",
    taxonomyFilters: null,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { items: [] });
});

test("taxonomy options handler returns sorted approved taxonomy keys", async () => {
  const res = createRes();

  await getHomepageCurationTaxonomyOptionsHandler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body?.items));
  assert.ok(res.body.items.length > 0);
  const keys = res.body.items.map((item) => item.key);
  const sortedKeys = [...keys].sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepEqual(keys, sortedKeys);
  assert.ok(keys.includes("parking"));
  assert.ok(keys.includes("price_level"));
  assert.ok(keys.includes("service_scope"));
});

test("homepage curation routes expose taxonomy options endpoint", async () => {
  const source = await fs.readFile(ROUTE_FILE, "utf8");
  assert.match(source, /homepage-curation\/taxonomy-options/);
  assert.match(source, /getHomepageCurationTaxonomyOptionsHandler/);
});

test("controller returns HTTP 400 for malformed or scalar taxonomy_filters", async () => {
  const invalidInputs = [
    "{not-json",
    JSON.stringify(["parking", false]),
    JSON.stringify("parking"),
    JSON.stringify(1),
    JSON.stringify(true),
    JSON.stringify(null),
  ];

  for (const taxonomyFilters of invalidInputs) {
    let called = false;
    const req = { query: { taxonomy_filters: taxonomyFilters } };
    const res = createRes();

    await searchHomepageCurationCandidatesHandler(req, res, {
      searchHomepageCurationCandidates: async () => {
        called = true;
        return [];
      },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "Invalid taxonomy_filters" });
    assert.equal(called, false);
  }
});

test("missing taxonomy_filters preserves current place search and returns parsed curated taxonomy", async () => {
  const calls = [];
  const restore = withPoolQueryMock(async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    calls.push({ sql: String(sql || ""), params: Array.isArray(params) ? params : [] });
    if (normalized.startsWith("select")) {
      return [[
        {
          id: 11,
          entity_type: "place",
          category: "cafes",
          slug: "place-11",
          title: "Coffee Shop",
          description: "A place",
          curated_taxonomy_json: JSON.stringify({
            parking: false,
            price_level: "standard",
          }),
        },
        {
          id: 10,
          entity_type: "place",
          category: "cafes",
          slug: "place-10",
          title: "Coffee Shop 2",
          description: "Another place",
          curated_taxonomy_json: null,
        },
      ]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  try {
    const items = await searchHomepageCurationCandidates({
      entityType: "place",
      lang: "th",
      q: "coffee",
      limit: 2,
    });

    assert.equal(items.length, 2);
    assert.equal(items[0].curated_taxonomy_json.parking, false);
    assert.equal(items[0].curated_taxonomy_json.price_level, "standard");
    assert.equal(items[1].curated_taxonomy_json, null);
    assert.match(normalizeSql(calls[0].sql), /limit \?/);
  } finally {
    restore();
  }
});

test("approved place candidate rows include curated_taxonomy_json and taxonomy filters apply before final limit", async () => {
  const calls = [];
  const restore = withPoolQueryMock(async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    calls.push({ sql: String(sql || ""), params: Array.isArray(params) ? params : [] });
    if (normalized.startsWith("select") && normalized.includes("from places p")) {
      return [[
        { id: 50, entity_type: "place", category: "cafes", slug: "place-50", title: "Nope 1", description: "", curated_taxonomy_json: JSON.stringify({ parking: true }) },
        { id: 49, entity_type: "place", category: "cafes", slug: "place-49", title: "Nope 2", description: "", curated_taxonomy_json: JSON.stringify({ parking: true }) },
        { id: 48, entity_type: "place", category: "cafes", slug: "place-48", title: "Match 1", description: "", curated_taxonomy_json: JSON.stringify({ parking: false, price_level: "standard", service_scope: ["city", "airport"] }) },
        { id: 47, entity_type: "place", category: "cafes", slug: "place-47", title: "Match 2", description: "", curated_taxonomy_json: JSON.stringify({ parking: false, price_level: "standard", service_scope: ["airport", "city"] }) },
        { id: 46, entity_type: "place", category: "cafes", slug: "place-46", title: "Nope 3", description: "", curated_taxonomy_json: JSON.stringify({ parking: false, price_level: "premium" }) },
      ]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  try {
    const items = await searchHomepageCurationCandidates({
      entityType: "place",
      lang: "th",
      q: "",
      limit: 2,
      taxonomyFilters: {
        parking: false,
        price_level: "standard",
        service_scope: ["city", "airport"],
      },
    });

    assert.equal(items.length, 2);
    assert.equal(items[0].id, 48);
    assert.equal(items[1].id, 47);
    assert.deepEqual(items[0].curated_taxonomy_json, {
      parking: false,
      price_level: "standard",
      service_scope: ["city", "airport"],
    });
    assert.match(normalizeSql(calls[0].sql), /from places p/);
    assert.doesNotMatch(normalizeSql(calls[0].sql), /limit \?/);
  } finally {
    restore();
  }
});

test("boolean false, numeric 0, scalar membership, AND behavior, malformed taxonomy, and null legacy taxonomy work in place search", async () => {
  const restore = withPoolQueryMock(async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (normalized.startsWith("select") && normalized.includes("from places p")) {
      return [[
        { id: 60, entity_type: "place", category: "cafes", slug: "place-60", title: "Boolean false", description: "", curated_taxonomy_json: JSON.stringify({ parking: false, typical_duration: 0, service_scope: ["city", "airport"] }) },
        { id: 59, entity_type: "place", category: "cafes", slug: "place-59", title: "Null legacy", description: "", curated_taxonomy_json: null },
        { id: 58, entity_type: "place", category: "cafes", slug: "place-58", title: "Malformed", description: "", curated_taxonomy_json: "{not-json" },
      ]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  try {
    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false },
    })).length, 1);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { typical_duration: 0 },
    })).length, 1);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { service_scope: "airport" },
    })).length, 1);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { service_scope: ["city", "airport"] },
    })).length, 1);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false, service_scope: "airport" },
    })).length, 1);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false, service_scope: "rail" },
    })).length, 0);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false, price_level: "standard" },
    })).length, 0);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false, unknown_key: "x" },
    })).length, 1);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false, category: "cafes", subtype: "coffee_shop", tags: ["coffee"], "custom.flag": true },
    })).length, 1);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false },
    }))[0].curated_taxonomy_json.parking, false);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false },
    }))[0].curated_taxonomy_json.typical_duration, 0);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false },
    }))[0].curated_taxonomy_json.service_scope.includes("airport"), true);

    assert.equal((await searchHomepageCurationCandidates({
      entityType: "place",
      taxonomyFilters: { parking: false },
    }))[0].curated_taxonomy_json.service_scope.includes("city"), true);
  } finally {
    restore();
  }
});

test("event candidate search remains unchanged and ignores taxonomy filters", async () => {
  const restore = withPoolQueryMock(async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (normalized.startsWith("select") && normalized.includes("from events e")) {
      return [[
        {
          id: 91,
          entity_type: "event",
          category: null,
          slug: null,
          title: "Event 91",
          description: "Event description",
          approved_at: "2026-06-23 10:00:00",
          updated_at: "2026-06-23 09:00:00",
        },
      ]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  try {
    const items = await searchHomepageCurationCandidates({
      entityType: "event",
      q: "event",
      limit: 3,
      taxonomyFilters: { parking: false },
    });

    assert.deepEqual(items, [
      {
        id: 91,
        entity_type: "event",
        category: null,
        slug: null,
        title: "Event 91",
        description: "Event description",
        approved_at: "2026-06-23 10:00:00",
        updated_at: "2026-06-23 09:00:00",
      },
    ]);
  } finally {
    restore();
  }
});

test("public homepage resolution functions are not modified by taxonomy filtering work", async () => {
  const source = await fs.readFile(SERVICE_FILE, "utf8");
  const chunks = [
    "function getPublishedHomepageLayout",
    "function previewHomepageCurationLayout",
    "function resolveBlockItems",
    "function buildResolvedBlocks",
    "function filterPlacesByRule",
    "function filterEventsByRule",
  ];
  const boundaries = [...chunks, "export async function searchHomepageCurationCandidates"];

  for (const marker of chunks) {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `missing ${marker}`);
    const nextStarts = boundaries
      .map((candidate) => source.indexOf(candidate, start + 1))
      .filter((position) => position > start);
    const end = nextStarts.length ? Math.min(...nextStarts) : source.length;
    const body = source.slice(start, end);
    assert.doesNotMatch(body, /curated_taxonomy_json/);
    assert.doesNotMatch(body, /taxonomyFilters/);
  }
});
