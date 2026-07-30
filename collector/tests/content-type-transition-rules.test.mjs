import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import {
  ASSIGNMENT_STATES,
  createRepository,
  PLACE_BACKWARD_PRODUCTION_TRANSITIONS,
  PRODUCTION_STATES,
  PUBLICATION_STATES,
  TRANSITION_RULES,
} from "../db/repository.mjs";
import { applyReviewAction, reopenReviewDecision, runQualityStage } from "../services/workflow.mjs";

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

const PLACE_PRODUCTION_RULES = Object.freeze({
  collected: ["analyzed"],
  analyzed: ["generated"],
  generated: ["ready_for_content", "analyzed"],
  ready_for_content: ["field_working", "generated"],
  field_working: ["ready_for_content", "field_review"],
  field_review: ["generated", "field_working", "writing_assigned"],
  writing_assigned: ["writing", "field_review"],
  writing: ["writing_assigned", "in_review"],
  in_review: ["ready_for_publish", "writing", "field_review"],
  ready_for_publish: ["submitted_for_admin_review", "in_review"],
  submitted_for_admin_review: ["completed", "in_review"],
  completed: [],
  needs_revision: [],
  rejected: [],
  brief_generated: [],
  content_in_progress: [],
});

const PLACE_BACKWARD_EDGES = Object.freeze({
  generated: Object.freeze({ analyzed: "in_process" }),
  field_working: Object.freeze({ ready_for_content: "in_process" }),
  field_review: Object.freeze({ field_working: "in_process", generated: "cross_process" }),
  ready_for_content: Object.freeze({ generated: "cross_process" }),
  writing_assigned: Object.freeze({ field_review: "cross_process" }),
  writing: Object.freeze({ writing_assigned: "in_process" }),
  in_review: Object.freeze({ writing: "in_process", field_review: "cross_process" }),
  ready_for_publish: Object.freeze({ in_review: "in_process" }),
  submitted_for_admin_review: Object.freeze({ in_review: "cross_process" }),
});

const FORWARD_REPLAY_PATHS = Object.freeze({
  "generated:analyzed": ["generated"],
  "field_working:ready_for_content": ["field_working"],
  "field_review:field_working": ["field_review"],
  "field_review:generated": ["ready_for_content", "field_working", "field_review"],
  "ready_for_content:generated": ["ready_for_content"],
  "writing_assigned:field_review": ["writing_assigned"],
  "writing:writing_assigned": ["writing"],
  "in_review:writing": ["in_review"],
  "in_review:field_review": ["writing_assigned", "writing", "in_review"],
  "ready_for_publish:in_review": ["ready_for_publish"],
  "submitted_for_admin_review:in_review": ["ready_for_publish", "submitted_for_admin_review"],
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

function expectedPlaceRules() {
  return serializeRules({ production: PLACE_PRODUCTION_RULES, publication: LEGACY_RULES.publication });
}

function assertAllTypeRulesMatchExpectedGraph() {
  const expectedLegacyRules = serializeRules({ production: LEGACY_RULES.production, publication: LEGACY_RULES.publication });
  const expectedPlace = expectedPlaceRules();
  for (const type of CONTENT_TYPES) {
    assert.deepEqual(
      serializeRules(TRANSITION_RULES[type]),
      type === "place" ? expectedPlace : expectedLegacyRules,
      type === "place" ? "place must contain exactly its positional ladder without parking edges" : `${type} must retain the complete legacy production/publication graph`
    );
  }
}

test("place contains only its final positional ladder while non-place types retain the complete legacy graph", () => {
  assertAllTypeRulesMatchExpectedGraph();
  assert.notStrictEqual(TRANSITION_RULES.place, TRANSITION_RULES.event, "content types must be independently mutable for 4b");

  const mutatedSet = TRANSITION_RULES.place.production.writing;
  mutatedSet.delete("in_review");
  try {
    assert.throws(() => assertAllTypeRulesMatchExpectedGraph(), /place must contain exactly/);
  } finally {
    mutatedSet.add("in_review");
  }
  const restoredSkip = TRANSITION_RULES.place.production.collected;
  restoredSkip.add("generated");
  try {
    assert.throws(() => assertAllTypeRulesMatchExpectedGraph(), /place must contain exactly/);
  } finally {
    restoredSkip.delete("generated");
  }
  assertAllTypeRulesMatchExpectedGraph();
});

test("place backward metadata is the only exposed backward path and remains attached to valid graph edges", () => {
  const expectedMetadata = Object.fromEntries(
    Object.entries(PLACE_BACKWARD_EDGES).map(([fromState, targets]) => [
      fromState,
      Object.fromEntries(Object.entries(targets).map(([toState, direction]) => [toState, direction])),
    ])
  );
  const actualMetadata = Object.fromEntries(
    Object.entries(PLACE_BACKWARD_PRODUCTION_TRANSITIONS).map(([fromState, targets]) => [
      fromState,
      Object.fromEntries(Object.entries(targets).map(([toState, metadata]) => [toState, metadata.direction])),
    ])
  );
  assert.deepEqual(actualMetadata, expectedMetadata);

  const ctx = createContext();
  try {
    for (const [fromState, targets] of Object.entries(PLACE_BACKWARD_EDGES)) {
      const item = ctx.createItem("place", { production_state: fromState });
      const expectedTargets = Object.entries(targets).map(([production_state, direction]) => ({
        production_state,
        direction,
        reason_code: direction === "cross_process" ? "place_backward_cross_process" : "place_backward_in_process",
        publication_state: "draft",
      }));
      const actualTargets = ctx.repo
        .listLegalBackwardProductionTransitions("place", fromState, item.id)
        .map(({ production_state, direction, reason_code, publication_state }) => ({ production_state, direction, reason_code, publication_state }));
      assert.deepEqual(actualTargets, expectedTargets, `${fromState} must expose only its policy-approved backward targets`);
    }
    assert.deepEqual(ctx.repo.listLegalBackwardProductionTransitions("event", "in_review"), [], "non-place must expose no backward targets");

    const mutatedEdge = TRANSITION_RULES.place.production.in_review;
    mutatedEdge.delete("writing");
    try {
      const item = ctx.createItem("place", { production_state: "in_review" });
      assert.throws(() => {
        assert.deepEqual(
          ctx.repo.listLegalBackwardProductionTransitions("place", "in_review", item.id).map((entry) => entry.production_state),
          ["writing", "field_review"],
        );
      }, "removing a backward graph edge must make this test fail");
    } finally {
      mutatedEdge.add("writing");
    }
  } finally {
    ctx.cleanup();
  }
});

test("every place backward transition records its policy reason and can replay forward to its original step", () => {
  const ctx = createContext();
  try {
    for (const [fromState, targets] of Object.entries(PLACE_BACKWARD_EDGES)) {
      for (const [targetState, direction] of Object.entries(targets)) {
        const startsApproved = fromState === "ready_for_publish" || fromState === "submitted_for_admin_review";
        const item = ctx.createItem("place", {
          production_state: fromState,
          publication_state: startsApproved ? "approved" : "draft",
        });
        const target = ctx.repo
          .listLegalBackwardProductionTransitions("place", fromState, item.id)
          .find((entry) => entry.production_state === targetState);
        assert.ok(target, `${fromState} -> ${targetState} must be offered by the real transition helper`);

        ctx.repo.upsertWorkflowModel(item.id, {
          production_state: target.production_state,
          publication_state: target.publication_state,
          last_transition_note: "กลับไปแก้ตามผลตรวจ",
        }, "test@local", { actor_role: "admin", reason_code: target.reason_code });
        assert.equal(ctx.repo.ensureWorkflowModel(item.id).production_state, targetState);
        assert.equal(ctx.repo.ensureWorkflowModel(item.id).publication_state, "draft");
        const transitions = ctx.repo.listWorkflowTransitionsByItem(item.id, 10);
        assert.ok(
          transitions.some((row) => row.state_group === "production" && row.from_state === fromState && row.to_state === targetState && row.reason_code === target.reason_code),
          `${fromState} -> ${targetState} must be written to workflow_transitions with its direction-specific reason code`
        );

        for (const nextState of FORWARD_REPLAY_PATHS[`${fromState}:${targetState}`]) {
          const publicationState = nextState === "ready_for_publish" || nextState === "submitted_for_admin_review" ? "approved" : "draft";
          ctx.repo.upsertWorkflowModel(item.id, {
            production_state: nextState,
            publication_state: publicationState,
          }, "test@local", { actor_role: "admin", reason_code: "test_forward_replay" });
        }
        assert.equal(ctx.repo.ensureWorkflowModel(item.id).production_state, fromState, `${fromState} must be reachable again after ${targetState}`);
      }
    }
  } finally {
    ctx.cleanup();
  }
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

    const returnItem = ctx.createItem("place", { production_state: "generated" });
    ctx.repo.createFieldPack({ content_item_id: returnItem.id, status: "ready_for_field", ai_summary: "test pack" });
    assert.doesNotThrow(() => ctx.repo.returnFieldPackToCleanAtomic(returnItem.id, "test return", "test@local"));
    assert.deepEqual(fallbackLogs, [], "known-type workflow, assignment, and transition paths must never use fallback");
  } finally {
    console.error = originalError;
    ctx.cleanup();
  }
}, { concurrency: false });

test("place return-to-clean walks every legal backward hop to analyzed without a shortcut", () => {
  const ctx = createContext();
  const paths = {
    generated: ["generated", "analyzed"],
    ready_for_content: ["ready_for_content", "generated", "analyzed"],
    field_working: ["field_working", "ready_for_content", "generated", "analyzed"],
    field_review: ["field_review", "generated", "analyzed"],
    writing_assigned: ["writing_assigned", "field_review", "generated", "analyzed"],
    writing: ["writing", "writing_assigned", "field_review", "generated", "analyzed"],
    in_review: ["in_review", "field_review", "generated", "analyzed"],
    submitted_for_admin_review: ["submitted_for_admin_review", "in_review", "field_review", "generated", "analyzed"],
  };
  try {
    for (const [fromState, states] of Object.entries(paths)) {
      const item = ctx.createItem("place", {
        production_state: fromState,
        publication_state: fromState === "submitted_for_admin_review" ? "approved" : "draft",
      });
      const pack = ctx.repo.createFieldPack({ content_item_id: item.id, status: "ready_for_field", ai_summary: `pack at ${fromState}` });
      const result = ctx.repo.returnFieldPackToCleanAtomic(item.id, "return through legal hops", "test@local", { actor_role: "admin" });
      assert.equal(result.next_state, "analyzed", `${fromState} must return to analyzed`);
      assert.equal(ctx.repo.ensureWorkflowModel(item.id).current_field_pack_id, null);
      const productionTransitions = ctx.repo
        .listWorkflowTransitionsByItem(item.id, 20)
        .filter((row) => row.state_group === "production" && row.reason_code === "field_pack_return_to_clean")
        .reverse();
      assert.deepEqual(
        productionTransitions.map((row) => [row.from_state, row.to_state]),
        states.slice(0, -1).map((state, index) => [state, states[index + 1]]),
        `${fromState} must record every return-to-clean hop`
      );
      assert.equal(
        ctx.db.prepare("SELECT archived_at FROM field_packs WHERE id=?").get(pack.id)?.archived_at != null,
        true,
        "return-to-clean archives rather than deletes the field pack"
      );
    }
  } finally {
    ctx.cleanup();
  }
});

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

test("place review flags preserve the production position, log every set or clear, and block a rejected item", () => {
  const ctx = createContext();
  try {
    const fieldItem = ctx.createItem("place", { production_state: "field_review" });
    const fieldAssignment = ctx.repo.createAssignment({
      content_item_id: fieldItem.id,
      assignment_kind: "field",
      state: "in_progress",
      assignee_name: "field worker",
      assignee_contact: "field@example.com",
    });
    ctx.repo.requestAssignmentRevisionWithReset(fieldAssignment.id, "test@local", { internal_note: "fix missing evidence" });
    let head = ctx.repo.ensureWorkflowModel(fieldItem.id);
    assert.equal(head.production_state, "field_working");
    assert.equal(head.place_review_flag, "revision_requested");
    ctx.repo.updateAssignmentState(fieldAssignment.id, "resubmitted", "test@local");
    head = ctx.repo.ensureWorkflowModel(fieldItem.id);
    assert.equal(head.production_state, "field_review");
    assert.equal(head.place_review_flag, "none");

    const governanceItem = ctx.createItem("place", { production_state: "in_review" });
    ctx.repo.upsertWorkflowModel(governanceItem.id, { place_review_flag: "rejected" }, "test@local", {
      actor_role: "admin",
      reason_code: "test_reject_flag",
    });
    assert.throws(
      () => ctx.repo.upsertWorkflowModel(governanceItem.id, { production_state: "ready_for_publish" }, "test@local"),
      /rejected; clear place_review_flag/
    );
    ctx.repo.upsertWorkflowModel(governanceItem.id, { place_review_flag: "none" }, "test@local", {
      actor_role: "admin",
      reason_code: "test_reopen_flag",
    });
    assert.doesNotThrow(() => ctx.repo.upsertWorkflowModel(governanceItem.id, { production_state: "ready_for_publish" }, "test@local"));

    const flagTransitions = ctx.repo.listWorkflowTransitionsByItem(fieldItem.id, 20)
      .filter((row) => row.state_group === "place_review_flag")
      .map((row) => `${row.from_state}->${row.to_state}`);
    assert.deepEqual(flagTransitions, ["revision_requested->none", "none->revision_requested"]);
  } finally {
    ctx.cleanup();
  }
});

test("governance review writes place flags on the legal backward step while non-place keeps its legacy state", () => {
  const ctx = createContext();
  try {
    const place = ctx.createItem("place", { production_state: "in_review" });
    ctx.repo.addReviewReport(place.id, null, { status: "pending", score: 0, issues: [] });
    applyReviewAction(ctx.repo, "admin@local", { content_item_id: place.id, action: "request_changes", notes: "rewrite" });
    let head = ctx.repo.ensureWorkflowModel(place.id);
    assert.equal(head.production_state, "writing");
    assert.equal(head.place_review_flag, "revision_requested");
    ctx.repo.upsertWorkflowModel(place.id, { production_state: "in_review", place_review_flag: "none" }, "admin@local");
    applyReviewAction(ctx.repo, "admin@local", { content_item_id: place.id, action: "reject", notes: "declined" });
    head = ctx.repo.ensureWorkflowModel(place.id);
    assert.equal(head.production_state, "in_review");
    assert.equal(head.place_review_flag, "rejected");
    reopenReviewDecision(ctx.repo, "admin@local", { content_item_id: place.id, notes: "reopen" });
    assert.equal(ctx.repo.ensureWorkflowModel(place.id).place_review_flag, "none");

    const event = ctx.createItem("event", { production_state: "in_review" });
    ctx.repo.addReviewReport(event.id, null, { status: "pending", score: 0, issues: [] });
    applyReviewAction(ctx.repo, "admin@local", { content_item_id: event.id, action: "request_changes", notes: "legacy" });
    assert.equal(ctx.repo.ensureWorkflowModel(event.id).production_state, "needs_revision");
  } finally {
    ctx.cleanup();
  }
});

test("quality pass moves place from the P1 gate to ready_for_content before recording review artifacts", async () => {
  const ctx = createContext();
  try {
    const item = ctx.createItem("place", { production_state: "generated" });
    ctx.db.prepare(`
      UPDATE content_items
      SET category='attractions', description_raw=?, meta_title=?, meta_description=?, slug=?, latitude=?, longitude=?
      WHERE id=?
    `).run("A sufficiently detailed place description. ".repeat(8), "Quality place", "A useful description for quality review that is long enough to satisfy the metadata score.", "quality-place", 15.2, 104.8, item.id);
    const result = await runQualityStage(ctx.repo, "quality@local", { contentItemId: item.id });
    assert.equal(result.reviewed, 1);
    assert.equal(ctx.repo.ensureWorkflowModel(item.id).production_state, "ready_for_content");
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS c FROM review_reports WHERE content_item_id=?").get(item.id).c, 1);
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
