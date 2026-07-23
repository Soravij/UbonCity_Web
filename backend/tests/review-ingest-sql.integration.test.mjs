import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import pool from "../config/db.js";
import { ingestReviewContent } from "../services/reviewIngestService.js";

const runSqlIntegration = String(process.env.RUN_REVIEW_INGEST_SQL_INTEGRATION || "").trim() === "1";
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmJ0AAAAASUVORK5CYII=",
  "base64"
);

if (runSqlIntegration) {
  // This is the only test in this file that opens the shared MySQL pool. Register
  // teardown before the test so a failed connect/query cannot keep Node alive.
  test.after(async () => {
    await pool.end();
  });
}

function makePayload({ sourceContentItemId, submissionId, manifestHash, caption, sourceAssetId, translationTitle }) {
  return {
    source_system: "review-ingest-sql-integration",
    source_content_item_id: sourceContentItemId,
    source_submission_id: submissionId,
    source_manifest_hash: manifestHash,
    source_base_url: "https://collector.integration.test",
    content: {
      content_type: "place",
      lang: "th",
      category: "attractions",
      title: `SQL ingest ${manifestHash.slice(0, 8)}`,
      body: "<p>SQL integration fixture</p>",
    },
    translations: [{
      lang: "en",
      title: translationTitle,
      excerpt: "SQL translation excerpt",
      body: `<p>${translationTitle} body</p>`,
      meta_title: `${translationTitle} meta`,
      meta_description: `${translationTitle} description`,
    }],
    media_manifest: {
      cover: {
        source_url: "/uploads/review-ingest-sql.png",
        client_media_uid: "cover-fixture",
        caption,
        source_asset_id: sourceAssetId,
      },
      gallery: [],
      inline: [],
    },
  };
}

function makeUpload() {
  return {
    fieldname: "media_cover-fixture",
    originalname: "review-ingest-sql.png",
    mimetype: "image/png",
    buffer: onePixelPng,
  };
}

test("review ingest executes provenance insert, retry, and revision against MySQL", { skip: !runSqlIntegration }, async () => {
  const sourceContentItemId = Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`);
  const firstSubmissionId = "11111111-1111-4111-8111-111111111111";
  const revisionSubmissionId = "22222222-2222-4222-8222-222222222222";
  const firstManifestHash = "a".repeat(64);
  const revisionManifestHash = "b".repeat(64);
  const cleanupPaths = new Set();

  try {
    const first = await ingestReviewContent(
      makePayload({
        sourceContentItemId,
        submissionId: firstSubmissionId,
        manifestHash: firstManifestHash,
        caption: "first caption",
        sourceAssetId: 701,
        translationTitle: "First translation",
      }),
      { multipart: true, uploadedFiles: [makeUpload()] }
    );
    assert.equal(first.retry, undefined);
    assert.equal(first.asset_counts.cover, 1);

    const [firstRows] = await pool.query(
      `SELECT source_submission_id, source_manifest_hash, current_batch_uid
       FROM review_contents
       WHERE id=?`,
      [first.id]
    );
    assert.deepEqual(firstRows[0], {
      source_submission_id: firstSubmissionId,
      source_manifest_hash: firstManifestHash,
      current_batch_uid: first.current_batch_uid,
    });
    const [firstAssets] = await pool.query(
      `SELECT caption, source_asset_id, source_submission_id, storage_path
       FROM review_content_assets
       WHERE review_content_id=? AND batch_uid=?`,
      [first.id, first.current_batch_uid]
    );
    assert.equal(firstAssets.length, 1);
    assert.equal(firstAssets[0].caption, "first caption");
    assert.equal(Number(firstAssets[0].source_asset_id), 701);
    assert.equal(firstAssets[0].source_submission_id, firstSubmissionId);
    cleanupPaths.add(String(firstAssets[0].storage_path || ""));
    const [firstTranslations] = await pool.query(
      `SELECT lang, title, source_submission_id, status
       FROM review_content_translations
       WHERE review_content_id=? AND batch_uid=?`,
      [first.id, first.current_batch_uid]
    );
    assert.deepEqual(firstTranslations, [{
      lang: "en",
      title: "First translation",
      source_submission_id: firstSubmissionId,
      status: "review_ready",
    }]);

    const retry = await ingestReviewContent(
      makePayload({
        sourceContentItemId,
        submissionId: firstSubmissionId,
        manifestHash: firstManifestHash,
        caption: "first caption",
        sourceAssetId: 701,
        translationTitle: "First translation",
      }),
      { multipart: true, uploadedFiles: [makeUpload()] }
    );
    assert.equal(retry.retry, true);
    assert.equal(retry.current_batch_uid, first.current_batch_uid);

    const revision = await ingestReviewContent(
      makePayload({
        sourceContentItemId,
        submissionId: revisionSubmissionId,
        manifestHash: revisionManifestHash,
        caption: "revision caption",
        sourceAssetId: 702,
        translationTitle: "Revision translation",
      }),
      { multipart: true, uploadedFiles: [makeUpload()] }
    );
    assert.notEqual(revision.current_batch_uid, first.current_batch_uid);

    const [revisionRows] = await pool.query(
      `SELECT source_submission_id, source_manifest_hash, current_batch_uid
       FROM review_contents
       WHERE id=?`,
      [first.id]
    );
    assert.deepEqual(revisionRows[0], {
      source_submission_id: revisionSubmissionId,
      source_manifest_hash: revisionManifestHash,
      current_batch_uid: revision.current_batch_uid,
    });
    const [revisionAssets] = await pool.query(
      `SELECT caption, source_asset_id, source_submission_id, storage_path
       FROM review_content_assets
       WHERE review_content_id=? AND batch_uid=? AND status='review_ready'`,
      [first.id, revision.current_batch_uid]
    );
    assert.equal(revisionAssets.length, 1);
    assert.equal(revisionAssets[0].caption, "revision caption");
    assert.equal(Number(revisionAssets[0].source_asset_id), 702);
    assert.equal(revisionAssets[0].source_submission_id, revisionSubmissionId);
    cleanupPaths.add(String(revisionAssets[0].storage_path || ""));
    const [supersededTranslations] = await pool.query(
      `SELECT status
       FROM review_content_translations
       WHERE review_content_id=? AND batch_uid=? AND lang='en'`,
      [first.id, first.current_batch_uid]
    );
    assert.deepEqual(supersededTranslations, [{ status: "deleted" }]);
    const [revisionTranslations] = await pool.query(
      `SELECT lang, title, source_submission_id, status
       FROM review_content_translations
       WHERE review_content_id=? AND batch_uid=?`,
      [first.id, revision.current_batch_uid]
    );
    assert.deepEqual(revisionTranslations, [{
      lang: "en",
      title: "Revision translation",
      source_submission_id: revisionSubmissionId,
      status: "review_ready",
    }]);
  } finally {
    const [assetRows] = await pool.query(
      `SELECT storage_path
       FROM review_content_assets rca
       INNER JOIN review_contents rc ON rc.id=rca.review_content_id
       WHERE rc.source_system='review-ingest-sql-integration' AND rc.source_content_item_id=?`,
      [sourceContentItemId]
    );
    for (const row of assetRows) cleanupPaths.add(String(row?.storage_path || ""));
    await pool.query(
      `DELETE FROM review_contents
       WHERE source_system='review-ingest-sql-integration' AND source_content_item_id=?`,
      [sourceContentItemId]
    );
    await Promise.all(
      [...cleanupPaths]
        .filter((storagePath) => storagePath.startsWith("uploads/"))
        .map((storagePath) => fs.unlink(path.resolve(import.meta.dirname, "..", storagePath)).catch(() => {}))
    );
  }
});
