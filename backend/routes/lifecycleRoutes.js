import express from "express";
import {
  getCollectorImportReviewQueue,
  getCollectorImportReviewQueueDetail,
  getDeletedContentHistory,
  importPublishedLifecycleBundle,
  rejectCollectorImportReview,
} from "../controllers/lifecycleController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";
import { createRateLimiter } from "../middleware/securityMiddleware.js";

const router = express.Router();

const lifecycleImportRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyBy: "ip",
  message: "Too many lifecycle import requests",
});

router.post("/lifecycle/import-published", lifecycleImportRateLimit, importPublishedLifecycleBundle);
router.get("/collector-import-reviews", protect, authorizeAdmin, getCollectorImportReviewQueue);
router.get("/collector-import-reviews-deleted", protect, authorizeAdmin, getDeletedContentHistory);
router.get("/collector-import-reviews/:id", protect, authorizeAdmin, getCollectorImportReviewQueueDetail);
router.patch("/collector-import-reviews/:id/reject", protect, authorizeAdmin, rejectCollectorImportReview);

export default router;
