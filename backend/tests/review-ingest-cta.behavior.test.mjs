import assert from "node:assert/strict";
import test from "node:test";

import { mapReviewContentCtaFieldsToPlaceRecord } from "../services/reviewDecisionService.js";
import {
  buildReviewContentInsertParams,
  buildReviewContentUpdateParams,
  sanitizeContentPayload,
} from "../services/reviewIngestService.js";

function createSanitizedContent(overrides = {}) {
  return sanitizeContentPayload({
    content_type: "place",
    lang: "th",
    category: "attractions",
    title: "Test place",
    body: "<p>Body</p>",
    excerpt: "Summary",
    meta_title: "Meta title",
    meta_description: "Meta description",
    ...overrides,
  });
}

test("review ingest insert params persist CTA/contact into review_contents payload", () => {
  const content = createSanitizedContent({
    phone: "0812345678",
    line_url: "https://line.me/ti/p/test-line",
    facebook_url: "https://facebook.com/test-place",
    website_url: "https://example.com/test-place",
    primary_cta: "line",
  });

  const params = buildReviewContentInsertParams({
    sourceSystem: "collector-app",
    sourceContentItemId: 42,
    content,
    currentBatchUid: "batch-1",
  });

  assert.equal(params[20], "0812345678");
  assert.equal(params[21], "https://line.me/ti/p/test-line");
  assert.equal(params[22], "https://facebook.com/test-place");
  assert.equal(params[23], "https://example.com/test-place");
  assert.equal(params[24], "line");
});

test("review ingest insert params append frozen handoff snapshot payload", () => {
  const content = createSanitizedContent();
  const handoffSnapshotJson = {
    version: 1,
    assignment_id: 77,
    accepted_handoff_snapshot_id: 88,
  };

  const params = buildReviewContentInsertParams({
    sourceSystem: "collector-app",
    sourceContentItemId: 42,
    content,
    currentBatchUid: "batch-1",
    handoffSnapshotJson,
  });

  assert.deepEqual(JSON.parse(params.at(-1)), handoffSnapshotJson);
});

test("review ingest update params preserve existing CTA/contact when payload omits them", () => {
  const existing = {
    phone: "0812345678",
    line_url: "https://line.me/ti/p/existing",
    facebook_url: "https://facebook.com/existing",
    website_url: "https://example.com/existing",
    primary_cta: "phone",
  };
  const rawPayload = {
    content_type: "place",
    lang: "th",
    category: "attractions",
    title: "Test place",
    body: "<p>Body</p>",
  };
  const content = sanitizeContentPayload(rawPayload);

  const params = buildReviewContentUpdateParams({
    existing,
    content,
    rawContentPayload: rawPayload,
    currentBatchUid: "batch-2",
    reviewContentId: 99,
  });

  assert.equal(params[16], "0812345678");
  assert.equal(params[17], "https://line.me/ti/p/existing");
  assert.equal(params[18], "https://facebook.com/existing");
  assert.equal(params[19], "https://example.com/existing");
  assert.equal(params[20], "phone");
  assert.equal(params.at(-1), 99);
});

test("review ingest update params apply explicit CTA/contact replacements", () => {
  const existing = {
    phone: "0812345678",
    line_url: "https://line.me/ti/p/existing",
    facebook_url: "https://facebook.com/existing",
    website_url: "https://example.com/existing",
    primary_cta: "phone",
  };
  const rawPayload = {
    content_type: "place",
    lang: "th",
    category: "attractions",
    title: "Test place",
    body: "<p>Body</p>",
    phone: "0899999999",
    line_url: "https://line.me/ti/p/updated",
    facebook_url: "https://facebook.com/updated",
    website_url: "https://example.com/updated",
    primary_cta: "line",
  };
  const content = sanitizeContentPayload(rawPayload);

  const params = buildReviewContentUpdateParams({
    existing,
    content,
    rawContentPayload: rawPayload,
    currentBatchUid: "batch-3",
    reviewContentId: 100,
  });

  assert.equal(params[16], "0899999999");
  assert.equal(params[17], "https://line.me/ti/p/updated");
  assert.equal(params[18], "https://facebook.com/updated");
  assert.equal(params[19], "https://example.com/updated");
  assert.equal(params[20], "line");
});

test("review ingest update params append frozen handoff snapshot payload before row id", () => {
  const content = createSanitizedContent();
  const handoffSnapshotJson = {
    version: 1,
    assignment_id: 77,
    accepted_handoff_snapshot_id: 88,
  };

  const params = buildReviewContentUpdateParams({
    existing: null,
    content,
    rawContentPayload: {},
    currentBatchUid: "batch-3",
    reviewContentId: 100,
    handoffSnapshotJson,
  });

  assert.deepEqual(JSON.parse(params.at(-2)), handoffSnapshotJson);
  assert.equal(params.at(-1), 100);
});

test("approve mapping passes CTA/contact from review content to place fields", () => {
  const mapped = mapReviewContentCtaFieldsToPlaceRecord({
    phone: "0812345678",
    line_url: "https://line.me/ti/p/test-line",
    facebook_url: "https://facebook.com/test-place",
    website_url: "https://example.com/test-place",
    primary_cta: "line",
    tracking_entity_type: "review_content",
    tracking_entity_id: 42,
  });

  assert.deepEqual(mapped, {
    phone: "0812345678",
    line_url: "https://line.me/ti/p/test-line",
    facebook_url: "https://facebook.com/test-place",
    website_url: "https://example.com/test-place",
    primary_cta: "line",
    tracking_entity_type: "review_content",
    tracking_entity_id: 42,
  });
});
