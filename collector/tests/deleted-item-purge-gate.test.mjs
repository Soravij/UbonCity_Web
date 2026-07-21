import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { classifyPurgeGroups, planDeletedItemPurge } from "../services/raw-delete.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "PurgeGate!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-purge-gate-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve(process.cwd(), "collector", "database", "schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createDeletedItem(title) {
    const created = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      title,
      description_raw: title,
      description_clean: "",
      summary: "",
      meta_title: "",
      meta_description: "",
      image_url: "",
      tags: [],
      lang: "th",
    });
    const id = Number(created?.item?.id || 0) || 0;
    // createItemWithWorkflowHead also writes a workflow model, its transitions and a source record.
    // Each is a cleanup_candidate that would 409 every case below, so drop them and let each test see
    // only the group it is about. Real items reach purge the same way: through the reference-cleanup
    // endpoint, which clears these first.
    db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id);
    db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id=?").run(id);
    db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(id);
    repo.deleteItem(id, "test@local");
    return id;
  }

  // Same chain the purge endpoint runs: reference groups -> three tiers -> gate decision.
  function planPurge(itemId, confirmedOverrides = []) {
    const groups = repo.getDeletedItemReferenceGroups(itemId)?.groups || [];
    return planDeletedItemPurge(classifyPurgeGroups(groups), confirmedOverrides);
  }

  return { db, repo, cleanup, createDeletedItem, planPurge };
}

function addDraft(db, itemId) {
  db.prepare(
    `INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body, confirmed_meta_status)
     VALUES (?,?,?,?,?)`
  ).run(itemId, `run-${itemId}`, "Draft title", "Draft body", "confirmed");
}

function addPublishedArticle(db, itemId) {
  db.prepare("INSERT INTO published_articles (content_item_id, slug, title, body) VALUES (?,?,?,?)")
    .run(itemId, `slug-${itemId}`, "Published title", "Published body");
}

test("(a) purge is refused with 400 when a confirm_required group is not in confirmed_overrides", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Draft");
    addDraft(ctx.db, id);

    const plan = ctx.planPurge(id, []);
    assert.equal(plan.ok, false);
    assert.equal(plan.status, 400);
    assert.equal(plan.error, "purge requires confirmation for curated groups");
    assert.deepEqual(plan.missing_confirmations.map((entry) => entry.key), ["drafts"]);
    assert.equal(plan.missing_confirmations[0].category, "confirm_required");
    assert.equal(plan.blockers.length, 0, "a curated group is not reported as an outright blocker");
  } finally {
    ctx.cleanup();
  }
});

test("(b) purge passes when every confirm_required group is confirmed, and reports them for the log", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Draft");
    addDraft(ctx.db, id);

    const plan = ctx.planPurge(id, ["drafts"]);
    assert.equal(plan.ok, true);
    assert.equal(plan.status, 200);
    assert.equal(plan.missing_confirmations.length, 0);

    // purgeDeletedItemTx writes plan.confirmed_overrides straight into the item.purge audit log.
    assert.equal(plan.confirmed_overrides.length, 1, "the overridden group is recorded");
    const override = plan.confirmed_overrides[0];
    assert.equal(override.key, "drafts");
    assert.equal(override.count, 1);
    assert.ok(String(override.confirm_reason_th || "").length > 0, "log says why confirmation was needed");
    assert.equal(override.confirm_details.length, 1, "log carries the per-record detail");
  } finally {
    ctx.cleanup();
  }
});

test("(c) a published item is refused with 409 no matter what is passed as confirmed_overrides", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Published Item");
    addPublishedArticle(ctx.db, id);

    for (const overrides of [[], ["published_articles"], ["drafts", "published_articles"], ["*"]]) {
      const plan = ctx.planPurge(id, overrides);
      assert.equal(plan.ok, false, `overrides ${JSON.stringify(overrides)} must not unlock purge`);
      assert.equal(plan.status, 409);
      assert.equal(plan.error, "deleted item has purge blockers");
      assert.ok(
        plan.blockers.some((entry) => entry.key === "published_articles" && entry.category === "hard_blocker"),
        "published_articles is reported as a hard blocker"
      );
      assert.equal(plan.confirmed_overrides.length, 0, "nothing is recorded as overridden");
    }
  } finally {
    ctx.cleanup();
  }
});

test("a cleanup_candidate blocks purge with 409 and cannot be confirmed away either", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Source Record");
    ctx.db
      .prepare(
        "INSERT INTO source_records (content_item_id, source_type, source_name, source_url, payload_json) VALUES (?,?,?,?,?)"
      )
      .run(id, "test", "Test Source", `https://example.com/${id}`, "{}");

    const plan = ctx.planPurge(id, ["source_records"]);
    assert.equal(plan.status, 409, "must be cleaned through the reference-cleanup endpoint first");
    assert.ok(plan.blockers.some((entry) => entry.key === "source_records"));
  } finally {
    ctx.cleanup();
  }
});

test("purge passes with no confirmations needed when the item has no references left", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Clean Item");
    const plan = ctx.planPurge(id, []);
    assert.equal(plan.ok, true);
    assert.equal(plan.confirmed_overrides.length, 0);
  } finally {
    ctx.cleanup();
  }
});
