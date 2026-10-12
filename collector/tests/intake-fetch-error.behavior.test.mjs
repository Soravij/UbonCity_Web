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
const repositoryModuleUrl = pathToFileURL(path.join(collectorRoot, "db", "repository.mjs")).href;
const serverModuleUrl = pathToFileURL(path.join(collectorRoot, "server", "index.mjs")).href;

const childRunnerSource = String.raw`
const scenario = JSON.parse(process.env.SCENARIO_JSON || "{}");
process.chdir(process.env.COLLECTOR_ROOT);

const { openDatabase } = await import(process.env.CLIENT_MODULE_URL);
const { createRepository } = await import(process.env.REPOSITORY_MODULE_URL);
const server = await import(process.env.SERVER_MODULE_URL + "?case=" + encodeURIComponent(scenario.case_id || "fetch-error"));

function openRepo(dbPath) {
  const db = openDatabase(dbPath, process.env.SCHEMA_PATH);
  return { db, repo: createRepository(db) };
}

function countItems(db) {
  return Number(db.prepare("SELECT COUNT(*) AS c FROM content_items").get().c || 0);
}

function createInitialItem(repo) {
  const created = repo.createItemWithWorkflowHead({
    type: "place",
    category: "attractions",
    lang: "th",
    title: "Original title",
    description_raw: "Original raw",
    description_clean: "Original clean",
    source_type: "manual",
    source_name: "manual",
    source_url: "https://existing.example.com/original",
    image_url: "",
    latitude: null,
    longitude: null,
    map_url: "",
    google_place_id: "",
    tags: ["keep"],
  }, { production_state: "collected", publication_state: "draft" }, "tester@local");
  return created.item;
}

function buildRawItem(source = {}) {
  const url = "https://incoming.example.com/source";
  const rawPayload = { submitted_url: url, fetched_url: url };
  if (source.payload_fetch_error) rawPayload.metadata_fetch_error = source.payload_fetch_error;
  const normalized = {
    type: "place",
    category: "attractions",
    lang: "th",
    title: "incoming.example.com",
    description: "Imported description",
    source_name: "manual",
    source_url: url,
    map_url: "",
    latitude: null,
    longitude: null,
    google_place_id: "",
    tags: ["manual-url"],
  };
  if (source.normalized_fetch_error) normalized.metadata_fetch_error = source.normalized_fetch_error;
  return {
    id: 901,
    source_url: url,
    source_ref: "incoming-ref",
    payload_json: { payload_json: rawPayload },
    normalized_json: normalized,
  };
}

const tempDbPath = process.env.DB_PATH;
const base = openRepo(tempDbPath);
try {
  const item = scenario.mode === "merge" ? createInitialItem(base.repo) : null;
  const itemsBefore = countItems(base.db);
  const sourceRecordsBefore = item ? base.repo.listSourceRecordsByItem(item.id).length : 0;
  base.db.close();

  const imported = server.importCollectedRawItemsTxn([
    {
      rawItem: buildRawItem(scenario.source || {}),
      adapter: "manual",
      mode: scenario.mode,
      targetItemId: item ? item.id : 0,
      actor: "tester@local",
    },
  ]);

  const inspect = openRepo(tempDbPath);
  let itemsAfter = 0;
  let sourceRecordsAfter = 0;
  try {
    itemsAfter = countItems(inspect.db);
    sourceRecordsAfter = item ? inspect.repo.listSourceRecordsByItem(item.id).length : 0;
  } finally {
    inspect.db.close();
  }

  console.log(JSON.stringify({ imported, itemsBefore, itemsAfter, sourceRecordsBefore, sourceRecordsAfter }));
} finally {
  try { base.db.close(); } catch {}
}
`;

function executeScenario(scenario) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-intake-fetch-error-"));
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
      REPOSITORY_MODULE_URL: repositoryModuleUrl,
      SERVER_MODULE_URL: serverModuleUrl,
      SCENARIO_JSON: JSON.stringify(scenario),
      COLLECTOR_DISABLE_LISTEN: "1",
    },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  try {
    if (result.status !== 0) {
      throw new Error(`fetch-error scenario failed\nstdout:\n${String(result.stdout || "").trim()}\nstderr:\n${String(result.stderr || "").trim()}`);
    }
    const output = String(result.stdout || "").trim();
    return output ? JSON.parse(output) : {};
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("J: raw with normalized_json.metadata_fetch_error is not imported as new", () => {
  const r = executeScenario({ case_id: "J", mode: "new", source: { normalized_fetch_error: "fetch failed" } });
  assert.equal(r.imported?.results?.[0]?.decision, "fetch_error");
  assert.equal(r.imported?.results?.[0]?.fetch_error, "fetch failed");
  assert.equal(r.imported?.imported_count, 0);
  assert.equal(r.itemsAfter, r.itemsBefore);
});

test("K: raw with metadata_fetch_error is not merged into an existing item", () => {
  const r = executeScenario({ case_id: "K", mode: "merge", source: { normalized_fetch_error: "fetch failed" } });
  assert.equal(r.imported?.results?.[0]?.decision, "fetch_error");
  assert.equal(r.imported?.merged_count, 0);
  assert.equal(r.sourceRecordsAfter, r.sourceRecordsBefore);
});

test("L: metadata_fetch_error found only in payload_json.payload_json is also blocked", () => {
  const r = executeScenario({ case_id: "L", mode: "new", source: { payload_fetch_error: "fetch failed" } });
  assert.equal(r.imported?.results?.[0]?.decision, "fetch_error");
  assert.equal(r.imported?.imported_count, 0);
});

test("M: raw without fetch error is still imported as new", () => {
  const r = executeScenario({ case_id: "M", mode: "new", source: {} });
  assert.equal(r.imported?.imported_count, 1);
  assert.equal(r.itemsAfter, r.itemsBefore + 1);
});
