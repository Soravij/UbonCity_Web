import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createTestClient } from "./lib/test-client.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nowIso() {
  return new Date().toISOString();
}

function logStep(step, detail = "") {
  const suffix = String(detail || "").trim();
  console.error(`[${nowIso()}] smoke-publish-sync-compensation step=${step}${suffix ? ` ${suffix}` : ""}`);
}

function createAsset(db, suffix) {
  const uid = `smoke-asset-${suffix}-${crypto.randomUUID()}`;
  const fileName = `${uid}.jpg`;
  const storagePath = `uploads/${fileName}`;
  const rs = db.prepare(`
    INSERT INTO assets (
      asset_uid, storage_disk, storage_path, file_name, mime_type, size_bytes, checksum
    ) VALUES (?, 'local', ?, ?, 'image/jpeg', 1024, ?)
  `).run(uid, storagePath, fileName, uid.slice(0, 32));
  const assetId = Number(rs.lastInsertRowid || 0) || 0;
  assert(assetId > 0, `failed to create asset (${suffix})`);
  return assetId;
}

function createFixtureItem(db, {
  titleSuffix,
  productionState,
  publicationState,
}) {
  const uid = `smoke-publish-sync-${crypto.randomUUID()}`;
  const slug = `smoke-publish-sync-${titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const title = `Smoke Publish Sync ${titleSuffix}`;
  const itemResult = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug, summary,
      description_raw, description_clean, meta_title, meta_description, workflow_status
    ) VALUES (?, 'place', 'attractions', 'th', ?, ?, ?, ?, ?, ?, ?, ?, 'generated')
  `).run(
    uid,
    title,
    title.toLowerCase(),
    slug,
    "smoke summary",
    "smoke body",
    "smoke body",
    `meta ${title}`,
    `meta desc ${title}`
  );
  const itemId = Number(itemResult.lastInsertRowid || 0) || 0;
  assert(itemId > 0, `failed to create fixture item ${titleSuffix}`);

  const assetId = createAsset(db, titleSuffix.toLowerCase());
  db.prepare(`
    INSERT INTO content_assets (
      content_item_id, asset_id, role, selected_in_clean, is_cover, placement_type, sort_order
    ) VALUES (?, ?, 'cover', 1, 1, 'gallery', 0)
  `).run(itemId, assetId);

  const runUid = `smoke-run-${crypto.randomUUID()}`;
  const draftRs = db.prepare(`
    INSERT INTO content_drafts (
      content_item_id, generation_run_uid, draft_title, excerpt, body,
      meta_title, meta_description, suggested_related_json, ai_quality_score, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 90, 'generated')
  `).run(
    itemId,
    runUid,
    `${title} Draft`,
    "smoke excerpt",
    "smoke draft body",
    `draft meta ${title}`,
    `draft meta desc ${title}`
  );
  const draftId = Number(draftRs.lastInsertRowid || 0) || 0;
  assert(draftId > 0, `failed to create draft ${titleSuffix}`);

  const reviewRs = db.prepare(`
    INSERT INTO review_reports (
      content_item_id, draft_id, duplication_score, seo_risk_score, metadata_score, grounding_score,
      ai_quality_score, total_score, issues_json, report_json, status
    ) VALUES (?, ?, 0, 0, 100, 100, 90, 95, '[]', '{}', 'approved')
  `).run(itemId, draftId);
  const reviewId = Number(reviewRs.lastInsertRowid || 0) || 0;
  assert(reviewId > 0, `failed to create review ${titleSuffix}`);

  db.prepare(`
    INSERT INTO content_workflow_models (
      content_item_id, production_state, publication_state, current_draft_id, current_review_report_id, updated_by, last_actor_email
    ) VALUES (?, ?, ?, ?, ?, 'smoke-publish-sync-compensation', 'smoke-publish-sync-compensation@example.com')
  `).run(itemId, productionState, publicationState, draftId, reviewId);

  return { itemId, assetId, draftId, reviewId };
}

function cleanupFixture(db, fixture) {
  const itemId = Number(fixture?.itemId || 0) || 0;
  if (!itemId) return;

  db.prepare("DELETE FROM content_translations WHERE source_content_item_id=?").run(itemId);
  db.prepare("DELETE FROM published_articles WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM review_actions WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM review_reports WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_versions WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_drafts WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_assets WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(itemId);
  db.prepare("DELETE FROM content_items WHERE id=?").run(itemId);
  const assetId = Number(fixture?.assetId || 0) || 0;
  if (assetId) {
    db.prepare("DELETE FROM assets WHERE id=?").run(assetId);
  }
}

function readWorkflow(db, itemId) {
  return db.prepare(`
    SELECT production_state, publication_state
    FROM content_workflow_models
    WHERE content_item_id=?
  `).get(itemId);
}

function readAuditByAction(db, itemId, action) {
  return db.prepare(`
    SELECT id, details_json
    FROM audit_logs
    WHERE target_type='content_item' AND target_id=? AND action=?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(itemId), action);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = resolvePaths(path.resolve(scriptDir, ".."));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));
  const client = createTestClient();

  let revisionFixture = null;
  let webFeedbackFixture = null;
  let publishSuccessFixture = null;
  let publishCompFixture = null;

  try {
    logStep("auth.me");
    const auth = await client.get("/api/auth/me");
    assert(auth.ok, `GET /api/auth/me failed: ${JSON.stringify(auth.body)}`);
    const role = String(auth.body?.user?.role || "").toLowerCase();
    assert(role === "owner" || role === "admin", `owner/admin role required for smoke, got=${role}`);

    revisionFixture = createFixtureItem(db, {
      titleSuffix: "RevisionDirect",
      productionState: "ready_for_publish",
      publicationState: "approved",
    });
    webFeedbackFixture = createFixtureItem(db, {
      titleSuffix: "WebFeedbackDirect",
      productionState: "submitted_for_admin_review",
      publicationState: "approved",
    });
    publishSuccessFixture = createFixtureItem(db, {
      titleSuffix: "PublishSyncSuccess",
      productionState: "ready_for_publish",
      publicationState: "approved",
    });
    publishCompFixture = createFixtureItem(db, {
      titleSuffix: "PublishSyncComp",
      productionState: "ready_for_publish",
      publicationState: "approved",
    });

    logStep("revision.ready_for_publish_to_needs_revision");
    const revisionRes = await client.post(`/api/items/${revisionFixture.itemId}/article-process/transition`, {
      status: "revision_requested",
      note: "smoke direct revision transition",
      reason_code: "smoke_revision_direct",
    });
    assert(revisionRes.ok, `revision transition failed: ${JSON.stringify(revisionRes.body)}`);
    const revisionWorkflow = readWorkflow(db, revisionFixture.itemId);
    assert(String(revisionWorkflow?.production_state || "") === "needs_revision", "revision fixture should be needs_revision");
    assert(String(revisionWorkflow?.publication_state || "") === "draft", "revision fixture publication should be draft");

    logStep("revision.web_review_feedback_direct");
    const reviewToken = String(process.env.COLLECTOR_REVIEW_SYNC_TOKEN || "").trim();
    assert(reviewToken, "COLLECTOR_REVIEW_SYNC_TOKEN is required for web review feedback smoke");
    const webFeedbackRes = await client.post("/api/web-review-feedback", {
      source_system: "collector-app",
      content_type: "place",
      source_content_item_id: webFeedbackFixture.itemId,
      status: "needs_revision",
      review_note: "smoke web review needs revision",
    }, {
      auth: false,
      headers: {
        "x-review-sync-token": reviewToken,
      },
    });
    assert(webFeedbackRes.ok, `web review feedback failed: ${JSON.stringify(webFeedbackRes.body)}`);
    const webWorkflow = readWorkflow(db, webFeedbackFixture.itemId);
    assert(String(webWorkflow?.production_state || "") === "needs_revision", "web feedback fixture should be needs_revision");
    assert(String(webWorkflow?.publication_state || "") === "draft", "web feedback fixture publication should be draft");

    logStep("publish.sync_success");
    const releaseSuccessRes = await client.post(`/api/items/${publishSuccessFixture.itemId}/release-main?simulate_sync_success=1`, {
      notes: "smoke release sync success",
    });
    assert(releaseSuccessRes.ok, `release-main sync success failed: ${JSON.stringify(releaseSuccessRes.body)}`);
    const successWorkflow = readWorkflow(db, publishSuccessFixture.itemId);
    assert(String(successWorkflow?.production_state || "") === "completed", "publish success should set production_state=completed");
    assert(String(successWorkflow?.publication_state || "") === "published", "publish success should set publication_state=published");
    const successArticle = db.prepare(`
      SELECT status FROM published_articles WHERE content_item_id=?
    `).get(publishSuccessFixture.itemId);
    assert(String(successArticle?.status || "") === "published", "published article status should be published on sync success");

    logStep("publish.sync_fail_compensate");
    const releaseFailRes = await client.post(`/api/items/${publishCompFixture.itemId}/release-main?simulate_sync_failure=1`, {
      notes: "smoke release sync fail compensation",
    });
    assert(
      releaseFailRes.status === 502,
      `expected 502 for simulated sync failure, got=${releaseFailRes.status} body=${JSON.stringify(releaseFailRes.body)}`
    );
    assert(releaseFailRes.body?.compensation?.ok === true, `compensation should succeed: ${JSON.stringify(releaseFailRes.body)}`);
    const compWorkflow = readWorkflow(db, publishCompFixture.itemId);
    assert(String(compWorkflow?.production_state || "") === "ready_for_publish", "compensation should restore production_state");
    assert(String(compWorkflow?.publication_state || "") === "approved", "compensation should restore publication_state");
    const compArticle = db.prepare(`
      SELECT status FROM published_articles WHERE content_item_id=?
    `).get(publishCompFixture.itemId);
    assert(!compArticle, "compensation should delete newly-created published article row");

    const syncFailedAudit = readAuditByAction(db, publishCompFixture.itemId, "publish.sync_backend.failed");
    assert(syncFailedAudit?.id, "missing audit publish.sync_backend.failed");
    const compSuccessAudit = readAuditByAction(db, publishCompFixture.itemId, "publish.compensation.success");
    assert(compSuccessAudit?.id, "missing audit publish.compensation.success");

    logStep("publish.retry_after_compensation");
    const releaseRetryRes = await client.post(`/api/items/${publishCompFixture.itemId}/release-main?simulate_sync_success=1`, {
      notes: "smoke release retry after compensation",
    });
    assert(releaseRetryRes.ok, `release retry after compensation failed: ${JSON.stringify(releaseRetryRes.body)}`);
    const retryWorkflow = readWorkflow(db, publishCompFixture.itemId);
    assert(String(retryWorkflow?.production_state || "") === "completed", "retry publish should set production_state=completed");
    assert(String(retryWorkflow?.publication_state || "") === "published", "retry publish should set publication_state=published");
    const retryArticle = db.prepare(`
      SELECT status FROM published_articles WHERE content_item_id=?
    `).get(publishCompFixture.itemId);
    assert(String(retryArticle?.status || "") === "published", "retry publish should recreate published article row");

    console.log(JSON.stringify({
      ok: true,
      checks: {
        revision_ready_for_publish_to_needs_revision: true,
        revision_web_review_feedback_to_needs_revision: true,
        publish_success_sync_success: true,
        publish_success_sync_fail_compensation_success: true,
        publish_retry_after_compensation_success: true,
      },
      fixtures: {
        revision_item_id: revisionFixture.itemId,
        web_feedback_item_id: webFeedbackFixture.itemId,
        publish_success_item_id: publishSuccessFixture.itemId,
        publish_comp_item_id: publishCompFixture.itemId,
      },
    }, null, 2));
  } finally {
    try {
      cleanupFixture(db, publishCompFixture);
      cleanupFixture(db, publishSuccessFixture);
      cleanupFixture(db, webFeedbackFixture);
      cleanupFixture(db, revisionFixture);
    } finally {
      if (typeof db.close === "function") db.close();
    }
  }
}

main().catch((err) => {
  console.error(`smoke-publish-sync-compensation: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
