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
      assignment_state: workflow.assignment_state,
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

function importOnce(server, rawItem, mode, targetItemId, actor = "tester@local") {
  return server.importCollectedRawItemsTxn([
    {
      rawItem,
      adapter: "manual",
      mode,
      targetItemId,
      actor,
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
  const imported1 = importOnce(server, rawItem, scenario.mode || "merge", item ? item.id : 0, String(scenario.actor || "tester@local"));
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-merge-backfill-"));
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

function assertCoords(actual, expectedLatitude, expectedLongitude) {
  assert.equal(actual?.item?.latitude ?? null, expectedLatitude);
  assert.equal(actual?.item?.longitude ?? null, expectedLongitude);
}

function assertItemFieldStability(before, after, fields) {
  for (const field of fields) {
    assert.deepEqual(after?.item?.[field], before?.item?.[field], `item field changed: ${field}`);
  }
}

test("incoming coordinate parsing treats presence, zero, and invalid values correctly", () => {
  const cases = [
    { name: "numeric zero pair", latitude: 0, longitude: 0, expected: [0, 0] },
    { name: "string zero pair", latitude: "0", longitude: "0", expected: [0, 0] },
    { name: "null pair absent", latitude: null, longitude: null, expected: [null, null] },
    { name: "empty strings absent", latitude: "", longitude: "", expected: [null, null] },
    { name: "whitespace strings absent", latitude: "   ", longitude: "   ", expected: [null, null] },
    { name: "partial pair null-lng invalid", latitude: null, longitude: 105, expected: [null, null] },
    { name: "partial pair lat-empty invalid", latitude: 14, longitude: "", expected: [null, null] },
    { name: "out of range latitude invalid", latitude: 91, longitude: 105, expected: [null, null] },
    { name: "out of range longitude invalid", latitude: 14, longitude: 181, expected: [null, null] },
  ];

  for (const testCase of cases) {
    const result = executeScenario({
      case_id: `incoming-${testCase.name.replace(/\s+/g, "-")}`,
      mode: "merge",
      initial_item: {
        title: "Target",
        description_raw: "Target raw",
        description_clean: "Target clean",
        source_url: buildSourceUrl("target"),
        latitude: null,
        longitude: null,
        map_url: "",
      },
      source: {
        submittedUrl: "https://www.google.com/maps/place/Test/@14.1,105.2,12z",
        fetchedUrl: "https://www.google.com/maps/place/Test/@14.1,105.2,12z",
        latitude: testCase.latitude,
        longitude: testCase.longitude,
        mapUrl: "",
      },
    });

    assertCoords(result.after1, testCase.expected[0], testCase.expected[1]);
    assert.equal(result.after1?.item?.map_url ?? "", "");
  }
});

test("existing coordinate and map_url policy stays conservative and independent", () => {
  const cases = [
    {
      name: "empty existing location fills all fields",
      initial_item: { latitude: null, longitude: null, map_url: "" },
      source: {
        latitude: 14.4422717,
        longitude: 105.2741437,
        mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z",
      },
      expected: { latitude: 14.4422717, longitude: 105.2741437, mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z" },
    },
    {
      name: "existing pair preserved and empty map_url backfilled",
      initial_item: { latitude: 13.123456, longitude: 100.654321, map_url: "" },
      source: {
        latitude: 14.4422717,
        longitude: 105.2741437,
        mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z",
      },
      expected: { latitude: 13.123456, longitude: 100.654321, mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z" },
    },
    {
      name: "existing map_url preserved when coordinates are backfilled",
      initial_item: { latitude: null, longitude: null, map_url: "https://www.google.com/maps/place/Existing/@13.1,100.6,12z" },
      source: {
        latitude: 14.4422717,
        longitude: 105.2741437,
        mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z",
      },
      expected: { latitude: 14.4422717, longitude: 105.2741437, mapUrl: "https://www.google.com/maps/place/Existing/@13.1,100.6,12z" },
    },
    {
      name: "existing map_url never overwritten",
      initial_item: { latitude: 13.123456, longitude: 100.654321, map_url: "https://www.google.com/maps/place/Existing/@13.1,100.6,12z" },
      source: {
        latitude: 14.4422717,
        longitude: 105.2741437,
        mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z",
      },
      expected: { latitude: 13.123456, longitude: 100.654321, mapUrl: "https://www.google.com/maps/place/Existing/@13.1,100.6,12z" },
    },
    {
      name: "existing partial pair is not mixed with incoming component",
      initial_item: { latitude: 13.123456, longitude: null, map_url: "" },
      source: {
        latitude: 14.4422717,
        longitude: 105.2741437,
        mapUrl: "",
      },
      expected: { latitude: 13.123456, longitude: null, mapUrl: "" },
    },
    {
      name: "spoofed incoming URL does not populate map_url",
      initial_item: { latitude: null, longitude: null, map_url: "" },
      source: {
        latitude: 14.4422717,
        longitude: 105.2741437,
        mapUrl: "https://evilgoogle.com/maps/place/Test/@14.1,105.2",
      },
      expected: { latitude: 14.4422717, longitude: 105.2741437, mapUrl: "" },
    },
  ];

  for (const testCase of cases) {
    const result = executeScenario({
      case_id: `existing-${testCase.name.replace(/\s+/g, "-")}`,
      mode: "merge",
      initial_item: {
        title: "Original title",
        description_raw: "Original raw",
        description_clean: "Original clean",
        category: "attractions",
        source_url: buildSourceUrl("existing"),
        latitude: testCase.initial_item.latitude,
        longitude: testCase.initial_item.longitude,
        map_url: testCase.initial_item.map_url,
        tags: ["keep", "this"],
      },
      source: {
        submittedUrl: "https://www.google.com/maps/place/Test/@14.1,105.2,12z",
        fetchedUrl: "https://www.google.com/maps/place/Test/@14.1,105.2,12z",
        latitude: testCase.source.latitude,
        longitude: testCase.source.longitude,
        mapUrl: testCase.source.mapUrl,
      },
    });

    assertCoords(result.after1, testCase.expected.latitude, testCase.expected.longitude);
    assert.equal(result.after1?.item?.map_url ?? "", testCase.expected.mapUrl);
  }
});

test("existing stored coordinate presence is trim-aware and never mixes partial pairs", () => {
  const cases = [
    {
      name: "whitespace pair backfills incoming pair",
      stored_coordinates: { latitude: "   ", longitude: "   " },
      source: { latitude: 14.4422717, longitude: 105.2741437 },
      expected: { latitude: 14.4422717, longitude: 105.2741437 },
    },
    {
      name: "empty string pair backfills incoming pair",
      stored_coordinates: { latitude: "", longitude: "" },
      source: { latitude: 14.4422717, longitude: 105.2741437 },
      expected: { latitude: 14.4422717, longitude: 105.2741437 },
    },
    {
      name: "zero string pair is preserved",
      stored_coordinates: { latitude: "0", longitude: "0" },
      source: { latitude: 14.4422717, longitude: 105.2741437 },
      expected: { latitude: 0, longitude: 0 },
    },
    {
      name: "trimmed zero string pair is preserved",
      stored_coordinates: { latitude: " 0 ", longitude: " 0 " },
      source: { latitude: 14.4422717, longitude: 105.2741437 },
      expected: { latitude: 0, longitude: 0 },
    },
    {
      name: "partial whitespace does not create a mixed pair",
      stored_coordinates: { latitude: "   ", longitude: 105 },
      source: { latitude: 14.4422717, longitude: 105.2741437 },
      expected: { latitude: "   ", longitude: 105 },
    },
    {
      name: "out of range pair is not usable and backfills incoming pair",
      stored_coordinates: { latitude: 91, longitude: 181 },
      source: { latitude: 14.4422717, longitude: 105.2741437 },
      expected: { latitude: 14.4422717, longitude: 105.2741437 },
    },
    {
      name: "non-finite pair is not usable and backfills incoming pair",
      stored_coordinates: { latitude: "Infinity", longitude: "Infinity" },
      source: { latitude: 14.4422717, longitude: 105.2741437 },
      expected: { latitude: 14.4422717, longitude: 105.2741437 },
    },
  ];

  for (const testCase of cases) {
    const result = executeScenario({
      case_id: `existing-presence-${testCase.name.replace(/\s+/g, "-")}`,
      mode: "merge",
      initial_item: {
        title: "Presence title",
        description_raw: "Presence raw",
        description_clean: "Presence clean",
        category: "attractions",
        source_url: buildSourceUrl("presence"),
        latitude: null,
        longitude: null,
        map_url: "",
        tags: ["keep", "this"],
      },
      stored_coordinates: testCase.stored_coordinates,
      source: {
        submittedUrl: "https://www.google.com/maps/place/Test/@14.1,105.2,12z",
        fetchedUrl: "https://www.google.com/maps/place/Test/@14.1,105.2,12z",
        latitude: testCase.source.latitude,
        longitude: testCase.source.longitude,
        mapUrl: "",
      },
    });

    assert.equal(result.after1?.item?.latitude ?? null, testCase.expected.latitude);
    assert.equal(result.after1?.item?.longitude ?? null, testCase.expected.longitude);
    assert.equal(result.after1?.item?.map_url ?? "", "");
  }
});

test("merge preserves workflow, claim, field pack, and approved context invariants while remaining idempotent", () => {
  const result = executeScenario({
    case_id: "invariants-idempotency",
    mode: "merge",
    repeat: true,
    initial_item: {
      title: "Invariant title",
      description_raw: "Invariant raw",
      description_clean: "Invariant clean",
      category: "attractions",
      source_url: buildSourceUrl("invariant"),
      latitude: 13.123456,
      longitude: 100.654321,
      map_url: "https://www.google.com/maps/place/Existing/@13.123456,100.654321,12z",
      tags: ["keep", "this"],
    },
    claim: {
      email: "claimer@example.com",
      display_name: "Claimer",
      note: "claimed for test",
    },
    field_pack: {
      status: "ready_for_field",
      is_current: true,
      ai_summary: "field pack",
      curation_status: "not_started",
    },
    approved_context: {
      text_value: "Approved context",
      selected_text: "Approved context",
      note: "approved",
    },
    source: {
      submittedUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z",
      fetchedUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z",
      latitude: 14.4422717,
      longitude: 105.2741437,
      mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z",
    },
  });

  assert.equal(result.imported1?.imported_count, 1);
  assert.equal(result.imported1?.merged_count, 1);
  assert.equal(result.imported2?.imported_count, 1);
  assert.equal(result.imported2?.merged_count, 1);

  assert.equal(result.before?.item?.title, "Invariant title");
  assert.equal(result.after1?.item?.title, "Invariant title");
  assert.equal(result.after2?.item?.title, "Invariant title");
  assert.equal(result.after1?.item?.description_raw, result.before?.item?.description_raw);
  assert.equal(result.after1?.item?.description_clean, result.before?.item?.description_clean);
  assert.equal(result.after1?.item?.category, result.before?.item?.category);
  assert.equal(result.after1?.workflow?.production_state, result.before?.workflow?.production_state);
  assert.equal(result.after1?.workflow?.publication_state, result.before?.workflow?.publication_state);
  assert.equal(result.after1?.workflow?.state_version, result.before?.workflow?.state_version);
  assert.equal(result.after1?.workflow?.content_version, result.before?.workflow?.content_version);
  assert.equal(result.after1?.workflow?.current_field_pack_id, result.before?.workflow?.current_field_pack_id);
  assert.equal(result.after1?.item?.claimed_by_user_id, result.before?.item?.claimed_by_user_id);
  assert.equal(result.after1?.field_pack_ids.join(","), result.before?.field_pack_ids.join(","));
  assert.equal(result.after1?.approved_context_ids.join(","), result.before?.approved_context_ids.join(","));
  assert.equal(result.after1?.source_record_count, result.after2?.source_record_count);
  assert.deepEqual(result.after1?.source_record_urls, result.after2?.source_record_urls);
  assert.ok(result.after1?.evidence_count >= (result.before?.evidence_count || 0));
  assert.equal(result.after1?.evidence_count, result.after2?.evidence_count);
  assert.equal(result.after1?.field_pack_count, result.before?.field_pack_count);
  assert.equal(result.after1?.approved_context_count, result.before?.approved_context_count);
  assert.equal(result.after1?.item?.latitude, 13.123456);
  assert.equal(result.after1?.item?.longitude, 100.654321);
  assert.equal(result.after1?.item?.map_url, "https://www.google.com/maps/place/Existing/@13.123456,100.654321,12z");
  assert.equal(result.after2?.item?.latitude, 13.123456);
  assert.equal(result.after2?.item?.longitude, 100.654321);
  assert.equal(result.after2?.item?.map_url, "https://www.google.com/maps/place/Existing/@13.123456,100.654321,12z");
  assert.equal(result.after1?.source_record_count, result.after2?.source_record_count);
  assert.equal(new Set(result.after2?.source_record_urls || []).size, result.after2?.source_record_urls?.length || 0);
});

test("new-item import still receives location and map_url normally", () => {
  const result = executeScenario({
    case_id: "new-item",
    mode: "new",
    source: {
      submittedUrl: "https://www.google.com/maps/place/%E0%B8%99%E0%B9%89%E0%B8%B3%E0%B8%95%E0%B8%81%E0%B8%AB%E0%B9%89%E0%B8%A7%E0%B8%A2%E0%B8%AB%E0%B8%A5%E0%B8%A7%E0%B8%87/@14.4426651,105.2683356,252m/data=!3m1!1e3!4m6!3m5!1s0x3113f7d313aca491:0xe16a37ad87d1284f!8m2!3d14.4422717!4d105.2741437!16s%2Fg%2F11qh1x72x8!5m1!1e2?authuser=0&entry=ttu",
      fetchedUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z/data=!3m1!1e3",
      latitude: 14.4422717,
      longitude: 105.2741437,
      mapUrl: "https://www.google.com/maps/place/Test/@14.111,105.222,12z/data=!3m1!1e3",
    },
  });

  assert.equal(result.imported1?.imported_count, 1);
  assert.equal(result.imported1?.merged_count, 0);
  assert.ok(result.item_id > 0);
  assert.equal(result.after1?.item?.latitude, 14.4422717);
  assert.equal(result.after1?.item?.longitude, 105.2741437);
  assert.equal(result.after1?.item?.map_url, "https://www.google.com/maps/place/Test/@14.111,105.222,12z/data=!3m1!1e3");
});
