import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { serializePublicPlaceResponse } from "../controllers/placeController.js";
import { serializePublicEventResponse } from "../controllers/eventController.js";

const backendRoot = path.resolve(import.meta.dirname, "..");
const placeControllerSource = fs.readFileSync(path.join(backendRoot, "controllers", "placeController.js"), "utf8");
const eventControllerSource = fs.readFileSync(path.join(backendRoot, "controllers", "eventController.js"), "utf8");

const INTERNAL_PUBLIC_EXCLUSIONS = [
  "req_description",
  "th_description",
  "is_approved",
  "tracking_entity_type",
  "tracking_entity_id",
  "media_cover_image",
  "media_inline_images",
];

function makeResponseRow() {
  return {
    id: 42,
    category: "cafes",
    slug: "public-title",
    title: "Public title",
    meta_title: "Public meta title",
    meta_description: "Public meta description",
    latitude: 15.2,
    longitude: 104.8,
    map_url: "https://maps.example/42",
    google_place_id: "place-42",
    transport_contact_phone: "0812345678",
    effective_cover_image: "https://media.example/cover.jpg",
    effective_thumbnail_image: "https://media.example/thumb.jpg",
    media_gallery_images: ["https://media.example/gallery.jpg"],
    image: "https://media.example/legacy.jpg",
    decision_scenario_tags_list: ["family"],
    approved_at: "2026-01-01T00:00:00.000Z",
    event_period_text: "January",
    location_text: "Ubon",
    distance_km: 4.2,
    req_description: "request-only",
    th_description: "thai-only",
    is_approved: 1,
    tracking_entity_type: "place",
    tracking_entity_id: 42,
    media_cover_image: "https://media.example/internal-cover.jpg",
    media_inline_images: ["https://media.example/inline.jpg"],
  };
}

for (const [name, serializer] of [
  ["place", serializePublicPlaceResponse],
  ["event", serializePublicEventResponse],
]) {
  test(`${name} public DTO excludes internal fields and retains public render fields`, () => {
    const original = makeResponseRow();
    const result = serializer(original);

    for (const key of INTERNAL_PUBLIC_EXCLUSIONS) assert.equal(key in result, false, `${name}: ${key}`);
    for (const key of [
      "meta_title", "meta_description", "latitude", "longitude", "map_url", "google_place_id",
      "transport_contact_phone", "effective_cover_image", "effective_thumbnail_image", "media_gallery_images",
      "image", "decision_scenario_tags_list", "approved_at", "event_period_text", "location_text",
    ]) assert.equal(key in result, true, `${name}: retained ${key}`);
    assert.equal(original.media_cover_image, "https://media.example/internal-cover.jpg");
  });
}

test("privileged include_unapproved paths retain the normalized admin response", () => {
  assert.match(placeControllerSource, /return includeUnapproved \? normalized : serializePublicPlaceResponse\(normalized\);/);
  assert.match(placeControllerSource, /item: includeUnapproved \? item : serializePublicPlaceResponse\(item\)/);
  assert.match(placeControllerSource, /if \(!includeUnapproved\) \{\s*delete item\.req_description;\s*delete item\.th_description;\s*\}/);
  assert.match(eventControllerSource, /return includeUnapproved \? normalized : serializePublicEventResponse\(normalized\);/);
  assert.match(eventControllerSource, /item: includeUnapproved \? item : serializePublicEventResponse\(item\)/);
});

test("nearby candidates always use the public place DTO and retain card fields", () => {
  assert.match(
    placeControllerSource,
    /const items = rows\.map\(\(row\) =>\s*serializePublicPlaceResponse\(\s*normalizePlaceForResponse\(/,
  );

  const result = serializePublicPlaceResponse(makeResponseRow());
  for (const key of ["category", "slug", "title", "distance_km", "effective_cover_image", "effective_thumbnail_image", "image", "decision_scenario_tags_list"]) {
    assert.equal(key in result, true, `nearby retained ${key}`);
  }
  for (const key of INTERNAL_PUBLIC_EXCLUSIONS) assert.equal(key in result, false, `nearby excluded ${key}`);
});
