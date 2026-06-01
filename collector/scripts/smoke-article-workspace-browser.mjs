import "dotenv/config";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { assertLoginRole, resolveSmokeActor } from "./shared-smoke-auth.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const TEMP_ROOT = path.join(CWD, "tmp-runtime-article-browser-smoke");
const PORT = Number(process.env.SMOKE_LOCAL_PORT || 5098);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = Number(process.env.SMOKE_BROWSER_DEBUG_PORT || 9233);
const BROWSER_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const BACKEND_SYNC_BASE_URL = String(
  process.env.COLLECTOR_SYNC_BACKEND_API
  || process.env.BACKEND_API_BASE_URL
  || process.env.BACKEND_URL
  || "http://127.0.0.1:5000/api"
)
  .trim()
  .replace(/\/+$/, "");
const ADMIN_AUTH = resolveSmokeActor({
  label: "article workspace browser smoke admin login",
  emailEnvKeys: ["COLLECTOR_SMOKE_ADMIN_EMAIL", "BACKEND_AUTH_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_SMOKE_ADMIN_PASSWORD", "BACKEND_AUTH_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_ADMIN_USER_ID", "COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_ADMIN_ROLE", "COLLECTOR_TEST_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_ADMIN_NAME", "COLLECTOR_TEST_USER_NAME"],
  defaultRole: "owner",
});
const EDITOR_AUTH = resolveSmokeActor({
  label: "article workspace browser smoke editor login",
  emailEnvKeys: ["COLLECTOR_SMOKE_EDITOR_EMAIL", "COLLECTOR_TEST_EDITOR_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_SMOKE_EDITOR_PASSWORD", "COLLECTOR_TEST_EDITOR_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_EDITOR_USER_ID", "COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_EDITOR_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_EDITOR_NAME", "COLLECTOR_TEST_USER_NAME"],
  defaultRole: "editor",
});
const COVER_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWP4//8/AwAI/AL+J5AZWQAAAABJRU5ErkJggg==";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
    COLLECTOR_PUBLIC_BASE_URL: BASE_URL,
    COLLECTOR_SYNC_BACKEND_API: BACKEND_SYNC_BASE_URL,
    LIFECYCLE_SYNC_TOKEN: String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim(),
    OPENAI_API_KEY: "",
    TRANSLATION_TARGET_LANGS: "en,lo",
  };
}

async function rmTempRoot() {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true });
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
      stdout = `${stdout}${String(chunk || "")}`.slice(-8000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk || "")}`.slice(-8000);
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
    const result = await requestJson("/api/auth/me", { token: auth.token });
    assert(result.response.ok, `token auth/me failed for ${String(auth?.email || "")}: ${JSON.stringify(result.payload)}`);
    return {
      token: auth.token,
      user: result.payload?.user || auth.user || null,
    };
  }
  const result = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email: auth?.email, password: auth?.password },
  });
  assert(result.response.ok, `login failed for ${String(auth?.email || "")}: ${JSON.stringify(result.payload)}`);
  assert(result.payload?.token, `login token missing for ${String(auth?.email || "")}`);
  return result.payload;
}

async function createItem(token) {
  const result = await requestJson("/api/items", {
    method: "POST",
    token,
    body: {
      title: "Browser Smoke Article",
      type: "place",
      category: "attractions",
      lang: "th",
      workflow_patch: {
        production_state: "generated",
        publication_state: "draft",
      },
    },
  });
  assert(result.response.ok, `create item failed: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function transitionArticle(token, itemId, status, note = "") {
  const result = await requestJson(`/api/items/${itemId}/article-process/transition`, {
    method: "POST",
    token,
    body: { status, note },
  });
  assert(result.response.ok, `article transition ${status} failed: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function waitForItemWorkflowStatus(token, itemId, expectedStatus, timeoutMs = 30000) {
  const expected = String(expectedStatus || "").trim().toLowerCase();
  const startedAt = Date.now();
  let lastPayload = null;
  while (Date.now() - startedAt < timeoutMs) {
    const result = await requestJson(`/api/items/${itemId}`, { token });
    if (!result.response.ok) {
      throw new Error(`item fetch failed while waiting for ${expected}: ${JSON.stringify(result.payload)}`);
    }
    lastPayload = result.payload || null;
    if (String(lastPayload?.workflow_status || "").trim().toLowerCase() === expected) {
      return lastPayload;
    }
    await delay(500);
  }
  throw new Error(`item workflow_status timeout for ${expected}: ${JSON.stringify(lastPayload)}`);
}

async function waitForArticleProcessStatus(token, itemId, expectedStatus, timeoutMs = 30000) {
  const expected = String(expectedStatus || "").trim().toLowerCase();
  const startedAt = Date.now();
  let lastPayload = null;
  while (Date.now() - startedAt < timeoutMs) {
    const result = await requestJson(`/api/items/${itemId}/article-process`, { token });
    if (!result.response.ok) {
      throw new Error(`article process fetch failed while waiting for ${expected}: ${JSON.stringify(result.payload)}`);
    }
    lastPayload = result.payload || null;
    if (String(lastPayload?.status || "").trim().toLowerCase() === expected) {
      return lastPayload;
    }
    await delay(500);
  }
  throw new Error(`article process status timeout for ${expected}: ${JSON.stringify(lastPayload)}`);
}

async function uploadCoverAsset(token, itemId) {
  const formData = new FormData();
  formData.append("content_item_id", String(itemId));
  formData.append("role", "cover");
  formData.append("file", new Blob([Buffer.from(COVER_PNG_BASE64, "base64")], { type: "image/png" }), "smoke-cover.png");
  const response = await fetch(`${BASE_URL}/api/assets/upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  assert(response.ok, `upload cover failed: ${JSON.stringify(payload)}`);
  assert((Number(payload?.id || 0) || 0) > 0, `upload cover id missing: ${JSON.stringify(payload)}`);
  return payload;
}

async function assignEditor(token, itemId, assigneeUserId) {
  const result = await requestJson(`/api/items/${itemId}/article-editorial-assignments`, {
    method: "POST",
    token,
    body: {
      assignee_user_id: assigneeUserId,
      internal_note: "browser smoke editorial assignment",
      replace_active: true,
    },
  });
  assert(result.response.ok, `assign editor failed: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function saveEditorWork(token, itemId, coverAssetUrl = "") {
  const safeCoverUrl = String(coverAssetUrl || "").trim();
  const body = [
    "<h2>Smoke Heading</h2>",
    "<p>Smoke paragraph for article workspace browser test.</p>",
    "<blockquote>Smoke quote block</blockquote>",
    "<ul><li>List item one</li><li>List item two</li></ul>",
    safeCoverUrl
      ? `<figure><img src="${safeCoverUrl}" alt="Smoke cover" /><figcaption>Smoke image</figcaption></figure>`
      : "<p>Smoke image placeholder</p>",
    '<figure class="embedded-video"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" loading="lazy" allowfullscreen></iframe><figcaption>Smoke video</figcaption></figure>',
  ].join("\n\n");
  const result = await requestJson(`/api/items/${itemId}/editor-work`, {
    method: "PUT",
    token,
    body: {
      item: {
        title: "Browser Smoke Article",
        summary: "Smoke excerpt",
        slug: "browser-smoke-article",
        meta_title: "Browser Smoke Meta",
        meta_description: "Browser smoke meta description",
        description_clean: body,
        description_raw: body,
      },
      draft: {
        draft_title: "Browser Smoke Article",
        excerpt: "Smoke excerpt",
        body,
        meta_title: "Browser Smoke Meta",
        meta_description: "Browser smoke meta description",
        status: "generated",
      },
    },
  });
  assert(result.response.ok, `save editor work failed: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

function resolveBrowserPath() {
  return BROWSER_PATHS.find((browserPath) => browserPath && fsSync.existsSync(browserPath)) || "";
}

function startBrowser(browserPath) {
  const userDataDir = path.join(TEMP_ROOT, "browser-profile");
  const child = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1440,960",
    "about:blank",
  ], {
    cwd: CWD,
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
    browserPath,
    userDataDir,
    getOutput() {
      return { stdoutTail, stderrTail };
    },
  };
}

async function stopBrowser(handle) {
  if (!handle?.child) return;
  handle.child.kill();
  const startedAt = Date.now();
  while (handle.child.exitCode == null && Date.now() - startedAt < 5000) {
    await delay(100);
  }
  if (handle.child.exitCode == null) {
    handle.child.kill("SIGKILL");
  }
}

async function waitForBrowserWsUrl(handle, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (handle.child.exitCode != null) {
      const output = handle.getOutput();
      throw new Error(`browser exited early with code ${handle.child.exitCode}. stdout: ${output.stdoutTail} stderr: ${output.stderrTail}`);
    }
    try {
      const listResponse = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await listResponse.json();
      const page = Array.isArray(list) ? list.find((entry) => String(entry?.type || "") === "page" && entry?.webSocketDebuggerUrl) : null;
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(250);
  }
  const output = handle.getOutput();
  throw new Error(`browser debug endpoint timeout. stdout: ${output.stdoutTail} stderr: ${output.stderrTail}`);
}

async function connectCdp(wsUrl) {
  assert(typeof WebSocket === "function", "global WebSocket is not available in this Node runtime");
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const eventQueue = new Map();
  const waiters = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (event) => reject(new Error(`cdp websocket failed: ${String(event?.message || "open error")}`)));
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data || "{}"));
    if (message.id) {
      const pendingEntry = pending.get(message.id);
      if (!pendingEntry) return;
      pending.delete(message.id);
      if (message.error) pendingEntry.reject(new Error(message.error.message || "CDP error"));
      else pendingEntry.resolve(message.result || {});
      return;
    }
    const method = String(message.method || "");
    if (!method) return;
    const waiterList = waiters.get(method);
    if (waiterList && waiterList.length) {
      const waiter = waiterList.shift();
      if (!waiterList.length) waiters.delete(method);
      waiter.resolve(message.params || {});
      return;
    }
    const queued = eventQueue.get(method) || [];
    queued.push(message.params || {});
    eventQueue.set(method, queued);
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  function waitFor(method, timeoutMs = 10000) {
    const queued = eventQueue.get(method);
    if (queued?.length) {
      return Promise.resolve(queued.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = waiters.get(method) || [];
        waiters.set(method, current.filter((entry) => entry.resolve !== resolve));
        reject(new Error(`timeout waiting for CDP event ${method}`));
      }, timeoutMs);
      const current = waiters.get(method) || [];
      current.push({
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
      });
      waiters.set(method, current);
    });
  }

  function drain(method) {
    const queued = eventQueue.get(method) || [];
    eventQueue.delete(method);
    return queued;
  }

  async function close() {
    try {
      ws.close();
    } catch {}
  }

  return { send, waitFor, drain, close };
}

async function navigate(client, url, timeoutMs = 15000) {
  const loadPromise = client.waitFor("Page.loadEventFired", timeoutMs);
  await client.send("Page.navigate", { url });
  await loadPromise;
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result?.result?.value;
}

async function waitForCondition(client, expression, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await evaluate(client, expression);
      if (value) return value;
    } catch {}
    await delay(250);
  }
  throw new Error(`condition timeout: ${expression}`);
}

async function captureWorkspaceSnapshot(client, itemId) {
  return evaluate(client, `(async () => {
    const fetchWithHeaders = async (url, options = {}) => {
      try {
        const response = await fetch(url, { credentials: "same-origin", ...options });
        return { status: response.status, text: await response.text() };
      } catch (err) {
        return { error: String(err) };
      }
    };
    return {
      href: window.location.href,
      authText: document.getElementById("workspace-auth-status")?.textContent || "",
      bannerText: document.getElementById("workspace-status")?.textContent || "",
      reviewStatusText: document.getElementById("review-status")?.textContent || "",
      chipText: document.getElementById("article-status-chip")?.textContent || "",
      summaryText: document.getElementById("sync-summary")?.textContent || "",
      sendDisabled: Boolean(document.getElementById("btn-send-main-site")?.disabled),
      hasApproveAction: Boolean(document.getElementById("btn-approve-sync")),
      processStepCount: document.querySelectorAll("#article-process-bar .step").length,
      smokeErrors: Array.isArray(window.__articleWorkspaceSmokeErrors) ? window.__articleWorkspaceSmokeErrors : [],
      articleProcess: await fetchWithHeaders("/api/items/${itemId}/article-process"),
      itemPayload: await fetchWithHeaders("/api/items/${itemId}"),
    };
  })()`).catch(() => null);
}

async function openWorkspaceAs(client, token, itemId) {
  const storageScript = `
    try { sessionStorage.setItem("collector_token", ${JSON.stringify(String(token || ""))}); } catch {}
    try { localStorage.setItem("collector_token", ${JSON.stringify(String(token || ""))}); } catch {}
    if (!window.__collectorSmokeFetchPatched) {
      const smokeToken = ${JSON.stringify(String(token || ""))};
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init = {}) => {
        const requestUrl = typeof input === "string" ? input : String(input?.url || "");
        const headers = new Headers(init?.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
        if (smokeToken && /^\\/api\\//.test(requestUrl) && !headers.has("Authorization")) {
          headers.set("Authorization", "Bearer " + smokeToken);
        }
        return originalFetch(input, { ...init, headers });
      };
      window.__collectorSmokeFetchPatched = true;
    }
  `;
  if (client.__collectorAuthScriptId) {
    await client.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: client.__collectorAuthScriptId,
    }).catch(() => {});
  }
  const result = await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: storageScript,
  });
  client.__collectorAuthScriptId = result?.identifier || "";
  await navigate(client, `${BASE_URL}/article-workspace.html?id=${itemId}`);
  await evaluate(client, `${storageScript} true;`);
  try {
    await waitForCondition(client, 'document.querySelectorAll("#article-process-bar .step").length === 3');
  } catch (err) {
    const snapshot = await evaluate(client, `(async () => {
      const fetchWithTimeout = async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort("timeout"), 5000);
        try {
          const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
          return { status: response.status, text: await response.text() };
        } catch (fetchErr) {
          return { error: String(fetchErr) };
        } finally {
          clearTimeout(timer);
        }
      };
      const authMe = await fetchWithTimeout("/api/auth/me");
      const itemPayload = await fetchWithTimeout("/api/items/${itemId}");
      const processPayload = await fetchWithTimeout("/api/items/${itemId}/article-process");
      const assetsPayload = await fetchWithTimeout("/api/assets?content_item_id=${itemId}");
      const scriptFetch = await (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort("timeout"), 5000);
        try {
          const response = await fetch("/article-workspace.js", { signal: controller.signal });
          return {
            status: response.status,
            contentType: response.headers.get("content-type") || "",
            textPrefix: (await response.text()).slice(0, 120),
          };
        } catch (fetchErr) {
          return { error: String(fetchErr) };
        } finally {
          clearTimeout(timer);
        }
      })();
      const scriptEval = await (async () => {
        try {
          const code = await fetch("/article-workspace.js").then((response) => response.text());
          const runner = new Function(code + "\\nreturn { ready: document.readyState, auth: document.getElementById(\\"workspace-auth-status\\")?.textContent || \\"\\" };");
          return { ok: true, result: runner() };
        } catch (evalErr) {
          return { error: String(evalErr) };
        }
      })();
      const moduleImport = await import("/article-workspace.js?smoke_debug=1").then(() => "ok").catch((importErr) => String(importErr));
      return {
        href: window.location.href,
        readyState: document.readyState,
        hasToken: Boolean(sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token")),
        processStepCount: document.querySelectorAll("#article-process-bar .step").length,
        authText: document.getElementById("workspace-auth-status")?.textContent || "",
        statusText: document.getElementById("workspace-status")?.textContent || "",
        bodyText: (document.body?.innerText || "").slice(0, 800),
        resources: performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType || "",
        })).filter((entry) => /article-workspace\\.js|theme-control|styles\\.css/i.test(entry.name)),
        smokeErrors: Array.isArray(window.__articleWorkspaceSmokeErrors) ? window.__articleWorkspaceSmokeErrors : [],
        authMe,
        itemPayload,
        processPayload,
        scriptFetch,
        scriptEval,
        moduleImport,
        assetsPayload
      };
    })()`).catch(() => null);
    const runtimeErrors = client.drain("Runtime.exceptionThrown");
    const consoleCalls = client.drain("Runtime.consoleAPICalled");
    const loadingFailed = client.drain("Network.loadingFailed");
    const responseReceived = client
      .drain("Network.responseReceived")
      .filter((entry) => /article-workspace\.js|article-workspace\.html|theme-control|styles\.css/i.test(String(entry?.response?.url || "")));
    throw new Error(`article workspace did not initialize: ${String(err?.message || err)} snapshot=${JSON.stringify(snapshot)} runtime_errors=${JSON.stringify(runtimeErrors)} console=${JSON.stringify(consoleCalls)} loading_failed=${JSON.stringify(loadingFailed)} responses=${JSON.stringify(responseReceived)}`);
  }
}

async function openReviewAs(client, token, itemId) {
  const storageScript = `
    try { sessionStorage.setItem("collector_token", ${JSON.stringify(String(token || ""))}); } catch {}
    try { localStorage.setItem("collector_token", ${JSON.stringify(String(token || ""))}); } catch {}
    if (!window.__collectorSmokeFetchPatched) {
      const smokeToken = ${JSON.stringify(String(token || ""))};
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init = {}) => {
        const requestUrl = typeof input === "string" ? input : String(input?.url || "");
        const headers = new Headers(init?.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
        if (smokeToken && /^\\/api\\//.test(requestUrl) && !headers.has("Authorization")) {
          headers.set("Authorization", "Bearer " + smokeToken);
        }
        return originalFetch(input, { ...init, headers });
      };
      window.__collectorSmokeFetchPatched = true;
    }
  `;
  if (client.__collectorAuthScriptId) {
    await client.send("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: client.__collectorAuthScriptId,
    }).catch(() => {});
  }
  const result = await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: storageScript,
  });
  client.__collectorAuthScriptId = result?.identifier || "";
  await navigate(client, `${BASE_URL}/article-submit.html?id=${itemId}`);
  await evaluate(client, `${storageScript} true;`);
  await waitForCondition(client, 'document.querySelectorAll("#article-process-bar .step").length === 3');
}

async function main() {
  const env = buildEnv();
  const browserPath = resolveBrowserPath();
  assert(browserPath, "No Edge/Chrome executable found for browser smoke");

  await rmTempRoot();
  const backendHandle = startBackendReady(env);
  let browserHandle = null;
  let cdp = null;
  let keepArtifacts = false;

  try {
    await waitForHealth(backendHandle);

    const adminLogin = await login(ADMIN_AUTH);
    const editorLogin = await login(EDITOR_AUTH);
    const editorId = Number(editorLogin?.user?.id || 0) || 0;
    assert(editorId > 0, "editor id missing");
    assertLoginRole(adminLogin, ["admin", "owner"], "article workspace browser smoke admin");
    assertLoginRole(editorLogin, ["editor"], "article workspace browser smoke editor");

    const item = await createItem(adminLogin.token);
    const itemId = Number(item?.id || 0);
    assert(itemId > 0, "item id missing");

    await transitionArticle(adminLogin.token, itemId, "drafting", "browser smoke intake seed");
    await assignEditor(adminLogin.token, itemId, editorId);
    const coverAsset = await uploadCoverAsset(adminLogin.token, itemId);
    await saveEditorWork(editorLogin.token, itemId, String(coverAsset?.public_url || ""));

    browserHandle = startBrowser(browserPath);
    const wsUrl = await waitForBrowserWsUrl(browserHandle);
    cdp = await connectCdp(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__articleWorkspaceSmokeErrors = [];
        window.addEventListener("error", (event) => {
          window.__articleWorkspaceSmokeErrors.push({
            type: "error",
            message: String(event?.message || ""),
            filename: String(event?.filename || ""),
          });
        });
        window.addEventListener("unhandledrejection", (event) => {
          window.__articleWorkspaceSmokeErrors.push({
            type: "unhandledrejection",
            reason: String(event?.reason || ""),
          });
        });
      `,
    });

    await openWorkspaceAs(cdp, editorLogin.token, itemId);
    await waitForCondition(cdp, 'document.querySelectorAll("#article-blocks .article-block-card").length >= 6');
    const editorSnapshot = await evaluate(cdp, `(() => ({
      blockTitles: Array.from(document.querySelectorAll("#article-blocks .article-block-card strong")).map((node) => node.textContent || ""),
      hasApproveAction: Boolean(document.getElementById("btn-approve-sync")),
      saveDisabled: Boolean(document.getElementById("btn-save-workspace")?.disabled),
      submitDisabled: Boolean(document.getElementById("btn-submit-review")?.disabled)
    }))()`);
    assert(Array.isArray(editorSnapshot?.blockTitles) && editorSnapshot.blockTitles.length >= 6, `workspace blocks missing: ${JSON.stringify(editorSnapshot)}`);
    assert(editorSnapshot?.blockTitles?.some((title) => String(title).includes("Quote")), `quote block missing: ${JSON.stringify(editorSnapshot)}`);
    assert(editorSnapshot?.blockTitles?.some((title) => String(title).includes("List")), `list block missing: ${JSON.stringify(editorSnapshot)}`);
    assert(editorSnapshot?.blockTitles?.some((title) => String(title).includes("Video")), `video block missing: ${JSON.stringify(editorSnapshot)}`);
    assert(editorSnapshot?.hasApproveAction === false, `workspace should not expose approve action: ${JSON.stringify(editorSnapshot)}`);
    assert(editorSnapshot?.saveDisabled === false, `editor save should be enabled: ${JSON.stringify(editorSnapshot)}`);
    assert(editorSnapshot?.submitDisabled === false, `editor submit should be enabled: ${JSON.stringify(editorSnapshot)}`);
    await evaluate(cdp, 'document.getElementById("btn-submit-review")?.click(); true;');
    try {
      await waitForCondition(cdp, 'window.location.pathname.includes("/article-intake.html") || window.location.pathname.includes("/article-submit.html")', 20000);
    } catch (err) {
      const submitSnapshot = await evaluate(cdp, `(async () => {
        const fetchWithHeaders = async (url, options = {}) => {
          try {
            const response = await fetch(url, { credentials: "same-origin", ...options });
            return { status: response.status, text: await response.text() };
          } catch (fetchErr) {
            return { error: String(fetchErr) };
          }
        };
        return {
          href: window.location.href,
          reviewStatus: document.getElementById("review-status")?.textContent || "",
          workspaceStatus: document.getElementById("workspace-status")?.textContent || "",
          submitDisabled: Boolean(document.getElementById("btn-submit-review")?.disabled),
          processPayload: await fetchWithHeaders("/api/items/${itemId}/article-process"),
          itemPayload: await fetchWithHeaders("/api/items/${itemId}")
        };
      })()`).catch(() => null);
      throw new Error(`workspace submit review did not redirect: ${String(err?.message || err)} snapshot=${JSON.stringify(submitSnapshot)}`);
    }
    await waitForItemWorkflowStatus(adminLogin.token, itemId, "in_review", 20000);

    await openReviewAs(cdp, adminLogin.token, itemId);
    await waitForCondition(cdp, 'Boolean(document.getElementById("btn-generate-translations")) && Boolean(document.getElementById("btn-approve-sync"))', 15000);
    await waitForCondition(cdp, 'document.getElementById("btn-approve-sync")?.disabled === true', 10000);
    await evaluate(cdp, 'document.getElementById("btn-generate-translations")?.click(); true;');
    await waitForCondition(cdp, 'document.getElementById("btn-generate-translations")?.getAttribute("aria-busy") === "true"', 10000);
    await waitForCondition(cdp, 'document.getElementById("btn-generate-translations")?.getAttribute("aria-busy") !== "true"', 30000);
    await waitForCondition(cdp, 'document.querySelectorAll("#translation-summary .article-translation-row").length >= 2', 15000);
    await waitForCondition(cdp, 'Array.from(document.querySelectorAll("#translation-summary .article-translation-row span")).length >= 2 && Array.from(document.querySelectorAll("#translation-summary .article-translation-row span")).every((node) => node.classList.contains("ok"))', 15000);
    await waitForCondition(cdp, '!document.getElementById("btn-approve-sync")?.disabled', 20000);
    const adminBeforeApprove = await evaluate(cdp, `(() => ({
      approveDisabled: Boolean(document.getElementById("btn-approve-sync")?.disabled),
      sendDisabled: Boolean(document.getElementById("btn-send-main-site")?.disabled)
    }))()`);
    assert(adminBeforeApprove?.approveDisabled === false, `admin approve should be enabled: ${JSON.stringify(adminBeforeApprove)}`);
    assert(adminBeforeApprove?.sendDisabled === true, `send should stay disabled before approval: ${JSON.stringify(adminBeforeApprove)}`);

    await evaluate(cdp, 'document.getElementById("review-note").value = "browser smoke approve"; true;');
    await evaluate(cdp, 'document.getElementById("btn-approve-sync")?.click(); true;');
    try {
      await waitForCondition(cdp, '!document.getElementById("btn-send-main-site")?.disabled', 20000);
    } catch (err) {
      const approveSnapshot = await captureWorkspaceSnapshot(cdp, itemId);
      throw new Error(`admin approve did not unlock send-main-site: ${String(err?.message || err)} snapshot=${JSON.stringify(approveSnapshot)}`);
    }
    await evaluate(cdp, 'document.getElementById("btn-refresh-readiness")?.click(); true;');
    await waitForCondition(cdp, 'String(document.getElementById("sync-summary")?.textContent || "").length > 0', 20000);

    const beforeSendSnapshot = await captureWorkspaceSnapshot(cdp, itemId);
    cdp.drain("Network.requestWillBeSent");
    cdp.drain("Network.responseReceived");
    cdp.drain("Network.loadingFailed");
    cdp.drain("Runtime.exceptionThrown");
    cdp.drain("Runtime.consoleAPICalled");

    await evaluate(cdp, 'document.getElementById("btn-send-main-site")?.click(); true;');
    try {
      const finalProcess = await waitForArticleProcessStatus(adminLogin.token, itemId, "submitted_for_admin_review", 30000);
      assert(String(finalProcess?.workflow_model?.publication_state || "").trim().toLowerCase() === "approved", `final publication_state should remain approved after admin-review submit: ${JSON.stringify(finalProcess)}`);
      assert(String(finalProcess?.workflow_model?.production_state || "").trim().toLowerCase() === "submitted_for_admin_review", `final article-process production_state should be submitted_for_admin_review: ${JSON.stringify(finalProcess)}`);
      await waitForCondition(cdp, 'document.getElementById("btn-send-main-site")?.disabled === true', 10000);
    } catch (err) {
      const afterSendSnapshot = await captureWorkspaceSnapshot(cdp, itemId);
      const requests = cdp
        .drain("Network.requestWillBeSent")
        .filter((entry) => /release-main|article-process|recheck-export-readiness/i.test(String(entry?.request?.url || "")));
      const responses = cdp
        .drain("Network.responseReceived")
        .filter((entry) => /release-main|article-process|recheck-export-readiness/i.test(String(entry?.response?.url || "")));
      const loadingFailed = cdp.drain("Network.loadingFailed");
      const runtimeErrors = cdp.drain("Runtime.exceptionThrown");
      const consoleCalls = cdp.drain("Runtime.consoleAPICalled");
      throw new Error(`release-main smoke failed: ${String(err?.message || err)} before=${JSON.stringify(beforeSendSnapshot)} after=${JSON.stringify(afterSendSnapshot)} requests=${JSON.stringify(requests)} responses=${JSON.stringify(responses)} loading_failed=${JSON.stringify(loadingFailed)} runtime_errors=${JSON.stringify(runtimeErrors)} console=${JSON.stringify(consoleCalls)}`);
    }

    const finalItem = await requestJson(`/api/items/${itemId}`, { token: adminLogin.token });
    assert(finalItem.response.ok, `final item fetch failed: ${JSON.stringify(finalItem.payload)}`);
    assert(String(finalItem.payload?.workflow_status || "").trim().toLowerCase() === "approved", `final workflow_status should remain approved after admin-review submit: ${JSON.stringify(finalItem.payload)}`);
    assert(String(finalItem.payload?.production_state || "").trim().toLowerCase() === "submitted_for_admin_review", `final production_state should be submitted_for_admin_review: ${JSON.stringify(finalItem.payload)}`);

    await waitForCondition(cdp, 'String(document.getElementById("translation-summary")?.textContent || "").length > 0', 10000);
    const translationPanel = await evaluate(cdp, `(() => ({
      summary: document.getElementById("translation-summary")?.textContent || "",
      generateDisabled: Boolean(document.getElementById("btn-generate-translations")?.disabled),
      refreshReadinessDisabled: Boolean(document.getElementById("btn-refresh-readiness")?.disabled)
    }))()`);
    assert(translationPanel?.summary?.length > 0, `translation summary should render after sync: ${JSON.stringify(translationPanel)}`);
    assert(/en|lo|passed|not_ready/i.test(String(translationPanel?.summary || "")), `translation summary should show target languages or statuses: ${JSON.stringify(translationPanel)}`);

    console.log(JSON.stringify({
      ok: true,
      base_url: BASE_URL,
      browser: browserPath,
      smoke_item_id: itemId,
      checks: {
        editor_workspace_loaded: true,
        editor_blocks_parsed: true,
        editor_submit_review: true,
        admin_approve_ready_for_sync: true,
        admin_submit_for_review: true,
        translation_phase_visible: true,
        translation_summary_after_sync: true,
      },
    }, null, 2));
  } catch (err) {
    keepArtifacts = true;
    console.error(`smoke-article-workspace-browser: FAILED - ${String(err?.message || err)}`);
    console.error(`artifacts kept at: ${TEMP_ROOT}`);
    process.exitCode = 1;
  } finally {
    if (cdp) {
      await cdp.close().catch(() => {});
    }
    if (browserHandle) {
      await stopBrowser(browserHandle).catch(() => {});
    }
    try {
      await stopBackend(env, backendHandle);
    } catch (stopErr) {
      keepArtifacts = true;
      console.error(`smoke-article-workspace-browser: backend stop issue - ${String(stopErr?.message || stopErr)}`);
      process.exitCode = 1;
    }
    if (!keepArtifacts) {
      await rmTempRoot();
    }
  }
}

main();
