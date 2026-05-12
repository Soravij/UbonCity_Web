import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { releaseItemToMainSite } from "../services/workflow.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "ReleaseScope!Test1";
process.env.TRANSLATION_TARGET_LANGS = "en";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-release-scope-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);
  const dirs = {
    stagingDir: path.join(tempDir, "staging", "content"),
    exportDir: path.join(tempDir, "staging", "content"),
  };

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createApprovedItem(title, slugSuffix) {
    const item = repo.saveItem({
      type: "place",
      category: "attractions",
      lang: "th",
      title,
      slug: `slug-${slugSuffix}`,
      description_raw: `${title} raw`,
      description_clean: `${title} clean body`,
      summary: `${title} summary`,
      meta_title: `${title} meta`,
      meta_description: `${title} meta description`,
      source_type: "manual",
      source_name: "manual",
      source_url: `https://${slugSuffix}.example.com`,
    });

    const draft = repo.saveDraft(item.id, `run-${slugSuffix}`, {
      draft_title: `${title} draft`,
      excerpt: `${title} excerpt`,
      body: `${title} body`,
      meta_title: `${title} draft meta`,
      meta_description: `${title} draft meta description`,
      slug: `draft-${slugSuffix}`,
      status: "generated",
    });

    repo.addReviewReport(item.id, draft.id, {
      duplication_score: 1,
      seo_risk_score: 1,
      metadata_score: 1,
      grounding_score: 1,
      ai_quality_score: 1,
      total_score: 5,
      issues: [],
      report: { summary: `${title} approved` },
      status: "approved",
    });
    repo.setWorkflowStatus([item.id], "approved");
    return item;
  }

  return {
    db,
    repo,
    dirs,
    cleanup,
    createApprovedItem,
  };
}

test("releaseItemToMainSite publishes, stages, and exports only the requested item", async () => {
  const ctx = createTestContext();
  try {
    const itemA = ctx.createApprovedItem("Alpha Place", "alpha");
    const itemB = ctx.createApprovedItem("Beta Place", "beta");

    const result = await releaseItemToMainSite(ctx.repo, ctx.dirs, "owner@local", {
      contentItemId: itemA.id,
      actor_role: "owner",
      aiConfig: null,
    });

    assert.equal(result.content_item_id, itemA.id);
    assert.equal(Boolean(ctx.repo.getPublishedArticleByItem(itemA.id)), true);
    assert.equal(ctx.repo.getPublishedArticleByItem(itemB.id), null);

    const stagedIds = ctx.repo.listStaging().map((row) => Number(row.id || 0));
    assert.deepEqual(stagedIds, [itemA.id]);

    const itemBState = ctx.repo.getItem(itemB.id);
    assert.equal(itemBState.workflow_status, "approved");

    assert.match(result.export.jsonPath, new RegExp(`items[\\\\/]${itemA.id}[\\\\/]content-import\\.json$`));
    const exportedItems = JSON.parse(fs.readFileSync(result.export.jsonPath, "utf8"));
    assert.equal(exportedItems.length, 1);
    assert.equal(exportedItems[0].title, itemA.title);

    const publishedRows = JSON.parse(fs.readFileSync(result.export.publishedPath, "utf8"));
    assert.equal(publishedRows.length, 1);
    assert.equal(Number(publishedRows[0].content_item_id || 0), itemA.id);
  } finally {
    ctx.cleanup();
  }
});

test("releaseItemToMainSite honors article-process ready_for_sync without legacy review reports", async () => {
  const ctx = createTestContext();
  try {
    const item = ctx.repo.saveItem({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "Ready For Sync Place",
      slug: "ready-for-sync-place",
      description_raw: "Ready raw",
      description_clean: "Ready clean body",
      summary: "Ready summary",
      meta_title: "Ready meta",
      meta_description: "Ready meta description",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://ready.example.com",
    });

    const draft = ctx.repo.saveDraft(item.id, "run-ready", {
      draft_title: "Ready For Sync Place",
      excerpt: "Ready excerpt",
      body: "<p>Ready body</p>",
      meta_title: "Ready meta",
      meta_description: "Ready meta description",
      slug: "ready-for-sync-place",
      status: "generated",
    });

    ctx.repo.setWorkflowStatus([item.id], "approved");
    ctx.repo.upsertWorkflowModel(
      item.id,
      {
        production_state: "ready_for_publish",
        publication_state: "approved",
        last_transition_note: "article process approved",
      },
      "admin@local",
      { actor_role: "admin", reason_code: "article_process_ready_for_sync" }
    );

    const result = await releaseItemToMainSite(ctx.repo, ctx.dirs, "admin@local", {
      contentItemId: item.id,
      actor_role: "admin",
      aiConfig: null,
    });

    const published = ctx.repo.getPublishedArticleByItem(item.id);
    const finalItem = ctx.repo.getItem(item.id);

    assert.equal(result.content_item_id, item.id);
    assert.equal(Boolean(published), true);
    assert.equal(Number(published?.draft_id || 0), Number(draft.id || 0));
    assert.equal(published?.review_report_id ?? null, null);
    assert.equal(finalItem?.workflow_status, "published");
    assert.equal(result.quality?.skipped, true);
    assert.equal(result.review?.skipped, true);
  } finally {
    ctx.cleanup();
  }
});
