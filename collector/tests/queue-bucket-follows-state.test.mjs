import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../db/client.mjs";
import { createRepository, ASSIGNMENT_STATES, PRODUCTION_STATES, PUBLICATION_STATES, PLACE_REVIEW_FLAGS } from "../db/repository.mjs";
import { advancePlaceProductionState } from "./test-helpers/fixture-ladder.mjs";
import { reportUnknownWorkflowState } from "../server/public/workflow-state-catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "QueueBucket!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "queue-bucket-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve(process.cwd(), "collector", "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  return { db, repo, cleanup };
}

function createPlace(repo, productionState) {
  const result = repo.createItemWithWorkflowHead({
    type: "place",
    category: "attractions",
    title: `Place head=${productionState}`,
    description_raw: "test description",
    description_clean: "test description",
    summary: "",
    meta_title: "",
    meta_description: "",
    image_url: "",
    tags: [],
    lang: "th",
    source_type: "manual",
    source_name: "test",
  });
  const itemId = Number(result?.item?.id || 0) || 0;
  if (productionState !== "collected") {
    advancePlaceProductionState(repo, itemId, productionState);
  }
  return repo.getItem(itemId);
}

const HANDOFF_STATES = [
  "ready_for_content", "field_working", "field_review",
  "writing_assigned", "writing", "in_review",
  "ready_for_publish", "submitted_for_admin_review", "completed",
];

function resolveBucket(productionState, fieldPackStatus) {
  const hasFieldPack = Boolean(fieldPackStatus);
  const isReady = fieldPackStatus === "ready_for_field" || fieldPackStatus === "ready_for_handoff";
  const headAtReadyOrAbove = HANDOFF_STATES.includes(productionState);

  if (hasFieldPack && isReady && headAtReadyOrAbove) return "handoff";
  if (hasFieldPack) return "field_pack_review";
  return "raw_prep";
}

describe("queue-bucket-follows-state", () => {
  let ctx;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("item head=analyzed + pack ready_for_field → NOT in handoff bucket", () => {
    const place = createPlace(ctx.repo, "analyzed");
    ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "draft",
      ai_summary: "test pack",
    });

    const wm = ctx.repo.ensureWorkflowModel(place.id);
    const bucket = resolveBucket(wm.production_state, "ready_for_field");

    assert.equal(bucket, "field_pack_review",
      `expected field_pack_review but got ${bucket} (productionState=${wm.production_state})`);
  });

  it("item head=ready_for_content + pack ready_for_field → in handoff bucket", () => {
    const place = createPlace(ctx.repo, "ready_for_content");
    ctx.repo.createFieldPack({
      content_item_id: place.id,
      status: "draft",
      ai_summary: "test pack",
    });

    const wm = ctx.repo.ensureWorkflowModel(place.id);
    const bucket = resolveBucket(wm.production_state, "ready_for_field");

    assert.equal(bucket, "handoff",
      `expected handoff but got ${bucket} (productionState=${wm.production_state})`);
  });
});

// ── resolveQueueBucket integration (uses real app.js logic) ──

const APP_JS_PATH = path.resolve(process.cwd(), "collector", "server", "public", "app.js");

function loadResolveQueueBucket() {
  const src = fs.readFileSync(APP_JS_PATH, "utf8");

  const extractFunction = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} not found in app.js`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces while extracting ${name}`);
  };

  const catalog = {
    production_states: [...PRODUCTION_STATES],
    publication_states: [...PUBLICATION_STATES],
    assignment_states: [...ASSIGNMENT_STATES],
    place_review_flags: [...PLACE_REVIEW_FLAGS],
  };

  const names = [
    "getItemWorkflowSnapshot",
    "getUnknownWorkflowState",
    "isAssignmentContextReady",
    "resolveQueueBucket",
  ];

  const stateInit = `const state = { workflowStates: ${JSON.stringify(catalog)}, workflowStateLogKeys: new Set() };`;
  const body = `${stateInit}\n${names.map(extractFunction).join("\n\n")}`;
  const fn = new Function("reportUnknownWorkflowState", `${body}\nreturn { ${names.join(", ")} };`);
  return fn(reportUnknownWorkflowState);
}

describe("resolveQueueBucket open-assignment guard", () => {
  let resolveQueueBucket;

  before(() => {
    ({ resolveQueueBucket } = loadResolveQueueBucket());
  });

  it("item field_working + in_progress assignment → NOT in handoff bucket (goes to assignment)", () => {
    const item = {
      production_state: "field_working",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: true,
      current_field_pack_id: 10,
      current_field_pack_status: "ready_for_field",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "assignment",
      `expected assignment but got ${bucket}`);
  });

  it("item no assignment + pack ready_for_field + field_working → in handoff bucket", () => {
    const item = {
      production_state: "field_working",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: false,
      current_field_pack_id: 10,
      current_field_pack_status: "ready_for_field",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "handoff",
      `expected handoff but got ${bucket}`);
  });

  it("item accepted assignment → assignment bucket", () => {
    const item = {
      production_state: "field_working",
      publication_state: "draft",
      has_accepted_assignment: true,
      has_open_assignment: true,
      current_field_pack_id: 10,
      current_field_pack_status: "ready_for_field",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "assignment",
      `expected assignment but got ${bucket}`);
  });

  it("item closed assignment (not open) + field_working → handoff bucket", () => {
    const item = {
      production_state: "field_working",
      publication_state: "draft",
      has_accepted_assignment: true,
      has_open_assignment: false,
      current_field_pack_id: 10,
      current_field_pack_status: "ready_for_field",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "handoff",
      `expected handoff but got ${bucket}`);
  });
});
