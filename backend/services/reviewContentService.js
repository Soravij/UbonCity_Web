import pool from "../config/db.js";

export async function ensureReviewInfrastructure() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_contents (
      id BIGINT NOT NULL AUTO_INCREMENT,
      source_system VARCHAR(64) NOT NULL,
      source_content_item_id BIGINT NOT NULL,
      source_submission_id CHAR(36) NULL,
      source_manifest_hash CHAR(64) NULL,
      content_type ENUM('place','event') NOT NULL,
      status ENUM('draft','pending_review','needs_revision','published') NOT NULL DEFAULT 'draft',
      lang VARCHAR(8) NOT NULL DEFAULT 'th',
      category VARCHAR(64) NULL,
      title VARCHAR(255) NOT NULL,
      body LONGTEXT NOT NULL,
      excerpt TEXT NULL,
      meta_title VARCHAR(255) NULL,
      meta_description VARCHAR(320) NULL,
      event_period_text TEXT NULL,
      location_text TEXT NULL,
      latitude DECIMAL(10,7) NULL,
      longitude DECIMAL(10,7) NULL,
      map_url VARCHAR(1200) NULL,
      google_place_id VARCHAR(255) NULL,
      transport_subtype VARCHAR(64) NULL,
      transport_contact_name VARCHAR(255) NULL,
      transport_contact_phone VARCHAR(120) NULL,
      transport_contact_details TEXT NULL,
      transport_link_url VARCHAR(1200) NULL,
      slug VARCHAR(255) NULL,
      slug_locked TINYINT(1) NOT NULL DEFAULT 0,
      public_entity_type ENUM('place','event') NULL,
      public_entity_id BIGINT NULL,
      current_batch_uid CHAR(36) NOT NULL,
      review_payload_json LONGTEXT NULL,
      published_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_review_contents_source (source_system, source_content_item_id, content_type),
      KEY idx_review_contents_status (status, updated_at),
      KEY idx_review_contents_public_entity (public_entity_type, public_entity_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_content_assets (
      id BIGINT NOT NULL AUTO_INCREMENT,
      review_content_id BIGINT NOT NULL,
      batch_uid CHAR(36) NOT NULL,
      usage_type ENUM('cover','gallery','inline') NOT NULL,
      position INT NOT NULL DEFAULT 0,
      source_url VARCHAR(1200) NOT NULL,
      resolved_source_url VARCHAR(1200) NULL,
      backend_url VARCHAR(1200) NOT NULL,
      storage_disk ENUM('local') NOT NULL DEFAULT 'local',
      storage_path VARCHAR(1200) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NULL,
      size_bytes BIGINT NULL,
      checksum CHAR(64) NULL,
      caption VARCHAR(255) NULL,
      source_asset_id BIGINT NULL,
      source_submission_id CHAR(36) NULL,
      status ENUM('review_ready','published','deleted') NOT NULL DEFAULT 'review_ready',
      asset_origin ENUM('collector_import') NOT NULL DEFAULT 'collector_import',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_review_content_assets_batch (review_content_id, batch_uid),
      KEY idx_review_content_assets_status (status),
      KEY idx_review_content_assets_checksum (checksum),
      CONSTRAINT fk_review_content_assets_content FOREIGN KEY (review_content_id) REFERENCES review_contents(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_actions (
      id BIGINT NOT NULL AUTO_INCREMENT,
      review_content_id BIGINT NOT NULL,
      batch_uid CHAR(36) NOT NULL,
      action_type ENUM('ingested','approved','needs_revision','rejected','reingested') NOT NULL,
      previous_status VARCHAR(32) NULL,
      next_status VARCHAR(32) NULL,
      actor_user_id BIGINT NULL,
      review_note TEXT NULL,
      payload_snapshot_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_review_actions_content (review_content_id, created_at),
      KEY idx_review_actions_batch (batch_uid),
      CONSTRAINT fk_review_actions_content FOREIGN KEY (review_content_id) REFERENCES review_contents(id) ON DELETE CASCADE
    )
  `);

  const [statusColumnRows] = await pool.query("SHOW COLUMNS FROM review_contents LIKE 'status'");
  const statusColumnType = String(statusColumnRows?.[0]?.Type || "").toLowerCase();
  const reviewStatusHasNeedsRevision = statusColumnType.includes("'needs_revision'");
  const reviewStatusHasRejected = statusColumnType.includes("'rejected'");
  if (!reviewStatusHasNeedsRevision || !reviewStatusHasRejected) {
    await pool.query(
      "ALTER TABLE review_contents MODIFY COLUMN status ENUM('draft','pending_review','needs_revision','rejected','published') NOT NULL DEFAULT 'draft'"
    );
  }

  const [actionTypeColumnRows] = await pool.query("SHOW COLUMNS FROM review_actions LIKE 'action_type'");
  const actionTypeColumnType = String(actionTypeColumnRows?.[0]?.Type || "").toLowerCase();
  const reviewActionHasNeedsRevision = actionTypeColumnType.includes("'needs_revision'");
  const reviewActionHasRejected = actionTypeColumnType.includes("'rejected'");
  if (!reviewActionHasNeedsRevision || !reviewActionHasRejected) {
    await pool.query(
      "ALTER TABLE review_actions MODIFY COLUMN action_type ENUM('ingested','approved','needs_revision','rejected','reingested') NOT NULL"
    );
  }

  const reviewContentColumnRepairs = [
    {
      name: "source_submission_id",
      alterSql: "ALTER TABLE review_contents ADD COLUMN source_submission_id CHAR(36) NULL AFTER source_content_item_id",
    },
    {
      name: "source_manifest_hash",
      alterSql: "ALTER TABLE review_contents ADD COLUMN source_manifest_hash CHAR(64) NULL AFTER source_submission_id",
    },
    {
      name: "phone",
      alterSql: "ALTER TABLE review_contents ADD COLUMN phone VARCHAR(120) NULL AFTER transport_contact_phone",
    },
    {
      name: "line_url",
      alterSql: "ALTER TABLE review_contents ADD COLUMN line_url VARCHAR(1200) NULL AFTER phone",
    },
    {
      name: "facebook_url",
      alterSql: "ALTER TABLE review_contents ADD COLUMN facebook_url VARCHAR(1200) NULL AFTER line_url",
    },
    {
      name: "website_url",
      alterSql: "ALTER TABLE review_contents ADD COLUMN website_url VARCHAR(1200) NULL AFTER facebook_url",
    },
    {
      name: "primary_cta",
      alterSql: "ALTER TABLE review_contents ADD COLUMN primary_cta ENUM('map','phone','line') NULL AFTER website_url",
    },
    {
      name: "tracking_entity_type",
      alterSql: "ALTER TABLE review_contents ADD COLUMN tracking_entity_type ENUM('place','event','review_content') NULL AFTER primary_cta",
    },
    {
      name: "tracking_entity_id",
      alterSql: "ALTER TABLE review_contents ADD COLUMN tracking_entity_id BIGINT NULL AFTER tracking_entity_type",
    },
  ];

  for (const repair of reviewContentColumnRepairs) {
    const [rows] = await pool.query("SHOW COLUMNS FROM review_contents LIKE ?", [repair.name]);
    if (!Array.isArray(rows) || !rows.length) {
      await pool.query(repair.alterSql);
    }
  }

  const reviewAssetColumnRepairs = [
    { name: "caption", alterSql: "ALTER TABLE review_content_assets ADD COLUMN caption VARCHAR(255) NULL AFTER checksum" },
    { name: "source_asset_id", alterSql: "ALTER TABLE review_content_assets ADD COLUMN source_asset_id BIGINT NULL AFTER caption" },
    { name: "source_submission_id", alterSql: "ALTER TABLE review_content_assets ADD COLUMN source_submission_id CHAR(36) NULL AFTER source_asset_id" },
  ];
  for (const repair of reviewAssetColumnRepairs) {
    const [rows] = await pool.query("SHOW COLUMNS FROM review_content_assets LIKE ?", [repair.name]);
    if (!Array.isArray(rows) || !rows.length) {
      await pool.query(repair.alterSql);
    }
  }
}

function parseJsonText(raw, fallback) {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewritePublicReviewBodyMedia(html, entries = []) {
  let output = String(html || "");
  if (!output || !Array.isArray(entries) || !entries.length) return output;
  for (const entry of entries) {
    const backendUrl = String(entry?.url || "").trim();
    const sourceUrl = String(entry?.source_url || "").trim();
    const fileName = String(entry?.file_name || "").trim();
    if (!backendUrl) continue;
    if (sourceUrl) {
      output = output.replace(new RegExp(escapeRegExp(sourceUrl), "g"), backendUrl);
    }
    if (fileName) {
      output = output.replace(
        new RegExp(`https?:\\/\\/[^"'\\s>]+\\/(?:media\\/)?uploads\\/${escapeRegExp(fileName)}`, "g"),
        backendUrl
      );
    }
  }
  return output;
}

export function shapePublicReviewContent(item) {
  if (!item || typeof item !== "object") return item;
  const assets = item?.assets && typeof item.assets === "object" ? item.assets : { cover: null, gallery: [], inline: [] };
  const assetEntries = [
    assets?.cover,
    ...(Array.isArray(assets?.gallery) ? assets.gallery : []),
    ...(Array.isArray(assets?.inline) ? assets.inline : []),
  ].filter(Boolean);
  const rewrittenBody = rewritePublicReviewBodyMedia(item?.body, assetEntries);
  const scrubEntry = (entry) => {
    if (!entry || typeof entry !== "object") return null;
    return {
      url: String(entry.url || "").trim(),
      storage_path: String(entry.storage_path || "").trim(),
      file_name: String(entry.file_name || "").trim(),
      mime_type: entry.mime_type || null,
      size_bytes: entry.size_bytes == null ? null : Number(entry.size_bytes || 0) || null,
    };
  };
  const publicAssets = {
    cover: scrubEntry(assets?.cover),
    gallery: (Array.isArray(assets?.gallery) ? assets.gallery : []).map(scrubEntry).filter(Boolean),
    inline: (Array.isArray(assets?.inline) ? assets.inline : []).map(scrubEntry).filter(Boolean),
  };
  return {
    ...item,
    body: rewrittenBody,
    description: rewrittenBody,
    assets: publicAssets,
    image: publicAssets.cover?.url || item?.image || null,
    effective_cover_image: publicAssets.cover?.url || item?.effective_cover_image || null,
    media_gallery_images: publicAssets.gallery.map((entry) => entry.url).filter(Boolean),
    media_inline_images: publicAssets.inline.map((entry) => entry.url).filter(Boolean),
    review_payload: undefined,
    history: undefined,
  };
}

// Admin/editor session only (never the public review-access token — frontend/PROJECT_POLICY.md forbids
// Work Return internals reaching the public site). Adds the resolved taxonomy Curation signal
// admin/PROJECT_POLICY.md explicitly allows admin to review, on top of the same scrubbed public shape.
export function shapeAdminReviewContent(item) {
  const shaped = shapePublicReviewContent(item);
  if (!shaped || typeof shaped !== "object") return shaped;
  const confirmedTaxonomyChecks = item?.review_payload?.confirmed_taxonomy_checks;
  return {
    ...shaped,
    confirmed_taxonomy_checks: confirmedTaxonomyChecks && typeof confirmedTaxonomyChecks === "object" && !Array.isArray(confirmedTaxonomyChecks)
      ? confirmedTaxonomyChecks
      : {},
  };
}

export async function getReviewContentById(id) {
  const reviewId = Number(id);
  if (!Number.isFinite(reviewId) || reviewId <= 0) return null;

  const [rows] = await pool.query("SELECT * FROM review_contents WHERE id=? LIMIT 1", [reviewId]);
  if (!rows.length) return null;
  const row = rows[0];

  const [assetRows] = await pool.query(
    `SELECT usage_type, position, backend_url, source_url, storage_path, file_name, mime_type, size_bytes
     FROM review_content_assets
     WHERE review_content_id=? AND batch_uid=? AND status IN ('review_ready','published')
     ORDER BY usage_type ASC, position ASC, id ASC`,
    [reviewId, row.current_batch_uid]
  );
  const [actionRows] = await pool.query(
    `SELECT id, batch_uid, action_type, previous_status, next_status, actor_user_id, review_note, payload_snapshot_json, created_at
     FROM review_actions WHERE review_content_id=? ORDER BY created_at DESC, id DESC`,
    [reviewId]
  );

  const assets = { cover: null, gallery: [], inline: [] };
  for (const asset of assetRows) {
    const entry = {
      url: String(asset.backend_url || "").trim(),
      source_url: String(asset.source_url || "").trim(),
      storage_path: String(asset.storage_path || "").trim(),
      file_name: String(asset.file_name || "").trim(),
      mime_type: asset.mime_type || null,
      size_bytes: asset.size_bytes == null ? null : Number(asset.size_bytes || 0) || null,
    };
    const usage = String(asset.usage_type || "").trim().toLowerCase();
    if (usage === "cover" && !assets.cover) assets.cover = entry;
    if (usage === "gallery") assets.gallery.push(entry);
    if (usage === "inline") assets.inline.push(entry);
  }

  return {
    id: Number(row.id || 0),
    source_system: String(row.source_system || "").trim().toLowerCase(),
    source_content_item_id: Number(row.source_content_item_id || 0) || 0,
    content_type: String(row.content_type || "").trim().toLowerCase(),
    status: String(row.status || "").trim().toLowerCase(),
    lang: String(row.lang || "th").trim().toLowerCase(),
    category: row.category || null,
    title: row.title || "",
    body: row.body || "",
    excerpt: row.excerpt || null,
    meta_title: row.meta_title || null,
    meta_description: row.meta_description || null,
    event_period_text: row.event_period_text || null,
    location_text: row.location_text || null,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    map_url: row.map_url || null,
    google_place_id: row.google_place_id || null,
    transport_subtype: row.transport_subtype || null,
    transport_contact_name: row.transport_contact_name || null,
    transport_contact_phone: row.transport_contact_phone || null,
    phone: row.phone || null,
    line_url: row.line_url || null,
    facebook_url: row.facebook_url || null,
    website_url: row.website_url || null,
    primary_cta: row.primary_cta || null,
    tracking_entity_type: row.tracking_entity_type || null,
    tracking_entity_id: row.tracking_entity_id == null ? null : Number(row.tracking_entity_id || 0) || null,
    transport_contact_details: row.transport_contact_details || null,
    transport_link_url: row.transport_link_url || null,
    slug: row.slug || null,
    slug_locked: Number(row.slug_locked || 0) === 1,
    public_entity_type: row.public_entity_type || null,
    public_entity_id: row.public_entity_id == null ? null : Number(row.public_entity_id || 0) || null,
    current_batch_uid: String(row.current_batch_uid || "").trim(),
    review_payload: parseJsonText(row.review_payload_json, {}),
    published_at: row.published_at || null,
    assets,
    description: row.body || "",
    image: assets.cover?.url || null,
    effective_cover_image: assets.cover?.url || null,
    media_gallery_images: assets.gallery.map((entry) => entry.url).filter(Boolean),
    media_inline_images: assets.inline.map((entry) => entry.url).filter(Boolean),
    history: (Array.isArray(actionRows) ? actionRows : []).map((entry) => ({
      id: Number(entry.id || 0) || 0,
      batch_uid: String(entry.batch_uid || "").trim(),
      action_type: String(entry.action_type || "").trim().toLowerCase(),
      previous_status: entry.previous_status ? String(entry.previous_status || "").trim().toLowerCase() : null,
      next_status: entry.next_status ? String(entry.next_status || "").trim().toLowerCase() : null,
      actor_user_id: entry.actor_user_id == null ? null : Number(entry.actor_user_id || 0) || null,
      review_note: entry.review_note == null ? null : String(entry.review_note || ""),
      payload_snapshot: parseJsonText(entry.payload_snapshot_json, null),
      created_at: entry.created_at || null,
    })),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export async function appendReviewAction({
  reviewContentId,
  batchUid,
  actionType,
  previousStatus = null,
  nextStatus = null,
  actorUserId = null,
  reviewNote = null,
  payloadSnapshot = null,
  executor = pool,
}) {
  const snapshotJson = payloadSnapshot == null ? null : JSON.stringify(payloadSnapshot);
  await executor.query(
    `INSERT INTO review_actions
      (review_content_id, batch_uid, action_type, previous_status, next_status, actor_user_id, review_note, payload_snapshot_json)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      Number(reviewContentId),
      String(batchUid || "").trim(),
      String(actionType || "").trim().toLowerCase(),
      previousStatus ? String(previousStatus).trim().toLowerCase() : null,
      nextStatus ? String(nextStatus).trim().toLowerCase() : null,
      actorUserId == null ? null : Number(actorUserId) || null,
      reviewNote == null ? null : String(reviewNote || "").trim() || null,
      snapshotJson,
    ]
  );
}
