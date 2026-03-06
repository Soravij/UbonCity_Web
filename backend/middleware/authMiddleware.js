import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "uboncity_secret";

function extractBearerToken(authHeader) {
  const header = String(authHeader || "").trim();
  if (!header) return "";

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return "";

  return String(match[1] || "").trim();
}

export const protect = (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const authorizeAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  next();
};
