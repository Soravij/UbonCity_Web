import assert from "node:assert/strict";
import test from "node:test";

import { rewriteBodyMediaToBackendUrls } from "../services/reviewIngestService.js";

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
