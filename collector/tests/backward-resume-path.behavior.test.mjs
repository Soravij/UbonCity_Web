import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const SOURCE_PATH = path.join(root, "server", "public", "workflow-backward-transitions.js");

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

function extractConstBlock(source, name) {
  const signature = `const ${name}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Const not found: ${name}`);
  let depth = 0;
  let inBlock = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
      inBlock = true;
    }
    if (char === "}") {
      depth -= 1;
      if (inBlock && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed const block: ${name}`);
}

function buildResolver(source) {
  const constSrc = extractConstBlock(source, "BACKWARD_RESUME_PATH_BY_STATE");
  const fnSrc = extractFunctionBlock(source, "resolveBackwardResumePath");

  const code = [
    constSrc,
    fnSrc,
    "module.exports = { resolveBackwardResumePath };",
  ].join("\n");

  const mod = {};
  const factory = new Function("module", code + `\nreturn module.exports;`);
  return factory({ exports: {} }).resolveBackwardResumePath;
}

test("production_state=ready_for_writer → returns article-intake path even when resume_path is assignment_review", () => {
  const source = readSource();
  const resolve = buildResolver(source);
  const result = resolve(42, {
    resume_path: "/?tab=review&item_id=42",
    backward_transitions: { production_state: "ready_for_writer" },
  });
  assert.equal(result, "/article-intake.html?id=42",
    "ready_for_writer must go to article-intake (3.1), not assignment_review");
});

test("production_state=field_working → returns handoff path (cascade case)", () => {
  const source = readSource();
  const resolve = buildResolver(source);
  const result = resolve(7, {
    resume_path: "/?tab=review&item_id=7",
    backward_transitions: { production_state: "field_working" },
  });
  assert.equal(result, "/?tab=handoff&item_id=7",
    "field_working must go to handoff (2.2)");
});

test("unknown production_state → falls back to result.resume_path", () => {
  const source = readSource();
  const resolve = buildResolver(source);
  const result = resolve(10, {
    resume_path: "/item-editor.html?id=10",
    backward_transitions: { production_state: "some_unknown_state" },
  });
  assert.equal(result, "/item-editor.html?id=10",
    "unknown state must fall back to result.resume_path");
});

test("non-tautological proof: emptying the table makes ready_for_writer fall back to wrong resume_path", () => {
  const original = readSource();

  const tableStart = original.indexOf("const BACKWARD_RESUME_PATH_BY_STATE");
  assert.ok(tableStart >= 0, "source must contain BACKWARD_RESUME_PATH_BY_STATE");
  const tableEnd = original.indexOf("};", tableStart) + 2;
  const tableBlock = original.slice(tableStart, tableEnd);
  assert.ok(tableBlock.includes("ready_for_writer"), "table must contain ready_for_writer entry");

  const patched = original.slice(0, tableStart)
    + "const BACKWARD_RESUME_PATH_BY_STATE = {};"
    + original.slice(tableEnd);
  assert.notEqual(original, patched, "patch must differ from original");

  const resolvePatched = buildResolver(patched);
  const patchedResult = resolvePatched(42, {
    resume_path: "/?tab=review&item_id=42",
    backward_transitions: { production_state: "ready_for_writer" },
  });
  assert.equal(patchedResult, "/?tab=review&item_id=42",
    "with empty table, falls back to wrong resume_path (regression proof)");

  const resolveOriginal = buildResolver(original);
  const originalResult = resolveOriginal(42, {
    resume_path: "/?tab=review&item_id=42",
    backward_transitions: { production_state: "ready_for_writer" },
  });
  assert.equal(originalResult, "/article-intake.html?id=42",
    "with real table, returns correct path");

  assert.notEqual(patchedResult, originalResult,
    "non-tautological: patched returns wrong path, original returns correct path");
});
