import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

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
  const transitions = db.prepare("SELECT state_group, from_state, to_state FROM content_workflow_transitions WHERE content_item_id=? ORDER BY id DESC").all(item.id);
  assert.ok(transitions.some((row) => row.state_group === "place_review_flag" && row.from_state === "none" && row.to_state === "revision_requested"));
  db.close();

  runMigration(dbPath, true);
  db = new DatabaseSync(dbPath);
  head = db.prepare("SELECT production_state FROM content_workflow_models WHERE content_item_id=?").get(item.id);
  assert.equal(head.production_state, "needs_revision");
  assert.equal(db.prepare("PRAGMA table_info(content_workflow_models)").all().some((row) => row.name === "place_review_flag"), false);
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
