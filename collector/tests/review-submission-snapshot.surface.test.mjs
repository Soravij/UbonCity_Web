import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${nextName} boundary must exist`);
  return source.slice(start, end);
}

function loadReviewSubmissionHasher() {
  const start = source.indexOf("function manifestEntriesForReleaseHash(");
  const end = source.indexOf("function parseReviewSubmissionSnapshotManifest(", start);
  assert.ok(start >= 0 && end > start, "review submission hash helpers must exist");
  const context = { crypto };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.hooks = { hashReviewSubmissionHandoff, reviewSubmissionHashProjection };`, context);
  return context.hooks;
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
  assert.match(payload, /reviewSubmissionHandoffFromSnapshot\(submissionSnapshot\)/);
  assert.doesNotMatch(payload, /repo\.listContentAssetsByItem/);
  assert.doesNotMatch(payload, /repo\.getItem|repo\.listTranslations|buildArticleProcessDraftPreview/);
  assert.match(payload, /source_submission_id/);
  assert.match(payload, /source_manifest_hash/);
  assert.match(plan, /snapshotManifestAssets\(manifest\)/);
  assert.doesNotMatch(plan, /repo\.listContentAssetsByItem/);
});

test("review submission hash canonicalizes handoff content and translations independently of input order", () => {
  const { hashReviewSubmissionHandoff, reviewSubmissionHashProjection } = loadReviewSubmissionHasher();
  const base = {
    authority: "release_main_selected_assets",
    cover: { source_asset_id: 7, source_checksum: "abc", source_url: "/uploads/cover.png", caption: " Cover " },
    gallery: [],
    inline: [{ source_asset_id: 8, source_checksum: "def", source_url: "/uploads/inline.png", caption: null }],
    video: [],
    handoff: {
      source_system: "collector-app",
      source_content_item_id: 42,
      source_base_url: "https://collector.example",
      selected_asset_count: 2,
      content: { lang: "th", title: " Main ", body: " Body ", meta_title: " Meta ", meta_description: " Desc " },
      translations: [
        { lang: " EN ", title: " English ", excerpt: "", body: " Body EN ", meta_title: " Meta EN ", meta_description: " Desc EN " },
        { lang: "lo", title: " Lao ", body: " Body LO ", meta_title: " Meta LO ", meta_description: " Desc LO " },
        { lang: "th", title: "must be excluded", body: "must be excluded" },
      ],
    },
  };
  const reordered = {
    ...base,
    handoff: {
      ...base.handoff,
      content: { meta_description: " Desc ", body: " Body ", title: " Main ", lang: "th", meta_title: " Meta " },
      translations: [...base.handoff.translations].reverse(),
    },
  };
  assert.equal(hashReviewSubmissionHandoff(base), hashReviewSubmissionHandoff(reordered));
  assert.equal(
    JSON.stringify(reviewSubmissionHashProjection(base).handoff.translations.map((row) => row.lang)),
    JSON.stringify(["en", "lo"])
  );
  assert.equal(reviewSubmissionHashProjection(base).handoff.translations[0].excerpt, null);
  assert.notEqual(
    hashReviewSubmissionHandoff(base),
    hashReviewSubmissionHandoff({ ...base, handoff: { ...base.handoff, content: { ...base.handoff.content, body: "Changed" } } })
  );
  assert.notEqual(
    hashReviewSubmissionHandoff(base),
    hashReviewSubmissionHandoff({ ...base, inline: [{ ...base.inline[0], source_checksum: "changed" }] })
  );
});
