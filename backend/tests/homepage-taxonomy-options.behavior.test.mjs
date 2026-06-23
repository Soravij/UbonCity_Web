import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import pool from "../config/db.js";
import { getHomepageCurationTaxonomyOptionsHandler } from "../controllers/homepageCurationController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

test("taxonomy options handler returns catalog keys in alphabetical order without querying the database", async () => {
  let queryCount = 0;
  const originalQuery = pool.query;
  pool.query = async () => {
    queryCount += 1;
    throw new Error("database query is not expected");
  };

  const res = createRes();
  try {
    await getHomepageCurationTaxonomyOptionsHandler({ query: {} }, res);
  } finally {
    pool.query = originalQuery;
  }

  assert.equal(queryCount, 0);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body?.items));
  const keys = res.body.items.map((item) => item.key);
  const sortedKeys = [...keys].sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepEqual(keys, sortedKeys);
  assert.ok(keys.length > 0);
  assert.ok(keys.every((key) => !String(key).startsWith("custom.")));
  assert.equal(keys.includes("category"), false);
  assert.equal(keys.includes("subtype"), false);
  assert.equal(keys.includes("tags"), false);
});

test("taxonomy options route keeps existing admin middleware and candidate route intact", async () => {
  const source = await fs.readFile(ROUTE_FILE, "utf8");
  assert.match(source, /router\.get\("\/homepage-curation\/taxonomy-options", protect, authorizeAdmin, getHomepageCurationTaxonomyOptionsHandler\)/);
  assert.match(source, /router\.get\("\/homepage-curation\/candidates", protect, authorizeAdmin, searchHomepageCurationCandidatesHandler\)/);
});
