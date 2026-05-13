import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.resolve(scriptDir, "..");
const dirs = resolvePaths(collectorRoot);
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
const db = openDatabase(dirs.dbPath, schemaPath);
const repo = createRepository(db);

const actor = "smoke@local";

function createBaseItem(title) {
  return {
    type: "place",
    category: "attractions",
    lang: "th",
    title,
    description_raw: title,
    description_clean: title,
    source_type: "manual",
    source_name: "smoke",
  };
}

function runSmokeCreateAnalyzedGenerated() {
  const { item } = repo.createItemWithWorkflowHead(
    createBaseItem("smoke-create-analyzed-generated"),
    {
      production_state: "collected",
      publication_state: "draft",
      last_transition_note: "smoke create",
    },
    actor,
    { actor_role: "system", reason_code: "smoke_create", bump_state_version: true }
  );
  const itemId = Number(item?.id || 0) || 0;
  const headAfterCreate = repo.ensureWorkflowModel(itemId);
  const headAfterAnalyzed = repo.advanceWorkflowHead(
    itemId,
    {
      production_state: "analyzed",
      publication_state: "draft",
      last_transition_note: "smoke analyzed",
    },
    actor,
    { actor_role: "system", reason_code: "smoke_analyzed", bump_state_version: true }
  );
  const headAfterGenerated = repo.advanceWorkflowHead(
    itemId,
    {
      production_state: "generated",
      publication_state: "draft",
      last_transition_note: "smoke generated",
    },
    actor,
    { actor_role: "system", reason_code: "smoke_generated", bump_state_version: true }
  );
  const drift = repo.getWorkflowStateDriftByItem(itemId);
  repo.deleteItem(itemId, actor);
  return {
    smoke: "create->analyzed->generated",
    item_id: itemId,
    create_state: headAfterCreate?.production_state || null,
    analyzed_state: headAfterAnalyzed?.production_state || null,
    generated_state: headAfterGenerated?.production_state || null,
    drift: Boolean(drift?.has_drift),
  };
}

function runSmokeRejectedReopen() {
  const { item } = repo.createItemWithWorkflowHead(
    createBaseItem("smoke-rejected-reopen"),
    {
      production_state: "rejected",
      publication_state: "draft",
      last_transition_note: "smoke rejected",
    },
    actor,
    { actor_role: "system", reason_code: "smoke_rejected", bump_state_version: true }
  );
  const itemId = Number(item?.id || 0) || 0;
  const headAfterCreate = repo.ensureWorkflowModel(itemId);
  const headAfterReopen = repo.advanceWorkflowHead(
    itemId,
    {
      production_state: "analyzed",
      publication_state: "draft",
      last_transition_note: "smoke reopen",
    },
    actor,
    { actor_role: "admin", reason_code: "smoke_reopen", bump_state_version: true }
  );
  const drift = repo.getWorkflowStateDriftByItem(itemId);
  repo.deleteItem(itemId, actor);
  return {
    smoke: "rejected->analyzed",
    item_id: itemId,
    create_state: headAfterCreate?.production_state || null,
    reopen_state: headAfterReopen?.production_state || null,
    drift: Boolean(drift?.has_drift),
  };
}

function runSmokeUpdateWithWorkflowHead() {
  const { item } = repo.createItemWithWorkflowHead(
    createBaseItem("smoke-update-with-workflow-head"),
    {
      production_state: "collected",
      publication_state: "draft",
      last_transition_note: "smoke create update-case",
    },
    actor,
    { actor_role: "system", reason_code: "smoke_create_update_case", bump_state_version: true }
  );
  const itemId = Number(item?.id || 0) || 0;
  const updated = repo.updateItemWithWorkflowHead(
    {
      ...item,
      id: itemId,
      title: "smoke-update-with-workflow-head-updated",
      description_raw: "updated",
      description_clean: "updated",
    },
    actor,
    {
      workflow_patch: {
        production_state: "analyzed",
        publication_state: "draft",
        last_transition_note: "smoke update advanced",
      },
      workflow_metadata: {
        actor_role: "system",
        reason_code: "smoke_update_advance",
        bump_state_version: true,
      },
    }
  );
  const ensured = repo.ensureWorkflowModel(itemId);
  const drift = repo.getWorkflowStateDriftByItem(itemId);
  repo.deleteItem(itemId, actor);
  return {
    smoke: "update-helper-path",
    item_id: itemId,
    updated_title: updated?.item?.title || null,
    current_state: ensured?.production_state || null,
    drift: Boolean(drift?.has_drift),
  };
}

try {
  const results = [
    runSmokeCreateAnalyzedGenerated(),
    runSmokeRejectedReopen(),
    runSmokeUpdateWithWorkflowHead(),
  ];
  console.log(JSON.stringify({ results }, null, 2));
} finally {
  db.close();
}
