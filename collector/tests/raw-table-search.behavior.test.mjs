import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const appSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${functionName} should close`);
}

const rawItemMatchesSearch = Function(`return (${extractFunctionSource(appSource, "rawItemMatchesSearch")});`)();

test("raw search matches every term across title in any order", () => {
  const item = { id: 256, title: "Ubon Street Art - Orange Cat" };
  assert.equal(rawItemMatchesSearch(item, "street art"), true);
  assert.equal(rawItemMatchesSearch(item, "street cat"), true);
  assert.equal(rawItemMatchesSearch(item, "street dog"), false);
});

test("raw search matches item id with or without #", () => {
  const item = { id: 256, title: "x" };
  assert.equal(rawItemMatchesSearch(item, "#256"), true);
  assert.equal(rawItemMatchesSearch(item, "256"), true);
});

test("raw search matches Thai text in address/description fields", () => {
  assert.equal(rawItemMatchesSearch({ title: "คาเฟ่", description_raw: "ถนนพโลชัย" }, "พโลชัย"), true);
});

test("raw search with an empty query keeps every item", () => {
  assert.equal(rawItemMatchesSearch({ title: "A" }, ""), true);
});
