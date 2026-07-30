import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { runQualityStage } from "../services/workflow.mjs";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const serverSource = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");

function extractFunctionSource(name) {
  const start = serverSource.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const open = serverSource.indexOf("{", serverSource.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < serverSource.length; index += 1) {
    if (serverSource[index] === "{") depth += 1;
    if (serverSource[index] === "}") {
      depth -= 1;
      if (depth === 0) return serverSource.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${name}`);
}

function loadServerReaderHooks(logs) {
  const context = {
    console: { error: (...args) => logs.push(args) },
    Set,
  };
  const source = `
const PRODUCTION_STATES = new Set(["collected", "analyzed", "brief_generated", "ready_for_content", "content_in_progress", "generated", "in_review", "needs_revision", "ready_for_publish", "submitted_for_admin_review", "rejected", "completed"]);
const PUBLICATION_STATES = new Set(["draft", "approved", "published", "unpublished", "archived", "deleted"]);
const ASSIGNMENT_STATES = new Set(["assigned", "in_progress", "submitted", "revision_requested", "resubmitted", "accepted", "closed"]);
${extractFunctionSource("findUnknownWorkflowModelState")}
${extractFunctionSource("logUnknownWorkflowModelState")}
${extractFunctionSource("assertKnownWorkflowModelStates")}
${extractFunctionSource("rejectUnknownWorkflowModelState")}
${extractFunctionSource("isClaimableRawPoolItem")}
${extractFunctionSource("buildItemWorkScopeState")}
${extractFunctionSource("deriveArticleProcessStatus")}
globalThis.__hooks = { isClaimableRawPoolItem, buildItemWorkScopeState, deriveArticleProcessStatus, rejectUnknownWorkflowModelState };
`;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "workflow-reader-hooks.js" });
  return context.__hooks;
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
    assert.throws(
      () => repo.listItemsByWorkflowHead({ production_states: ["future_state"] }),
      /unknown production state 'future_state'/
    );
    db.prepare("UPDATE content_workflow_models SET production_state='future_state' WHERE content_item_id=?").run(itemId);
    assert.throws(() => repo.listItemsByWorkflowHead({ production_states: ["generated"] }), /unknown production state 'future_state'/);

    await assert.rejects(
      runQualityStage({
        createPipelineRun() { return "quality-test"; },
        listItemsByWorkflowHead() { return [{ id: 202, production_state: "future_state" }]; },
      }, "tester@local"),
      /unknown production state 'future_state'/
    );

    const serverLogs = [];
    const hooks = loadServerReaderHooks(serverLogs);
    const unknownModel = { production_state: "future_state", publication_state: "draft" };
    assert.throws(() => hooks.isClaimableRawPoolItem({ id: 303, ...unknownModel }), /unknown production state 'future_state'/);
    assert.throws(() => hooks.buildItemWorkScopeState({ id: 304, ...unknownModel }, null), /unknown production state 'future_state'/);
    assert.throws(() => hooks.deriveArticleProcessStatus({ id: 305 }, unknownModel), /unknown production state 'future_state'/);
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
    assert.match(
      serverSource,
      /const workflowBefore = repo\.ensureWorkflowModel\(sourceContentItemId\);\s*if \(rejectUnknownWorkflowModelState\(res, "web-review-feedback", sourceContentItemId, workflowBefore\)\) \{\s*return;\s*\}/
    );

    assert.equal(logs.some((args) => args[0] === "[workflow-reader] unknown workflow state" && args[1]?.item_id === null), true);
    assert.equal(logs.some((args) => args[0] === "[workflow-reader] unknown workflow state" && args[1]?.item_id === itemId), true);
    assert.equal(logs.some((args) => args[0] === "[workflow-reader] unknown workflow state" && args[1]?.item_id === 202), true);
    assert.equal(serverLogs.filter((args) => args[0] === "[workflow-reader] unknown workflow state").length, 4);
  } finally {
    console.error = originalError;
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}, { concurrency: false });
