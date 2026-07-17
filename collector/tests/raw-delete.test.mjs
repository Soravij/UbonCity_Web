import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { planBulkItemDelete, getNeverOverrideBlockersForItem } from "../services/raw-delete.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "RawDelete!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-raw-delete-"));
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

  function createRawItem(title) {
    const result = repo.createItemWithWorkflowHead({
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
    return result.item;
  }

  function makeItemRawOnly(item) {
    const itemId = Number(item?.id || 0) || 0;
    if (!itemId) throw new Error("invalid item id");
    const workflowModel = repo.getWorkflowModelByItem(itemId);
    if (!workflowModel) throw new Error("workflow model missing");
    // Ensure item is in raw-only eligible state (collected/draft)
    repo.upsertWorkflowModel(itemId, {
      production_state: "collected",
      publication_state: "draft",
    }, "system@local", { actor_role: "system", reason_code: "test" });
    return repo.getItem(itemId);
  }

  return { db, repo, cleanup, createRawItem, makeItemRawOnly };
}

// ============================================================
// Unit tests for planBulkItemDelete (no DB needed)
// ============================================================

test("planBulkItemDelete skips NEVER-blocked items and still plans the rest (partial success)", () => {
  const result = planBulkItemDelete(
    [
      { id: 11, title: "Safe Raw Item" },
      { id: 22, title: "Published Item" },
      { id: 33, title: "Safe Non-Raw Item" },
    ],
    {
      getRawOnlyHardDeleteEligibility(itemId) {
        return { eligible: Number(itemId) === 11 };
      },
      getNeverOverrideBlockersForItem(itemId) {
        if (Number(itemId) === 22) {
          return [{ key: "published_articles", label: "เผยแพร่ขึ้นเว็บแล้ว", count: 1 }];
        }
        return [];
      },
    }
  );

  assert.equal(result.ok, false, "ok=false signals at least one blocked row");
  assert.deepEqual(result.actions, [
    { item_id: 11, mode: "hard" },
    { item_id: 33, mode: "soft" },
  ], "non-blocked items still planned");
  assert.equal(result.blocked_rows.length, 1);
  assert.equal(result.blocked_rows[0].item_id, 22);
});

// The bulk-delete endpoint reports 400 when plan.actions is empty while blocked_rows is not,
// so that "every selected item is blocked" cannot be reported as a success that deleted 0 items.
test("planBulkItemDelete leaves actions empty when every selected item is NEVER-blocked", () => {
  const result = planBulkItemDelete(
    [
      { id: 22, title: "Published Item" },
      { id: 55, title: "Reviewed Item" },
    ],
    {
      getRawOnlyHardDeleteEligibility() {
        return { eligible: false };
      },
      getNeverOverrideBlockersForItem() {
        return [{ key: "published_articles", label: "เผยแพร่ขึ้นเว็บแล้ว", count: 1 }];
      },
    }
  );

  assert.deepEqual(result.actions, [], "nothing is planned");
  assert.equal(result.blocked_rows.length, 2);
});

test("planBulkItemDelete plans hard delete for safe raw-only items and soft delete for non-blocked items", () => {
  const result = planBulkItemDelete(
    [
      { id: 11, title: "Safe Raw Item" },
      { id: 33, title: "Safe Non-Raw Item" },
    ],
    {
      getRawOnlyHardDeleteEligibility(itemId) {
        return { eligible: Number(itemId) === 11 };
      },
      getNeverOverrideBlockersForItem() {
        return [];
      },
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.blocked_rows, []);
  assert.deepEqual(result.actions, [
    { item_id: 11, mode: "hard" },
    { item_id: 33, mode: "soft" },
  ]);
});

test("planBulkItemDelete soft-deletes an item whose only dependencies are non-NEVER (deliverables)", () => {
  const result = planBulkItemDelete(
    [
      { id: 44, title: "Raw Item With Deliverables" },
    ],
    {
      getRawOnlyHardDeleteEligibility(itemId) {
        if (Number(itemId) === 44) {
          return {
            eligible: false,
            item: { id: 44, title: "Raw Item With Deliverables", workflow_status: "raw" },
            blockers: [{ key: "content_assignment_submission_deliverables", count: 3 }],
          };
        }
        return { eligible: true };
      },
      // Deliverables are not a NEVER blocker: hard delete stays barred, soft delete is allowed.
      getNeverOverrideBlockersForItem() {
        return [];
      },
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.blocked_rows, []);
  assert.deepEqual(result.actions, [{ item_id: 44, mode: "soft" }]);
});

// ============================================================
// DB-level tests (transaction atomicity)
// ============================================================

test("bulkDeleteItems succeeds when all selected items are safe raw-only", () => {
  const ctx = createTestContext();
  try {
    const item1 = ctx.makeItemRawOnly(ctx.createRawItem("Safe Raw Item A"));
    const item2 = ctx.makeItemRawOnly(ctx.createRawItem("Safe Raw Item B"));
    const id1 = Number(item1?.id || 0) || 0;
    const id2 = Number(item2?.id || 0) || 0;
    assert.ok(id1 > 0, "item1 created");
    assert.ok(id2 > 0, "item2 created");

    const eligibility1 = ctx.repo.getRawOnlyHardDeleteEligibility(id1);
    const eligibility2 = ctx.repo.getRawOnlyHardDeleteEligibility(id2);
    assert.equal(eligibility1.eligible, true, "item1 eligible");
    assert.equal(eligibility2.eligible, true, "item2 eligible");

    const result = ctx.repo.bulkDeleteItems([id1, id2], [], "test@local");
    assert.deepEqual(result.deleted_ids.sort(), [id1, id2].sort());
    assert.equal(ctx.repo.getItem(id1), null, "item1 deleted");
    assert.equal(ctx.repo.getItem(id2), null, "item2 deleted");
  } finally {
    ctx.cleanup();
  }
});

test("bulkDeleteItems is all-or-nothing when one item is not eligible (rollback)", () => {
  const ctx = createTestContext();
  try {
    const safeItem = ctx.makeItemRawOnly(ctx.createRawItem("Safe Raw Item"));
    const progressedItem = ctx.createRawItem("Progressed Item");
    const safeId = Number(safeItem?.id || 0) || 0;
    const progressedId = Number(progressedItem?.id || 0) || 0;
    assert.ok(safeId > 0, "safe item created");
    assert.ok(progressedId > 0, "progressed item created");

    // Move progressed item to a non-raw-only state so it won't be eligible
    ctx.repo.upsertWorkflowModel(progressedId, {
      production_state: "content_in_progress",
      publication_state: "draft",
    }, "system@local", { actor_role: "system", reason_code: "test" });

    const eligibility = ctx.repo.getRawOnlyHardDeleteEligibility(progressedId);
    assert.equal(eligibility.eligible, false, "progressed item NOT eligible");

    // Try bulk delete both — should throw because progressed item fails eligibility
    assert.throws(() => {
      ctx.repo.bulkDeleteItems([safeId, progressedId], [], "test@local");
    }, /not eligible for raw-only hard delete/);

    // Both items must still exist (rollback)
    assert.ok(ctx.repo.getItem(safeId) !== null, "safe item still exists (rolled back)");
    assert.ok(ctx.repo.getItem(progressedId) !== null, "progressed item still exists (rolled back)");
  } finally {
    ctx.cleanup();
  }
});

test("bulkDeleteItems rollback on simulated runtime failure", () => {
  const ctx = createTestContext();
  try {
    const item1 = ctx.makeItemRawOnly(ctx.createRawItem("Item Alpha"));
    const item2 = ctx.makeItemRawOnly(ctx.createRawItem("Item Beta"));
    const id1 = Number(item1?.id || 0) || 0;
    const id2 = Number(item2?.id || 0) || 0;
    assert.ok(id1 > 0, "item1 created");
    assert.ok(id2 > 0, "item2 created");

    const eligibility1 = ctx.repo.getRawOnlyHardDeleteEligibility(id1);
    const eligibility2 = ctx.repo.getRawOnlyHardDeleteEligibility(id2);
    assert.equal(eligibility1.eligible, true, "item1 eligible");
    assert.equal(eligibility2.eligible, true, "item2 eligible");

    // Simulate runtime failure: delete item1 then force an error before item2
    // We'll use softDelete for item2 but that needs different eligibility path.
    // Instead, test that mixing a hard-eligible with a hard-non-eligible rolls back.
    // Move item2 to non-eligible state
    ctx.repo.upsertWorkflowModel(id2, {
      production_state: "content_in_progress",
      publication_state: "approved",
    }, "system@local", { actor_role: "system", reason_code: "test" });

    const eligibility2After = ctx.repo.getRawOnlyHardDeleteEligibility(id2);
    assert.equal(eligibility2After.eligible, false, "item2 now NOT eligible");

    // Try bulk delete both as hard — item2 should fail inside the transaction
    assert.throws(() => {
      ctx.repo.bulkDeleteItems([id1, id2], [], "test@local");
    }, /not eligible for raw-only hard delete/);

    // Both items must still exist (rollback)
    assert.ok(ctx.repo.getItem(id1) !== null, "item1 still exists after rollback");
    assert.ok(ctx.repo.getItem(id2) !== null, "item2 still exists after rollback");
  } finally {
    ctx.cleanup();
  }
});

test("single safe raw-only hard delete still works", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.makeItemRawOnly(ctx.createRawItem("Lone Raw Item"));
    const id = Number(item?.id || 0) || 0;
    assert.ok(id > 0, "item created");

    const eligibility = ctx.repo.getRawOnlyHardDeleteEligibility(id);
    assert.equal(eligibility.eligible, true, "item eligible");

    const result = ctx.repo.hardDeleteRawOnlyItem(id, "test@local");
    assert.equal(result.ok, true, "single hard delete ok");
    assert.equal(result.item_id, id, "correct item_id returned");
    assert.equal(ctx.repo.getItem(id), null, "item deleted");
  } finally {
    ctx.cleanup();
  }
});

test("single safe raw-only hard delete throws for ineligible item", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createRawItem("Progressed Lone");
    const id = Number(item?.id || 0) || 0;
    assert.ok(id > 0, "item created");
    // Move to non-eligible state
    ctx.repo.upsertWorkflowModel(id, {
      production_state: "content_in_progress",
      publication_state: "draft",
    }, "system@local", { actor_role: "system", reason_code: "test" });

    const eligibility = ctx.repo.getRawOnlyHardDeleteEligibility(id);
    assert.equal(eligibility.eligible, false, "item NOT eligible");

    assert.throws(() => {
      ctx.repo.hardDeleteRawOnlyItem(id, "test@local");
    }, /not eligible for raw-only hard delete/);

    assert.ok(ctx.repo.getItem(id) !== null, "item still exists");
  } finally {
    ctx.cleanup();
  }
});

test("bulkDeleteItems handles mixed hard and soft deletes in one transaction", () => {
  const ctx = createTestContext();
  try {
    const hardItem = ctx.makeItemRawOnly(ctx.createRawItem("Hard Raw Item"));
    const hardId = Number(hardItem?.id || 0) || 0;
    assert.ok(hardId > 0, "hard item created");

    // Create a non-raw item that should be soft-deleted
    const softItem = ctx.createRawItem("Soft Raw Item");
    const softId = Number(softItem?.id || 0) || 0;
    assert.ok(softId > 0, "soft item created");
    // Move it to a progressed state so it's not raw-only eligible
    ctx.repo.upsertWorkflowModel(softId, {
      production_state: "content_in_progress",
      publication_state: "draft",
    }, "system@local", { actor_role: "system", reason_code: "test" });

    const hardEligibility = ctx.repo.getRawOnlyHardDeleteEligibility(hardId);
    const softEligibility = ctx.repo.getRawOnlyHardDeleteEligibility(softId);
    assert.equal(hardEligibility.eligible, true, "hard item eligible");
    assert.equal(softEligibility.eligible, false, "soft item NOT eligible for hard delete");

    // Soft-delete item via repo.deleteItem is ok; bulkDeleteItems with softItemId
    const result = ctx.repo.bulkDeleteItems([hardId], [softId], "test@local");
    assert.deepEqual(result.deleted_ids.sort(), [hardId, softId].sort());

    // Hard item is gone
    assert.equal(ctx.repo.getItem(hardId), null, "hard item deleted");
    // Soft item should be soft-deleted (is_deleted=1)
    const softAfter = ctx.db.prepare("SELECT * FROM content_items WHERE id=?").get(softId);
    assert.ok(softAfter !== undefined, "soft item row still exists");
    assert.equal(Number(softAfter?.is_deleted || 0), 1, "soft item is_deleted=1");
  } finally {
    ctx.cleanup();
  }
});

// ============================================================
// NEVER-override blocker gate for soft delete
// ============================================================

function addDraft(db, itemId) {
  db.prepare(
    "INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body) VALUES (?,?,?,?)"
  ).run(itemId, `run-${itemId}`, "Draft title", "Draft body");
}

function addAssignment(db, itemId) {
  db.prepare("INSERT INTO content_assignments (assignment_uid, content_item_id) VALUES (?,?)").run(
    `asg-${itemId}`,
    itemId
  );
}

function addPublishedArticle(db, itemId) {
  const info = db
    .prepare("INSERT INTO published_articles (content_item_id, slug, title, body) VALUES (?,?,?,?)")
    .run(itemId, `slug-${itemId}`, "Published title", "Published body");
  return Number(info.lastInsertRowid);
}

function addTranslation(db, itemId, publishedArticleId) {
  db.prepare(
    "INSERT INTO content_translations (source_content_item_id, source_published_article_id, source_fingerprint, lang) VALUES (?,?,?,?)"
  ).run(itemId, publishedArticleId, `fp-${itemId}`, "en");
}

test("(a) soft delete passes when item only has drafts and assignments", () => {
  const ctx = createTestContext();
  try {
    const id = Number(ctx.createRawItem("Item With Drafts")?.id || 0);
    addDraft(ctx.db, id);
    addAssignment(ctx.db, id);

    // The full merge gate would block this item; the NEVER gate must not.
    assert.deepEqual(getNeverOverrideBlockersForItem(ctx.db, id), [], "no NEVER blockers");

    ctx.repo.deleteItem(id, "test@local", { delete_mode: "soft" });
    const after = ctx.db.prepare("SELECT is_deleted FROM content_items WHERE id=?").get(id);
    assert.equal(Number(after?.is_deleted || 0), 1, "item soft-deleted");
  } finally {
    ctx.cleanup();
  }
});

test("(b) soft delete is blocked when item has a published article", () => {
  const ctx = createTestContext();
  try {
    const id = Number(ctx.createRawItem("Published Item")?.id || 0);
    addPublishedArticle(ctx.db, id);

    const blockers = getNeverOverrideBlockersForItem(ctx.db, id);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].key, "published_articles");
    assert.equal(blockers[0].count, 1);
    assert.match(blockers[0].remediation, /unpublish/i, "remediation tells the user what to do first");
  } finally {
    ctx.cleanup();
  }
});

test("(b2) soft delete is blocked when item has review actions", () => {
  const ctx = createTestContext();
  try {
    const id = Number(ctx.createRawItem("Reviewed Item")?.id || 0);
    ctx.db.prepare("INSERT INTO review_actions (content_item_id, action) VALUES (?,?)").run(id, "approve");

    const blockers = getNeverOverrideBlockersForItem(ctx.db, id);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].key, "review_actions");
  } finally {
    ctx.cleanup();
  }
});

test("(c) translations block soft delete only when bound to a published article", () => {
  const ctx = createTestContext();
  try {
    const boundId = Number(ctx.createRawItem("Translated Published Item")?.id || 0);
    const articleId = addPublishedArticle(ctx.db, boundId);
    addTranslation(ctx.db, boundId, articleId);

    const boundBlockers = getNeverOverrideBlockersForItem(ctx.db, boundId);
    assert.ok(
      boundBlockers.some((entry) => entry.key === "translations_published"),
      "translation bound to a published article blocks"
    );

    const unboundId = Number(ctx.createRawItem("Translated Unpublished Item")?.id || 0);
    addTranslation(ctx.db, unboundId, null);

    assert.deepEqual(
      getNeverOverrideBlockersForItem(ctx.db, unboundId),
      [],
      "translation with NULL source_published_article_id does not block"
    );
  } finally {
    ctx.cleanup();
  }
});

test("(d) bulk delete mixing blocked and deletable items reports partial success", () => {
  const ctx = createTestContext();
  try {
    const okId = Number(ctx.createRawItem("Deletable Item")?.id || 0);
    addDraft(ctx.db, okId);
    const blockedId = Number(ctx.createRawItem("Published Item")?.id || 0);
    addPublishedArticle(ctx.db, blockedId);

    const rows = [ctx.repo.getItem(okId), ctx.repo.getItem(blockedId)];
    const plan = planBulkItemDelete(rows, {
      getRawOnlyHardDeleteEligibility: (itemId) => ctx.repo.getRawOnlyHardDeleteEligibility(itemId),
      getNeverOverrideBlockersForItem: (itemId) => getNeverOverrideBlockersForItem(ctx.db, itemId),
    });

    assert.deepEqual(plan.actions, [{ item_id: okId, mode: "soft" }], "only the deletable item is planned");
    assert.equal(plan.blocked_rows.length, 1);
    assert.equal(plan.blocked_rows[0].item_id, blockedId);
    assert.equal(plan.blocked_rows[0].blockers[0].key, "published_articles");

    const result = ctx.repo.bulkDeleteItems([], [okId], "test@local", {
      softDeleteAuditDetailsById: { [okId]: { delete_mode: "soft", never_override_check: { passed: true, blockers: [] } } },
    });
    assert.deepEqual(result.deleted_ids, [okId]);

    assert.equal(
      Number(ctx.db.prepare("SELECT is_deleted FROM content_items WHERE id=?").get(okId)?.is_deleted || 0),
      1,
      "deletable item soft-deleted"
    );
    assert.equal(
      Number(ctx.db.prepare("SELECT is_deleted FROM content_items WHERE id=?").get(blockedId)?.is_deleted || 0),
      0,
      "blocked item untouched"
    );

    const audit = ctx.db
      .prepare("SELECT details_json FROM audit_logs WHERE action='item.delete' AND target_id=? ORDER BY id DESC LIMIT 1")
      .get(String(okId));
    assert.ok(audit?.details_json, "soft delete writes an audit row with details");
    assert.equal(JSON.parse(audit.details_json).never_override_check.passed, true);
  } finally {
    ctx.cleanup();
  }
});
// The eligibility backstop loops over the reference defs so a def for a new table cannot silently
// drop out of the gate. The four curated tables already have hardcoded checks, so pulling
// REFERENCE_CONFIRM_REQUIRED_DEFS into that loop must not change what is reported for them.
test("confirm_required tables keep their existing hard-delete eligibility blockers, without duplicates", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.makeItemRawOnly(ctx.createRawItem("Curated Tables Item"));
    const id = Number(item?.id || 0) || 0;
    assert.equal(ctx.repo.getRawOnlyHardDeleteEligibility(id).eligible, true, "clean item is eligible");

    ctx.db
      .prepare(
        `INSERT INTO content_drafts (content_item_id, generation_run_uid, draft_title, body)
         VALUES (?,?,?,?)`
      )
      .run(id, `run-${id}`, "Draft", "Body");
    ctx.db
      .prepare(
        `INSERT INTO field_packs (content_item_id, status, is_current, ai_summary, ai_highlights_json,
           ai_unknowns_json, verified_facts_json, uncertain_facts_json, social_shot_emphasis_json,
           social_on_camera_points_json, updated_by)
         VALUES (?,?,1,?, '[]','[]','[]','[]','[]','[]', ?)`
      )
      .run(id, "ready_for_field", "Summary", "test");
    ctx.db
      .prepare(
        `INSERT INTO content_translations (source_content_item_id, source_fingerprint, lang)
         VALUES (?,?,?)`
      )
      .run(id, `fp-${id}`, "en");

    const eligibility = ctx.repo.getRawOnlyHardDeleteEligibility(id);
    assert.equal(eligibility.eligible, false, "curated references still block hard delete");

    const keys = eligibility.blockers.map((entry) => entry.key);
    for (const key of ["content_drafts", "field_packs", "content_translations"]) {
      assert.equal(keys.filter((entry) => entry === key).length, 1, `${key} reported exactly once`);
    }
    // The def keys differ from the hardcoded check keys; the table-level guard keeps them out so the
    // same rows are not counted twice under two names.
    assert.equal(keys.includes("drafts"), false, "no duplicate blocker under the def key");
    assert.equal(keys.includes("translations_unpublished"), false, "no narrower duplicate for translations");
  } finally {
    ctx.cleanup();
  }
});
