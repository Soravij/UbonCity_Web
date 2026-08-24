import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportUnknownWorkflowState } from "../server/public/workflow-state-catalog.js";
import { PRODUCTION_STATES, PUBLICATION_STATES, ASSIGNMENT_STATES, PLACE_REVIEW_FLAGS } from "../db/repository.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_JS_PATH = path.resolve(__dirname, "..", "server", "public", "app.js");

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

describe("ready_for_writer queue bucket", () => {
  let resolveQueueBucket;

  before(() => {
    ({ resolveQueueBucket } = loadResolveQueueBucket());
  });

  it("ready_for_writer + hasFieldPack=true + ready_for_field → handoff", () => {
    const item = {
      production_state: "ready_for_writer",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: false,
      current_field_pack_id: 10,
      current_field_pack_status: "ready_for_field",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "handoff",
      `expected handoff but got ${bucket} for ready_for_writer with field pack`);
  });

  it("ready_for_writer + hasFieldPack=true + ready_for_handoff → handoff", () => {
    const item = {
      production_state: "ready_for_writer",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: false,
      current_field_pack_id: 10,
      current_field_pack_status: "ready_for_handoff",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "handoff",
      `expected handoff but got ${bucket} for ready_for_writer with ready_for_handoff pack`);
  });

  it("ready_for_writer + hasFieldPack=true + draft status → field_pack_review (not handoff)", () => {
    const item = {
      production_state: "ready_for_writer",
      publication_state: "draft",
      has_accepted_assignment: false,
      has_open_assignment: false,
      current_field_pack_id: 10,
      current_field_pack_status: "draft",
    };
    const bucket = resolveQueueBucket(item);
    assert.equal(bucket, "field_pack_review",
      `expected field_pack_review but got ${bucket} for ready_for_writer with draft pack`);
  });
});
