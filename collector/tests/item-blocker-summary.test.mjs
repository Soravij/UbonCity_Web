import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { getNeverOverrideBlockersForItem } from "../services/raw-delete.mjs";

process.env.OWNER_PASSWORD = process.env.OWNER_PASSWORD || "BlockerSummary!Test1";

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-blocker-summary-"));
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

  // Live (not-deleted) item with a clean reference sheet. createItemWithWorkflowHead also writes a
  // workflow model, its transitions and a source record — all cleanup_candidates — so strip them the
  // same way the purge-gate test does, leaving each case to see only the group it is about.
  function createCleanLiveItem(title) {
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
    db.prepare("DELETE FROM content_workflow_models WHERE content_item_id=?").run(id);
    db.prepare("DELETE FROM content_workflow_transitions WHERE content_item_id=?").run(id);
    db.prepare("DELETE FROM source_records WHERE content_item_id=?").run(id);
    return id;
  }

  return { db, repo, cleanup, createCleanLiveItem };
}

function addSourceRecord(db, itemId) {
  db.prepare(
    "INSERT INTO source_records (content_item_id, source_type, source_name, source_url, payload_json) VALUES (?,?,?,?,?)"
  ).run(itemId, "test", "Test Source", `https://example.com/${itemId}/${Math.random()}`, "{}");
}

function addOpenAssignment(db, itemId) {
  db.prepare("INSERT INTO content_assignments (assignment_uid, content_item_id) VALUES (?,?)")
    .run(`assign-${itemId}-${Math.random()}`, itemId);
}

function addPublishedArticle(db, itemId) {
  const info = db.prepare("INSERT INTO published_articles (content_item_id, slug, title, body) VALUES (?,?,?,?)")
    .run(itemId, `slug-${itemId}`, "Published title", "Published body");
  return Number(info?.lastInsertRowid || 0) || 0;
}

function addFieldPack(db, itemId) {
  db.prepare("INSERT INTO field_packs (content_item_id) VALUES (?)").run(itemId);
}

function addTranslation(db, itemId, lang, publishedArticleId) {
  db.prepare(
    `INSERT INTO content_translations (source_content_item_id, source_fingerprint, lang, source_published_article_id)
     VALUES (?,?,?,?)`
  ).run(itemId, `fp-${itemId}-${lang}`, lang, publishedArticleId || null);
}

test("a clean live item reports zero blockers and is soft-deletable", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createCleanLiveItem("Clean Item");
    const counts = ctx.repo.getItemReferenceBlockerCounts([id]).get(id);
    assert.deepEqual(counts, { cleanup_candidate_count: 0, confirm_required: [], assignments_open: 0 });
    assert.deepEqual(getNeverOverrideBlockersForItem(ctx.db, id), []);
  } finally {
    ctx.cleanup();
  }
});

test("cleanup_candidate rows are summed into cleanup_candidate_count", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createCleanLiveItem("Item With Sources");
    addSourceRecord(ctx.db, id);
    addSourceRecord(ctx.db, id);
    const counts = ctx.repo.getItemReferenceBlockerCounts([id]).get(id);
    assert.equal(counts.cleanup_candidate_count, 2);
    assert.equal(counts.assignments_open, 0);
  } finally {
    ctx.cleanup();
  }
});

test("an open assignment surfaces in assignments_open but does not block soft-delete", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createCleanLiveItem("Assigned Item");
    addOpenAssignment(ctx.db, id);
    const counts = ctx.repo.getItemReferenceBlockerCounts([id]).get(id);
    assert.equal(counts.assignments_open, 1);
    assert.equal(counts.cleanup_candidate_count, 0);
    // assignments is a purge hard blocker but NOT a NEVER-override key: the item is still soft-deletable.
    assert.deepEqual(getNeverOverrideBlockersForItem(ctx.db, id), []);
  } finally {
    ctx.cleanup();
  }
});

test("a published item reports a NEVER blocker (matches the purge gate's published rule)", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createCleanLiveItem("Published Item");
    addPublishedArticle(ctx.db, id);
    const never = getNeverOverrideBlockersForItem(ctx.db, id);
    assert.ok(never.some((entry) => entry.key === "published_articles"), "published_articles is a NEVER blocker");
    // published_articles is not a cleanup_candidate, so the reference count stays untouched by it.
    assert.equal(ctx.repo.getItemReferenceBlockerCounts([id]).get(id).cleanup_candidate_count, 0);
  } finally {
    ctx.cleanup();
  }
});

test("batch call keys every requested id and defaults unknown/absent ids to zero", () => {
  const ctx = createTestContext();
  try {
    const withSource = ctx.createCleanLiveItem("Has Source");
    const withAssignment = ctx.createCleanLiveItem("Has Assignment");
    const clean = ctx.createCleanLiveItem("Untouched");
    addSourceRecord(ctx.db, withSource);
    addOpenAssignment(ctx.db, withAssignment);

    const missingId = clean + 100000; // never inserted
    const summary = ctx.repo.getItemReferenceBlockerCounts([withSource, withAssignment, clean, missingId]);

    assert.equal(summary.get(withSource).cleanup_candidate_count, 1);
    assert.equal(summary.get(withAssignment).assignments_open, 1);
    assert.deepEqual(summary.get(clean), { cleanup_candidate_count: 0, confirm_required: [], assignments_open: 0 });
    // An id with no matching rows still gets a zeroed bucket rather than being dropped.
    assert.deepEqual(summary.get(missingId), { cleanup_candidate_count: 0, confirm_required: [], assignments_open: 0 });
  } finally {
    ctx.cleanup();
  }
});

test("a field_pack surfaces in confirm_required and is NOT counted in cleanup_candidate_count", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createCleanLiveItem("Item With Field Pack");
    addFieldPack(ctx.db, id);
    const counts = ctx.repo.getItemReferenceBlockerCounts([id]).get(id);
    assert.deepEqual(counts.confirm_required, [{ key: "field_packs", count: 1 }]);
    // Curated groups are a distinct purge tier: they must never inflate the cleanup_candidate total.
    assert.equal(counts.cleanup_candidate_count, 0);
    // confirm_required is not a NEVER blocker, so the item stays soft-deletable.
    assert.deepEqual(getNeverOverrideBlockersForItem(ctx.db, id), []);
  } finally {
    ctx.cleanup();
  }
});

test("translations split correctly: published -> never, unpublished -> confirm_required (same item)", () => {
  const ctx = createTestContext();
  try {
    const id = ctx.createCleanLiveItem("Item With Both Translations");
    const publishedArticleId = addPublishedArticle(ctx.db, id);
    addTranslation(ctx.db, id, "en", publishedArticleId); // source_published_article_id IS NOT NULL -> NEVER
    addTranslation(ctx.db, id, "lo", null); // source_published_article_id IS NULL -> confirm_required

    const never = getNeverOverrideBlockersForItem(ctx.db, id).map((entry) => entry.key);
    assert.ok(never.includes("translations_published"), "published translation is a NEVER blocker");

    const counts = ctx.repo.getItemReferenceBlockerCounts([id]).get(id);
    assert.deepEqual(
      counts.confirm_required.find((entry) => entry.key === "translations_unpublished"),
      { key: "translations_unpublished", count: 1 },
      "unpublished translation is a confirm_required group",
    );
    // Neither translation row is a cleanup_candidate def, so the cleanup total stays untouched.
    assert.equal(counts.cleanup_candidate_count, 0);
  } finally {
    ctx.cleanup();
  }
});

// The /api/items/blocker-summary handler must apply the SAME per-item visibility gate as /api/items.
// A true end-to-end auth test belongs on the Runtime machine (it needs a live session); this guards
// against the security filter being silently dropped from the handler in a future edit.
test("blocker-summary handler wires the same visibility gate as the item list", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "collector", "server", "index.mjs"), "utf8");
  const start = src.indexOf('app.get("/api/items/blocker-summary"');
  assert.notEqual(start, -1, "blocker-summary route should exist");
  const handler = src.slice(start, src.indexOf('app.', start + 1));
  assert.ok(handler.includes("isItemVisibleToActor"), "handler must call isItemVisibleToActor");
  assert.ok(handler.includes("resolveItemScopeContext"), "handler must resolve item scope context");
  assert.ok(/visibleIds|\.filter\(/.test(handler), "handler must filter ids by visibility");
});
