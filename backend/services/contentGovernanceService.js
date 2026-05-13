import pool from "../config/db.js";

export async function ensureContentGovernanceInfrastructure() {
  const [placeEmerRows] = await pool.query("SHOW COLUMNS FROM places LIKE 'is_emer'");
  if (!Array.isArray(placeEmerRows) || !placeEmerRows.length) {
    await pool.query("ALTER TABLE places ADD COLUMN is_emer TINYINT(1) NOT NULL DEFAULT 0");
    await pool.query("CREATE INDEX idx_places_is_emer ON places (is_emer)");
  }

  const [eventEmerRows] = await pool.query("SHOW COLUMNS FROM events LIKE 'is_emer'");
  if (!Array.isArray(eventEmerRows) || !eventEmerRows.length) {
    await pool.query("ALTER TABLE events ADD COLUMN is_emer TINYINT(1) NOT NULL DEFAULT 0");
    await pool.query("CREATE INDEX idx_events_is_emer ON events (is_emer)");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_purge_audit (
      id BIGINT NOT NULL AUTO_INCREMENT,
      entity_type ENUM('place','event') NOT NULL,
      entity_id BIGINT NOT NULL,
      category VARCHAR(64) NULL,
      slug VARCHAR(255) NULL,
      title_snapshot VARCHAR(255) NULL,
      is_emer TINYINT(1) NOT NULL DEFAULT 0,
      purged_by_user_id BIGINT NULL,
      purge_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_content_purge_audit_created_at (created_at),
      KEY idx_content_purge_audit_entity (entity_type, entity_id)
    )
  `);
}

export async function appendContentPurgeAudit({
  entityType,
  entityId,
  category = null,
  slug = null,
  titleSnapshot = null,
  isEmer = 0,
  purgedByUserId = null,
  purgeNote = null,
  executor = pool,
}) {
  await executor.query(
    `INSERT INTO content_purge_audit
      (entity_type, entity_id, category, slug, title_snapshot, is_emer, purged_by_user_id, purge_note)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      String(entityType || "").trim().toLowerCase(),
      Number(entityId || 0) || 0,
      category == null ? null : String(category || "").trim() || null,
      slug == null ? null : String(slug || "").trim() || null,
      titleSnapshot == null ? null : String(titleSnapshot || "").trim() || null,
      Number(isEmer || 0) === 1 ? 1 : 0,
      purgedByUserId == null ? null : Number(purgedByUserId || 0) || null,
      purgeNote == null ? null : String(purgeNote || "").trim() || null,
    ]
  );
}

export async function listContentPurgeAudit({
  limit = 200,
  offset = 0,
} = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 200) || 200));
  const safeOffset = Math.max(0, Number(offset || 0) || 0);
  const [rows] = await pool.query(
    `SELECT *
     FROM content_purge_audit
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [safeLimit, safeOffset]
  );
  return Array.isArray(rows) ? rows : [];
}
