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
const server = await import(process.env.SERVER_MODULE_URL + "?case=" + encodeURIComponent(scenario.case_id || "merge"));

function openRepo(dbPath) {
  const db = openDatabase(dbPath, process.env.SCHEMA_PATH);
  return { db, repo: createRepository(db) };
}

function createUser(db, email, displayName = "tester") {
  const result = db.prepare(
    "INSERT INTO users (email, password_hash, role, display_name) VALUES (?, 'hash', 'user', ?)"
  ).run(email, displayName);
  return Number(result.lastInsertRowid || 0);
}

function createInitialItem(repo, initial = {}) {
  const created = repo.createItemWithWorkflowHead({
    type: "place",
    category: String(initial.category || "attractions"),
    lang: String(initial.lang || "th"),
    title: String(initial.title || "Original title"),
    description_raw: String(initial.description_raw || "Original raw"),
    description_clean: String(initial.description_clean || "Original clean"),
    source_type: String(initial.source_type || "manual"),
    source_name: String(initial.source_name || "manual"),
    source_url: String(initial.source_url || "https://existing.example.com/original"),
    image_url: String(initial.image_url || ""),
    latitude: initial.latitude ?? null,
    longitude: initial.longitude ?? null,
    map_url: String(initial.map_url || ""),
    google_place_id: String(initial.google_place_id || ""),
    tags: Array.isArray(initial.tags) ? initial.tags : ["keep", "this"],
  }, initial.workflow_patch || {
    production_state: "collected",
    publication_state: "draft",
  }, "tester@local");
  return created.item;
}

function createClaim(repo, db, itemId, claim = {}) {
  const userId = createUser(db, String(claim.email || "claimer@example.com"), String(claim.display_name || "claimer"));
  repo.claimItem(itemId, userId, { claim_note: String(claim.note || "claimed") });
  return userId;
}

function createFieldPack(repo, itemId, fieldPack = {}) {
  return repo.createFieldPack({
    content_item_id: itemId,
    status: String(fieldPack.status || "ready_for_field"),
    is_current: fieldPack.is_current !== false,
    ai_summary: String(fieldPack.ai_summary || "pack"),
    curation_status: String(fieldPack.curation_status || "not_started"),
  });
}

function createApprovedContext(repo, itemId, context = {}) {
  const evidence = repo.addEvidenceBlock(itemId, {
    block_type: "fact",
    source_type: String(context.source_type || "manual"),
    status: "active",
    text_value: String(context.text_value || "approved context"),
  });
  return repo.addApprovedContextBlock(itemId, {
    evidence_block_id: evidence.id,
    context_type: "fact",
    status: "active",
    selected_text: String(context.selected_text || "approved context"),
    note: String(context.note || "approved"),
  }, "tester@local");
}

function setStoredCoordinates(db, itemId, latitude, longitude) {
  db.prepare(
    "UPDATE content_items SET latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(latitude, longitude, itemId);
}

function buildRawItem(source = {}) {
  const submittedUrl = String(source.submittedUrl || source.sourceUrl || "https://example.com/source").trim();
  const fetchedUrl = String(source.fetchedUrl || submittedUrl).trim();
  return {
    id: Number(source.id || 901),
    source_url: submittedUrl,
    source_ref: String(source.sourceRef || "source-ref").trim(),
    payload_json: {
      payload_json: {
        submitted_url: submittedUrl,
        fetched_url: fetchedUrl,
      },
    },
    normalized_json: {
      type: "place",
      category: String(source.category || "attractions"),
      lang: "th",
      title: String(source.title || "Imported title"),
      description: String(source.description || "Imported description"),
      source_name: String(source.sourceName || "manual"),
      source_url: submittedUrl,
      map_url: String(source.mapUrl || ""),
      latitude: Object.prototype.hasOwnProperty.call(source, "latitude") ? source.latitude : null,
      longitude: Object.prototype.hasOwnProperty.call(source, "longitude") ? source.longitude : null,
      google_place_id: String(source.google_place_id || ""),
      tags: Array.isArray(source.tags) ? source.tags : ["manual-url"],
    },
  };
}

function snapshot(repo, itemId) {
  const item = repo.getItem(itemId);
  const workflow = repo.getWorkflowModelByItem(itemId);
  const fieldPacks = repo.listFieldPacksByItem(itemId);
  const approvedContexts = repo.listApprovedContextBlocks(itemId);
  const evidenceBlocks = repo.listEvidenceBlocks(itemId);
  const sourceRecords = repo.listSourceRecordsByItem(itemId);
  return {
    item: item ? {
      id: Number(item.id || 0) || null,
      title: item.title,
      description_raw: item.description_raw,
      description_clean: item.description_clean,
      category: item.category,
      type: item.type,
      lang: item.lang,
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      map_url: item.map_url ?? "",
      claimed_by_user_id: item.claimed_by_user_id ?? null,
      workflow_status: item.workflow_status,
    } : null,
    workflow: workflow ? {
      production_state: workflow.production_state,
      publication_state: workflow.publication_state,
      state_version: workflow.state_version,
      content_version: workflow.content_version,
      current_field_pack_id: workflow.current_field_pack_id,
    } : null,
    field_pack_ids: fieldPacks.map((row) => Number(row.id || 0)).filter(Boolean),
    field_pack_count: fieldPacks.length,
    approved_context_ids: approvedContexts.map((row) => Number(row.id || 0)).filter(Boolean),
    approved_context_count: approvedContexts.length,
    evidence_count: evidenceBlocks.length,
    source_record_ids: sourceRecords.map((row) => Number(row.id || 0)).filter(Boolean),
    source_record_urls: sourceRecords.map((row) => String(row.source_url || "")).filter(Boolean).sort(),
    source_record_count: sourceRecords.length,
  };
}

function importOnce(server, rawItem, mode, targetItemId, actor = "tester@local", allowPlaceIdConflict = false) {
  return server.importCollectedRawItemsTxn([
    {
      rawItem,
      adapter: "manual",
      mode,
      targetItemId,
      actor,
      allowPlaceIdConflict,
    },
  ]);
}

const tempDbPath = process.env.DB_PATH;
const base = openRepo(tempDbPath);

try {
  const item = scenario.mode === "new"
    ? null
    : createInitialItem(base.repo, scenario.initial_item || {});

  let createdClaimUserId = null;
  let createdFieldPack = null;
  let createdApprovedContext = null;
  if (item) {
    if (scenario.claim) {
      createdClaimUserId = createClaim(base.repo, base.db, item.id, scenario.claim);
    }
    if (scenario.stored_coordinates) {
      setStoredCoordinates(
        base.db,
        item.id,
        Object.prototype.hasOwnProperty.call(scenario.stored_coordinates, "latitude") ? scenario.stored_coordinates.latitude : null,
        Object.prototype.hasOwnProperty.call(scenario.stored_coordinates, "longitude") ? scenario.stored_coordinates.longitude : null
      );
    }
    if (scenario.field_pack) {
      createdFieldPack = createFieldPack(base.repo, item.id, scenario.field_pack);
    }
    if (scenario.approved_context) {
      createdApprovedContext = createApprovedContext(base.repo, item.id, scenario.approved_context);
    }
  }

  const before = item ? snapshot(base.repo, item.id) : null;
  base.db.close();

  const rawItem = buildRawItem(scenario.source || {});
  const imported1 = importOnce(server, rawItem, scenario.mode || "merge", item ? item.id : 0, String(scenario.actor || "tester@local"), scenario.allow_place_id_conflict === true);
  let after1 = null;
  let after2 = null;
  let imported2 = null;
  let resultItemId = item ? item.id : Number(imported1?.results?.[0]?.item_id || 0) || null;

  if (resultItemId) {
    const inspect1 = openRepo(tempDbPath);
    try {
      after1 = snapshot(inspect1.repo, resultItemId);
    } finally {
      inspect1.db.close();
    }
  }

  if (scenario.repeat === true && resultItemId) {
    imported2 = importOnce(server, rawItem, scenario.mode || "merge", item ? item.id : resultItemId, String(scenario.actor || "tester@local"));
    const inspect2 = openRepo(tempDbPath);
    try {
      after2 = snapshot(inspect2.repo, resultItemId);
    } finally {
      inspect2.db.close();
    }
  }

  console.log(JSON.stringify({
    item_id: resultItemId,
    before,
    after1,
    after2,
    imported1,
    imported2,
    created_claim_user_id: createdClaimUserId,
    created_field_pack_id: createdFieldPack ? Number(createdFieldPack.id || 0) || null : null,
    created_approved_context_id: createdApprovedContext ? Number(createdApprovedContext.id || 0) || null : null,
  }));
} finally {
  try {
    base.db.close();
  } catch {}
}
`;

function executeScenario(scenario) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-merge-place-id-guard-"));
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
      const stderr = String(result.stderr || "").trim();
      const stdout = String(result.stdout || "").trim();
      throw new Error(`merge scenario failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    const output = String(result.stdout || "").trim();
    return output ? JSON.parse(output) : {};
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildSourceUrl(name = "place") {
  return `https://${name}.example.com/source`;
}

function runCase(caseId, rawPlaceId, allow) {
  return executeScenario({
    case_id: caseId,
    mode: "merge",
    allow_place_id_conflict: allow === true,
    initial_item: {
      title: "Guard target",
      description_raw: "Guard raw",
      description_clean: "Guard clean",
      category: "attractions",
      source_url: buildSourceUrl("guard-target"),
      google_place_id: "PID_A",
    },
    source: {
      submittedUrl: buildSourceUrl("guard-incoming"),
      sourceRef: "guard-incoming-ref",
      google_place_id: rawPlaceId,
    },
  });
}

test("merge with a different google_place_id is skipped as place_id_conflict", () => {
  const result = runCase("guard-conflict", "PID_B", false);
  assert.equal(result.imported1?.skipped_count, 1);
  assert.equal(result.imported1?.merged_count, 0);
  assert.equal(result.imported1?.results?.[0]?.decision, "place_id_conflict");
  assert.equal(result.after1?.source_record_count, result.before?.source_record_count);
});

test("merge with a different google_place_id proceeds when allow_place_id_conflict is set", () => {
  const result = runCase("guard-conflict-allowed", "PID_B", true);
  assert.equal(result.imported1?.merged_count, 1);
  assert.equal(result.imported1?.skipped_count, 0);
  assert.equal(result.after1?.source_record_count, (result.before?.source_record_count || 0) + 1);
});

test("merge with a matching google_place_id proceeds", () => {
  const result = runCase("guard-match", "PID_A", false);
  assert.equal(result.imported1?.merged_count, 1);
  assert.equal(result.imported1?.skipped_count, 0);
});

function runLocationCase(caseId, rawCoords, allow) {
  return executeScenario({
    case_id: caseId,
    mode: "merge",
    allow_place_id_conflict: allow === true,
    initial_item: {
      title: "Location target",
      description_raw: "Location raw",
      description_clean: "Location clean",
      category: "attractions",
      source_url: buildSourceUrl("location-target"),
      latitude: 15.2302,
      longitude: 104.8573,
    },
    source: {
      submittedUrl: buildSourceUrl("location-incoming"),
      sourceRef: "location-incoming-ref",
      latitude: rawCoords[0],
      longitude: rawCoords[1],
    },
  });
}

test("merge of a raw without place_id far from the target item is skipped as location_conflict", () => {
  const result = runLocationCase("location-far", [15.1588, 104.8290], false);
  assert.equal(result.imported1?.results?.[0]?.decision, "location_conflict");
  assert.equal(result.imported1?.merged_count, 0);
});

test("merge of a raw without place_id near the target item proceeds", () => {
  const result = runLocationCase("location-near", [15.2305, 104.8575], false);
  assert.equal(result.imported1?.merged_count, 1);
});

test("merge far from the target item proceeds when allow flag is set", () => {
  const result = runLocationCase("location-far-allowed", [15.1588, 104.8290], true);
  assert.equal(result.imported1?.merged_count, 1);
});
