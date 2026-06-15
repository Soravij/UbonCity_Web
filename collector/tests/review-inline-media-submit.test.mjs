import assert from "node:assert/strict";
import test from "node:test";

import {
  absolutizeCollectorMediaUrl,
  buildAdminReviewMultipartUploadPlan,
  mergeInlineMediaManifestFromBody,
  rewriteCollectorHtmlMediaUrls,
} from "../server/review-inline-media.mjs";

const BASE_URL = "https://collector-test.uboncity.com";

function buildAsset(overrides = {}) {
  return {
    asset_id: 101,
    id: 101,
    public_url: "/media/uploads/example.jpg",
    storage_disk: "local",
    storage_path: "uploads/example.jpg",
    mime_type: "image/jpeg",
    file_name: "example.jpg",
    ...overrides,
  };
}

function createInlineEntry(asset, position = 0) {
  const sourceUrl = absolutizeCollectorMediaUrl(asset.public_url, BASE_URL);
  return {
    source_url: sourceUrl,
    url: sourceUrl,
    role: "inline",
    selected: true,
    client_media_uid: `asset-${asset.asset_id}-${position}`,
    source_asset_id: Number(asset.asset_id || 0) || null,
    mime_type: asset.mime_type,
    original_file_name: asset.file_name,
    storage_disk: asset.storage_disk,
    storage_path: asset.storage_path,
  };
}

test("body img with collector upload URL becomes media_manifest.inline entry", () => {
  const bodyHtml = rewriteCollectorHtmlMediaUrls('<p><img src="https://collector-test.uboncity.com/uploads/example.jpg"></p>', BASE_URL);
  const result = mergeInlineMediaManifestFromBody({
    mediaManifest: { cover: null, gallery: [], inline: [] },
    bodyHtml,
    baseUrl: BASE_URL,
    allAssets: [buildAsset()],
    createInlineEntry,
  });

  assert.equal(result.mediaManifest.inline.length, 1);
  assert.equal(result.mediaManifest.inline[0].source_url, "https://collector-test.uboncity.com/media/uploads/example.jpg");
  assert.deepEqual(result.diagnostics.unresolved_collector_upload_urls, []);
});

test("body-only local image is included in multipart plan without selected_asset_mapping_missing", () => {
  const asset = buildAsset();
  const bodyHtml = rewriteCollectorHtmlMediaUrls('<p><img src="https://collector-test.uboncity.com/uploads/example.jpg"></p>', BASE_URL);
  const merged = mergeInlineMediaManifestFromBody({
    mediaManifest: { cover: null, gallery: [], inline: [] },
    bodyHtml,
    baseUrl: BASE_URL,
    allAssets: [asset],
    createInlineEntry,
  });

  const multipartPlan = buildAdminReviewMultipartUploadPlan({
    payload: {
      media_manifest: {
        cover: null,
        gallery: [],
        inline: merged.mediaManifest.inline,
      },
    },
    selectedAssets: [],
    allAssets: [asset],
    resolveStoragePath: (storagePath) => `D:/collector-media/${storagePath}`,
    fileExists: () => true,
  });

  assert.equal(multipartPlan.uploadPlan.length, 1);
  assert.equal(multipartPlan.uploadPlan[0].asset_id, 101);
  assert.equal(multipartPlan.uploadPlan[0].source_url, "https://collector-test.uboncity.com/media/uploads/example.jpg");
  assert.equal(multipartPlan.diagnostics[0].reason, null);
});

test("existing selected inline image is not duplicated", () => {
  const existingEntry = createInlineEntry(buildAsset(), 0);
  const bodyHtml = rewriteCollectorHtmlMediaUrls('<p><img src="/uploads/example.jpg"></p>', BASE_URL);
  const result = mergeInlineMediaManifestFromBody({
    mediaManifest: { cover: null, gallery: [], inline: [existingEntry] },
    bodyHtml,
    baseUrl: BASE_URL,
    allAssets: [buildAsset()],
    createInlineEntry,
  });

  assert.equal(result.mediaManifest.inline.length, 1);
  assert.deepEqual(result.diagnostics.unresolved_collector_upload_urls, []);
});

test("unresolved collector upload URL is reported for submit rejection", () => {
  const bodyHtml = rewriteCollectorHtmlMediaUrls('<p><img src="/uploads/missing.jpg"></p>', BASE_URL);
  const result = mergeInlineMediaManifestFromBody({
    mediaManifest: { cover: null, gallery: [], inline: [] },
    bodyHtml,
    baseUrl: BASE_URL,
    allAssets: [buildAsset()],
    createInlineEntry,
  });

  assert.equal(result.mediaManifest.inline.length, 0);
  assert.deepEqual(result.diagnostics.unresolved_collector_upload_urls, [
    "https://collector-test.uboncity.com/uploads/missing.jpg",
  ]);
});
