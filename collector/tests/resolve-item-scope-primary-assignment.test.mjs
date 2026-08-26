import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const indexServer = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

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

import { hasOpenAssignment } from "../services/publishable-assignment-candidate.mjs";

function extractConstSource(source, name) {
  const marker = `const ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf(");", start);
  assert.notEqual(end, -1, `${name} should have end`);
  return source.slice(start, end + 2);
}

function runResolveItemScopeContext(assignments, itemId = 1) {
  const context = {
    repo: {
      listAssignmentsByItem() {
        return assignments;
      },
      buildPublishableSourceByItem() {
        return { checks: { assignment_accepted: false } };
      },
    },
    console,
    hasOpenAssignment,
  };
  const source = `
${extractConstSource(indexServer, "PRIMARY_OPEN_ASSIGNMENT_STATE_PRIORITY")}
${extractNamedFunctionSource(indexServer, "selectPrimaryOpenAssignment")}
${extractNamedFunctionSource(indexServer, "selectPrimaryEditorialAssignment")}
${extractNamedFunctionSource(indexServer, "resolveItemScopeContext")}
resolveItemScopeContext;
`;
  const fn = vm.runInNewContext(source, context, { filename: "resolveItemScopeContext.js" });
  return fn({ id: itemId });
}

test("resolveItemScopeContext picks open field assignment when all editorial assignments are closed", () => {
  const assignments = [
    { id: 10, assignment_kind: "editorial", state: "closed", assignee_user_id: 100, assigned_by_user_id: 200 },
    { id: 11, assignment_kind: "editorial", state: "closed", assignee_user_id: 101, assigned_by_user_id: 201 },
    { id: 12, assignment_kind: "field", state: "revision_requested", assignee_user_id: 102, assigned_by_user_id: 202 },
  ];

  const result = runResolveItemScopeContext(assignments);

  assert.equal(result.primaryAssignment?.id, 12, "should pick the field assignment with revision_requested");
  assert.equal(result.hasOpenAssignment, true, "hasOpenAssignment should be true");
});

test("resolveItemScopeContext picks active editorial assignment over open field assignment", () => {
  const assignments = [
    { id: 10, assignment_kind: "editorial", state: "in_progress", assignee_user_id: 100, assigned_by_user_id: 200 },
    { id: 12, assignment_kind: "field", state: "revision_requested", assignee_user_id: 102, assigned_by_user_id: 202 },
  ];

  const result = runResolveItemScopeContext(assignments);

  assert.equal(result.primaryAssignment?.id, 10, "should pick the active editorial assignment");
  assert.equal(result.hasOpenAssignment, true, "hasOpenAssignment should be true");
});

test("resolveItemScopeContext falls back to first assignment when all are closed", () => {
  const assignments = [
    { id: 10, assignment_kind: "editorial", state: "closed", assignee_user_id: 100, assigned_by_user_id: 200 },
    { id: 12, assignment_kind: "field", state: "closed", assignee_user_id: 102, assigned_by_user_id: 202 },
  ];

  const result = runResolveItemScopeContext(assignments);

  assert.equal(result.primaryAssignment?.id, 10, "should fall back to first assignment");
  assert.equal(result.hasOpenAssignment, false, "hasOpenAssignment should be false");
});

test("selectPrimaryOpenAssignment picks revision_requested over accepted when editorial is accepted", () => {
  const assignments = [
    { id: 40, assignment_kind: "editorial", state: "accepted", assignee_user_id: 100, assigned_by_user_id: 200 },
    { id: 29, assignment_kind: "field", state: "revision_requested", assignee_user_id: 102, assigned_by_user_id: 202 },
  ];

  const result = runResolveItemScopeContext(assignments);

  assert.equal(result.primaryAssignment?.id, 29, "should pick field assignment with revision_requested over accepted editorial");
  assert.equal(result.hasOpenAssignment, true, "hasOpenAssignment should be true");
});
