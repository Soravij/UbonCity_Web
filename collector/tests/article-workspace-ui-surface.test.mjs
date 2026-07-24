import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("D:/UbonCity_Web/collector");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("article workspace html loads authoring-focused shell", () => {
  const html = read("server/public/article-workspace.html");
  assert.match(html, /id="article-process-bar"/);
  assert.match(html, /class="article-workspace-side article-workspace-overview"/);
  assert.match(html, /id="article-preview"/);
  assert.match(html, /id="article-blocks"/);
  assert.match(html, /id="btn-insert-gallery"/);
  assert.match(html, /id="btn-insert-quote"/);
  assert.match(html, /id="btn-insert-list"/);
  assert.match(html, /id="btn-submit-review"/);
  assert.match(html, /id="article-activity-log"/);
  assert.match(html, /id="editor-external-name"/);
  assert.match(html, /id="editor-external-contact"/);
  assert.match(html, /id="btn-open-review"/);
  assert.doesNotMatch(html, /id="review-note"/);
  assert.doesNotMatch(html, /id="translation-review-summary"/);
  assert.doesNotMatch(html, /id="translation-summary"/);
  assert.doesNotMatch(html, /id="btn-generate-translations"/);
  assert.doesNotMatch(html, /id="btn-refresh-translations"/);
  assert.doesNotMatch(html, /id="btn-recover-translations"/);
  assert.doesNotMatch(html, /id="hero-preview"/);
  assert.doesNotMatch(html, /id="asset-upload-input"/);
  assert.doesNotMatch(html, /id="btn-upload-assets"/);
  assert.doesNotMatch(html, /id="btn-refresh-assets"/);
  assert.match(html, /src="\/article-workspace\.js"/);
});

test("article review html loads approval-focused shell", () => {
  const html = read("server/public/article-submit.html");
  assert.match(html, /id="article-process-bar"/);
  assert.match(html, /id="article-preview"/);
  assert.match(html, /id="review-note"/);
  assert.match(html, /id="translation-review-summary"/);
  assert.match(html, /id="article-activity-log"/);
  assert.match(html, /id="translation-summary"/);
  assert.match(html, /id="translation-generate-state"/);
  assert.match(html, /id="translation-detail-modal"/);
  assert.match(html, /id="translation-detail-body"/);
  assert.match(html, /id="btn-generate-translations"/);
  assert.match(html, /id="btn-refresh-readiness"/);
  assert.match(html, /id="btn-send-main-site"/);
  assert.match(html, /id="btn-open-workspace"/);
  assert.match(html, /id="article-review-summary"/);
  assert.doesNotMatch(html, /id="editor-external-name"/);
  assert.doesNotMatch(html, /id="article-blocks"/);
});

test("article intake html loads intake-focused shell", () => {
  const html = read("server/public/article-intake.html");
  assert.match(html, /id="article-process-bar"/);
  assert.match(html, /id="table-article-intake"/);
  assert.match(html, /id="article-intake-summary"/);
  assert.match(html, /id="article-process-summary"/);
  assert.match(html, /id="editor-assignee-select"/);
  assert.match(html, /id="editor-external-name"/);
  assert.match(html, /id="editorial-assignment-list"/);
  assert.match(html, /id="article-activity-log"/);
  assert.match(html, /id="btn-open-selected-workspace"/);
  assert.match(html, /id="btn-open-selected-review"/);
  assert.match(html, /src="\/article-intake\.js"/);
  assert.doesNotMatch(html, /id="article-blocks"/);
  assert.doesNotMatch(html, /id="translation-summary"/);
});

test("dashboard routes article workflow statuses to article workspace", () => {
  const source = read("server/public/app.js");
  assert.match(source, /content_in_progress/);
  assert.match(source, /needs_revision/);
  assert.match(source, /approved/);
  assert.match(source, /\/article-intake\.html\?id=\$\{id\}/);
});

test("article workspace uses article-process payload field names", () => {
  const source = read("server/public/article-workspace.js");
  assert.match(source, /editorial_assignments/);
  assert.match(source, /active_editorial_assignment/);
  assert.match(source, /workflow_transitions/);
  assert.match(source, /editor-external-name/);
  assert.match(source, /editor-external-contact/);
  assert.match(source, /assignee_name/);
  assert.match(source, /assignee_contact/);
});

test("article workspace supports structured body blocks while keeping raw body storage", () => {
  const source = read("server/public/article-workspace.js");
  assert.match(source, /bodyBlocks/);
  assert.match(source, /function buildBlocksFromBody/);
  assert.match(source, /function parseHtmlToBlocks/);
  assert.match(source, /new DOMParser\(\)/);
  assert.match(source, /figureToBlock/);
  assert.match(source, /blockquote/);
  assert.match(source, /gallery/);
  assert.match(source, /list_style/);
  assert.match(source, /function serializeBlocks/);
  assert.match(source, /function syncBodyFromBlocks/);
});

test("article workspace can insert image blocks directly from media library", () => {
  const source = read("server/public/article-workspace.js");
  assert.match(source, /function isImageAsset/);
  assert.match(source, /function ensureSelectedAssetId/);
  assert.match(source, /data-action="insert-image"/);
  assert.match(source, /function insertImageByAssetId/);
  assert.match(source, /insertImageByAssetId\(state\.selectedAssetId\)/);
  assert.match(source, /if \(action === "insert-image"\)/);
});

test("article workspace media library supports hover preview", () => {
  const html = read("server/public/article-workspace.html");
  const source = read("server/public/article-workspace.js");
  assert.match(html, /id="article-asset-hover-preview"/);
  assert.match(html, /id="article-asset-hover-preview-image"/);
  assert.match(html, /id="article-asset-hover-preview-video"/);
  assert.match(source, /leftCover/);
  assert.match(source, /article-asset-badge/);
  assert.match(source, /data-preview-url/);
  assert.match(source, /function showArticleAssetHoverPreview/);
  assert.match(source, /function hideArticleAssetHoverPreview/);
  assert.match(source, /function positionArticleAssetHoverPreview/);
});

test("article workspace separates translation phase from release actions", () => {
  const source = read("server/public/article-workspace.js");
  assert.match(source, /translations:\s*\[\]/);
  assert.match(source, /function canManageTranslations/);
  assert.match(source, /function getTranslationGateState/);
  assert.match(source, /Translation ครบทุกภาษา/);
  assert.match(source, /function sanitizePreviewFragment/);
  assert.match(source, /PREVIEW_ALLOWED_TAGS/);
  assert.match(source, /function renderTranslationSummary/);
  assert.match(source, /function renderTranslationReviewSummary/);
  assert.match(source, /function openTranslationDetail/);
  assert.match(source, /data-translation-detail/);
  assert.match(source, /function generateTranslations/);
  assert.match(source, /สถานะ readiness/);
  assert.match(source, /ครบทุกภาษา/);
  assert.doesNotMatch(source, /รอหลังส่งเข้าเว็บ/);
  assert.match(source, /function refreshTranslations/);
  assert.match(source, /function setTranslationGenerateLoading/);
  assert.match(source, /\/generate-translations/);
  assert.match(source, /function renderReviewArticleSummary/);
  assert.match(source, /function currentArticlePage/);
  assert.match(source, /function reviewUrl/);
  assert.match(source, /function workspaceUrl/);
  assert.match(source, /function intakeUrl/);
  assert.match(source, /translationStatusFromRepoRow/);
  assert.match(source, /status !== "ready_for_review" \|\| !validation\.ok \|\| !translationGate\.allReady/);
  assert.match(source, /state\.readiness = \{\s*\.\.\.state\.readiness,/);
  assert.match(source, /\/api\/translations\?content_item_id=/);
  assert.doesNotMatch(source, /btn-refresh-translations/);
  assert.doesNotMatch(source, /btn-recover-translations/);
});

test("article intake script supports queue selection and assignment flow", () => {
  const source = read("server/public/article-intake.js");
  assert.match(source, /function renderQueue/);
  assert.match(source, /function loadSelectedItem/);
  assert.match(source, /function assignEditor/);
  assert.match(source, /function shouldOpenReviewSurface/);
  assert.match(source, /function canOpenWorkspaceSurface/);
  assert.match(source, /\/api\/items\/:id\/article-editorial-assignments|\/article-editorial-assignments/);
  assert.match(source, /\/article-workspace\.html\?id=\$\{Number\(itemId \|\| 0\) \|\| 0\}/);
  assert.match(source, /\/article-review\.html\?id=\$\{Number\(itemId \|\| 0\) \|\| 0\}/);
});
