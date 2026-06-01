import crypto from "crypto";
import express from "express";
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

router.post("/review-content/ingest", requireCollectorTokenOrPrivilegedUser, ingestReviewContentAction);
router.post("/review-content/event-queue/enqueue", requireCollectorIngestToken, enqueueEventReviewQueueAction);
router.get("/review-content/:id", protectReviewContentReadAccess, getReviewContentDetail);
router.post("/review-content/:id/access-token", protect, authorizeEditorOrAdmin, createReviewAccessTokenAction);
router.post("/review-content/:id/approve", protect, authorizeEditorOrAdmin, approveReviewContentAction);
router.post("/review-content/:id/needs-revision", protect, authorizeEditorOrAdmin, needsRevisionAction);
router.post("/review-content/:id/reject", protect, authorizeEditorOrAdmin, rejectAction);
router.post("/review-content/legacy-needs-revision", protect, authorizeEditorOrAdmin, legacyNeedsRevisionAction);
router.post("/review-content/legacy-reject", protect, authorizeEditorOrAdmin, legacyRejectAction);

export default router;
