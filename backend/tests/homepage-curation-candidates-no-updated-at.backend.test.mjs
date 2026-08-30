import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import { searchHomepageCurationCandidates } from "../services/homepageCurationService.js";

test("place candidate SQL must not reference updated_at (column absent from places table)", async () => {
  const originalQuery = pool.query;
  const capturedSql = [];
  pool.query = async (sql, params = []) => {
    capturedSql.push(String(sql));
    return [[]];
  };
  try {
    await searchHomepageCurationCandidates({ entityType: "place", lang: "th" });
    assert.ok(capturedSql.length > 0, "expected at least one SQL call");
    for (const sql of capturedSql) {
      assert.equal(
        /\bp\.updated_at\b/.test(sql),
        false,
        `candidate SQL must not reference p.updated_at — places table has no such column.\nSQL: ${sql}`
      );
    }
  } finally {
    pool.query = originalQuery;
  }
});
