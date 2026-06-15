import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewIngestContentPayload } from "../server/review-ingest-mapping.mjs";

function createBaseArgs(overrides = {}) {
  return {
    contentType: "place",
    sourceLang: "th",
    item: {
      category: "attractions",
      slug: "test-place",
      latitude: 15.244,
      longitude: 104.847,
      map_url: "https://maps.example.com/test-place",
      google_place_id: "place_123",
      event_period_text: "1-2 Jan",
      location_text: "Ubon",
    },
    latestDraft: {
      confirmed_cta_contact_json: {
        phone: "0812345678",
        line_url: "https://line.me/ti/p/test-line",
        facebook_url: "https://facebook.com/test-place",
        website_url: "https://example.com/test-place",
        primary_cta: "line",
      },
      confirmed_taxonomy_json: {
        category: "restaurants",
        subtype: "cafe",
        tags: ["coffee"],
      },
    },
    title: "Test place",
    excerpt: "Summary",
    rewrittenBody: "<p>Body</p>",
    metaTitle: "Meta title",
    metaDescription: "Meta description",
    otherTransportMeta: null,
    translationLangs: ["en"],
    ...overrides,
  };
}

test("review ingest content payload includes confirmed CTA/contact for place content", () => {
  const content = buildReviewIngestContentPayload(createBaseArgs());

  assert.deepEqual(
    {
      phone: content.phone,
      line_url: content.line_url,
      facebook_url: content.facebook_url,
      website_url: content.website_url,
      primary_cta: content.primary_cta,
    },
    {
      phone: "0812345678",
      line_url: "https://line.me/ti/p/test-line",
      facebook_url: "https://facebook.com/test-place",
      website_url: "https://example.com/test-place",
      primary_cta: "line",
    }
  );
});

test("review ingest content payload excludes CTA/contact for event content even when draft has values", () => {
  const content = buildReviewIngestContentPayload(createBaseArgs({
    contentType: "event",
    item: {
      category: "events",
      slug: "test-event",
      event_period_text: "1-2 Jan",
      location_text: "Ubon",
    },
  }));

  assert.equal(Object.prototype.hasOwnProperty.call(content, "phone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(content, "line_url"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(content, "facebook_url"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(content, "website_url"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(content, "primary_cta"), false);
  assert.equal(content.content_type, "event");
});

test("review ingest content payload does not propagate taxonomy into review content", () => {
  const content = buildReviewIngestContentPayload(createBaseArgs());

  assert.equal(Object.prototype.hasOwnProperty.call(content, "subtype"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(content, "tags"), false);
  assert.equal(content.category, "attractions");
});

test("review ingest content payload ignores AI curated and field-return sources for CTA/contact", () => {
  const content = buildReviewIngestContentPayload(createBaseArgs({
    latestDraft: {
      confirmed_cta_contact_json: {
        phone: "0812345678",
        primary_cta: "phone",
      },
    },
    aiCtaContact: {
      phone: "0999999999",
      primary_cta: "line",
    },
    curatedCtaContact: {
      phone: { checked: true, value: "0888888888" },
    },
    fieldReturnPayload: {
      cta_return: {
        phone: { checked: true, found: true, value: "0777777777" },
      },
    },
  }));

  assert.equal(content.phone, "0812345678");
  assert.equal(content.primary_cta, "phone");
  assert.equal(content.line_url, undefined);
  assert.equal(content.facebook_url, undefined);
  assert.equal(content.website_url, undefined);
});
