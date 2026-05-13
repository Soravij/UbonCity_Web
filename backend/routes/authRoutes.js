import express from "express";
import { register, login, me } from "../controllers/authController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";
import { createRateLimiter } from "../middleware/securityMiddleware.js";

const router = express.Router();
const isDevelopment = String(process.env.NODE_ENV || "development").toLowerCase() === "development";

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const loginWindowMs = parsePositiveInt(
  process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const loginMaxAttempts = parsePositiveInt(
  process.env.LOGIN_RATE_LIMIT_MAX,
  isDevelopment ? 30 : 10
);

const loginRateLimit = createRateLimiter({
  windowMs: loginWindowMs,
  max: loginMaxAttempts,
  keyBy: "ip",
  message: "Too many login attempts. Try again later.",
});

router.post("/register", protect, authorizeAdmin, register);
router.post("/login", loginRateLimit, login);
router.get("/me", protect, me);

export default router;
