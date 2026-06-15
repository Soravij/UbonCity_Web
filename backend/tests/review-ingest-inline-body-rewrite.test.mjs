import assert from "node:assert/strict";
import test from "node:test";

import { rewriteBodyMediaToBackendUrls } from "../services/reviewIngestService.js";
import { shapePublicReviewContent } from "../services/reviewContentService.js";

test("media_manifest inline rows rewrite stored body away from collector upload URLs", () => {
  const html = '<p><img src="https://collector-test.uboncity.com/uploads/example.jpg" alt="example"></p>';
  const mirroredRows = [
    {
      source_url: "https://collector-test.uboncity.com/media/uploads/example.jpg",
      resolved_source_url: "https://collector-test.uboncity.com/media/uploads/example.jpg",
      backend_url: "https://backend-test.uboncity.com/uploads/review-example.jpg",
      source_asset_id: 77,
      client_media_uid: "asset-77-0",
    },
  ];

  const rewritten = rewriteBodyMediaToBackendUrls(
    html,
    mirroredRows,
    "https://collector-test.uboncity.com"
  );

  assert.match(rewritten, /backend-test\.uboncity\.com\/uploads\/review-example\.jpg/);
  assert.doesNotMatch(rewritten, /collector-test\.uboncity\.com/);
  assert.doesNotMatch(rewritten, /\/uploads\/example\.jpg/);
});

test("public review shaping strips collector source metadata and collector URLs from serialized payload", () => {
  const shaped = shapePublicReviewContent({
    id: 77,
    body: '<p><img src="https://collector-test.uboncity.com/media/uploads/example.jpg" alt="example"></p>',
    description: '<p><img src="https://collector-test.uboncity.com/media/uploads/example.jpg" alt="example"></p>',
    image: "https://backend-test.uboncity.com/uploads/review-example.jpg",
    effective_cover_image: "https://backend-test.uboncity.com/uploads/review-example.jpg",
    assets: {
      cover: null,
      gallery: [],
      inline: [
        {
          url: "https://backend-test.uboncity.com/uploads/review-example.jpg",
          source_url: "https://collector-test.uboncity.com/media/uploads/example.jpg",
          storage_path: "uploads/review-example.jpg",
          file_name: "review-example.jpg",
          mime_type: "image/jpeg",
          size_bytes: 123,
        },
      ],
    },
    review_payload: {
      content: { body: "x" },
      media_manifest: {
        inline: [{ source_url: "https://collector-test.uboncity.com/media/uploads/example.jpg" }],
      },
    },
    history: [
      {
        payload_snapshot: {
          media_manifest: {
            inline: [{ source_url: "https://collector-test.uboncity.com/media/uploads/example.jpg" }],
          },
        },
      },
    ],
  });

  const serialized = JSON.stringify(shaped);
  assert.match(shaped.body, /backend-test\.uboncity\.com\/uploads\/review-example\.jpg/);
  assert.equal(shaped.assets.inline[0].url, "https://backend-test.uboncity.com/uploads/review-example.jpg");
  assert.equal("source_url" in shaped.assets.inline[0], false);
  assert.equal(shaped.review_payload, undefined);
  assert.equal(shaped.history, undefined);
  assert.doesNotMatch(serialized, /collector-test\.uboncity\.com/);
  assert.doesNotMatch(serialized, /\/media\/uploads\//);
});
