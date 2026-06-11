import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

function createDbContext(prefix = "collector-schema-foundation-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  return { db, cleanup };
}

function readColumnNames(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => String(row?.name || "").trim());
}

function createLegacyFieldPacksTable(db) {
  db.exec("DROP TABLE IF EXISTS field_packs;");
  db.exec(`
    CREATE TABLE field_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      source_draft_id INTEGER,
      source_review_report_id INTEGER,
      source_draft_input_snapshot_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      is_current INTEGER NOT NULL DEFAULT 1,
      ai_summary TEXT,
      ai_highlights_json TEXT NOT NULL DEFAULT '[]',
      ai_unknowns_json TEXT NOT NULL DEFAULT '[]',
      editor_summary TEXT,
      verified_facts_json TEXT NOT NULL DEFAULT '[]',
      uncertain_facts_json TEXT NOT NULL DEFAULT '[]',
      story_angle TEXT,
      field_notes TEXT,
      social_hook TEXT,
      social_shot_emphasis_json TEXT NOT NULL DEFAULT '[]',
      social_on_camera_points_json TEXT NOT NULL DEFAULT '[]',
      social_caption_angle TEXT,
      writer_ready INTEGER NOT NULL DEFAULT 0,
      writer_angle TEXT,
      writer_key_points_json TEXT NOT NULL DEFAULT '[]',
      writer_notes TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    );
  `);
}

function createLegacyAssignmentSubmissionsTable(db) {
  db.exec("DROP TABLE IF EXISTS content_assignment_submissions;");
  db.exec(`
    CREATE TABLE content_assignment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      content_item_id INTEGER NOT NULL,
      submitted_by_user_id INTEGER NOT NULL,
      submission_state TEXT NOT NULL DEFAULT 'submitted',
      article_payload_json TEXT,
      media_payload_json TEXT,
      contributor_note TEXT,
      reviewer_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT
    );
  `);
}

function createLegacyContentDraftsTable(db) {
  db.exec("DROP TABLE IF EXISTS content_drafts;");
  db.exec(`
    CREATE TABLE content_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      generation_run_uid TEXT NOT NULL,
      draft_title TEXT NOT NULL,
      excerpt TEXT,
      body TEXT NOT NULL,
      meta_title TEXT,
      meta_description TEXT,
      suggested_related_json TEXT,
      ai_quality_score INTEGER,
      status TEXT NOT NULL DEFAULT 'generated',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(content_item_id, generation_run_uid)
    );
  `);
}

test("repository migration adds schema foundation columns for field packs drafts and submissions", () => {
  const ctx = createDbContext("collector-schema-foundation-migrate-");
  try {
    createLegacyFieldPacksTable(ctx.db);
    createLegacyAssignmentSubmissionsTable(ctx.db);
    createLegacyContentDraftsTable(ctx.db);

    createRepository(ctx.db);

    assert.equal(readColumnNames(ctx.db, "field_packs").includes("ai_cta_contact_json"), true);
    assert.equal(readColumnNames(ctx.db, "field_packs").includes("curation_status"), true);
    assert.equal(readColumnNames(ctx.db, "content_assignment_submissions").includes("field_return_payload_json"), true);
    assert.equal(readColumnNames(ctx.db, "content_drafts").includes("confirmed_cta_contact_json"), true);
    assert.equal(readColumnNames(ctx.db, "content_drafts").includes("confirmed_meta_status"), true);
  } finally {
    ctx.cleanup();
  }
});

test("legacy field pack rows load with safe metadata defaults after migration", () => {
  const ctx = createDbContext("collector-schema-foundation-pack-defaults-");
  try {
    createLegacyFieldPacksTable(ctx.db);
    ctx.db.prepare(`
      INSERT INTO content_items (
        item_uid, type, category, lang, title, normalized_title, slug, description_raw, workflow_status
      ) VALUES ('legacy-pack-item', 'place', 'attractions', 'th', 'Legacy Pack', 'legacy pack', 'legacy-pack', 'raw', 'raw')
    `).run();
    const itemId = Number(ctx.db.prepare("SELECT id FROM content_items WHERE item_uid='legacy-pack-item'").get()?.id || 0);
    const insertResult = ctx.db.prepare(`
      INSERT INTO field_packs (
        content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json,
        writer_ready, writer_key_points_json
      ) VALUES (?, 'draft', 1, 'legacy pack', '[]', '[]', '[]', '[]', '[]', '[]', 0, '[]')
    `).run(itemId);

    const repo = createRepository(ctx.db);
    const pack = repo.getFieldPackBundleById(Number(insertResult.lastInsertRowid || 0));

    assert.deepEqual(pack.ai_cta_contact_json, {
      phone: null,
      line_url: null,
      facebook_url: null,
      website_url: null,
      primary_cta: null,
      source: [],
      confidence: "unknown",
      note: null,
    });
    assert.equal(pack.curation_status, "not_started");
  } finally {
    ctx.cleanup();
  }
});

test("legacy draft and submission rows load with safe metadata defaults after migration", () => {
  const ctx = createDbContext("collector-schema-foundation-draft-submission-defaults-");
  try {
    createLegacyAssignmentSubmissionsTable(ctx.db);
    createLegacyContentDraftsTable(ctx.db);
    ctx.db.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('legacy-user@local', 'Legacy User', 'hash', 'user')").run();
    const userId = Number(ctx.db.prepare("SELECT id FROM users WHERE email='legacy-user@local'").get()?.id || 0);
    ctx.db.prepare(`
      INSERT INTO content_items (
        item_uid, type, category, lang, title, normalized_title, slug, description_raw, workflow_status
      ) VALUES ('legacy-draft-item', 'place', 'attractions', 'th', 'Legacy Draft', 'legacy draft', 'legacy-draft', 'raw', 'raw')
    `).run();
    const itemId = Number(ctx.db.prepare("SELECT id FROM content_items WHERE item_uid='legacy-draft-item'").get()?.id || 0);
    ctx.db.prepare(`
      INSERT INTO content_assignments (
        assignment_uid, content_item_id, assignment_kind, assignee_user_id, assigned_by_user_id, state
      ) VALUES ('legacy-assignment', ?, 'field', ?, ?, 'assigned')
    `).run(itemId, userId, userId);
    const assignmentId = Number(ctx.db.prepare("SELECT id FROM content_assignments WHERE assignment_uid='legacy-assignment'").get()?.id || 0);
    const draftResult = ctx.db.prepare(`
      INSERT INTO content_drafts (
        content_item_id, generation_run_uid, draft_title, excerpt, body, status
      ) VALUES (?, 'legacy-run', 'Legacy Draft', 'excerpt', 'body', 'generated')
    `).run(itemId);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state, article_payload_json
      ) VALUES (?, ?, ?, 'submitted', '{"summary":"legacy"}')
    `).run(assignmentId, itemId, userId);

    const repo = createRepository(ctx.db);
    const draft = repo.latestDraftByItem(itemId);
    const submission = repo.getAssignmentSubmissionById(Number(submissionResult.lastInsertRowid || 0));

    assert.deepEqual(draft.confirmed_cta_contact_json, {
      phone: null,
      line_url: null,
      facebook_url: null,
      website_url: null,
      primary_cta: null,
    });
    assert.equal(draft.confirmed_meta_status, "not_started");
    assert.equal(draft.id, Number(draftResult.lastInsertRowid || 0));
    assert.deepEqual(submission.field_return_payload_json, {
      checklist_results: [],
      cta_return: {},
      taxonomy_return: {},
      note: null,
    });
  } finally {
    ctx.cleanup();
  }
});

test("field return cta_return normalizes to canonical shape and recomputes found", () => {
  const ctx = createDbContext("collector-schema-foundation-cta-return-");
  try {
    const repo = createRepository(ctx.db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "CTA Return Item",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/cta-return",
    }).item;
    ctx.db.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('cta-user@local', 'CTA User', 'hash', 'user')").run();
    const userId = Number(ctx.db.prepare("SELECT id FROM users WHERE email='cta-user@local'").get()?.id || 0);
    ctx.db.prepare(`
      INSERT INTO content_assignments (
        assignment_uid, content_item_id, assignment_kind, assignee_user_id, assigned_by_user_id, state
      ) VALUES ('cta-return-assignment', ?, 'field', ?, ?, 'assigned')
    `).run(item.id, userId, userId);
    const assignmentId = Number(ctx.db.prepare("SELECT id FROM content_assignments WHERE assignment_uid='cta-return-assignment'").get()?.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state, field_return_payload_json
      ) VALUES (?, ?, ?, 'submitted', ?)
    `).run(
      assignmentId,
      item.id,
      userId,
      JSON.stringify({
        checklist_results: [],
        cta_return: {
          phone: { checked: true, found: true, value: " 0812345678 ", note: "ok" },
          line_url: { checked: false, found: true, value: "https://line.me/ti/p/hidden", note: "should clear" },
          facebook_url: { checked: true, found: true, value: "not-a-url", note: "bad url" },
          website_url: { checked: true, found: false, value: "", evidence_source_url: "https://example.com/proof/site" },
          primary_cta: { checked: true, found: true, value: "invalid-cta", evidence_deliverable_id: "12" },
          ignored_key: { checked: true, value: "x" },
        },
        taxonomy_return: {},
        note: "cta note",
        unknown_top_level: true,
      })
    );

    const submission = repo.getAssignmentSubmissionById(Number(submissionResult.lastInsertRowid || 0));
    assert.deepEqual(submission.field_return_payload_json.cta_return, {
      phone: {
        checked: true,
        found: true,
        value: "0812345678",
        note: "ok",
        evidence_deliverable_id: null,
        evidence_source_url: null,
      },
      line_url: {
        checked: false,
        found: false,
        value: null,
        note: "should clear",
        evidence_deliverable_id: null,
        evidence_source_url: null,
      },
      facebook_url: {
        checked: true,
        found: false,
        value: null,
        note: "bad url",
        evidence_deliverable_id: null,
        evidence_source_url: null,
      },
      website_url: {
        checked: true,
        found: true,
        value: null,
        note: null,
        evidence_deliverable_id: null,
        evidence_source_url: "https://example.com/proof/site",
      },
      primary_cta: {
        checked: true,
        found: true,
        value: null,
        note: null,
        evidence_deliverable_id: 12,
        evidence_source_url: null,
      },
    });
  } finally {
    ctx.cleanup();
  }
});

test("field return taxonomy_return normalizes tags and evidence-driven found", () => {
  const ctx = createDbContext("collector-schema-foundation-taxonomy-return-");
  try {
    const repo = createRepository(ctx.db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "Taxonomy Return Item",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/taxonomy-return",
    }).item;
    ctx.db.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('taxonomy-user@local', 'Taxonomy User', 'hash', 'user')").run();
    const userId = Number(ctx.db.prepare("SELECT id FROM users WHERE email='taxonomy-user@local'").get()?.id || 0);
    ctx.db.prepare(`
      INSERT INTO content_assignments (
        assignment_uid, content_item_id, assignment_kind, assignee_user_id, assigned_by_user_id, state
      ) VALUES ('taxonomy-return-assignment', ?, 'field', ?, ?, 'assigned')
    `).run(item.id, userId, userId);
    const assignmentId = Number(ctx.db.prepare("SELECT id FROM content_assignments WHERE assignment_uid='taxonomy-return-assignment'").get()?.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state, field_return_payload_json
      ) VALUES (?, ?, ?, 'submitted', ?)
    `).run(
      assignmentId,
      item.id,
      userId,
      JSON.stringify({
        checklist_results: [],
        cta_return: {},
        taxonomy_return: {
          category: { checked: false, found: true, value: "cafes", note: "clear category" },
          subtype: { checked: true, found: false, value: "", evidence_deliverable_id: 7 },
          tags: { checked: true, found: false, value: ["family", "late-night", "family"], note: "dedupe tags" },
        },
        note: "taxonomy note",
      })
    );

    const submission = repo.getAssignmentSubmissionById(Number(submissionResult.lastInsertRowid || 0));
    assert.deepEqual(submission.field_return_payload_json.taxonomy_return, {
      category: {
        checked: false,
        found: false,
        value: null,
        note: "clear category",
        evidence_deliverable_id: null,
        evidence_source_url: null,
      },
      subtype: {
        checked: true,
        found: true,
        value: null,
        note: null,
        evidence_deliverable_id: 7,
        evidence_source_url: null,
      },
      tags: {
        checked: true,
        found: true,
        value: ["family", "late-night"],
        note: "dedupe tags",
        evidence_deliverable_id: null,
        evidence_source_url: null,
      },
    });
  } finally {
    ctx.cleanup();
  }
});

test("field return taxonomy_return invalid tags value normalizes to empty array and stays not found without evidence", () => {
  const ctx = createDbContext("collector-schema-foundation-taxonomy-invalid-tags-");
  try {
    const repo = createRepository(ctx.db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "Invalid Tags Return Item",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/invalid-tags-return",
    }).item;
    ctx.db.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('invalid-tags-user@local', 'Invalid Tags User', 'hash', 'user')").run();
    const userId = Number(ctx.db.prepare("SELECT id FROM users WHERE email='invalid-tags-user@local'").get()?.id || 0);
    ctx.db.prepare(`
      INSERT INTO content_assignments (
        assignment_uid, content_item_id, assignment_kind, assignee_user_id, assigned_by_user_id, state
      ) VALUES ('invalid-tags-assignment', ?, 'field', ?, ?, 'assigned')
    `).run(item.id, userId, userId);
    const assignmentId = Number(ctx.db.prepare("SELECT id FROM content_assignments WHERE assignment_uid='invalid-tags-assignment'").get()?.id || 0);
    const submissionResult = ctx.db.prepare(`
      INSERT INTO content_assignment_submissions (
        assignment_id, content_item_id, submitted_by_user_id, submission_state, field_return_payload_json
      ) VALUES (?, ?, ?, 'submitted', ?)
    `).run(
      assignmentId,
      item.id,
      userId,
      JSON.stringify({
        checklist_results: [],
        cta_return: {},
        taxonomy_return: {
          tags: { checked: true, found: true, value: "not-an-array" },
        },
      })
    );
    const submission = repo.getAssignmentSubmissionById(Number(submissionResult.lastInsertRowid || 0));
    assert.deepEqual(submission.field_return_payload_json.taxonomy_return.tags, {
      checked: true,
      found: false,
      value: [],
      note: null,
      evidence_deliverable_id: null,
      evidence_source_url: null,
    });
  } finally {
    ctx.cleanup();
  }
});

test("invalid AI confidence normalizes to unknown", () => {
  const ctx = createDbContext("collector-schema-foundation-ai-confidence-");
  try {
    const repo = createRepository(ctx.db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "AI Confidence Item",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/ai-confidence",
    }).item;
    const pack = repo.createFieldPack({
      content_item_id: item.id,
      ai_cta_contact_json: {
        phone: "0812345678",
        confidence: "nonsense",
      },
      ai_taxonomy_json: {
        category: "attractions",
        confidence: "bad-value",
      },
    });
    assert.equal(pack.ai_cta_contact_json.confidence, "unknown");
    assert.equal(pack.ai_taxonomy_json.confidence, "unknown");
  } finally {
    ctx.cleanup();
  }
});
