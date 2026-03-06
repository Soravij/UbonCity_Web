import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

export function normalizeToken(rawToken) {
  const value = String(rawToken || "").trim();
  if (!value) return "";

  const withoutBearer = value.replace(/^Bearer\s+/i, "").trim();
  const cleaned = withoutBearer.replace(/^"|"$/g, "").trim();

  // Basic JWT shape check: header.payload.signature
  if (cleaned.split(".").length !== 3) return "";

  return cleaned;
}

export function authHeaders(token) {
  const normalized = normalizeToken(token);
  return normalized ? { Authorization: `Bearer ${normalized}` } : {};
}
