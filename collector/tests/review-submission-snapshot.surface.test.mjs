import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${nextName} boundary must exist`);
  return source.slice(start, end);
}

test("submit-admin-review resolves a submission snapshot only after the readiness gates", () => {
  const routeStart = source.indexOf('app.post("/api/items/:id/submit-admin-review"');
  const routeEnd = source.indexOf('app.post("/api/items/:id/recover-problem-translations"', routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.ok(route.indexOf("getRequiredTranslationRecheckBlockers") < route.indexOf("resolveReviewSubmissionSnapshot"));
  assert.ok(route.indexOf('processStatus !== "ready_for_sync"') < route.indexOf("resolveReviewSubmissionSnapshot"));
  assert.match(route, /submittedBy: actorEmail\(req\)/);
  assert.match(route, /submissionSnapshot/);
});

test("review payload and multipart plan use the submission snapshot rather than fresh content_assets", () => {
  const payload = functionSource("buildReviewIngestPayload", "buildAdminReviewMultipartFilePlan");
  const plan = functionSource("buildAdminReviewMultipartFilePlan", "buildEventAdminQueuePayload");
  assert.match(payload, /parseReviewSubmissionSnapshotManifest\(submissionSnapshot\)/);
  assert.doesNotMatch(payload, /repo\.listContentAssetsByItem/);
  assert.match(payload, /source_submission_id/);
  assert.match(payload, /source_manifest_hash/);
  assert.match(plan, /snapshotManifestAssets\(manifest\)/);
  assert.doesNotMatch(plan, /repo\.listContentAssetsByItem/);
});
