import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolvePaths } from "../config/paths.mjs";
import { releaseItemToMainSite, rerunProblemTranslations } from "../services/workflow.mjs";
import { readCliOption } from "./lib/smoke-helpers.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const COLLECTOR_DIR = path.resolve(SCRIPT_DIR, "..");

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function buildSourceReadyIssues(item, imageStatus) {
  const issues = [];
  const body = String(item?.description_clean || item?.description_raw || "").trim();
  if (!(Number(imageStatus?.cover_count || 0) > 0)) issues.push("Missing cover image");
  if (!(Number(imageStatus?.selected_count || 0) > 0)) issues.push("Select at least 1 image");
  if (!body) issues.push("Missing body content");
  if (!hasText(item?.meta_title)) issues.push("Missing meta title");
  if (!hasText(item?.meta_description)) issues.push("Missing meta description");
  if (!hasText(item?.slug)) issues.push("Missing slug");
  if (String(item?.type || "").trim().toLowerCase() === "event" && !hasText(item?.event_period_text)) {
    issues.push("Missing event period text");
  }
  if (String(item?.type || "").trim().toLowerCase() === "event" && !hasText(item?.location_text)) {
    issues.push("Missing location text");
  }
  return issues;
}

function summarizeCandidate(repo, item) {
  const workflow = repo.getWorkflowModelByItem(item.id) || repo.ensureWorkflowModel(item.id);
  const imageStatus = repo.getImageWorkflowStatus(item.id) || {};
  const publishableSource = repo.buildPublishableSourceByItem(item.id);
  const publishedArticle = repo.getPublishedArticleByItem(item.id);
  const sourceIssues = buildSourceReadyIssues(item, imageStatus);
  const publicationState = String(workflow?.publication_state || "").trim().toLowerCase();

  return {
    content_item_id: Number(item.id || 0),
    title: String(item.title || "").trim(),
    publication_state: publicationState || null,
    production_state: String(workflow?.production_state || "").trim().toLowerCase() || null,
    published_article_id: Number(publishedArticle?.id || 0) || null,
    selected_count: Number(imageStatus?.selected_count || 0) || 0,
    cover_count: Number(imageStatus?.cover_count || 0) || 0,
    source_ready: sourceIssues.length === 0,
    source_issues: sourceIssues,
    field_flow_ready: sourceIssues.length === 0
      && publicationState === "approved"
      && Boolean(publishableSource?.ready_for_publish_source),
    publishable_source_ready: Boolean(publishableSource?.ready_for_publish_source),
    publishable_source_issues: Array.isArray(publishableSource?.issues) ? publishableSource.issues : [],
    publishable_source_kind: publishableSource?.source?.source_kind || null,
    assignment_id: Number(publishableSource?.source?.assignment_id || 0) || null,
    submission_id: Number(publishableSource?.source?.latest_submission_id || 0) || null,
    article_draft_deliverable_id: Number(publishableSource?.source?.article_draft_deliverable_id || 0) || null,
  };
}

function selectCandidate(repo, requestedItemId = 0) {
  if (requestedItemId > 0) {
    const item = repo.getItem(requestedItemId);
    if (!item) {
      throw new Error(`item ${requestedItemId} not found`);
    }
    return summarizeCandidate(repo, item);
  }

  const rows = repo.listItemsByWorkflowHead({ publication_states: ["approved", "published"] });
  const candidates = rows
    .map((item) => summarizeCandidate(repo, item))
    .filter((item) => item.publishable_source_ready && item.source_ready)
    .sort((a, b) => {
      const aScore = Number(!a.published_article_id) * 10 + Number(a.publication_state === "approved") * 5;
      const bScore = Number(!b.published_article_id) * 10 + Number(b.publication_state === "approved") * 5;
      return bScore - aScore || b.content_item_id - a.content_item_id;
    });

  return candidates[0] || null;
}

function listNearMisses(repo, limit = 5) {
  return repo
    .listItemsByWorkflowHead({ publication_states: ["draft", "approved", "published"] })
    .map((item) => summarizeCandidate(repo, item))
    .sort((a, b) => {
      const aScore = Number(a.publishable_source_ready) * 10 + Number(a.source_ready) * 5 + Number(a.publication_state === "approved") * 3;
      const bScore = Number(b.publishable_source_ready) * 10 + Number(b.source_ready) * 5 + Number(b.publication_state === "approved") * 3;
      return bScore - aScore || b.content_item_id - a.content_item_id;
    })
    .slice(0, limit);
}

function summarizeTranslations(rows = []) {
  const byKind = rows.reduce((acc, row) => {
    const key = String(row?.source_kind || "unknown").trim() || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byStatus = rows.reduce((acc, row) => {
    const key = String(row?.translation_status || "unknown").trim() || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    total: rows.length,
    by_kind: byKind,
    by_status: byStatus,
    langs: rows.map((row) => ({
      lang: String(row?.lang || "").trim().toLowerCase() || null,
      source_kind: row?.source_kind || null,
      translation_status: row?.translation_status || null,
      automatic_check_status: row?.automatic_check_status || null,
      stale_flag: Number(row?.stale_flag || 0) || 0,
    })),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const requestedItemId = Number(readCliOption("--item") || process.env.COLLECTOR_TEST_ITEM_ID || 0) || 0;
  const actorEmail = String(process.env.COLLECTOR_SMOKE_ACTOR_EMAIL || "smoke@local").trim().toLowerCase();
  const dirs = resolvePaths(COLLECTOR_DIR);
  const db = openDatabase(dirs.dbPath);
  const repo = createRepository(db);

  try {
    const candidate = selectCandidate(repo, requestedItemId);
    if (!candidate) {
      const nearMisses = listNearMisses(repo);
      throw new Error(`no approved/published field-flow candidate is ready for publish smoke :: near_misses=${JSON.stringify(nearMisses)}`);
    }
    if (!candidate.source_ready) {
      throw new Error(`item ${candidate.content_item_id} source is not ready: ${candidate.source_issues.join("; ")}`);
    }
    if (!candidate.publishable_source_ready) {
      throw new Error(`item ${candidate.content_item_id} has no publishable assignment source: ${candidate.publishable_source_issues.join("; ")}`);
    }
    assert(
      ["approved", "published"].includes(String(candidate.publication_state || "")),
      `item ${candidate.content_item_id} publication_state must be approved/published for smoke`
    );

    const beforePublished = repo.getPublishedArticleByItem(candidate.content_item_id);
    const beforeTranslations = repo.listTranslations(candidate.content_item_id);

    const preSyncTranslation = await rerunProblemTranslations(repo, actorEmail, {
      contentItemId: candidate.content_item_id,
      aiConfig: null,
    });
    const afterPreSyncTranslations = repo.listTranslations(candidate.content_item_id);
    assert(afterPreSyncTranslations.length > 0, `item ${candidate.content_item_id} produced no pre-sync translations`);
    if (!beforePublished) {
      assert(
        afterPreSyncTranslations.some((row) => row.source_kind === "assignment_publishable_source"),
        `item ${candidate.content_item_id} pre-sync translations did not use assignment publishable source`
      );
    }

    const release = await releaseItemToMainSite(repo, dirs, actorEmail, {
      contentItemId: candidate.content_item_id,
      actor_role: "owner",
      aiConfig: null,
      skipTranslationStage: false,
      approval_notes: "smoke publish from assignment source",
    });

    const afterPublished = repo.getPublishedArticleByItem(candidate.content_item_id);
    assert(afterPublished, `item ${candidate.content_item_id} did not create/find published article after release`);
    if (!beforePublished) {
      assert(
        !afterPublished.draft_id && !afterPublished.review_report_id,
        `item ${candidate.content_item_id} publish still depended on legacy draft/review ids`
      );
    }

    const afterFinalTranslations = repo.listTranslations(candidate.content_item_id);
    assert(afterFinalTranslations.length > 0, `item ${candidate.content_item_id} produced no translations after release`);
    assert(
      afterFinalTranslations.some((row) => row.source_kind === "published_article"),
      `item ${candidate.content_item_id} final translations did not switch to published_article source`
    );

    console.log(JSON.stringify({
      ok: true,
      db_path: dirs.dbPath,
      content_item_id: candidate.content_item_id,
      title: candidate.title,
      mode: beforePublished ? "published-translation-refresh" : "release-and-publish",
      candidate,
      before: {
        published_article_id: Number(beforePublished?.id || 0) || null,
        translations: summarizeTranslations(beforeTranslations),
      },
      pre_sync_translation: preSyncTranslation,
      after_pre_sync: summarizeTranslations(afterPreSyncTranslations),
      release: {
        quality: release?.quality || null,
        review: release?.review || null,
        publish: release?.publish || null,
        staging: release?.staging || null,
        exported: release?.exported
          ? {
            itemCount: release.exported.itemCount,
            publishedCount: release.exported.publishedCount,
            translationCount: release.exported.translationCount,
            translationSummary: release.exported.translationSummary,
          }
          : null,
      },
      after: {
        published_article_id: Number(afterPublished?.id || 0) || null,
        published_draft_id: Number(afterPublished?.draft_id || 0) || null,
        published_review_report_id: Number(afterPublished?.review_report_id || 0) || null,
        translations: summarizeTranslations(afterFinalTranslations),
      },
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`smoke-field-flow-publish-translation: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
