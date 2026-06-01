import jwt from "jsonwebtoken";

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ISSUER = String(process.env.JWT_ISSUER || "uboncity-backend").trim();
const JWT_AUDIENCE_BACKEND = String(process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend").trim();
const JWT_AUDIENCE_REVIEW = String(process.env.JWT_AUDIENCE_REVIEW || "uboncity-review").trim();
const REVIEW_ACCESS_TTL_SECONDS = Math.max(60, Number(process.env.REVIEW_ACCESS_TTL_SECONDS || 600) || 600);

if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.toLowerCase().includes("change")) {
  throw new Error("JWT_SECRET is missing or weak. Set a strong secret (min 32 chars).");
}

function extractBearerToken(authHeader) {
  const header = String(authHeader || "").trim();
  if (!header) return "";

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return "";

  return String(match[1] || "").trim();
}

function verifyBackendJwt(token) {
  return jwt.verify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE_BACKEND,
  });
}

function verifyReviewAccessJwt(token) {
  return jwt.verify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE_REVIEW,
  });
}

export const protect = (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const decoded = verifyBackendJwt(token);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const protectReviewContentReadAccess = (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const decoded = verifyBackendJwt(token);
    const role = String(decoded?.role || "").toLowerCase();
    if (role !== "admin" && role !== "owner") {
      return res.status(403).json({ message: "Admin only" });
    }
    req.user = decoded;
    req.reviewAccess = null;
    return next();
  } catch {}

  try {
    const decoded = verifyReviewAccessJwt(token);
    if (String(decoded?.scope || "").trim().toLowerCase() !== "review_content:read") {
      return res.status(403).json({ message: "Invalid review access scope" });
    }
    req.user = null;
    req.reviewAccess = decoded;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const authorizeAdmin = (req, res, next) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin" && role !== "owner") {
    return res.status(403).json({ message: "Admin only" });
  }

  next();
};

export const authorizeOwner = (req, res, next) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "owner") {
    return res.status(403).json({ message: "Owner only" });
  }

  next();
};

export const authorizeEditorOrAdmin = (req, res, next) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (role !== "admin" && role !== "owner") {
    return res.status(403).json({ message: "Admin only" });
  }

  next();
};

export function issueReviewAccessToken({ reviewContentId, actorUser }) {
  const normalizedReviewContentId = Number(reviewContentId || 0) || 0;
  if (!normalizedReviewContentId) {
    throw new Error("review content id is required");
  }

  const actorId = Number(actorUser?.id || 0) || null;
  const role = String(actorUser?.role || "").trim().toLowerCase();
  if (!actorId || !role) {
    throw new Error("actor user is required");
  }

  const payload = {
    type: "review_access",
    scope: "review_content:read",
    review_content_id: normalizedReviewContentId,
    role,
    email: String(actorUser?.email || "").trim() || null,
  };

  const token = jwt.sign(payload, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE_REVIEW,
    subject: String(actorId),
    expiresIn: REVIEW_ACCESS_TTL_SECONDS,
  });

  return {
    token,
    expires_in: REVIEW_ACCESS_TTL_SECONDS,
  };
}

export function logOwnerOverrideAction(action) {
  return (req, _res, next) => {
    const actorId = req.user?.id ?? null;
    const actorEmail = String(req.user?.email || "").trim() || "unknown";
    console.info("[owner-override]", {
      action: String(action || "").trim() || "unknown",
      actor_id: actorId,
      actor_email: actorEmail,
      method: req.method,
      path: req.originalUrl || req.url,
      at: new Date().toISOString(),
    });
    next();
  };
}
