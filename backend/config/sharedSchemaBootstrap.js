import pool from "./db.js";

export async function ensureSharedSchemaBootstrap() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS place_translations (
      id INT NOT NULL AUTO_INCREMENT,
      place_id INT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      meta_title VARCHAR(255) NULL,
      meta_description VARCHAR(320) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_place_lang (place_id, lang)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_translations (
      id INT NOT NULL AUTO_INCREMENT,
      event_id INT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      meta_title VARCHAR(255) NULL,
      meta_description VARCHAR(320) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_event_lang (event_id, lang)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id INT NOT NULL AUTO_INCREMENT,
      asset_uid CHAR(36) NOT NULL,
      source_url VARCHAR(1200) NULL,
      checksum CHAR(64) NULL,
      status ENUM('pending','approved','rejected','archived') NOT NULL DEFAULT 'pending',
      related_type ENUM('place','event','article','other') NOT NULL DEFAULT 'other',
      related_id INT NULL,
      title VARCHAR(255) NULL,
      alt_text VARCHAR(255) NULL,
      credit VARCHAR(255) NULL,
      notes TEXT NULL,
      mime_type VARCHAR(120) NULL,
      size_bytes BIGINT NULL,
      width INT NULL,
      height INT NULL,
      storage_disk ENUM('local','external','nas') NOT NULL DEFAULT 'local',
      storage_path VARCHAR(1200) NULL,
      file_name VARCHAR(255) NULL,
      created_by INT NULL,
      reviewed_by INT NULL,
      reviewed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_media_assets_uid (asset_uid),
      KEY idx_media_assets_status (status),
      KEY idx_media_assets_related (related_type, related_id),
      KEY idx_media_assets_checksum (checksum)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_image_usages (
      id INT NOT NULL AUTO_INCREMENT,
      asset_id INT NOT NULL,
      entity_type ENUM('place','event','article') NOT NULL,
      entity_id INT NOT NULL,
      usage_type ENUM('cover','gallery','inline') NOT NULL DEFAULT 'gallery',
      position INT NOT NULL DEFAULT 0,
      caption VARCHAR(255) NULL,
      created_by INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_content_image_usages_entity (entity_type, entity_id),
      KEY idx_content_image_usages_asset (asset_id),
      KEY idx_content_image_usages_usage (usage_type),
      CONSTRAINT fk_content_image_usages_asset FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    )
  `);

  const [placeMetaTitleCol] = await pool.query("SHOW COLUMNS FROM place_translations LIKE 'meta_title'");
  if (!placeMetaTitleCol.length) {
    await pool.query("ALTER TABLE place_translations ADD COLUMN meta_title VARCHAR(255) NULL");
  }

  const [placeMetaDescriptionCol] = await pool.query("SHOW COLUMNS FROM place_translations LIKE 'meta_description'");
  if (!placeMetaDescriptionCol.length) {
    await pool.query("ALTER TABLE place_translations ADD COLUMN meta_description VARCHAR(320) NULL");
  }

  const [eventMetaTitleCol] = await pool.query("SHOW COLUMNS FROM event_translations LIKE 'meta_title'");
  if (!eventMetaTitleCol.length) {
    await pool.query("ALTER TABLE event_translations ADD COLUMN meta_title VARCHAR(255) NULL");
  }

  const [eventMetaDescriptionCol] = await pool.query("SHOW COLUMNS FROM event_translations LIKE 'meta_description'");
  if (!eventMetaDescriptionCol.length) {
    await pool.query("ALTER TABLE event_translations ADD COLUMN meta_description VARCHAR(320) NULL");
  }

  await pool.query(`
    DELETE older
    FROM place_translations older
    INNER JOIN place_translations newer
      ON newer.place_id = older.place_id
     AND newer.lang = older.lang
     AND newer.id > older.id
  `);
  const [placeLangIndex] = await pool.query("SHOW INDEX FROM place_translations WHERE Key_name='uq_place_lang'");
  if (!placeLangIndex.length) {
    await pool.query("ALTER TABLE place_translations ADD UNIQUE KEY uq_place_lang (place_id, lang)");
  }

  await pool.query(`
    DELETE older
    FROM event_translations older
    INNER JOIN event_translations newer
      ON newer.event_id = older.event_id
     AND newer.lang = older.lang
     AND newer.id > older.id
  `);
  const [eventLangIndex] = await pool.query("SHOW INDEX FROM event_translations WHERE Key_name='uq_event_lang'");
  if (!eventLangIndex.length) {
    await pool.query("ALTER TABLE event_translations ADD UNIQUE KEY uq_event_lang (event_id, lang)");
  }
}
