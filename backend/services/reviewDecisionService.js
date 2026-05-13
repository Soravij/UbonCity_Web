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
    "SELECT id, slug FROM places WHERE id=? LIMIT 1",
    [content.public_entity_id || 0]
  );
  const categorySlug = String(content.category || "attractions").trim().toLowerCase() || "attractions";
  const [catRows] = await connection.query("SELECT id FROM categories WHERE slug=? LIMIT 1", [categorySlug]);
  const categoryId = catRows.length ? Number(catRows[0].id || 0) || null : null;
  if (!categoryId) throw new Error(`category not found: ${categorySlug}`);

  let placeId = null;
  let resolvedSlug = null;
  if (existingRows.length) {
    placeId = Number(existingRows[0].id || 0) || null;
    const existingSlug = String(existingRows[0].slug || "").trim() || null;
    resolvedSlug = selectPreferredPlaceSlug(content, slug, existingSlug);
    resolvedSlug = await ensureUniquePlaceSlug(connection, resolvedSlug, placeId);
    await connection.query(
      `UPDATE places
       SET category_id=?, slug=?, is_approved=1,
           latitude=?, longitude=?, map_url=?, google_place_id=?, transport_subtype=?,
           transport_contact_name=?, transport_contact_phone=?, transport_contact_details=?, transport_link_url=?
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
        content.transport_contact_details,
        content.transport_link_url,
        placeId,
      ]
    );
  } else {
    resolvedSlug = selectPreferredPlaceSlug(content, slug, null);
    resolvedSlug = await ensureUniquePlaceSlug(connection, resolvedSlug);
    const [insertResult] = await connection.query(
      `INSERT INTO places (
        category_id, slug, image, is_approved, latitude, longitude, map_url, google_place_id,
        transport_subtype, transport_contact_name, transport_contact_phone, transport_contact_details, transport_link_url
      ) VALUES (?,?,?,1,?,?,?,?,?,?,?, ?,?)`,
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
        content.transport_contact_details,
        content.transport_link_url,
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
      [content.title, content.body, content.event_period_text, content.location_text, content.map_url, eventId]
    );
  } else {
    const [insertResult] = await connection.query(
      `INSERT INTO events (title, description, image, event_period_text, location_text, map_url, is_approved, approved_at)
       VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP)`,
      [content.title, content.body, "", content.event_period_text, content.location_text, content.map_url]
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

export async function approveReviewContent({ reviewContent, actorUserId, reviewNote = null }) {
  const connection = await pool.getConnection();
  let mediaCleanupFilePaths = [];
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
    await updateEntityPublishedImages(connection, contentType, publicEntityId, mediaResult.cover_url, mediaResult.thumbnail_url);

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
      payloadSnapshot: { slug, public_entity_id: publicEntityId, public_entity_type: contentType },
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
    result = { id: reviewContent.id, status: "published", slug, public_entity_type: contentType, public_entity_id: publicEntityId };
  } catch (err) {
    try {
      await connection.rollback();
    } catch {}
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
