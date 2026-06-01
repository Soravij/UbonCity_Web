import express from "express";
import {
  createAnalyticsEvent,
  getCtaSummary,
  getMissingCtaPlaces,
  getRecentAnalyticsEvents,
  getTopEntities,
} from "../controllers/analyticsController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/analytics/events", createAnalyticsEvent);
router.get("/analytics/cta-summary", protect, authorizeAdmin, getCtaSummary);
router.get("/analytics/top-entities", protect, authorizeAdmin, getTopEntities);
router.get("/analytics/recent-events", protect, authorizeAdmin, getRecentAnalyticsEvents);
router.get("/analytics/missing-cta", protect, authorizeAdmin, getMissingCtaPlaces);

export default router;
