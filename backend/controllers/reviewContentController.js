import {
  approveReviewContent,
  markLegacyNeedsRevisionFromQueue,
  markLegacyRejectedFromQueue,
  markNeedsRevision,
  markRejected,
} from "../services/reviewDecisionService.js";
import { getReviewContentById } from "../services/reviewContentService.js";
import { ingestReviewContent } from "../services/reviewIngestService.js";
import { issueReviewAccessToken } from "../middleware/authMiddleware.js";

function isDebugDiagnosticsEnabled() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
}

function isMultipartReviewIngestRequest(req) {
  const contentType = String(req.headers["content-type"] || "").trim().toLowerCase();
  return contentType.startsWith("multipart/form-data");
}

function parseMultipartJsonField(rawValue, fieldName) {
  const text = String(rawValue || "").trim();
  if (!text) throw new Error(`${fieldName} is required`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${fieldName} must be valid JSON`);
  }
}

export async function ingestReviewContentAction(req, res) {
  try {
    const isMultipart = isMultipartReviewIngestRequest(req);
    const payload = isMultipart ? parseMultipartJsonField(req.body?.payload, "payload") : (req.body || {});
    const mediaIndex = isMultipart && req.body?.media_index != null
      ? parseMultipartJsonField(req.body?.media_index, "media_index")
      : null;
    const item = await ingestReviewContent(payload, {
      uploadedFiles: Array.isArray(req.files) ? req.files : [],
      mediaIndex,
      multipart: isMultipart,
    });
    return res.json({ item });
  } catch (err) {
    const msg = String(err?.message || "ingest failed");
    console.error("review-content ingest failed:", msg);
    if (err?.is_client_error || /required|requires|invalid|must be|too large|unsupported|cannot fetch|not configured|empty/i.test(msg)) {
      const responsePayload = { error: msg };
      if (isDebugDiagnosticsEnabled() && err?.diagnostics && typeof err.diagnostics === "object") {
        responsePayload.diagnostics = err.diagnostics;
      }
      return res.status(400).json(responsePayload);
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function enqueueEventReviewQueueAction(req, res) {
  try {
    const body = req.body || {};
    const sourceSystem = String(body.source_system || "").trim().toLowerCase();
    const sourceContentType = String(body.source_content_type || "").trim().toLowerCase();
    const sourceContentItemId = Number(body.source_content_item_id || 0);
    const sourceBaseUrl = body.source_base_url == null ? null : String(body.source_base_url || "").trim() || null;
    const articleSnapshot = body.article_snapshot && typeof body.article_snapshot === "object" ? body.article_snapshot : null;
    const translationsSnapshot = Array.isArray(body.translations_snapshot) ? body.translations_snapshot : [];
    const translationLangs = Array.isArray(body.translation_langs) ? body.translation_langs : [];
    const publishedAt = body.published_at || null;

    if (sourceSystem !== "collector-app") {
      return res.status(400).json({ error: "source_system must be collector-app" });
    }
    if (sourceContentType !== "event") {
      return res.status(400).json({ error: "source_content_type must be event" });
    }
    if (!Number.isFinite(sourceContentItemId) || sourceContentItemId <= 0) {
      return res.status(400).json({ error: "source_content_item_id must be a positive integer" });
    }
    if (!articleSnapshot) {
      return res.status(400).json({ error: "article_snapshot is required" });
    }
    if (!String(articleSnapshot.title || "").trim()) {
      return res.status(400).json({ error: "article_snapshot.title is required" });
    }
    if (!String(articleSnapshot.description || "").trim()) {
      return res.status(400).json({ error: "article_snapshot.description is required" });
    }

    const ingestPayload = {
      source_system: sourceSystem,
      source_content_item_id: sourceContentItemId,
      source_base_url: sourceBaseUrl,
      content: {
        content_type: "event",
        lang: "th",
        category: "event",
        slug: String(articleSnapshot.slug || "").trim() || null,
        title: String(articleSnapshot.title || "").trim(),
        excerpt: String(articleSnapshot.excerpt || "").trim() || null,
        body: String(articleSnapshot.description || "").trim(),
        meta_title: String(articleSnapshot.meta_title || "").trim() || null,
        meta_description: String(articleSnapshot.meta_description || "").trim() || null,
        event_period_text: String(articleSnapshot.event_period_text || "").trim() || null,
        location_text: String(articleSnapshot.location_text || "").trim() || null,
        latitude: articleSnapshot.latitude == null ? null : Number(articleSnapshot.latitude),
        longitude: articleSnapshot.longitude == null ? null : Number(articleSnapshot.longitude),
        map_url: String(articleSnapshot.map_url || "").trim() || null,
        google_place_id: String(articleSnapshot.google_place_id || "").trim() || null,
        translation_langs: translationLangs,
      },
      media_manifest: articleSnapshot.media_manifest && typeof articleSnapshot.media_manifest === "object"
        ? articleSnapshot.media_manifest
        : {},
    };
    const ingested = await ingestReviewContent(ingestPayload);

    return res.json({
      ok: true,
      item: ingested,
      compatibility_endpoint: true,
    });
  } catch (err) {
    const msg = String(err?.message || "queue enqueue failed");
    if (/required|invalid|must be/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getReviewContentDetail(req, res) {
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid review id" });
    const scopedReviewId = Number(req.reviewAccess?.review_content_id || 0) || 0;
    if (scopedReviewId && scopedReviewId !== id) {
      return res.status(403).json({ error: "Review access is limited to a different item" });
    }
    const item = await getReviewContentById(id);
    if (!item) return res.status(404).json({ error: "Review content not found" });
    return res.json({ item });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function createReviewAccessTokenAction(req, res) {
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid review id" });
    const item = await getReviewContentById(id);
    if (!item) return res.status(404).json({ error: "Review content not found" });

    const access = issueReviewAccessToken({
      reviewContentId: id,
      actorUser: req.user,
    });

    return res.json({
      review_id: id,
      access_token: access.token,
      expires_in: access.expires_in,
    });
  } catch (err) {
    const msg = String(err?.message || "review access token failed");
    if (/required/i.test(msg)) return res.status(400).json({ error: msg });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function approveReviewContentAction(req, res) {
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid review id" });
    const item = await getReviewContentById(id);
    if (!item) return res.status(404).json({ error: "Review content not found" });
    const result = await approveReviewContent({
      reviewContent: item,
      actorUserId: Number(req.user?.id || 0) || null,
      reviewNote: req.body?.review_note,
    });
    return res.json({ item: result });
  } catch (err) {
    if (String(err?.code || "") === "EMER_CONFLICT") {
      return res.status(409).json(err.payload || { error: "emer_conflict" });
    }
    const msg = String(err?.message || "approve failed");
    if (/already published|not found|cannot/i.test(msg)) return res.status(409).json({ error: msg });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function needsRevisionAction(req, res) {
  try {
    console.error("[review-content needs-revision hit]", {
      id: req.params.id,
      user_id: req.user?.id || null,
      body_keys: Object.keys(req.body || {}),
    });
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid review id" });
    const item = await getReviewContentById(id);
    if (!item) return res.status(404).json({ error: "Review content not found" });
    const result = await markNeedsRevision({
      reviewContent: item,
      actorUserId: Number(req.user?.id || 0) || null,
      reviewNote: req.body?.review_note,
    });
    return res.json({ item: result, collector_sync: result?.collector_sync || { ok: true } });
  } catch (err) {
    const msg = String(err?.message || "needs_revision failed");
    if (/collector sync failed|not configured|cannot mark/i.test(msg)) {
      return res.status(409).json({ error: msg });
    }
    console.error("[review-content needs-revision failed]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function legacyNeedsRevisionAction(req, res) {
  try {
    console.error("[review-content legacy needs-revision hit]", {
      review_id: req.body?.review_id || null,
      user_id: req.user?.id || null,
      body_keys: Object.keys(req.body || {}),
    });
    const reviewId = Number(req.body?.review_id || 0);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      return res.status(400).json({ error: "Invalid review id" });
    }
    const result = await markLegacyNeedsRevisionFromQueue({
      reviewId,
      actorUserId: Number(req.user?.id || 0) || null,
      reviewNote: req.body?.review_note,
    });
    return res.json({ item: result, fallback: true });
  } catch (err) {
    const msg = String(err?.message || "legacy needs_revision failed");
    if (/invalid|not found|not pending|failed to update queue item|collector sync failed|not configured/i.test(msg)) {
      return res.status(409).json({ error: msg });
    }
    console.error("[review-content legacy needs-revision failed]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function rejectAction(req, res) {
  try {
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid review id" });
    const item = await getReviewContentById(id);
    if (!item) return res.status(404).json({ error: "Review content not found" });
    const result = await markRejected({
      reviewContent: item,
      actorUserId: Number(req.user?.id || 0) || null,
      reviewNote: req.body?.review_note,
    });
    return res.json({ item: result, terminal: true });
  } catch (err) {
    const msg = String(err?.message || "reject failed");
    if (/cannot reject|not found|cannot mark/i.test(msg)) {
      return res.status(409).json({ error: msg });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function legacyRejectAction(req, res) {
  try {
    const reviewId = Number(req.body?.review_id || 0);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      return res.status(400).json({ error: "Invalid review id" });
    }
    const result = await markLegacyRejectedFromQueue({
      reviewId,
      actorUserId: Number(req.user?.id || 0) || null,
      reviewNote: req.body?.review_note,
    });
    return res.json({ item: result, fallback: true, terminal: true });
  } catch (err) {
    const msg = String(err?.message || "legacy reject failed");
    if (/invalid|not found|not pending|failed to update queue item/i.test(msg)) {
      return res.status(409).json({ error: msg });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}
