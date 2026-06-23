import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PAGE_FILE = path.resolve(__dirname, "../src/pages/HomepageCuration.jsx");

function extractFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const braceStart = source.indexOf("{", start);
  assert.ok(braceStart >= 0, `missing function body for ${signature}`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  assert.fail(`unclosed function body for ${signature}`);
}

test("Signals search sends taxonomy_filters and layout search stays unchanged", async () => {
  const source = await fs.readFile(PAGE_FILE, "utf8");

  const poolSearch = extractFunctionBody(source, "async function searchPoolCandidates()");
  assert.match(poolSearch, /taxonomy_filters/);
  assert.doesNotMatch(poolSearch, /homepage-curation\/taxonomy-options/);
  assert.match(source, /homepage-curation\/taxonomy-options/);

  const layoutSearch = extractFunctionBody(source, "async function searchCandidates(block)");
  assert.doesNotMatch(layoutSearch, /taxonomy_filters/);
});

test("Signals tab contains taxonomy filter controls and place-only summary rendering", async () => {
  const source = await fs.readFile(PAGE_FILE, "utf8");

  assert.match(source, /Taxonomy filters/);
  assert.match(source, /Filters apply to place candidate search only/);
  assert.match(source, /taxonomyFacts\.join\(" · "\)/);
});
