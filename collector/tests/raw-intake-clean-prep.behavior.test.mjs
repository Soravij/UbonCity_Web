import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appSource = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");

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
    { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }
  );
  return { ...hooks, renderedTables, tableWrap };
}

function renderQueueTableForTest({ item, showInterestingness, queueType }) {
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
    () => false,
    () => false,
    () => false,
    { createElement: () => ({ innerHTML: "", dataset: {}, className: "" }) }
  );
  render({ tableId: "table", items: [item], showInterestingness, queueType });
  return { head: head.innerHTML, row: rows[0]?.innerHTML || "" };
}

test("Raw Intake / Clean Prep splitter is exhaustive and its real renderer keeps score and chip contracts", () => {
  const hooks = loadRawIntakeHooks();
  const items = [
    { id: 1, test_bucket: "raw_prep", claimed_by_user_id: null, has_active_approved_context: false, interestingness: { score: 91 } },
    { id: 2, test_bucket: "raw_prep", claimed_by_user_id: 22, has_active_approved_context: false, interestingness: { score: 72 } },
    { id: 3, test_bucket: "raw_prep", claimed_by_user_id: 33, has_active_approved_context: true, interestingness: { score: 55 } },
    { id: 4, test_bucket: "field_pack_review", claimed_by_user_id: null, has_active_approved_context: false, interestingness: { score: 41 } },
    { id: 5, test_bucket: "unknown_workflow", claimed_by_user_id: null, has_active_approved_context: false, interestingness: { score: 18 } },
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
  assert.match(rawRow.row, /#91/, "an unclaimed Raw Intake item renders its actual interest score");
  const cleanRow = renderQueueTableForTest({ item: items[2], showInterestingness: false, queueType: "clean_prep" });
  assert.doesNotMatch(cleanRow.head, /น่าสนใจ/);
  assert.doesNotMatch(cleanRow.row, /#55/, "a Clean Prep item does not render an interest score");
});

test("repository reports active approved context as a smallest boolean list signal", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-raw-intake-split-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.join(collectorRoot, "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  try {
    const repo = createRepository(db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title: "Approved context signal",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://approved-context.example",
    }).item;
    const evidence = repo.addEvidenceBlock(item.id, { block_type: "fact", text_value: "verified fact" });

    assert.equal(repo.hasActiveApprovedContext(item.id), false);
    repo.addApprovedContextBlock(item.id, { evidence_block_id: evidence.id, selected_text: "verified fact" }, "tester@local");
    assert.equal(repo.hasActiveApprovedContext(item.id), true);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
