import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import pool from "../config/db.js";
import { approveReviewContent } from "../services/reviewDecisionService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_UPLOADS_DIR = path.resolve(__dirname, "..", "uploads");

async function writeUploadFixture(relativePath, content = "fixture") {
  const diskPath = path.join(BACKEND_UPLOADS_DIR, relativePath.replace(/^uploads[\\/]/, ""));
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, content);
  return diskPath;
}

async function removeUploadFixture(relativePath) {
  const diskPath = path.join(BACKEND_UPLOADS_DIR, relativePath.replace(/^uploads[\\/]/, ""));
  await fs.rm(diskPath, { force: true });
}

function normalizeSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function createApproveHarness() {
  const state = {
    reviewContent: {
      id: 501,
      status: "pending_review",
      slug: "place-99-source",
      content_type: "place",
      category: "cafes",
      title: "Place 99",
      body: '<p>Body <img src="https://api-test.uboncity.com/uploads/review-item-32-asset-cover.jpg"></p>',
      excerpt: "Excerpt",
      meta_title: "Meta title",
      meta_description: "Meta description",
      lang: "th",
      current_batch_uid: "batch-99",
      source_system: "collector-app",
      source_content_item_id: 99,
      public_entity_id: null,
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
    },
    categoryRows: [{ id: 88 }],
    placeRowsBySlug: [],
    placeInsertId: 99,
    placeTranslationRows: [
      { lang: "th", description: '<p>TH <img src="https://api-test.uboncity.com/uploads/review-item-32-asset-cover.jpg"></p>' },
      { lang: "en", description: '<p>EN <img src="/uploads/review-item-32-asset-cover.jpg"></p>' },
    ],
    reviewAssets: [
      {
        id: 1,
        usage_type: "cover",
        position: 0,
        source_url: "https://example.com/source-cover.jpg",
        resolved_source_url: "https://api-test.uboncity.com/uploads/review-item-32-asset-cover.jpg",
        storage_path: "uploads/review-item-32-asset-cover.jpg",
        file_name: "review-item-32-asset-cover.jpg",
        mime_type: "image/jpeg",
        size_bytes: 321,
        checksum: "cover-checksum",
      },
    ],
    contentImageUsages: [],
    mediaAssets: [],
    places: [],
    reviewActions: [],
    collectorActions: [],
    collectorImportReviews: [
      { id: 901, review_status: "pending" },
    ],
    reviewContentAssetStatusUpdates: [],
    reviewContentUpdates: [],
    transaction: [],
  };

  let nextMediaAssetId = 700;

  const connection = {
    async beginTransaction() {
      state.transaction.push("begin");
    },
    async commit() {
      state.transaction.push("commit");
    },
    async rollback() {
      state.transaction.push("rollback");
    },
    release() {
      state.transaction.push("release");
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);

      if (normalized === "select * from review_contents where id=? limit 1 for update") {
        return [[{ ...state.reviewContent }]];
      }
      if (normalized === "select id from categories where slug=? limit 1") {
        return [state.categoryRows];
      }
      if (normalized.startsWith("select p.id, c.slug as category, p.slug, p.is_emer")) {
        return [[]];
      }
      if (normalized.startsWith("select e.id, e.title, e.is_emer")) {
        return [[]];
      }
      if (normalized === "select id from places where slug=? limit 1") {
        return [state.placeRowsBySlug];
      }
      if (normalized === "select id, slug from places where id=? limit 1") {
        return [[]];
      }
      if (normalized === "select id, slug, curated_taxonomy_json from places where id=? limit 1") {
        return [[]];
      }
      if (normalized.startsWith("insert into places (")) {
        return [{ insertId: state.placeInsertId }];
      }
      if (normalized.startsWith("insert into place_translations")) {
        state.placeTranslationUpsert = {
          place_id: params[0],
          lang: params[1],
          title: params[2],
          description: params[3],
          meta_title: params[4],
          meta_description: params[5],
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized === "select lang, description from place_translations where place_id=?") {
        return [state.placeTranslationRows.map((row) => ({ ...row }))];
      }
      if (normalized.startsWith("update place_translations set description=? where place_id=? and lang=?")) {
        state.placeTranslationRewrites = state.placeTranslationRewrites || [];
        state.placeTranslationRewrites.push({
          description: params[0],
          place_id: params[1],
          lang: params[2],
        });
        state.placeTranslationRows = state.placeTranslationRows.map((row) =>
          row.lang === params[2] ? { ...row, description: params[0] } : row
        );
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes("from review_content_assets")) {
        return [state.reviewAssets];
      }
      if (normalized.includes("from content_image_usages ciu join media_assets ma")) {
        return [[]];
      }
      if (normalized.startsWith("delete from content_image_usages")) {
        state.contentImageUsages = [];
        return [{ affectedRows: 0 }];
      }
      if (normalized.startsWith("insert into media_assets")) {
        const inserted = {
          id: nextMediaAssetId++,
          source_url: params[1],
          checksum: params[2],
          status: params[3],
          related_type: params[4],
          related_id: params[5],
          mime_type: params[6],
          size_bytes: params[7],
          storage_disk: params[8],
          storage_path: params[9],
          file_name: params[10],
        };
        state.mediaAssets.push(inserted);
        return [{ insertId: inserted.id }];
      }
      if (normalized.startsWith("insert into content_image_usages")) {
        state.contentImageUsages.push({
          asset_id: params[0],
          entity_type: params[1],
          entity_id: params[2],
          usage_type: params[3],
          position: params[4],
          created_by: params[5],
        });
        return [{ insertId: state.contentImageUsages.length }];
      }
      if (normalized.includes("from content_image_usages where asset_id in")) {
        return [[]];
      }
      if (normalized.startsWith("delete from media_assets")) {
        return [{ affectedRows: 0 }];
      }
      if (normalized === "update places set image=?, decision_cover_image=?, decision_thumbnail_image=? where id=?") {
        state.places.push({
          id: params[3],
          image: params[0],
          decision_cover_image: params[1],
          decision_thumbnail_image: params[2],
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("update review_contents set status='published'")) {
        state.reviewContent.status = "published";
        state.reviewContent.slug = params[0];
        state.reviewContent.slug_locked = params[1];
        state.reviewContent.public_entity_type = params[2];
        state.reviewContent.public_entity_id = params[3];
        state.reviewContentUpdates.push({
          status: "published",
          slug: params[0],
          public_entity_type: params[2],
          public_entity_id: params[3],
        });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("update review_content_assets set status='published'")) {
        state.reviewContentAssetStatusUpdates.push({
          review_content_id: params[0],
          batch_uid: params[1],
        });
        return [{ affectedRows: state.reviewAssets.length }];
      }
      if (normalized.startsWith("insert into review_actions")) {
        state.reviewActions.push({
          review_content_id: params[0],
          batch_uid: params[1],
          action_type: params[2],
          previous_status: params[3],
          next_status: params[4],
        });
        return [{ insertId: state.reviewActions.length }];
      }
      if (normalized.startsWith("select id, review_status from collector_import_reviews")) {
        return [state.collectorImportReviews];
      }
      if (normalized.startsWith("update collector_import_reviews")) {
        state.collectorImportReviews[0] = {
          ...state.collectorImportReviews[0],
          review_status: params[0],
          reviewed_by_user_id: params[1],
          review_note: params[2],
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("insert into collector_import_review_actions")) {
        state.collectorActions.push({
          review_id: params[0],
          action_type: params[1],
          previous_status: params[2],
          next_status: params[3],
        });
        return [{ insertId: state.collectorActions.length }];
      }

      throw new Error(`Unexpected connection SQL: ${sql}`);
    },
  };

  const poolQuery = async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (normalized.startsWith("create table if not exists collector_import_reviews")) return [{ warningStatus: 0 }];
    if (normalized === "show columns from places like 'curated_taxonomy_json'") return [[{ Field: "curated_taxonomy_json" }]];
    if (normalized === "show columns from collector_import_reviews like 'article_snapshot_json'") return [[{ Field: "article_snapshot_json" }]];
    if (normalized === "show columns from collector_import_reviews like 'translations_snapshot_json'") return [[{ Field: "translations_snapshot_json" }]];
    if (normalized.startsWith("create table if not exists collector_import_review_actions")) return [{ warningStatus: 0 }];
    throw new Error(`Unexpected pool SQL: ${sql} :: ${JSON.stringify(params)}`);
  };

  return { state, connection, poolQuery };
}

function createEventApproveHarness() {
  const state = {
    reviewContent: {
      id: 601,
      status: "pending_review",
      slug: null,
      content_type: "event",
      category: "events",
      title: "Event 55",
      body: '<p>Body <img src="https://api-test.uboncity.com/uploads/review-item-55-asset-cover.jpg"></p>',
      excerpt: "Excerpt",
      meta_title: "Meta title",
      meta_description: "Meta description",
      lang: "th",
      current_batch_uid: "batch-55",
      source_system: "collector-app",
      source_content_item_id: 55,
      public_entity_id: 55,
      event_period_text: "Today",
      location_text: "Venue",
      map_url: null,
    },
    eventRowsById: [{ id: 55 }],
    reviewAssets: [
      {
        id: 9,
        usage_type: "cover",
        position: 0,
        source_url: "https://example.com/event-cover.jpg",
        resolved_source_url: "https://api-test.uboncity.com/uploads/review-item-55-asset-cover.jpg",
        storage_path: "uploads/review-item-55-asset-cover.jpg",
        file_name: "review-item-55-asset-cover.jpg",
        mime_type: "image/jpeg",
        size_bytes: 222,
        checksum: "event-cover",
      },
    ],
    eventDescriptionRow: {
      description: '<p>Stored event desc <img src="/uploads/review-item-55-asset-cover.jpg"></p>',
    },
    eventTranslationRows: [
      { lang: "th", description: '<p>TH <img src="/uploads/review-item-55-asset-cover.jpg"></p>' },
      { lang: "en", description: '<p>EN <img src="https://api-test.uboncity.com/uploads/review-item-55-asset-cover.jpg"></p>' },
    ],
    contentImageUsages: [],
    mediaAssets: [],
    events: [],
    eventDescriptionUpdates: [],
    eventTranslationRewrites: [],
    reviewContentAssetStatusUpdates: [],
    reviewContentUpdates: [],
    reviewActions: [],
    collectorActions: [],
    collectorImportReviews: [{ id: 902, review_status: "pending" }],
    transaction: [],
  };

  let nextMediaAssetId = 900;

  const connection = {
    async beginTransaction() {
      state.transaction.push("begin");
    },
    async commit() {
      state.transaction.push("commit");
    },
    async rollback() {
      state.transaction.push("rollback");
    },
    release() {
      state.transaction.push("release");
    },
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      if (normalized === "select * from review_contents where id=? limit 1 for update") {
        return [[{ ...state.reviewContent }]];
      }
      if (normalized.startsWith("select e.id, e.title, e.is_emer")) {
        return [[]];
      }
      if (normalized.startsWith("select e.id, e.is_emer, coalesce(et_th.title, e.title, '') as th_title from events e")) {
        return [[]];
      }
      if (normalized === "select id from events where id=? limit 1") {
        return [state.eventRowsById];
      }
      if (normalized.startsWith("update events set title=?, description=?, event_period_text=?, location_text=?, map_url=?, is_approved=1, approved_at=current_timestamp where id=?")) {
        state.events.push({
          id: params[5],
          title: params[0],
          description: params[1],
          event_period_text: params[2],
          location_text: params[3],
          map_url: params[4],
        });
        state.eventDescriptionRow = {
          description: params[1],
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("insert into event_translations")) {
        state.eventTranslationUpsert = {
          event_id: params[0],
          lang: params[1],
          title: params[2],
          description: params[3],
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes("from review_content_assets")) {
        return [state.reviewAssets];
      }
      if (normalized.includes("from content_image_usages ciu join media_assets ma")) {
        return [[]];
      }
      if (normalized.startsWith("delete from content_image_usages")) {
        state.contentImageUsages = [];
        return [{ affectedRows: 0 }];
      }
      if (normalized.startsWith("insert into media_assets")) {
        const inserted = {
          id: nextMediaAssetId++,
          storage_path: params[9],
          file_name: params[10],
        };
        state.mediaAssets.push(inserted);
        return [{ insertId: inserted.id }];
      }
      if (normalized.startsWith("insert into content_image_usages")) {
        state.contentImageUsages.push({
          asset_id: params[0],
          entity_type: params[1],
          entity_id: params[2],
          usage_type: params[3],
        });
        return [{ insertId: state.contentImageUsages.length }];
      }
      if (normalized.includes("from content_image_usages where asset_id in")) return [[]];
      if (normalized.startsWith("delete from media_assets")) return [{ affectedRows: 0 }];
      if (normalized === "update events set image=?, decision_cover_image=?, decision_thumbnail_image=? where id=?") {
        state.eventImageUpdate = {
          id: params[3],
          image: params[0],
          decision_cover_image: params[1],
          decision_thumbnail_image: params[2],
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized === "select description from events where id=? limit 1") {
        throw new Error("event approve must not rely on re-reading events.description after upsert");
      }
      if (normalized === "update events set description=? where id=?") {
        state.eventDescriptionUpdates.push({ description: params[0], id: params[1] });
        state.eventDescriptionRow.description = params[0];
        return [{ affectedRows: 1 }];
      }
      if (normalized === "select lang, description from event_translations where event_id=?") {
        return [state.eventTranslationRows.map((row) => ({ ...row }))];
      }
      if (normalized.startsWith("update event_translations set description=? where event_id=? and lang=?")) {
        state.eventTranslationRewrites.push({
          description: params[0],
          event_id: params[1],
          lang: params[2],
        });
        state.eventTranslationRows = state.eventTranslationRows.map((row) =>
          row.lang === params[2] ? { ...row, description: params[0] } : row
        );
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("update review_contents set status='published'")) {
        state.reviewContent.status = "published";
        state.reviewContent.public_entity_type = params[2];
        state.reviewContent.public_entity_id = params[3];
        state.reviewContentUpdates.push({ status: "published" });
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("update review_content_assets set status='published'")) {
        state.reviewContentAssetStatusUpdates.push({ review_content_id: params[0], batch_uid: params[1] });
        return [{ affectedRows: state.reviewAssets.length }];
      }
      if (normalized.startsWith("insert into review_actions")) {
        state.reviewActions.push({ review_content_id: params[0], action_type: params[2] });
        return [{ insertId: state.reviewActions.length }];
      }
      if (normalized.startsWith("select id, review_status from collector_import_reviews")) {
        return [state.collectorImportReviews];
      }
      if (normalized.startsWith("update collector_import_reviews")) {
        state.collectorImportReviews[0] = { ...state.collectorImportReviews[0], review_status: params[0] };
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("insert into collector_import_review_actions")) {
        state.collectorActions.push({ review_id: params[0], action_type: params[1] });
        return [{ insertId: state.collectorActions.length }];
      }
      throw new Error(`Unexpected event connection SQL: ${sql}`);
    },
  };

  const poolQuery = async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (normalized.startsWith("create table if not exists collector_import_reviews")) return [{ warningStatus: 0 }];
    if (normalized === "show columns from places like 'curated_taxonomy_json'") return [[{ Field: "curated_taxonomy_json" }]];
    if (normalized === "show columns from collector_import_reviews like 'article_snapshot_json'") return [[{ Field: "article_snapshot_json" }]];
    if (normalized === "show columns from collector_import_reviews like 'translations_snapshot_json'") return [[{ Field: "translations_snapshot_json" }]];
    if (normalized.startsWith("create table if not exists collector_import_review_actions")) return [{ warningStatus: 0 }];
    throw new Error(`Unexpected pool SQL: ${sql} :: ${JSON.stringify(params)}`);
  };

  return { state, connection, poolQuery };
}

test("approveReviewContent updates published place image fields from storage_path-backed media", async () => {
  const originalGetConnection = pool.getConnection;
  const originalPoolQuery = pool.query;
  const originalBackendPublicUrl = process.env.BACKEND_PUBLIC_URL;
  const harness = createApproveHarness();

  pool.getConnection = async () => harness.connection;
  pool.query = harness.poolQuery;
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  await writeUploadFixture("uploads/review-item-32-asset-cover.jpg");

  try {
    const result = await approveReviewContent({
      reviewContent: { id: harness.state.reviewContent.id },
      actorUserId: 7,
      reviewNote: "approve for media test",
    });

    assert.equal(result.status, "published");
    assert.equal(harness.state.contentImageUsages.length, 1);
    assert.deepEqual(harness.state.contentImageUsages[0], {
      asset_id: 700,
      entity_type: "place",
      entity_id: 99,
      usage_type: "cover",
      position: 0,
      created_by: 7,
    });

    assert.equal(harness.state.mediaAssets.length, 1);
    assert.equal(harness.state.mediaAssets[0].storage_path, "uploads/published/places/99/501-batch-99-cover-0-1.jpg");
    assert.equal(harness.state.mediaAssets[0].file_name, "501-batch-99-cover-0-1.jpg");

    assert.equal(harness.state.places.length, 1);
    assert.equal(harness.state.places[0].image, "https://api-test.uboncity.com/uploads/published/places/99/501-batch-99-cover-0-1.jpg");
    assert.equal(harness.state.places[0].decision_cover_image, "https://api-test.uboncity.com/uploads/published/places/99/501-batch-99-cover-0-1.jpg");
    assert.equal(harness.state.places[0].decision_thumbnail_image, "https://api-test.uboncity.com/uploads/published/places/99/501-batch-99-cover-0-1.jpg");
    assert.doesNotMatch(harness.state.places[0].image, /uploads\/review-item-/);
    assert.equal(harness.state.placeTranslationRewrites?.length, 2);
    for (const row of harness.state.placeTranslationRows) {
      assert.match(String(row.description || ""), /uploads\/published\/places\/99\/501-batch-99-cover-0-1\.jpg/);
      assert.doesNotMatch(String(row.description || ""), /uploads\/review-item-/);
    }

    assert.equal(harness.state.reviewContent.status, "published");
    assert.equal(harness.state.reviewContent.public_entity_type, "place");
    assert.equal(harness.state.reviewContent.public_entity_id, 99);
    assert.equal(harness.state.reviewContentAssetStatusUpdates.length, 1);
  } finally {
    await removeUploadFixture("uploads/review-item-32-asset-cover.jpg");
    await removeUploadFixture("uploads/published/places/99/501-batch-99-cover-0-1.jpg");
    pool.getConnection = originalGetConnection;
    pool.query = originalPoolQuery;
    process.env.BACKEND_PUBLIC_URL = originalBackendPublicUrl;
  }
});

test("approveReviewContent rolls back when promoted review file is missing", async () => {
  const originalGetConnection = pool.getConnection;
  const originalPoolQuery = pool.query;
  const originalBackendPublicUrl = process.env.BACKEND_PUBLIC_URL;
  const harness = createApproveHarness();

  pool.getConnection = async () => harness.connection;
  pool.query = harness.poolQuery;
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";

  try {
    await assert.rejects(
      () =>
        approveReviewContent({
          reviewContent: { id: harness.state.reviewContent.id },
          actorUserId: 7,
          reviewNote: "approve missing media",
        }),
      /enoent|missing/i
    );

    assert.equal(harness.state.mediaAssets.length, 0);
    assert.equal(harness.state.contentImageUsages.length, 0);
    assert.ok(harness.state.transaction.includes("rollback"));
    assert.equal(harness.state.reviewContent.status, "pending_review");
  } finally {
    pool.getConnection = originalGetConnection;
    pool.query = originalPoolQuery;
    process.env.BACKEND_PUBLIC_URL = originalBackendPublicUrl;
  }
});

test("approveReviewContent rewrites stored events.description and all event translations from promoted media urls", async () => {
  const originalGetConnection = pool.getConnection;
  const originalPoolQuery = pool.query;
  const originalBackendPublicUrl = process.env.BACKEND_PUBLIC_URL;
  const harness = createEventApproveHarness();

  pool.getConnection = async () => harness.connection;
  pool.query = harness.poolQuery;
  process.env.BACKEND_PUBLIC_URL = "https://api-test.uboncity.com";
  await writeUploadFixture("uploads/review-item-55-asset-cover.jpg");

  try {
    const result = await approveReviewContent({
      reviewContent: { id: harness.state.reviewContent.id },
      actorUserId: 7,
      reviewNote: "approve event media",
    });

    assert.equal(result.status, "published");
    assert.match(String(harness.state.reviewContent.body || ""), /uploads\/review-item-55-asset-cover/);
    assert.equal(harness.state.eventDescriptionUpdates.length, 1);
    assert.equal(
      harness.state.eventDescriptionUpdates[0].description,
      '<p>Body <img src="https://api-test.uboncity.com/uploads/published/events/55/601-batch-55-cover-0-9.jpg"></p>'
    );
    assert.match(
      String(harness.state.eventDescriptionRow.description || ""),
      /uploads\/published\/events\/55\/601-batch-55-cover-0-9\.jpg/
    );
    assert.doesNotMatch(String(harness.state.eventDescriptionRow.description || ""), /uploads\/review-item-/);
    assert.equal(harness.state.eventTranslationRewrites.length, 2);
    for (const row of harness.state.eventTranslationRows) {
      assert.match(String(row.description || ""), /uploads\/published\/events\/55\/601-batch-55-cover-0-9\.jpg/);
      assert.doesNotMatch(String(row.description || ""), /uploads\/review-item-/);
    }
  } finally {
    await removeUploadFixture("uploads/review-item-55-asset-cover.jpg");
    await removeUploadFixture("uploads/published/events/55/601-batch-55-cover-0-9.jpg");
    pool.getConnection = originalGetConnection;
    pool.query = originalPoolQuery;
    process.env.BACKEND_PUBLIC_URL = originalBackendPublicUrl;
  }
});
