import assert from "node:assert/strict";
import test from "node:test";

import pool from "../config/db.js";
import { ingestReviewContent, isRetryableReviewSubmission } from "../services/reviewIngestService.js";

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
    assert.equal(queryCount, 2);
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});
