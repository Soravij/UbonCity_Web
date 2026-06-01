import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { resolveSmokeActor } from "./shared-smoke-auth.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const SMOKE_PORT = Number(process.env.BACKEND_SMOKE_PORT || 5096);
const PID_FILE = path.join(CWD, "runtime", "backend-smoke.pid");
const BASE_URL = `http://127.0.0.1:${SMOKE_PORT}`;

function resolveAuthCredentials() {
  return resolveSmokeActor({
    label: "backend smoke login",
    emailEnvKeys: ["BACKEND_AUTH_EMAIL", "COLLECTOR_SMOKE_EMAIL", "COLLECTOR_TEST_EMAIL"],
    passwordEnvKeys: ["BACKEND_AUTH_PASSWORD", "COLLECTOR_SMOKE_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
    userIdEnvKeys: ["COLLECTOR_TEST_USER_ID"],
    roleEnvKeys: ["COLLECTOR_TEST_USER_ROLE"],
    displayNameEnvKeys: ["COLLECTOR_TEST_USER_NAME"],
    defaultRole: "owner",
  });
}

function buildChildEnv() {
  return {
    ...process.env,
    PORT: String(SMOKE_PORT),
    BACKEND_PID_FILE: PID_FILE,
    BACKEND_READY_MODE: "non_mutating",
  };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !["ESRCH"].includes(String(err?.code || ""));
  }
}

async function clearSmokePidFile() {
  try {
    const raw = await fs.readFile(PID_FILE, "utf8");
    const payload = JSON.parse(raw);
    const pid = Number(payload?.pid || 0);
    if (pid > 0 && isProcessAlive(pid)) {
      throw new Error(`smoke pid file points to running process ${pid}; stop it before running backend:smoke again`);
    }
  } catch (err) {
    if (String(err?.code || "") !== "ENOENT") {
      const message = String(err?.message || err);
      if (message.includes("smoke pid file points to running process")) {
        throw err;
      }
    }
  }
  await fs.rm(PID_FILE, { force: true });
}

function startBackendReady() {
  const env = buildChildEnv();
  const child = spawn(process.execPath, ["scripts/backend-ready.mjs"], {
    cwd: CWD,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutTail = "";
  let stderrTail = "";

  child.stdout.on("data", (chunk) => {
    const text = String(chunk || "");
    stdoutTail = `${stdoutTail}${text}`.slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk || "");
    stderrTail = `${stderrTail}${text}`.slice(-4000);
  });

  return {
    child,
    getOutput() {
      return {
        stdoutTail,
        stderrTail,
      };
    },
  };
}

async function waitForHealth(backendHandle, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (backendHandle.child.exitCode != null) {
      const output = backendHandle.getOutput();
      throw new Error(
        `backend-ready exited early with code ${backendHandle.child.exitCode}. stdout tail: ${output.stdoutTail} stderr tail: ${output.stderrTail}`
      );
    }
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      const payload = await response.json();
      if (response.ok && payload?.ok === true) {
        return payload;
      }
    } catch {}
    await delay(500);
  }
  const output = backendHandle.getOutput();
  throw new Error(`backend health did not become ready. stdout tail: ${output.stdoutTail} stderr tail: ${output.stderrTail}`);
}

async function stopBackend() {
  const env = buildChildEnv();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/backend-stop.mjs"], {
      cwd: CWD,
      env,
      stdio: "inherit",
    });
    child.on("error", (err) => reject(new Error(`backend-stop failed to start: ${String(err?.message || err)}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`backend-stop terminated by signal ${signal}`));
        return;
      }
      reject(new Error(`backend-stop exited with code ${code}`));
    });
  });
}

async function waitForBackendExit(backendHandle, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (backendHandle.child.exitCode == null && Date.now() - startedAt < timeoutMs) {
    await delay(250);
  }
  if (backendHandle.child.exitCode == null) {
    backendHandle.child.kill("SIGKILL");
    throw new Error("backend-ready did not exit after backend-stop");
  }
}

async function main() {
  const auth = resolveAuthCredentials();
  await clearSmokePidFile();

  const backendHandle = startBackendReady();
  try {
    const health = await waitForHealth(backendHandle);
    const loginPayload = auth.token
      ? { token: auth.token, user: auth.user || null, auth_mode: auth.auth_mode }
      : await (async () => {
        const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: auth.email, password: auth.password }),
        });
        const payload = await loginResponse.json();
        if (!loginResponse.ok || !payload?.token) {
          throw new Error(`login failed: ${JSON.stringify(payload)}`);
        }
        return payload;
      })();

    const authHeaders = { authorization: `Bearer ${loginPayload.token}` };
    const meResponse = await fetch(`${BASE_URL}/api/auth/me`, { headers: authHeaders });
    const mePayload = await meResponse.json();
    if (!meResponse.ok || !mePayload?.user?.email) {
      throw new Error(`auth/me failed: ${JSON.stringify(mePayload)}`);
    }

    const itemsResponse = await fetch(`${BASE_URL}/api/items`, { headers: authHeaders });
    const itemsPayload = await itemsResponse.json();
    if (!itemsResponse.ok || !Array.isArray(itemsPayload)) {
      throw new Error(`items failed: ${JSON.stringify(itemsPayload)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          port: SMOKE_PORT,
          ready_mode: "non_mutating",
          service: health?.service || null,
          login_user: loginPayload.user?.email || null,
          login_role: loginPayload.user?.role || null,
          auth_me_user: mePayload.user?.email || null,
          items_count: itemsPayload.length,
        },
        null,
        2
      )
    );
  } finally {
    try {
      await stopBackend();
    } finally {
      await waitForBackendExit(backendHandle);
      await fs.rm(PID_FILE, { force: true });
    }
  }
}

main().catch((err) => {
  console.error(`backend-smoke: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
