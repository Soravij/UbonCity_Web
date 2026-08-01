import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const scriptPath = path.resolve("collector/scripts/migrate-remove-assignment-state.mjs");

function runMigration(dbPath, down = false) {
  const result = spawnSync(process.execPath, [scriptPath, "--db", dbPath, ...(down ? ["--down"] : [])], {
    cwd: path.resolve("collector"),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function assertWorkflowModelSchema(db, withAssignmentState) {
  const columns = db.prepare("PRAGMA table_info(content_workflow_models)").all();
  assert.equal(columns.some((row) => row.name === "assignment_state"), withAssignmentState);
  assert.equal(
    db.prepare("PRAGMA foreign_key_list(content_workflow_models)").all()
      .some((row) => row.table === "content_items" && row.from === "content_item_id" && row.on_delete === "CASCADE"),
    true,
    "content_item_id ON DELETE CASCADE must survive table rebuild"
  );
  assert.equal(
    db.prepare("PRAGMA index_list(content_workflow_models)").all()
      .some((row) => row.unique === 1 && row.origin === "u"),
    true,
    "content_item_id UNIQUE must survive table rebuild"
  );
  const indexes = new Set(db.prepare("PRAGMA index_list(content_workflow_models)").all().map((row) => row.name));
  for (const indexName of [
    "idx_content_workflow_models_production",
    "idx_content_workflow_models_publication",
    "idx_content_workflow_models_current_draft",
    "idx_content_workflow_models_current_review",
    "idx_content_workflow_models_current_field_pack",
  ]) {
    assert.equal(indexes.has(indexName), true, `${indexName} must survive table rebuild`);
  }
  assert.equal(indexes.has("idx_content_workflow_models_assignment"), withAssignmentState);
}

test("assignment_state migration removes the mirror and reverse restores a nullable legacy column", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-assignment-state-migration-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  try {
    let db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
    const repo = createRepository(db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "test",
      title: "assignment mirror migration",
      description_raw: "test",
      source_type: "manual",
      source_name: "test",
    }, {
      production_state: "field_working",
      place_review_flag: "revision_requested",
    }).item;
    db.close();

    runMigration(dbPath, true);
    db = new DatabaseSync(dbPath);
    db.prepare("UPDATE content_workflow_models SET assignment_state='accepted' WHERE content_item_id=?").run(item.id);
    assertWorkflowModelSchema(db, true);
    db.close();

    runMigration(dbPath);
    db = new DatabaseSync(dbPath);
    assertWorkflowModelSchema(db, false);
    assert.deepEqual(
      { ...db.prepare(`
        SELECT content_item_id, production_state, publication_state, place_review_flag, state_version, content_version
        FROM content_workflow_models
        WHERE content_item_id=?
      `).get(item.id) },
      {
        content_item_id: item.id,
        production_state: "field_working",
        publication_state: "draft",
        place_review_flag: "revision_requested",
        state_version: 1,
        content_version: 0,
      }
    );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.throws(
      () => db.prepare("INSERT INTO content_workflow_models (content_item_id) VALUES (?)").run(item.id),
      /UNIQUE constraint failed/
    );
    db.close();

    runMigration(dbPath, true);
    db = new DatabaseSync(dbPath);
    assertWorkflowModelSchema(db, true);
    assert.equal(db.prepare("SELECT assignment_state FROM content_workflow_models WHERE content_item_id=?").get(item.id).assignment_state, null);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    db.close();

    runMigration(dbPath);
    db = new DatabaseSync(dbPath);
    assertWorkflowModelSchema(db, false);
    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
