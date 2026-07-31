import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../db/client.mjs";
import { createRepository, TRANSITION_RULES } from "../db/repository.mjs";

const scriptPath = path.resolve("collector/scripts/migrate-place-review-flags.mjs");

function runMigration(dbPath, down = false) {
  const result = spawnSync(process.execPath, [scriptPath, "--db", dbPath, ...(down ? ["--down"] : [])], {
    cwd: path.resolve("collector"),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runMigrationExpectFailure(dbPath, down = false) {
  const result = spawnSync(process.execPath, [scriptPath, "--db", dbPath, ...(down ? ["--down"] : [])], {
    cwd: path.resolve("collector"),
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, "migration should reject unsafe reversal");
  return `${result.stderr || ""}\n${result.stdout || ""}`;
}

function assertWorkflowModelSchemaPreserved(db, hasPlaceReviewFlag) {
  const columns = db.prepare("PRAGMA table_info(content_workflow_models)").all();
  assert.equal(columns.some((row) => row.name === "place_review_flag"), hasPlaceReviewFlag);
  assert.equal(
    db.prepare("PRAGMA foreign_key_list(content_workflow_models)").all()
      .some((row) => row.table === "content_items" && row.from === "content_item_id" && row.on_delete === "CASCADE"),
    true
  );
  assert.equal(
    db.prepare("PRAGMA index_list(content_workflow_models)").all()
      .some((row) => row.unique === 1 && row.origin === "u"),
    true,
    "content_item_id UNIQUE must survive table rebuild"
  );
  for (const indexName of [
    "idx_content_workflow_models_production",
    "idx_content_workflow_models_publication",
    "idx_content_workflow_models_assignment",
    "idx_content_workflow_models_current_draft",
    "idx_content_workflow_models_current_review",
    "idx_content_workflow_models_current_field_pack",
  ]) {
    assert.equal(db.prepare("PRAGMA index_list(content_workflow_models)").all().some((row) => row.name === indexName), true, `${indexName} must survive table rebuild`);
  }
}

test("place review flag migration converts a traceable legacy revision and reverses it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-place-flag-migration-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  let db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  const item = repo.createItemWithWorkflowHead({
    type: "place",
    category: "test",
    title: "migration place",
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }, { production_state: "generated" }).item;
  db.close();

  runMigration(dbPath, true);
  db = new DatabaseSync(dbPath);
  db.prepare("UPDATE content_workflow_models SET production_state='needs_revision' WHERE content_item_id=?").run(item.id);
  db.prepare(`
    INSERT INTO content_workflow_transitions (content_item_id, state_group, from_state, to_state)
    VALUES (?, 'production', 'generated', 'needs_revision')
  `).run(item.id);
  db.close();

  runMigration(dbPath);
  db = new DatabaseSync(dbPath);
  let head = db.prepare("SELECT production_state, place_review_flag FROM content_workflow_models WHERE content_item_id=?").get(item.id);
  assert.deepEqual({ ...head }, { production_state: "analyzed", place_review_flag: "revision_requested" });
  assertWorkflowModelSchemaPreserved(db, true);
  const transitions = db.prepare("SELECT state_group, from_state, to_state FROM content_workflow_transitions WHERE content_item_id=? ORDER BY id DESC").all(item.id);
  assert.ok(transitions.some((row) => row.state_group === "place_review_flag" && row.from_state === "none" && row.to_state === "revision_requested"));
  db.close();

  runMigration(dbPath, true);
  db = new DatabaseSync(dbPath);
  head = db.prepare("SELECT production_state FROM content_workflow_models WHERE content_item_id=?").get(item.id);
  assert.equal(head.production_state, "needs_revision");
  assertWorkflowModelSchemaPreserved(db, false);
  db.close();

  runMigration(dbPath);
  db = new DatabaseSync(dbPath);
  head = db.prepare("SELECT production_state, place_review_flag FROM content_workflow_models WHERE content_item_id=?").get(item.id);
  assert.deepEqual({ ...head }, { production_state: "analyzed", place_review_flag: "revision_requested" });
  assertWorkflowModelSchemaPreserved(db, true);
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("reverse migration refuses a post-migration P2 revision flag instead of inventing a legacy position", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-place-flag-down-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  repo.createItemWithWorkflowHead({
    type: "place",
    category: "test",
    title: "P2 revision",
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }, { production_state: "field_working", place_review_flag: "revision_requested" });
  db.close();

  assert.match(runMigrationExpectFailure(dbPath, true), /was created after the migration/);
  const verify = new DatabaseSync(dbPath);
  assert.equal(verify.prepare("PRAGMA table_info(content_workflow_models)").all().some((row) => row.name === "place_review_flag"), true);
  assert.equal(verify.prepare("SELECT place_review_flag FROM content_workflow_models LIMIT 1").get().place_review_flag, "revision_requested");
  verify.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("forward migration maps only targets with outgoing place edges and rejects a rejected item from needs_revision", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-place-flag-targets-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  let db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  const supportedSources = new Map([
    ["collected", "collected"],
    ["analyzed", "analyzed"],
    ["generated", "analyzed"],
    ["field_review", "field_working"],
    ["in_review", "writing"],
    ["ready_for_publish", "in_review"],
    ["submitted_for_admin_review", "in_review"],
  ]);
  const items = [];
  for (const source of supportedSources.keys()) {
    items.push(repo.createItemWithWorkflowHead({
      type: "place",
      category: "test",
      title: `legacy ${source}`,
      description_raw: "test",
      source_type: "manual",
      source_name: "test",
    }, { production_state: source }).item);
  }
  const completed = repo.createItemWithWorkflowHead({
    type: "place",
    category: "test",
    title: "legacy completed",
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }, { production_state: "completed" }).item;
  const rejected = repo.createItemWithWorkflowHead({
    type: "place",
    category: "test",
    title: "legacy rejected after revision",
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }, { production_state: "generated" }).item;
  const directRejected = repo.createItemWithWorkflowHead({
    type: "place",
    category: "test",
    title: "legacy rejected from review",
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }, { production_state: "in_review" }).item;
  db.close();

  runMigration(dbPath, true);
  db = new DatabaseSync(dbPath);
  for (const [index, source] of [...supportedSources.keys()].entries()) {
    db.prepare("UPDATE content_workflow_models SET production_state='needs_revision' WHERE content_item_id=?").run(items[index].id);
    db.prepare("INSERT INTO content_workflow_transitions (content_item_id, state_group, from_state, to_state) VALUES (?, 'production', ?, 'needs_revision')")
      .run(items[index].id, source);
  }
  db.prepare("UPDATE content_workflow_models SET production_state='needs_revision' WHERE content_item_id=?").run(completed.id);
  db.prepare("INSERT INTO content_workflow_transitions (content_item_id, state_group, from_state, to_state) VALUES (?, 'production', 'completed', 'needs_revision')")
    .run(completed.id);
  db.prepare("UPDATE content_workflow_models SET production_state='needs_revision' WHERE content_item_id=?").run(rejected.id);
  db.prepare("INSERT INTO content_workflow_transitions (content_item_id, state_group, from_state, to_state) VALUES (?, 'production', 'generated', 'needs_revision')")
    .run(rejected.id);
  db.prepare("UPDATE content_workflow_models SET production_state='rejected' WHERE content_item_id=?").run(rejected.id);
  db.prepare("INSERT INTO content_workflow_transitions (content_item_id, state_group, from_state, to_state) VALUES (?, 'production', 'needs_revision', 'rejected')")
    .run(rejected.id);
  db.prepare("UPDATE content_workflow_models SET production_state='rejected' WHERE content_item_id=?").run(directRejected.id);
  db.prepare("INSERT INTO content_workflow_transitions (content_item_id, state_group, from_state, to_state) VALUES (?, 'production', 'in_review', 'rejected')")
    .run(directRejected.id);
  db.close();

  assert.match(runMigrationExpectFailure(dbPath), new RegExp(`cannot migrate place ${completed.id}: target 'completed' has no outgoing`));
  db = new DatabaseSync(dbPath);
  assert.equal(db.prepare("SELECT production_state FROM content_workflow_models WHERE content_item_id=?").get(completed.id).production_state, "needs_revision");
  assert.equal(db.prepare("PRAGMA table_info(content_workflow_models)").all().some((row) => row.name === "place_review_flag"), false);
  db.close();

  db = new DatabaseSync(dbPath);
  db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(completed.id);
  db.prepare("DELETE FROM content_items WHERE id=?").run(completed.id);
  db.close();
  assert.match(runMigrationExpectFailure(dbPath), new RegExp(`cannot migrate place ${rejected.id}: rejected source 'needs_revision' has no reversible place target`));
  db = new DatabaseSync(dbPath);
  assert.equal(db.prepare("SELECT production_state FROM content_workflow_models WHERE content_item_id=?").get(rejected.id).production_state, "rejected");
  assert.equal(db.prepare("PRAGMA table_info(content_workflow_models)").all().some((row) => row.name === "place_review_flag"), false);
  db.close();

  db = new DatabaseSync(dbPath);
  db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(rejected.id);
  db.prepare("DELETE FROM content_items WHERE id=?").run(rejected.id);
  db.close();
  runMigration(dbPath);
  db = new DatabaseSync(dbPath);
  for (const [index, target] of [...supportedSources.values()].entries()) {
    assert.equal(db.prepare("SELECT production_state FROM content_workflow_models WHERE content_item_id=?").get(items[index].id).production_state, target);
    assert.ok(TRANSITION_RULES.place.production[target].size > 0, `${target} must have an outgoing place edge`);
  }
  assert.deepEqual(
    { ...db.prepare("SELECT production_state, place_review_flag FROM content_workflow_models WHERE content_item_id=?").get(directRejected.id) },
    { production_state: "writing", place_review_flag: "rejected" }
  );
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("migration adds the database CHECK and bootstrap refuses an unmigrated workflow-head table", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-place-flag-bootstrap-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  let db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
  db.close();

  runMigration(dbPath, true);
  assert.throws(
    () => openDatabase(dbPath, path.resolve("collector/database/schema.sql")),
    /place_review_flag is missing; run npm run migrate:place-review-flags/
  );
  db = new DatabaseSync(dbPath);
  assert.throws(
    () => createRepository(db),
    /place_review_flag is missing; run npm run migrate:place-review-flags/
  );
  assert.equal(db.prepare("PRAGMA table_info(content_workflow_models)").all().some((row) => row.name === "place_review_flag"), false);
  db.close();

  db = new DatabaseSync(dbPath);
  db.exec("ALTER TABLE content_workflow_models ADD COLUMN place_review_flag TEXT NOT NULL DEFAULT 'none';");
  db.close();
  assert.throws(
    () => openDatabase(dbPath, path.resolve("collector/database/schema.sql")),
    /place_review_flag is missing its CHECK constraint; run npm run migrate:place-review-flags/
  );

  runMigration(dbPath);
  db = openDatabase(dbPath, path.resolve("collector/database/schema.sql"));
  const repo = createRepository(db);
  const item = repo.createItemWithWorkflowHead({
    type: "place",
    category: "test",
    title: "CHECK enforcement",
    description_raw: "test",
    source_type: "manual",
    source_name: "test",
  }).item;
  assert.throws(
    () => db.prepare("UPDATE content_workflow_models SET place_review_flag='future_flag' WHERE content_item_id=?").run(item.id),
    /CHECK constraint failed/
  );
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
