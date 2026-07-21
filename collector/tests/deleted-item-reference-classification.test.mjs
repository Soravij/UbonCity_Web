import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "RefClass!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-ref-class-"));
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

  // getDeletedItemReferenceGroups only looks at already soft-deleted items.
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
    repo.deleteItem(id, "test@local");
    return id;
  }

  function groupsOf(id) {
    const result = repo.getDeletedItemReferenceGroups(id);
    const map = new Map();
    for (const group of result?.groups || []) map.set(group.key, group);
    return { result, map };
  }

  function createUser(email) {
    const info = db
      .prepare("INSERT INTO users (email, display_name, role) VALUES (?,?,?)")
      .run(email, email, "editor");
    return Number(info.lastInsertRowid);
  }

  return { db, repo, cleanup, createDeletedItem, groupsOf, createUser };
}

function addDraft(db, itemId, { confirmedBy = null, confirmedAt = null, status = "confirmed" } = {}) {
  db.prepare(
    `INSERT INTO content_drafts
       (content_item_id, generation_run_uid, draft_title, body, confirmed_by_user_id, confirmed_at, confirmed_meta_status)
     VALUES (?,?,?,?,?,?,?)`
  ).run(itemId, `run-${itemId}`, "Draft title", "Draft body", confirmedBy, confirmedAt, status);
}

function addPublishedArticle(db, itemId) {
  const info = db
    .prepare("INSERT INTO published_articles (content_item_id, slug, title, body) VALUES (?,?,?,?)")
    .run(itemId, `slug-${itemId}`, "Published title", "Published body");
  return Number(info.lastInsertRowid);
}

function addTranslation(db, itemId, publishedArticleId, lang = "en") {
  db.prepare(
    `INSERT INTO content_translations
       (source_content_item_id, source_published_article_id, source_fingerprint, lang)
     VALUES (?,?,?,?)`
  ).run(itemId, publishedArticleId, `fp-${itemId}-${lang}`, lang);
}

function lastCleanupAudit(db, itemId) {
  const row = db
    .prepare(
      "SELECT details_json FROM audit_logs WHERE action='item.reference.cleanup' AND target_id=? ORDER BY id DESC LIMIT 1"
    )
    .get(String(itemId));
  return row?.details_json ? JSON.parse(row.details_json) : null;
}

test("drafts are classified confirm_required and carry who/when/how-many detail", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Confirmed Draft");
    const userId = ctx.createUser("curator@local");
    addDraft(ctx.db, id, { confirmedBy: userId, confirmedAt: "2026-07-01T10:00:00Z", status: "confirmed" });

    const { map } = ctx.groupsOf(id);
    const drafts = map.get("drafts");
    assert.ok(drafts, "drafts group present");
    assert.equal(drafts.category, "confirm_required");
    assert.equal(drafts.count, 1);
    assert.equal(drafts.confirm_details.length, 1, "detail per record");
    assert.equal(drafts.confirm_details[0].actor_user_id, userId, "who");
    assert.equal(drafts.confirm_details[0].acted_at, "2026-07-01T10:00:00Z", "when");
    assert.equal(drafts.confirm_details[0].status, "confirmed");
  } finally {
    ctx.cleanup();
  }
});

test("published_articles stays hard_blocker and translations split per row", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Published Item With Translations");
    const articleId = addPublishedArticle(ctx.db, id);
    addTranslation(ctx.db, id, articleId, "en");
    addTranslation(ctx.db, id, null, "zh");

    const { map } = ctx.groupsOf(id);
    assert.equal(map.get("published_articles")?.category, "hard_blocker");

    const published = map.get("translations_published");
    assert.ok(published, "published-bound translation group present");
    assert.equal(published.category, "hard_blocker");
    assert.equal(published.count, 1, "only the en row is published-bound");

    const unpublished = map.get("translations_unpublished");
    assert.ok(unpublished, "unpublished translation group present");
    assert.equal(unpublished.category, "confirm_required");
    assert.equal(unpublished.count, 1, "only the zh row is unbound");
    assert.equal(unpublished.confirm_details[0].lang, "zh");

    assert.equal(map.has("translations"), false, "old whole-table key is gone");
  } finally {
    ctx.cleanup();
  }
});

test("SAFE sweep excludes evidence_blocks only when deleting it would cascade approved context", () => {
  const ctx = createTestContext();
  try {
    const protectedId = ctx.createDeletedItem("Evidence With Approved Context");
    const evidenceId = Number(ctx.db.prepare("INSERT INTO evidence_blocks (content_item_id, block_type, text_value, status) VALUES (?,?,?,?)").run(protectedId, "fact", "evidence", "active").lastInsertRowid || 0);
    ctx.db.prepare("INSERT INTO approved_context_blocks (content_item_id, evidence_block_id, selected_text, status, approved_by) VALUES (?,?,?,?,?)").run(protectedId, evidenceId, "approved", "active", "owner@local");
    assert.equal(ctx.groupsOf(protectedId).map.has("evidence_blocks"), false, "SAFE list must not cascade-delete approved context");
    assert.deepEqual(ctx.repo.getCascadeKilledConfirmKeys(protectedId), new Set(["evidence_blocks"]));
    assert.equal(ctx.repo.getDeletedItemReferenceGroups(protectedId).safe_sweep_skipped[0]?.confirm_key, "approved_context_blocks");
    const unprotectedId = ctx.createDeletedItem("Evidence Without Approved Context");
    ctx.db.prepare("INSERT INTO evidence_blocks (content_item_id, block_type, text_value, status) VALUES (?,?,?,?)").run(unprotectedId, "fact", "evidence", "active");
    assert.equal(ctx.groupsOf(unprotectedId).map.get("evidence_blocks")?.category, "cleanup_candidate", "no approved context stays SAFE");
  } finally { ctx.cleanup(); }
});

test("cleanup of a confirm_required group is rejected without confirmed_overrides", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Draft");
    addDraft(ctx.db, id);

    assert.throws(
      () =>
        ctx.repo.cleanupDeletedItemReferenceGroups({
          itemId: id,
          groups: ["drafts"],
          actorEmail: "owner@local",
          reason: "test",
        }),
      /group requires confirmation/
    );

    const remaining = Number(
      ctx.db.prepare("SELECT COUNT(*) AS c FROM content_drafts WHERE content_item_id=?").get(id)?.c || 0
    );
    assert.equal(remaining, 1, "draft untouched when confirmation missing");
  } finally {
    ctx.cleanup();
  }
});

test("cleanup of a confirm_required group succeeds with confirmed_overrides and logs the override", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Draft");
    addDraft(ctx.db, id);

    ctx.repo.cleanupDeletedItemReferenceGroups({
      itemId: id,
      groups: ["drafts"],
      actorEmail: "owner@local",
      reason: "test",
      confirmedOverrides: ["drafts"],
    });

    const remaining = Number(
      ctx.db.prepare("SELECT COUNT(*) AS c FROM content_drafts WHERE content_item_id=?").get(id)?.c || 0
    );
    assert.equal(remaining, 0, "draft removed");

    const audit = lastCleanupAudit(ctx.db, id);
    assert.deepEqual(audit?.confirmed_overrides, ["drafts"], "override recorded in audit log");
    assert.equal(audit?.counts?.drafts, 1);
  } finally {
    ctx.cleanup();
  }
});

test("the assignment family is confirm_required and its detail names whose work would be destroyed", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Open Assignment");
    const userId = ctx.createUser("fieldworker@local");
    ctx.db
      .prepare(
        "INSERT INTO content_assignments (assignment_uid, content_item_id, assignee_user_id, assignee_name, state) VALUES (?,?,?,?,?)"
      )
      .run(`asg-${id}`, id, userId, "Field Worker", "in_progress");
    const assignmentId = Number(
      ctx.db.prepare("SELECT id FROM content_assignments WHERE content_item_id=? LIMIT 1").get(id)?.id || 0
    );
    const submissionId = Number(
      ctx.db
        .prepare(
          "INSERT INTO content_assignment_submissions (assignment_id, content_item_id, submitted_by_user_id, submission_state) VALUES (?,?,?,?)"
        )
        .run(assignmentId, id, userId, "submitted").lastInsertRowid
    );
    ctx.db
      .prepare(
        `INSERT INTO content_assignment_submission_deliverables
           (assignment_id, submission_id, content_item_id, deliverable_type, status, created_by)
         VALUES (?,?,?,?,?,?)`
      )
      .run(assignmentId, submissionId, id, "article", "draft", "fieldworker@local");
    ctx.db
      .prepare(
        `INSERT INTO content_assignment_handoff_snapshots
           (assignment_id, content_item_id, handoff_package_json, guard_status, created_by)
         VALUES (?,?,?,?,?)`
      )
      .run(assignmentId, id, "{}", "ready", "owner@local");

    const { map } = ctx.groupsOf(id);
    for (const key of [
      "assignments",
      "content_assignment_submissions",
      "content_assignment_submission_deliverables",
      "content_assignment_handoff_snapshots",
    ]) {
      const group = map.get(key);
      assert.ok(group, `${key} group present`);
      assert.equal(group.category, "confirm_required", `${key} must be overridable, not a dead end`);
      assert.ok(String(group.confirm_reason_th || "").trim(), `${key} states why confirmation is required`);
      assert.equal(group.confirm_details.length, 1, `${key} carries detail per record`);
    }

    // The point of the detail is answering "whose work am I throwing away", not just "how many rows".
    assert.equal(map.get("assignments").confirm_details[0].actor, "Field Worker");
    assert.equal(map.get("assignments").confirm_details[0].actor_user_id, userId);
    assert.equal(map.get("assignments").confirm_details[0].status, "in_progress");
    assert.equal(map.get("content_assignment_submissions").confirm_details[0].actor, "fieldworker@local");
    assert.equal(map.get("content_assignment_submissions").confirm_details[0].status, "submitted");
    assert.equal(map.get("content_assignment_submission_deliverables").confirm_details[0].actor, "fieldworker@local");
  } finally {
    ctx.cleanup();
  }
});

test("a confirmed assignment override actually clears the group", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Item With Assignment To Clear");
    ctx.db
      .prepare("INSERT INTO content_assignments (assignment_uid, content_item_id) VALUES (?,?)")
      .run(`asg-clear-${id}`, id);

    assert.throws(
      () =>
        ctx.repo.cleanupDeletedItemReferenceGroups({
          itemId: id,
          groups: ["assignments"],
          actorEmail: "owner@local",
          reason: "test",
        }),
      /group requires confirmation/,
      "an assignment must not be cleanable without an explicit confirmation"
    );

    ctx.repo.cleanupDeletedItemReferenceGroups({
      itemId: id,
      groups: ["assignments"],
      actorEmail: "owner@local",
      reason: "test",
      confirmedOverrides: ["assignments"],
    });

    assert.equal(
      Number(ctx.db.prepare("SELECT COUNT(*) AS c FROM content_assignments WHERE content_item_id=?").get(id)?.c || 0),
      0,
      "assignment removed once confirmed"
    );
    assert.deepEqual(lastCleanupAudit(ctx.db, id)?.confirmed_overrides, ["assignments"]);
  } finally {
    ctx.cleanup();
  }
});

test("a hard_blocker group can never be cleaned even when named in confirmed_overrides", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createDeletedItem("Published Item");
    addPublishedArticle(ctx.db, id);

    assert.throws(
      () =>
        ctx.repo.cleanupDeletedItemReferenceGroups({
          itemId: id,
          groups: ["published_articles"],
          actorEmail: "owner@local",
          reason: "test",
          confirmedOverrides: ["published_articles"],
        }),
      /group not eligible for cleanup/
    );

    const remaining = Number(
      ctx.db.prepare("SELECT COUNT(*) AS c FROM published_articles WHERE content_item_id=?").get(id)?.c || 0
    );
    assert.equal(remaining, 1, "published article untouched");
  } finally {
    ctx.cleanup();
  }
});
