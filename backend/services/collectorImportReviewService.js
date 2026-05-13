import crypto from "crypto";
import pool from "../config/db.js";
import { getReviewContentById } from "./reviewContentService.js";

const REVIEW_STATUS_VALUES = new Set(["pending", "approved", "rejected"]);
const SOURCE_TYPE_VALUES = new Set(["place", "event"]);

function normalizeReviewStatus(value, fallback = "pending") {
  const normalized = String(value || "").trim().toLowerCase();
  return REVIEW_STATUS_VALUES.has(normalized) ? normalized : fallback;
}

function normalizeSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SOURCE_TYPE_VALUES.has(normalized) ? normalized : "";
}

function normalizeReviewContentStatusToQueueStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "published") return "approved";
  if (normalized === "rejected" || normalized === "needs_revision") return "rejected";
  if (normalized === "pending_review") return "pending";
  return "";
}

function toDbDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return iso.slice(0, 19).replace("T", " ");
}

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function normalizeReviewNote(value) {
  const note = String(value || "").trim();
  if (!note) return null;
  return note.slice(0, 2000);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function computePayloadHash(article, translations) {
  const payload = {
    article: {
      source_content_item_id: Number(article?.source_content_item_id || 0) || 0,
      type: String(article?.type || "").trim().toLowerCase(),
      category: String(article?.category || "").trim().toLowerCase(),
      source_lang: String(article?.source_lang || "").trim().toLowerCase(),
      slug: String(article?.slug || "").trim(),
      title: String(article?.title || "").trim(),
      excerpt: article?.excerpt == null ? null : String(article.excerpt),
      body: String(article?.body || ""),
      meta_title: article?.meta_title == null ? null : String(article.meta_title),
      meta_description: article?.meta_description == null ? null : String(article.meta_description),
      event_period_text: article?.event_period_text == null ? null : String(article.event_period_text),
      location_text: article?.location_text == null ? null : String(article.location_text),
      latitude: article?.latitude == null ? null : Number(article.latitude),
      longitude: article?.longitude == null ? null : Number(article.longitude),
      map_url: article?.map_url == null ? null : String(article.map_url),
      google_place_id: article?.google_place_id == null ? null : String(article.google_place_id),
      transport_subtype: article?.transport_subtype == null ? null : String(article.transport_subtype),
      transport_contact_name: article?.transport_contact_name == null ? null : String(article.transport_contact_name),
      transport_contact_phone: article?.transport_contact_phone == null ? null : String(article.transport_contact_phone),
      transport_contact_details: article?.transport_contact_details == null ? null : String(article.transport_contact_details),
      transport_link_url: article?.transport_link_url == null ? null : String(article.transport_link_url),
      image: article?.image == null ? null : String(article.image),
      media_manifest: article?.media_manifest ?? null,
      published_at: String(article?.published_at || "").trim(),
    },
    translations: (Array.isArray(translations) ? translations : [])
      .map((row) => ({
        source_content_item_id: Number(row?.source_content_item_id || 0) || 0,
        lang: String(row?.lang || "").trim().toLowerCase(),
        title: row?.title == null ? null : String(row.title),
        excerpt: row?.excerpt == null ? null : String(row.excerpt),
        body: row?.body == null ? null : String(row.body),
        meta_title: row?.meta_title == null ? null : String(row.meta_title),
        meta_description: row?.meta_description == null ? null : String(row.meta_description),
      }))
      .sort((left, right) => {
        const byLang = String(left.lang || "").localeCompare(String(right.lang || ""));
        if (byLang !== 0) return byLang;
        return Number(left.source_content_item_id || 0) - Number(right.source_content_item_id || 0);
      }),
  };
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function normalizeTranslationLangs(translations) {
  const langs = Array.from(
    new Set(
      (Array.isArray(translations) ? translations : [])
        .map((row) => String(row?.lang || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  langs.sort((left, right) => left.localeCompare(right));
  return langs;
}

function normalizeArticleSnapshot(article) {
  if (!article || typeof article !== "object") return null;
  return {
    category: String(article?.category || "").trim() || null,
    slug: String(article?.slug || "").trim() || null,
    title: String(article?.title || "").trim() || null,
    description:
      article?.description != null
        ? String(article.description)
        : article?.body == null
          ? null
          : String(article.body),
    source_base_url: String(article?.source_base_url || "").trim() || null,
    excerpt: article?.excerpt == null ? null : String(article.excerpt),
    meta_title: article?.meta_title == null ? null : String(article.meta_title),
    meta_description: article?.meta_description == null ? null : String(article.meta_description),
    event_period_text: article?.event_period_text == null ? null : String(article.event_period_text),
    location_text: article?.location_text == null ? null : String(article.location_text),
    latitude: article?.latitude == null ? null : Number(article.latitude),
    longitude: article?.longitude == null ? null : Number(article.longitude),
    map_url: article?.map_url == null ? null : String(article.map_url),
    google_place_id: article?.google_place_id == null ? null : String(article.google_place_id),
    transport_subtype: article?.transport_subtype == null ? null : String(article.transport_subtype),
    transport_contact_name: article?.transport_contact_name == null ? null : String(article.transport_contact_name),
    transport_contact_phone: article?.transport_contact_phone == null ? null : String(article.transport_contact_phone),
    transport_contact_details: article?.transport_contact_details == null ? null : String(article.transport_contact_details),
    transport_link_url: article?.transport_link_url == null ? null : String(article.transport_link_url),
    image: String(article?.image || "").trim() || null,
    media_manifest: article?.media_manifest ?? null,
  };
}

function normalizeTranslationsSnapshot(translations) {
  return (Array.isArray(translations) ? translations : [])
    .map((row) => ({
      lang: String(row?.lang || "").trim().toLowerCase() || null,
      source_content_item_id: toPositiveInt(row?.source_content_item_id),
      title: row?.title == null ? null : String(row.title),
      description: row?.body == null ? null : String(row.body),
      meta_title: row?.meta_title == null ? null : String(row.meta_title),
      meta_description: row?.meta_description == null ? null : String(row.meta_description),
    }))
    .filter((row) => row.lang);
}

function parseJsonText(rawValue, fallbackValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return fallbackValue;
  try {
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function normalizeImageValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  let normalizedPath = text.replace(/\/media\/uploads\//i, "/uploads/");

  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath.replace(/\/\/media\/uploads\//i, "/uploads/");
  }

  const configuredBase = String(process.env.BACKEND_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!configuredBase) return normalizedPath;

  if (normalizedPath.startsWith("/")) return `${configuredBase}${normalizedPath}`;
  if (normalizedPath.startsWith("uploads/")) return `${configuredBase}/${normalizedPath}`;

  return normalizedPath;
}

function resolveReviewCoverImage(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeImageValue(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function mapReviewRow(row) {
  if (!row) return null;
  const articleSnapshot = normalizeArticleSnapshot(parseJsonText(row.article_snapshot_json, null));
  const translationsSnapshot = normalizeTranslationsSnapshot(parseJsonText(row.translations_snapshot_json, []));
  const decisionCoverImage = normalizeImageValue(row.decision_cover_image);
  const mediaCoverImage = normalizeImageValue(row.media_cover_image);
  const effectiveCoverImage = resolveReviewCoverImage(
    articleSnapshot?.image,
    decisionCoverImage,
    mediaCoverImage,
    row.image
  );

  return {
    id: Number(row.id || 0) || 0,
    source_system: String(row.source_system || "").trim().toLowerCase() || null,
    source_content_type: String(row.source_content_type || "").trim().toLowerCase() || null,
    source_content_item_id: Number(row.source_content_item_id || 0) || null,
    local_entity_type: String(row.local_entity_type || "").trim().toLowerCase() || null,
    local_entity_id: Number(row.local_entity_id || 0) || null,
    payload_hash: String(row.payload_hash || "").trim() || null,
    published_at: row.published_at || null,
    imported_at: row.imported_at || null,
    translation_count: Number(row.translation_count || 0) || 0,
    translation_langs: (() => {
      try {
        const parsed = JSON.parse(String(row.translation_langs_json || "[]"));
        return Array.isArray(parsed)
          ? parsed.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
          : [];
      } catch {
        return [];
      }
    })(),
    review_status: normalizeReviewStatus(row.review_status, "pending"),
    reviewed_by_user_id: row.reviewed_by_user_id == null ? null : Number(row.reviewed_by_user_id || 0) || null,
    reviewed_at: row.reviewed_at || null,
    review_note: row.review_note == null ? null : String(row.review_note || "") || null,
    review_content_id: Number(row.review_content_id || 0) || null,
    review_content_status: row.review_content_status ? String(row.review_content_status || "").trim().toLowerCase() : null,
    review_content_updated_at: row.review_content_updated_at || null,
    review_content_public_entity_id: Number(row.review_content_public_entity_id || 0) || null,
    review_content_public_entity_type: row.review_content_public_entity_type
      ? String(row.review_content_public_entity_type || "").trim().toLowerCase()
      : null,
    article_snapshot: articleSnapshot,
    translations_snapshot: translationsSnapshot,
    decision_cover_image: decisionCoverImage,
    media_cover_image: mediaCoverImage,
    effective_cover_image: effectiveCoverImage,
    image: effectiveCoverImage,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function loadLinkedReviewContentBySource(sourceSystem, sourceContentType, sourceContentItemId) {
  const normalizedSourceSystem = String(sourceSystem || "").trim().toLowerCase();
  const normalizedSourceType = normalizeSourceType(sourceContentType);
  const normalizedSourceItemId = toPositiveInt(sourceContentItemId);
  if (!normalizedSourceSystem || !normalizedSourceType || !normalizedSourceItemId) return null;

  const [rows] = await pool.query(
    `SELECT id, status, updated_at, public_entity_id, public_entity_type
     FROM review_contents
     WHERE source_system=? AND source_content_item_id=? AND content_type=?
     LIMIT 1`,
    [normalizedSourceSystem, normalizedSourceItemId, normalizedSourceType]
  );
  const row = rows.length ? rows[0] : null;
  if (!row) return null;

  return {
    review_content_id: Number(row.id || 0) || null,
    review_content_status: row.status ? String(row.status || "").trim().toLowerCase() : null,
    review_content_updated_at: row.updated_at || null,
    review_content_public_entity_id: Number(row.public_entity_id || 0) || null,
    review_content_public_entity_type: row.public_entity_type ? String(row.public_entity_type || "").trim().toLowerCase() : null,
  };
}

export async function ensureCollectorImportReviewTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS collector_import_reviews (
      id BIGINT NOT NULL AUTO_INCREMENT,
      source_system VARCHAR(64) NOT NULL,
      source_content_type VARCHAR(32) NOT NULL,
      source_content_item_id BIGINT NOT NULL,
      local_entity_type VARCHAR(32) NOT NULL,
      local_entity_id BIGINT NOT NULL,
      payload_hash CHAR(64) NOT NULL,
      article_snapshot_json LONGTEXT NULL,
      translations_snapshot_json LONGTEXT NULL,
      published_at DATETIME NULL,
      imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      translation_count INT NOT NULL DEFAULT 0,
      translation_langs_json TEXT NULL,
      review_status VARCHAR(16) NOT NULL DEFAULT 'pending',
      reviewed_by_user_id BIGINT NULL,
      reviewed_at DATETIME NULL,
      review_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_collector_import_source (source_system, source_content_type, source_content_item_id),
      KEY idx_collector_import_review_status (review_status, imported_at),
      KEY idx_collector_import_local_entity (local_entity_type, local_entity_id)
    )
  `);

  const [articleSnapshotCol] = await pool.query("SHOW COLUMNS FROM collector_import_reviews LIKE 'article_snapshot_json'");
  if (!Array.isArray(articleSnapshotCol) || !articleSnapshotCol.length) {
    await pool.query("ALTER TABLE collector_import_reviews ADD COLUMN article_snapshot_json LONGTEXT NULL AFTER payload_hash");
  }

  const [translationsSnapshotCol] = await pool.query("SHOW COLUMNS FROM collector_import_reviews LIKE 'translations_snapshot_json'");
  if (!Array.isArray(translationsSnapshotCol) || !translationsSnapshotCol.length) {
    await pool.query("ALTER TABLE collector_import_reviews ADD COLUMN translations_snapshot_json LONGTEXT NULL AFTER article_snapshot_json");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS collector_import_review_actions (
      id BIGINT NOT NULL AUTO_INCREMENT,
      review_id BIGINT NOT NULL,
      action_type VARCHAR(32) NOT NULL,
      previous_status VARCHAR(16) NULL,
      next_status VARCHAR(16) NULL,
      actor_user_id BIGINT NULL,
      review_note TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_collector_review_actions_review_id (review_id, created_at)
    )
  `);
}

async function appendCollectorImportReviewAction({
  reviewId,
  actionType,
  previousStatus = null,
  nextStatus = null,
  actorUserId = null,
  reviewNote = null,
  executor = pool,
}) {
  const normalizedReviewId = toPositiveInt(reviewId);
  const normalizedActorId = toPositiveInt(actorUserId);
  const normalizedActionType = String(actionType || "").trim().toLowerCase();
  if (!normalizedReviewId || !normalizedActionType) return 0;

  const [result] = await executor.query(
    `INSERT INTO collector_import_review_actions
      (review_id, action_type, previous_status, next_status, actor_user_id, review_note)
     VALUES (?,?,?,?,?,?)`,
    [
      normalizedReviewId,
      normalizedActionType,
      previousStatus ? normalizeReviewStatus(previousStatus, previousStatus) : null,
      nextStatus ? normalizeReviewStatus(nextStatus, nextStatus) : null,
      normalizedActorId,
      normalizeReviewNote(reviewNote),
    ]
  );
  return Number(result?.insertId || 0) || 0;
}

export async function upsertCollectorImportReviewFromImport({
  sourceSystem,
  sourceContentType,
  sourceContentItemId,
  localEntityType,
  localEntityId,
  publishedAt,
  article,
  translations,
}) {
  const normalizedSourceType = normalizeSourceType(sourceContentType);
  const normalizedLocalType = normalizeSourceType(localEntityType);
  const sourceItemId = toPositiveInt(sourceContentItemId);
  const localId = toPositiveInt(localEntityId);

  if (!sourceSystem || !normalizedSourceType || !normalizedLocalType || !sourceItemId || !localId) {
    throw new Error("invalid collector import review identity");
  }

  const payloadHash = computePayloadHash(article, translations);
  const translationLangs = normalizeTranslationLangs(translations);
  const translationCount = translationLangs.length;
  const publishedAtDb = toDbDateTime(publishedAt);
  const translationLangsJson = JSON.stringify(translationLangs);
  const articleSnapshotJson = JSON.stringify(normalizeArticleSnapshot(article));
  const translationsSnapshotJson = JSON.stringify(normalizeTranslationsSnapshot(translations));

  const [existingRows] = await pool.query(
    `SELECT id, payload_hash, review_status
     FROM collector_import_reviews
     WHERE source_system=? AND source_content_type=? AND source_content_item_id=?
     LIMIT 1`,
    [sourceSystem, normalizedSourceType, sourceItemId]
  );

  const existing = existingRows.length ? existingRows[0] : null;
  const existingHash = String(existing?.payload_hash || "").trim().toLowerCase();
  const hashChanged = !existing || existingHash !== payloadHash;
  const shouldResetReviewState = hashChanged;

  const nextReviewStatus = shouldResetReviewState
    ? "pending"
    : normalizeReviewStatus(existing?.review_status, "pending");

  await pool.query(
    `INSERT INTO collector_import_reviews
      (source_system, source_content_type, source_content_item_id, local_entity_type, local_entity_id, payload_hash, article_snapshot_json, translations_snapshot_json, published_at, imported_at, translation_count, translation_langs_json, review_status, reviewed_by_user_id, reviewed_at, review_note)
     VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,NULL,NULL,NULL)
     ON DUPLICATE KEY UPDATE
      local_entity_type=VALUES(local_entity_type),
      local_entity_id=VALUES(local_entity_id),
      payload_hash=VALUES(payload_hash),
      article_snapshot_json=VALUES(article_snapshot_json),
      translations_snapshot_json=VALUES(translations_snapshot_json),
      published_at=VALUES(published_at),
      imported_at=CURRENT_TIMESTAMP,
      translation_count=VALUES(translation_count),
      translation_langs_json=VALUES(translation_langs_json),
      review_status=VALUES(review_status),
      reviewed_by_user_id=CASE WHEN VALUES(review_status)='pending' THEN NULL ELSE reviewed_by_user_id END,
      reviewed_at=CASE WHEN VALUES(review_status)='pending' THEN NULL ELSE reviewed_at END,
      review_note=CASE WHEN VALUES(review_status)='pending' THEN NULL ELSE review_note END`,
    [
      sourceSystem,
      normalizedSourceType,
      sourceItemId,
      normalizedLocalType,
      localId,
      payloadHash,
      articleSnapshotJson,
      translationsSnapshotJson,
      publishedAtDb,
      translationCount,
      translationLangsJson,
      nextReviewStatus,
    ]
  );

  const [savedRows] = await pool.query(
    `SELECT id
     FROM collector_import_reviews
     WHERE source_system=? AND source_content_type=? AND source_content_item_id=?
     LIMIT 1`,
    [sourceSystem, normalizedSourceType, sourceItemId]
  );
  const savedReviewId = savedRows.length ? toPositiveInt(savedRows[0]?.id) : null;
  if (savedReviewId) {
    if (!existing) {
      await appendCollectorImportReviewAction({
        reviewId: savedReviewId,
        actionType: "imported",
        previousStatus: null,
        nextStatus: nextReviewStatus,
        executor: pool,
      });
    } else if (shouldResetReviewState) {
      await appendCollectorImportReviewAction({
        reviewId: savedReviewId,
        actionType: "reimported",
        previousStatus: existing.review_status,
        nextStatus: nextReviewStatus,
        executor: pool,
      });
    }
  }

  return {
    id: savedReviewId,
    created: !existing,
    hash_changed: hashChanged,
    review_reset: shouldResetReviewState && !!existing,
    previous_review_status: existing ? normalizeReviewStatus(existing.review_status, "pending") : null,
    review_status: nextReviewStatus,
  };
}

export async function upsertCollectorImportReviewQueueOnly({
  sourceSystem,
  sourceContentType,
  sourceContentItemId,
  sourceBaseUrl = null,
  articleSnapshot,
  translationsSnapshot,
  translationLangs,
  publishedAt = null,
}) {
  const normalizedSourceSystem = String(sourceSystem || "").trim().toLowerCase();
  const normalizedSourceType = normalizeSourceType(sourceContentType);
  const sourceItemId = toPositiveInt(sourceContentItemId);
  if (!normalizedSourceSystem || !normalizedSourceType || !sourceItemId) {
    throw new Error("invalid collector import review queue identity");
  }

  const article = normalizeArticleSnapshot({
    ...(articleSnapshot && typeof articleSnapshot === "object" ? articleSnapshot : {}),
    source_base_url: sourceBaseUrl,
  });
  const translationsFromSnapshot = normalizeTranslationsSnapshot(translationsSnapshot || []);
  const normalizedLangs = Array.from(
    new Set(
      (Array.isArray(translationLangs) ? translationLangs : [])
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  const effectiveLangs = normalizedLangs.length ? normalizedLangs : normalizeTranslationLangs(translationsFromSnapshot);
  const translationCount = effectiveLangs.length;
  const payloadHash = computePayloadHash(
    {
      source_content_item_id: sourceItemId,
      type: normalizedSourceType,
      category: article?.category || (normalizedSourceType === "event" ? "event" : "attractions"),
      source_lang: "th",
      slug: article?.slug || "",
      title: article?.title || "",
      excerpt: article?.excerpt,
      body: article?.description || "",
      meta_title: article?.meta_title,
      meta_description: article?.meta_description,
      event_period_text: article?.event_period_text,
      location_text: article?.location_text,
      latitude: article?.latitude,
      longitude: article?.longitude,
      map_url: article?.map_url,
      google_place_id: article?.google_place_id,
      image: article?.image,
      media_manifest: article?.media_manifest,
      published_at: publishedAt,
    },
    translationsFromSnapshot.map((row) => ({
      source_content_item_id: sourceItemId,
      lang: row.lang,
      title: row.title,
      excerpt: null,
      body: row.description,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
    }))
  );

  const articleSnapshotJson = JSON.stringify(article);
  const translationsSnapshotJson = JSON.stringify(translationsFromSnapshot);
  const translationLangsJson = JSON.stringify(effectiveLangs);
  const publishedAtDb = toDbDateTime(publishedAt);

  const [existingRows] = await pool.query(
    `SELECT id, payload_hash, review_status
     FROM collector_import_reviews
     WHERE source_system=? AND source_content_type=? AND source_content_item_id=?
     LIMIT 1`,
    [normalizedSourceSystem, normalizedSourceType, sourceItemId]
  );
  const existing = existingRows.length ? existingRows[0] : null;
  const existingHash = String(existing?.payload_hash || "").trim().toLowerCase();
  const hashChanged = !existing || existingHash !== payloadHash;
  const nextReviewStatus = hashChanged ? "pending" : normalizeReviewStatus(existing?.review_status, "pending");

  await pool.query(
    `INSERT INTO collector_import_reviews
      (source_system, source_content_type, source_content_item_id, local_entity_type, local_entity_id, payload_hash, article_snapshot_json, translations_snapshot_json, published_at, imported_at, translation_count, translation_langs_json, review_status, reviewed_by_user_id, reviewed_at, review_note)
     VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,NULL,NULL,NULL)
     ON DUPLICATE KEY UPDATE
      local_entity_type=VALUES(local_entity_type),
      local_entity_id=VALUES(local_entity_id),
      payload_hash=VALUES(payload_hash),
      article_snapshot_json=VALUES(article_snapshot_json),
      translations_snapshot_json=VALUES(translations_snapshot_json),
      published_at=VALUES(published_at),
      imported_at=CURRENT_TIMESTAMP,
      translation_count=VALUES(translation_count),
      translation_langs_json=VALUES(translation_langs_json),
      review_status=VALUES(review_status),
      reviewed_by_user_id=CASE WHEN VALUES(review_status)='pending' THEN NULL ELSE reviewed_by_user_id END,
      reviewed_at=CASE WHEN VALUES(review_status)='pending' THEN NULL ELSE reviewed_at END,
      review_note=CASE WHEN VALUES(review_status)='pending' THEN NULL ELSE review_note END`,
    [
      normalizedSourceSystem,
      normalizedSourceType,
      sourceItemId,
      normalizedSourceType,
      0,
      payloadHash,
      articleSnapshotJson,
      translationsSnapshotJson,
      publishedAtDb,
      translationCount,
      translationLangsJson,
      nextReviewStatus,
    ]
  );

  const [savedRows] = await pool.query(
    `SELECT id
     FROM collector_import_reviews
     WHERE source_system=? AND source_content_type=? AND source_content_item_id=?
     LIMIT 1`,
    [normalizedSourceSystem, normalizedSourceType, sourceItemId]
  );
  const savedReviewId = savedRows.length ? toPositiveInt(savedRows[0]?.id) : null;
  if (savedReviewId) {
    if (!existing) {
      await appendCollectorImportReviewAction({
        reviewId: savedReviewId,
        actionType: "imported",
        previousStatus: null,
        nextStatus: nextReviewStatus,
      });
    } else if (hashChanged) {
      await appendCollectorImportReviewAction({
        reviewId: savedReviewId,
        actionType: "reimported",
        previousStatus: existing.review_status,
        nextStatus: nextReviewStatus,
      });
    }
  }

  return {
    id: savedReviewId,
    created: !existing,
    hash_changed: hashChanged,
    review_reset: hashChanged && !!existing,
    previous_review_status: existing ? normalizeReviewStatus(existing.review_status, "pending") : null,
    review_status: nextReviewStatus,
  };
}

async function updateCollectorImportReviewDecision({
  reviewId = null,
  localEntityType,
  localEntityId,
  reviewedByUserId,
  reviewStatus,
  reviewNote = null,
}) {
  const normalizedStatus = normalizeReviewStatus(reviewStatus, "");
  const normalizedLocalType = normalizeSourceType(localEntityType);
  const localId = toPositiveInt(localEntityId);
  const reviewerId = toPositiveInt(reviewedByUserId);
  const normalizedReviewId = toPositiveInt(reviewId);
  const normalizedNote = normalizeReviewNote(reviewNote);
  if (!normalizedStatus || !normalizedLocalType || !localId || !reviewerId) return 0;

  try {
    await ensureCollectorImportReviewTables();
  } catch (err) {
    const code = String(err?.code || "").toUpperCase();
    if (code === "ER_NO_SUCH_TABLE") return 0;
    throw err;
  }

  let targetReviewId = normalizedReviewId;
  if (!targetReviewId) {
    const [rows] = await pool.query(
      `SELECT id
       FROM collector_import_reviews
       WHERE local_entity_type=? AND local_entity_id=? AND review_status='pending'
       ORDER BY imported_at DESC, id DESC
       LIMIT 1`,
      [normalizedLocalType, localId]
    );
    targetReviewId = rows.length ? toPositiveInt(rows[0]?.id) : null;
  }
  if (!targetReviewId) return 0;

  const [reviewRows] = await pool.query(
    `SELECT review_status
     FROM collector_import_reviews
     WHERE id=? AND local_entity_type=? AND local_entity_id=?
     LIMIT 1`,
    [targetReviewId, normalizedLocalType, localId]
  );
  const previousStatus = reviewRows.length
    ? normalizeReviewStatus(reviewRows[0]?.review_status, "pending")
    : null;

  const [result] = await pool.query(
    `UPDATE collector_import_reviews
     SET review_status=?, reviewed_by_user_id=?, reviewed_at=NOW(), review_note=?
     WHERE id=? AND local_entity_type=? AND local_entity_id=?`,
    [normalizedStatus, reviewerId, normalizedNote, targetReviewId, normalizedLocalType, localId]
  );
  if (Number(result?.affectedRows || 0) > 0) {
    await appendCollectorImportReviewAction({
      reviewId: targetReviewId,
      actionType: normalizedStatus === "approved" ? "approved" : "updated",
      previousStatus,
      nextStatus: normalizedStatus,
      actorUserId: reviewerId,
      reviewNote: normalizedNote,
      executor: pool,
    });
  }
  return Number(result?.affectedRows || 0) || 0;
}

async function updateCollectorImportReviewDecisionBySource({
  sourceSystem,
  sourceContentType,
  sourceContentItemId,
  reviewedByUserId,
  reviewStatus,
  actionTypeOverride = null,
  reviewNote = null,
  executor = pool,
}) {
  const normalizedStatus = normalizeReviewStatus(reviewStatus, "");
  const normalizedSourceType = normalizeSourceType(sourceContentType);
  const normalizedSourceSystem = String(sourceSystem || "").trim().toLowerCase();
  const sourceId = toPositiveInt(sourceContentItemId);
  const reviewerId = toPositiveInt(reviewedByUserId);
  const normalizedNote = normalizeReviewNote(reviewNote);
  if (!normalizedStatus || !normalizedSourceType || !normalizedSourceSystem || !sourceId || !reviewerId) return 0;

  await ensureCollectorImportReviewTables();
  const [existingRows] = await executor.query(
    `SELECT id, review_status
     FROM collector_import_reviews
     WHERE source_system=? AND source_content_type=? AND source_content_item_id=?
     LIMIT 1`,
    [normalizedSourceSystem, normalizedSourceType, sourceId]
  );
  if (!existingRows.length) return 0;

  const reviewId = toPositiveInt(existingRows[0]?.id);
  const previousStatus = normalizeReviewStatus(existingRows[0]?.review_status, "pending");
  const [result] = await executor.query(
    `UPDATE collector_import_reviews
     SET review_status=?, reviewed_by_user_id=?, reviewed_at=NOW(), review_note=?
     WHERE id=?`,
    [normalizedStatus, reviewerId, normalizedNote, reviewId]
  );
  if (Number(result?.affectedRows || 0) > 0) {
    const normalizedActionType = String(actionTypeOverride || "").trim().toLowerCase();
    await appendCollectorImportReviewAction({
      reviewId,
      actionType: normalizedActionType || (normalizedStatus === "approved" ? "approved" : normalizedStatus === "rejected" ? "rejected" : "updated"),
      previousStatus,
      nextStatus: normalizedStatus,
      actorUserId: reviewerId,
      reviewNote: normalizedNote,
      executor,
    });
  }
  return Number(result?.affectedRows || 0) || 0;
}

export async function markCollectorImportReviewApprovedByEntity({
  reviewId = null,
  localEntityType,
  localEntityId,
  reviewedByUserId,
  reviewNote = null,
}) {
  return updateCollectorImportReviewDecision({
    reviewId,
    localEntityType,
    localEntityId,
    reviewedByUserId,
    reviewStatus: "approved",
    reviewNote,
  });
}

export async function markCollectorImportReviewApprovedBySource({
  sourceSystem,
  sourceContentType,
  sourceContentItemId,
  reviewedByUserId,
  reviewNote = null,
  executor = pool,
}) {
  return updateCollectorImportReviewDecisionBySource({
    sourceSystem,
    sourceContentType,
    sourceContentItemId,
    reviewedByUserId,
    reviewStatus: "approved",
    reviewNote,
    executor,
  });
}

export async function rejectCollectorImportReviewById({
  reviewId,
  reviewedByUserId,
  reviewNote = null,
}) {
  const normalizedReviewId = toPositiveInt(reviewId);
  const reviewerId = toPositiveInt(reviewedByUserId);
  const normalizedNote = normalizeReviewNote(reviewNote);
  if (!normalizedReviewId || !reviewerId) return 0;

  try {
    await ensureCollectorImportReviewTables();
  } catch (err) {
    const code = String(err?.code || "").toUpperCase();
    if (code === "ER_NO_SUCH_TABLE") return 0;
    throw err;
  }

  const [existingRows] = await pool.query(
    `SELECT review_status
     FROM collector_import_reviews
     WHERE id=?
     LIMIT 1`,
    [normalizedReviewId]
  );
  const previousStatus = existingRows.length
    ? normalizeReviewStatus(existingRows[0]?.review_status, "pending")
    : null;
  if (previousStatus !== "pending") return 0;

  const [result] = await pool.query(
    `UPDATE collector_import_reviews
     SET review_status='rejected', reviewed_by_user_id=?, reviewed_at=NOW(), review_note=?
     WHERE id=?`,
    [reviewerId, normalizedNote, normalizedReviewId]
  );
  if (Number(result?.affectedRows || 0) > 0) {
    await appendCollectorImportReviewAction({
      reviewId: normalizedReviewId,
      actionType: "rejected",
      previousStatus,
      nextStatus: "rejected",
      actorUserId: reviewerId,
      reviewNote: normalizedNote,
      executor: pool,
    });
  }
  return Number(result?.affectedRows || 0) || 0;
}

export async function rejectCollectorImportReviewBySource({
  sourceSystem,
  sourceContentType,
  sourceContentItemId,
  reviewedByUserId,
  actionTypeOverride = null,
  reviewNote = null,
  executor = pool,
}) {
  return updateCollectorImportReviewDecisionBySource({
    sourceSystem,
    sourceContentType,
    sourceContentItemId,
    reviewedByUserId,
    reviewStatus: "rejected",
    actionTypeOverride,
    reviewNote,
    executor,
  });
}

export async function listCollectorImportReviews({
  reviewStatus = "pending",
  sourceSystem = "collector-app",
  sourceContentType = "all",
  search = "",
  limit = 100,
  offset = 0,
}) {
  const rawStatus = String(reviewStatus || "").trim().toLowerCase();
  const status = rawStatus === "all" ? "all" : normalizeReviewStatus(rawStatus, "pending");
  const normalizedSourceType = sourceContentType === "all" ? "all" : normalizeSourceType(sourceContentType);
  const normalizedSourceSystem = String(sourceSystem || "").trim().toLowerCase();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const baseConditions = [];
  const baseParams = [];

  if (status !== "all") {
    baseConditions.push("cir.review_status=?");
    baseParams.push(status);
  }
  if (normalizedSourceSystem && normalizedSourceSystem !== "all") {
    baseConditions.push("cir.source_system=?");
    baseParams.push(normalizedSourceSystem);
  }
  if (normalizedSourceType && normalizedSourceType !== "all") {
    baseConditions.push("cir.source_content_type=?");
    baseParams.push(normalizedSourceType);
  }
  const normalizedSearch = String(search || "").trim();
  const searchLike = normalizedSearch ? `%${normalizedSearch}%` : "";

  const whereForType = (entityType, titleExpression) => {
    const conditions = [...baseConditions, "cir.local_entity_type=?"];
    const params = [...baseParams, entityType];
    if (searchLike) {
      conditions.push(`(
        CAST(cir.id AS CHAR) LIKE ?
        OR CAST(cir.source_content_item_id AS CHAR) LIKE ?
        OR ${titleExpression} LIKE ?
      )`);
      params.push(searchLike, searchLike, searchLike);
    }
    return {
      sql: `WHERE ${conditions.join(" AND ")}`,
      params,
    };
  };

  const placeWhere = whereForType("place", "COALESCE(pt.title, '')");
  const eventWhere = whereForType("event", "COALESCE(et.title, e.title, '')");

  const prefetchLimit = safeLimit + safeOffset;

  const [rows] = await pool.query(
    `
    SELECT
      cir.*,
      'place' AS entity_kind,
      c.slug AS category,
      COALESCE(pt.title, '') AS title,
      COALESCE(pt.description, '') AS description,
      p.decision_cover_image AS decision_cover_image,
      (
        SELECT
          COALESCE(
            CASE
              WHEN ma.file_name IS NOT NULL AND TRIM(ma.file_name) <> '' THEN CONCAT('/uploads/', ma.file_name)
              WHEN ma.storage_path IS NOT NULL AND TRIM(ma.storage_path) <> '' THEN CONCAT('/', TRIM(LEADING '/' FROM ma.storage_path))
              ELSE NULL
            END
          )
        FROM content_image_usages ciu
        JOIN media_assets ma ON ma.id = ciu.asset_id
        WHERE ciu.entity_type='place'
          AND ciu.entity_id = p.id
          AND ciu.usage_type='cover'
          AND ma.status='approved'
        ORDER BY ciu.position ASC, ciu.id ASC
        LIMIT 1
      ) AS media_cover_image,
      p.image AS image,
      p.is_approved AS is_approved,
      rc.id AS review_content_id,
      rc.status AS review_content_status,
      rc.updated_at AS review_content_updated_at,
      rc.public_entity_id AS review_content_public_entity_id,
      rc.public_entity_type AS review_content_public_entity_type
    FROM collector_import_reviews cir
    LEFT JOIN places p ON p.id = cir.local_entity_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN place_translations pt ON pt.place_id = p.id AND pt.lang='th'
    LEFT JOIN review_contents rc
      ON rc.source_system = cir.source_system
     AND rc.source_content_item_id = cir.source_content_item_id
     AND rc.content_type = cir.source_content_type
    ${placeWhere.sql}

    UNION ALL

    SELECT
      cir.*,
      'event' AS entity_kind,
      'event' AS category,
      COALESCE(et.title, e.title, '') AS title,
      COALESCE(et.description, e.description, '') AS description,
      e.decision_cover_image AS decision_cover_image,
      NULL AS media_cover_image,
      e.image AS image,
      e.is_approved AS is_approved,
      rc.id AS review_content_id,
      rc.status AS review_content_status,
      rc.updated_at AS review_content_updated_at,
      rc.public_entity_id AS review_content_public_entity_id,
      rc.public_entity_type AS review_content_public_entity_type
    FROM collector_import_reviews cir
    LEFT JOIN events e ON e.id = cir.local_entity_id
    LEFT JOIN event_translations et ON et.event_id = e.id AND et.lang='th'
    LEFT JOIN review_contents rc
      ON rc.source_system = cir.source_system
     AND rc.source_content_item_id = cir.source_content_item_id
     AND rc.content_type = cir.source_content_type
    ${eventWhere.sql}

    ORDER BY imported_at DESC, id DESC
    LIMIT ?
    `,
    [...placeWhere.params, ...eventWhere.params, prefetchLimit]
  );
  const queueItems = (Array.isArray(rows) ? rows : []).map((row) => {
    const mapped = mapReviewRow(row);
    return {
      ...mapped,
      category: String(row.category || "").trim() || mapped?.article_snapshot?.category || null,
      title: String(row.title || "").trim() || mapped?.article_snapshot?.title || null,
      description: String(row.description || "").trim() || mapped?.article_snapshot?.description || null,
      is_approved: Number(row.is_approved || 0) === 1 ? 1 : 0,
    };
  });

  const syntheticConditions = [
    "rc.source_system=?",
    "NOT EXISTS (SELECT 1 FROM collector_import_reviews cir WHERE cir.source_system=rc.source_system AND cir.source_content_type=rc.content_type AND cir.source_content_item_id=rc.source_content_item_id)",
  ];
  const syntheticParams = [normalizedSourceSystem || "collector-app"];
  if (normalizedSourceType && normalizedSourceType !== "all") {
    syntheticConditions.push("rc.content_type=?");
    syntheticParams.push(normalizedSourceType);
  }
  const syntheticStatuses = [];
  if (status === "pending") syntheticStatuses.push("pending_review");
  if (status === "approved") syntheticStatuses.push("published");
  if (status === "rejected") syntheticStatuses.push("rejected", "needs_revision");
  if (status === "all") syntheticStatuses.push("pending_review", "published", "rejected", "needs_revision");
  if (syntheticStatuses.length) {
    syntheticConditions.push(`rc.status IN (${syntheticStatuses.map(() => "?").join(",")})`);
    syntheticParams.push(...syntheticStatuses);
  }
  if (searchLike) {
    syntheticConditions.push(`(
      CAST(rc.id AS CHAR) LIKE ?
      OR CAST(rc.source_content_item_id AS CHAR) LIKE ?
      OR COALESCE(rc.title, '') LIKE ?
    )`);
    syntheticParams.push(searchLike, searchLike, searchLike);
  }
  const [syntheticRows] = await pool.query(
    `
    SELECT
      (-rc.id) AS id,
      rc.source_system,
      rc.content_type AS source_content_type,
      rc.source_content_item_id,
      COALESCE(rc.public_entity_type, rc.content_type) AS local_entity_type,
      COALESCE(rc.public_entity_id, 0) AS local_entity_id,
      '' AS payload_hash,
      rc.published_at,
      rc.created_at AS imported_at,
      0 AS translation_count,
      '[]' AS translation_langs_json,
      CASE
        WHEN rc.status='published' THEN 'approved'
        WHEN rc.status IN ('rejected','needs_revision') THEN 'rejected'
        ELSE 'pending'
      END AS review_status,
      NULL AS reviewed_by_user_id,
      NULL AS reviewed_at,
      NULL AS review_note,
      JSON_OBJECT(
        'category', CASE WHEN rc.content_type='event' THEN 'event' ELSE COALESCE(rc.category, '') END,
        'slug', rc.slug,
        'title', rc.title,
        'description', rc.body,
        'excerpt', rc.excerpt,
        'meta_title', rc.meta_title,
        'meta_description', rc.meta_description,
        'event_period_text', rc.event_period_text,
        'location_text', rc.location_text,
        'latitude', rc.latitude,
        'longitude', rc.longitude,
        'map_url', rc.map_url,
        'google_place_id', rc.google_place_id,
        'image', (
          SELECT rca.backend_url
          FROM review_content_assets rca
          WHERE rca.review_content_id=rc.id
            AND rca.batch_uid=rc.current_batch_uid
            AND rca.usage_type='cover'
            AND rca.status IN ('review_ready','published')
          ORDER BY rca.position ASC, rca.id ASC
          LIMIT 1
        )
      ) AS article_snapshot_json,
      '[]' AS translations_snapshot_json,
      NULL AS decision_cover_image,
      (
        SELECT rca.backend_url
        FROM review_content_assets rca
        WHERE rca.review_content_id=rc.id
          AND rca.batch_uid=rc.current_batch_uid
          AND rca.usage_type='cover'
          AND rca.status IN ('review_ready','published')
        ORDER BY rca.position ASC, rca.id ASC
        LIMIT 1
      ) AS media_cover_image,
      (
        SELECT rca.backend_url
        FROM review_content_assets rca
        WHERE rca.review_content_id=rc.id
          AND rca.batch_uid=rc.current_batch_uid
          AND rca.usage_type='cover'
          AND rca.status IN ('review_ready','published')
        ORDER BY rca.position ASC, rca.id ASC
        LIMIT 1
      ) AS image,
      rc.id AS review_content_id,
      rc.status AS review_content_status,
      rc.updated_at AS review_content_updated_at,
      rc.public_entity_id AS review_content_public_entity_id,
      rc.public_entity_type AS review_content_public_entity_type,
      1 AS synthetic_review_source,
      CASE WHEN rc.content_type='event' THEN 'event' ELSE COALESCE(rc.category, '') END AS category,
      rc.title AS title,
      rc.body AS description,
      0 AS is_approved
    FROM review_contents rc
    WHERE ${syntheticConditions.join(" AND ")}
    ORDER BY rc.created_at DESC, rc.id DESC
    LIMIT ?
    `,
    [...syntheticParams, prefetchLimit]
  );
  const syntheticItems = (Array.isArray(syntheticRows) ? syntheticRows : []).map((row) => {
    const mapped = mapReviewRow(row);
    return {
      ...mapped,
      synthetic_review_source: Number(row.synthetic_review_source || 0) === 1,
      category: String(row.category || "").trim() || mapped?.article_snapshot?.category || null,
      title: String(row.title || "").trim() || mapped?.article_snapshot?.title || null,
      description: String(row.description || "").trim() || mapped?.article_snapshot?.description || null,
      is_approved: 0,
    };
  });

  return [...queueItems, ...syntheticItems]
    .sort((left, right) => {
      const lt = Date.parse(String(left?.imported_at || left?.updated_at || left?.created_at || ""));
      const rt = Date.parse(String(right?.imported_at || right?.updated_at || right?.created_at || ""));
      if (Number.isFinite(lt) && Number.isFinite(rt) && lt !== rt) return rt - lt;
      return Math.abs(Number(right?.id || 0)) - Math.abs(Number(left?.id || 0));
    })
    .slice(safeOffset, safeOffset + safeLimit);
}

export async function countCollectorImportReviewsByStatus({
  sourceSystem = "collector-app",
  sourceContentType = "all",
}) {
  const normalizedSourceType = sourceContentType === "all" ? "all" : normalizeSourceType(sourceContentType);
  const normalizedSourceSystem = String(sourceSystem || "").trim().toLowerCase();
  const conditions = [];
  const params = [];

  if (normalizedSourceSystem && normalizedSourceSystem !== "all") {
    conditions.push("source_system=?");
    params.push(normalizedSourceSystem);
  }
  if (normalizedSourceType && normalizedSourceType !== "all") {
    conditions.push("source_content_type=?");
    params.push(normalizedSourceType);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT review_status, COUNT(*) AS total
     FROM collector_import_reviews
     ${whereSql}
     GROUP BY review_status`,
    params
  );

  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    all: 0,
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = normalizeReviewStatus(row?.review_status, "");
    if (!status) continue;
    const total = Number(row?.total || 0) || 0;
    counts[status] = total;
    counts.all += total;
  }

  const reviewContentConditions = [
    "rc.source_system=?",
    "NOT EXISTS (SELECT 1 FROM collector_import_reviews cir WHERE cir.source_system=rc.source_system AND cir.source_content_type=rc.content_type AND cir.source_content_item_id=rc.source_content_item_id)",
  ];
  const reviewContentParams = [normalizedSourceSystem || "collector-app"];
  if (normalizedSourceType && normalizedSourceType !== "all") {
    reviewContentConditions.push("rc.content_type=?");
    reviewContentParams.push(normalizedSourceType);
  }
  const [reviewContentRows] = await pool.query(
    `SELECT rc.status, COUNT(*) AS total
     FROM review_contents rc
     WHERE ${reviewContentConditions.join(" AND ")}
     GROUP BY rc.status`,
    reviewContentParams
  );
  for (const row of Array.isArray(reviewContentRows) ? reviewContentRows : []) {
    const mappedStatus = normalizeReviewContentStatusToQueueStatus(row?.status);
    if (!mappedStatus) continue;
    const total = Number(row?.total || 0) || 0;
    counts[mappedStatus] += total;
    counts.all += total;
  }

  return counts;
}

export async function countCollectorImportReviewsByStatusAndType({
  sourceSystem = "collector-app",
  sourceContentType = "all",
}) {
  const normalizedSourceSystem = String(sourceSystem || "").trim().toLowerCase();
  const normalizedSourceType = sourceContentType === "all" ? "all" : normalizeSourceType(sourceContentType);
  const conditions = [];
  const params = [];

  if (normalizedSourceSystem && normalizedSourceSystem !== "all") {
    conditions.push("source_system=?");
    params.push(normalizedSourceSystem);
  }
  if (normalizedSourceType && normalizedSourceType !== "all") {
    conditions.push("source_content_type=?");
    params.push(normalizedSourceType);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT review_status, source_content_type, COUNT(*) AS total
     FROM collector_import_reviews
     ${whereSql}
     GROUP BY review_status, source_content_type`,
    params
  );

  const counts = {
    pending: { all: 0, place: 0, event: 0 },
    approved: { all: 0, place: 0, event: 0 },
    rejected: { all: 0, place: 0, event: 0 },
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = normalizeReviewStatus(row?.review_status, "");
    const type = normalizeSourceType(row?.source_content_type);
    if (!status || !type) continue;
    const total = Number(row?.total || 0) || 0;
    counts[status][type] = total;
    counts[status].all += total;
  }

  const reviewContentConditions = [
    "rc.source_system=?",
    "NOT EXISTS (SELECT 1 FROM collector_import_reviews cir WHERE cir.source_system=rc.source_system AND cir.source_content_type=rc.content_type AND cir.source_content_item_id=rc.source_content_item_id)",
  ];
  const reviewContentParams = [normalizedSourceSystem || "collector-app"];
  if (normalizedSourceType && normalizedSourceType !== "all") {
    reviewContentConditions.push("rc.content_type=?");
    reviewContentParams.push(normalizedSourceType);
  }
  const [reviewContentRows] = await pool.query(
    `SELECT rc.status, rc.content_type, COUNT(*) AS total
     FROM review_contents rc
     WHERE ${reviewContentConditions.join(" AND ")}
     GROUP BY rc.status, rc.content_type`,
    reviewContentParams
  );
  for (const row of Array.isArray(reviewContentRows) ? reviewContentRows : []) {
    const mappedStatus = normalizeReviewContentStatusToQueueStatus(row?.status);
    const type = normalizeSourceType(row?.content_type);
    if (!mappedStatus || !type) continue;
    const total = Number(row?.total || 0) || 0;
    counts[mappedStatus][type] += total;
    counts[mappedStatus].all += total;
  }

  return counts;
}

async function loadEntitySummary(localEntityType, localEntityId) {
  if (localEntityType === "place") {
    const [rows] = await pool.query(
      `
      SELECT
        p.id,
        c.slug AS category,
        COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
        COALESCE(pt.title, '') AS title,
        COALESCE(pt.description, '') AS description,
        COALESCE(pt.meta_title, NULL) AS meta_title,
        COALESCE(pt.meta_description, NULL) AS meta_description,
        p.decision_cover_image,
        p.image,
        (
          SELECT
            COALESCE(
              CASE
                WHEN ma.file_name IS NOT NULL AND TRIM(ma.file_name) <> '' THEN CONCAT('/uploads/', ma.file_name)
                WHEN ma.storage_path IS NOT NULL AND TRIM(ma.storage_path) <> '' THEN CONCAT('/', TRIM(LEADING '/' FROM ma.storage_path))
                ELSE NULL
              END
            )
          FROM content_image_usages ciu
          JOIN media_assets ma ON ma.id = ciu.asset_id
          WHERE ciu.entity_type='place'
            AND ciu.entity_id = p.id
            AND ciu.usage_type='cover'
            AND ma.status='approved'
          ORDER BY ciu.position ASC, ciu.id ASC
          LIMIT 1
        ) AS media_cover_image,
        p.is_approved
      FROM places p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN place_translations pt ON pt.place_id = p.id AND pt.lang='th'
      WHERE p.id=?
      LIMIT 1
      `,
      [localEntityId]
    );
    const row = rows.length ? rows[0] : null;
    if (!row) return null;
    return {
      category: String(row.category || "").trim() || null,
      slug: String(row.slug || "").trim() || null,
      title: String(row.title || "").trim() || null,
      description: String(row.description || "").trim() || null,
      meta_title: row.meta_title == null ? null : String(row.meta_title || "").trim() || null,
      meta_description: row.meta_description == null ? null : String(row.meta_description || "").trim() || null,
      decision_cover_image: normalizeImageValue(row.decision_cover_image),
      media_cover_image: normalizeImageValue(row.media_cover_image),
      effective_cover_image: resolveReviewCoverImage(row.decision_cover_image, row.media_cover_image, row.image),
      image: resolveReviewCoverImage(row.decision_cover_image, row.media_cover_image, row.image),
      is_approved: Number(row.is_approved || 0) === 1 ? 1 : 0,
    };
  }
  if (localEntityType === "event") {
    const [rows] = await pool.query(
      `
      SELECT
        e.id,
        'event' AS category,
        NULL AS slug,
        COALESCE(et.title, e.title, '') AS title,
        COALESCE(et.description, e.description, '') AS description,
        COALESCE(et.meta_title, NULL) AS meta_title,
        COALESCE(et.meta_description, NULL) AS meta_description,
        e.decision_cover_image,
        e.image,
        e.is_approved
      FROM events e
      LEFT JOIN event_translations et ON et.event_id = e.id AND et.lang='th'
      WHERE e.id=?
      LIMIT 1
      `,
      [localEntityId]
    );
    const row = rows.length ? rows[0] : null;
    if (!row) return null;
    return {
      category: "event",
      slug: null,
      title: String(row.title || "").trim() || null,
      description: String(row.description || "").trim() || null,
      meta_title: row.meta_title == null ? null : String(row.meta_title || "").trim() || null,
      meta_description: row.meta_description == null ? null : String(row.meta_description || "").trim() || null,
      decision_cover_image: normalizeImageValue(row.decision_cover_image),
      media_cover_image: null,
      effective_cover_image: resolveReviewCoverImage(row.decision_cover_image, row.image),
      image: resolveReviewCoverImage(row.decision_cover_image, row.image),
      is_approved: Number(row.is_approved || 0) === 1 ? 1 : 0,
    };
  }
  return null;
}

async function loadReviewHistory(reviewId) {
  const normalizedReviewId = toPositiveInt(reviewId);
  if (!normalizedReviewId) return [];
  const [rows] = await pool.query(
    `SELECT id, action_type, previous_status, next_status, actor_user_id, review_note, created_at
     FROM collector_import_review_actions
     WHERE review_id=?
     ORDER BY created_at DESC, id DESC`,
    [normalizedReviewId]
  );
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: Number(row.id || 0) || 0,
    action_type: String(row.action_type || "").trim().toLowerCase() || null,
    previous_status: row.previous_status ? String(row.previous_status || "").trim().toLowerCase() : null,
    next_status: row.next_status ? String(row.next_status || "").trim().toLowerCase() : null,
    actor_user_id: row.actor_user_id == null ? null : Number(row.actor_user_id || 0) || null,
    review_note: row.review_note == null ? null : String(row.review_note || "") || null,
    created_at: row.created_at || null,
  }));
}

export async function getCollectorImportReviewById(id) {
  const reviewId = toPositiveInt(id);
  if (!reviewId) return null;
  const [rows] = await pool.query(
    "SELECT * FROM collector_import_reviews WHERE id=? LIMIT 1",
    [reviewId]
  );
  const row = rows.length ? rows[0] : null;
  if (!row) {
    const reviewContent = await getReviewContentById(reviewId);
    if (!reviewContent || String(reviewContent?.source_system || "").trim().toLowerCase() !== "collector-app") return null;
    return {
      id: -reviewContent.id,
      review_id: -reviewContent.id,
      source_system: reviewContent.source_system,
      source_content_type: reviewContent.content_type,
      source_content_item_id: reviewContent.source_content_item_id,
      local_entity_type: reviewContent.public_entity_type || reviewContent.content_type,
      local_entity_id: reviewContent.public_entity_id || 0,
      pending_type: reviewContent.content_type,
      payload_hash: null,
      published_at: reviewContent.published_at || null,
      imported_at: reviewContent.created_at || reviewContent.updated_at || null,
      translation_count: Array.isArray(reviewContent?.review_payload?.snapshot_meta?.translation_langs)
        ? reviewContent.review_payload.snapshot_meta.translation_langs.length
        : 0,
      translation_langs: Array.isArray(reviewContent?.review_payload?.snapshot_meta?.translation_langs)
        ? reviewContent.review_payload.snapshot_meta.translation_langs
        : [],
      review_status: normalizeReviewContentStatusToQueueStatus(reviewContent.status) || "pending",
      reviewed_by_user_id: null,
      reviewed_at: null,
      review_note: null,
      review_content_id: reviewContent.id,
      review_content_status: reviewContent.status,
      review_content_updated_at: reviewContent.updated_at || null,
      review_content_public_entity_id: reviewContent.public_entity_id || null,
      review_content_public_entity_type: reviewContent.public_entity_type || null,
      synthetic_review_source: true,
      article_snapshot: {
        category: reviewContent.content_type === "event" ? "event" : reviewContent.category,
        slug: reviewContent.slug,
        title: reviewContent.title,
        description: reviewContent.body,
        excerpt: reviewContent.excerpt,
        meta_title: reviewContent.meta_title,
        meta_description: reviewContent.meta_description,
        event_period_text: reviewContent.event_period_text,
        location_text: reviewContent.location_text,
        latitude: reviewContent.latitude,
        longitude: reviewContent.longitude,
        map_url: reviewContent.map_url,
        google_place_id: reviewContent.google_place_id,
        image: reviewContent.effective_cover_image || reviewContent.image || null,
      },
      translations_snapshot: [],
      category: reviewContent.content_type === "event" ? "event" : reviewContent.category,
      slug: reviewContent.content_type === "event" ? null : reviewContent.slug,
      title: reviewContent.title,
      description: reviewContent.body,
      meta_title: reviewContent.meta_title,
      meta_description: reviewContent.meta_description,
      decision_cover_image: reviewContent.effective_cover_image || null,
      media_cover_image: reviewContent.effective_cover_image || null,
      effective_cover_image: reviewContent.effective_cover_image || null,
      image: reviewContent.effective_cover_image || reviewContent.image || null,
      is_approved: reviewContent.status === "published" ? 1 : 0,
      history: Array.isArray(reviewContent.history) ? reviewContent.history : [],
      created_at: reviewContent.created_at || null,
      updated_at: reviewContent.updated_at || null,
    };
  }
  const mapped = mapReviewRow(row);
  const summary = await loadEntitySummary(mapped.local_entity_type, mapped.local_entity_id);
  const history = await loadReviewHistory(mapped.id);
  const linkedReviewContent = await loadLinkedReviewContentBySource(
    mapped.source_system,
    mapped.source_content_type,
    mapped.source_content_item_id
  );
  const articleSnapshot = mapped.article_snapshot || null;
  const resolvedCategory = articleSnapshot?.category || summary?.category || null;
  const resolvedSlug =
    mapped.local_entity_type === "event"
      ? null
      : articleSnapshot?.slug || summary?.slug || null;
  return {
    ...mapped,
    ...(linkedReviewContent || {}),
    category: resolvedCategory,
    slug: resolvedSlug,
    title: articleSnapshot?.title || summary?.title || null,
    description: articleSnapshot?.description || summary?.description || null,
    meta_title: articleSnapshot?.meta_title || summary?.meta_title || null,
    meta_description: articleSnapshot?.meta_description || summary?.meta_description || null,
    decision_cover_image: resolveReviewCoverImage(
      articleSnapshot?.image,
      mapped.decision_cover_image,
      summary?.decision_cover_image
    ),
    media_cover_image: mapped.media_cover_image || summary?.media_cover_image || null,
    effective_cover_image: resolveReviewCoverImage(
      articleSnapshot?.image,
      mapped.decision_cover_image,
      summary?.decision_cover_image,
      mapped.media_cover_image,
      summary?.media_cover_image,
      summary?.image,
      mapped.image
    ),
    image: resolveReviewCoverImage(
      articleSnapshot?.image,
      mapped.decision_cover_image,
      summary?.decision_cover_image,
      mapped.media_cover_image,
      summary?.media_cover_image,
      summary?.image,
      mapped.image
    ),
    is_approved: summary?.is_approved ?? 0,
    history,
  };
}
