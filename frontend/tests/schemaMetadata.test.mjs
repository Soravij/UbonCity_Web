import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildAbsoluteUrl,
  buildBreadcrumbJsonLd,
  buildEventJsonLd,
  buildPlaceJsonLd,
  buildRobotsMetadata,
  buildSeoMetadata,
  buildWebPageJsonLd,
  isIndexingEnabled,
  pickPrimaryImage,
  stripHtmlToPlainText,
} from "../lib/schemaMetadata.js";

test("stripHtmlToPlainText removes tags and collapses whitespace", () => {
  const text = stripHtmlToPlainText("<p>Hello <strong>world</strong></p><p>next</p>");
  assert.equal(text, "Hello world next");
});

test("pickPrimaryImage prefers effective cover then fallback image then gallery", () => {
  assert.equal(
    pickPrimaryImage({
      effective_cover_image: "https://cdn.example.com/cover.jpg",
      image: "https://cdn.example.com/image.jpg",
      media_gallery_images: ["https://cdn.example.com/gallery.jpg"],
    }),
    "https://cdn.example.com/cover.jpg"
  );
  assert.equal(
    pickPrimaryImage({
      image: "https://cdn.example.com/image.jpg",
      media_gallery_images: ["https://cdn.example.com/gallery.jpg"],
    }),
    "https://cdn.example.com/image.jpg"
  );
  assert.equal(
    pickPrimaryImage({
      media_gallery_images: ["https://cdn.example.com/gallery.jpg"],
    }),
    "https://cdn.example.com/gallery.jpg"
  );
});

test("buildAbsoluteUrl uses configured site url and preserves absolute urls", () => {
  assert.equal(
    buildAbsoluteUrl("/th/attractions/test", "https://ubon.example.com"),
    "https://ubon.example.com/th/attractions/test"
  );
  assert.equal(
    buildAbsoluteUrl("https://cdn.example.com/image.jpg", "https://ubon.example.com"),
    "https://cdn.example.com/image.jpg"
  );
});

test("buildSeoMetadata adds canonical openGraph twitter with safe fallbacks", () => {
  const metadata = buildSeoMetadata({
    title: "Test Title",
    description: "<p>Test description</p>",
    canonicalPath: "/th/attractions/test-title",
    lang: "th",
    siteUrl: "https://ubon.example.com",
    image: "https://cdn.example.com/cover.jpg",
  });

  assert.equal(metadata.title, "Test Title | UBONCITY.COM");
  assert.equal(metadata.description, "Test description");
  assert.equal(metadata.alternates.canonical, "/th/attractions/test-title");
  assert.equal(metadata.openGraph.title, "Test Title");
  assert.equal(metadata.openGraph.url, "https://ubon.example.com/th/attractions/test-title");
  assert.equal(metadata.openGraph.siteName, "UBONCITY.COM");
  assert.equal(metadata.openGraph.locale, "th_TH");
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.deepEqual(metadata.openGraph.images, [{ url: "https://cdn.example.com/cover.jpg" }]);
  assert.deepEqual(metadata.twitter.images, ["https://cdn.example.com/cover.jpg"]);
});

test("buildRobotsMetadata returns noindex when NEXT_PUBLIC_INDEXING is false", () => {
  const previous = process.env.NEXT_PUBLIC_INDEXING;
  process.env.NEXT_PUBLIC_INDEXING = "false";

  try {
    assert.equal(isIndexingEnabled(), false);
    assert.deepEqual(buildRobotsMetadata(), {
      index: false,
      follow: false,
    });
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_INDEXING;
    } else {
      process.env.NEXT_PUBLIC_INDEXING = previous;
    }
  }
});

test("buildRobotsMetadata does not force noindex by default or when true", () => {
  const previous = process.env.NEXT_PUBLIC_INDEXING;

  try {
    delete process.env.NEXT_PUBLIC_INDEXING;
    assert.equal(isIndexingEnabled(), true);
    assert.equal(buildRobotsMetadata(), undefined);

    process.env.NEXT_PUBLIC_INDEXING = "true";
    assert.equal(isIndexingEnabled(), true);
    assert.equal(buildRobotsMetadata(), undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_INDEXING;
    } else {
      process.env.NEXT_PUBLIC_INDEXING = previous;
    }
  }
});

test("schema entity name prefers real title before meta_title", () => {
  const placeJsonLd = buildPlaceJsonLd({
    place: {
      title: "Real Place Name",
      meta_title: "SEO Place Title",
    },
    category: "attractions",
    canonicalUrl: "https://ubon.example.com/th/attractions/real-place-name",
  });
  const eventJsonLd = buildEventJsonLd({
    event: {
      title: "Real Event Name",
      meta_title: "SEO Event Title",
      event_start_at: "2026-01-01T10:00:00+07:00",
      event_end_at: "2026-01-01T12:00:00+07:00",
    },
    canonicalUrl: "https://ubon.example.com/th/events/99",
  });

  assert.equal(placeJsonLd.name, "Real Place Name");
  assert.equal(eventJsonLd.name, "Real Event Name");
});

test("buildPlaceJsonLd emits conservative type and omits empty values", () => {
  const jsonLd = buildPlaceJsonLd({
    place: {
      title: "Wat Test",
      description: "<p>Temple detail</p>",
      map_url: "https://maps.example.com/wat",
      phone: "0123",
      latitude: 15.1,
      longitude: 104.8,
      line_url: "https://line.me/test",
      effective_cover_image: "https://cdn.example.com/wat.jpg",
    },
    category: "attractions",
    canonicalUrl: "https://ubon.example.com/th/attractions/wat-test",
  });

  assert.equal(jsonLd["@type"], "TouristAttraction");
  assert.equal(jsonLd.name, "Wat Test");
  assert.equal(jsonLd.description, "Temple detail");
  assert.equal(jsonLd.hasMap, "https://maps.example.com/wat");
  assert.equal(jsonLd.telephone, "0123");
  assert.deepEqual(jsonLd.geo, {
    "@type": "GeoCoordinates",
    latitude: 15.1,
    longitude: 104.8,
  });
  assert.deepEqual(jsonLd.sameAs, ["https://line.me/test"]);
  assert.ok(!("address" in jsonLd));
  assert.ok(!("openingHours" in jsonLd));
});

test("buildEventJsonLd returns null without structured event dates", () => {
  const jsonLd = buildEventJsonLd({
    event: {
      title: "Festival",
      event_period_text: "1-3 Jan",
    },
    canonicalUrl: "https://ubon.example.com/th/events/1",
  });
  assert.equal(jsonLd, null);
});

test("web page and breadcrumb helpers omit undefined values", () => {
  const page = buildWebPageJsonLd({
    title: "Sample",
    description: "",
    canonicalUrl: "https://ubon.example.com/th/sample",
  });
  const breadcrumb = buildBreadcrumbJsonLd([
    { name: "Home", url: "https://ubon.example.com/th" },
    { name: "Sample", url: "https://ubon.example.com/th/sample" },
  ]);

  assert.equal(page["@type"], "WebPage");
  assert.ok(!("description" in page));
  assert.equal(breadcrumb["@type"], "BreadcrumbList");
  assert.equal(breadcrumb.itemListElement.length, 2);
});

test("place page source wires seo metadata and json-ld helper", () => {
  const source = fs.readFileSync(path.resolve("app/[lang]/[category]/[slug]/page.js"), "utf8");
  assert.match(source, /buildSeoMetadata/);
  assert.match(source, /buildRobotsMetadata/);
  assert.match(source, /buildPlaceJsonLd/);
  assert.match(source, /buildBreadcrumbJsonLd/);
  assert.match(source, /buildWebPageJsonLd/);
});

test("event page source wires seo metadata and avoids unconditional event json-ld", () => {
  const source = fs.readFileSync(path.resolve("app/[lang]/events/[id]/page.js"), "utf8");
  assert.match(source, /buildSeoMetadata/);
  assert.match(source, /buildRobotsMetadata/);
  assert.match(source, /buildBreadcrumbJsonLd/);
  assert.match(source, /buildWebPageJsonLd/);
  assert.match(source, /buildEventJsonLd/);
  assert.match(source, /if \(!eventJsonLd\)/);
});

test("review page source exports robots noindex metadata", () => {
  const source = fs.readFileSync(path.resolve("app/[lang]/review/[id]/page.js"), "utf8");
  assert.match(source, /export const metadata =/);
  assert.match(source, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false,?\s*\}/s);
});
