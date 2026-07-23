import express from "express";
import {
  getCollectorImportReviewQueue,
  getCollectorImportReviewQueueDetail,
  getDeletedContentHistory,
  rejectCollectorImportReview,
} from "../controllers/importReviewController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/collector-import-reviews", protect, authorizeAdmin, getCollectorImportReviewQueue);
router.get("/collector-import-reviews-deleted", protect, authorizeAdmin, getDeletedContentHistory);
router.get("/collector-import-reviews/:id", protect, authorizeAdmin, getCollectorImportReviewQueueDetail);
router.patch("/collector-import-reviews/:id/reject", protect, authorizeAdmin, rejectCollectorImportReview);

export default router;
