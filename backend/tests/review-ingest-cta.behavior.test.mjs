import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { mapReviewContentCtaFieldsToPlaceRecord } from "../services/reviewDecisionService.js";
import {
  buildReviewContentInsertParams,
  buildReviewContentUpdateParams,
  mergeExistingReviewContentPublicEntityIdentity,
  sanitizeContentPayload,
} from "../services/reviewIngestService.js";

const reviewIngestSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "services", "reviewIngestService.js"),
  "utf8"
);

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

  assert.equal(params[22], "0812345678");
  assert.equal(params[23], "https://line.me/ti/p/test-line");
  assert.equal(params[24], "https://facebook.com/test-place");
  assert.equal(params[25], "https://example.com/test-place");
  assert.equal(params[26], "line");
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

  assert.equal(params[18], "0812345678");
  assert.equal(params[19], "https://line.me/ti/p/existing");
  assert.equal(params[20], "https://facebook.com/existing");
  assert.equal(params[21], "https://example.com/existing");
  assert.equal(params[22], "phone");
  assert.equal(params.at(-1), 99);
});

test("review ingest update params clear existing CTA/contact when explicit nulls are sent", () => {
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
    phone: null,
    line_url: null,
    facebook_url: null,
    website_url: null,
    primary_cta: null,
  };
  const params = buildReviewContentUpdateParams({
    existing,
    content: sanitizeContentPayload(rawPayload),
    rawContentPayload: rawPayload,
    currentBatchUid: "batch-null",
    reviewContentId: 101,
  });

  assert.deepEqual(params.slice(16, 21), [null, null, null, null, null]);
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

  assert.equal(params[18], "0899999999");
  assert.equal(params[19], "https://line.me/ti/p/updated");
  assert.equal(params[20], "https://facebook.com/updated");
  assert.equal(params[21], "https://example.com/updated");
  assert.equal(params[22], "line");
});

test("review ingest insert params store confirmed taxonomy checks in review_payload_json", () => {
  const content = createSanitizedContent({
    confirmed_taxonomy_checks: { parking: true, price_level: "budget" },
  });

  const params = buildReviewContentInsertParams({
    sourceSystem: "collector-app",
    sourceContentItemId: 42,
    content,
    currentBatchUid: "batch-1",
  });

  assert.deepEqual(JSON.parse(params.at(-1)).confirmed_taxonomy_checks, { parking: true, price_level: "budget" });
});

test("review ingest insert params omit confirmed_taxonomy_checks entirely when none are sent", () => {
  const content = createSanitizedContent();

  const params = buildReviewContentInsertParams({
    sourceSystem: "collector-app",
    sourceContentItemId: 42,
    content,
    currentBatchUid: "batch-1",
  });

  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(params.at(-1)), "confirmed_taxonomy_checks"), false);
});

test("review ingest update params preserve existing confirmed taxonomy checks when payload omits them", () => {
  const existing = {
    review_payload_json: JSON.stringify({
      snapshot_meta: { translation_langs: [] },
      confirmed_taxonomy_checks: { parking: true, wifi_available: false },
    }),
  };
  const rawPayload = {
    content_type: "place",
    lang: "th",
    category: "attractions",
    title: "Test place",
    body: "<p>Body</p>",
  };

  const params = buildReviewContentUpdateParams({
    existing,
    content: sanitizeContentPayload(rawPayload),
    rawContentPayload: rawPayload,
    currentBatchUid: "batch-2",
    reviewContentId: 99,
  });

  assert.deepEqual(JSON.parse(params.at(-2)).confirmed_taxonomy_checks, { parking: true, wifi_available: false });
});

test("review ingest update params overwrite confirmed taxonomy checks when the payload sends new ones", () => {
  const existing = {
    review_payload_json: JSON.stringify({
      snapshot_meta: { translation_langs: [] },
      confirmed_taxonomy_checks: { parking: true },
    }),
  };
  const rawPayload = {
    content_type: "place",
    lang: "th",
    category: "attractions",
    title: "Test place",
    body: "<p>Body</p>",
    confirmed_taxonomy_checks: { parking: false, wifi_available: true },
  };

  const params = buildReviewContentUpdateParams({
    existing,
    content: sanitizeContentPayload(rawPayload),
    rawContentPayload: rawPayload,
    currentBatchUid: "batch-2",
    reviewContentId: 99,
  });

  assert.deepEqual(JSON.parse(params.at(-2)).confirmed_taxonomy_checks, { parking: false, wifi_available: true });
});

test("review ingest update params preserve the existing public entity identity when collector handoff omits it", () => {
  const existing = { public_entity_type: "place", public_entity_id: 321 };
  const rawPayload = {
    content_type: "place",
    lang: "th",
    category: "attractions",
    title: "Test place",
    body: "<p>Body</p>",
  };
  const params = buildReviewContentUpdateParams({
    existing,
    content: sanitizeContentPayload(rawPayload),
    rawContentPayload: rawPayload,
    currentBatchUid: "batch-identity",
    reviewContentId: 99,
  });

  assert.deepEqual(params.slice(29, 31), ["place", 321]);
});

test("re-ingest existing-row query selects every field used by preservation merges", () => {
  const start = reviewIngestSource.indexOf("const [existingRows] = await pool.query(");
  const end = reviewIngestSource.indexOf("const existing = existingRows", start);
  const selector = reviewIngestSource.slice(start, end);
  for (const column of [
    "public_entity_type",
    "public_entity_id",
    "phone",
    "line_url",
    "facebook_url",
    "website_url",
    "primary_cta",
  ]) {
    assert.match(selector, new RegExp(`\\b${column}\\b`));
  }
});

test("review ingest update params allow an explicit valid public entity identity to replace the old one", () => {
  const content = createSanitizedContent({ public_entity_type: "place", public_entity_id: 654 });
  assert.deepEqual(
    mergeExistingReviewContentPublicEntityIdentity({ public_entity_type: "place", public_entity_id: 321 }, content),
    { public_entity_type: "place", public_entity_id: 654 }
  );
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
