import path from "path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const down = argv.includes("--down");
  const dbIndex = argv.indexOf("--db");
  const dbPath = dbIndex >= 0 ? argv[dbIndex + 1] : "";
  if (!dbPath) throw new Error("usage: node scripts/migrate-remove-assignment-state.mjs --db <path> [--down]");
  return { down, dbPath: path.resolve(dbPath) };
}

function hasColumn(db, name) {
  return db.prepare("PRAGMA table_info(content_workflow_models)").all().some((row) => row.name === name);
}

function createWorkflowModelIndexes(db, withAssignmentState) {
  db.exec(`
    CREATE INDEX idx_content_workflow_models_production ON content_workflow_models(production_state, updated_at DESC);
    CREATE INDEX idx_content_workflow_models_publication ON content_workflow_models(publication_state, updated_at DESC);
    ${withAssignmentState
      ? "CREATE INDEX idx_content_workflow_models_assignment ON content_workflow_models(assignment_state, updated_at DESC);"
      : ""}
    CREATE INDEX idx_content_workflow_models_current_draft ON content_workflow_models(current_draft_id);
    CREATE INDEX idx_content_workflow_models_current_review ON content_workflow_models(current_review_report_id);
    CREATE INDEX idx_content_workflow_models_current_field_pack ON content_workflow_models(current_field_pack_id);
  `);
}

function rebuildWorkflowModels(db, withAssignmentState) {
  const legacyTable = "content_workflow_models__assignment_state_legacy";
  const sourceHasAssignmentState = hasColumn(db, "assignment_state");
  db.exec(`
    ALTER TABLE content_workflow_models RENAME TO ${legacyTable};
    CREATE TABLE content_workflow_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL UNIQUE,
      production_state TEXT NOT NULL DEFAULT 'collected',
      publication_state TEXT NOT NULL DEFAULT 'draft',
      ${withAssignmentState ? "assignment_state TEXT," : ""}
      place_review_flag TEXT NOT NULL DEFAULT 'none'
        CHECK (place_review_flag IN ('none', 'revision_requested', 'rejected')),
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
      ${withAssignmentState ? "assignment_state," : ""}
      place_review_flag, current_draft_id, current_review_report_id, current_field_pack_id,
      state_version, content_version, last_actor_email, last_transition_at,
      last_transition_note, updated_by, created_at, updated_at
    )
    SELECT
      id, content_item_id, production_state, publication_state,
      ${withAssignmentState ? (sourceHasAssignmentState ? "assignment_state," : "NULL,") : ""}
      place_review_flag, current_draft_id, current_review_report_id, current_field_pack_id,
      state_version, content_version, last_actor_email, last_transition_at,
      last_transition_note, updated_by, created_at, updated_at
    FROM ${legacyTable};
    DROP TABLE ${legacyTable};
  `);
  createWorkflowModelIndexes(db, withAssignmentState);
}

function migrateUp(db) {
  if (!hasColumn(db, "assignment_state")) return;
  rebuildWorkflowModels(db, false);
}

function migrateDown(db) {
  if (hasColumn(db, "assignment_state")) return;
  rebuildWorkflowModels(db, true);
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
