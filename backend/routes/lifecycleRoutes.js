import express from "express";
import { importPublishedLifecycleBundle } from "../controllers/lifecycleController.js";
import { createRateLimiter } from "../middleware/securityMiddleware.js";

const router = express.Router();

const lifecycleImportRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyBy: "ip",
  message: "Too many lifecycle import requests",
});

router.post("/lifecycle/import-published", lifecycleImportRateLimit, importPublishedLifecycleBundle);

export default router;
