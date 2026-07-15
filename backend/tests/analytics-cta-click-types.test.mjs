import test from "node:test";
import assert from "node:assert/strict";

import pool from "../config/db.js";
import { createAnalyticsEvent, getCtaSummary, getTopEntities, getRecentAnalyticsEvents } from "../controllers/analyticsController.js";

const originalPoolQuery = pool.query;

function createResHarness() {
  const res = {
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
  return res;
}

test.afterEach(() => {
  pool.query = originalPoolQuery;
});

test("createAnalyticsEvent accepts FACEBOOK_CLICK", async () => {
  let insertedEventType = null;
  pool.query = async (sql, params) => {
    insertedEventType = params[0];
    return [{ insertId: 1 }];
  };

  const req = { body: { event_type: "FACEBOOK_CLICK", source_path: "/th/cafes/example", entity_type: "place", entity_id: 47 } };
  const res = createResHarness();
  await createAnalyticsEvent(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(insertedEventType, "FACEBOOK_CLICK");
});

test("createAnalyticsEvent accepts WEBSITE_CLICK", async () => {
  let insertedEventType = null;
  pool.query = async (sql, params) => {
    insertedEventType = params[0];
    return [{ insertId: 1 }];
  };

  const req = { body: { event_type: "WEBSITE_CLICK", source_path: "/th/cafes/example", entity_type: "place", entity_id: 47 } };
  const res = createResHarness();
  await createAnalyticsEvent(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(insertedEventType, "WEBSITE_CLICK");
});

test("getCtaSummary queries and returns FACEBOOK_CLICK/WEBSITE_CLICK alongside the original three types", async () => {
  let capturedSql = "";
  pool.query = async (sql) => {
    capturedSql = sql;
    return [[{
      total_clicks: 10,
      map_clicks: 2,
      phone_clicks: 3,
      line_clicks: 1,
      facebook_clicks: 3,
      website_clicks: 1,
      last_7_days: 5,
      last_30_days: 10,
    }]];
  };

  const req = { query: {} };
  const res = createResHarness();
  await getCtaSummary(req, res);

  assert.match(capturedSql, /'MAP_CLICK','PHONE_CLICK','LINE_CLICK','FACEBOOK_CLICK','WEBSITE_CLICK'/);
  assert.deepEqual(res.body.by_type, {
    MAP_CLICK: 2,
    PHONE_CLICK: 3,
    LINE_CLICK: 1,
    FACEBOOK_CLICK: 3,
    WEBSITE_CLICK: 1,
  });
  assert.equal(res.body.total_clicks, 10);
});

test("getTopEntities queries and returns facebook_clicks/website_clicks per entity", async () => {
  let capturedSql = "";
  pool.query = async (sql) => {
    capturedSql = sql;
    return [[{
      entity_type: "place",
      entity_id: 47,
      title: "123 Histoire de Caf",
      category: "cafes",
      slug: "123-histoire-de-caf",
      total_clicks: 6,
      map_clicks: 1,
      phone_clicks: 1,
      line_clicks: 1,
      facebook_clicks: 2,
      website_clicks: 1,
      latest_click_at: "2026-07-15 10:00:00",
    }]];
  };

  const req = { query: {} };
  const res = createResHarness();
  await getTopEntities(req, res);

  assert.match(capturedSql, /'MAP_CLICK','PHONE_CLICK','LINE_CLICK','FACEBOOK_CLICK','WEBSITE_CLICK'/);
  assert.equal(res.body.items[0].facebook_clicks, 2);
  assert.equal(res.body.items[0].website_clicks, 1);
});

test("getRecentAnalyticsEvents includes FACEBOOK_CLICK/WEBSITE_CLICK in its filter", async () => {
  let capturedSql = "";
  pool.query = async (sql) => {
    capturedSql = sql;
    return [[]];
  };

  const req = { query: {} };
  const res = createResHarness();
  await getRecentAnalyticsEvents(req, res);

  assert.match(capturedSql, /'MAP_CLICK','PHONE_CLICK','LINE_CLICK','FACEBOOK_CLICK','WEBSITE_CLICK'/);
});
