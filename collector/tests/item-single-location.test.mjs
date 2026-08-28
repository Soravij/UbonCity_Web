import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, it, before } from "node:test";
import { reportUnknownWorkflowState } from "../server/public/workflow-state-catalog.js";
import { PRODUCTION_STATES, PUBLICATION_STATES, ASSIGNMENT_STATES, PLACE_REVIEW_FLAGS } from "../db/repository.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const indexServer = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

// ── dropDuplicateManagedAssignments (vm.Script pattern) ──

function extractNamedFunctionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

const dropDuplicateManagedAssignmentsSource = extractNamedFunctionSource(indexServer, "dropDuplicateManagedAssignments");
const dropDuplicateManagedAssignments = new vm.Script(`(${dropDuplicateManagedAssignmentsSource})`).runInNewContext();

test("dropDuplicateManagedAssignments removes field:accepted", () => {
  const input = [
    { id: 1, assignment_kind: "field", state: "accepted", assignee_user_id: 99 },
    { id: 2, assignment_kind: "editorial", state: "assigned", assignee_user_id: 99 },
  ];
  const result = dropDuplicateManagedAssignments(input, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2);
});

test("dropDuplicateManagedAssignments keeps submitted of another user (not assignee)", () => {
  const input = [
    { id: 10, assignment_kind: "field", state: "submitted", assignee_user_id: 99 },
    { id: 11, assignment_kind: "field", state: "resubmitted", assignee_user_id: 99 },
    { id: 12, assignment_kind: "editorial", state: "assigned", assignee_user_id: 99 },
  ];
  const result = dropDuplicateManagedAssignments(input, 1);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((r) => r.id), [10, 11, 12]);
});

test("dropDuplicateManagedAssignments removes assignee===actor with owned-elsewhere state", () => {
  const input = [
    { id: 20, assignment_kind: "editorial", state: "assigned", assignee_user_id: 5 },
    { id: 21, assignment_kind: "field", state: "in_progress", assignee_user_id: 5 },
  ];
  const result = dropDuplicateManagedAssignments(input, 5);
  assert.equal(result.length, 0);
});

test("dropDuplicateManagedAssignments keeps editorial:assigned of another user", () => {
  const input = [
    { id: 30, assignment_kind: "editorial", state: "assigned", assignee_user_id: 99 },
  ];
  const result = dropDuplicateManagedAssignments(input, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 30);
});

test("dropDuplicateManagedAssignments drops field:accepted even when assignee===actor", () => {
  const input = [
    { id: 40, assignment_kind: "field", state: "accepted", assignee_user_id: 5 },
  ];
  const result = dropDuplicateManagedAssignments(input, 5);
  assert.equal(result.length, 0);
});

test("dropDuplicateManagedAssignments keeps editorial:accepted when assignee===actor", () => {
  const input = [
    { id: 50, assignment_kind: "editorial", state: "accepted", assignee_user_id: 5 },
  ];
  const result = dropDuplicateManagedAssignments(input, 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 50);
});

// ── string-snippet: buildManagedAssignmentsForActor wraps dropDuplicateManagedAssignments ──

test("buildManagedAssignmentsForActor owner path wraps dropDuplicateManagedAssignments(dropClosedAssignments(...))", () => {
  assert.ok(
    indexServer.includes("dropDuplicateManagedAssignments(dropClosedAssignments("),
    "owner return should wrap dropClosedAssignments with dropDuplicateManagedAssignments"
  );
});

test("buildManagedAssignmentsForActor admin/user path wraps dropDuplicateManagedAssignments(..., actorUserId)", () => {
  const fnSource = extractNamedFunctionSource(indexServer, "buildManagedAssignmentsForActor");
  assert.ok(
    fnSource.includes(".slice("),
    "admin/user path should have .slice("
  );
  assert.ok(
    fnSource.includes(", actorUserId)"),
    "admin/user path should pass actorUserId to dropDuplicateManagedAssignments"
  );
});

// ── resolveItemScopeContext: onlyFieldAcceptedOpen (vm.Script pattern) ──

const OPEN_STATES = new Set(["assigned", "in_progress", "submitted", "resubmitted", "revision_requested", "accepted"]);

function createResolveItemScopeContext() {
  const fnSource = extractNamedFunctionSource(indexServer, "resolveItemScopeContext");
  const stubs = {
    repo: {
      listAssignmentsByItem: (itemId) => stubs._assignments || [],
      buildPublishableSourceByItem: () => ({ checks: {} }),
    },
    hasOpenAssignment: (assignment) => {
      const state = String(assignment?.state || assignment?.assignment_state || "").trim().toLowerCase();
      return OPEN_STATES.has(state);
    },
    selectPrimaryEditorialAssignment: (list) => (Array.isArray(list) && list.length > 0 ? list[0] : null),
    selectPrimaryOpenAssignment: (list) => (Array.isArray(list) && list.length > 0 ? list[0] : null),
    console,
    _assignments: [],
  };
  const wrapper = `(function(resolveItemScopeContext) { return resolveItemScopeContext; })`;
  const fn = new vm.Script(`${wrapper}(${fnSource})`).runInNewContext(stubs);
  return (assignments) => {
    stubs._assignments = assignments;
    return fn({ id: 1 });
  };
}

const callResolveItemScopeContext = createResolveItemScopeContext();

test("resolveItemScopeContext: [field/accepted] → onlyFieldAcceptedOpen=true", () => {
  const result = callResolveItemScopeContext([
    { assignment_kind: "field", state: "accepted", assignee_user_id: 1 },
  ]);
  assert.equal(result.onlyFieldAcceptedOpen, true);
});

test("resolveItemScopeContext: [field/accepted, editorial/assigned] → onlyFieldAcceptedOpen=false", () => {
  const result = callResolveItemScopeContext([
    { assignment_kind: "field", state: "accepted", assignee_user_id: 1 },
    { assignment_kind: "editorial", state: "assigned", assignee_user_id: 2 },
  ]);
  assert.equal(result.onlyFieldAcceptedOpen, false);
});

test("resolveItemScopeContext: [field/accepted, editorial/accepted] → onlyFieldAcceptedOpen=false", () => {
  const result = callResolveItemScopeContext([
    { assignment_kind: "field", state: "accepted", assignee_user_id: 1 },
    { assignment_kind: "editorial", state: "accepted", assignee_user_id: 2 },
  ]);
  assert.equal(result.onlyFieldAcceptedOpen, false);
});

test("resolveItemScopeContext: [editorial/accepted] → onlyFieldAcceptedOpen=false", () => {
  const result = callResolveItemScopeContext([
    { assignment_kind: "editorial", state: "accepted", assignee_user_id: 1 },
  ]);
  assert.equal(result.onlyFieldAcceptedOpen, false);
});

test("resolveItemScopeContext: [field/in_progress] → onlyFieldAcceptedOpen=false", () => {
  const result = callResolveItemScopeContext([
    { assignment_kind: "field", state: "in_progress", assignee_user_id: 1 },
  ]);
  assert.equal(result.onlyFieldAcceptedOpen, false);
});

test("resolveItemScopeContext: [] → onlyFieldAcceptedOpen=false", () => {
  const result = callResolveItemScopeContext([]);
  assert.equal(result.onlyFieldAcceptedOpen, false);
});

test("resolveItemScopeContext: [field/accepted, field/closed] → onlyFieldAcceptedOpen=true (closed filtered)", () => {
  const result = callResolveItemScopeContext([
    { assignment_kind: "field", state: "accepted", assignee_user_id: 1 },
    { assignment_kind: "field", state: "closed", assignee_user_id: 2 },
  ]);
  assert.equal(result.onlyFieldAcceptedOpen, true);
});

test("resolveItemScopeContext: [FIELD/ACCEPTED with whitespace] → onlyFieldAcceptedOpen=true (trim+lowercase)", () => {
  const result = callResolveItemScopeContext([
    { assignment_kind: " FIELD ", state: " ACCEPTED ", assignee_user_id: 1 },
  ]);
  assert.equal(result.onlyFieldAcceptedOpen, true);
});

const APP_JS_PATH = path.resolve(collectorRoot, "server", "public", "app.js");

function loadResolveQueueBucket() {
  const src = fs.readFileSync(APP_JS_PATH, "utf8");

  const extractFunction = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} not found in app.js`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces while extracting ${name}`);
  };

  const catalog = {
    production_states: [...PRODUCTION_STATES],
    publication_states: [...PUBLICATION_STATES],
    assignment_states: [...ASSIGNMENT_STATES],
    place_review_flags: [...PLACE_REVIEW_FLAGS],
  };

  const names = [
    "getItemWorkflowSnapshot",
    "getUnknownWorkflowState",
    "isAssignmentContextReady",
    "resolveQueueBucket",
  ];

  const stateInit = `const state = { workflowStates: ${JSON.stringify(catalog)}, workflowStateLogKeys: new Set() };`;
  const body = `${stateInit}\n${names.map(extractFunction).join("\n\n")}`;
  const fn = new Function("reportUnknownWorkflowState", `${body}\nreturn { ${names.join(", ")} };`);
  return fn(reportUnknownWorkflowState);
}

describe("resolveQueueBucket unknown_workflow from ADVANCED_PRODUCTION_STATES", () => {
  let resolveQueueBucket;

  before(() => {
    ({ resolveQueueBucket } = loadResolveQueueBucket());
  });

  it("writing_assigned + no open assignment + no field pack → unknown_workflow", () => {
    const item = {
      production_state: "writing_assigned",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: false,
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "unknown_workflow",
      `expected unknown_workflow but got ${bucket}`);
  });

  it("analyzed + no open assignment + no field pack → raw_prep", () => {
    const item = {
      production_state: "analyzed",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: false,
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "raw_prep",
      `expected raw_prep but got ${bucket}`);
  });

  it("only_field_accepted_open=true + field pack ready_for_field + field_review → handoff", () => {
    const item = {
      production_state: "field_review",
      publication_state: "draft",
      has_accepted_assignment: true,
      has_open_assignment: true,
      only_field_accepted_open: true,
      current_field_pack_id: 10,
      current_field_pack_status: "ready_for_field",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "handoff",
      `expected handoff but got ${bucket}`);
  });

  it("only_field_accepted_open=false + open assignment → assignment", () => {
    const item = {
      production_state: "field_working",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: true,
      only_field_accepted_open: false,
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "assignment",
      `expected assignment but got ${bucket}`);
  });

  it("only_field_accepted_open undefined + open assignment → assignment", () => {
    const item = {
      production_state: "field_working",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: true,
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "assignment",
      `expected assignment but got ${bucket}`);
  });
});
