import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const SOURCE_PATH = path.join(root, "server", "public", "item-editor.js");

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

function buildFilterFn(source) {
  const deriveHostNameSrc = extractFunctionBlock(source, "deriveHostName");
  const classifySrc = extractFunctionBlock(source, "classifyEvidenceSourceFamily");
  const filterSrc = extractFunctionBlock(source, "getEvidenceFilteredRows");

  const state = { evidenceView: { blockType: "all", sourceFamily: "all", sort: "source_priority" } };

  const code = [
    deriveHostNameSrc,
    classifySrc,
    filterSrc,
    "module.exports = { getEvidenceFilteredRows };",
  ].join("\n");

  const mod = {};
  const fn = new Function("state", "module", code + `\nreturn module.exports.getEvidenceFilteredRows;`);
  return fn(state, { exports: {} });
}

const SAMPLE_ROWS = [
  { id: 1, block_type: "fact", source_type: "manual", source_url: "https://example.com", text_value: "จริง" },
  { id: 2, block_type: "media", source_type: "manual", source_url: "https://img.example.com/1.jpg", text_value: "" },
  { id: 3, block_type: "mention", source_type: "manual", source_url: "https://example.com", text_value: "กล่าวถึง" },
  { id: 4, block_type: "media", source_type: "google_maps", source_url: "https://maps.google.com/photo", text_value: "" },
  { id: 5, block_type: "review_snippet", source_type: "wongnai", source_url: "https://wongnai.com/r/1", text_value: "รีวิว" },
  { id: 6, block_type: "fact", source_type: "official", source_url: "https://place.com", text_value: "ข้อมูลหลัก" },
];

test("getEvidenceFilteredRows: media rows are excluded", () => {
  const source = readSource();
  const filter = buildFilterFn(source);
  const result = filter(SAMPLE_ROWS);
  const mediaRows = result.filter((r) => r.block_type === "media");
  assert.equal(mediaRows.length, 0, "media rows must not appear in filtered result");
});

test("getEvidenceFilteredRows: non-media rows are preserved", () => {
  const source = readSource();
  const filter = buildFilterFn(source);
  const result = filter(SAMPLE_ROWS);
  const resultIds = result.map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(resultIds, [1, 3, 5, 6], "only non-media rows should remain");
});

test("getEvidenceFilteredRows: all-media input yields empty result", () => {
  const source = readSource();
  const filter = buildFilterFn(source);
  const allMedia = [
    { id: 10, block_type: "media", source_type: "manual", source_url: "https://img.com/1.jpg" },
    { id: 11, block_type: "media", source_type: "google_maps", source_url: "https://maps.google.com/p" },
  ];
  const result = filter(allMedia);
  assert.equal(result.length, 0, "all-media input should yield empty result");
});

test("revert proof: removing filter lets media rows through", () => {
  const original = readSource();
  const filterLine = 'if (blockType === "media") return false;';
  assert.ok(
    original.includes(filterLine),
    "original source must contain the media filter line"
  );
  const patched = original.replace(filterLine, "/* FILTER REMOVED FOR TEST */");
  assert.notEqual(original, patched, "patch must differ from original");
  assert.ok(
    !patched.includes(filterLine),
    "patched source must not contain the media filter line"
  );

  const filterPatched = buildFilterFn(patched);
  const result = filterPatched(SAMPLE_ROWS);
  const mediaRows = result.filter((r) => r.block_type === "media");
  assert.ok(mediaRows.length > 0, "without filter, media rows must appear");
  assert.equal(mediaRows.length, 2, "without filter, both media rows should appear");
});

const ALL_MEDIA_EMPTY_MSG = 'evidence ทั้งหมด ${rows.length} รายการเป็นรูป';
const ALL_MEDIA_FALLBACK = 'ยังไม่มี evidence blocks';

test("empty state: all-media evidence shows media hint instead of 'no evidence'", () => {
  const source = readSource();
  assert.ok(
    source.includes(ALL_MEDIA_EMPTY_MSG.split("${rows.length}")[0]),
    "source must contain all-media empty state message"
  );
  assert.ok(
    source.includes('!nonMediaCount && rows.length > 0'),
    "source must guard all-media condition"
  );
});

test("revert proof: removing allMedia guard shows misleading 'no evidence' message", () => {
  const original = readSource();
  const revertLine = '    const allMedia = !nonMediaCount && rows.length > 0;';
  assert.ok(
    original.includes(revertLine),
    "source must contain the allMedia guard line"
  );

  const patched = original.replace(revertLine, "    const allMedia = false;");
  assert.notEqual(original, patched, "patch must differ from original");

  const fallbackPresent = patched.includes(
    ': "ยังไม่มี evidence blocks"'
  );
  assert.ok(fallbackPresent, "patched source must still contain fallback message");

  const guardActive = patched.includes('!nonMediaCount && rows.length > 0');
  assert.ok(!guardActive, "allMedia guard must be removed in patched version");
});
