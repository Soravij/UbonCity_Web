import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const collectorRoot = path.join(repoRoot, "collector");
const schemaPath = path.join(collectorRoot, "database", "schema.sql");
const clientModuleUrl = pathToFileURL(path.join(collectorRoot, "db", "client.mjs")).href;
const serverModuleUrl = pathToFileURL(path.join(collectorRoot, "server", "index.mjs")).href;

const childRunnerSource = String.raw`
const scenario = JSON.parse(process.env.SCENARIO_JSON || "{}");
process.chdir(process.env.COLLECTOR_ROOT);

const { openDatabase } = await import(process.env.CLIENT_MODULE_URL);
const server = await import(process.env.SERVER_MODULE_URL + "?case=" + encodeURIComponent(scenario.case_id || "dedupe"));

function buildRawItem(source = {}) {
  const url = "https://example.com/" + String(source.slug || "place");
  return {
    id: Number(source.id),
    source_url: url,
    source_ref: "ref-" + String(source.id),
    payload_json: { payload_json: { submitted_url: url, fetched_url: url } },
    normalized_json: {
      type: "place",
      category: "attractions",
      lang: "th",
      title: String(source.title),
      description: "Imported description",
      source_name: "manual",
      source_url: url,
      map_url: "",
      latitude: null,
      longitude: null,
      google_place_id: String(source.google_place_id || ""),
      tags: ["manual-url"],
    },
  };
}

const inspectDb = openDatabase(process.env.DB_PATH, process.env.SCHEMA_PATH);
const countItems = () => Number(inspectDb.prepare("SELECT COUNT(*) AS n FROM content_items").get().n);

const steps = [];
for (const step of scenario.steps) {
  const summary = server.importCollectedRawItemsTxn(step.payloads.map((p) => ({
    rawItem: buildRawItem(p.source),
    adapter: "manual",
    mode: p.mode,
    targetItemId: 0,
    actor: "tester@local",
  })));
  steps.push({ summary, item_count: countItems() });
}
inspectDb.close();
console.log(JSON.stringify({ steps }));
`;

function executeScenario(scenario) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-import-dedupe-"));
  const runnerPath = path.join(tempDir, "runner.mjs");
  const dbPath = path.join(tempDir, "collector.sqlite");
  fs.writeFileSync(runnerPath, childRunnerSource, "utf8");

  const result = spawnSync(process.execPath, [runnerPath], {
    cwd: collectorRoot,
    env: {
      ...process.env,
      COLLECTOR_ROOT: collectorRoot,
      DB_PATH: dbPath,
      SCHEMA_PATH: schemaPath,
      CLIENT_MODULE_URL: clientModuleUrl,
      SERVER_MODULE_URL: serverModuleUrl,
      SCENARIO_JSON: JSON.stringify(scenario),
      COLLECTOR_DISABLE_LISTEN: "1",
    },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  try {
    if (result.status !== 0) {
      throw new Error(`dedupe scenario failed\nstdout:\n${String(result.stdout || "").trim()}\nstderr:\n${String(result.stderr || "").trim()}`);
    }
    return JSON.parse(String(result.stdout || "").trim());
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const src = (id, title, google_place_id) => ({ id, title, slug: `p${id}`, google_place_id });

test("new raw item with a google_place_id is imported as one content item", () => {
  const { steps } = executeScenario({
    case_id: "case1",
    steps: [{ payloads: [{ mode: "new", source: src(1, "Place A", "ChIJtestA") }] }],
  });
  assert.equal(steps[0].summary.new_count, 1);
  assert.equal(steps[0].item_count, 1);
});

test("re-importing the same google_place_id in mode new is skipped as already_imported", () => {
  const payload = { mode: "new", source: src(1, "Place A", "ChIJtestA") };
  const { steps } = executeScenario({
    case_id: "case2",
    steps: [{ payloads: [payload] }, { payloads: [payload] }],
  });
  const firstId = steps[0].summary.results[0].item_id;
  assert.ok(firstId);
  const second = steps[1].summary;
  assert.equal(second.imported_count, 0);
  assert.equal(second.new_count, 0);
  assert.equal(second.skipped_count, 1);
  assert.equal(second.results[0].decision, "already_imported");
  assert.equal(second.results[0].item_id, firstId);
  assert.equal(steps[1].item_count, steps[0].item_count);
});

test("two payloads with the same google_place_id in one call import once and skip once", () => {
  const { steps } = executeScenario({
    case_id: "case3",
    steps: [{
      payloads: [
        { mode: "new", source: src(1, "Place B one", "ChIJtestB") },
        { mode: "new", source: src(2, "Place B two", "ChIJtestB") },
      ],
    }],
  });
  assert.equal(steps[0].summary.new_count, 1);
  assert.equal(steps[0].summary.skipped_count, 1);
  assert.equal(steps[0].item_count, 1);
});

test("two raw items with empty google_place_id are both imported", () => {
  const { steps } = executeScenario({
    case_id: "case4",
    steps: [{
      payloads: [
        { mode: "new", source: src(1, "No place id one", "") },
        { mode: "new", source: src(2, "No place id two", "") },
      ],
    }],
  });
  assert.equal(steps[0].summary.new_count, 2);
  assert.equal(steps[0].item_count, 2);
});

test("mode skip is counted as skipped and creates no row", () => {
  const { steps } = executeScenario({
    case_id: "case5",
    steps: [{ payloads: [{ mode: "skip", source: src(1, "Skipped", "ChIJtestC") }] }],
  });
  assert.equal(steps[0].summary.skipped_count, 1);
  assert.equal(steps[0].summary.results[0].decision, "skip");
  assert.equal(steps[0].item_count, 0);
});
