import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("article flow smoke expects submitted_for_admin_review after submit-admin-review", () => {
  const source = read("scripts/smoke-article-flow-e2e-browser.mjs");
  assert.match(source, /"submitted_for_admin_review"/);
  assert.match(source, /workflow_status should remain approved after admin-review submit/);
  assert.match(source, /production_state should be submitted_for_admin_review/);
});

test("published status is not routed back to the review surface", () => {
  const intake = read("server/public/article-intake.js");
  assert.match(intake, /function shouldOpenReviewSurface/);
  assert.match(intake, /return status === "ready_for_review" \|\| status === "ready_for_sync" \|\| status === "submitted_for_admin_review";/);
  assert.doesNotMatch(intake, /status === "submitted_for_admin_review" \|\| status === "synced_to_admin"/);
});

test("intake fallback does not infer submitted state from approved publication alone", () => {
  const intake = read("server/public/article-intake.js");
  assert.match(intake, /if \(productionState === "submitted_for_admin_review"\) return "submitted_for_admin_review";/);
  assert.match(intake, /if \(publicationState === "approved" \|\| publicationState === "unpublished"\) return "ready_for_sync";/);
  assert.match(intake, /if \(workflowStatus === "approved" \|\| workflowStatus === "unpublished"\) return "ready_for_sync";/);
});

test("submit pages do not expose revision action for published status", () => {
  const articleSubmit = read("server/public/article-submit-page.js");
  const eventSubmit = read("server/public/event-submit-page.js");
  assert.match(articleSubmit, /submitted_for_admin_review/);
  assert.doesNotMatch(articleSubmit, /submitted_for_admin_review", "synced_to_admin"\]\.includes\(status\)/);
  assert.match(eventSubmit, /submitted_for_admin_review/);
  assert.doesNotMatch(eventSubmit, /submitted_for_admin_review", "synced_to_admin"\]\.includes\(status\)/);
});
