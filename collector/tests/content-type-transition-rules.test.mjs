import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { ASSIGNMENT_STATES, createRepository, PRODUCTION_STATES, PUBLICATION_STATES, TRANSITION_RULES } from "../db/repository.mjs";

const CONTENT_TYPES = ["place", "event", "other_transport", "public_transport_map"];
const LEGACY_RULES = Object.freeze({
  production: Object.freeze({
    collected: ["analyzed", "content_in_progress", "generated", "in_review", "needs_revision", "ready_for_publish", "rejected"],
    analyzed: ["brief_generated", "content_in_progress", "generated", "in_review", "needs_revision", "ready_for_publish", "rejected"],
    brief_generated: ["analyzed", "ready_for_content", "content_in_progress", "generated", "in_review", "needs_revision", "ready_for_publish", "rejected"],
    ready_for_content: ["content_in_progress", "generated", "rejected"],
    content_in_progress: ["generated", "in_review", "needs_revision", "rejected"],
    generated: ["content_in_progress", "in_review", "needs_revision", "rejected"],
    in_review: ["needs_revision", "ready_for_publish", "rejected"],
    needs_revision: ["content_in_progress", "generated", "in_review", "rejected"],
    ready_for_publish: ["submitted_for_admin_review", "completed", "needs_revision", "rejected"],
    submitted_for_admin_review: ["needs_revision", "rejected", "completed"],
    rejected: ["analyzed", "brief_generated", "ready_for_content"],
    completed: ["needs_revision"],
  }),
  publication: Object.freeze({
    draft: ["approved", "archived"],
    approved: ["published", "draft", "archived"],
    published: ["unpublished", "archived"],
    unpublished: ["approved", "archived"],
    archived: ["approved"],
    deleted: [],
  }),
  assignment: Object.freeze({
    assigned: ["in_progress", "submitted", "closed"],
    in_progress: ["submitted", "revision_requested", "closed"],
    submitted: ["revision_requested", "accepted", "closed"],
    revision_requested: ["resubmitted", "in_progress", "closed"],
    resubmitted: ["accepted", "revision_requested", "closed"],
    accepted: ["closed", "revision_requested"],
    closed: [],
  }),
});

function serializeRules(rules) {
  return Object.fromEntries(Object.entries(rules).map(([group, byFrom]) => [
    group,
    Object.fromEntries(Object.entries(byFrom).map(([from, allowed]) => [from, [...allowed].sort()])),
  ]));
}

function createContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-content-type-rules-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  let sequence = 0;
  return {
    db,
    repo,
    createItem(type, workflowPatch = {}) {
      sequence += 1;
      return repo.createItemWithWorkflowHead({
        type,
        category: "test",
        title: `${type}-${sequence}`,
        description_raw: "test",
        source_type: "manual",
        source_name: "test",
      }, workflowPatch).item;
    },
    cleanup() {
      try { db.close(); } catch {}
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function assertAllTypeRulesMatchLegacy() {
  const expectedContentRules = serializeRules({ production: LEGACY_RULES.production, publication: LEGACY_RULES.publication });
  for (const type of CONTENT_TYPES) {
    assert.deepEqual(serializeRules(TRANSITION_RULES[type]), expectedContentRules, `${type} must retain the complete legacy production/publication graph`);
  }
}

test("every content type has the complete legacy graph and mutations to one type are detected", () => {
  assertAllTypeRulesMatchLegacy();
  assert.notStrictEqual(TRANSITION_RULES.place, TRANSITION_RULES.event, "content types must be independently mutable for 4b");

  const mutatedSet = TRANSITION_RULES.place.production.collected;
  mutatedSet.delete("analyzed");
  try {
    assert.throws(() => assertAllTypeRulesMatchLegacy(), /place must retain/);
  } finally {
    mutatedSet.add("analyzed");
  }
  assertAllTypeRulesMatchLegacy();
});

test("all formerly allowed and rejected transitions retain their result for every content type", () => {
  const ctx = createContext();
  const originalError = console.error;
  const fallbackLogs = [];
  console.error = (...args) => {
    if (args[0] === "[workflow-transition] unknown content type fallback") fallbackLogs.push(args[1]);
  };
  try {
    for (const type of CONTENT_TYPES) {
      for (const [group, states] of [["production", [...PRODUCTION_STATES]], ["publication", [...PUBLICATION_STATES]], ["assignment", [...ASSIGNMENT_STATES]]]) {
        const rules = group === "assignment" ? LEGACY_RULES.assignment : LEGACY_RULES[group];
        for (const from of Object.keys(rules)) {
          for (const to of states) {
            const item = ctx.createItem(type, { [`${group}_state`]: from });
            const expectedAllowed = from === to || rules[from].includes(to);
            const transition = () => ctx.repo.upsertWorkflowModel(item.id, { [`${group}_state`]: to }, "test@local");
            if (expectedAllowed) assert.doesNotThrow(transition, `${type} ${group} ${from} -> ${to} should remain allowed`);
            else assert.throws(transition, /invalid .* transition/, `${type} ${group} ${from} -> ${to} should remain rejected`);
          }
        }
      }
    }
    const assignmentItem = ctx.createItem("place");
    const assignment = ctx.repo.createAssignment({
      content_item_id: assignmentItem.id,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "test worker",
      assignee_contact: "test@example.com",
    });
    assert.doesNotThrow(() => ctx.repo.updateAssignmentState(assignment.id, "in_progress", "test@local"));

    const returnItem = ctx.createItem("place", { production_state: "brief_generated" });
    ctx.repo.createFieldPack({ content_item_id: returnItem.id, status: "ready_for_field", ai_summary: "test pack" });
    assert.doesNotThrow(() => ctx.repo.returnFieldPackToCleanAtomic(returnItem.id, "test return", "test@local"));
    assert.deepEqual(fallbackLogs, [], "known-type workflow, assignment, and transition paths must never use fallback");
  } finally {
    console.error = originalError;
    ctx.cleanup();
  }
}, { concurrency: false });

test("unknown content types preserve the legacy result but log the fallback", () => {
  const ctx = createContext();
  const originalError = console.error;
  const fallbackLogs = [];
  console.error = (...args) => {
    if (args[0] === "[workflow-transition] unknown content type fallback") fallbackLogs.push(args[1]);
  };
  try {
    const item = ctx.createItem("future_type");
    assert.doesNotThrow(() => ctx.repo.upsertWorkflowModel(item.id, { production_state: "analyzed" }, "test@local"));
    assert.deepEqual(fallbackLogs, [{ item_id: item.id, content_type: "future_type", fallback_content_type: "event" }]);
  } finally {
    console.error = originalError;
    ctx.cleanup();
  }
}, { concurrency: false });
