import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(import.meta.dirname, "..");
const controllerSource = fs.readFileSync(path.join(backendRoot, "controllers", "lifecycleController.js"), "utf8");
const migrationSource = fs.readFileSync(path.join(backendRoot, "migrations", "017_lifecycle_release_imports.sql"), "utf8");

test("lifecycle import requires a release snapshot identity for every published item", () => {
  assert.match(controllerSource, /published\[\$\{index\}\]\.release_id must be a UUID/);
  assert.match(controllerSource, /published\[\$\{index\}\]\.manifest_hash must be a SHA-256 hex digest/);
  assert.match(controllerSource, /release_id: releaseId/);
  assert.match(controllerSource, /manifest_hash: manifestHash/);
});

test("lifecycle import derives the cover from the manifest and accepts the projected payload shape", () => {
  assert.match(controllerSource, /const coverImageFromManifest = String\(mediaManifest\?\.cover\?\.source_url \|\| ""\)\.trim\(\);/);
  assert.match(controllerSource, /image: coverImageFromManifest \|\| null,/);
  assert.doesNotMatch(controllerSource, /published\[\$\{index\}\]\.image is required/);
  assert.doesNotMatch(controllerSource, /media_manifest\.authority is required/);
  assert.doesNotMatch(controllerSource, /media_manifest\.video is required/);
});

test("successful release imports are replayed without another media mirror", () => {
  assert.match(migrationSource, /UNIQUE KEY uq_lifecycle_release_manifest \(source_system, source_release_id, manifest_hash\)/);
  assert.match(controllerSource, /async function claimLifecycleReleaseImport/);
  assert.match(controllerSource, /String\(releaseImport\.status \|\| ""\) === "succeeded"/);
  assert.match(controllerSource, /skipped \+= 1/);
  assert.match(controllerSource, /skipped_results: skippedResults/);
});

test("media approval is derived from the validated snapshot boundary, not mirror completion", () => {
  assert.match(controllerSource, /snapshotApproved \? "approved" : "pending"/);
  assert.match(controllerSource, /\{ sourceBaseUrl, snapshotApproved: true \}/);
  assert.doesNotMatch(controllerSource, /VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)\s*\n\s*\[\s*crypto\.randomUUID\(\),\s*mirrored\.resolved_source_url,\s*mirrored\.checksum,\s*"approved"/);
});
