import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApprovalContentPreviewModel,
  buildApprovalsReviewIngestPayload,
  primaryCtaLabelTh,
  valueOrFallbackTh,
} from "../src/pages/approvalsPreview.js";

test("approval preview model builds read-only article sections with Thai CTA labels and fallbacks", () => {
  const preview = buildApprovalContentPreviewModel({
    review_id: 42,
    title: "ร้านกาแฟริมโขง",
    description: "<p>บอดี้บทความ</p>",
    excerpt: "สรุปย่อ",
    slug: "mekong-cafe",
    meta_title: "ชื่อ SEO",
    meta_description: "คำอธิบาย SEO",
    effective_cover_image: "https://img.example/cover.jpg",
    media_gallery_images: ["https://img.example/gallery-1.jpg"],
    primary_cta: "line",
    phone: "0812345678",
    line_url: "https://line.me/ti/p/test",
    facebook_url: "",
    website_url: null,
  });

  assert.equal(preview.article.title, "ร้านกาแฟริมโขง");
  assert.equal(preview.article.excerpt, "สรุปย่อ");
  assert.equal(preview.article.slug, "mekong-cafe");
  assert.equal(preview.seo[0].label, "ชื่อ SEO");
  assert.equal(preview.seo[0].value, "ชื่อ SEO");
  assert.equal(preview.cta[0].label, "ปุ่ม CTA หลัก");
  assert.equal(preview.cta[0].value, "LINE");
  assert.equal(preview.cta[2].label, "ลิงก์ LINE");
  assert.equal(preview.cta[4].value, "ยังไม่ได้ระบุ");
  assert.equal(preview.media.coverUrl, "https://img.example/cover.jpg");
  assert.deepEqual(preview.media.galleryUrls, ["https://img.example/gallery-1.jpg"]);
  assert.equal(preview.hasEditableContentInputs, false);
});

test("approval preview helpers normalize empty CTA values safely", () => {
  assert.equal(primaryCtaLabelTh("map"), "แผนที่");
  assert.equal(primaryCtaLabelTh("phone"), "โทร");
  assert.equal(primaryCtaLabelTh("line"), "LINE");
  assert.equal(primaryCtaLabelTh(""), "ยังไม่ได้ระบุ");
  assert.equal(valueOrFallbackTh(""), "ยังไม่ได้ระบุ");
  assert.equal(valueOrFallbackTh("  "), "ยังไม่ได้ระบุ");
  assert.equal(valueOrFallbackTh("มีข้อมูล"), "มีข้อมูล");
});

test("approval preview body sanitizes stored html and neutralizes executable markup", () => {
  const preview = buildApprovalContentPreviewModel({
    description: '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>\n\nย่อหน้าปกติ',
  });

  assert.doesNotMatch(preview.article.bodyHtml, /<script/i);
  assert.doesNotMatch(preview.article.bodyHtml, /onerror=/i);
  assert.doesNotMatch(preview.article.bodyHtml, /javascript:/i);
  assert.match(preview.article.bodyHtml, /ย่อหน้าปกติ/);
});

test("admin review ingest payload remains display-only and excludes CTA fields for place and event", () => {
  const placePayload = buildApprovalsReviewIngestPayload({
    source_content_type: "place",
    source_content_item_id: 11,
    source_lang: "th",
    category: "cafes",
    article_snapshot: {
      source_base_url: "http://collector.local",
      title: "ร้านกาแฟ",
      description: "body",
      phone: "0812345678",
      line_url: "https://line.me/ti/p/test",
      facebook_url: "https://facebook.com/test",
      website_url: "https://example.com",
      primary_cta: "line",
    },
  });
  const eventPayload = buildApprovalsReviewIngestPayload({
    source_content_type: "event",
    source_content_item_id: 12,
    source_lang: "th",
    article_snapshot: {
      source_base_url: "http://collector.local",
      title: "งานอีเวนต์",
      description: "body",
      phone: "0899999999",
      primary_cta: "phone",
    },
  });

  for (const payload of [placePayload, eventPayload]) {
    assert.ok(payload?.content);
    assert.equal(Object.hasOwn(payload.content, "phone"), false);
    assert.equal(Object.hasOwn(payload.content, "line_url"), false);
    assert.equal(Object.hasOwn(payload.content, "facebook_url"), false);
    assert.equal(Object.hasOwn(payload.content, "website_url"), false);
    assert.equal(Object.hasOwn(payload.content, "primary_cta"), false);
  }
});
