import crypto from "crypto";
import express from "express";
import multer from "multer";
import {
  approveReviewContentAction,
  createReviewAccessTokenAction,
  enqueueEventReviewQueueAction,
  getReviewContentDetail,
  ingestReviewContentAction,
  legacyRejectAction,
  legacyNeedsRevisionAction,
  needsRevisionAction,
  rejectAction,
} from "../controllers/reviewContentController.js";
import { authorizeEditorOrAdmin, protect, protectReviewContentReadAccess } from "../middleware/authMiddleware.js";

const router = express.Router();
const MAX_REVIEW_MEDIA_BYTES = 20 * 1024 * 1024;
const reviewIngestMultipart = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_REVIEW_MEDIA_BYTES,
    files: 32,
    fieldSize: 5 * 1024 * 1024,
  },
});

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireCollectorIngestToken(req, res, next) {
  const expected = String(process.env.COLLECTOR_REVIEW_SYNC_TOKEN || "").trim();
  if (!expected) return res.status(503).json({ error: "COLLECTOR_REVIEW_SYNC_TOKEN is not configured" });
  const provided = String(req.headers["x-review-sync-token"] || "").trim();
  if (!timingSafeEquals(provided, expected)) return res.status(401).json({ error: "Invalid review sync token" });
  return next();
}

function requireCollectorTokenOrPrivilegedUser(req, res, next) {
  const provided = String(req.headers["x-review-sync-token"] || "").trim();
  if (provided) return requireCollectorIngestToken(req, res, next);
  return protect(req, res, () => authorizeEditorOrAdmin(req, res, next));
}

function parseReviewIngestMultipart(req, res, next) {
  const contentType = String(req.headers["content-type"] || "").trim().toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) return next();
  return reviewIngestMultipart.any()(req, res, (err) => {
    if (!err) return next();
    const message = String(err?.message || "Invalid multipart review ingest payload");
    return res.status(400).json({ error: message });
  });
}

function logNeedsRevisionRouteHit(req, res, next) {
  console.error("[review-content needs-revision route hit]", {
    id: req.params.id,
    has_authorization: Boolean(req.headers?.authorization),
    has_cookie: Boolean(req.headers?.cookie),
    content_type: req.headers?.["content-type"] || null,
  });
  next();
}

function logLegacyNeedsRevisionRouteHit(req, res, next) {
  console.error("[review-content legacy needs-revision route hit]", {
    review_id: req.body?.review_id || null,
    has_authorization: Boolean(req.headers?.authorization),
    has_cookie: Boolean(req.headers?.cookie),
    content_type: req.headers?.["content-type"] || null,
  });
  next();
}

router.post("/review-content/ingest", requireCollectorTokenOrPrivilegedUser, parseReviewIngestMultipart, ingestReviewContentAction);
router.post("/review-content/event-queue/enqueue", requireCollectorIngestToken, enqueueEventReviewQueueAction);
router.get("/review-content/:id", protectReviewContentReadAccess, getReviewContentDetail);
router.post("/review-content/:id/access-token", protect, authorizeEditorOrAdmin, createReviewAccessTokenAction);
router.post("/review-content/:id/approve", protect, authorizeEditorOrAdmin, approveReviewContentAction);
router.post("/review-content/:id/needs-revision", logNeedsRevisionRouteHit, protect, authorizeEditorOrAdmin, needsRevisionAction);
router.post("/review-content/:id/reject", protect, authorizeEditorOrAdmin, rejectAction);
router.post("/review-content/legacy-needs-revision", logLegacyNeedsRevisionRouteHit, protect, authorizeEditorOrAdmin, legacyNeedsRevisionAction);
router.post("/review-content/legacy-reject", protect, authorizeEditorOrAdmin, legacyRejectAction);

export default router;
