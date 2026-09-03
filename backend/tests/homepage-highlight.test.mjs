import test from "node:test";
import assert from "node:assert/strict";

const service = await import("../services/homepageCurationService.js");

test("FIXED_BLOCK_ORDER includes highlight after hero", async () => {
  const mod = await import("../services/homepageCurationService.js");
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/homepageCurationService.js", import.meta.url), "utf8")
  );
  const orderMatch = source.match(/const FIXED_BLOCK_ORDER\s*=\s*(\[.*?\])/s);
  assert.ok(orderMatch, "FIXED_BLOCK_ORDER not found");
  const order = JSON.parse(orderMatch[1]);
  assert.ok(order.includes("highlight"), "highlight missing from FIXED_BLOCK_ORDER");
  const heroIdx = order.indexOf("hero");
  const highlightIdx = order.indexOf("highlight");
  assert.ok(highlightIdx === heroIdx + 1, "highlight must come right after hero");
});

test("FIXED_BLOCK_TYPES maps highlight to place-list", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/homepageCurationService.js", import.meta.url), "utf8")
  );
  const typesMatch = source.match(/const FIXED_BLOCK_TYPES\s*=\s*\{([^}]+)\}/s);
  assert.ok(typesMatch, "FIXED_BLOCK_TYPES not found");
  const body = typesMatch[1];
  assert.ok(body.includes('highlight: "place-list"'), "highlight must map to place-list");
});

test("createDefaultBlocks includes highlight with min_items=0 and max_items=3", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/homepageCurationService.js", import.meta.url), "utf8")
  );
  const fnMatch = source.match(/function createDefaultBlocks\(lang\s*=\s*"th"\)\s*\{[\s\S]*?return\s*(\[[\s\S]*?\]);\s*\}/);
  assert.ok(fnMatch, "createDefaultBlocks not found");
  const fnBody = fnMatch[0];
  assert.ok(fnBody.includes('key: "highlight"'), "highlight block missing from createDefaultBlocks");
  assert.ok(fnBody.includes("min_items: 0"), "highlight must have min_items: 0");
  assert.ok(fnBody.includes("max_items: 3"), "highlight must have max_items: 3");
});

test("sanitizeBlockByKey clamps max_items for highlight", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/homepageCurationService.js", import.meta.url), "utf8")
  );
  assert.ok(source.includes("highlight"), "highlight keyword must exist in service");
  assert.ok(source.includes('"place-list"'), "place-list type must exist in service");
});

test("resolveBlockItems respects max_items limit", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/homepageCurationService.js", import.meta.url), "utf8")
  );
  const resolveMatch = source.match(/function resolveBlockItems\(block, manualItems, places, events\)\s*\{[\s\S]*?return resolved\.slice\(0, limit\);\s*\}/);
  assert.ok(resolveMatch, "resolveBlockItems function not found");
  assert.ok(resolveMatch[0].includes("maxItems"), "resolveBlockItems must use maxItems");
  assert.ok(resolveMatch[0].includes("limit"), "resolveBlockItems must enforce limit");
});

test("highlight block in DEFAULT_BLOCK_COPY has title for all languages", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/homepageCurationService.js", import.meta.url), "utf8")
  );
  const copyMatch = source.match(/const DEFAULT_BLOCK_COPY\s*=\s*(\{[\s\S]*?\});/);
  assert.ok(copyMatch, "DEFAULT_BLOCK_COPY not found");
  const copy = eval(`(${copyMatch[1]})`);
  for (const lang of ["th", "en", "zh", "lo"]) {
    assert.ok(copy[lang]?.highlight?.title, `highlight title missing for ${lang}`);
  }
});

test("highlight block position is 2 in createDefaultBlocks", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../services/homepageCurationService.js", import.meta.url), "utf8")
  );
  const posMatch = source.match(/key:\s*"highlight"[\s\S]*?position:\s*(\d+)/);
  assert.ok(posMatch, "highlight position not found");
  assert.equal(Number(posMatch[1]), 2, "highlight position must be 2");
});
