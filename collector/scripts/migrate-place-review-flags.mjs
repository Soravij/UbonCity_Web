import path from "path";
import { DatabaseSync } from "node:sqlite";
import { TRANSITION_RULES } from "../db/repository.mjs";
import { hasPlaceReviewFlagCheck } from "../db/workflow-head-schema.mjs";

const PLACE_REVISION_TARGETS = Object.freeze({
  collected: "collected",
  analyzed: "analyzed",
  generated: "analyzed",
  field_review: "field_working",
  in_review: "writing",
  ready_for_publish: "in_review",
  submitted_for_admin_review: "in_review",
  completed: "completed",
});

function parseArgs(argv) {
  const down = argv.includes("--down");
  const dbIndex = argv.indexOf("--db");
  const dbPath = dbIndex >= 0 ? argv[dbIndex + 1] : "";
  if (!dbPath) throw new Error("usage: node scripts/migrate-place-review-flags.mjs --db <path> [--down]");
  return { down, dbPath: path.resolve(dbPath) };
}

function hasColumn(db, name) {
  return db.prepare("PRAGMA table_info(content_workflow_models)").all().some((row) => row.name === name);
}

function assertValidPlaceReviewFlagValues(db) {
  const invalid = db.prepare(`
    SELECT content_item_id, place_review_flag
    FROM content_workflow_models
    WHERE lower(trim(COALESCE(place_review_flag, ''))) NOT IN ('none', 'revision_requested', 'rejected')
    ORDER BY content_item_id
    LIMIT 1
  `).get();
  if (invalid) {
    throw new Error(`cannot migrate place review flag CHECK: item ${Number(invalid.content_item_id)} has invalid place_review_flag '${String(invalid.place_review_flag)}'`);
  }
}

function createWorkflowModelIndexes(db) {
  db.exec(`
    CREATE INDEX idx_content_workflow_models_production ON content_workflow_models(production_state, updated_at DESC);
    CREATE INDEX idx_content_workflow_models_publication ON content_workflow_models(publication_state, updated_at DESC);
    CREATE INDEX idx_content_workflow_models_current_draft ON content_workflow_models(current_draft_id);
    CREATE INDEX idx_content_workflow_models_current_review ON content_workflow_models(current_review_report_id);
    CREATE INDEX idx_content_workflow_models_current_field_pack ON content_workflow_models(current_field_pack_id);
  `);
}

function rebuildWorkflowModels(db, withPlaceReviewFlag) {
  const legacyTable = "content_workflow_models__place_review_flag_legacy";
  db.exec(`
    ALTER TABLE content_workflow_models RENAME TO ${legacyTable};
    CREATE TABLE content_workflow_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL UNIQUE,
      production_state TEXT NOT NULL DEFAULT 'collected',
      publication_state TEXT NOT NULL DEFAULT 'draft',
      ${withPlaceReviewFlag
        ? "place_review_flag TEXT NOT NULL DEFAULT 'none' CHECK (place_review_flag IN ('none', 'revision_requested', 'rejected')),"
        : ""}
      current_draft_id INTEGER,
      current_review_report_id INTEGER,
      current_field_pack_id INTEGER,
      state_version INTEGER NOT NULL DEFAULT 1,
      content_version INTEGER NOT NULL DEFAULT 0,
      last_actor_email TEXT,
      last_transition_at TEXT,
      last_transition_note TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
    );
    INSERT INTO content_workflow_models (
      id, content_item_id, production_state, publication_state,
      ${withPlaceReviewFlag ? "place_review_flag," : ""}
      current_draft_id, current_review_report_id, current_field_pack_id,
      state_version, content_version, last_actor_email, last_transition_at,
      last_transition_note, updated_by, created_at, updated_at
    )
    SELECT
      id, content_item_id, production_state, publication_state,
      ${withPlaceReviewFlag ? (hasColumn(db, "place_review_flag") ? "place_review_flag," : "'none',") : ""}
      current_draft_id, current_review_report_id, current_field_pack_id,
      state_version, content_version, last_actor_email, last_transition_at,
      last_transition_note, updated_by, created_at, updated_at
    FROM ${legacyTable};
    DROP TABLE ${legacyTable};
  `);
  createWorkflowModelIndexes(db);
}

function ensurePlaceReviewFlagColumn(db) {
  if (!hasColumn(db, "place_review_flag")) {
    rebuildWorkflowModels(db, true);
    return;
  }
  if (!hasPlaceReviewFlagCheck(db)) {
    assertValidPlaceReviewFlagValues(db);
    rebuildWorkflowModels(db, true);
  }
}

function assertMigratedPlaceTargetCanContinue(itemId, target) {
  const outgoing = TRANSITION_RULES.place?.production?.[target];
  if (!(outgoing instanceof Set) || outgoing.size === 0) {
    throw new Error(`cannot migrate place ${itemId}: target '${target}' has no outgoing place production transition`);
  }
}

function recordTransition(db, contentItemId, stateGroup, fromState, toState, reasonCode) {
  db.prepare(`
    INSERT INTO content_workflow_transitions (
      content_item_id, state_group, from_state, to_state, actor_email, actor_role, reason_code, note, created_at
    ) VALUES (?, ?, ?, ?, 'system@local', 'system', ?, 'place review flag schema migration', CURRENT_TIMESTAMP)
  `).run(contentItemId, stateGroup, fromState, toState, reasonCode);
}

function latestLegacyProductionSource(db, contentItemId, toState) {
  return db.prepare(`
    SELECT from_state
    FROM content_workflow_transitions
    WHERE content_item_id=? AND state_group='production' AND to_state=?
    ORDER BY id DESC
    LIMIT 1
  `).get(contentItemId, toState)?.from_state || null;
}

function migrateUp(db) {
  ensurePlaceReviewFlagColumn(db);
  const legacyRows = db.prepare(`
    SELECT m.content_item_id, m.production_state
    FROM content_workflow_models m
    JOIN content_items i ON i.id=m.content_item_id
    WHERE lower(trim(COALESCE(i.type, '')))='place'
      AND m.production_state IN ('needs_revision', 'rejected')
  `).all();
  for (const row of legacyRows) {
    const itemId = Number(row.content_item_id);
    const state = String(row.production_state || "").trim().toLowerCase();
    const source = String(latestLegacyProductionSource(db, itemId, state) || "").trim().toLowerCase();
    if (!source) {
      throw new Error(`cannot migrate place ${itemId}: ${state} has no reversible source transition`);
    }
    const target = PLACE_REVISION_TARGETS[source];
    if (!target) {
      throw new Error(`cannot migrate place ${itemId}: ${state} source '${source}' has no reversible place target`);
    }
    assertMigratedPlaceTargetCanContinue(itemId, target);
    const flag = state === "needs_revision" ? "revision_requested" : "rejected";
    db.prepare("UPDATE content_workflow_models SET production_state=?, place_review_flag=? WHERE content_item_id=?")
      .run(target, flag, itemId);
    recordTransition(db, itemId, "production", state, target, "place_review_flag_migration_up");
    recordTransition(db, itemId, "place_review_flag", "none", flag, "place_review_flag_migration_up");
  }
}

function migrateDown(db) {
  if (!hasColumn(db, "place_review_flag")) return;
  const rows = db.prepare(`
    SELECT m.content_item_id, m.production_state, m.place_review_flag
    FROM content_workflow_models m
    JOIN content_items i ON i.id=m.content_item_id
    WHERE lower(trim(COALESCE(i.type, '')))='place'
      AND m.place_review_flag IN ('revision_requested', 'rejected')
  `).all();
  for (const row of rows) {
    const itemId = Number(row.content_item_id);
    const oldFlag = String(row.place_review_flag || "").trim().toLowerCase();
    const migration = db.prepare(`
      SELECT from_state
      FROM content_workflow_transitions
      WHERE content_item_id=?
        AND state_group='production'
        AND to_state=?
        AND from_state IN ('needs_revision', 'rejected')
        AND reason_code='place_review_flag_migration_up'
      ORDER BY id DESC
      LIMIT 1
    `).get(itemId, row.production_state);
    const legacyState = String(migration?.from_state || "").trim().toLowerCase();
    if (!legacyState) {
      throw new Error(`cannot reverse place ${itemId}: ${oldFlag} was created after the migration`);
    }
    db.prepare("UPDATE content_workflow_models SET production_state=?, place_review_flag='none' WHERE content_item_id=?")
      .run(legacyState, itemId);
    recordTransition(db, itemId, "production", row.production_state, legacyState, "place_review_flag_migration_down");
    recordTransition(db, itemId, "place_review_flag", oldFlag, "none", "place_review_flag_migration_down");
  }
  rebuildWorkflowModels(db, false);
}

const { down, dbPath } = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("BEGIN IMMEDIATE;");
try {
  if (down) migrateDown(db); else migrateUp(db);
  db.exec("COMMIT;");
  console.log(JSON.stringify({ ok: true, direction: down ? "down" : "up", db_path: dbPath }));
} catch (error) {
  db.exec("ROLLBACK;");
  throw error;
} finally {
  db.close();
}
