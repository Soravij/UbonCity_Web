import assert from "node:assert/strict";
import test from "node:test";

import pool from "../config/db.js";
import { ingestReviewContent } from "../services/reviewIngestService.js";
import { getReviewContentById } from "../services/reviewContentService.js";

function normalizeSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function createConnectionHarness() {
  const state = {
    reviewContents: [],
    reviewActions: [],
    insertParams: null,
    updateParams: null,
    nextInsertId: 501,
    existingRows: [],
  };

  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      if (normalized.startsWith("insert into review_contents")) {
        state.insertParams = Array.isArray(params) ? params.slice() : [];
        state.reviewContents.push({ params: state.insertParams });
        return [{ insertId: state.nextInsertId++ }];
      }
      if (normalized.startsWith("update review_contents")) {
        state.updateParams = Array.isArray(params) ? params.slice() : [];
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("insert into review_actions")) {
        state.reviewActions.push(Array.isArray(params) ? params.slice() : []);
        return [{ insertId: state.reviewActions.length }];
      }
      throw new Error(`Unexpected connection SQL: ${sql}`);
    },
  };

  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  pool.query = async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (normalized.includes("from review_contents where source_system")) {
      return [state.existingRows];
    }
    if (normalized === "select * from review_contents where id=? limit 1") {
      return [[
        {
          id: 501,
          source_system: "collector-app",
          source_content_item_id: 42,
          content_type: "place",
          status: "pending_review",
          lang: "th",
          category: "attractions",
          title: "Snapshot Place",
          body: "<p>Body</p>",
          excerpt: "Excerpt",
          meta_title: "Meta",
          meta_description: "Meta desc",
          event_period_text: null,
          location_text: null,
          latitude: null,
          longitude: null,
          map_url: null,
          google_place_id: null,
          transport_subtype: null,
          transport_contact_name: null,
          transport_contact_phone: null,
          phone: null,
          line_url: null,
          facebook_url: null,
          website_url: null,
          primary_cta: null,
          tracking_entity_type: null,
          tracking_entity_id: null,
          transport_contact_details: null,
          transport_link_url: null,
          slug: null,
          slug_locked: 0,
          public_entity_type: null,
          public_entity_id: null,
          current_batch_uid: "batch-1",
          review_payload_json: JSON.stringify({ snapshot_meta: { translation_langs: ["en"] } }),
          handoff_snapshot_json: null,
          published_at: null,
          created_at: "2026-06-23 00:00:00",
          updated_at: "2026-06-23 00:00:00",
        },
      ]];
    }
    if (normalized.startsWith("select usage_type, position, backend_url")) return [[]];
    if (normalized.startsWith("select id, batch_uid, action_type")) return [[]];
    throw new Error(`Unexpected pool SQL: ${sql} :: ${JSON.stringify(params)}`);
  };
  pool.getConnection = async () => connection;

  return {
    state,
    connection,
    restore() {
      pool.query = originalQuery;
      pool.getConnection = originalGetConnection;
    },
  };
}

test("trusted field review ingest stores a frozen handoff snapshot and browser payloads do not override it", async () => {
  const harness = createConnectionHarness();
  try {
    const payload = {
      source_system: "collector-app",
      source_content_item_id: 42,
      source_base_url: "https://collector.example",
      content: {
        content_type: "place",
        lang: "th",
        category: "attractions",
        title: "Snapshot Place",
        body: "<p>Body</p>",
        excerpt: "Excerpt",
        meta_title: "Meta",
        meta_description: "Meta desc",
      },
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 34,
        accepted_submission_id: 56,
        accepted_at: "2026-06-23T00:00:00.000Z",
        revision_round: 2,
      },
    };

    await ingestReviewContent(payload, { trustedSnapshotSource: true });
    assert.deepEqual(JSON.parse(harness.state.insertParams.at(-1)), payload.handoff_snapshot_json);

    await ingestReviewContent({
      ...payload,
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 999,
      },
    }, { trustedSnapshotSource: false });
    assert.equal(harness.state.insertParams.at(-1), null);
  } finally {
    harness.restore();
  }
});

test("legacy review content rows with null handoff snapshot remain readable", async () => {
  const originalQuery = pool.query;
  try {
    pool.query = async (sql, params = []) => {
      const normalized = normalizeSql(sql);
      if (normalized === "select * from review_contents where id=? limit 1") {
        return [[
          {
            id: 501,
            source_system: "collector-app",
            source_content_item_id: 42,
            content_type: "place",
            status: "pending_review",
            lang: "th",
            category: "attractions",
            title: "Snapshot Place",
            body: "<p>Body</p>",
            excerpt: "Excerpt",
            meta_title: "Meta",
            meta_description: "Meta desc",
            event_period_text: null,
            location_text: null,
            latitude: null,
            longitude: null,
            map_url: null,
            google_place_id: null,
            transport_subtype: null,
            transport_contact_name: null,
            transport_contact_phone: null,
            phone: null,
            line_url: null,
            facebook_url: null,
            website_url: null,
            primary_cta: null,
            tracking_entity_type: null,
            tracking_entity_id: null,
            transport_contact_details: null,
            transport_link_url: null,
            slug: null,
            slug_locked: 0,
            public_entity_type: null,
            public_entity_id: null,
            current_batch_uid: "batch-1",
            review_payload_json: JSON.stringify({ snapshot_meta: { translation_langs: ["en"] } }),
            handoff_snapshot_json: null,
            published_at: null,
            created_at: "2026-06-23 00:00:00",
            updated_at: "2026-06-23 00:00:00",
          },
        ]];
      }
      if (normalized.startsWith("select usage_type, position, backend_url")) return [[]];
      if (normalized.startsWith("select id, batch_uid, action_type")) return [[]];
      throw new Error(`Unexpected pool SQL: ${sql} :: ${JSON.stringify(params)}`);
    };
    const item = await getReviewContentById(501);
    assert.equal(item.handoff_snapshot_json, null);
  } finally {
    pool.query = originalQuery;
  }
});
