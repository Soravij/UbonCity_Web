import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import {
  hasAcceptedOrClosedAssignment,
  isAcceptedOrClosedAssignmentState,
} from "../services/assignment-state.mjs";

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-assignment-state-reader-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  const createItem = (type, title) => repo.createItemWithWorkflowHead({
    type,
    category: "test",
    title,
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }).item;
  const createAssignment = (itemId, state, suffix) => repo.createAssignment({
    content_item_id: itemId,
    assignment_kind: "editorial",
    state,
    assignee_name: `worker-${suffix}`,
    assignee_contact: `${suffix}@example.com`,
  }, null, {
    actor_email: "reader-test@local",
    actor_role: "admin",
    reason_code: "reader_test_assignment_created",
  });
  const cleanup = () => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  };
  return { repo, createItem, createAssignment, cleanup };
}

test("accepted-or-closed is the shared assignment completion predicate", () => {
  for (const state of ["assigned", "in_progress", "submitted", "revision_requested", "resubmitted"]) {
    assert.equal(isAcceptedOrClosedAssignmentState(state), false, state);
  }
  for (const state of ["accepted", "closed", " ACCEPTED ", "Closed"]) {
    assert.equal(isAcceptedOrClosedAssignmentState(state), true, state);
  }
});

test("reader derives completion from every already-loaded assignment, not the newest row", (t) => {
  const ctx = createContext();
  t.after(ctx.cleanup);
  const item = ctx.createItem("place", "accepted older than assigned");
  ctx.createAssignment(item.id, "accepted", "accepted");
  ctx.createAssignment(item.id, "assigned", "assigned");

  const assignments = ctx.repo.listAssignmentsByItem(item.id);
  assert.equal(assignments[0].state, "assigned", "fixture must put the unfinished row first");
  assert.equal(hasAcceptedOrClosedAssignment(assignments), true);
});

test("accepted-or-closed derivation is content-type neutral", (t) => {
  const ctx = createContext();
  t.after(ctx.cleanup);
  for (const [type, state, expected] of [
    ["place", "closed", true],
    ["event", "accepted", true],
    ["article", "submitted", false],
  ]) {
    const item = ctx.createItem(type, `${type}-${state}`);
    ctx.createAssignment(item.id, state, `${type}-${state}`);
    assert.equal(hasAcceptedOrClosedAssignment(ctx.repo.listAssignmentsByItem(item.id)), expected, `${type}/${state}`);
  }
});
