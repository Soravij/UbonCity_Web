import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "FieldPack!Test1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-keep-sources-"));
  const db = openDatabase(path.join(tempDir, "test.sqlite"), path.join(root, "database", "schema.sql"));
  const repo = createRepository(db);
  function cleanup() {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return { db, repo, cleanup };
}

function readSources(db, itemId) {
  return db
    .prepare("SELECT source_type, source_url FROM source_records WHERE content_item_id=? ORDER BY id")
    .all(itemId)
    .map((r) => ({ source_type: r.source_type, source_url: r.source_url }));
}

const URL_A = "https://maps.example/a";
const URL_B = "https://wiki.example/b";

function setup(ctx) {
  const item = ctx.repo.saveItem(
    { type: "place", category: "attractions", lang: "th", title: "ทดสอบ", source_type: "google_maps", source_url: URL_A },
    "tester@local"
  );
  ctx.repo.saveItem(
    { id: item.id, type: "place", category: "attractions", lang: "th", title: "ทดสอบ", source_type: "manual", source_url: URL_B },
    "tester@local"
  );
  return item.id;
}

test("saveItem update keeps existing source_records", async (t) => {
  const ctx = createTestContext();
  try {
    const id = setup(ctx);
    assert.deepEqual(readSources(ctx.db, id).map((r) => r.source_url), [URL_A, URL_B]);

    await t.test("A: update without source_* keeps both rows, adds no null-url row", () => {
      ctx.repo.saveItem({ id, type: "place", category: "attractions", lang: "th", title: "ทดสอบ 2" }, "tester@local");
      const rows = readSources(ctx.db, id);
      assert.deepEqual(rows.map((r) => r.source_url), [URL_A, URL_B]);
      assert.ok(rows.every((r) => r.source_url !== null));
    });

    await t.test("C: title updated after A", () => {
      assert.equal(ctx.repo.getItem(id).title, "ทดสอบ 2");
    });

    await t.test("B: update re-sending an existing source_url does not duplicate", () => {
      ctx.repo.saveItem(
        { id, type: "place", category: "attractions", lang: "th", title: "ทดสอบ 3", source_type: "google_maps", source_url: URL_A },
        "tester@local"
      );
      assert.equal(readSources(ctx.db, id).length, 2);
    });
  } finally {
    ctx.cleanup();
  }
});
