import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const SOURCE_PATH = path.join(root, "server", "public", "article-intake.js");

function readSource() {
  return fs.readFileSync(SOURCE_PATH, "utf8");
}

function extractFunctionBlock(source, name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function block: ${name}`);
}

function buildTestHarness(source) {
  const processForItemSrc = extractFunctionBlock(source, "processForItem");
  const primaryAssignmentForItemSrc = extractFunctionBlock(source, "primaryAssignmentForItem");
  const hasAssignedWriterSrc = extractFunctionBlock(source, "hasAssignedWriter");

  const code = [
    processForItemSrc,
    primaryAssignmentForItemSrc,
    hasAssignedWriterSrc,
    "module.exports = { primaryAssignmentForItem, hasAssignedWriter };",
  ].join("\n");

  const mod = {};
  const factory = new Function("state", "module", code + `\nreturn module.exports;`);
  return (state) => factory(state, { exports: {} });
}

const ACTIVE_STATES = ["assigned", "in_progress", "submitted", "resubmitted", "revision_requested"];
const INACTIVE_STATES = ["closed", "completed", "rejected", "withdrawn"];

function makeState(overrides = {}) {
  return {
    processByItemId: {},
    editorAssignmentByItemId: {},
    ...overrides,
  };
}

test("all assignments inactive (closed/completed/rejected/withdrawn) → primaryAssignmentForItem returns null", () => {
  const source = readSource();
  const build = buildTestHarness(source);

  for (const inactiveState of INACTIVE_STATES) {
    const state = makeState({
      processByItemId: {
        10: {
          editorial_assignments: [
            { id: 100, state: "closed", assignee_user_id: 5, assignee_display_name: "A" },
            { id: 101, state: inactiveState, assignee_user_id: 6, assignee_display_name: "B" },
          ],
        },
      },
    });
    const { primaryAssignmentForItem } = build(state);
    const result = primaryAssignmentForItem(10);
    assert.equal(result, null, `state="${inactiveState}" must yield null, got ${JSON.stringify(result)}`);
  }
});

test("all assignments inactive → hasAssignedWriter returns false", () => {
  const source = readSource();
  const build = buildTestHarness(source);

  const state = makeState({
    processByItemId: {
      20: {
        editorial_assignments: [
          { id: 200, state: "closed", assignee_user_id: 5, assignee_display_name: "Writer A" },
          { id: 201, state: "completed", assignee_user_id: 6, assignee_display_name: "Writer B" },
        ],
      },
    },
  });
  const { hasAssignedWriter } = build(state);
  const result = hasAssignedWriter({ id: 20 });
  assert.equal(result, false, "hasAssignedWriter must be false when all assignments are inactive");
});

test("one active assignment mixed with closed → returns the active one, not assignments[0]", () => {
  const source = readSource();
  const build = buildTestHarness(source);

  for (const activeState of ACTIVE_STATES) {
    const state = makeState({
      processByItemId: {
        30: {
          editorial_assignments: [
            { id: 300, state: "closed", assignee_user_id: 1, assignee_display_name: "Closed Writer" },
            { id: 301, state: activeState, assignee_user_id: 2, assignee_display_name: "Active Writer" },
            { id: 302, state: "completed", assignee_user_id: 3, assignee_display_name: "Done Writer" },
          ],
        },
      },
    });
    const { primaryAssignmentForItem } = build(state);
    const result = primaryAssignmentForItem(30);
    assert.ok(result !== null, `state="${activeState}" must yield a result`);
    assert.equal(result.id, 301, `state="${activeState}" must return assignment with id 301 (active), not assignments[0] (id 300 closed)`);
    assert.equal(result.state, activeState, `returned assignment state must be "${activeState}"`);
  }
});

test("non-tautological proof: removing activeStates filter breaks active-detection (FAIL expected)", () => {
  const original = readSource();

  const filterLine = 'const activeStates = new Set(["assigned", "in_progress", "submitted", "resubmitted", "revision_requested"]);';
  assert.ok(original.includes(filterLine), "source must contain the activeStates filter line");

  const patched = original.replace(filterLine, "const activeStates = new Set();");
  assert.notEqual(original, patched, "patch must differ from original");
  assert.ok(patched.includes("new Set()"), "patched source must have empty Set");

  const state = makeState({
    processByItemId: {
      40: {
        editorial_assignments: [
          { id: 400, state: "closed", assignee_user_id: 1, assignee_display_name: "Closed Writer" },
          { id: 401, state: "in_progress", assignee_user_id: 2, assignee_display_name: "Active Writer" },
        ],
      },
    },
    editorAssignmentByItemId: {
      40: { id: 999, state: "closed", assignee_user_id: 7, assignee_display_name: "Fallback Writer" },
    },
  });

  const buildOriginal = buildTestHarness(original);
  const { primaryAssignmentForItem: primaryOriginal } = buildOriginal(state);
  const originalResult = primaryOriginal(40);
  assert.ok(originalResult !== null, "original must find active assignment");
  assert.equal(originalResult.id, 401, "original returns active assignment (in_progress)");

  const buildPatched = buildTestHarness(patched);
  const { primaryAssignmentForItem: primaryPatched } = buildPatched(state);
  const patchedResult = primaryPatched(40);
  assert.ok(patchedResult !== null, "patched returns fallback (not null)");
  assert.equal(patchedResult.id, 999, "patched returns fallback because empty Set makes find() miss active assignment");

  assert.notEqual(originalResult.id, patchedResult.id,
    "non-tautological: original finds active (401), patched falls back to fallback (999)");
});
