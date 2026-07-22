import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

function hash(value) {
  return String(value).repeat(64).slice(0, 64);
}

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-review-submission-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), path.resolve(import.meta.dirname, "..", "database", "schema.sql"));
  const repo = createRepository(db);
  const item = repo.saveItem({
    type: "place", category: "attractions", lang: "th", title: "Review snapshot", slug: "review-snapshot",
    description_raw: "raw", description_clean: "clean", summary: "summary", meta_title: "meta", meta_description: "description",
    source_type: "manual", source_name: "manual", source_url: "https://review.example",
  });
  return { db, repo, item, cleanup: () => { try { db.close(); } catch {}; fs.rmSync(tempDir, { recursive: true, force: true }); } };
}

test("review submission snapshots reuse an unchanged manifest and supersede changed caption or asset", () => {
  const ctx = createContext();
  try {
    const firstManifest = {
      authority: "review_submission_selected_assets",
      cover: { source_asset_id: 7, source_checksum: hash("a"), role: "cover", position: 0, source_url: "/media/cover.jpg", caption: "First caption", storage_disk: "local", storage_path: "uploads/cover.jpg" },
      gallery: [], inline: [], video: [],
    };
    const first = ctx.repo.resolveReviewSubmissionSnapshot({ contentItemId: ctx.item.id, manifest: firstManifest, manifestHash: hash("a"), submittedBy: "owner@local" });
    assert.equal(first.action, "created");
    assert.equal(first.snapshot.submitted_by, "owner@local");

    const retry = ctx.repo.resolveReviewSubmissionSnapshot({ contentItemId: ctx.item.id, manifest: { changed: true }, manifestHash: hash("a"), submittedBy: "owner@local" });
    assert.equal(retry.action, "retry");
    assert.equal(retry.snapshot.submission_id, first.snapshot.submission_id);
    assert.deepEqual(retry.snapshot.manifest, firstManifest);

    const revision = ctx.repo.resolveReviewSubmissionSnapshot({
      contentItemId: ctx.item.id,
      manifest: { ...firstManifest, cover: { ...firstManifest.cover, caption: "Changed caption", source_asset_id: 8 } },
      manifestHash: hash("b"),
      submittedBy: "admin@local",
    });
    assert.equal(revision.action, "revision");
    assert.notEqual(revision.snapshot.submission_id, first.snapshot.submission_id);
    assert.equal(revision.snapshot.manifest.cover.caption, "Changed caption");
    assert.ok(ctx.db.prepare("SELECT superseded_at FROM review_submission_snapshots WHERE submission_id=?").get(first.snapshot.submission_id).superseded_at);
  } finally {
    ctx.cleanup();
  }
});
