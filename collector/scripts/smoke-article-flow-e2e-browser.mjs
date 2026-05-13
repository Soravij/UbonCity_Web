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
const TEMP_ROOT = path.join(CWD, "tmp-runtime-article-flow-e2e-smoke");
const PORT = Number(process.env.SMOKE_LOCAL_PORT || 5101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = Number(process.env.SMOKE_BROWSER_DEBUG_PORT || 9237);
const BROWSER_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const ADMIN_AUTH = resolveSmokeActor({
  label: "article flow browser smoke admin login",
  emailEnvKeys: ["COLLECTOR_SMOKE_ADMIN_EMAIL", "BACKEND_AUTH_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_SMOKE_ADMIN_PASSWORD", "BACKEND_AUTH_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_ADMIN_USER_ID", "COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_ADMIN_ROLE", "COLLECTOR_TEST_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_ADMIN_NAME", "COLLECTOR_TEST_USER_NAME"],
  defaultRole: "owner",
});
const EDITOR_AUTH = resolveSmokeActor({
  label: "article flow browser smoke editor login",
  emailEnvKeys: ["COLLECTOR_SMOKE_EDITOR_EMAIL", "COLLECTOR_TEST_EDITOR_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_SMOKE_EDITOR_PASSWORD", "COLLECTOR_TEST_EDITOR_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_EDITOR_USER_ID", "COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_EDITOR_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_EDITOR_NAME", "COLLECTOR_TEST_USER_NAME"],
  defaultRole: "editor",
});
const COVER_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWP4//8/AwAI/AL+J5AZWQAAAABJRU5ErkJggg==";
const TARGET_LANGS = ["en", "lo"];
const UPDATED_TITLE = "Article Flow Browser Smoke Updated";
const UPDATED_EXCERPT = "Smoke excerpt updated from workspace browser flow";
const UPDATED_HEADING = "Smoke heading updated from browser";
const BACKEND_SYNC_BASE_URL = String(
  process.env.COLLECTOR_SYNC_BACKEND_API
  || process.env.BACKEND_API_BASE_URL
  || process.env.BACKEND_URL
  || "http://127.0.0.1:5000/api"
)
  .trim()
  .replace(/\/+$/, "");

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
    TRANSLATION_TARGET_LANGS: TARGET_LANGS.join(","),
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
      title: "Article Flow Browser Smoke",
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

async function uploadCoverAsset(token, itemId) {
  const formData = new FormData();
  formData.append("content_item_id", String(itemId));
  formData.append("role", "cover");
  formData.append("file", new Blob([Buffer.from(COVER_PNG_BASE64, "base64")], { type: "image/png" }), "article-flow-cover.png");
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

async function saveEditorWork(token, itemId, coverAssetUrl = "") {
  const safeCoverUrl = String(coverAssetUrl || "").trim();
  const body = [
    "<h2>Smoke Heading</h2>",
    "<p>Smoke paragraph for article flow browser test. This paragraph is long enough to make translation checks more stable across languages and should not be treated as missing source context.</p>",
    "<blockquote>Smoke quote block for article review</blockquote>",
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
        title: "Article Flow Browser Smoke",
        type: "place",
        summary: "Smoke excerpt for article flow browser smoke",
        slug: "article-flow-browser-smoke",
        meta_title: "Article Flow Browser Smoke Meta",
        meta_description: "Smoke meta description for article flow browser smoke",
        description_clean: body,
        description_raw: body,
      },
      draft: {
        draft_title: "Article Flow Browser Smoke",
        excerpt: "Smoke excerpt for article flow browser smoke",
        body,
        meta_title: "Article Flow Browser Smoke Meta",
        meta_description: "Smoke meta description for article flow browser smoke",
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

  async function close() {
    try {
      ws.close();
    } catch {}
  }

  return { send, waitFor, close };
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

async function openPageAs(client, token, pathnameAndQuery) {
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
  await navigate(client, `${BASE_URL}${pathnameAndQuery}`);
  await evaluate(client, `${storageScript} true;`);
}

async function readItem(token, itemId) {
  const result = await requestJson(`/api/items/${itemId}`, { token });
  assert(result.response.ok, `fetch item failed: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function readArticleProcess(token, itemId) {
  const result = await requestJson(`/api/items/${itemId}/article-process`, { token });
  assert(result.response.ok, `fetch article process failed: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function waitForItemMatch(token, itemId, predicate, description, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastItem = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastItem = await readItem(token, itemId);
    if (predicate(lastItem)) return lastItem;
    await delay(500);
  }
  throw new Error(`${description} timeout for item ${itemId}: ${JSON.stringify(lastItem)}`);
}

async function waitForArticleProcessMatch(token, itemId, predicate, description, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastProcess = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastProcess = await readArticleProcess(token, itemId);
    if (predicate(lastProcess)) return lastProcess;
    await delay(500);
  }
  throw new Error(`${description} timeout for item ${itemId}: ${JSON.stringify(lastProcess)}`);
}

async function waitForArticleProcessStatus(token, itemId, expectedStatus, timeoutMs = 15000) {
  const target = String(expectedStatus || "").trim().toLowerCase();
  return waitForArticleProcessMatch(
    token,
    itemId,
    (processPayload) => String(processPayload?.status || "").trim().toLowerCase() === target,
    `article process status ${target}`,
    timeoutMs,
  );
}

async function listTranslations(token, itemId) {
  const result = await requestJson(`/api/translations?content_item_id=${itemId}`, { token });
  if (result.response.status === 429) {
    return { rate_limited: true, translations: [] };
  }
  assert(result.response.ok, `fetch translations failed: ${JSON.stringify(result.payload)}`);
  if (Array.isArray(result.payload)) return result.payload;
  return Array.isArray(result.payload?.translations) ? result.payload.translations : [];
}

async function waitForTranslationsReady(token, itemId, targetLangs, timeoutMs = 30000) {
  const expected = new Set(
    (Array.isArray(targetLangs) ? targetLangs : [])
      .map((lang) => String(lang || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const startedAt = Date.now();
  let lastRows = [];

  while (Date.now() - startedAt < timeoutMs) {
    const response = await listTranslations(token, itemId);
    if (response?.rate_limited) {
      await delay(1000);
      continue;
    }
    lastRows = response;
    const readyLangs = new Set(
      lastRows
        .filter((row) =>
          String(row?.translation_status || "").trim().toLowerCase() === "ready"
          && String(row?.automatic_check_status || "").trim().toLowerCase() === "passed"
          && Number(row?.stale_flag || 0) === 0
        )
        .map((row) => String(row?.lang || "").trim().toLowerCase())
        .filter(Boolean)
    );

    if ([...expected].every((lang) => readyLangs.has(lang))) {
      return lastRows;
    }
    await delay(500);
  }

  throw new Error(`translation readiness timeout for item ${itemId}: ${JSON.stringify(lastRows)}`);
}

async function waitForEditorialAssignment(token, itemId, assigneeUserId, timeoutMs = 15000) {
  const expectedId = Number(assigneeUserId || 0) || 0;
  const startedAt = Date.now();
  let lastProcess = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastProcess = await readArticleProcess(token, itemId);
    const active = lastProcess?.active_editorial_assignment || null;
    if (Number(active?.assignee_user_id || 0) === expectedId) {
      return lastProcess;
    }
    await delay(500);
  }
  throw new Error(`editorial assignment timeout for item ${itemId}: ${JSON.stringify(lastProcess)}`);
}

async function resolveAssignableEditorId(client, preferredId, preferredEmail = "", preferredDisplayName = "") {
  const snapshot = await evaluate(client, `(() => ({
    options: Array.from(document.getElementById("editor-assignee-select")?.options || []).map((option) => ({
      value: String(option.value || ""),
      label: String(option.textContent || "").trim(),
    })),
  }))()`);
  const options = Array.isArray(snapshot?.options) ? snapshot.options.filter((option) => option?.value) : [];
  if (!options.length) {
    throw new Error(`editor assignee select has no assignable options: ${JSON.stringify(snapshot)}`);
  }
  const normalizedPreferredId = String(preferredId || "").trim();
  const normalizedPreferredEmail = String(preferredEmail || "").trim().toLowerCase();
  const normalizedPreferredName = String(preferredDisplayName || "").trim().toLowerCase();
  const exactId = normalizedPreferredId ? options.find((option) => String(option.value || "") === normalizedPreferredId) : null;
  if (exactId) return Number(exactId.value);
  const emailMatch = normalizedPreferredEmail
    ? options.find((option) => String(option.label || "").toLowerCase().includes(normalizedPreferredEmail))
    : null;
  if (emailMatch) return Number(emailMatch.value);
  const nameMatch = normalizedPreferredName
    ? options.find((option) => String(option.label || "").toLowerCase().includes(normalizedPreferredName))
    : null;
  if (nameMatch) return Number(nameMatch.value);
  if (options.length === 1) return Number(options[0].value);
  throw new Error(`unable to resolve assignable editor option for preferred actor: ${JSON.stringify({ preferredId, preferredEmail, preferredDisplayName, options })}`);
}

async function assignEditorFromIntakePage(client, adminToken, itemId, editorId) {
  let lastSnapshot = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await evaluate(client, `(() => {
      const select = document.getElementById("editor-assignee-select");
      if (select) {
        select.value = "${editorId}";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const due = document.getElementById("editor-assignee-due-at");
      if (due) {
        due.value = "2026-04-06T12:00";
        due.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const note = document.getElementById("editor-assignee-note");
      if (note) {
        note.value = "browser smoke intake assignment";
        note.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    })()`);
    lastSnapshot = await evaluate(client, `(() => ({
      selectValue: document.getElementById("editor-assignee-select")?.value || "",
      optionValues: Array.from(document.getElementById("editor-assignee-select")?.options || []).map((option) => String(option.value || "")),
      buttonDisabled: Boolean(document.getElementById("btn-assign-editor")?.disabled),
      status: document.getElementById("assignment-status")?.textContent || "",
      auth: document.getElementById("workspace-auth-status")?.textContent || ""
    }))()`);
    await evaluate(client, 'document.getElementById("btn-assign-editor")?.click(); true;');
    try {
      return await waitForEditorialAssignment(adminToken, itemId, editorId, 5000);
    } catch {}
    await delay(500);
  }
  throw new Error(`editorial assignment did not stick from intake UI: ${JSON.stringify(lastSnapshot)}`);
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
    const preferredEditorId = Number(editorLogin?.user?.id || 0) || 0;
    assertLoginRole(adminLogin, ["admin", "owner"], "article flow browser smoke admin");
    assertLoginRole(editorLogin, ["editor"], "article flow browser smoke editor");

    const item = await createItem(adminLogin.token);
    const itemId = Number(item?.id || 0) || 0;
    assert(itemId > 0, "item id missing");

    await transitionArticle(adminLogin.token, itemId, "drafting", "browser smoke intake seed");

    browserHandle = startBrowser(browserPath);
    const wsUrl = await waitForBrowserWsUrl(browserHandle);
    cdp = await connectCdp(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    await openPageAs(cdp, adminLogin.token, `/article-intake.html?id=${itemId}`);
    await waitForCondition(cdp, 'document.querySelectorAll("#article-process-bar .step").length === 3');
    await waitForCondition(cdp, `Boolean(document.querySelector('.article-intake-group-table tbody button[data-action="select-item"][data-id="${itemId}"]'))`, 20000);
    await evaluate(cdp, `(() => {
      const btn = Array.from(document.querySelectorAll('.article-intake-group-table tbody button[data-action="select-item"]')).find((node) => String(node.dataset.id || "") === "${itemId}");
      if (btn) btn.click();
      return true;
    })()`);
    await waitForCondition(cdp, `Boolean(document.querySelector('.article-intake-group-table tbody tr.is-selected button[data-action="select-item"][data-id="${itemId}"]'))`, 10000);
    await waitForCondition(cdp, `!document.getElementById("btn-open-selected-workspace")?.disabled`, 10000);
    let editorId = 0;
    try {
      await waitForCondition(cdp, `Array.from(document.getElementById("editor-assignee-select")?.options || []).some((option) => String(option.value || "").trim().length > 0)`, 5000);
      editorId = await resolveAssignableEditorId(
        cdp,
        preferredEditorId,
        editorLogin?.user?.email || EDITOR_AUTH?.email || "",
        editorLogin?.user?.display_name || editorLogin?.user?.name || EDITOR_AUTH?.user?.display_name || ""
      );
      await assignEditorFromIntakePage(cdp, adminLogin.token, itemId, editorId);
    } catch {
      editorId = preferredEditorId;
      assert(editorId > 0, `assignable editor id missing and fallback editor id unavailable: ${JSON.stringify({ preferredEditorId, editorUser: editorLogin?.user || null })}`);
      await assignEditor(adminLogin.token, itemId, editorId);
    }

    const coverAsset = await uploadCoverAsset(adminLogin.token, itemId);
    await saveEditorWork(editorLogin.token, itemId, String(coverAsset?.public_url || ""));

    await evaluate(cdp, 'document.getElementById("btn-open-selected-workspace")?.click(); true;');
    await waitForCondition(cdp, `window.location.pathname.endsWith("/article-workspace.html")`, 15000);
    await openPageAs(cdp, editorLogin.token, `/article-workspace.html?id=${itemId}`);
    await waitForCondition(cdp, `window.location.pathname.endsWith("/article-workspace.html") && Boolean(document.getElementById("btn-save-workspace")) && Boolean(document.getElementById("btn-submit-review"))`, 15000);
    await waitForCondition(cdp, `document.querySelectorAll("#article-blocks .article-block-card").length >= 6 && document.getElementById("btn-approve-sync") === null`, 15000);
    await evaluate(cdp, `(() => {
      const title = document.getElementById("article-title");
      if (title) {
        title.value = ${JSON.stringify(UPDATED_TITLE)};
        title.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const excerpt = document.getElementById("article-excerpt");
      if (excerpt) {
        excerpt.value = ${JSON.stringify(UPDATED_EXCERPT)};
        excerpt.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const firstBlock = document.querySelector('#article-blocks textarea[data-block-field="text"]');
      if (firstBlock) {
        firstBlock.value = ${JSON.stringify(UPDATED_HEADING)};
        firstBlock.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    })()`);
    await evaluate(cdp, 'document.getElementById("btn-save-workspace")?.click(); true;');
    await waitForItemMatch(
      editorLogin.token,
      itemId,
      (currentItem) => String(currentItem?.title || "").trim() === UPDATED_TITLE && String(currentItem?.summary || "").trim() === UPDATED_EXCERPT,
      "saved workspace changes",
      15000,
    );
    await waitForCondition(cdp, `!document.getElementById("btn-submit-review")?.disabled`, 10000);
    await evaluate(cdp, 'document.getElementById("btn-submit-review")?.click(); true;');
    await waitForItemMatch(
      editorLogin.token,
      itemId,
      (currentItem) => String(currentItem?.workflow_status || "").trim().toLowerCase() === "in_review",
      "item workflow status in_review",
      20000,
    );

    const reviewItemBeforeAdmin = await readItem(editorLogin.token, itemId);
    assert(String(reviewItemBeforeAdmin?.workflow_status || "").trim().toLowerCase() === "in_review", `item should move to in_review after submit review: ${JSON.stringify(reviewItemBeforeAdmin)}`);

    await openPageAs(cdp, adminLogin.token, `/article-submit.html?id=${itemId}`);
    await waitForCondition(cdp, `window.location.pathname.endsWith("/article-submit.html") && Boolean(document.getElementById("btn-generate-translations")) && Boolean(document.getElementById("btn-approve-sync"))`, 15000);
    await waitForCondition(cdp, `document.querySelectorAll("#review-checklist input[type='checkbox']").length > 0`, 15000);
    await waitForCondition(cdp, `document.getElementById("btn-approve-sync")?.disabled === true`, 10000);
    await evaluate(cdp, 'document.getElementById("btn-generate-translations")?.click(); true;');
    await waitForCondition(cdp, `document.getElementById("btn-generate-translations")?.getAttribute("aria-busy") === "true"`, 10000);
    await waitForCondition(cdp, `document.getElementById("btn-generate-translations")?.getAttribute("aria-busy") !== "true"`, 30000);
    await waitForTranslationsReady(adminLogin.token, itemId, TARGET_LANGS, 30000);
    await waitForCondition(cdp, `document.querySelectorAll("#translation-summary .article-translation-row").length >= ${TARGET_LANGS.length}`, 15000);
    await waitForCondition(cdp, `Array.from(document.querySelectorAll("#translation-summary .article-translation-row span")).length >= ${TARGET_LANGS.length} && Array.from(document.querySelectorAll("#translation-summary .article-translation-row span")).every((node) => node.classList.contains("ok"))`, 15000);
    await waitForCondition(cdp, `!document.getElementById("btn-approve-sync")?.disabled`, 10000);

    await evaluate(cdp, `(() => {
      const row = document.querySelector('#translation-summary [data-translation-detail="en"]');
      if (row) row.click();
      return true;
    })()`);
    await waitForCondition(cdp, `!document.getElementById("translation-detail-modal")?.classList.contains("hidden")`, 10000);
    await waitForCondition(cdp, `document.querySelectorAll("#translation-detail-body .translation-detail-item").length >= 5 && Boolean(document.querySelector("#translation-detail-body .translation-detail-item .ok"))`, 10000);
    await evaluate(cdp, 'document.getElementById("btn-close-translation-detail")?.click(); true;');
    await waitForCondition(cdp, `document.getElementById("translation-detail-modal")?.classList.contains("hidden")`, 10000);

    await evaluate(cdp, `(() => {
      const note = document.getElementById("review-note");
      if (note) {
        note.value = "browser smoke review approved";
        note.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    })()`);
    await evaluate(cdp, 'document.getElementById("btn-approve-sync")?.click(); true;');
    await waitForArticleProcessStatus(adminLogin.token, itemId, "ready_for_sync", 15000);
    await waitForCondition(cdp, `!document.getElementById("btn-send-main-site")?.disabled`, 10000);
    await evaluate(cdp, 'document.getElementById("btn-refresh-readiness")?.click(); true;');
    await waitForCondition(cdp, 'String(document.getElementById("sync-summary")?.textContent || "").length > 0', 20000);
    await evaluate(cdp, 'document.getElementById("btn-send-main-site")?.click(); true;');
    await waitForArticleProcessStatus(adminLogin.token, itemId, "submitted_for_admin_review", 30000);
    await openPageAs(cdp, adminLogin.token, `/article-submit.html?id=${itemId}`);
    await waitForCondition(cdp, `window.location.pathname.endsWith("/article-submit.html") && document.getElementById("btn-send-main-site")?.disabled === true`, 15000);
    await waitForCondition(cdp, `document.getElementById("btn-send-main-site")?.disabled === true`, 10000);

    const finalItem = await readItem(adminLogin.token, itemId);
    assert(String(finalItem?.workflow_status || "").trim().toLowerCase() === "approved", `final workflow_status should remain approved after admin-review submit: ${JSON.stringify(finalItem)}`);
    assert(String(finalItem?.production_state || "").trim().toLowerCase() === "submitted_for_admin_review", `final production_state should be submitted_for_admin_review: ${JSON.stringify(finalItem)}`);

    console.log(JSON.stringify({
      ok: true,
      base_url: BASE_URL,
      browser: browserPath,
      smoke_item_id: itemId,
      checks: {
        intake_queue_loaded: true,
        intake_assign_editor: true,
        workspace_loaded_as_editor: true,
        workspace_submit_review: true,
        review_generate_translations: true,
        review_approve_ready_for_sync: true,
        review_send_main_site: true,
        review_submit_persists_after_reload: true,
      },
    }, null, 2));
  } catch (err) {
    keepArtifacts = true;
    console.error(`smoke-article-flow-e2e-browser: FAILED - ${String(err?.message || err)}`);
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
      console.error(`smoke-article-flow-e2e-browser: backend stop issue - ${String(stopErr?.message || stopErr)}`);
      process.exitCode = 1;
    }
    if (!keepArtifacts) {
      await rmTempRoot();
    }
  }
}

main();
