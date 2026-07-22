import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { compensateReleaseAfterSyncFailure } from "../services/workflow.mjs";

const hash = (value) => String(value).repeat(64).slice(0, 64);

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-release-snapshot-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), path.resolve(import.meta.dirname, "..", "database", "schema.sql"));
  const repo = createRepository(db);
  const item = repo.saveItem({
    type: "place", category: "attractions", lang: "th", title: "Snapshot item", slug: "snapshot-item",
    description_raw: "raw", description_clean: "clean", summary: "summary", meta_title: "meta", meta_description: "meta description",
    source_type: "manual", source_name: "manual", source_url: "https://snapshot.example",
  });
  return { db, repo, item, cleanup: () => { try { db.close(); } catch {}; fs.rmSync(tempDir, { recursive: true, force: true }); } };
}

test("release snapshots preserve approved manifest across retry, revision, and compensation", async () => {
  const ctx = createContext();
  try {
    const firstManifest = { authority: "release_main_selected_assets", cover: null, gallery: [], inline: [], video: [] };
    const first = ctx.repo.resolveReleaseSnapshot({ contentItemId: ctx.item.id, manifest: firstManifest, manifestHash: hash("a"), approvedBy: "owner@local" });
    assert.equal(first.action, "created");
    assert.equal(first.snapshot.approved_by, "owner@local");
    assert.ok(first.snapshot.approved_at);

    const retry = ctx.repo.resolveReleaseSnapshot({ contentItemId: ctx.item.id, manifest: { changed: true }, manifestHash: hash("b"), approvedBy: "owner@local", forceRetry: true });
    assert.equal(retry.action, "retry");
    assert.equal(retry.snapshot.release_id, first.snapshot.release_id);
    assert.deepEqual(retry.snapshot.manifest, firstManifest);

    const revision = ctx.repo.resolveReleaseSnapshot({ contentItemId: ctx.item.id, manifest: { ...firstManifest, gallery: [{ source_asset_id: 9, caption: "Updated caption" }] }, manifestHash: hash("c"), approvedBy: "admin@local" });
    assert.equal(revision.action, "revision");
    assert.notEqual(revision.snapshot.release_id, first.snapshot.release_id);
    assert.equal(revision.snapshot.manifest.gallery[0].caption, "Updated caption");
    assert.ok(ctx.db.prepare("SELECT superseded_at FROM release_snapshots WHERE release_id=?").get(first.snapshot.release_id).superseded_at);

    const compensationCalls = [];
    compensateReleaseAfterSyncFailure({
      upsertWorkflowModel() { return { production_state: "ready_for_publish" }; },
      getPublishedArticleByItem() { return { id: 1 }; },
      deletePublishedArticleByItem(id) { compensationCalls.push(id); },
    }, "owner@local", {
      contentItemId: ctx.item.id,
      workflowBefore: { production_state: "ready_for_publish", publication_state: "approved" },
      actor_role: "owner",
    });
    assert.deepEqual(compensationCalls, [ctx.item.id]);
    assert.equal(ctx.repo.getActiveReleaseSnapshotByItem(ctx.item.id).release_id, revision.snapshot.release_id);
  } finally {
    ctx.cleanup();
  }
});

test("content asset captions are contextual and update only the item asset link", () => {
  const ctx = createContext();
  try {
    const assetId = Number(ctx.db.prepare(
      "INSERT INTO assets (asset_uid, storage_disk, storage_path, file_name, mime_type, checksum) VALUES (?,?,?,?,?,?)"
    ).run("caption-asset", "local", "uploads/caption.jpg", "caption.jpg", "image/jpeg", "a".repeat(64)).lastInsertRowid);
    ctx.db.prepare(
      "INSERT INTO content_assets (content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order) VALUES (?,?, 'gallery', 1, 0, 'gallery', 0)"
    ).run(ctx.item.id, assetId);

    const updated = ctx.repo.setContentAssetCaption(ctx.item.id, assetId, "Collector caption");
    assert.equal(updated.caption, "Collector caption");
    assert.equal(ctx.repo.listContentAssetsByItem(ctx.item.id, { onlySelected: true })[0].caption, "Collector caption");
  } finally {
    ctx.cleanup();
  }
});
