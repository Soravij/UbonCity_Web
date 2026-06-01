import { URL } from "url";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function parseAllowedOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
}

export function validateCorsConfiguration() {
  const raw = String(process.env.CORS_ALLOWED_ORIGINS || "").trim();
  if (raw.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS must not contain wildcard '*'. Use explicit origins.");
  }

  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  const allowed = parseAllowedOrigins();
  if (env === "production" && !allowed.length) {
    throw new Error("CORS_ALLOWED_ORIGINS is required in production.");
  }
}

export function corsOptionsDelegate(req, callback) {
  const origin = normalizeOrigin(req.header("origin"));
  const allowed = parseAllowedOrigins();

  if (!origin) {
    callback(null, { origin: false });
    return;
  }

  if (!allowed.length) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      callback(null, { origin: true, credentials: true });
      return;
    }

    callback(null, { origin: false });
    return;
  }

  const ok = allowed.includes(origin);
  callback(null, {
    origin: ok,
    credentials: ok,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-lifecycle-token"],
    optionsSuccessStatus: 204,
    maxAge: 600,
  });
}

export function applyBasicSecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (String(process.env.NODE_ENV || "development") === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

function makeStore() {
  const store = new Map();

  function cleanup(now) {
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }

  function hit(key, windowMs, max) {
    const now = Date.now();
    cleanup(now);

    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      const next = { count: 1, resetAt: now + windowMs };
      store.set(key, next);
      return {
        blocked: false,
        remaining: Math.max(max - 1, 0),
        resetAt: next.resetAt,
      };
    }

    current.count += 1;
    const blocked = current.count > max;
    return {
      blocked,
      remaining: Math.max(max - current.count, 0),
      resetAt: current.resetAt,
    };
  }

  return { hit };
}

function resolveKey(req, mode = "ip") {
  if (mode === "user") {
    const id = req.user?.id || req.authUser?.id;
    if (id) return `u:${id}`;
  }

  const fwd = String(req.header("x-forwarded-for") || "").split(",")[0].trim();
  const ip = fwd || req.ip || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

export function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = 60,
  keyBy = "ip",
  message = "Too many requests",
} = {}) {
  const limiterStore = makeStore();
  return (req, res, next) => {
    const key = resolveKey(req, keyBy);
    const result = limiterStore.hit(key, windowMs, max);

    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));

    if (result.blocked) {
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message });
    }

    next();
  };
}

export function requireStrongJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret || secret.length < 32 || secret.toLowerCase().includes("change")) {
    throw new Error("JWT_SECRET is missing or weak. Set a strong secret (min 32 chars).");
  }
}
