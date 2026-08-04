import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { runCleanStage } from "../services/workflow.mjs";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

async function reservePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = Number(probe.address()?.port || 0);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForCollector(baseUrl, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`collector server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("collector server did not become ready");
}

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  const paramsOpen = appSource.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsOpen; index < appSource.length; index += 1) {
    if (appSource[index] === "(") paramsDepth += 1;
    if (appSource[index] === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  assert.ok(paramsEnd >= 0, `parameters for ${name} are not balanced`);
  const open = appSource.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = open; index < appSource.length; index += 1) {
    if (appSource[index] === "{") depth += 1;
    if (appSource[index] === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1);
    }
  }
  throw new Error(`function ${name} is not balanced`);
}

function loadRawIntakeHooks() {
  const splitSource = extractFunction("splitRawIntakeAndCleanPrep");
  const bucketSplitSource = extractFunction("splitRawQueueByFieldPack");
  const renderSource = extractFunction("renderRawTable");
  const state = {
    items: [],
    dashboard: {
      rawShowAll: true,
      rawLimit: 8,
      rawIntakeCollapsed: false,
      rawReviewCollapsed: false,
      rawTableCollapsed: false,
    },
  };
  const renderedTables = [];
  const nodes = new Map();
  const actionBodies = new Map([
    ["#table-raw-intake tbody", {}],
    ["#table-clean-prep tbody", {}],
    ["#table-raw-review tbody", {}],
  ]);
  const tableWrap = {
    html: "",
    set innerHTML(value) { this.html = value; },
    get innerHTML() { return this.html; },
    classList: { toggle() {} },
  };
  nodes.set("raw-table-wrap", tableWrap);
  const qs = (id) => nodes.get(id) || null;
  const renderRawQueueTable = (options) => renderedTables.push(options);
  const renderRawBulkToolbar = () => {};
  const hooks = new Function(
    "state",
    "qs",
    "sortRawItems",
    "getPreparationQueueItems",
    "resolveQueueBucket",
    "RAW_REVIEW_FILTERS",
    "isHandoffEligibleItem",
    "buildRawReviewFilterHtml",
    "canManageBulkContentItems",
    "pruneRawSelection",
    "renderRawQueueTable",
    "renderRawBulkToolbar",
    "getRawSelectedIds",
    "annotateRawTableBlockers",
    "document",
    `${splitSource}\n${bucketSplitSource}\n${renderSource}\nreturn { splitRawIntakeAndCleanPrep, splitRawQueueByFieldPack, renderRawTable };`
  )(
    state,
    qs,
    (items) => [...items],
    (items) => Array.isArray(items) ? items : [],
    (item) => String(item?.test_bucket || ""),
    [],
    () => false,
    () => "",
    () => false,
    () => {},
    renderRawQueueTable,
    renderRawBulkToolbar,
    () => new Set(),
    () => {},
    {
      getElementById: () => null,
      querySelector: (selector) => actionBodies.get(selector) || null,
      querySelectorAll: () => [],
    }
  );
  return { ...hooks, renderedTables, tableWrap, actionBodies };
}

function renderQueueTableForTest({
  item,
  showInterestingness,
  queueType,
  canManage = false,
  canClaim = false,
  canRelease = false,
  canTakeOver = false,
}) {
  const head = { innerHTML: "" };
  const rows = [];
  const tbody = { innerHTML: "", appendChild: (row) => rows.push(row) };
  const table = { querySelector: (selector) => selector === "tbody" ? tbody : head };
  const render = new Function(
    "state",
    "qs",
    "escapeHtml",
    "getRawSelectedIds",
    "isRawPreparationItem",
    "buildRawQueueStatusLabel",
    "buildRawQueueStatusBadgeClass",
    "isHandoffEligibleItem",
    "buildManualCompletenessBadge",
    "interestingnessBadgeClass",
    "formatPreparationClaimBadge",
    "canClaimPreparationItem",
    "canReleasePreparationItem",
    "canTakeOverPreparationItem",
    "document",
    `${extractFunction("renderRawQueueTable")}\nreturn renderRawQueueTable;`
  )(
    { justExportedItemId: 0, user: { id: 99 } },
    () => table,
    (value) => String(value ?? ""),
    () => new Set(),
    () => false,
    () => queueType === "clean_prep" ? "กำลังทำ Clean" : "รอคัดเข้า AI",
    () => "workflow-badge-cleaned",
    () => false,
    () => "",
    () => "priority-good",
    () => "<div>claim detail</div>",
    () => canClaim,
    () => canRelease,
    () => canTakeOver,
    { createElement: () => ({ innerHTML: "", dataset: {}, className: "" }) }
  );
  render({ tableId: "table", items: [item], canManage, showInterestingness, queueType });
  return { head: head.innerHTML, row: rows[0]?.innerHTML || "" };
}

test("Raw Intake / Clean Prep splitter is exhaustive and its real renderer keeps score and chip contracts", () => {
  const hooks = loadRawIntakeHooks();
  const items = [
    { id: 1, test_bucket: "raw_prep", claimed_by_user_id: null, cleaned_at: null, interestingness: { score: 91 } },
    { id: 2, test_bucket: "raw_prep", claimed_by_user_id: 22, cleaned_at: null, interestingness: { score: 72 } },
    { id: 3, test_bucket: "raw_prep", claimed_by_user_id: 33, cleaned_at: "2026-08-04 10:00:00", interestingness: { score: 55 } },
    { id: 4, test_bucket: "field_pack_review", claimed_by_user_id: null, cleaned_at: null, interestingness: { score: 41 } },
    { id: 5, test_bucket: "unknown_workflow", claimed_by_user_id: null, cleaned_at: null, interestingness: { score: 18 } },
  ];

  const buckets = hooks.splitRawQueueByFieldPack(items);
  const split = hooks.splitRawIntakeAndCleanPrep(buckets.intake);
  assert.deepEqual(split.rawIntake.map((item) => item.id), [1, 2]);
  assert.deepEqual(split.cleanPrep.map((item) => item.id), [3]);
  assert.deepEqual(
    [...split.rawIntake, ...split.cleanPrep].map((item) => item.id).sort((a, b) => a - b),
    [1, 2, 3],
    "every raw_prep item must be in exactly one of Raw Intake and Clean Prep"
  );

  hooks.renderRawTable(items);
  assert.equal(hooks.renderedTables.length, 4, "the page preserves its separate Field Pack Review and workflow-warning tables");
  assert.deepEqual(hooks.renderedTables[0].items.map((item) => item.id), [1, 2]);
  assert.equal(hooks.renderedTables[0].showInterestingness, true, "Raw Intake always renders interestingness");
  assert.deepEqual(hooks.renderedTables[1].items.map((item) => item.id), [3]);
  assert.equal(hooks.renderedTables[1].showInterestingness, false, "Clean Prep never renders interestingness");
  assert.equal(hooks.renderedTables[1].queueType, "clean_prep");
  assert.deepEqual(hooks.renderedTables[2].items.map((item) => item.id), [4]);
  assert.deepEqual(hooks.renderedTables[3].items.map((item) => item.id), [5]);
  const renderedIds = hooks.renderedTables.flatMap((table) => table.items.map((item) => item.id));
  assert.equal(new Set(renderedIds).size, renderedIds.length, "no item may render in more than one table");
  assert.deepEqual(renderedIds.sort((a, b) => a - b), [1, 2, 3, 4, 5], "no Process-1 item may disappear from all tables");
  assert.equal(hooks.tableWrap.innerHTML.includes("data-intake-filter"), false, "the removed intake filter chips are not rendered");

  const rawRow = renderQueueTableForTest({ item: items[0], showInterestingness: true, queueType: "intake" });
  assert.match(rawRow.head, /น่าสนใจ/);
  assert.doesNotMatch(rawRow.head, /สถานะ/, "Raw Intake has no status column");
  assert.equal((rawRow.head.match(/<th/g) || []).length, (rawRow.row.match(/<td/g) || []).length, "Raw Intake header/body column counts match");
  assert.match(rawRow.row, /#91/, "an unclaimed Raw Intake item renders its actual interest score");
  const cleanRow = renderQueueTableForTest({ item: items[2], showInterestingness: false, queueType: "clean_prep" });
  assert.match(cleanRow.head, /สถานะ/, "Clean Prep retains its status column");
  assert.doesNotMatch(cleanRow.head, /น่าสนใจ/);
  assert.doesNotMatch(cleanRow.row, /#55/, "a Clean Prep item does not render an interest score");
});

test("Raw Intake and Clean Prep action buttons retain handler attributes and delegated containers", () => {
  const hooks = loadRawIntakeHooks();
  const item = { id: 77, test_bucket: "raw_prep", claimed_by_user_id: 33, cleaned_at: "2026-08-04 10:00:00" };

  hooks.renderRawTable([item]);
  const rawActions = renderQueueTableForTest({
    item,
    showInterestingness: true,
    queueType: "intake",
    canManage: true,
    canClaim: true,
    canRelease: true,
    canTakeOver: true,
  }).row;
  const cleanPrepActions = renderQueueTableForTest({
    item,
    showInterestingness: false,
    queueType: "clean_prep",
    canManage: true,
    canRelease: true,
  }).row;

  assert.match(rawActions, /data-action="open-state-entry" data-id="77" data-url="[^"]+">คัดข้อมูล<\//);
  assert.match(rawActions, /data-action="claim-item" data-id="77">รับงานนี้<\//);
  assert.match(rawActions, /data-action="release-item" data-id="77"[^>]*>ปล่อยงาน<\//);
  assert.match(rawActions, /data-action="delete" data-id="77"[^>]*>ลบ<\//);
  assert.match(cleanPrepActions, /data-action="open-state-entry" data-id="77" data-url="[^"]+">ทำ Clean ต่อ<\//);
  assert.match(cleanPrepActions, /data-action="release-item" data-id="77"[^>]*>ปล่อยงาน<\//);
  assert.match(cleanPrepActions, /data-action="delete" data-id="77"[^>]*>ลบ<\//);

  const rawHandler = hooks.actionBodies.get("#table-raw-intake tbody").onclick;
  const cleanPrepHandler = hooks.actionBodies.get("#table-clean-prep tbody").onclick;
  assert.equal(typeof rawHandler, "function", "Raw Intake actions have their delegated handler");
  assert.equal(cleanPrepHandler, rawHandler, "Clean Prep actions use the same delegated handler as Raw Intake");
});

test("cleaned_at is set only by the user clean marker and not by runCleanStage", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-raw-intake-split-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.join(collectorRoot, "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  try {
    const repo = createRepository(db);
    const userCleanedItem = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title: "User clean signal",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://user-clean.example",
    }).item;
    assert.equal(repo.getWorkflowHeadByItem(userCleanedItem.id).cleaned_at, null);
    repo.upsertWorkflowModel(userCleanedItem.id, { cleaned_at: true }, "user@local", { actor_role: "user", reason_code: "clean_step_saved" });
    assert.ok(repo.getWorkflowHeadByItem(userCleanedItem.id).cleaned_at, "the user clean marker persists a timestamp");

    const systemCleanedItem = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title: "System clean signal",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://system-clean.example",
    }).item;
    await runCleanStage(repo, "system@local");
    assert.equal(repo.getWorkflowHeadByItem(systemCleanedItem.id).production_state, "analyzed");
    assert.equal(repo.getWorkflowHeadByItem(systemCleanedItem.id).cleaned_at, null, "runCleanStage must not mark a user Clean save");
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mark_cleaned HTTP route persists cleaned_at", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-mark-cleaned-route-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.join(collectorRoot, "database", "schema.sql");
  const authSecret = "test-cleaned-at-route-secret";
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const db = openDatabase(dbPath, schemaPath);
  let child = null;
  try {
    const repo = createRepository(db);
    const user = db.prepare(`
      INSERT INTO users (email, display_name, profile_json, password_hash, role)
      VALUES (?, ?, ?, '', 'user')
    `).run("cleaner@example.test", "Clean Editor", "{}");
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title: "HTTP clean signal",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://http-clean.example",
    }).item;
    repo.claimItem(item.id, Number(user.lastInsertRowid), { note: "test claim" });
    db.close();

    const token = jwt.sign(
      { id: 901, email: "cleaner@example.test", display_name: "Clean Editor", role: "user" },
      authSecret,
      { issuer: "uboncity-backend", audience: "uboncity-collector" }
    );
    child = spawn(process.execPath, [path.join(collectorRoot, "server", "index.mjs")], {
      cwd: collectorRoot,
      env: {
        ...process.env,
        COLLECTOR_ROOT: collectorRoot,
        DB_PATH: dbPath,
        PORT: String(port),
        BACKEND_JWT_SECRET: authSecret,
      },
      stdio: "ignore",
    });
    await waitForCollector(baseUrl, child);

    const response = await fetch(`${baseUrl}/api/items/${item.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ workflow_action: "mark_cleaned" }),
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.ok(updated.cleaned_at, "mark_cleaned response exposes the persisted timestamp");

    const verifyDb = openDatabase(dbPath, schemaPath);
    try {
      assert.ok(verifyDb.prepare("SELECT cleaned_at FROM content_workflow_models WHERE content_item_id=?").get(item.id)?.cleaned_at);
    } finally {
      verifyDb.close();
    }
  } finally {
    if (child && child.exitCode == null) {
      child.kill();
      await once(child, "exit");
    }
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
