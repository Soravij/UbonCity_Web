import assert from "node:assert/strict";
import test from "node:test";

import pool from "../config/db.js";
import { ingestReviewContent } from "../services/reviewIngestService.js";

function normalizeSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function createHarness({
  existingReviewRow = null,
  failOn = null,
  pauseOnFirstExistingRead = false,
} = {}) {
  const committed = {
    reviewRow: existingReviewRow ? JSON.parse(JSON.stringify(existingReviewRow)) : null,
    reviewActions: [],
    reviewAssets: [],
  };
  const tx = {
    reviewRow: null,
    reviewActions: [],
    reviewAssets: [],
    insertParams: null,
    updateParams: null,
    active: false,
  };
  let existingReadCount = 0;
  let resolveFirstExistingReadSeen = null;
  let resolveFirstExistingReadRelease = null;
  let firstExistingReadRelease = Promise.resolve();
  const firstExistingReadSeen = new Promise((resolve) => {
    resolveFirstExistingReadSeen = resolve;
  });
  if (pauseOnFirstExistingRead) {
    firstExistingReadRelease = new Promise((resolve) => {
      resolveFirstExistingReadRelease = resolve;
    });
  }

  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;

  function snapshotFromInsertParams(params) {
    return {
      handoff_snapshot_json: params.at(-1) == null ? null : JSON.parse(String(params.at(-1))),
      review_payload_json: params.at(-2) == null ? null : JSON.parse(String(params.at(-2))),
    };
  }

  function snapshotFromUpdateParams(sql, params) {
    const hasHandoffSnapshotColumn = normalizeSql(sql).includes("handoff_snapshot_json");
    if (hasHandoffSnapshotColumn) {
      return {
        handoff_snapshot_json: params.at(-2) == null ? null : JSON.parse(String(params.at(-2))),
        review_payload_json: params.at(-3) == null ? null : JSON.parse(String(params.at(-3))),
      };
    }
    return {
      handoff_snapshot_json: null,
      review_payload_json: params.at(-2) == null ? null : JSON.parse(String(params.at(-2))),
    };
  }

  pool.query = async (sql, params = []) => {
    const normalized = normalizeSql(sql);
    if (normalized.includes("from review_contents where source_system")) {
      const row = committed.reviewRow;
      if (!row) return [[]];
      const clonedRow = {
        id: row.id,
        status: row.status,
        current_batch_uid: row.current_batch_uid,
        handoff_snapshot_json: row.handoff_snapshot_json == null ? null : JSON.stringify(row.handoff_snapshot_json),
      };
      existingReadCount += 1;
      if (pauseOnFirstExistingRead && existingReadCount === 1) {
        resolveFirstExistingReadSeen?.();
        await firstExistingReadRelease;
      }
      return [[clonedRow]];
    }
    if (normalized === "select * from review_contents where id=? limit 1") {
      const row = committed.reviewRow;
      if (!row) return [[]];
      return [[{
        ...row,
        handoff_snapshot_json: row.handoff_snapshot_json == null ? null : JSON.stringify(row.handoff_snapshot_json),
        review_payload_json: row.review_payload_json == null ? null : JSON.stringify(row.review_payload_json),
      }]];
    }
    if (normalized.startsWith("select usage_type, position, backend_url")) return [[]];
    if (normalized.startsWith("select id, batch_uid, action_type")) return [[]];
    throw new Error(`Unexpected pool SQL: ${sql} :: ${JSON.stringify(params)}`);
  };

  const connection = {
    async beginTransaction() {
      tx.active = true;
    },
    async commit() {
      if (tx.reviewRow) committed.reviewRow = JSON.parse(JSON.stringify(tx.reviewRow));
      committed.reviewActions.push(...tx.reviewActions);
      committed.reviewAssets.push(...tx.reviewAssets);
      tx.active = false;
      tx.reviewRow = null;
      tx.reviewActions = [];
      tx.reviewAssets = [];
    },
    async rollback() {
      tx.active = false;
      tx.reviewRow = null;
      tx.reviewActions = [];
      tx.reviewAssets = [];
    },
    release() {},
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      if (normalized.startsWith("insert into review_contents")) {
        tx.insertParams = Array.isArray(params) ? params.slice() : [];
        const snapshot = snapshotFromInsertParams(tx.insertParams);
        tx.reviewRow = {
          id: committed.reviewRow?.id || 501,
          source_system: String(params[0] || "").trim(),
          source_content_item_id: Number(params[1] || 0) || 0,
          content_type: String(params[2] || "").trim(),
          status: String(params[3] || "").trim(),
          lang: String(params[4] || "").trim(),
          category: params[5] ?? null,
          title: params[6] ?? null,
          body: params[7] ?? null,
          excerpt: params[8] ?? null,
          meta_title: params[9] ?? null,
          meta_description: params[10] ?? null,
          event_period_text: params[11] ?? null,
          location_text: params[12] ?? null,
          latitude: params[13] ?? null,
          longitude: params[14] ?? null,
          map_url: params[15] ?? null,
          google_place_id: params[16] ?? null,
          transport_subtype: params[17] ?? null,
          transport_contact_name: params[18] ?? null,
          transport_contact_phone: params[19] ?? null,
          phone: params[20] ?? null,
          line_url: params[21] ?? null,
          facebook_url: params[22] ?? null,
          website_url: params[23] ?? null,
          primary_cta: params[24] ?? null,
          tracking_entity_type: params[25] ?? null,
          tracking_entity_id: params[26] ?? null,
          transport_contact_details: params[27] ?? null,
          transport_link_url: params[28] ?? null,
          slug: params[29] ?? null,
          slug_locked: Number(params[30] || 0) || 0,
          public_entity_type: params[31] ?? null,
          public_entity_id: params[32] ?? null,
          current_batch_uid: params[33] ?? null,
          review_payload_json: snapshot.review_payload_json,
          handoff_snapshot_json: snapshot.handoff_snapshot_json,
          published_at: null,
        };
        if (failOn === "review_contents_insert") {
          throw new Error("injected failure after review insert");
        }
        return [{ insertId: committed.reviewRow?.id || 501 }];
      }
      if (normalized.startsWith("update review_contents")) {
        tx.updateParams = Array.isArray(params) ? params.slice() : [];
        const hasHandoffSnapshotColumn = normalizeSql(sql).includes("handoff_snapshot_json");
        const snapshot = snapshotFromUpdateParams(sql, tx.updateParams);
        tx.reviewRow = {
          ...(committed.reviewRow || { id: 501 }),
          status: "pending_review",
          current_batch_uid: hasHandoffSnapshotColumn
            ? params.at(-4) ?? committed.reviewRow?.current_batch_uid ?? null
            : params.at(-3) ?? committed.reviewRow?.current_batch_uid ?? null,
          review_payload_json: snapshot.review_payload_json,
          handoff_snapshot_json: hasHandoffSnapshotColumn
            ? snapshot.handoff_snapshot_json
            : (committed.reviewRow?.handoff_snapshot_json ?? null),
        };
        if (failOn === "review_contents_update") {
          throw new Error("injected failure after review update");
        }
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("insert into review_content_assets")) {
        tx.reviewAssets.push(Array.isArray(params) ? params.slice() : []);
        if (failOn === "review_content_assets_insert") {
          throw new Error("injected failure after review asset insert");
        }
        return [{ insertId: tx.reviewAssets.length }];
      }
      if (normalized.startsWith("insert into review_actions")) {
        tx.reviewActions.push(Array.isArray(params) ? params.slice() : []);
        if (failOn === "review_actions_insert") {
          throw new Error("injected failure after review action insert");
        }
        return [{ insertId: tx.reviewActions.length }];
      }
      if (normalized.startsWith("update review_content_assets")) {
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    },
  };

  pool.getConnection = async () => connection;

  return {
    committed,
    tx,
    firstExistingReadSeen,
    releaseFirstExistingRead: () => {
      resolveFirstExistingReadRelease?.();
      resolveFirstExistingReadRelease = null;
    },
    restore() {
      pool.query = originalQuery;
      pool.getConnection = originalGetConnection;
    },
  };
}

test("trusted field review insert stores accepted pair A then trusted reingest replaces it with pair B", async () => {
  const harness = createHarness();
  try {
    const basePayload = {
      source_system: "collector-app",
      source_content_item_id: 42,
      source_base_url: "https://collector.example",
      review_source_kind: "field_accepted_binding",
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
    };

    await ingestReviewContent({
      ...basePayload,
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 34,
        accepted_submission_id: 56,
        accepted_at: "2026-06-23T00:00:00.000Z",
        revision_round: 1,
      },
    }, { trustedSnapshotSource: true });
    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_handoff_snapshot_id, 34);

    await ingestReviewContent({
      ...basePayload,
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 35,
        accepted_submission_id: 57,
        accepted_at: "2026-06-23T01:00:00.000Z",
        revision_round: 2,
      },
    }, { trustedSnapshotSource: true });
    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_handoff_snapshot_id, 35);
    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_submission_id, 57);
  } finally {
    harness.restore();
  }
});

test("untrusted reingest preserves existing frozen snapshot and cannot self-declare field provenance", async () => {
  const harness = createHarness({
    existingReviewRow: {
      id: 501,
      current_batch_uid: "batch-1",
      status: "pending_review",
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 34,
        accepted_submission_id: 56,
        accepted_at: "2026-06-23T00:00:00.000Z",
        revision_round: 1,
      },
      review_payload_json: { snapshot_meta: { translation_langs: ["en"] } },
    },
  });
  try {
    await ingestReviewContent({
      source_system: "collector-app",
      source_content_item_id: 42,
      source_base_url: "https://collector.example",
      review_source_kind: "field_accepted_binding",
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
        assignment_id: 999,
        accepted_handoff_snapshot_id: 999,
      },
    }, { trustedSnapshotSource: false });

    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_handoff_snapshot_id, 34);
    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_submission_id, 56);
  } finally {
    harness.restore();
  }
});

test("trusted editorial place ingest succeeds with a null snapshot", async () => {
  const harness = createHarness();
  try {
    await ingestReviewContent({
      source_system: "collector-app",
      source_content_item_id: 77,
      source_base_url: "https://collector.example",
      review_source_kind: "editorial_article_workspace",
      content: {
        content_type: "place",
        lang: "th",
        category: "attractions",
        title: "Editorial Place",
        body: "<p>Body</p>",
        excerpt: "Excerpt",
        meta_title: "Meta",
        meta_description: "Meta desc",
      },
    }, { trustedSnapshotSource: true });

    assert.equal(harness.committed.reviewRow.handoff_snapshot_json, null);
  } finally {
    harness.restore();
  }
});

test("review ingest rollback clears row snapshot action and media writes after failure", async () => {
  const harness = createHarness({
    existingReviewRow: {
      id: 501,
      current_batch_uid: "batch-1",
      status: "pending_review",
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 34,
        accepted_submission_id: 56,
        accepted_at: "2026-06-23T00:00:00.000Z",
        revision_round: 1,
      },
      review_payload_json: { snapshot_meta: { translation_langs: ["en"] } },
    },
    failOn: "review_actions_insert",
  });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-type": "image/jpeg",
      },
    });
    await assert.rejects(() => ingestReviewContent({
      source_system: "collector-app",
      source_content_item_id: 42,
      source_base_url: "https://collector.example",
      review_source_kind: "field_accepted_binding",
      content: {
        content_type: "place",
        lang: "th",
        category: "attractions",
        title: "Rollback Place",
        body: "<p>Body</p>",
        excerpt: "Excerpt",
        meta_title: "Meta",
        meta_description: "Meta desc",
      },
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 99,
        accepted_submission_id: 100,
        accepted_at: "2026-06-23T02:00:00.000Z",
        revision_round: 2,
      },
      media_manifest: {
        cover: { source_url: "/uploads/cover.jpg" },
      },
    }, { trustedSnapshotSource: true }), /injected failure/);

    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_handoff_snapshot_id, 34);
    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_submission_id, 56);
    assert.equal(harness.committed.reviewActions.length, 0);
    assert.equal(harness.committed.reviewAssets.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
  }
});

test("untrusted reingest cannot overwrite a newer trusted handoff snapshot during concurrent update", async () => {
  const harness = createHarness({
    existingReviewRow: {
      id: 501,
      current_batch_uid: "batch-1",
      status: "pending_review",
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 34,
        accepted_submission_id: 56,
        accepted_at: "2026-06-23T00:00:00.000Z",
        revision_round: 1,
      },
      review_payload_json: { snapshot_meta: { translation_langs: ["en"] } },
    },
    pauseOnFirstExistingRead: true,
  });
  try {
    const basePayload = {
      source_system: "collector-app",
      source_content_item_id: 42,
      source_base_url: "https://collector.example",
      content: {
        content_type: "place",
        lang: "th",
        category: "attractions",
        title: "Race Place",
        body: "<p>Body</p>",
        excerpt: "Excerpt",
        meta_title: "Meta",
        meta_description: "Meta desc",
      },
    };

    const untrustedPromise = ingestReviewContent({
      ...basePayload,
      review_source_kind: "editorial_article_workspace",
    }, { trustedSnapshotSource: false });

    await harness.firstExistingReadSeen;

    const trustedPromise = ingestReviewContent({
      ...basePayload,
      review_source_kind: "field_accepted_binding",
      handoff_snapshot_json: {
        version: 1,
        assignment_id: 12,
        accepted_handoff_snapshot_id: 35,
        accepted_submission_id: 57,
        accepted_at: "2026-06-23T01:00:00.000Z",
        revision_round: 2,
      },
    }, { trustedSnapshotSource: true });

    await trustedPromise;
    harness.releaseFirstExistingRead();
    await untrustedPromise;

    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_handoff_snapshot_id, 35);
    assert.equal(harness.committed.reviewRow.handoff_snapshot_json.accepted_submission_id, 57);
  } finally {
    harness.restore();
  }
});
