import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_TOKEN_CACHE = path.join(CWD, "data", "tmp-collector-test-token.json");

dotenv.config({ path: path.join(CWD, ".env"), override: false });
dotenv.config({ path: path.join(path.resolve(CWD, ".."), "backend", ".env"), override: false });
dotenv.config({ path: path.join(path.resolve(CWD, ".."), ".env"), override: false });

function readFirstEnv(keys, { normalize = false } = {}) {
  for (const key of Array.isArray(keys) ? keys : []) {
    const raw = process.env[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    return normalize ? value.toLowerCase() : value;
  }
  return "";
}

function decodeJwtExp(token) {
  try {
    const payload = jwt.decode(token);
    const expSeconds = Number(payload?.exp || 0) || 0;
    return expSeconds > 0 ? expSeconds * 1000 : 0;
  } catch {
    return 0;
  }
}

function resolveBaseUrl() {
  const explicit = readFirstEnv(["COLLECTOR_TEST_BASE_URL", "BACKEND_HEALTH_URL"]);
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const port = Number(readFirstEnv(["COLLECTOR_TEST_PORT", "PORT"]) || 0) || 5062;
  const bindHost = readFirstEnv(["COLLECTOR_TEST_HOST", "COLLECTOR_BIND_HOST"]) || "127.0.0.1";
  const host = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
  return `http://${host}:${port}`;
}

function resolveTokenCachePath() {
  const explicit = readFirstEnv(["COLLECTOR_TEST_TOKEN_CACHE"]);
  return explicit ? path.resolve(CWD, explicit) : DEFAULT_TOKEN_CACHE;
}

function resolveAuthMode() {
  const explicit = readFirstEnv(["COLLECTOR_TEST_AUTH_MODE"], { normalize: true });
  if (explicit === "backend_jwt" || explicit === "login") {
    return explicit;
  }
  if (readFirstEnv(["BACKEND_JWT_SECRET"])) {
    return "backend_jwt";
  }
  return "login";
}

function resolveLoginCredentials() {
  const email = readFirstEnv(
    ["COLLECTOR_TEST_EMAIL", "BACKEND_AUTH_EMAIL", "COLLECTOR_SMOKE_EMAIL", "OWNER_EMAIL"],
    { normalize: true }
  );
  const password = readFirstEnv(
    ["COLLECTOR_TEST_PASSWORD", "BACKEND_AUTH_PASSWORD", "COLLECTOR_SMOKE_PASSWORD", "OWNER_PASSWORD"]
  );
  if (!email || !password) {
    throw new Error(
      "Set COLLECTOR_TEST_EMAIL/COLLECTOR_TEST_PASSWORD or existing smoke login env vars for login-mode test auth"
    );
  }
  return { email, password };
}

async function requestLoginToken(baseUrl) {
  const credentials = resolveLoginCredentials();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.token) {
    throw new Error(`Collector login failed: ${JSON.stringify(payload)}`);
  }
  return {
    token: String(payload.token),
    expires_at: decodeJwtExp(payload.token),
    user: payload.user || null,
    source: "login",
  };
}

function buildBackendJwtToken() {
  const secret = readFirstEnv(["BACKEND_JWT_SECRET", "JWT_SECRET"]);
  const issuer = readFirstEnv(["BACKEND_JWT_ISSUER", "JWT_ISSUER"]) || "uboncity-backend";
  const audience = readFirstEnv(["COLLECTOR_BACKEND_JWT_AUDIENCE"]) || "uboncity-collector";
  if (!secret) {
    throw new Error("Set BACKEND_JWT_SECRET or JWT_SECRET for backend_jwt test auth mode");
  }
  const userId = Number(readFirstEnv(["COLLECTOR_TEST_USER_ID"]) || 1) || 1;
  const role = readFirstEnv(["COLLECTOR_TEST_USER_ROLE"], { normalize: true }) || "admin";
  const email = readFirstEnv(["COLLECTOR_TEST_EMAIL", "OWNER_EMAIL"], { normalize: true });
  const displayName = readFirstEnv(["COLLECTOR_TEST_USER_NAME", "OWNER_NAME"]) || email || "Collector Test User";
  if (!email) {
    throw new Error("Set COLLECTOR_TEST_EMAIL or OWNER_EMAIL for backend_jwt test auth mode");
  }
  const token = jwt.sign(
    {
      id: userId,
      email,
      role,
      display_name: displayName,
    },
    secret,
    {
      issuer,
      audience,
      expiresIn: readFirstEnv(["COLLECTOR_TEST_TOKEN_TTL"]) || "1h",
    }
  );
  return {
    token,
    expires_at: decodeJwtExp(token),
    user: {
      id: userId,
      email,
      role,
      display_name: displayName,
    },
    source: "backend_jwt",
  };
}

async function readCachedToken(cachePath, mode) {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const payload = JSON.parse(raw);
    const expiresAt = Number(payload?.expires_at || 0) || 0;
    if (!payload?.token || payload?.auth_mode !== mode) return null;
    if (!expiresAt || expiresAt <= Date.now() + 30_000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function writeCachedToken(cachePath, payload) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2));
}

export async function clearTestAuthTokenCache() {
  const cachePath = resolveTokenCachePath();
  await fs.rm(cachePath, { force: true });
  return cachePath;
}

export function resolveTestBaseUrl() {
  return resolveBaseUrl();
}

export function resolveTestAuthConfig() {
  return {
    auth_mode: resolveAuthMode(),
    base_url: resolveBaseUrl(),
    token_cache_path: resolveTokenCachePath(),
  };
}

export async function getTestAuthToken({ forceRefresh = false } = {}) {
  const authMode = resolveAuthMode();
  const baseUrl = resolveBaseUrl();
  const cachePath = resolveTokenCachePath();

  if (!forceRefresh) {
    const cached = await readCachedToken(cachePath, authMode);
    if (cached) {
      return {
        ...cached,
        cache_hit: true,
      };
    }
  }

  const issued = authMode === "login"
    ? await requestLoginToken(baseUrl)
    : buildBackendJwtToken();

  const payload = {
    auth_mode: authMode,
    token: issued.token,
    expires_at: issued.expires_at,
    issued_at: Date.now(),
    base_url: baseUrl,
    source: issued.source,
    user: issued.user || null,
  };
  await writeCachedToken(cachePath, payload);
  return {
    ...payload,
    cache_hit: false,
  };
}
