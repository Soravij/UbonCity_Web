import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository, PRODUCTION_STATES } from "../db/repository.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "Transition!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-transition-skip-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve(process.cwd(), "collector", "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createPlace(productionState) {
    const result = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title: `Place head=${productionState}`,
      description_raw: "test description",
      description_clean: "test description",
      summary: "",
      meta_title: "",
      meta_description: "",
      image_url: "",
      tags: [],
      lang: "th",
    });
    const itemId = Number(result?.item?.id || 0) || 0;
    db.prepare(`UPDATE content_workflow_models SET production_state=? WHERE content_item_id=?`).run(productionState, itemId);
    return repo.getItem(itemId);
  }

  function createEvent(productionState) {
    const result = repo.createItemWithWorkflowHead({
      type: "event",
      category: "attractions",
      title: `Event head=${productionState}`,
      description_raw: "test description",
      description_clean: "test description",
      summary: "",
      meta_title: "",
      meta_description: "",
      image_url: "",
      tags: [],
      lang: "th",
    });
    const itemId = Number(result?.item?.id || 0) || 0;
    db.prepare(`UPDATE content_workflow_models SET production_state=? WHERE content_item_id=?`).run(productionState, itemId);
    return repo.getItem(itemId);
  }

  function createFieldAssignment(itemId) {
    return repo.createAssignment({
      content_item_id: itemId,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "test worker",
      assignee_contact: "worker@test.com",
    });
  }

  return { db, repo, cleanup, createPlace, createEvent, createFieldAssignment };
}

test("place field assignment with head=analyzed rejects in_progress and rolls back assignment", () => {
  const ctx = createTestContext();
  try {
    const place = ctx.createPlace("analyzed");
    const assignment = ctx.createFieldAssignment(place.id);

    assert.throws(
      () => ctx.repo.updateAssignmentState(assignment.id, "in_progress", "test@local"),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, "INVALID_PRODUCTION_TRANSITION");
        assert.match(err.message, /analyzed → field_working/);
        return true;
      }
    );

    const stillAssigned = ctx.repo.getAssignmentById(assignment.id);
    assert.equal(stillAssigned.state, "assigned", "assignment must stay at assigned after rollback");

    const head = ctx.repo.ensureWorkflowModel(place.id);
    assert.equal(head.production_state, "analyzed", "head must stay at analyzed");
  } finally {
    ctx.cleanup();
  }
});

test("place field assignment with head=ready_for_content succeeds and transitions head to field_working", () => {
  const ctx = createTestContext();
  try {
    const place = ctx.createPlace("ready_for_content");
    const assignment = ctx.createFieldAssignment(place.id);

    assert.doesNotThrow(() => ctx.repo.updateAssignmentState(assignment.id, "in_progress", "test@local"));

    const updated = ctx.repo.getAssignmentById(assignment.id);
    assert.equal(updated.state, "in_progress", "assignment must be in_progress");

    const head = ctx.repo.ensureWorkflowModel(place.id);
    assert.equal(head.production_state, "field_working", "head must be field_working");
  } finally {
    ctx.cleanup();
  }
});

test("event field assignment with head=collected still returns 200 (no production state computed)", () => {
  const ctx = createTestContext();
  try {
    const event = ctx.createEvent("collected");
    const assignment = ctx.createFieldAssignment(event.id);

    assert.doesNotThrow(() => ctx.repo.updateAssignmentState(assignment.id, "in_progress", "test@local"));

    const updated = ctx.repo.getAssignmentById(assignment.id);
    assert.equal(updated.state, "in_progress", "assignment must be in_progress");

    const head = ctx.repo.ensureWorkflowModel(event.id);
    assert.equal(head.production_state, "collected", "head must stay at collected (no target computed for event)");
  } finally {
    ctx.cleanup();
  }
});

test("submission on place+field with invalid production transition rolls back submission row and returns error", () => {
  const ctx = createTestContext();
  try {
    const place = ctx.createPlace("collected");
    const assignment = ctx.createFieldAssignment(place.id);

    const userResult = ctx.db.prepare(`INSERT INTO users (email, display_name, password_hash, role) VALUES (?, 'test', 'hash', 'user')`).run(`test-${Date.now()}@local`);
    const userId = Number(userResult.lastInsertRowid);

    const submissionPayload = {
      assignment_id: assignment.id,
      submitted_by_user_id: userId,
      submission_state: "submitted",
    };

    assert.throws(
      () => ctx.repo.addSubmissionWithAssignmentTransition(submissionPayload, assignment.id, "submitted", "test@local", { actor_role: "user", reason_code: "test" }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.code, "INVALID_PRODUCTION_TRANSITION");
        return true;
      }
    );

    const submissions = ctx.repo.listAssignmentSubmissions(assignment.id);
    assert.equal(submissions.length, 0, "no submission row must remain after rollback");

    const stillAssigned = ctx.repo.getAssignmentById(assignment.id);
    assert.equal(stillAssigned.state, "assigned", "assignment must stay at assigned after rollback");
  } finally {
    ctx.cleanup();
  }
});
