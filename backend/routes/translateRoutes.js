import express from "express";
import { previewTranslateManual } from "../controllers/translateController.js";
import { authorizeOwner, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";
import { createRateLimiter } from "../middleware/securityMiddleware.js";

const router = express.Router();

const translateRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyBy: "user",
  message: "Translation rate limit exceeded",
});

// Preferred preview-only endpoint.
router.post("/translate/preview", protect, authorizeOwner, logOwnerOverrideAction("translate.preview"), translateRateLimit, previewTranslateManual);

// Backward-compatible legacy path (still preview-only/manual-only).
router.post("/translate", protect, authorizeOwner, logOwnerOverrideAction("translate.legacy_preview"), translateRateLimit, previewTranslateManual);

export default router;
