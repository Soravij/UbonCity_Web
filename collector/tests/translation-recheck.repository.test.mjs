import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";

const REQUIRED_RECHECK_COLUMNS = [
  "translation_recheck_status",
  "translation_recheck_score",
  "accuracy_score",
  "fluency_score",
  "term_score",
  "back_translation_th",
  "recheck_summary_th",
  "recheck_issues_json",
  "recheck_model",
  "rechecked_at",
  "repair_attempt_count",
];

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-translation-recheck-repo-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  const repo = createRepository(db);

  function cleanup() {
    try {
      db.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function createItem() {
    const created = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "Translation Recheck Repo Test",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/recheck-repo",
    });
    return created.item;
  }

  return {
    db,
    repo,
    cleanup,
    createItem,
  };
}

function readTranslationColumnNames(db) {
  return db.prepare("PRAGMA table_info(content_translations)").all().map((row) => String(row?.name || "").trim());
}

function createLegacyTranslationTable(db, { nullableSource, withRecheckColumns }) {
  db.exec("DROP TABLE IF EXISTS content_translations;");
  const nullableSql = nullableSource ? "" : " NOT NULL";
  const recheckSql = withRecheckColumns
    ? `,
      translation_recheck_status TEXT NOT NULL DEFAULT 'not_checked',
      translation_recheck_score REAL,
      accuracy_score REAL,
      fluency_score REAL,
      term_score REAL,
      back_translation_th TEXT,
      recheck_summary_th TEXT,
      recheck_issues_json TEXT,
      recheck_model TEXT,
      rechecked_at TEXT,
      repair_attempt_count INTEGER NOT NULL DEFAULT 0`
    : "";
  db.exec(`
    CREATE TABLE content_translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_content_item_id INTEGER NOT NULL,
      source_published_article_id INTEGER${nullableSql},
      source_draft_id INTEGER,
      source_review_report_id INTEGER,
      source_fingerprint TEXT NOT NULL,
      lang TEXT NOT NULL,
      translated_title TEXT,
      translated_excerpt TEXT,
      translated_body TEXT,
      translated_meta_title TEXT,
      translated_meta_description TEXT,
      translation_status TEXT NOT NULL DEFAULT 'pending',
      automatic_check_status TEXT NOT NULL DEFAULT 'pending',
      automatic_check_report_json TEXT${recheckSql},
      stale_flag INTEGER NOT NULL DEFAULT 0,
      translator_engine TEXT,
      translator_model TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_content_item_id, lang)
    );
  `);
}

function assertHasRecheckColumns(db) {
  const columns = readTranslationColumnNames(db);
  for (const column of REQUIRED_RECHECK_COLUMNS) {
    assert.equal(columns.includes(column), true, `missing column ${column}`);
  }
}

test("repository exposes updateTranslationRecheck", () => {
  const ctx = createTestContext();
  try {
    assert.equal(typeof ctx.repo.updateTranslationRecheck, "function");
  } finally {
    ctx.cleanup();
  }
});

test("updateTranslationRecheck persists fields and returns the updated translation row", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    ctx.repo.upsertTranslation({
      source_content_item_id: item.id,
      source_published_article_id: null,
      source_draft_id: null,
      source_review_report_id: null,
      source_fingerprint: "fingerprint-1",
      lang: "en",
      translated_title: "title-en",
      translated_excerpt: "excerpt-en",
      translated_body: "body-en",
      translated_meta_title: "meta-title-en",
      translated_meta_description: "meta-description-en",
      translation_status: "ready",
      automatic_check_status: "passed",
      automatic_check_report: { status: "passed", issues: [] },
      stale_flag: 0,
      translator_engine: "openai",
      translator_model: "gpt-5.4-mini",
    });

    const updated = ctx.repo.updateTranslationRecheck(item.id, "EN", {
      translation_recheck_status: "warning",
      translation_recheck_score: 9.8,
      accuracy_score: 9.5,
      fluency_score: 9.7,
      term_score: 10,
      back_translation_th: "back translation",
      recheck_summary_th: "summary",
      recheck_issues: [{ type: "term", problem_th: "term mismatch" }],
      recheck_model: "openai:gpt-5.4-mini",
      rechecked_at: "2026-06-05T07:10:00.000Z",
      repair_attempt_count: 2,
    });

    assert.equal(updated.lang, "en");
    assert.equal(updated.translation_recheck_status, "warning");
    assert.equal(updated.translation_recheck_score, 9.8);
    assert.equal(updated.accuracy_score, 9.5);
    assert.equal(updated.fluency_score, 9.7);
    assert.equal(updated.term_score, 10);
    assert.equal(updated.back_translation_th, "back translation");
    assert.equal(updated.recheck_summary_th, "summary");
    assert.equal(updated.recheck_model, "openai:gpt-5.4-mini");
    assert.equal(updated.rechecked_at, "2026-06-05T07:10:00.000Z");
    assert.equal(updated.repair_attempt_count, 2);
    assert.deepEqual(updated.recheck_issues, [{ type: "term", problem_th: "term mismatch" }]);

    const fromList = ctx.repo.listTranslations(item.id)[0];
    assert.equal(fromList.translation_recheck_status, "warning");
    assert.equal(fromList.translation_recheck_score, 9.8);
    assert.deepEqual(fromList.recheck_issues, [{ type: "term", problem_th: "term mismatch" }]);
  } finally {
    ctx.cleanup();
  }
});

test("updateTranslationRecheck throws when the translation row does not exist", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    assert.throws(
      () => ctx.repo.updateTranslationRecheck(item.id, "en", {
        translation_recheck_status: "passed",
      }),
      /translation locale not found/i,
    );
  } finally {
    ctx.cleanup();
  }
});

test("repository exposes updateTranslationRepairResult", () => {
  const ctx = createTestContext();
  try {
    assert.equal(typeof ctx.repo.updateTranslationRepairResult, "function");
  } finally {
    ctx.cleanup();
  }
});

test("updateTranslationRepairResult persists translated fields and resets recheck fields", () => {
  const ctx = createTestContext();
  try {
    const item = ctx.createItem();
    ctx.repo.upsertTranslation({
      source_content_item_id: item.id,
      source_published_article_id: null,
      source_draft_id: null,
      source_review_report_id: null,
      source_fingerprint: "fingerprint-1",
      lang: "en",
      translated_title: "title-en",
      translated_excerpt: "excerpt-en",
      translated_body: "body-en",
      translated_meta_title: "meta-title-en",
      translated_meta_description: "meta-description-en",
      translation_status: "ready",
      automatic_check_status: "passed",
      automatic_check_report: { status: "passed", issues: [] },
      translation_recheck_status: "warning",
      translation_recheck_score: 7.4,
      accuracy_score: 7.1,
      fluency_score: 7.5,
      term_score: 7.3,
      back_translation_th: "back translation",
      recheck_summary_th: "summary",
      recheck_issues: [{ type: "term", problem_th: "term mismatch" }],
      recheck_model: "openai:gpt-5.4-mini",
      rechecked_at: "2026-06-05T07:10:00.000Z",
      repair_attempt_count: 1,
      stale_flag: 0,
      translator_engine: "openai",
      translator_model: "gpt-5.4-mini",
    });

    const updated = ctx.repo.updateTranslationRepairResult(item.id, "EN", {
      source_fingerprint: "fingerprint-2",
      translated_title: "repaired title",
      translated_excerpt: "repaired excerpt",
      translated_body: "repaired body",
      translated_meta_title: "repaired meta title",
      translated_meta_description: "repaired meta description",
      translation_status: "ready",
      automatic_check_status: "passed",
      automatic_check_report: { status: "passed", issues: [] },
      repair_attempt_count: 2,
    });

    assert.equal(updated.translated_title, "repaired title");
    assert.equal(updated.source_fingerprint, "fingerprint-2");
    assert.equal(updated.translation_recheck_status, "not_checked");
    assert.equal(updated.translation_recheck_score, null);
    assert.equal(updated.back_translation_th, null);
    assert.equal(updated.recheck_summary_th, null);
    assert.deepEqual(updated.recheck_issues, []);
    assert.equal(updated.repair_attempt_count, 2);
  } finally {
    ctx.cleanup();
  }
});

test("repository migration adds recheck columns to existing nullable-source table that lacks them", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-translation-recheck-migrate-nullable-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  try {
    createLegacyTranslationTable(db, { nullableSource: true, withRecheckColumns: false });
    const repo = createRepository(db);
    assertHasRecheckColumns(db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "Nullable source migration",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/nullable",
    }).item;
    repo.upsertTranslation({
      source_content_item_id: item.id,
      source_published_article_id: null,
      source_draft_id: null,
      source_review_report_id: null,
      source_fingerprint: "nullable-1",
      lang: "en",
      translated_title: "title-en",
      translated_excerpt: "excerpt-en",
      translated_body: "body-en",
      translated_meta_title: "meta-title-en",
      translated_meta_description: "meta-description-en",
      translation_status: "ready",
      automatic_check_status: "passed",
      automatic_check_report: { status: "passed", issues: [] },
      stale_flag: 0,
      translator_engine: "openai",
      translator_model: "gpt-5.4-mini",
    });
    const updated = repo.updateTranslationRecheck(item.id, "en", {
      translation_recheck_status: "passed",
      translation_recheck_score: 9.9,
    });
    assert.equal(updated.translation_recheck_status, "passed");
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("repository migration rebuild path does not duplicate columns and leaves recheck columns present", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-translation-recheck-migrate-rebuild-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  try {
    createLegacyTranslationTable(db, { nullableSource: false, withRecheckColumns: false });
    const repo = createRepository(db);
    assertHasRecheckColumns(db);
    const item = repo.createItemWithWorkflowHead({
      type: "place",
      category: "attractions",
      lang: "th",
      title: "Rebuild migration",
      description_raw: "raw",
      source_type: "manual",
      source_name: "manual",
      source_url: "https://example.com/rebuild",
    }).item;
    repo.upsertTranslation({
      source_content_item_id: item.id,
      source_published_article_id: null,
      source_draft_id: null,
      source_review_report_id: null,
      source_fingerprint: "rebuild-1",
      lang: "en",
      translated_title: "title-en",
      translated_excerpt: "excerpt-en",
      translated_body: "body-en",
      translated_meta_title: "meta-title-en",
      translated_meta_description: "meta-description-en",
      translation_status: "ready",
      automatic_check_status: "passed",
      automatic_check_report: { status: "passed", issues: [] },
      stale_flag: 0,
      translator_engine: "openai",
      translator_model: "gpt-5.4-mini",
    });
    const updated = repo.updateTranslationRecheck(item.id, "en", {
      translation_recheck_status: "warning",
      translation_recheck_score: 8.1,
    });
    assert.equal(updated.translation_recheck_status, "warning");
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("repository migration is idempotent when all recheck columns already exist", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-translation-recheck-migrate-idempotent-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  const schemaPath = path.resolve("D:\\UbonCity_Web\\collector\\database\\schema.sql");
  const db = openDatabase(dbPath, schemaPath);
  try {
    createLegacyTranslationTable(db, { nullableSource: true, withRecheckColumns: true });
    createRepository(db);
    createRepository(db);
    assertHasRecheckColumns(db);
  } finally {
    try { db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
