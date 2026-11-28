import assert from "node:assert/strict";
import test from "node:test";

import { unwrapGoogleRedirectUrl } from "../collector/sources/adapters/manual.mjs";

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
