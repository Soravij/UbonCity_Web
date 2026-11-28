import assert from "node:assert/strict";
import test from "node:test";

import {
  unwrapGoogleRedirectUrl,
  unwrapManualRowUrls,
  extractStaticMapCenter,
  cleanGoogleMapsPlaceTitle,
} from "../collector/sources/adapters/manual.mjs";

test("unwraps a Google /url redirect with a q param", () => {
  const input =
    "https://www.google.com/url?opi=89978449&q=https://www.facebook.com/p/Bigbang-Gallery-and-Cafe-61572082006157/&sa=U&usg=x";
  assert.equal(
    unwrapGoogleRedirectUrl(input),
    "https://www.facebook.com/p/Bigbang-Gallery-and-Cafe-61572082006157/"
  );
});

test("unwraps a Google /url redirect with a url param on a country TLD", () => {
  const input = "https://www.google.co.th/url?url=https://example.com/a";
  assert.equal(unwrapGoogleRedirectUrl(input), "https://example.com/a");
});

test("leaves a non-redirect Google Maps link unchanged", () => {
  const input = "https://www.google.com/maps/place/X";
  assert.equal(unwrapGoogleRedirectUrl(input), input);
});

test("leaves a /url redirect with a non-URL q param unchanged", () => {
  const input = "https://www.google.com/url?q=hello";
  assert.equal(unwrapGoogleRedirectUrl(input), input);
});

test("leaves a /url redirect with a javascript: target unchanged", () => {
  const input = "https://www.google.com/url?q=javascript:alert(1)";
  assert.equal(unwrapGoogleRedirectUrl(input), input);
});

test("leaves non-URL input unchanged", () => {
  const input = "ไม่ใช่ url";
  assert.equal(unwrapGoogleRedirectUrl(input), input);
});

test("unwrapManualRowUrls unwraps source_url and website_url, keeps other fields", () => {
  const redirect =
    "https://www.google.com/url?opi=89978449&q=https://www.facebook.com/p/Bigbang-Gallery-and-Cafe-61572082006157/&sa=U&usg=x";
  const target = "https://www.facebook.com/p/Bigbang-Gallery-and-Cafe-61572082006157/";
  const result = unwrapManualRowUrls({ source_url: redirect, website_url: redirect, title: "x" });
  assert.equal(result.source_url, target);
  assert.equal(result.website_url, target);
  assert.equal(result.title, "x");
});

test("unwrapManualRowUrls is a no-op when no url-like keys are present", () => {
  const result = unwrapManualRowUrls({ title: "x" });
  assert.deepEqual(result, { title: "x" });
});

test("extractStaticMapCenter parses center from an HTML-entity-encoded staticmap URL", () => {
  const input = "https://maps.google.com/maps/api/staticmap?center=15.28933565%2C104.88050065&amp;zoom=15";
  assert.deepEqual(extractStaticMapCenter(input), { lat: 15.28933565, lng: 104.88050065 });
});

test("extractStaticMapCenter rejects a non-Google host", () => {
  const input = "https://example.com/maps/api/staticmap?center=15.2%2C104.8";
  assert.equal(extractStaticMapCenter(input), null);
});

test("extractStaticMapCenter returns null when center param is missing", () => {
  const input = "https://maps.google.com/maps/api/staticmap?zoom=15";
  assert.equal(extractStaticMapCenter(input), null);
});

test("extractStaticMapCenter rejects a 0,0 center", () => {
  const input = "https://maps.google.com/maps/api/staticmap?center=0%2C0";
  assert.equal(extractStaticMapCenter(input), null);
});

test("cleanGoogleMapsPlaceTitle strips a leading plus-code and keeps only the place name", () => {
  const input = "7VRH+5P Chamrus Home Cafe, Rai Noi, Mueang Ubon Ratchathani District, Ubon Ratchathani 34000";
  assert.equal(cleanGoogleMapsPlaceTitle(input), "Chamrus Home Cafe");
});

test("cleanGoogleMapsPlaceTitle leaves a normal title unchanged", () => {
  const input = "ข้าวหอมบ้านปุณณ์ - Khao Hom, Ubon";
  assert.equal(cleanGoogleMapsPlaceTitle(input), input);
});

test("cleanGoogleMapsPlaceTitle leaves a plus-code-free title unchanged", () => {
  const input = "Chamrus Home Cafe";
  assert.equal(cleanGoogleMapsPlaceTitle(input), input);
});
