import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = path.resolve(CWD, "..");
const BACKEND_ENV_PATH = path.join(WORKSPACE_ROOT, "backend", ".env");
const COLLECTOR_PORT = Number(process.env.COLLECTOR_PHASEF_LIVE_PORT || 5095);
const BACKEND_BASE_URL = String(process.env.COLLECTOR_SYNC_BACKEND_API || "http://127.0.0.1:5000/api").trim().replace(/\/+$/, "");
const TEMP_ROOT = path.join(CWD, "tmp-runtime-lifecycle-authority-live");

dotenv.config({ path: BACKEND_ENV_PATH, override: false });

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ISSUER = String(process.env.JWT_ISSUER || "uboncity-backend").trim();
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || "");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildCollectorEnv() {
  return {
    ...process.env,
    PORT: String(COLLECTOR_PORT),
    DB_PATH: path.join(TEMP_ROOT, "collector.db"),
    RAW_DIR: path.join(TEMP_ROOT, "raw"),
    MEDIA_DIR: path.join(TEMP_ROOT, "media"),
    STAGING_DIR: path.join(TEMP_ROOT, "staging"),
    EXPORT_DIR: path.join(TEMP_ROOT, "staging"),
    COLLECTOR_SYNC_BACKEND_API: BACKEND_BASE_URL,
    BACKEND_JWT_SECRET: JWT_SECRET,
    BACKEND_JWT_ISSUER: JWT_ISSUER,
    COLLECTOR_BACKEND_JWT_AUDIENCE: "uboncity-collector",
  };
}

function runNode(args, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: CWD,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk || "")}`.slice(-12000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk || "")}`.slice(-12000);
    });
    child.on("error", (err) => reject(new Error(`${label} failed to start: ${String(err?.message || err)}`)));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${label} exited with code ${code}. stdout: ${stdout} stderr: ${stderr}`));
    });
  });
}

function startCollector(env) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: CWD,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdoutTail = "";
  let stderrTail = "";
  child.stdout.on("data", (chunk) => {
    stdoutTail = `${stdoutTail}${String(chunk || "")}`.slice(-12000);
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${String(chunk || "")}`.slice(-12000);
  });
  return {
    child,
    getOutput() {
      return { stdoutTail, stderrTail };
    },
  };
}

async function stopCollector(handle) {
  if (!handle?.child) return;
  if (handle.child.exitCode == null) {
    handle.child.kill("SIGTERM");
  }
  const startedAt = Date.now();
  while (handle.child.exitCode == null && Date.now() - startedAt < 5000) {
    await delay(100);
  }
  if (handle.child.exitCode == null) {
    handle.child.kill("SIGKILL");
  }
}

async function waitForHealth(handle, timeoutMs = 30000) {
  const baseUrl = `http://127.0.0.1:${COLLECTOR_PORT}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (handle.child.exitCode != null) {
      const output = handle.getOutput();
      throw new Error(`collector exited early with code ${handle.child.exitCode}. stdout: ${output.stdoutTail} stderr: ${output.stderrTail}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const payload = await response.json();
      if (response.ok && payload?.ok === true) return;
    } catch {}
    await delay(500);
  }
  const output = handle.getOutput();
  throw new Error(`collector health timeout. stdout: ${output.stdoutTail} stderr: ${output.stderrTail}`);
}

async function requestJson(url, { method = "GET", token = "", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
}

async function rmTempRoot() {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true });
}

async function main() {
  assert(BACKEND_BASE_URL, "COLLECTOR_SYNC_BACKEND_API (or default backend URL) is required");
  assert(OWNER_EMAIL, "OWNER_EMAIL is required; backend/.env must define the bootstrap owner");
  assert(OWNER_PASSWORD, "OWNER_PASSWORD is required; backend/.env must define the bootstrap owner password");

  const env = buildCollectorEnv();
  await rmTempRoot();
  await runNode(["scripts/init-db.mjs"], env, "db:init");

  const collectorHandle = startCollector(env);
  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  let backendOwnerToken = "";
  let ownerCollectorToken = "";
  let createdDirectoryUserId = 0;

  try {
    await waitForHealth(collectorHandle);

    const backendOwnerLogin = await requestJson(`${BACKEND_BASE_URL}/login`, {
      method: "POST",
      body: {
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
      },
    });
    assert(backendOwnerLogin.response.ok, `backend owner login failed: ${JSON.stringify(backendOwnerLogin.payload)}`);
    backendOwnerToken = String(backendOwnerLogin.payload?.token || "").trim();
    assert(backendOwnerToken, "backend owner token missing after login");

    const wrongPasswordLogin = await requestJson(`http://127.0.0.1:${COLLECTOR_PORT}/api/auth/login`, {
      method: "POST",
      body: {
        email: OWNER_EMAIL,
        password: `${OWNER_PASSWORD}_wrong`,
      },
    });
    assert(
      !wrongPasswordLogin.response.ok,
      `collector login unexpectedly accepted invalid backend credential: ${JSON.stringify(wrongPasswordLogin.payload)}`
    );

    const ownerCollectorLogin = await requestJson(`http://127.0.0.1:${COLLECTOR_PORT}/api/auth/login`, {
      method: "POST",
      body: {
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
      },
    });
    assert(ownerCollectorLogin.response.ok, `collector owner login failed: ${JSON.stringify(ownerCollectorLogin.payload)}`);
    ownerCollectorToken = String(ownerCollectorLogin.payload?.token || "").trim();
    assert(ownerCollectorToken, "collector owner token missing after login");

    const directoryUserEmail = `collector-directory-${runId}@local.test`;
    const directoryUserPassword = "CollectorPhaseF_123!";
    const directoryUserCreate = await requestJson(`${BACKEND_BASE_URL}/users`, {
      method: "POST",
      token: backendOwnerToken,
      body: {
        email: directoryUserEmail,
        password: directoryUserPassword,
        role: "user",
      },
    });
    assert(
      directoryUserCreate.response.ok,
      `backend directory sync user create failed: ${JSON.stringify(directoryUserCreate.payload)}`
    );
    createdDirectoryUserId = Number(directoryUserCreate.payload?.user?.id || 0) || 0;
    assert(createdDirectoryUserId > 0, `backend directory sync user id missing: ${JSON.stringify(directoryUserCreate.payload)}`);

    const manualDirectorySync = await requestJson(`http://127.0.0.1:${COLLECTOR_PORT}/api/users/sync`, {
      method: "POST",
      token: ownerCollectorToken,
    });
    assert(
      manualDirectorySync.response.ok,
      `collector manual directory sync failed: ${JSON.stringify(manualDirectorySync.payload)}`
    );

    const collectorUsers = await requestJson(`http://127.0.0.1:${COLLECTOR_PORT}/api/users`, {
      method: "GET",
      token: ownerCollectorToken,
    });
    assert(collectorUsers.response.ok, `collector users list failed: ${JSON.stringify(collectorUsers.payload)}`);
    const listedUsers = Array.isArray(collectorUsers.payload?.items) ? collectorUsers.payload.items : [];
    assert(
      listedUsers.some((row) => String(row?.email || "").trim().toLowerCase() === directoryUserEmail),
      `collector users list missing backend directory user after manual sync: ${JSON.stringify(collectorUsers.payload)}`
    );

    const smokeEnv = {
      ...process.env,
      COLLECTOR_PHASEF_SMOKE_BASE_URL: `http://127.0.0.1:${COLLECTOR_PORT}`,
      COLLECTOR_PHASEF_SMOKE_EMAIL: OWNER_EMAIL,
      COLLECTOR_PHASEF_SMOKE_PASSWORD: OWNER_PASSWORD,
    };
    await runNode(["scripts/smoke-lifecycle-authority-phasef.mjs"], smokeEnv, "collector lifecycle authority smoke");

    console.log(JSON.stringify({
      ok: true,
      scope: "collector-live",
      collector_base_url: `http://127.0.0.1:${COLLECTOR_PORT}`,
      assertions: [
        "temporary collector booted with backend JWT projection config",
        "bootstrap backend owner can authenticate through collector",
        "collector syncs backend directory users after explicit /api/users/sync call",
        "collector rejects wrong backend credentials without local fallback",
        "collector lifecycle mutation endpoints stay rejected",
      ],
    }, null, 2));
  } finally {
    if (createdDirectoryUserId > 0) {
      await requestJson(`${BACKEND_BASE_URL}/users/${createdDirectoryUserId}`, {
        method: "DELETE",
        token: backendOwnerToken,
      }).catch(() => null);
    }
    await stopCollector(collectorHandle).catch(() => null);
  }
}

main().catch((err) => {
  console.error(`smoke-lifecycle-authority-live: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
