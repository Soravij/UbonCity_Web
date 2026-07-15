import test from "node:test";
import assert from "node:assert/strict";

import { buildApproveWarnings } from "../services/reviewDecisionService.js";

test("CTA_EMPTY does not fire when only facebook_url is present", () => {
  const warnings = buildApproveWarnings({
    map_url: null,
    phone: null,
    transport_contact_phone: null,
    line_url: null,
    facebook_url: "https://facebook.com/example",
    website_url: null,
  });

  assert.equal(warnings.some((warning) => warning.code === "CTA_EMPTY"), false);
});

test("CTA_EMPTY does not fire when only website_url is present", () => {
  const warnings = buildApproveWarnings({
    map_url: null,
    phone: null,
    transport_contact_phone: null,
    line_url: null,
    facebook_url: null,
    website_url: "https://example.com",
  });

  assert.equal(warnings.some((warning) => warning.code === "CTA_EMPTY"), false);
});

test("CTA_EMPTY fires when map, phone, line, facebook, and website are all empty", () => {
  const warnings = buildApproveWarnings({
    map_url: null,
    phone: null,
    transport_contact_phone: null,
    line_url: null,
    facebook_url: null,
    website_url: null,
  });

  assert.equal(warnings.some((warning) => warning.code === "CTA_EMPTY"), true);
});

test("no PRIMARY_CTA_* warning is ever produced, even for a legacy primary_cta value", () => {
  const warnings = buildApproveWarnings({
    map_url: null,
    phone: null,
    transport_contact_phone: null,
    line_url: null,
    facebook_url: "https://facebook.com/example",
    website_url: null,
    primary_cta: "not-a-real-value",
  });

  assert.equal(warnings.some((warning) => String(warning.code || "").startsWith("PRIMARY_CTA")), false);
});
