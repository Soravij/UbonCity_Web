import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (!depth) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function extractRouteBody(route) {
  const start = source.indexOf(`app.post("${route}"`);
  if (start < 0) throw new Error(`missing route ${route}`);
  const arrow = source.indexOf("=> {", start);
  const open = source.indexOf("{", arrow);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (!depth) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed route ${route}`);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeHandler({ repo, overrides = {} }) {
  const closedIds = [];
  const origUpdate = repo.updateAssignmentState.bind(repo);
  repo.updateAssignmentState = (id, state, ...rest) => {
    if (state === "closed") closedIds.push(id);
    return origUpdate(id, state, ...rest);
  };

  const context = {
    repo,
    console,
    Date,
    ensureItemMutationAccess: overrides.ensureItemMutationAccess ?? (() => true),
    canManageArticleEditorialAssignments: overrides.canManageArticleEditorialAssignments ?? (() => true),
    actorPolicyRole: overrides.actorPolicyRole ?? (() => "admin"),
    canAssignInternalWork: overrides.canAssignInternalWork ?? (() => true),
    canAssignToUserByManagementLine: overrides.canAssignToUserByManagementLine ?? (() => true),
    canAssignUserToAssignmentKind: overrides.canAssignUserToAssignmentKind ?? (() => true),
    getUserAssignmentRole: overrides.getUserAssignmentRole ?? (() => "editor"),
    actorEmail: overrides.actorEmail ?? (() => "test@local"),
    getPrimaryEditorialAssignment: overrides.getPrimaryEditorialAssignment ?? (() => null),
    buildArticleProcessPayload: overrides.buildArticleProcessPayload ?? (() => ({})),
  };
  context.globalThis = context;

  const resolveSrc = extractFunction("resolvePlaceLadderWorkflowPatch");
  const compiled = `
${resolveSrc}
async function assignEditorial(req, res) {${extractRouteBody("/api/items/:id/article-editorial-assignments")}}
globalThis.handler = assignEditorial;
`;

  vm.runInNewContext(compiled, context, { filename: "editorial-assignment-route.js" });
  return { handler: context.handler, closedIds };
}

const ROUTE = "/api/items/:id/article-editorial-assignments";

test("place item with invalid production_state returns 409 without closing active assignment", async () => {
  const activeAssignment = { id: 77, assignee_user_id: 10, state: "assigned" };
  let updateAssignmentCalled = false;

  const repo = {
    getItem() {
      return { id: 1, type: "place", title: "Test Place" };
    },
    ensureWorkflowModel() {
      return { production_state: "writing", publication_state: "draft" };
    },
    updateAssignmentState() {
      updateAssignmentCalled = true;
    },
    createAssignmentWithWorkflow() {
      return { assignment: {} };
    },
    canTransition() { return true; },
    listWorkflowTransitionsByItem() { return []; },
    buildPublishableSourceByItem() { return null; },
  };

  const { handler, closedIds } = makeHandler({
    repo,
    overrides: {
      getPrimaryEditorialAssignment: () => activeAssignment,
    },
  });

  const req = {
    params: { id: "1" },
    body: { assignee_user_id: 5, replace_active: true },
    authUser: { id: 99, role: "admin" },
  };
  const res = makeResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 409, "should return 409");
  assert.equal(res.body.code, "EDITORIAL_ASSIGNMENT_INVALID_PRODUCTION_STATE");
  assert.match(res.body.error, /ready_for_writer/);
  assert.match(res.body.error, /writing/);
  assert.equal(updateAssignmentCalled, false, "updateAssignmentState should NOT be called");
  assert.deepEqual(closedIds, [], "active assignment should NOT be closed");
});

test("place item with ready_for_writer proceeds to create assignment", async () => {
  const activeAssignment = { id: 77, assignee_user_id: 10, state: "assigned" };

  const repo = {
    getItem() {
      return { id: 1, type: "place", title: "Test Place" };
    },
    ensureWorkflowModel() {
      return { production_state: "ready_for_writer", publication_state: "draft" };
    },
    updateAssignmentState() {},
    createAssignmentWithWorkflow() {
      return { assignment: { id: 88, state: "assigned" } };
    },
    canTransition() { return true; },
    listWorkflowTransitionsByItem() { return []; },
    buildPublishableSourceByItem() { return null; },
    logAudit() {},
  };

  const { handler } = makeHandler({
    repo,
    overrides: {
      getPrimaryEditorialAssignment: () => activeAssignment,
    },
  });

  const req = {
    params: { id: "1" },
    body: { assignee_user_id: 5, replace_active: true },
    authUser: { id: 99, role: "admin" },
  };
  const res = makeResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 201, `should succeed, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.assignment, "should return assignment");
});
