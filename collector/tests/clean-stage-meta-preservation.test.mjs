import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { runCleanStage } from "../services/workflow.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.dirname(__dirname);

test("runCleanStage preserves meta_title and meta_description", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-meta-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.join(collectorRoot, "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  try {
    const repo = createRepository(db);
    const result = repo.createItemWithWorkflowHead(
      {
        type: "place",
        category: "attractions",
        title: "Meta Preserve Test",
        description_raw: "some description",
        source_type: "manual",
        source_name: "manual",
        source_url: "https://example.test/meta",
      },
      { production_state: "collected" }
    );
    const itemId = result.item.id;

    db.prepare(
      "UPDATE content_items SET meta_title=?, meta_description=? WHERE id=?"
    ).run("My Custom Title", "My Custom Description", itemId);

    const before = db.prepare("SELECT meta_title, meta_description FROM content_items WHERE id=?").get(itemId);
    assert.equal(before.meta_title, "My Custom Title");
    assert.equal(before.meta_description, "My Custom Description");

    await runCleanStage(repo, "test@local");

    const after = db.prepare("SELECT meta_title, meta_description FROM content_items WHERE id=?").get(itemId);
    assert.equal(after.meta_title, "My Custom Title", "meta_title must survive runCleanStage");
    assert.equal(after.meta_description, "My Custom Description", "meta_description must survive runCleanStage");
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
