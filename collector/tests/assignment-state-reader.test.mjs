import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import {
  getPublishableAssignmentStateRank,
  isSelectedAssignmentAccepted,
  selectBestPublishableAssignmentCandidate,
} from "../services/publishable-assignment-candidate.mjs";

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-assignment-state-reader-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  const createItem = (title) => repo.createItemWithWorkflowHead({
    type: "place",
    category: "test",
    title,
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }).item;
  const createUser = (suffix) => {
    const email = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@local.test`;
    const result = db.prepare(`
      INSERT INTO users (email, display_name, password_hash, role)
      VALUES (?, ?, 'hash', 'user')
    `).run(email, `User ${suffix}`);
    return { id: Number(result.lastInsertRowid || 0), email };
  };
  const createReadinessBrief = (itemId) => {
    db.prepare(`
      INSERT INTO content_readiness_briefs (
        content_item_id, readiness_json, brief_json, reasons_json, blockers_json, missing_requirements_json, computed_by
      ) VALUES (?, ?, ?, '[]', '[]', '[]', 'reader-test@local')
    `).run(
      itemId,
      JSON.stringify({ ready_for_content: true, ready_for_publish: false, blockers: [], missing_requirements: [] }),
      JSON.stringify({ brief_summary: "reader test" })
    );
  };
  const createFieldAssignment = (itemId, assigneeUserId) => Number(repo.createAssignmentFromReadiness(
    itemId,
    { assignee_user_id: assigneeUserId, force_override: true, force_reason: "test" },
    assigneeUserId,
    "reader-test@local",
    "admin"
  ).assignment.id || 0);
  const submit = (assignmentId, assigneeUserId) => {
    repo.addAssignmentSubmission({
      assignment_id: assignmentId,
      submitted_by_user_id: assigneeUserId,
      submission_state: "submitted",
      field_return_payload_json: { requested_check_returns: {} },
    });
    repo.updateAssignmentState(assignmentId, "submitted", "reader-test@local", {
      actor_role: "user",
      reason_code: "submission_created",
    });
  };
  const cleanup = () => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  };
  return { repo, createItem, createUser, createReadinessBrief, createFieldAssignment, submit, cleanup };
}

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in article-intake.js`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

function loadArticleIntakeQueueHelpers() {
  const source = fs.readFileSync(path.resolve("collector/server/public/article-intake.js"), "utf8");
  const body = `
    const ARTICLE_FLOW_STATUSES = ["content_in_progress", "needs_revision", "in_review", "approved", "unpublished", "published"];
    const state = { items: [], scope: "place", user: null };
    function getArticleWorkflowAnomaly() { return null; }
    function derivedArticleWorkflowStatus() { return "collected"; }
    function isPlaceItem(item) { return item?.type === "place"; }
    function isEventItem(item) { return item?.type === "event"; }
    function isEditorUser() { return false; }
    ${extractNamedFunction(source, "isArticleQueueCandidate")}
    ${extractNamedFunction(source, "queueRows")}
    return {
      isArticleQueueCandidate,
      queueRowsFor(items) {
        state.items = items;
        return queueRows();
      },
    };
  `;
  return new Function(body)();
}

test("a closed historical round cannot make the active assigned round accepted", (t) => {
  const ctx = createContext();
  t.after(ctx.cleanup);
  const item = ctx.createItem("accepted then rework assigned");
  const assignee = ctx.createUser("current-round");
  ctx.createReadinessBrief(item.id);
  const oldAssignmentId = ctx.createFieldAssignment(item.id, assignee.id);
  ctx.submit(oldAssignmentId, assignee.id);
  ctx.repo.updateAssignmentState(oldAssignmentId, "accepted", "reviewer@local", {
    actor_role: "admin",
    reason_code: "accepted",
  });

  const rework = ctx.repo.returnFieldAssignmentForRework(oldAssignmentId, "reviewer@local", {
    note: "need another field round",
    actor_role: "admin",
  });
  assert.equal(ctx.repo.getAssignmentById(oldAssignmentId).state, "closed");
  assert.equal(rework.assignment.state, "assigned");

  const publishableSource = ctx.repo.buildPublishableSourceByItem(item.id);
  assert.equal(publishableSource.checks.assignment_accepted, false);
  assert.equal(publishableSource.source.assignment_state, "assigned");
  assert.equal(Number(publishableSource.source.assignment_id), Number(rework.assignment.id));

  const articleIntake = loadArticleIntakeQueueHelpers();
  const apiItem = {
    id: item.id,
    type: item.type,
    has_accepted_assignment: publishableSource.checks.assignment_accepted,
  };
  assert.equal(articleIntake.isArticleQueueCandidate(apiItem), false);
  assert.deepEqual(articleIntake.queueRowsFor([apiItem]), []);
});

test("the publishable selector ignores closed candidates before deciding acceptance", () => {
  const candidates = [
    {
      assignment_id: 1,
      assignment_state: "closed",
      assignment_rank: getPublishableAssignmentStateRank("closed"),
      ready_for_publish_source: true,
      has_article_draft_content: true,
      has_article_draft_deliverable: true,
      deliverables_utility: { review_usable: true },
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      assignment_id: 2,
      assignment_state: "assigned",
      assignment_rank: getPublishableAssignmentStateRank("assigned"),
      ready_for_publish_source: false,
      has_article_draft_content: false,
      has_article_draft_deliverable: false,
      deliverables_utility: { review_usable: false },
      updated_at: "2026-01-02T00:00:00.000Z",
    },
  ];

  const selected = selectBestPublishableAssignmentCandidate(candidates);
  assert.equal(selected.assignment_id, 2);
  assert.equal(isSelectedAssignmentAccepted(selected), false);
});
