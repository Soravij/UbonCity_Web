import os from "node:os";
import path from "node:path";

const SAFE_BACKEND_DATABASES = new Set([
  "uboncity_test",
  "uboncity_smoke",
  "uboncity_web_test",
  "ubon_stage",
]);

function normalizedUrl(value, label) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error(`smoke target guard: ${label} URL is required`);
  return url;
}

function isTempPath(value) {
  const target = path.resolve(String(value || ""));
  const relative = path.relative(path.resolve(os.tmpdir()), target);
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function readIdentity(baseUrl, label, fetchImpl) {
  const response = await fetchImpl(`${normalizedUrl(baseUrl, label)}/api/health`);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`smoke target guard: ${label} health check failed (HTTP ${response.status})`);
  }
  return payload?.database || null;
}

export function assertBackendDatabaseIdentity(identity) {
  const database = String(identity?.name || "").trim().toLowerCase();
  if (identity?.engine !== "mysql" || !SAFE_BACKEND_DATABASES.has(database)) {
    throw new Error(`smoke target guard: refusing backend database ${database || "unknown"}; allowed=${[...SAFE_BACKEND_DATABASES].join(",")}`);
  }
}

export function assertCollectorDatabaseIdentity(identity) {
  const databasePath = String(identity?.path || "").trim();
  if (identity?.engine !== "sqlite" || !isTempPath(databasePath)) {
    throw new Error(`smoke target guard: refusing collector database ${databasePath || "unknown"}; DB_PATH must be below ${os.tmpdir()}`);
  }
}

export async function assertBackendSmokeTargetAllowed({ backendBaseUrl, fetchImpl = fetch } = {}) {
  const backend = await readIdentity(backendBaseUrl, "backend", fetchImpl);
  assertBackendDatabaseIdentity(backend);
  return backend;
}

export async function assertCollectorSmokeTargetAllowed({ collectorBaseUrl, fetchImpl = fetch } = {}) {
  const collector = await readIdentity(collectorBaseUrl, "collector", fetchImpl);
  assertCollectorDatabaseIdentity(collector);
  return collector;
}

// Call this before opening fixtures, authenticating, or issuing any mutating request.
// This checks the databases held by the already-running target servers, not this process's env.
export async function assertSmokeServerTargetsAllowed({ backendBaseUrl, collectorBaseUrl, fetchImpl = fetch } = {}) {
  const backend = await assertBackendSmokeTargetAllowed({ backendBaseUrl, fetchImpl });
  const collector = await assertCollectorSmokeTargetAllowed({ collectorBaseUrl, fetchImpl });
  return { backend, collector };
}
