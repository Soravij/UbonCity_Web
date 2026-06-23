import crypto from "crypto";
import pool from "../config/db.js";
import { appendReviewAction } from "./reviewContentService.js";
import { cleanupReviewAssetFilesBestEffort, cleanupUnpublishedBatchAssets } from "./reviewCleanupService.js";
import { cleanupPublishedMediaFilesBestEffort, replaceEntityMediaWithReviewBatch } from "./publishedMediaService.js";
import {
  getCollectorImportReviewById,
  markCollectorImportReviewApprovedBySource,
  rejectCollectorImportReviewBySource,
} from "./collectorImportReviewService.js";
import { assertBackendIntegrationReadiness } from "./integrationReadinessService.js";
import { assertNoEmerConflictForPublish } from "./publishGuardService.js";
import { isKnownTaxonomyCatalogKey } from "../../collector/server/taxonomy-catalog.mjs";

const CURATED_TAXONOMY_LEGACY_KEYS = new Set(["category", "subtype", "tags"]);
let ensuredCuratedTaxonomyColumn = false;

function slugify(input) {
  const base = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "item";
}

function isPlaceholderPlaceSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return slug === "item" || /^item-\d+$/.test(slug);
}

function buildFallbackPlaceSlug(content) {
  const publicEntityId = Number(content?.public_entity_id || 0) || 0;
  const sourceContentItemId = Number(content?.source_content_item_id || 0) || 0;
  const idSeed = publicEntityId || sourceContentItemId;
  return idSeed ? `place-${idSeed}` : "place";
}

function selectPreferredPlaceSlug(content, requestedSlug, existingSlug) {
  const requested = String(requestedSlug || "").trim();
  if (requested && !isPlaceholderPlaceSlug(requested)) return requested;
  const existing = String(existingSlug || "").trim();
  if (existing && !isPlaceholderPlaceSlug(existing)) return existing;
  const fromTitle = slugify(content?.title);
  if (!isPlaceholderPlaceSlug(fromTitle)) return fromTitle;
  return buildFallbackPlaceSlug(content);
}

function buildApproveWarnings(content) {
  const warnings = [];
  const mapUrl = String(content?.map_url || "").trim();
  const phone = String(content?.phone || "").trim();
  const transportContactPhone = String(content?.transport_contact_phone || "").trim();
  const hasPhoneCta = Boolean(phone || transportContactPhone);
  const lineUrl = String(content?.line_url || "").trim();
  const primaryCta = String(content?.primary_cta || "").trim().toLowerCase();
  if (!mapUrl && !hasPhoneCta && !lineUrl) {
    warnings.push({ code: "CTA_EMPTY", message: "No CTA data (map_url/phone/line_url) in review content" });
  }
  if (primaryCta && !["map", "phone", "line"].includes(primaryCta)) {
    warnings.push({ code: "PRIMARY_CTA_INVALID", message: "primary_cta is not in supported set" });
  }
  if (primaryCta === "map" && !mapUrl) warnings.push({ code: "PRIMARY_CTA_MAP_MISSING", message: "primary_cta=map but map_url is empty" });
  if (primaryCta === "phone" && !hasPhoneCta) warnings.push({ code: "PRIMARY_CTA_PHONE_MISSING", message: "primary_cta=phone but phone is empty" });
  if (primaryCta === "line" && !lineUrl) warnings.push({ code: "PRIMARY_CTA_LINE_MISSING", message: "primary_cta=line but line_url is empty" });
  return warnings;
}

function applyPublishedMediaUrlRewrites(input, rewrites = []) {
  let output = String(input || "");
  if (!output) return output;
  for (const rewrite of Array.isArray(rewrites) ? rewrites : []) {
    const from = String(rewrite?.from || "").trim();
    const to = String(rewrite?.to || "").trim();
    if (!from || !to || from === to) continue;
    output = output.split(from).join(to);
  }
  return output;
}

function parseJsonMaybe(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function cloneJsonValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeCuratedTaxonomyKey(key) {
  return String(key || "").trim().toLowerCase();
}

function normalizeCuratedTaxonomyObject(taxonomyValue) {
  const parsed = parseJsonMaybe(taxonomyValue);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;

  const curated = {};
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    const key = normalizeCuratedTaxonomyKey(rawKey);
    if (!key || key.startsWith("custom.")) continue;
    if (!isKnownTaxonomyCatalogKey(key) && !CURATED_TAXONOMY_LEGACY_KEYS.has(key)) continue;
    if (rawValue === undefined) continue;
    curated[key] = cloneJsonValue(rawValue);
  }

  return Object.keys(curated).length ? curated : null;
}

export function extractCuratedTaxonomyFromReviewSnapshot(snapshotValue) {
  const snapshot = parseJsonMaybe(snapshotValue);
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== "object") return null;

  const confirmedTaxonomySource = Object.prototype.hasOwnProperty.call(snapshot, "confirmed_taxonomy_json")
    ? snapshot.confirmed_taxonomy_json
    : snapshot;
  return normalizeCuratedTaxonomyObject(confirmedTaxonomySource);
}

export function mapReviewContentCtaFieldsToPlaceRecord(content = {}) {
  return {
    phone: content.phone ?? null,
    line_url: content.line_url ?? null,
    facebook_url: content.facebook_url ?? null,
    website_url: content.website_url ?? null,
    primary_cta: content.primary_cta ?? null,
    tracking_entity_type: content.tracking_entity_type ?? null,
    tracking_entity_id: content.tracking_entity_id ?? null,
  };
}

async function ensureCuratedTaxonomyColumn() {
  if (ensuredCuratedTaxonomyColumn) return;
  const [columns] = await pool.query("SHOW COLUMNS FROM places LIKE 'curated_taxonomy_json'");
  if (!columns.length) {
    await pool.query("ALTER TABLE places ADD COLUMN curated_taxonomy_json LONGTEXT NULL");
  }
  ensuredCuratedTaxonomyColumn = true;
}

async function ensureUniquePlaceSlug(connection, initialSlug, excludePlaceId = null) {
  const base = slugify(initialSlug);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const [rows] = await connection.query("SELECT id FROM places WHERE slug=? LIMIT 1", [candidate]);
    if (!rows.length) return candidate;
    const matchedId = Number(rows[0]?.id || 0) || null;
    if (excludePlaceId && matchedId === Number(excludePlaceId)) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

async function upsertPublishedPlace(connection, content, slug) {
  const [existingRows] = await connection.query(
    "SELECT id, slug, curated_taxonomy_json FROM places WHERE id=? LIMIT 1",
    [content.public_entity_id || 0]
  );
  const categorySlug = String(content.category || "attractions").trim().toLowerCase() || "attractions";
  const [catRows] = await connection.query("SELECT id FROM categories WHERE slug=? LIMIT 1", [categorySlug]);
  const categoryId = catRows.length ? Number(catRows[0].id || 0) || null : null;
  if (!categoryId) throw new Error(`category not found: ${categorySlug}`);

  let placeId = null;
  let resolvedSlug = null;
  const placeCtaFields = mapReviewContentCtaFieldsToPlaceRecord(content);
  const curatedTaxonomyJson = extractCuratedTaxonomyFromReviewSnapshot(content.handoff_snapshot_json);
  const curatedTaxonomyPayload = curatedTaxonomyJson == null ? null : JSON.stringify(curatedTaxonomyJson);
  if (existingRows.length) {
    placeId = Number(existingRows[0].id || 0) || null;
    const existingSlug = String(existingRows[0].slug || "").trim() || null;
    const existingCuratedTaxonomyPayload = existingRows[0].curated_taxonomy_json == null
      ? null
      : existingRows[0].curated_taxonomy_json;
    resolvedSlug = selectPreferredPlaceSlug(content, slug, existingSlug);
    resolvedSlug = await ensureUniquePlaceSlug(connection, resolvedSlug, placeId);
    await connection.query(
      `UPDATE places
       SET category_id=?, slug=?, is_approved=1,
           latitude=?, longitude=?, map_url=?, google_place_id=?, transport_subtype=?,
           transport_contact_name=?, transport_contact_phone=?, phone=?, line_url=?, facebook_url=?, website_url=?, primary_cta=?, tracking_entity_type=?, tracking_entity_id=?,
           transport_contact_details=?, transport_link_url=?, curated_taxonomy_json=?
       WHERE id=?`,
      [
        categoryId,
        resolvedSlug,
        content.latitude,
        content.longitude,
        content.map_url,
        content.google_place_id,
        content.transport_subtype,
        content.transport_contact_name,
        content.transport_contact_phone,
        placeCtaFields.phone,
        placeCtaFields.line_url,
        placeCtaFields.facebook_url,
        placeCtaFields.website_url,
        placeCtaFields.primary_cta,
        placeCtaFields.tracking_entity_type,
        placeCtaFields.tracking_entity_id,
        content.transport_contact_details,
        content.transport_link_url,
        curatedTaxonomyPayload ?? existingCuratedTaxonomyPayload,
        placeId,
      ]
    );
  } else {
    resolvedSlug = selectPreferredPlaceSlug(content, slug, null);
    resolvedSlug = await ensureUniquePlaceSlug(connection, resolvedSlug);
    const [insertResult] = await connection.query(
      `INSERT INTO places (
        category_id, slug, image, is_approved, latitude, longitude, map_url, google_place_id,
        transport_subtype, transport_contact_name, transport_contact_phone, phone, line_url, facebook_url, website_url, primary_cta, tracking_entity_type, tracking_entity_id,
        transport_contact_details, transport_link_url, curated_taxonomy_json
      ) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        categoryId,
        resolvedSlug,
        "",
        content.latitude,
        content.longitude,
        content.map_url,
        content.google_place_id,
        content.transport_subtype,
        content.transport_contact_name,
        content.transport_contact_phone,
        placeCtaFields.phone,
        placeCtaFields.line_url,
        placeCtaFields.facebook_url,
        placeCtaFields.website_url,
        placeCtaFields.primary_cta,
        placeCtaFields.tracking_entity_type,
        placeCtaFields.tracking_entity_id,
        content.transport_contact_details,
        content.transport_link_url,
        curatedTaxonomyPayload,
      ]
    );
    placeId = Number(insertResult.insertId || 0) || null;
  }

  await connection.query(
    `INSERT INTO place_translations (place_id, lang, title, description, meta_title, meta_description)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description), meta_title=VALUES(meta_title), meta_description=VALUES(meta_description)`,
    [placeId, content.lang || "th", content.title, content.body, content.meta_title, content.meta_description]
  );
  return { placeId, slug: resolvedSlug };
}

async function upsertPublishedEvent(connection, content) {
  const [existingRows] = await connection.query(
    "SELECT id FROM events WHERE id=? LIMIT 1",
    [content.public_entity_id || 0]
  );
  let eventId = null;
  if (existingRows.length) {
    eventId = Number(existingRows[0].id || 0) || null;
    await connection.query(
      `UPDATE events
       SET title=?, description=?, event_period_text=?, location_text=?, map_url=?, is_approved=1, approved_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [content.title, null, content.event_period_text, content.location_text, content.map_url, eventId]
    );
  } else {
    const [insertResult] = await connection.query(
      `INSERT INTO events (title, description, image, event_period_text, location_text, map_url, is_approved, approved_at)
       VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP)`,
      [content.title, null, "", content.event_period_text, content.location_text, content.map_url]
    );
    eventId = Number(insertResult.insertId || 0) || null;
  }

  await connection.query(
    `INSERT INTO event_translations (event_id, lang, title, description, meta_title, meta_description)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description), meta_title=VALUES(meta_title), meta_description=VALUES(meta_description)`,
    [eventId, content.lang || "th", content.title, content.body, content.meta_title, content.meta_description]
  );

  return eventId;
}

async function updateEntityPublishedImages(connection, contentType, entityId, coverUrl, thumbnailUrl) {
  if (contentType === "place") {
    await connection.query(
      "UPDATE places SET image=?, decision_cover_image=?, decision_thumbnail_image=? WHERE id=?",
      [coverUrl || null, coverUrl || null, thumbnailUrl || coverUrl || null, Number(entityId)]
    );
    return;
  }
  if (contentType === "event") {
    await connection.query(
      "UPDATE events SET image=?, decision_cover_image=?, decision_thumbnail_image=? WHERE id=?",
      [coverUrl || null, coverUrl || null, thumbnailUrl || coverUrl || null, Number(entityId)]
    );
  }
}

async function rewritePublishedEntityContent(connection, content, entityId, mediaResult) {
  const rewrittenBody = applyPublishedMediaUrlRewrites(content?.body, mediaResult?.url_rewrites);

  if (content.content_type === "place") {
    const [translations] = await connection.query(
      "SELECT lang, description FROM place_translations WHERE place_id=?",
      [Number(entityId)]
    );
    for (const row of Array.isArray(translations) ? translations : []) {
      const nextDescription = applyPublishedMediaUrlRewrites(row?.description, mediaResult?.url_rewrites);
      if (nextDescription === String(row?.description || "")) continue;
      await connection.query(
        `UPDATE place_translations
         SET description=?
         WHERE place_id=? AND lang=?`,
        [nextDescription, Number(entityId), row.lang]
      );
    }
    return;
  }

  if (content.content_type === "event") {
    await connection.query("UPDATE events SET description=? WHERE id=?", [rewrittenBody, Number(entityId)]);
    const [translations] = await connection.query(
      "SELECT lang, description FROM event_translations WHERE event_id=?",
      [Number(entityId)]
    );
    for (const row of Array.isArray(translations) ? translations : []) {
      const nextDescription = applyPublishedMediaUrlRewrites(row?.description, mediaResult?.url_rewrites);
      if (nextDescription === String(row?.description || "")) continue;
      await connection.query(
        `UPDATE event_translations
         SET description=?
         WHERE event_id=? AND lang=?`,
        [nextDescription, Number(entityId), row.lang]
      );
    }
  }
}

export async function approveReviewContent({ reviewContent, actorUserId, reviewNote = null }) {
  await ensureCuratedTaxonomyColumn();
  const connection = await pool.getConnection();
  let mediaCleanupFilePaths = [];
  let promotedFilePaths = [];
  let result = null;
  try {
    await connection.beginTransaction();
    const [freshRows] = await connection.query("SELECT * FROM review_contents WHERE id=? LIMIT 1 FOR UPDATE", [reviewContent.id]);
    if (!freshRows.length) throw new Error("review content not found");
    const content = freshRows[0];
    if (String(content.status || "").toLowerCase() === "published") throw new Error("already published");

    let slug = String(content.slug || "").trim() || null;
    let publicEntityId = null;
    const contentType = String(content.content_type || "").trim().toLowerCase();
    const approveWarnings = buildApproveWarnings(content);
    if (contentType === "place") {
      await assertNoEmerConflictForPublish({
        entityType: "place",
        category: String(content.category || "attractions").trim().toLowerCase(),
        slug,
        title: String(content.title || "").trim(),
        excludeEntityId: Number(content.public_entity_id || 0) || null,
        executor: connection,
      });
    } else {
      await assertNoEmerConflictForPublish({
        entityType: "event",
        title: String(content.title || "").trim(),
        excludeEntityId: Number(content.public_entity_id || 0) || null,
        executor: connection,
      });
    }
    if (contentType === "place") {
      const placeResult = await upsertPublishedPlace(connection, content, slug);
      publicEntityId = placeResult.placeId;
      slug = placeResult.slug || null;
    } else {
      publicEntityId = await upsertPublishedEvent(connection, content);
    }

    const mediaResult = await replaceEntityMediaWithReviewBatch(connection, {
      entityType: contentType,
      entityId: publicEntityId,
      reviewContentId: reviewContent.id,
      batchUid: content.current_batch_uid,
      actorUserId,
    });
    mediaCleanupFilePaths = Array.isArray(mediaResult?.cleanup_file_paths) ? mediaResult.cleanup_file_paths : [];
    promotedFilePaths = Array.isArray(mediaResult?.promoted_file_paths) ? mediaResult.promoted_file_paths : [];
    await updateEntityPublishedImages(connection, contentType, publicEntityId, mediaResult.cover_url, mediaResult.thumbnail_url);
    await rewritePublishedEntityContent(connection, content, publicEntityId, mediaResult);

    await connection.query(
      `UPDATE review_contents
       SET status='published', slug=?, slug_locked=?, public_entity_type=?, public_entity_id=?, published_at=NOW(), updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [slug, slug ? 1 : 0, contentType, publicEntityId, reviewContent.id]
    );

    await connection.query(
      `UPDATE review_content_assets
       SET status='published', updated_at=CURRENT_TIMESTAMP
       WHERE review_content_id=? AND batch_uid=? AND status='review_ready'`,
      [reviewContent.id, content.current_batch_uid]
    );

    await appendReviewAction({
      reviewContentId: reviewContent.id,
      batchUid: content.current_batch_uid,
      actionType: "approved",
      previousStatus: content.status,
      nextStatus: "published",
      actorUserId,
      reviewNote,
      payloadSnapshot: { slug, public_entity_id: publicEntityId, public_entity_type: contentType, warnings: approveWarnings },
      executor: connection,
    });

    await markCollectorImportReviewApprovedBySource({
      sourceSystem: content.source_system,
      sourceContentType: contentType,
      sourceContentItemId: content.source_content_item_id,
      reviewedByUserId: actorUserId,
      reviewNote,
      executor: connection,
    });

    await connection.commit();
    result = {
      id: reviewContent.id,
      status: "published",
      slug,
      public_entity_type: contentType,
      public_entity_id: publicEntityId,
      warnings: approveWarnings,
    };
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
    await cleanupPublishedMediaFilesBestEffort(promotedFilePaths);
    throw err;
  } finally {
    connection.release();
  }
  await cleanupPublishedMediaFilesBestEffort(mediaCleanupFilePaths);
  return result;
}

async function syncNeedsRevisionToCollector(reviewContent, reviewNote, actorUserId) {
  assertBackendIntegrationReadiness(["review_feedback_to_collector"]);
  const collectorBase = String(process.env.COLLECTOR_SYNC_BASE_URL || "").trim().replace(/\/+$/, "");
  const syncToken = String(process.env.COLLECTOR_REVIEW_SYNC_TOKEN || "").trim();

  const response = await fetch(`${collectorBase}/api/web-review-feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-review-sync-token": syncToken,
    },
    body: JSON.stringify({
      source_system: reviewContent.source_system,
      source_content_item_id: reviewContent.source_content_item_id,
      content_type: reviewContent.content_type,
      status: "needs_revision",
      review_note: reviewNote || null,
      reviewed_by: actorUserId || null,
      reviewed_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`collector sync failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return true;
}

async function syncNeedsRevisionToCollectorBySource({
  sourceSystem,
  sourceContentItemId,
  contentType,
  reviewNote,
  actorUserId,
}) {
  return syncNeedsRevisionToCollector(
    {
      source_system: sourceSystem,
      source_content_item_id: sourceContentItemId,
      content_type: contentType,
    },
    reviewNote,
    actorUserId
  );
}

export async function markLegacyNeedsRevisionFromQueue({
  reviewId,
  actorUserId,
  reviewNote = null,
}) {
  const queueReviewId = Number(reviewId || 0) || 0;
  if (!queueReviewId) throw new Error("invalid review id");
  const queueItem = await getCollectorImportReviewById(queueReviewId);
  if (!queueItem) throw new Error("review queue item not found");
  if (String(queueItem.review_status || "").trim().toLowerCase() !== "pending") {
    throw new Error("review queue item is not pending");
  }

  const sourceSystem = String(queueItem.source_system || "").trim().toLowerCase();
  const sourceContentItemId = Number(queueItem.source_content_item_id || 0) || 0;
  const contentType = String(queueItem.source_content_type || "").trim().toLowerCase();
  if (!sourceSystem || !sourceContentItemId || (contentType !== "place" && contentType !== "event")) {
    throw new Error("invalid review queue source identity");
  }

  const connection = await pool.getConnection();
  const assetCleanupFilePaths = [];
  try {
    await connection.beginTransaction();
    await syncNeedsRevisionToCollectorBySource({
      sourceSystem,
      sourceContentItemId,
      contentType,
      reviewNote,
      actorUserId,
    });

    const [reviewRows] = await connection.query(
      `SELECT id, status, current_batch_uid
       FROM review_contents
       WHERE source_system=? AND source_content_item_id=? AND content_type=?
       ORDER BY id DESC`,
      [sourceSystem, sourceContentItemId, contentType]
    );
    for (const row of Array.isArray(reviewRows) ? reviewRows : []) {
      const reviewContentId = Number(row?.id || 0) || 0;
      const previousStatus = String(row?.status || "").trim().toLowerCase() || null;
      const currentBatchUid = String(row?.current_batch_uid || "").trim();
      const actionBatchUid = currentBatchUid || crypto.randomUUID();
      if (!reviewContentId) continue;

      if (currentBatchUid) {
        const filePaths = await cleanupUnpublishedBatchAssets(reviewContentId, currentBatchUid, connection);
        assetCleanupFilePaths.push(...(Array.isArray(filePaths) ? filePaths : []));
      }
      await connection.query(
        "UPDATE review_contents SET status='needs_revision', updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [reviewContentId]
      );
      await appendReviewAction({
        reviewContentId,
        batchUid: actionBatchUid,
        actionType: "needs_revision",
        previousStatus,
        nextStatus: "needs_revision",
        actorUserId,
        reviewNote,
        payloadSnapshot: {
          source_system: sourceSystem,
          source_content_item_id: sourceContentItemId,
          content_type: contentType,
          fallback: "legacy_queue_needs_revision",
        },
        executor: connection,
      });
    }

    const rejected = await rejectCollectorImportReviewBySource({
      sourceSystem,
      sourceContentType: contentType,
      sourceContentItemId,
      reviewedByUserId: actorUserId,
      actionTypeOverride: "needs_revision",
      reviewNote: reviewNote || "[legacy_needs_revision_fallback]",
      executor: connection,
    });
    if (!rejected) {
      throw new Error("failed to update queue item status");
    }

    await connection.commit();
    await cleanupReviewAssetFilesBestEffort(assetCleanupFilePaths);
    return { id: queueReviewId, status: "rejected", fallback: true };
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
    throw err;
  } finally {
    connection.release();
  }
}

export async function markNeedsRevision({ reviewContent, actorUserId, reviewNote = null }) {
  const connection = await pool.getConnection();
  let assetCleanupFilePaths = [];
  try {
    await connection.beginTransaction();
    const [freshRows] = await connection.query("SELECT * FROM review_contents WHERE id=? LIMIT 1 FOR UPDATE", [reviewContent.id]);
    if (!freshRows.length) throw new Error("review content not found");
    const content = freshRows[0];
    if (String(content.status || "").toLowerCase() === "published") {
      throw new Error("cannot mark published item as needs_revision");
    }

    await syncNeedsRevisionToCollector(content, reviewNote, actorUserId);
    assetCleanupFilePaths = await cleanupUnpublishedBatchAssets(content.id, content.current_batch_uid, connection);
    await connection.query(
      "UPDATE review_contents SET status='needs_revision', updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [content.id]
    );
    await appendReviewAction({
      reviewContentId: content.id,
      batchUid: content.current_batch_uid,
      actionType: "needs_revision",
      previousStatus: content.status,
      nextStatus: "needs_revision",
      actorUserId,
      reviewNote,
      payloadSnapshot: { source_content_item_id: content.source_content_item_id },
      executor: connection,
    });
    await rejectCollectorImportReviewBySource({
      sourceSystem: content.source_system,
      sourceContentType: content.content_type,
      sourceContentItemId: content.source_content_item_id,
      reviewedByUserId: actorUserId,
      actionTypeOverride: "needs_revision",
      reviewNote,
      executor: connection,
    });
    await connection.commit();
    await cleanupReviewAssetFilesBestEffort(assetCleanupFilePaths);
    return { id: content.id, status: "needs_revision", collector_sync: { ok: true } };
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
    throw err;
  } finally {
    connection.release();
  }
}

export async function markRejected({ reviewContent, actorUserId, reviewNote = null }) {
  const connection = await pool.getConnection();
  let assetCleanupFilePaths = [];
  try {
    await connection.beginTransaction();
    const [freshRows] = await connection.query("SELECT * FROM review_contents WHERE id=? LIMIT 1 FOR UPDATE", [reviewContent.id]);
    if (!freshRows.length) throw new Error("review content not found");
    const content = freshRows[0];
    if (String(content.status || "").toLowerCase() === "published") {
      throw new Error("cannot reject published item");
    }

    assetCleanupFilePaths = await cleanupUnpublishedBatchAssets(content.id, content.current_batch_uid, connection);
    await connection.query(
      "UPDATE review_contents SET status='rejected', updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [content.id]
    );
    await appendReviewAction({
      reviewContentId: content.id,
      batchUid: content.current_batch_uid,
      actionType: "rejected",
      previousStatus: content.status,
      nextStatus: "rejected",
      actorUserId,
      reviewNote,
      payloadSnapshot: { source_content_item_id: content.source_content_item_id, terminal: true },
      executor: connection,
    });
    await rejectCollectorImportReviewBySource({
      sourceSystem: content.source_system,
      sourceContentType: content.content_type,
      sourceContentItemId: content.source_content_item_id,
      reviewedByUserId: actorUserId,
      reviewNote,
      executor: connection,
    });
    await connection.commit();
    await cleanupReviewAssetFilesBestEffort(assetCleanupFilePaths);
    return { id: content.id, status: "rejected" };
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
    throw err;
  } finally {
    connection.release();
  }
}

export async function markLegacyRejectedFromQueue({
  reviewId,
  actorUserId,
  reviewNote = null,
}) {
  const queueReviewId = Number(reviewId || 0) || 0;
  if (!queueReviewId) throw new Error("invalid review id");
  const queueItem = await getCollectorImportReviewById(queueReviewId);
  if (!queueItem) throw new Error("review queue item not found");
  if (String(queueItem.review_status || "").trim().toLowerCase() !== "pending") {
    throw new Error("review queue item is not pending");
  }

  const sourceSystem = String(queueItem.source_system || "").trim().toLowerCase();
  const sourceContentItemId = Number(queueItem.source_content_item_id || 0) || 0;
  const contentType = String(queueItem.source_content_type || "").trim().toLowerCase();
  if (!sourceSystem || !sourceContentItemId || (contentType !== "place" && contentType !== "event")) {
    throw new Error("invalid review queue source identity");
  }

  const connection = await pool.getConnection();
  const assetCleanupFilePaths = [];
  try {
    await connection.beginTransaction();
    const [reviewRows] = await connection.query(
      `SELECT id, status, current_batch_uid
       FROM review_contents
       WHERE source_system=? AND source_content_item_id=? AND content_type=?
       ORDER BY id DESC`,
      [sourceSystem, sourceContentItemId, contentType]
    );

    for (const row of Array.isArray(reviewRows) ? reviewRows : []) {
      const reviewContentId = Number(row?.id || 0) || 0;
      const previousStatus = String(row?.status || "").trim().toLowerCase() || null;
      const currentBatchUid = String(row?.current_batch_uid || "").trim();
      const actionBatchUid = currentBatchUid || crypto.randomUUID();
      if (!reviewContentId) continue;

      if (currentBatchUid) {
        const filePaths = await cleanupUnpublishedBatchAssets(reviewContentId, currentBatchUid, connection);
        assetCleanupFilePaths.push(...(Array.isArray(filePaths) ? filePaths : []));
      }
      await connection.query(
        "UPDATE review_contents SET status='rejected', updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [reviewContentId]
      );
      await appendReviewAction({
        reviewContentId,
        batchUid: actionBatchUid,
        actionType: "rejected",
        previousStatus,
        nextStatus: "rejected",
        actorUserId,
        reviewNote,
        payloadSnapshot: {
          source_system: sourceSystem,
          source_content_item_id: sourceContentItemId,
          content_type: contentType,
          fallback: "legacy_queue_reject",
          terminal: true,
        },
        executor: connection,
      });
    }

    const rejected = await rejectCollectorImportReviewBySource({
      sourceSystem,
      sourceContentType: contentType,
      sourceContentItemId,
      reviewedByUserId: actorUserId,
      actionTypeOverride: "rejected",
      reviewNote: reviewNote || "[legacy_reject_fallback]",
      executor: connection,
    });
    if (!rejected) {
      throw new Error("failed to update queue item status");
    }

    await connection.commit();
    await cleanupReviewAssetFilesBestEffort(assetCleanupFilePaths);
    return { id: queueReviewId, status: "rejected", fallback: true };
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
    throw err;
  } finally {
    connection.release();
  }
}
