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

const PLACE_LADDER_EDGES = Object.freeze([
  ["generated", "brief_generated"],
  ["brief_generated", "generated"],
  ["ready_for_content", "field_working"],
  ["field_working", "ready_for_content"],
  ["field_working", "field_review"],
  ["field_review", "brief_generated"],
  ["field_review", "field_working"],
  ["field_review", "writing_assigned"],
  ["writing_assigned", "writing"],
  ["writing", "writing_assigned"],
  ["writing", "in_review"],
  ["in_review", "writing"],
  ["in_review", "field_review"],
  ["ready_for_publish", "in_review"],
  ["submitted_for_admin_review", "in_review"],
]);

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

function expectedPlaceRules() {
  const expectedContentRules = serializeRules({ production: LEGACY_RULES.production, publication: LEGACY_RULES.publication });
  for (const [from, to] of PLACE_LADDER_EDGES) {
    expectedContentRules.production[from] ||= [];
    if (!expectedContentRules.production[from].includes(to)) {
      expectedContentRules.production[from].push(to);
    }
    expectedContentRules.production[from].sort();
  }
  return expectedContentRules;
}

function assertAllTypeRulesMatchExpectedGraph() {
  const expectedLegacyRules = serializeRules({ production: LEGACY_RULES.production, publication: LEGACY_RULES.publication });
  const expectedPlace = expectedPlaceRules();
  for (const type of CONTENT_TYPES) {
    assert.deepEqual(
      serializeRules(TRANSITION_RULES[type]),
      type === "place" ? expectedPlace : expectedLegacyRules,
      type === "place" ? "place must contain exactly the legacy graph plus the approved ladder edges" : `${type} must retain the complete legacy production/publication graph`
    );
  }
}

test("place adds exactly the approved ladder edges while non-place types retain the complete legacy graph", () => {
  assertAllTypeRulesMatchExpectedGraph();
  assert.notStrictEqual(TRANSITION_RULES.place, TRANSITION_RULES.event, "content types must be independently mutable for 4b");

  const mutatedSet = TRANSITION_RULES.place.production.writing;
  mutatedSet.delete("in_review");
  try {
    assert.throws(() => assertAllTypeRulesMatchExpectedGraph(), /place must contain exactly/);
  } finally {
    mutatedSet.add("in_review");
  }
  assertAllTypeRulesMatchExpectedGraph();
});

test("each content type accepts exactly its expected transition graph", () => {
  const ctx = createContext();
  const originalError = console.error;
  const fallbackLogs = [];
  console.error = (...args) => {
    if (args[0] === "[workflow-transition] unknown content type fallback") fallbackLogs.push(args[1]);
  };
  try {
    for (const type of CONTENT_TYPES) {
      for (const [group, states] of [["production", [...PRODUCTION_STATES]], ["publication", [...PUBLICATION_STATES]], ["assignment", [...ASSIGNMENT_STATES]]]) {
        const expectedRules = type === "place" && group !== "assignment"
          ? expectedPlaceRules()[group]
          : serializeRules(group === "assignment" ? { assignment: LEGACY_RULES.assignment } : { [group]: LEGACY_RULES[group] })[group];
        const rules = expectedRules;
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
    const assignmentItem = ctx.createItem("place", { production_state: "ready_for_content" });
    const assignment = ctx.repo.createAssignment({
      content_item_id: assignmentItem.id,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "test worker",
      assignee_contact: "test@example.com",
    });
    assert.doesNotThrow(() => ctx.repo.updateAssignmentState(assignment.id, "in_progress", "test@local"));
    assert.equal(ctx.repo.ensureWorkflowModel(assignmentItem.id).production_state, "field_working");
    assert.doesNotThrow(() => ctx.repo.updateAssignmentState(assignment.id, "submitted", "test@local"));
    assert.equal(ctx.repo.ensureWorkflowModel(assignmentItem.id).production_state, "field_review");

    const returnItem = ctx.createItem("place", { production_state: "brief_generated" });
    ctx.repo.createFieldPack({ content_item_id: returnItem.id, status: "ready_for_field", ai_summary: "test pack" });
    assert.doesNotThrow(() => ctx.repo.returnFieldPackToCleanAtomic(returnItem.id, "test return", "test@local"));
    assert.deepEqual(fallbackLogs, [], "known-type workflow, assignment, and transition paths must never use fallback");
  } finally {
    console.error = originalError;
    ctx.cleanup();
  }
}, { concurrency: false });

test("field assignment state changes advance only place through the new field ladder", () => {
  const ctx = createContext();
  try {
    const place = ctx.createItem("place", { production_state: "ready_for_content" });
    const placeAssignment = ctx.repo.createAssignment({
      content_item_id: place.id,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "place worker",
      assignee_contact: "place@example.com",
    });
    ctx.repo.updateAssignmentState(placeAssignment.id, "in_progress", "test@local");
    assert.equal(ctx.repo.ensureWorkflowModel(place.id).production_state, "field_working");
    ctx.repo.updateAssignmentState(placeAssignment.id, "submitted", "test@local");
    assert.equal(ctx.repo.ensureWorkflowModel(place.id).production_state, "field_review");

    const event = ctx.createItem("event", { production_state: "ready_for_content" });
    const eventAssignment = ctx.repo.createAssignment({
      content_item_id: event.id,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "event worker",
      assignee_contact: "event@example.com",
    });
    ctx.repo.updateAssignmentState(eventAssignment.id, "in_progress", "test@local");
    assert.equal(ctx.repo.ensureWorkflowModel(event.id).production_state, "ready_for_content");
  } finally {
    ctx.cleanup();
  }
});

test("legacy place field sync logs its skipped ladder write instead of failing the assignment", () => {
  const ctx = createContext();
  const originalError = console.error;
  const skippedLogs = [];
  console.error = (...args) => {
    if (args[0] === "[workflow-transition] skipped production sync") skippedLogs.push(args[1]);
  };
  try {
    const place = ctx.createItem("place", { production_state: "collected" });
    const assignment = ctx.repo.createAssignment({
      content_item_id: place.id,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "legacy worker",
      assignee_contact: "legacy@example.com",
    });
    assert.doesNotThrow(() => ctx.repo.updateAssignmentState(assignment.id, "in_progress", "test@local"));
    assert.equal(ctx.repo.ensureWorkflowModel(place.id).production_state, "collected");
    assert.deepEqual(skippedLogs, [{
      source: "field_assignment_state",
      item_id: place.id,
      content_type: "place",
      current_production_state: "collected",
      attempted_production_state: "field_working",
    }]);
  } finally {
    console.error = originalError;
    ctx.cleanup();
  }
}, { concurrency: false });

test("atomic editorial assignment creation preserves legacy place state and rolls back when workflow write fails", () => {
  const ctx = createContext();
  try {
    for (const productionState of ["collected", "analyzed", "content_in_progress"]) {
      const item = ctx.createItem("place", { production_state: productionState });
      const result = ctx.repo.createAssignmentWithWorkflow(
        {
          content_item_id: item.id,
          assignment_kind: "editorial",
          state: "assigned",
          assignee_name: `legacy editor ${productionState}`,
          assignee_contact: `${productionState}@example.com`,
        },
        null,
        { actor_email: "test@local", actor_role: "admin", reason_code: "test_editorial_assignment" },
        { publication_state: "draft", last_transition_note: "legacy editorial assignment" },
        "test@local",
        { actor_role: "admin", reason_code: "test_editorial_assignment" }
      );
      assert.ok(result.assignment.id);
      assert.equal(ctx.repo.ensureWorkflowModel(item.id).production_state, productionState);
    }

    const ladderItem = ctx.createItem("place", { production_state: "field_review" });
    ctx.repo.createAssignmentWithWorkflow(
      {
        content_item_id: ladderItem.id,
        assignment_kind: "editorial",
        state: "assigned",
        assignee_name: "ladder editor",
        assignee_contact: "ladder@example.com",
      },
      null,
      { actor_email: "test@local", actor_role: "admin", reason_code: "test_editorial_assignment" },
      { production_state: "writing_assigned", publication_state: "draft" },
      "test@local",
      { actor_role: "admin", reason_code: "test_editorial_assignment" }
    );
    assert.equal(ctx.repo.ensureWorkflowModel(ladderItem.id).production_state, "writing_assigned");

    const failingItem = ctx.createItem("place", { production_state: "field_review" });
    ctx.db.exec(`
      CREATE TRIGGER fail_editorial_workflow_write
      BEFORE UPDATE ON content_workflow_models
      WHEN NEW.content_item_id=${Number(failingItem.id)}
      BEGIN
        SELECT RAISE(ABORT, 'forced workflow write failure');
      END;
    `);
    assert.throws(() => ctx.repo.createAssignmentWithWorkflow(
      {
        content_item_id: failingItem.id,
        assignment_kind: "editorial",
        state: "assigned",
        assignee_name: "failing editor",
        assignee_contact: "failing@example.com",
      },
      null,
      { actor_email: "test@local", actor_role: "admin", reason_code: "test_editorial_assignment" },
      { production_state: "writing_assigned", publication_state: "draft" },
      "test@local",
      { actor_role: "admin", reason_code: "test_editorial_assignment" }
    ), /forced workflow write failure/);
    assert.equal(
      ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignments WHERE content_item_id=?").get(failingItem.id)?.c,
      0,
      "the assignment insert must roll back with its workflow write"
    );
  } finally {
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

test("shared assignment transitions do not resolve an irrelevant unknown content-type fallback", () => {
  const ctx = createContext();
  const originalError = console.error;
  const fallbackLogs = [];
  console.error = (...args) => {
    if (args[0] === "[workflow-transition] unknown content type fallback") fallbackLogs.push(args[1]);
  };
  try {
    const item = ctx.createItem("future_type");
    const assignment = ctx.repo.createAssignment({
      content_item_id: item.id,
      assignment_kind: "field",
      state: "assigned",
      assignee_name: "future worker",
      assignee_contact: "future@example.com",
    });
    ctx.repo.updateAssignmentState(assignment.id, "in_progress", "test@local");
    assert.deepEqual(fallbackLogs, []);
  } finally {
    console.error = originalError;
    ctx.cleanup();
  }
}, { concurrency: false });
