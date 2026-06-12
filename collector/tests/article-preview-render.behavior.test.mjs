import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  buildArticlePreviewHtml,
  buildRuntimeArticlePreviewModel,
  primaryCtaLabelTh,
} from "../server/public/article-preview-render.js";

test("article preview render includes article, SEO, media, and CTA sections without edit inputs", () => {
  const html = buildArticlePreviewHtml({
    title: "ร้านกาแฟริมโขง",
    excerpt: "สรุปย่อ",
    bodyHtml: "<p>บอดี้บทความ</p>",
    slug: "mekong-cafe",
    hero: "https://img.example/cover.jpg",
    galleryAssets: ["https://img.example/gallery-1.jpg"],
    metaTitle: "ชื่อ SEO",
    metaDescription: "คำอธิบาย SEO",
    ctaContact: {
      primary_cta: "phone",
      phone: "0812345678",
      line_url: "",
      facebook_url: "https://facebook.com/test",
      website_url: null,
    },
  });

  assert.match(html, /เนื้อหาบทความ/);
  assert.match(html, /SEO/);
  assert.match(html, /CTA \/ ช่องทางติดต่อ/);
  assert.match(html, /รูปภาพ \/ สื่อ/);
  assert.match(html, /ชื่อ SEO/);
  assert.match(html, /คำอธิบาย SEO/);
  assert.match(html, /โทร/);
  assert.match(html, /0812345678/);
  assert.match(html, /ยังไม่ได้ระบุ/);
  assert.doesNotMatch(html, /<input/i);
  assert.doesNotMatch(html, /<textarea/i);
});

test("article preview CTA label helper maps supported values to Thai labels", () => {
  assert.equal(primaryCtaLabelTh("map"), "แผนที่");
  assert.equal(primaryCtaLabelTh("phone"), "โทร");
  assert.equal(primaryCtaLabelTh("line"), "LINE");
  assert.equal(primaryCtaLabelTh("other"), "ยังไม่ได้ระบุ");
});

test("collector runtime imports the shared article preview render helper", () => {
  const source = fs.readFileSync(path.resolve("D:/UbonCity_Web/collector/server/public/article-workflow-core.js"), "utf8");
  assert.match(source, /from "\.\/article-preview-render\.js"/);
  assert.doesNotMatch(source, /function buildArticlePreviewHtmlLocal/);
});

test("runtime preview model preserves other-transport metadata and place CTA separately", () => {
  const otherTransportPreview = buildRuntimeArticlePreviewModel({
    title: "รถรับส่งสนามบิน",
    excerpt: "",
    slug: "",
    hero: "",
    galleryAssets: [],
    metaTitle: "",
    metaDescription: "",
    bodyHtml: "<p>body</p>",
    isOtherTransport: true,
    otherTransportMeta: {
      subtype: "taxi",
      contact_name: "สมชาย",
      phone: "0811111111",
      link_url: "https://example.com/taxi",
      contact_details: "โทรหรือแอดไลน์",
    },
    ctaContact: {
      primary_cta: "line",
      phone: "",
      line_url: "",
      facebook_url: "",
      website_url: "",
    },
  });
  const placePreview = buildRuntimeArticlePreviewModel({
    title: "คาเฟ่",
    excerpt: "",
    slug: "",
    hero: "",
    galleryAssets: [],
    metaTitle: "",
    metaDescription: "",
    bodyHtml: "<p>body</p>",
    isOtherTransport: false,
    otherTransportMeta: {},
    ctaContact: {
      primary_cta: "line",
      phone: "0812345678",
      line_url: "https://line.me/ti/p/test",
      facebook_url: "",
      website_url: "",
    },
  });

  assert.match(otherTransportPreview, /รถรับส่งสนามบิน/);
  assert.match(otherTransportPreview, /Taxi/);
  assert.match(otherTransportPreview, /สมชาย/);
  assert.match(otherTransportPreview, /https:\/\/example\.com\/taxi/);
  assert.doesNotMatch(otherTransportPreview, /ลิงก์ LINE/);

  assert.match(placePreview, /คาเฟ่/);
  assert.match(placePreview, /ลิงก์ LINE/);
  assert.match(placePreview, /0812345678/);
});
