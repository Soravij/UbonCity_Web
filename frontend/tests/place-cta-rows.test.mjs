import test from "node:test";
import assert from "node:assert/strict";
import { buildPlaceCtaRows } from "../lib/place-cta.mjs";

const detailCopy = {
  ctaMap: "Open Map",
  ctaPhone: "Call",
  ctaLine: "Open LINE",
  ctaFacebook: "Facebook Page",
  ctaWebsite: "Visit Website",
};

test("shows every populated channel in fixed order: map, phone, LINE, Facebook, website", () => {
  const rows = buildPlaceCtaRows(
    {
      map_url: "https://maps.google.com/example",
      phone: "0812345678",
      line_url: "https://line.me/example",
      facebook_url: "https://facebook.com/example",
      website_url: "https://example.com",
    },
    detailCopy
  );

  assert.deepEqual(rows.map((row) => row.key), ["map", "phone", "line", "facebook", "website"]);
});

test("omits channels with no data instead of showing an empty row", () => {
  const rows = buildPlaceCtaRows(
    {
      map_url: "https://maps.google.com/example",
      facebook_url: "https://facebook.com/example",
    },
    detailCopy
  );

  assert.deepEqual(rows.map((row) => row.key), ["map", "facebook"]);
});

test("Facebook row uses FACEBOOK_CLICK as its event type", () => {
  const rows = buildPlaceCtaRows({ facebook_url: "https://facebook.com/example" }, detailCopy);
  const facebookRow = rows.find((row) => row.key === "facebook");

  assert.equal(facebookRow.eventType, "FACEBOOK_CLICK");
  assert.equal(facebookRow.href, "https://facebook.com/example");
});

test("Website row uses WEBSITE_CLICK as its event type", () => {
  const rows = buildPlaceCtaRows({ website_url: "https://example.com" }, detailCopy);
  const websiteRow = rows.find((row) => row.key === "website");

  assert.equal(websiteRow.eventType, "WEBSITE_CLICK");
  assert.equal(websiteRow.href, "https://example.com");
});

test("a Facebook-only place (no map/phone/line) still renders a CTA row", () => {
  const rows = buildPlaceCtaRows({ facebook_url: "https://facebook.com/123-histoire-de-caf" }, detailCopy);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "facebook");
});

test("no rows are produced when the place has no CTA data at all", () => {
  const rows = buildPlaceCtaRows({}, detailCopy);
  assert.deepEqual(rows, []);
});
