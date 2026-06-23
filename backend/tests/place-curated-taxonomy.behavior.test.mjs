import assert from "node:assert/strict";
import test from "node:test";

import pool from "../config/db.js";
import {
  approveReviewContent,
  extractCuratedTaxonomyFromReviewSnapshot,
} from "../services/reviewDecisionService.js";

function normalizeSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createApproveHarness({
  reviewContent = null,
  existingPlaceRow = null,
  existingEventRow = null,
  failOn = null,
} = {}) {
  const committed = {
    reviewContent: reviewContent ? cloneJson(reviewContent) : null,
    placeRow: existingPlaceRow ? cloneJson(existingPlaceRow) : null,
    eventRow: existingEventRow ? cloneJson(existingEventRow) : null,
    placeUpdates: [],
    eventUpdates: [],
    reviewActions: [],
    reviewContentUpdates: [],
    collectorImportReviews: [{ id: 901, review_status: "pending" }],
  };
  const tx = {
    reviewContent: null,
    placeRow: null,
    eventRow: null,
    placeUpdates: [],
    eventUpdates: [],
    reviewActions: [],
    reviewContentUpdates: [],
    active: false,
  };

  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;

  function currentReviewContent() {
    return tx.reviewContent || committed.reviewContent;
  }

  function currentPlaceRow() {
    return tx.placeRow || committed.placeRow;
  }

  function currentEventRow() {
    return tx.eventRow || committed.eventRow;
  }

  function normalizedTaxonomy(value) {
    if (value == null) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return cloneJson(value);
  }

  pool.query = async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (normalized.startsWith("show columns from places like")) {
      return [[{ Field: "curated_taxonomy_json" }]];
    }
    if (normalized.includes("from review_contents where id=? limit 1")) {
      return [[currentReviewContent() ? { ...currentReviewContent() } : null].filter(Boolean)];
    }
    if (normalized === "show columns from review_contents like 'status'") {
      return [[{ Type: "enum('draft','pending_review','needs_revision','rejected','published')" }]];
    }
    if (normalized === "show columns from review_actions like 'action_type'") {
      return [[{ Type: "enum('ingested','approved','needs_revision','rejected','reingested')" }]];
    }
    if (normalized.startsWith("create table if not exists collector_import_reviews")) {
      return [{ affectedRows: 0 }];
    }
    if (normalized.startsWith("create table if not exists collector_import_review_actions")) {
      return [{ affectedRows: 0 }];
    }
    if (normalized.startsWith("show columns from collector_import_reviews like")) {
      return [[{ Field: "ok" }]];
    }
    if (normalized.startsWith("alter table collector_import_reviews add column")) {
      return [{ affectedRows: 0 }];
    }
    if (normalized.startsWith("select id from categories where slug=? limit 1")) {
      return [[{ id: 7 }]];
    }
    if (normalized.startsWith("select p.id, c.slug as category, p.slug, p.is_emer, coalesce(pt_th.title, '') as th_title")) {
      return [[]];
    }
    if (normalized.startsWith("select e.id, e.is_emer, coalesce(et_th.title, e.title, '') as th_title")) {
      return [[]];
    }
    if (normalized.startsWith("select id, slug, curated_taxonomy_json from places where id=? limit 1")) {
      const row = currentPlaceRow();
      return row ? [[{ ...row }]] : [[]];
    }
    if (normalized.startsWith("select id from events where id=? limit 1")) {
      const row = currentEventRow();
      if (row && Number(row.id || 0) === Number(params[0] || 0)) return [[{ id: row.id }]];
      return [[]];
    }
    if (normalized.startsWith("select id from places where slug=? limit 1")) {
      const row = currentPlaceRow();
      if (row && String(row.slug || "").trim() === String(params[0] || "").trim()) {
        return [[{ id: row.id }]];
      }
      return [[]];
    }
    if (normalized.startsWith("select id from places where id=? limit 1")) {
      const row = currentPlaceRow();
      if (row && Number(row.id || 0) === Number(params[0] || 0)) return [[{ id: row.id }]];
      return [[]];
    }
    if (normalized.startsWith("insert into places")) {
      tx.placeRow = {
        id: committed.placeRow?.id || 101,
        category_id: params[0],
        slug: params[1],
        image: params[2],
        is_approved: 1,
        latitude: params[3],
        longitude: params[4],
        map_url: params[5],
        google_place_id: params[6],
        transport_subtype: params[7],
        transport_contact_name: params[8],
        transport_contact_phone: params[9],
        phone: params[10],
        line_url: params[11],
        facebook_url: params[12],
        website_url: params[13],
        primary_cta: params[14],
        tracking_entity_type: params[15],
        tracking_entity_id: params[16],
        transport_contact_details: params[17],
        transport_link_url: params[18],
        curated_taxonomy_json: normalizedTaxonomy(params[19]),
      };
      if (failOn === "place_insert") throw new Error("injected failure after place insert");
      return [{ insertId: tx.placeRow.id }];
    }
    if (normalized.startsWith("insert into events")) {
      tx.eventRow = {
        id: committed.eventRow?.id || 202,
        title: params[0],
        description: params[1],
        image: params[2],
        event_period_text: params[3],
        location_text: params[4],
        map_url: params[5],
        is_approved: 1,
        approved_at: "2026-06-23T00:00:00.000Z",
      };
      if (failOn === "event_insert") throw new Error("injected failure after event insert");
      return [{ insertId: tx.eventRow.id }];
    }
    if (normalized.startsWith("update places set category_id=?, slug=?, is_approved=1")) {
      tx.placeRow = {
        ...(currentPlaceRow() || { id: 101 }),
        category_id: params[0],
        slug: params[1],
        image: currentPlaceRow()?.image ?? null,
        is_approved: 1,
        latitude: params[2],
        longitude: params[3],
        map_url: params[4],
        google_place_id: params[5],
        transport_subtype: params[6],
        transport_contact_name: params[7],
        transport_contact_phone: params[8],
        phone: params[9],
        line_url: params[10],
        facebook_url: params[11],
        website_url: params[12],
        primary_cta: params[13],
        tracking_entity_type: params[14],
        tracking_entity_id: params[15],
        transport_contact_details: params[16],
        transport_link_url: params[17],
        curated_taxonomy_json: normalizedTaxonomy(params[18]),
      };
      if (failOn === "place_update") throw new Error("injected failure after place update");
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("insert into place_translations")) {
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("update place_translations set description=? where place_id=? and lang=?")) {
      return [{ affectedRows: 1 }];
    }
    if (normalized.includes("from review_content_assets")) return [[]];
    if (normalized.includes("from content_image_usages ciu join media_assets ma")) return [[]];
    if (normalized.includes("from content_image_usages where asset_id in")) return [[]];
    if (normalized.startsWith("delete from content_image_usages")) return [{ affectedRows: 0 }];
    if (normalized.startsWith("insert into media_assets")) return [{ insertId: 900 }];
    if (normalized.startsWith("insert into content_image_usages")) return [{ insertId: 1 }];
    if (normalized.startsWith("delete from media_assets")) return [{ affectedRows: 0 }];
    if (normalized.startsWith("update places set image=?, decision_cover_image=?, decision_thumbnail_image=? where id=?")) return [{ affectedRows: 1 }];
    if (normalized.startsWith("update events set title=?, description=?, event_period_text=?, location_text=?, map_url=?, is_approved=1, approved_at=current_timestamp where id=?")) {
      tx.eventRow = {
        ...(currentEventRow() || { id: 202 }),
        title: params[0],
        description: params[1],
        event_period_text: params[2],
        location_text: params[3],
        map_url: params[4],
        is_approved: 1,
      };
      tx.eventUpdates.push({
        id: tx.eventRow.id,
        title: params[0],
        event_period_text: params[2],
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("insert into event_translations")) return [{ affectedRows: 1 }];
    if (normalized.startsWith("update events set image=?, decision_cover_image=?, decision_thumbnail_image=? where id=?")) return [{ affectedRows: 1 }];
    if (normalized.startsWith("update events set description=? where id=?")) return [{ affectedRows: 1 }];
    if (normalized.startsWith("select lang, description from place_translations where place_id=?")) return [[[]]];
    if (normalized.startsWith("select lang, description from event_translations where event_id=?")) return [[[]]];
    if (normalized.startsWith("select id, review_status from collector_import_reviews")) return [committed.collectorImportReviews];
    if (normalized.startsWith("update collector_import_reviews")) return [{ affectedRows: 1 }];
    if (normalized.startsWith("insert into collector_import_review_actions")) return [{ insertId: 1 }];
    if (normalized.startsWith("insert into review_actions")) {
      tx.reviewActions.push({
        review_content_id: params[0],
        action_type: params[2],
      });
      if (failOn === "review_actions_insert") throw new Error("injected failure after review action insert");
      return [{ insertId: tx.reviewActions.length }];
    }
    if (normalized.startsWith("update review_contents set status='published'")) {
      tx.reviewContent = {
        ...(currentReviewContent() || {}),
        status: "published",
        slug: params[0],
        slug_locked: params[1],
        public_entity_type: params[2],
        public_entity_id: params[3],
      };
      tx.reviewContentUpdates.push(tx.reviewContent);
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("update review_content_assets set status='published'")) {
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL: ${sql} :: ${JSON.stringify(params)}`);
  };

  const connection = {
    async beginTransaction() {
      tx.active = true;
    },
    async commit() {
      if (tx.reviewContent) committed.reviewContent = cloneJson(tx.reviewContent);
      if (tx.placeRow) committed.placeRow = cloneJson(tx.placeRow);
      if (tx.eventRow) committed.eventRow = cloneJson(tx.eventRow);
      committed.placeUpdates.push(...tx.placeUpdates);
      committed.eventUpdates.push(...tx.eventUpdates);
      committed.reviewActions.push(...tx.reviewActions);
      committed.reviewContentUpdates.push(...tx.reviewContentUpdates);
      tx.active = false;
      tx.reviewContent = null;
      tx.placeRow = null;
      tx.eventRow = null;
      tx.placeUpdates = [];
      tx.eventUpdates = [];
      tx.reviewActions = [];
      tx.reviewContentUpdates = [];
    },
    async rollback() {
      tx.active = false;
      tx.reviewContent = null;
      tx.placeRow = null;
      tx.eventRow = null;
      tx.placeUpdates = [];
      tx.eventUpdates = [];
      tx.reviewActions = [];
      tx.reviewContentUpdates = [];
    },
    release() {},
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
  };

  const originalGetConnectionImpl = pool.getConnection;
  pool.getConnection = async () => connection;

  return {
    committed,
    tx,
    restore() {
      pool.query = originalQuery;
      pool.getConnection = originalGetConnection;
      if (originalGetConnectionImpl && originalGetConnectionImpl !== originalGetConnection) {
        pool.getConnection = originalGetConnectionImpl;
      }
    },
  };
}

test("extractCuratedTaxonomyFromReviewSnapshot filters unknown keys and preserves typed values", () => {
  const snapshot = {
    confirmed_taxonomy_json: {
      category: false,
      price_level: 0,
      subtype: "cafe",
      tags: ["coffee", "dessert"],
      "custom.legacy_flag": true,
      unknown_key: "drop-me",
    },
  };
  const cloned = cloneJson(snapshot);

  const curated = extractCuratedTaxonomyFromReviewSnapshot(snapshot);

  assert.deepEqual(curated, {
    category: false,
    price_level: 0,
    subtype: "cafe",
    tags: ["coffee", "dessert"],
  });
  assert.deepEqual(snapshot, cloned);
});

test("approveReviewContent stores frozen place taxonomy and preserves legacy taxonomy when snapshot is missing", async () => {
  const harness = createApproveHarness({
    reviewContent: {
      id: 501,
      status: "pending_review",
      content_type: "place",
      category: "cafes",
      title: "Place Taxonomy",
      body: "<p>Body</p>",
      excerpt: "Excerpt",
      meta_title: "Meta",
      meta_description: "Meta description",
      lang: "th",
      current_batch_uid: "batch-1",
      source_system: "collector-app",
      source_content_item_id: 99,
      public_entity_id: null,
      slug: "place-taxonomy",
      handoff_snapshot_json: {
        version: 1,
        confirmed_taxonomy_json: {
          category: false,
          price_level: 0,
          subtype: "cafe",
          tags: ["coffee"],
          "custom.legacy_flag": true,
          unknown_key: "drop-me",
        },
      },
    },
  });
  try {
    const result = await approveReviewContent({
      reviewContent: { id: 501 },
      actorUserId: 7,
      reviewNote: "approve place taxonomy",
    });

    assert.equal(result.status, "published");
    assert.deepEqual(harness.committed.placeRow.curated_taxonomy_json, {
      category: false,
      price_level: 0,
      subtype: "cafe",
      tags: ["coffee"],
    });
  } finally {
    harness.restore();
  }
});

test("approveReviewContent preserves existing place taxonomy when snapshot is missing or malformed", async () => {
  const harness = createApproveHarness({
    reviewContent: {
      id: 502,
      status: "pending_review",
      content_type: "place",
      category: "cafes",
      title: "Place Taxonomy Existing",
      body: "<p>Body</p>",
      excerpt: "Excerpt",
      meta_title: "Meta",
      meta_description: "Meta description",
      lang: "th",
      current_batch_uid: "batch-2",
      source_system: "collector-app",
      source_content_item_id: 100,
      public_entity_id: 77,
      slug: "place-taxonomy-existing",
      handoff_snapshot_json: null,
    },
    existingPlaceRow: {
      id: 77,
      slug: "place-taxonomy-existing",
      curated_taxonomy_json: {
        parking: true,
        price_level: "moderate",
      },
    },
  });
  try {
    const result = await approveReviewContent({
      reviewContent: { id: 502 },
      actorUserId: 7,
      reviewNote: "approve place without snapshot",
    });

    assert.equal(result.status, "published");
    assert.deepEqual(harness.committed.placeRow.curated_taxonomy_json, {
      parking: true,
      price_level: "moderate",
    });
  } finally {
    harness.restore();
  }
});

test("approveReviewContent preserves existing place taxonomy when the frozen snapshot is malformed", async () => {
  const harness = createApproveHarness({
    reviewContent: {
      id: 505,
      status: "pending_review",
      content_type: "place",
      category: "cafes",
      title: "Malformed Snapshot",
      body: "<p>Body</p>",
      excerpt: "Excerpt",
      meta_title: "Meta",
      meta_description: "Meta description",
      lang: "th",
      current_batch_uid: "batch-5",
      source_system: "collector-app",
      source_content_item_id: 103,
      public_entity_id: 78,
      slug: "malformed-snapshot",
      handoff_snapshot_json: "{not-json",
    },
    existingPlaceRow: {
      id: 78,
      slug: "malformed-snapshot",
      curated_taxonomy_json: {
        parking: false,
        price_level: "standard",
      },
    },
  });
  try {
    const result = await approveReviewContent({
      reviewContent: { id: 505 },
      actorUserId: 7,
      reviewNote: "approve malformed snapshot",
    });

    assert.equal(result.status, "published");
    assert.deepEqual(harness.committed.placeRow.curated_taxonomy_json, {
      parking: false,
      price_level: "standard",
    });
  } finally {
    harness.restore();
  }
});

test("approveReviewContent leaves event approval flow unchanged", async () => {
  const harness = createApproveHarness({
    reviewContent: {
      id: 503,
      status: "pending_review",
      content_type: "event",
      category: "events",
      title: "Event Approval",
      body: "<p>Body</p>",
      excerpt: "Excerpt",
      meta_title: "Meta",
      meta_description: "Meta description",
      lang: "th",
      current_batch_uid: "batch-3",
      source_system: "collector-app",
      source_content_item_id: 101,
      public_entity_id: null,
      slug: "event-approval",
      handoff_snapshot_json: null,
      event_period_text: "2026-07-01 to 2026-07-02",
      location_text: "Bangkok",
      map_url: "https://maps.example/event",
    },
  });
  try {
    const result = await approveReviewContent({
      reviewContent: { id: 503 },
      actorUserId: 7,
      reviewNote: "approve event",
    });

    assert.equal(result.status, "published");
    assert.equal(harness.committed.eventRow?.title, "Event Approval");
    assert.equal(Object.hasOwn(harness.committed.eventRow || {}, "curated_taxonomy_json"), false);
  } finally {
    harness.restore();
  }
});

test("approveReviewContent rolls back curated taxonomy changes on failure", async () => {
  const harness = createApproveHarness({
    reviewContent: {
      id: 504,
      status: "pending_review",
      content_type: "place",
      category: "cafes",
      title: "Rollback Place",
      body: "<p>Body</p>",
      excerpt: "Excerpt",
      meta_title: "Meta",
      meta_description: "Meta description",
      lang: "th",
      current_batch_uid: "batch-4",
      source_system: "collector-app",
      source_content_item_id: 102,
      public_entity_id: 77,
      slug: "rollback-place",
      handoff_snapshot_json: {
        version: 1,
        confirmed_taxonomy_json: {
          parking: false,
          price_level: "premium",
        },
      },
    },
    existingPlaceRow: {
      id: 77,
      slug: "rollback-place",
      curated_taxonomy_json: {
        parking: true,
        price_level: "budget",
      },
    },
    failOn: "place_update",
  });
  try {
    await assert.rejects(
      approveReviewContent({
        reviewContent: { id: 504 },
        actorUserId: 7,
        reviewNote: "rollback place",
      })
    );
    assert.deepEqual(harness.committed.placeRow.curated_taxonomy_json, {
      parking: true,
      price_level: "budget",
    });
  } finally {
    harness.restore();
  }
});
