import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import {
  ASSIGNMENT_STATES,
  PLACE_REVIEW_FLAGS,
  PRODUCTION_STATES,
  PUBLICATION_STATES,
  createRepository,
} from "../db/repository.mjs";
import { runQualityStage } from "../services/workflow.mjs";
import { isUsableWorkflowStateCatalog, reportUnknownWorkflowState } from "../server/public/workflow-state-catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);
const serverSource = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");
const workflowSource = fs.readFileSync(path.join(collectorRoot, "services", "workflow.mjs"), "utf8");
const dashboardSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const editorSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.js"), "utf8");
const intakeSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "article-intake.js"), "utf8");
const eventsSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "events-manager-page.js"), "utf8");
const transportSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "other-transport-page.js"), "utf8");

function extractFunctionSource(sourceText, name) {
  const start = sourceText.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const open = sourceText.indexOf("{", sourceText.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${name}`);
}

function loadServerReaderHooks(logs) {
  const context = {
    console: { error: (...args) => logs.push(args) },
    Set,
    __productionStates: PRODUCTION_STATES,
    __publicationStates: PUBLICATION_STATES,
    __assignmentStates: ASSIGNMENT_STATES,
    __placeReviewFlags: PLACE_REVIEW_FLAGS,
  };
  const source = `
const PRODUCTION_STATES = globalThis.__productionStates;
const PUBLICATION_STATES = globalThis.__publicationStates;
const ASSIGNMENT_STATES = globalThis.__assignmentStates;
const PLACE_REVIEW_FLAGS = globalThis.__placeReviewFlags;
${extractFunctionSource(serverSource, "findUnknownWorkflowModelState")}
${extractFunctionSource(serverSource, "logUnknownWorkflowModelState")}
${extractFunctionSource(serverSource, "assertKnownWorkflowModelStates")}
${extractFunctionSource(serverSource, "rejectUnknownWorkflowModelState")}
${extractFunctionSource(serverSource, "isClaimableRawPoolItem")}
${extractFunctionSource(serverSource, "buildItemWorkScopeState")}
${extractFunctionSource(serverSource, "deriveArticleProcessStatus")}
globalThis.__hooks = { isClaimableRawPoolItem, buildItemWorkScopeState, deriveArticleProcessStatus, rejectUnknownWorkflowModelState };
`;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "workflow-reader-hooks.js" });
  return context.__hooks;
}

function loadQualityCandidateGuard(logs) {
  const context = {
    console: { error: (...args) => logs.push(args) },
    __productionStates: PRODUCTION_STATES,
  };
  const source = `
const PRODUCTION_STATES = globalThis.__productionStates;
${extractFunctionSource(workflowSource, "assertKnownQualityCandidateState")}
globalThis.__qualityGuard = assertKnownQualityCandidateState;
`;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "quality-candidate-guard.js" });
  return context.__qualityGuard;
}

function loadSafeAsync() {
  const context = { Promise };
  const source = `${extractFunctionSource(serverSource, "safeAsync")}\nglobalThis.__safeAsync = safeAsync;`;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "safe-async.js" });
  return context.__safeAsync;
}

test("workflow readers log and reject unknown states", async () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-workflow-readers-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, path.join(collectorRoot, "database", "schema.sql"));
  try {
    const repo = createRepository(db);
    const created = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title: "Unknown workflow state test",
      description_raw: "test",
      source_type: "manual",
      source_name: "manual",
    });
    const itemId = Number(created.item.id);
    assert.equal(PRODUCTION_STATES.has("generated"), true);
    db.prepare("UPDATE content_workflow_models SET production_state='generated' WHERE content_item_id=?").run(itemId);
    assert.doesNotThrow(() => repo.listItemsByWorkflowHead({ production_states: ["generated"] }));
    assert.throws(
      () => repo.listItemsByWorkflowHead({ production_states: ["future_state"] }),
      /unknown production state 'future_state'/
    );
    db.prepare("UPDATE content_workflow_models SET production_state='future_state' WHERE content_item_id=?").run(itemId);
    assert.doesNotThrow(() => repo.listItemsByWorkflowHead({ production_states: ["generated"] }));
    assert.throws(() => repo.listItemsByWorkflowHead(), /unknown production state 'future_state'/);
    db.exec("PRAGMA ignore_check_constraints = ON;");
    db.prepare("UPDATE content_workflow_models SET production_state='generated', place_review_flag='future_flag' WHERE content_item_id=?").run(itemId);
    db.exec("PRAGMA ignore_check_constraints = OFF;");
    assert.throws(() => repo.listItemsByWorkflowHead(), /unknown place_review_flag state 'future_flag'/);

    await assert.rejects(
      runQualityStage({
        createPipelineRun() { return "quality-test"; },
        listItemsByWorkflowHead() { return [{ id: 202, production_state: "future_state" }]; },
      }, "tester@local"),
      /unknown production state 'future_state'/
    );
    const qualityGuard = loadQualityCandidateGuard(logs);
    assert.doesNotThrow(() => qualityGuard({ id: 202, production_state: "generated" }));

    const serverLogs = [];
    const hooks = loadServerReaderHooks(serverLogs);
    const unknownModel = { production_state: "future_state", publication_state: "draft" };
    const unknownFlagModel = { production_state: "generated", publication_state: "draft", place_review_flag: "future_flag" };
    const generatedModel = { production_state: "generated", publication_state: "draft" };
    assert.doesNotThrow(() => hooks.isClaimableRawPoolItem({ id: 302, ...generatedModel }));
    assert.doesNotThrow(() => hooks.buildItemWorkScopeState({ id: 302, ...generatedModel }, null));
    assert.doesNotThrow(() => hooks.deriveArticleProcessStatus({ id: 302 }, generatedModel));
    assert.throws(() => hooks.isClaimableRawPoolItem({ id: 303, ...unknownModel }), /unknown production state 'future_state'/);
    assert.throws(() => hooks.buildItemWorkScopeState({ id: 304, ...unknownModel }, null), /unknown production state 'future_state'/);
    assert.throws(() => hooks.deriveArticleProcessStatus({ id: 305 }, unknownModel), /unknown production state 'future_state'/);
    assert.throws(() => hooks.deriveArticleProcessStatus({ id: 306 }, unknownFlagModel), /unknown place_review_flag state 'future_flag'/);
    const response = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; },
    };
    assert.equal(hooks.rejectUnknownWorkflowModelState(response, "web-review-feedback", 306, unknownModel), true);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.state, "future_state");
    assert.equal(response.body.content_item_id, 306);
    const generatedResponse = {
      status() { throw new Error("known state must not be rejected"); },
    };
    assert.equal(hooks.rejectUnknownWorkflowModelState(generatedResponse, "web-review-feedback", 302, generatedModel), false);
    assert.match(
      serverSource,
      /const workflowBefore = repo\.ensureWorkflowModel\(sourceContentItemId\);\s*if \(rejectUnknownWorkflowModelState\(res, "web-review-feedback", sourceContentItemId, workflowBefore\)\) \{\s*return;\s*\}/
    );

    const safeAsync = loadSafeAsync();
    const forwarded = await new Promise((resolve) => {
      safeAsync(async () => {
        throw new Error("future_state");
      })({}, {}, resolve);
    });
    assert.match(String(forwarded?.message || ""), /future_state/);
    for (const route of [
      "/api/items/:id/article-process/transition",
      "/api/transport-map-routes/:id/release-main",
      "/api/items/:id/article-suggestion",
    ]) {
      assert.match(serverSource, new RegExp(`app\\.post\\("${route.replace(/[/:]/g, "\\$&")}"[\\s\\S]{0,180}?safeAsync\\(async`));
    }

    assert.equal(logs.some((args) => args[0] === "[workflow-reader] unknown workflow state" && args[1]?.item_id === null), true);
    assert.equal(logs.some((args) => args[0] === "[workflow-reader] unknown workflow state" && args[1]?.item_id === itemId), true);
    assert.equal(logs.some((args) => args[0] === "[workflow-reader] unknown workflow state" && args[1]?.item_id === 202), true);
    assert.equal(serverLogs.filter((args) => args[0] === "[workflow-reader] unknown workflow state").length, 5);
  } finally {
    console.error = originalError;
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}, { concurrency: false });

test("UI workflow readers preserve and flag unknown states using the canonical server enum", () => {
  for (const source of [dashboardSource, editorSource, intakeSource, eventsSource, transportSource]) {
    assert.match(source, /api\("\/api\/workflow-states"\)/);
    assert.doesNotMatch(source, /const\s+(?:PRODUCTION|PUBLICATION|ASSIGNMENT)_STATES\s*=/);
    assert.match(source, /reportUnknownWorkflowState/);
  }
  assert.match(serverSource, /app\.get\("\/api\/workflow-states"[\s\S]*?\.\.\.PRODUCTION_STATES[\s\S]*?\.\.\.PUBLICATION_STATES[\s\S]*?\.\.\.ASSIGNMENT_STATES/);

  const generated = { id: 401, production_state: "generated", publication_state: "draft", assignment_state: "" };
  const future = { id: 402, production_state: "future_state", publication_state: "draft", assignment_state: "" };
  const catalog = { production_states: [...PRODUCTION_STATES], publication_states: [...PUBLICATION_STATES], assignment_states: [...ASSIGNMENT_STATES], place_review_flags: [...PLACE_REVIEW_FLAGS] };
  assert.equal(isUsableWorkflowStateCatalog(catalog), true);
  for (const invalidCatalog of [null, {}, [], { production_states: [], publication_states: [], assignment_states: [], place_review_flags: [] }]) {
    assert.equal(isUsableWorkflowStateCatalog(invalidCatalog), false);
    assert.equal(reportUnknownWorkflowState(future, invalidCatalog, new Set(), "test"), null);
  }
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    assert.equal(reportUnknownWorkflowState(generated, catalog, new Set(), "test"), null);
    const anomaly = reportUnknownWorkflowState(future, catalog, new Set(), "test");
    assert.equal(anomaly?.kind, "production");
    assert.equal(anomaly?.state, "future_state");
    assert.equal(logs[0][1].item_id, 402);
    assert.equal(logs[0][1].state, "future_state");
  } finally {
    console.error = originalError;
  }
  assert.match(dashboardSource, /return bucket === "raw_prep" \|\| bucket === "field_pack_review" \|\| bucket === "unknown_workflow"/);
  assert.match(dashboardSource, /Workflow state ผิดปกติ/);
  assert.match(editorSource, /⚠ เปิด item .*สถานะ workflow ผิดปกติ/);
  assert.match(intakeSource, /return \{ stageLabel: `⚠ \$\{anomaly\.state\}`/);
  assert.match(eventsSource, /return "unknown_workflow"/);
  assert.match(transportSource, /return "unknown_workflow"/);
  assert.match(editorSource, /api\("\/api\/workflow-states"\)\.catch\(\(\) => null\)/);
  assert.match(intakeSource, /api\("\/api\/workflow-states"\)\.catch\(\(\) => null\)/);
});
