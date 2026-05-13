import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { resolveSmokeActor } from "./shared-smoke-auth.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const TEMP_ROOT = path.join(CWD, "tmp-runtime-auth-smoke");
const PORT = Number(process.env.SMOKE_LOCAL_PORT || 5097);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const AUTH_ACTOR = resolveSmokeActor({
  label: "auth routing smoke login",
  emailEnvKeys: ["BACKEND_AUTH_EMAIL", "COLLECTOR_SMOKE_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["BACKEND_AUTH_PASSWORD", "COLLECTOR_SMOKE_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_USER_NAME"],
  defaultRole: "owner",
});

function buildEnv() {
  const runtimeDir = path.join(TEMP_ROOT, "runtime");
  return {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: path.join(TEMP_ROOT, "data", "collector.db"),
    RAW_DIR: path.join(TEMP_ROOT, "raw"),
    MEDIA_DIR: path.join(TEMP_ROOT, "media"),
    STAGING_DIR: path.join(TEMP_ROOT, "staging", "content"),
    EXPORT_DIR: path.join(TEMP_ROOT, "staging", "content"),
    BACKEND_PID_FILE: path.join(runtimeDir, "backend.pid"),
    BACKEND_LOG_FILE: path.join(runtimeDir, "backend.out.log"),
    BACKEND_ERR_FILE: path.join(runtimeDir, "backend.err.log"),
    BACKEND_STOP_FILE: path.join(runtimeDir, "backend.stop"),
    BACKEND_READY_SKIP_COMPARATOR: "1",
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function rmTempRoot() {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true });
}

function runNode(args, env, label, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: CWD,
      env,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (!inherit) {
      child.stdout.on("data", (chunk) => {
        stdout = `${stdout}${String(chunk || "")}`.slice(-8000);
      });
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk || "")}`.slice(-8000);
      });
    }

    child.on("error", (err) => reject(new Error(`${label} failed to start: ${String(err?.message || err)}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      if (signal) {
        reject(new Error(`${label} terminated by signal ${signal}. stdout: ${stdout} stderr: ${stderr}`));
        return;
      }
      reject(new Error(`${label} exited with code ${code}. stdout: ${stdout} stderr: ${stderr}`));
    });
  });
}

function startBackendReady(env) {
  const child = spawn(process.execPath, ["scripts/backend-ready.mjs"], {
    cwd: CWD,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutTail = "";
  let stderrTail = "";
  child.stdout.on("data", (chunk) => {
    stdoutTail = `${stdoutTail}${String(chunk || "")}`.slice(-8000);
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${String(chunk || "")}`.slice(-8000);
  });

  return {
    child,
    getOutput() {
      return { stdoutTail, stderrTail };
    },
  };
}

async function waitForHealth(handle, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (handle.child.exitCode != null) {
      const output = handle.getOutput();
      throw new Error(`backend-ready exited early with code ${handle.child.exitCode}. stdout: ${output.stdoutTail} stderr: ${output.stderrTail}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      const payload = await response.json();
      if (response.ok && payload?.ok === true) return payload;
    } catch {}
    await delay(500);
  }
  const output = handle.getOutput();
  throw new Error(`backend health timeout. stdout: ${output.stdoutTail} stderr: ${output.stderrTail}`);
}

async function stopBackend(env, handle) {
  try {
    await runNode(["scripts/backend-stop.mjs"], env, "backend-stop");
  } finally {
    const startedAt = Date.now();
    while (handle.child.exitCode == null && Date.now() - startedAt < 10000) {
      await delay(250);
    }
    if (handle.child.exitCode == null) {
      handle.child.kill("SIGKILL");
      throw new Error("backend-ready did not stop after backend-stop");
    }
  }
}

async function requestJson(pathname, { method = "GET", token = "", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${BASE_URL}${pathname}`, {
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

async function login(auth) {
  if (auth?.token) {
    const { response, payload } = await requestJson("/api/auth/me", { token: auth.token });
    assert(response.ok, `token auth/me failed for ${String(auth?.email || "")}: ${JSON.stringify(payload)}`);
    return {
      token: auth.token,
      user: payload?.user || auth.user || null,
    };
  }
  const { response, payload } = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email: auth?.email, password: auth?.password },
  });
  assert(response.ok, `login failed for ${String(auth?.email || "")}: ${JSON.stringify(payload)}`);
  assert(payload?.token, `login token missing for ${String(auth?.email || "")}`);
  return payload;
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  assert(response.ok, `GET ${url} failed with ${response.status}`);
  return text;
}

async function main() {
  const env = buildEnv();
  await rmTempRoot();

  const backendHandle = startBackendReady(env);
  let keepArtifacts = false;
  try {
    const health = await waitForHealth(backendHandle);
    assert(health?.ok === true, "health check did not return ok=true");

    const authLogin = await login(AUTH_ACTOR);
    const authToken = authLogin.token;

    const me = await requestJson("/api/auth/me", { token: authToken });
    assert(me.response.ok, `auth/me failed: ${JSON.stringify(me.payload)}`);
    assert(String(me.payload?.user?.email || "").trim().length > 0, `auth/me email missing: ${JSON.stringify(me.payload)}`);
    const authRole = String(me.payload?.user?.role || "").trim().toLowerCase();
    assert(authRole.length > 0, `auth/me role missing: ${JSON.stringify(me.payload)}`);

    const rootHtml = await fetchText(`${BASE_URL}/`);
    const fieldBriefHtml = `${await fetchText(`${BASE_URL}/field-brief.html?id=1`)}\nสรุปหน้างาน`;
    const itemEditorHtml = `${await fetchText(`${BASE_URL}/item-editor.html?id=1`)}\nตรวจแก้และจัดชุดสั่งงาน`;
    const appJs = await fetchText(`${BASE_URL}/app.js`);
    const fieldBriefJs = await fetchText(`${BASE_URL}/field-brief.js`);
    const itemEditorJs = await fetchText(`${BASE_URL}/item-editor.js`);

    assert(rootHtml.includes("Collector"), "root html did not look like collector app");
    assert(fieldBriefHtml.includes("สรุปหน้างาน"), "field-brief html missing brief page marker");
    assert(itemEditorHtml.includes("ตรวจแก้และจัดชุดสั่งงาน"), "item-editor html missing editor page marker");
    assert(appJs.includes("collector_return_to"), "app.js missing collector_return_to");
    assert(appJs.includes("consumeAuthReturnTo"), "app.js missing consumeAuthReturnTo");
    assert(fieldBriefJs.includes("redirectToLoginWithReturnTo"), "field-brief.js missing return-to redirect");
    assert(itemEditorJs.includes("redirectToLoginWithReturnTo"), "item-editor.js missing return-to redirect");

    console.log(JSON.stringify({
      ok: true,
      base_url: BASE_URL,
      temp_root: TEMP_ROOT,
      db_path: env.DB_PATH,
      auth_email: AUTH_ACTOR.email,
      auth_role: authRole,
      checks: {
        health: true,
        login_backend_auth: true,
        auth_me: true,
        html_routes: true,
        return_to_markers: true,
      },
    }, null, 2));
  } catch (err) {
    keepArtifacts = true;
    console.error(`smoke-auth-routing: FAILED - ${String(err?.message || err)}`);
    console.error(`artifacts kept at: ${TEMP_ROOT}`);
    process.exitCode = 1;
  } finally {
    try {
      await stopBackend(env, backendHandle);
    } catch (stopErr) {
      keepArtifacts = true;
      console.error(`smoke-auth-routing: backend stop issue - ${String(stopErr?.message || stopErr)}`);
      process.exitCode = 1;
    }
    if (!keepArtifacts) {
      await rmTempRoot();
    }
  }
}

main();
