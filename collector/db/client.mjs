import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

function ensureUsersAuthColumns(db) {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("password_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';");
  }
  if (!names.has("managed_by_user_id")) {
    db.exec("ALTER TABLE users ADD COLUMN managed_by_user_id INTEGER;");
  }
}

function removeLegacyLocalAuthData(db) {
  db.exec("DROP TABLE IF EXISTS user_sessions;");
  db.prepare("UPDATE users SET password_hash='' WHERE COALESCE(password_hash, '')<>''").run();
}

function ensureApprovedContextActiveUniqueness(db) {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='approved_context_blocks' LIMIT 1")
    .get();
  if (!tableExists) return;
  const duplicateGroups = db.prepare(`
    SELECT content_item_id, evidence_block_id, COUNT(*) AS duplicate_count
    FROM approved_context_blocks
    WHERE status='active'
    GROUP BY content_item_id, evidence_block_id
    HAVING COUNT(*) > 1
  `).all();

  if (duplicateGroups.length > 0) {
    const listActiveIdsStmt = db.prepare(`
      SELECT id
      FROM approved_context_blocks
      WHERE content_item_id=? AND evidence_block_id=? AND status='active'
      ORDER BY id DESC
    `);
    const deactivateStmt = db.prepare(`
      UPDATE approved_context_blocks
      SET status='inactive', updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `);

    for (const group of duplicateGroups) {
      const ids = listActiveIdsStmt
        .all(group.content_item_id, group.evidence_block_id)
        .map((row) => Number(row.id || 0))
        .filter((id) => id > 0);
      for (const staleId of ids.slice(1)) {
        deactivateStmt.run(staleId);
      }
    }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_approved_context_active_unique
    ON approved_context_blocks(content_item_id, evidence_block_id)
    WHERE status='active'
  `);
}

function ensureEvidenceContextColumns(db) {
  const evidenceCols = db.prepare("PRAGMA table_info(evidence_blocks)").all();
  const evidenceNames = new Set(evidenceCols.map((c) => c.name));
  if (!evidenceNames.has("source_record_type")) db.exec("ALTER TABLE evidence_blocks ADD COLUMN source_record_type TEXT;");
  if (!evidenceNames.has("source_record_id")) db.exec("ALTER TABLE evidence_blocks ADD COLUMN source_record_id TEXT;");
  if (!evidenceNames.has("source_label")) db.exec("ALTER TABLE evidence_blocks ADD COLUMN source_label TEXT;");
  if (!evidenceNames.has("lang")) db.exec("ALTER TABLE evidence_blocks ADD COLUMN lang TEXT;");

  const contextCols = db.prepare("PRAGMA table_info(approved_context_blocks)").all();
  const contextNames = new Set(contextCols.map((c) => c.name));
  if (!contextNames.has("editor_note")) db.exec("ALTER TABLE approved_context_blocks ADD COLUMN editor_note TEXT;");
  if (!contextNames.has("sort_order")) db.exec("ALTER TABLE approved_context_blocks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;");

  const snapshotCols = db.prepare("PRAGMA table_info(draft_input_snapshots)").all();
  const snapshotNames = new Set(snapshotCols.map((c) => c.name));
  if (!snapshotNames.has("source")) db.exec("ALTER TABLE draft_input_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'approved_context_preview';");
  if (!snapshotNames.has("payload_json")) db.exec("ALTER TABLE draft_input_snapshots ADD COLUMN payload_json TEXT;");

  ensureApprovedContextActiveUniqueness(db);
}
function ensureSearchIntelligenceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_enrichment_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      query TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'manual',
      ingestion_mode TEXT NOT NULL DEFAULT 'manual',
      top_results_json TEXT,
      official_urls_json TEXT,
      web_presence_score REAL,
      content_gap_score REAL,
      entity_confidence_score REAL,
      search_angle_hints_json TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_search_enrichment_item ON search_enrichment_records(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_search_enrichment_created ON search_enrichment_records(created_at DESC);
  `);

  const searchCols = db.prepare("PRAGMA table_info(search_enrichment_records)").all();
  const searchNames = new Set(searchCols.map((c) => c.name));
  if (!searchNames.has("updated_at")) {
    db.exec("ALTER TABLE search_enrichment_records ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS place_intelligence_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      rating_score REAL NOT NULL DEFAULT 0,
      review_volume_score REAL NOT NULL DEFAULT 0,
      visual_score REAL NOT NULL DEFAULT 0,
      content_gap_score REAL NOT NULL DEFAULT 0,
      priority_score REAL NOT NULL DEFAULT 0,
      score_mode TEXT NOT NULL DEFAULT 'maps_only',
      why_selected_json TEXT,
      best_content_angles_json TEXT,
      recommended_action TEXT NOT NULL DEFAULT 'monitor',
      payload_json TEXT,
      computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_place_intelligence_item ON place_intelligence_scores(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_place_intelligence_priority ON place_intelligence_scores(priority_score DESC, computed_at DESC);
  `);
}

function ensureSocialMomentumTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_signal_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      ingestion_mode TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      external_id TEXT,
      published_at TEXT,
      collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      author_label TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_social_signal_item ON social_signal_sources(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_social_signal_platform ON social_signal_sources(platform);
    CREATE INDEX IF NOT EXISTS idx_social_signal_published ON social_signal_sources(published_at DESC);

    CREATE TABLE IF NOT EXISTS social_momentum_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      mention_count INTEGER NOT NULL DEFAULT 0,
      post_count INTEGER NOT NULL DEFAULT 0,
      engagement_score REAL NOT NULL DEFAULT 0,
      recency_score REAL NOT NULL DEFAULT 0,
      momentum_score REAL NOT NULL DEFAULT 0,
      momentum_reason TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_social_momentum_item ON social_momentum_snapshots(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_social_momentum_platform ON social_momentum_snapshots(platform);
    CREATE INDEX IF NOT EXISTS idx_social_momentum_snapshot_date ON social_momentum_snapshots(snapshot_date DESC);
  `);
}
function ensureContentDirectionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_direction_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_item_id INTEGER NOT NULL,
      priority_band TEXT NOT NULL DEFAULT 'low',
      direction_status TEXT NOT NULL DEFAULT 'weak_signal',
      primary_angle TEXT,
      secondary_angles_json TEXT,
      why_now_json TEXT,
      why_not_now_json TEXT,
      recommended_next_action TEXT NOT NULL DEFAULT 'hold',
      recommended_capture_plan_json TEXT,
      recommended_content_formats_json TEXT,
      signal_summary_json TEXT,
      gaps_json TEXT,
      payload_json TEXT,
      computed_from_mode TEXT NOT NULL DEFAULT 'maps_only',
      computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_content_direction_item ON content_direction_reports(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_content_direction_priority ON content_direction_reports(priority_band, computed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_direction_status ON content_direction_reports(direction_status, computed_at DESC);
  `);
}

function ensureWorkflowTransitionColumns(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_workflow_transitions' LIMIT 1")
    .get();
  if (!table) return;
  const cols = db.prepare("PRAGMA table_info(content_workflow_transitions)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("actor_role")) {
    db.exec("ALTER TABLE content_workflow_transitions ADD COLUMN actor_role TEXT;");
  }
  if (!names.has("reason_code")) {
    db.exec("ALTER TABLE content_workflow_transitions ADD COLUMN reason_code TEXT;");
  }
  if (!names.has("assignment_id")) {
    db.exec("ALTER TABLE content_workflow_transitions ADD COLUMN assignment_id INTEGER;");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_transitions_reason ON content_workflow_transitions(reason_code, created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_workflow_transitions_assignment ON content_workflow_transitions(assignment_id, created_at DESC);");
}

function ensureWorkflowHeadBootstrapColumns(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_workflow_models' LIMIT 1")
    .get();
  if (!table) return;
  const cols = db.prepare("PRAGMA table_info(content_workflow_models)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("current_draft_id")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN current_draft_id INTEGER;");
  }
  if (!names.has("current_review_report_id")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN current_review_report_id INTEGER;");
  }
  if (!names.has("current_field_pack_id")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN current_field_pack_id INTEGER;");
  }
  if (!names.has("state_version")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1;");
  }
  if (!names.has("content_version")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0;");
  }
  if (!names.has("last_actor_email")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN last_actor_email TEXT;");
  }
  if (!names.has("last_transition_at")) {
    db.exec("ALTER TABLE content_workflow_models ADD COLUMN last_transition_at TEXT;");
  }
}

function ensureAuditColumns(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs' LIMIT 1")
    .get();
  if (!table) return;
  const cols = db.prepare("PRAGMA table_info(audit_logs)").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("assignment_id")) {
    db.exec("ALTER TABLE audit_logs ADD COLUMN assignment_id INTEGER;");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_assignment ON audit_logs(assignment_id, created_at DESC);");
}
export const MIN_PASSWORD_LENGTH = 8;
const WEAK_PASSWORDS = new Set(["admin", "admin1234", "password", "password123", "changeme", "123456", "12345678", "qwerty", "letmein"]);
const UPPERCASE_PASSWORD_PATTERN = /[A-Z]/;
const SPECIAL_PASSWORD_PATTERN = /[^A-Za-z0-9\s]/;
export const PASSWORD_POLICY_SUMMARY = `at least ${MIN_PASSWORD_LENGTH} characters, including 1 uppercase letter and 1 special character`;

export function validateStrongPassword(candidate) {
  const password = String(candidate || "");
  const normalized = password.trim().toLowerCase();

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  if (!UPPERCASE_PASSWORD_PATTERN.test(password)) {
    return { ok: false, error: "password must include at least 1 uppercase letter" };
  }

  if (!SPECIAL_PASSWORD_PATTERN.test(password)) {
    return { ok: false, error: "password must include at least 1 special character" };
  }

  if (WEAK_PASSWORDS.has(normalized)) {
    return { ok: false, error: "password is too weak" };
  }

  return { ok: true };
}

export function openDatabase(dbPath, schemaPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  if (schemaPath) {
    ensureApprovedContextActiveUniqueness(db);
    ensureWorkflowHeadBootstrapColumns(db);
    const schemaSql = fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, "");
    db.exec(schemaSql);
  }

  ensureUsersAuthColumns(db);
  ensureEvidenceContextColumns(db);
  ensureSearchIntelligenceTables(db);
  ensureSocialMomentumTables(db);
  ensureContentDirectionTables(db);
  ensureWorkflowTransitionColumns(db);
  ensureAuditColumns(db);
  removeLegacyLocalAuthData(db);
  return db;
}



