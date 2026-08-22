import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

function extractFunctionSource(source, functionName) {
  const signatures = [`async function ${functionName}`, `function ${functionName}`];
  const start = signatures
    .map((signature) => source.indexOf(signature))
    .find((index) => index >= 0) ?? -1;
  assert.notEqual(start, -1, `function ${functionName} should exist in source`);
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
  assert.notEqual(bodyStart, -1, `function ${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function block: ${functionName}`);
}

test("onTransition reloads deliverables bundle even when resume_path matches current URL", () => {
  const fnSource = extractFunctionSource(appJs, "renderAssignmentBackwardTransitionControls");

  const resumePathCheck = fnSource.indexOf("result.resume_path !== `${window.location.pathname}${window.location.search}`");
  assert.notEqual(resumePathCheck, -1, "onTransition must contain resume_path comparison against current URL");

  const navigateBranch = fnSource.indexOf("window.location.assign(result.resume_path)");
  assert.notEqual(navigateBranch, -1, "onTransition must contain window.location.assign for different resume_path");

  const bundleReload = fnSource.indexOf("loadAssignmentDeliverablesBundle({ showStatus: false })");
  assert.notEqual(bundleReload, -1, "onTransition must call loadAssignmentDeliverablesBundle after transition succeeds");

  assert.ok(
    bundleReload > navigateBranch,
    "loadAssignmentDeliverablesBundle call must appear after window.location.assign branch so it runs in the non-navigate path",
  );

  const setStatusLine = fnSource.indexOf('setStatus("assignment-status", "ถอยสถานะแล้ว")');
  assert.notEqual(setStatusLine, -1, "onTransition must set status after transition");
  assert.ok(
    bundleReload > setStatusLine,
    "loadAssignmentDeliverablesBundle must appear after setStatus to ensure it runs in the fallthrough path",
  );
});

test("onTransition does not return early before loading deliverables bundle in non-navigate path", () => {
  const fnSource = extractFunctionSource(appJs, "renderAssignmentBackwardTransitionControls");

  const navigateAssignIdx = fnSource.indexOf("window.location.assign(result.resume_path)");
  assert.notEqual(navigateAssignIdx, -1, "navigate branch must exist");

  const returnIdx = fnSource.indexOf("return;", navigateAssignIdx);
  assert.notEqual(returnIdx, -1, "navigate branch must return early");
  assert.ok(returnIdx > navigateAssignIdx, "return must follow window.location.assign");

  const bundleReloadIdx = fnSource.indexOf("loadAssignmentDeliverablesBundle({ showStatus: false })");
  assert.notEqual(bundleReloadIdx, -1, "bundle reload must exist");
  assert.ok(bundleReloadIdx > returnIdx, "bundle reload must appear after the navigate+return block");

  const closingBraceIdx = fnSource.indexOf("}", returnIdx);
  assert.notEqual(closingBraceIdx, -1, "closing brace of navigate if-block must exist");
  assert.ok(closingBraceIdx > returnIdx, "closing brace must follow return");

  const fallthroughStart = closingBraceIdx + 1;
  const betweenIfAndBundle = fnSource.slice(fallthroughStart, bundleReloadIdx);
  assert.doesNotMatch(betweenIfAndBundle, /\breturn\s*;/, "no early return in fallthrough path between if-block and bundle reload");
});
