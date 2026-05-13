import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");

dotenv.config({ path: path.join(CWD, ".env"), override: false });
dotenv.config({ path: path.join(path.resolve(CWD, ".."), "backend", ".env"), override: false });
dotenv.config({ path: path.join(path.resolve(CWD, ".."), ".env"), override: false });

function readFirstEnv(keys, { normalize = false } = {}) {
  const names = Array.isArray(keys) ? keys : [];
  for (const key of names) {
    const raw = process.env[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    return normalize ? value.toLowerCase() : value;
  }
  return "";
}

function formatEnvKeys(keys) {
  return (Array.isArray(keys) ? keys : []).filter(Boolean).join("/");
}

export function resolveSmokeCredentials({ label, emailEnvKeys, passwordEnvKeys }) {
  const email = readFirstEnv([...new Set([...(Array.isArray(emailEnvKeys) ? emailEnvKeys : []), "COLLECTOR_TEST_EMAIL"])], { normalize: true });
  const password = readFirstEnv([...new Set([...(Array.isArray(passwordEnvKeys) ? passwordEnvKeys : []), "COLLECTOR_TEST_PASSWORD"])]);
  if (!email || !password) {
    throw new Error(`Set ${formatEnvKeys(emailEnvKeys)} and ${formatEnvKeys(passwordEnvKeys)} for ${label}`);
  }
  return { email, password };
}

function resolveSmokeAuthMode() {
  const explicit = readFirstEnv(["COLLECTOR_TEST_AUTH_MODE"], { normalize: true });
  return explicit === "backend_jwt" ? "backend_jwt" : "login";
}

function buildBackendJwtActor({
  label,
  emailEnvKeys,
  userIdEnvKeys = [],
  roleEnvKeys = [],
  displayNameEnvKeys = [],
  defaultRole = "",
}) {
  const secret = readFirstEnv(["BACKEND_JWT_SECRET", "JWT_SECRET"]);
  const issuer = readFirstEnv(["BACKEND_JWT_ISSUER", "JWT_ISSUER"]) || "uboncity-backend";
  const audience = readFirstEnv(["COLLECTOR_BACKEND_JWT_AUDIENCE"]) || "uboncity-collector";
  if (!secret) {
    throw new Error(`Set BACKEND_JWT_SECRET or JWT_SECRET for ${label}`);
  }

  const email = readFirstEnv(
    [...new Set([...(Array.isArray(emailEnvKeys) ? emailEnvKeys : []), "COLLECTOR_TEST_EMAIL", "OWNER_EMAIL"])],
    { normalize: true }
  );
  if (!email) {
    throw new Error(`Set ${formatEnvKeys([...new Set([...(Array.isArray(emailEnvKeys) ? emailEnvKeys : []), "COLLECTOR_TEST_EMAIL", "OWNER_EMAIL"])])} for ${label}`);
  }

  const userId = Number(
    readFirstEnv([...new Set([...(Array.isArray(userIdEnvKeys) ? userIdEnvKeys : []), "COLLECTOR_TEST_USER_ID"])]) || 1
  ) || 1;
  const role = readFirstEnv(Array.isArray(roleEnvKeys) ? roleEnvKeys : [], { normalize: true })
    || String(defaultRole || "").trim().toLowerCase()
    || readFirstEnv(["COLLECTOR_TEST_USER_ROLE"], { normalize: true })
    || "admin";
  const displayName = readFirstEnv(
    [...new Set([...(Array.isArray(displayNameEnvKeys) ? displayNameEnvKeys : []), "COLLECTOR_TEST_USER_NAME", "OWNER_NAME"])]
  ) || email;

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
    auth_mode: "backend_jwt",
    email,
    password: "",
    token,
    user: {
      id: userId,
      email,
      role,
      display_name: displayName,
    },
  };
}

export function resolveSmokeActor({
  label,
  emailEnvKeys = [],
  passwordEnvKeys = [],
  userIdEnvKeys = [],
  roleEnvKeys = [],
  displayNameEnvKeys = [],
  defaultRole = "",
}) {
  if (resolveSmokeAuthMode() === "backend_jwt") {
    return buildBackendJwtActor({
      label,
      emailEnvKeys,
      userIdEnvKeys,
      roleEnvKeys,
      displayNameEnvKeys,
      defaultRole,
    });
  }

  const { email, password } = resolveSmokeCredentials({
    label,
    emailEnvKeys,
    passwordEnvKeys,
  });
  return {
    auth_mode: "login",
    email,
    password,
    token: "",
    user: null,
  };
}

export function assertLoginRole(loginPayload, allowedRoles, label) {
  const allowed = new Set((Array.isArray(allowedRoles) ? allowedRoles : []).map((role) => String(role || "").trim().toLowerCase()).filter(Boolean));
  const role = String(loginPayload?.user?.role || "").trim().toLowerCase();
  if (!allowed.has(role)) {
    throw new Error(`${label} role required (${Array.from(allowed).join("/") }): ${JSON.stringify(loginPayload?.user || null)}`);
  }
  return role;
}
