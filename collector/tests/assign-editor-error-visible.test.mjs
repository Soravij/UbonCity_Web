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

test("btn-assign-editor error handler uses setBanner instead of setInlineStatus", () => {
  const source = readSource();
  const handlerMatch = source.match(
    /qs\("btn-assign-editor"\)\?\.addEventListener\("click",\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)/
  );
  assert.ok(handlerMatch, "btn-assign-editor handler not found");
  const handler = handlerMatch[0];
  assert.ok(
    handler.includes("setBanner(error.message, \"error\")"),
    "error path should call setBanner"
  );
  assert.ok(
    !handler.includes("setInlineStatus"),
    "error path should NOT call setInlineStatus"
  );
});

test("btn-assign-editor success path clears banner", () => {
  const source = readSource();
  const handlerMatch = source.match(
    /qs\("btn-assign-editor"\)\?\.addEventListener\("click",\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)/
  );
  assert.ok(handlerMatch, "btn-assign-editor handler not found");
  const handler = handlerMatch[0];
  assert.ok(
    handler.includes("setBanner(\"\")"),
    "success path should clear banner with setBanner(\"\")"
  );
});
