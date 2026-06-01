import axios from "axios";

function resolveApiBaseUrl() {
  const raw = String(import.meta.env.VITE_API_URL || "").trim();
  const mode = String(import.meta.env.MODE || "development").toLowerCase();

  if (raw && !raw.includes("your-backend-domain")) return raw;
  if (mode === "production") return "/api";
  return "http://localhost:5000/api";
}

export const API_BASE_URL = resolveApiBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
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
