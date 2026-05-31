import express from "express";
import { createAnalyticsEvent } from "../controllers/analyticsController.js";

const router = express.Router();

router.post("/analytics/events", createAnalyticsEvent);

export default router;
