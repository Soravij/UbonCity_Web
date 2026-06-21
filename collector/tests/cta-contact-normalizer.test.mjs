import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  deriveCtaContactCandidatesFromStructuredContext,
  getValidCtaSuggestedValue,
  mergeAiCtaWithDeterministicCandidates,
  normalizeAiCtaContactJson,
} from "../server/cta-contact-normalizer.mjs";
import { CTA_PHONE_CASES, CTA_URL_CASES } from "./cta-contact-parity-cases.mjs";

function createFixture() {
  return {
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Phone: 0659391488",
        provenance: {
          evidence_source_url: "https://www.wongnai.com/reviews/842964bb159942f887e7cc5244fda433",
        },
      },
      {
        context_type: "mention",
        selected_text: "Phone: 065 939 1488",
        provenance: {
          evidence_source_url: "https://maps.google.com/?cid=4182277082282715109",
        },
      },
      {
        context_type: "mention",
        selected_text: "Website: https://www.facebook.com/hippieroaster?locale=th_TH",
        provenance: {
          evidence_source_url: "https://www.facebook.com/hippieroaster/?locale=th_TH",
        },
      },
    ],
    evidence_blocks: [
      {
        block_type: "mention",
        text_value: "Phone: 0659391488",
        source_url: "https://www.wongnai.com/reviews/842964bb159942f887e7cc5244fda433",
      },
      {
        block_type: "mention",
        text_value: "Phone: 065 939 1488",
        source_url: "https://maps.google.com/?cid=4182277082282715109",
      },
      {
        block_type: "mention",
        text_value: "Website: https://www.facebook.com/hippieroaster?locale=th_TH",
        source_url: "https://www.facebook.com/hippieroaster/?locale=th_TH",
      },
    ],
  };
}

test("structured CTA candidate extraction is deterministic and rejects Google Maps CID false positives", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext(createFixture());
  assert.deepEqual(candidates, {
    phone: "0659391488",
    facebook_url: "https://www.facebook.com/hippieroaster/?locale=th_TH",
  });
  assert.equal(JSON.stringify(candidates).includes("4182277082"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(candidates, "website_url"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(candidates, "primary_cta"), false);
});

test("AI CTA normalization keeps only strict valid fields", () => {
  assert.deepEqual(normalizeAiCtaContactJson({
    phone: "4182277082",
    line_url: "https://line.me/ti/p/example",
    facebook_url: "https://maps.google.com/?cid=4182277082282715109",
    website_url: "https://www.wongnai.com/reviews/842964bb159942f887e7cc5244fda433",
    primary_cta: "facebook",
  }), {
    line_url: "https://line.me/ti/p/example",
  });
});

test("deterministic CTA candidates beat conflicting AI values for the same field", () => {
  const merged = mergeAiCtaWithDeterministicCandidates({
    phone: "0999999999",
    facebook_url: "https://www.facebook.com/another-page",
    primary_cta: "phone",
  }, createFixture());
  assert.deepEqual(merged, {
    phone: "0659391488",
    facebook_url: "https://www.facebook.com/hippieroaster/?locale=th_TH",
    primary_cta: "phone",
  });
});

test("generic provenance urls do not become CTA website_url without an explicit contact label", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Great coffee and view",
        provenance: {
          evidence_source_url: "https://example.com/offsite-reference",
        },
      },
    ],
    evidence_blocks: [
      {
        block_type: "mention",
        text_value: "rating 4.5",
        source_url: "https://example.com/reference-only",
      },
    ],
  });

  assert.deepEqual(candidates, {});
});

test("explicit labelled text URL beats unrelated provenance URL", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Website: https://official.example/contact",
        provenance: {
          evidence_source_url: "https://reference.example/article",
        },
      },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {
    website_url: "https://official.example/contact",
  });
});

test("list entries are parsed for contact URLs before hostname classification", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Contact links",
        selected_list: [
          "website=https://official.example",
          "facebook_url=https://facebook.com/example",
          "source_url=https://maps.google.com/?cid=4182277082282715109",
        ],
        provenance: {
          evidence_source_url: "https://reference.example/article",
        },
      },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {
    website_url: "https://official.example/",
    facebook_url: "https://facebook.com/example",
  });
});

test("phone normalization accepts only strict supported formats", () => {
  CTA_PHONE_CASES.accepted.forEach((value) => {
    assert.ok(getValidCtaSuggestedValue("phone", value), `expected accepted phone: ${value}`);
  });
  CTA_PHONE_CASES.rejected.forEach((value) => {
    assert.equal(getValidCtaSuggestedValue("phone", value), null, `expected rejected phone: ${value}`);
  });
});

test("CTA resolver helper validates suggested values by key", () => {
  assert.equal(getValidCtaSuggestedValue("phone", "065 939 1488"), "0659391488");
  assert.equal(getValidCtaSuggestedValue("phone", "4182277082"), null);
  assert.equal(getValidCtaSuggestedValue("facebook_url", "https://www.facebook.com/hippieroaster/?locale=th_TH"), "https://www.facebook.com/hippieroaster/?locale=th_TH");
  assert.equal(getValidCtaSuggestedValue("facebook_url", "https://maps.google.com/?cid=4182277082282715109"), null);
});

test("Thai contact labels are parsed as UTF-8 literals", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      { context_type: "mention", selected_text: "โทรศัพท์: 065 939 1488" },
      { context_type: "mention", selected_text: "เบอร์โทร: 065-939-1488" },
      { context_type: "mention", selected_text: "ติดต่อ: 045123456" },
    ],
    evidence_blocks: [],
  });

  assert.equal(candidates.phone, "0659391488");
  assert.equal(getValidCtaSuggestedValue("phone", "045123456"), "045123456");
});

test("multiple labelled phones continue after an invalid first match", () => {
  const englishCandidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Phone: 4182277082 | Phone: 0659391488",
      },
    ],
    evidence_blocks: [],
  });
  const thaiCandidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "โทร: 4182277082 | โทร: 0659391488",
      },
    ],
    evidence_blocks: [],
  });

  assert.equal(englishCandidates.phone, "0659391488");
  assert.equal(thaiCandidates.phone, "0659391488");
});

test("unlabelled editorial URLs do not become CTA candidates", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      { context_type: "mention", selected_text: "อ่านเพิ่มเติม https://blog.example/article" },
      { context_type: "mention", selected_text: "ดูข้อมูลที่ https://reference.example/story" },
      { context_type: "mention", selected_text: "รีวิว https://example.com/review" },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {});
});

test("selected_list only accepts explicitly keyed CTA URLs", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_list: [
          "https://blog.example/article",
          "review_url=https://example.com/review",
          "website=https://official.example",
          "facebook=https://facebook.com/example",
          "line_url=https://line.me/ti/p/example",
          "source_url=https://reference.example/story",
        ],
      },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {
    website_url: "https://official.example/",
    facebook_url: "https://facebook.com/example",
    line_url: "https://line.me/ti/p/example",
  });
});

test("Google Maps short and deep links never become website_url", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      { context_type: "mention", selected_text: "Website: https://maps.app.goo.gl/example" },
      { context_type: "mention", selected_text: "Website: https://goo.gl/maps/example" },
      { context_type: "mention", selected_text: "Website: https://g.page/example" },
      { context_type: "mention", selected_text: "Website: https://www.google.co.th/maps/place/example" },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {});
});

test("only labelled URLs are extracted when unrelated URLs appear in the same text row", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Facebook: https://facebook.com/foo อ่านเพิ่ม https://blog.example/article",
      },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {
    facebook_url: "https://facebook.com/foo",
  });
});

test("adjacent labelled URLs stay split without spaces", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Facebook:https://facebook.com/foo|Website:https://official.example",
      },
      {
        context_type: "mention",
        selected_text: "Facebook:https://facebook.com/foo,Website:https://official.example",
      },
      {
        context_type: "mention",
        selected_text: "Website:https://official.example;LINE:https://line.me/example",
      },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {
    facebook_url: "https://facebook.com/foo",
    website_url: "https://official.example/",
    line_url: "https://line.me/example",
  });
});

test("labelled URL after an unrelated URL wins over the unrelated URL", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "รีวิว https://blog.example/article Website: https://official.example",
      },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {
    website_url: "https://official.example/",
  });
});

test("multiple labelled URLs in one text row all survive extraction", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      {
        context_type: "mention",
        selected_text: "Facebook: https://facebook.com/foo | Website: https://official.example | LINE: https://line.me/example",
      },
    ],
    evidence_blocks: [],
  });

  assert.deepEqual(candidates, {
    facebook_url: "https://facebook.com/foo",
    website_url: "https://official.example/",
    line_url: "https://line.me/example",
  });
});

test("trailing sentence punctuation is removed from labelled URLs before normalization", () => {
  const candidates = deriveCtaContactCandidatesFromStructuredContext({
    approved_context: [
      { context_type: "mention", selected_text: "Website: https://official.example," },
      { context_type: "mention", selected_text: "Website: https://official.example." },
      { context_type: "mention", selected_text: "Website: https://official.example;" },
      { context_type: "mention", selected_text: "Facebook: https://facebook.com/foo," },
      { context_type: "mention", selected_text: "เว็บไซต์: https://official.exampleฯ" },
      { context_type: "mention", selected_text: "Facebook: https://facebook.com/bar, Website: https://official-two.example;" },
    ],
    evidence_blocks: [],
  });

  assert.equal(candidates.website_url, "https://official.example/");
  assert.equal(candidates.facebook_url, "https://facebook.com/foo");
});

test("server accepted and rejected CTA corpus stays aligned", () => {
  CTA_PHONE_CASES.accepted.forEach((value) => {
    assert.ok(getValidCtaSuggestedValue("phone", value), `server should accept phone ${value}`);
  });
  CTA_PHONE_CASES.rejected.forEach((value) => {
    assert.equal(getValidCtaSuggestedValue("phone", value), null, `server should reject phone ${value}`);
  });
  CTA_URL_CASES.forEach(({ label, type, input, expected }) => {
    const key = type === "website" ? "website_url" : `${type}_url`;
    const actual = getValidCtaSuggestedValue(key, input) || "";
    assert.equal(actual, expected, `server parity mismatch for ${label}`);
  });
});

test("cta-contact-normalizer source file contains real Thai literals and no mojibake fragments", () => {
  const source = fs.readFileSync(path.resolve("collector/server/cta-contact-normalizer.mjs"), "utf8");
  [
    "โทร:",
    "โทรศัพท์:",
    "เบอร์โทร:",
    "เบอร์โทรศัพท์:",
    "ติดต่อ:",
    "เว็บไซต์:",
    "เว็บ:",
    "เพจ:",
    "เฟซบุ๊ก:",
    "ไลน์:",
    "ลิงก์ติดต่อ:",
  ].forEach((literal) => {
    assert.match(source, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
  [
    "Ã Â¹â€šÃ Â¸â€”Ã Â¸Â£",
    "Ã Â¹â‚¬Ã Â¸Å¡Ã Â¸Â­Ã Â¸Â£Ã Â¹Å’",
    "Ã Â¸â€¢Ã Â¸Â´Ã Â¸â€Ã Â¸â€¢Ã Â¹Ë†Ã Â¸Â­",
    "Ã¯Â¼Å¡",
  ].forEach((fragment) => {
    assert.equal(source.includes(fragment), false, `unexpected mojibake fragment: ${fragment}`);
  });
});
