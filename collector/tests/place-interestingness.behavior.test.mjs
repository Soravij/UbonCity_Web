import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const collectorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverModuleUrl = pathToFileURL(path.join(collectorRoot, "server", "index.mjs")).href;

const childRunnerSource = String.raw`
process.chdir(process.env.COLLECTOR_ROOT);
const cases = JSON.parse(process.env.CASES_JSON);
const server = await import(process.env.SERVER_MODULE_URL + "?case=interestingness");
const out = {};
for (const [name, c] of Object.entries(cases)) {
  out[name] = server.scorePlaceInterestingness(c.item, c.sourceRecords);
}
console.log("RESULT:" + JSON.stringify(out));
process.exit(0);
`;

const google = (normalized_json, extra = {}) => ({
  source_type: "google_maps",
  source_url: "https://www.google.com/maps/place/xyz",
  payload_json: { normalized_json, ...extra },
});

const CASES = {
  high: {
    item: {},
    sourceRecords: [
      google(
        { user_rating_count: 600, rating: 4.6, formatted_address: "Ubon Ratchathani", review_snippets: ["ดี"] },
        { extracted_metadata: { photos: [{}, {}] } }
      ),
      {
        source_type: "wongnai",
        source_url: "https://www.wongnai.com/restaurants/xyz",
        payload_json: {
          extracted_metadata: { description: "อร่อย", menu_highlights: ["กาแฟ"], image: "https://img.example/x.jpg" },
          extracted_reviews: { items: [{ text: "ดี" }] },
        },
      },
      {
        source_type: "manual",
        source_name: "manual",
        source_url: "https://example-cafe.com/",
        payload_json: {
          extracted_metadata: { phone: "0812345678", opening_hours: ["Mon 09:00-17:00"] },
          extracted_article: { body_text: "ร้านกาแฟในเมืองเก่า" },
        },
      },
    ],
  },
  empty: { item: null, sourceRecords: null },
  itemOnly: {
    item: { summary: "สรุปร้าน", image_url: "https://img.example/a.jpg", match_phone: "0812345678" },
    sourceRecords: [],
  },
  edge40: {
    item: { summary: "สรุปร้านกาแฟ", match_phone: "0812345678" },
    sourceRecords: [google({ user_rating_count: 40 })],
  },
  edge39: {
    item: { summary: "สรุปร้านกาแฟ", match_phone: "0812345678" },
    sourceRecords: [google({ user_rating_count: 39 })],
  },
  jsonSource: {
    item: {},
    sourceRecords: [{
      source_type: "json",
      source_url: "https://www.google.com/maps/place/xyz",
      payload_json: { normalized_json: { user_rating_count: 900, rating: 4.9 } },
    }],
  },
};

let cached = null;
function runCases() {
  if (cached) return cached;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-interestingness-"));
  const runnerPath = path.join(tempDir, "runner.mjs");
  fs.writeFileSync(runnerPath, childRunnerSource, "utf8");
  const result = spawnSync(process.execPath, [runnerPath], {
    cwd: collectorRoot,
    env: {
      ...process.env,
      COLLECTOR_ROOT: collectorRoot,
      DB_PATH: path.join(tempDir, "collector.sqlite"),
      SERVER_MODULE_URL: serverModuleUrl,
      CASES_JSON: JSON.stringify(CASES),
      COLLECTOR_DISABLE_LISTEN: "1",
    },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  try {
    if (result.status !== 0) {
      throw new Error(`interestingness runner failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    const line = String(result.stdout || "").split(/\r?\n/).find((l) => l.startsWith("RESULT:"));
    assert.ok(line, "runner did not print RESULT line");
    cached = JSON.parse(line.slice("RESULT:".length));
    return cached;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("high: google + wongnai + official site with rich data ranks 'น่าทำก่อน'", () => {
  const r = runCases().high;
  assert.equal(r.score, 19);
  assert.equal(r.rank, 3);
  assert.equal(r.label, "น่าทำก่อน");
  assert.deepEqual(r.source_labels, ["เว็บไซต์ทางการ", "Google Maps", "Wongnai"]);
  assert.equal(r.reasons.length, 4);
  assert.equal(r.reasons[0], "หลายแหล่งยืนยันตรงกัน");
});

test("low: null item and null records score 0 and label 'ข้อมูลยังบาง'", () => {
  const r = runCases().empty;
  assert.equal(r.score, 0);
  assert.equal(r.rank, 0);
  assert.equal(r.label, "ข้อมูลยังบาง");
  assert.deepEqual(r.reasons, ["ข้อมูลยังบาง"]);
  assert.deepEqual(r.source_labels, []);
});

test("low: item-only richness (3 of 5 fields) adds 1 point and stays rank 0", () => {
  const r = runCases().itemOnly;
  assert.equal(r.score, 1);
  assert.equal(r.rank, 0);
  assert.deepEqual(r.reasons, ["ข้อมูลพอทำต่อ"]);
});

test("edge: score 3 is the 'ต้องตรวจเอง' threshold; 39 ratings falls just below it", () => {
  const at = runCases().edge40;
  assert.equal(at.score, 3);
  assert.equal(at.rank, 1);
  assert.equal(at.label, "ต้องตรวจเอง");
  const below = runCases().edge39;
  assert.equal(below.score, 2);
  assert.equal(below.rank, 0);
  assert.equal(below.label, "ข้อมูลยังบาง");
});

test("edge: source_type json is never treated as Google even with a google.com URL", () => {
  const r = runCases().jsonSource;
  assert.equal(r.score, 0);
  assert.equal(r.rank, 0);
  assert.deepEqual(r.source_labels, ["Manual"]);
});
