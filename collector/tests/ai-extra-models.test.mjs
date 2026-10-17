import test from "node:test";
import assert from "node:assert/strict";
import { parseExtraModels } from "../config/ai.mjs";

test("parseExtraModels handles empty, multiple, and missing-label input", () => {
  assert.deepEqual(parseExtraModels(""), []);
  assert.deepEqual(parseExtraModels(undefined), []);
  assert.deepEqual(parseExtraModels("a/x|Label X; b/y|Label Y"), [
    { model: "a/x", label: "Label X" },
    { model: "b/y", label: "Label Y" },
  ]);
  assert.deepEqual(parseExtraModels("a/x|;b/y"), [
    { model: "a/x", label: "a/x" },
    { model: "b/y", label: "b/y" },
  ]);
});
