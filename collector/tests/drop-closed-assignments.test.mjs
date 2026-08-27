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

const dropClosedAssignmentsSource = extractNamedFunctionSource(indexServer, "dropClosedAssignments");
const dropClosedAssignments = new vm.Script(`(${dropClosedAssignmentsSource})`).runInNewContext();

test("dropClosedAssignments removes assignments with state closed", () => {
  const input = [
    { id: 1, state: "accepted" },
    { id: 2, state: "closed" },
    { id: 3, state: "revision_requested" },
    { id: 4, state: "Closed" },
    { id: 5, state: " closed " },
  ];
  const result = dropClosedAssignments(input);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.id), [1, 3]);
});

test("dropClosedAssignments keeps accepted / revision_requested / in_progress", () => {
  const input = [
    { id: 10, state: "accepted" },
    { id: 11, state: "revision_requested" },
    { id: 12, state: "in_progress" },
  ];
  const result = dropClosedAssignments(input);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((r) => r.id), [10, 11, 12]);
});

test("dropClosedAssignments returns [] for non-array input", () => {
  assert.equal(dropClosedAssignments(undefined).length, 0);
  assert.equal(dropClosedAssignments(null).length, 0);
  assert.equal(dropClosedAssignments("string").length, 0);
  assert.equal(dropClosedAssignments(123).length, 0);
});
