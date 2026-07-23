import assert from "node:assert/strict";
import test from "node:test";

import pool from "../config/db.js";
import {
  ingestReviewContent,
  isRetryableReviewSubmission,
  sanitizeReviewTranslations,
} from "../services/reviewIngestService.js";
import { cleanupUnpublishedBatchTranslations } from "../services/reviewCleanupService.js";

const submissionId = "2d19bc4e-6b8b-4f7e-8a95-0123456789ab";
const manifestHash = "a".repeat(64);

test("same submission and manifest retry only while the current batch remains review_ready", () => {
  const existing = { source_submission_id: submissionId, source_manifest_hash: manifestHash };
  assert.equal(isRetryableReviewSubmission(existing, submissionId, manifestHash, 2), true);
  assert.equal(isRetryableReviewSubmission(existing, submissionId, manifestHash, 0), false);
});

test("changed manifest creates a new review batch rather than retrying", () => {
  const existing = { source_submission_id: submissionId, source_manifest_hash: manifestHash };
  assert.equal(isRetryableReviewSubmission(existing, submissionId, "b".repeat(64), 2), false);
});

test("a rejected or otherwise cleaned batch is not retryable even with the same manifest", () => {
  const existing = { source_submission_id: submissionId, source_manifest_hash: manifestHash };
  assert.equal(isRetryableReviewSubmission(existing, submissionId, manifestHash, 0), false);
});

test("retry requires the current review-ready translation language set to match the frozen submission", () => {
  const existing = { source_submission_id: submissionId, source_manifest_hash: manifestHash };
  assert.equal(
    isRetryableReviewSubmission(existing, submissionId, manifestHash, 1, [{ lang: "en" }], [{ lang: "en" }]),
    true
  );
  assert.equal(
    isRetryableReviewSubmission(existing, submissionId, manifestHash, 1, [{ lang: "en" }], [{ lang: "lo" }]),
    false
  );
});

test("translation validation rejects oversized UTF-8 TEXT bodies without truncating", () => {
  const oversizedBody = "ก".repeat(21846);
  assert.throws(
    () => sanitizeReviewTranslations([{ lang: "en", title: "English", body: oversizedBody }], "th"),
    /translations\[en\]\.body is too large \(65538 bytes; max 65535\)/
  );
  assert.deepEqual(
    sanitizeReviewTranslations([{ lang: "en", title: "English", body: "<p>Body</p>", meta_description: "ก".repeat(320) }], "th"),
    [{ lang: "en", title: "English", excerpt: null, body: "<p>Body</p>", meta_title: null, meta_description: "ก".repeat(320) }]
  );
});

test("translation validation requires supported unique non-source languages", () => {
  assert.throws(
    () => sanitizeReviewTranslations({ lang: "en" }, "th"),
    /translations must be an array/
  );
  assert.throws(
    () => sanitizeReviewTranslations([{ lang: "th", title: "Thai", body: "<p>Body</p>" }], "th"),
    /must not match content\.lang/
  );
  assert.throws(
    () => sanitizeReviewTranslations([
      { lang: " EN ", title: "First", body: "<p>First</p>" },
      { lang: "en", title: "Duplicate", body: "<p>Duplicate</p>" },
    ], "th"),
    /duplicate lang: en/
  );
});

test("translation cleanup only marks review-ready rows deleted", async () => {
  const calls = [];
  await cleanupUnpublishedBatchTranslations(7, "batch-1", {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return [{}];
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SET status='deleted'/);
  assert.match(calls[0].sql, /status='review_ready'/);
  assert.deepEqual(calls[0].params, [7, "batch-1"]);
});

test("ingest retry returns the existing review-ready batch without opening a transaction or mirroring media", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let queryCount = 0;
  pool.query = async (sql) => {
    queryCount += 1;
    const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.startsWith("select id, status, current_batch_uid")) {
      return [[{
        id: 91,
        status: "pending_review",
        current_batch_uid: "ready-batch",
        review_payload_json: "{}",
        source_submission_id: submissionId,
        source_manifest_hash: manifestHash,
      }]];
    }
    if (normalized.startsWith("select usage_type, count(*) as count from review_content_assets")) {
      return [[{ usage_type: "cover", count: 1 }, { usage_type: "gallery", count: 2 }]];
    }
    if (normalized.startsWith("select lang from review_content_translations")) return [[]];
    throw new Error(`Unexpected retry SQL: ${sql}`);
  };
  pool.getConnection = async () => {
    throw new Error("retry must not open a transaction");
  };
  try {
    const result = await ingestReviewContent({
      source_system: "collector-app",
      source_content_item_id: 44,
      source_base_url: "https://collector.example",
      source_submission_id: submissionId,
      source_manifest_hash: manifestHash,
      content: { content_type: "place", title: "Retry", body: "<p>Retry</p>" },
      media_manifest: { cover: { source_url: "/media/cover.jpg" } },
    }, { multipart: true, uploadedFiles: [] });
    assert.equal(result.retry, true);
    assert.equal(result.current_batch_uid, "ready-batch");
    assert.deepEqual(result.asset_counts, { cover: 1, gallery: 2, inline: 0 });
    assert.equal(queryCount, 3);
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});
