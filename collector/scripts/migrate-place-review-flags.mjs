import path from "path";
import { DatabaseSync } from "node:sqlite";

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
  if (!hasColumn(db, "place_review_flag")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN place_review_flag TEXT NOT NULL DEFAULT 'none';");
  }
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
    if (state === "needs_revision") {
      const target = PLACE_REVISION_TARGETS[source];
      if (!target) {
        throw new Error(`cannot migrate place ${itemId}: needs_revision has no reversible source transition`);
      }
      db.prepare("UPDATE content_workflow_models SET production_state=?, place_review_flag='revision_requested' WHERE content_item_id=?")
        .run(target, itemId);
      recordTransition(db, itemId, "production", "needs_revision", target, "place_review_flag_migration_up");
      recordTransition(db, itemId, "place_review_flag", "none", "revision_requested", "place_review_flag_migration_up");
      continue;
    }
    if (!source) {
      throw new Error(`cannot migrate place ${itemId}: rejected has no reversible source transition`);
    }
    db.prepare("UPDATE content_workflow_models SET production_state=?, place_review_flag='rejected' WHERE content_item_id=?")
      .run(source, itemId);
    recordTransition(db, itemId, "production", "rejected", source, "place_review_flag_migration_up");
    recordTransition(db, itemId, "place_review_flag", "none", "rejected", "place_review_flag_migration_up");
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
  db.exec("ALTER TABLE content_workflow_models DROP COLUMN place_review_flag;");
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
