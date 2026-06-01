import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { assertLoginRole, resolveSmokeActor } from "./shared-smoke-auth.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const TEMP_ROOT = path.join(CWD, "tmp-runtime-article-preview-sanitization-smoke");
const PORT = Number(process.env.SMOKE_LOCAL_PORT || 5099);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = Number(process.env.SMOKE_BROWSER_DEBUG_PORT || 9234);
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
  label: "preview sanitization browser smoke admin login",
  emailEnvKeys: ["COLLECTOR_SMOKE_ADMIN_EMAIL", "BACKEND_AUTH_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_SMOKE_ADMIN_PASSWORD", "BACKEND_AUTH_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_ADMIN_USER_ID", "COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_ADMIN_ROLE", "COLLECTOR_TEST_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_ADMIN_NAME", "COLLECTOR_TEST_USER_NAME"],
  defaultRole: "owner",
});
const EDITOR_AUTH = resolveSmokeActor({
  label: "preview sanitization browser smoke editor login",
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
    TRANSLATION_TARGET_LANGS: "",
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
      title: "Preview Sanitization Article",
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

async function uploadCoverAsset(token, itemId) {
  const formData = new FormData();
  formData.append("content_item_id", String(itemId));
  formData.append("role", "cover");
  formData.append("file", new Blob([Buffer.from(COVER_PNG_BASE64, "base64")], { type: "image/png" }), "preview-sanitization-cover.png");
  const response = await fetch(`${BASE_URL}/api/assets/upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  assert(response.ok, `upload cover failed: ${JSON.stringify(payload)}`);
  return payload;
}

async function assignEditor(token, itemId, assigneeUserId) {
  const result = await requestJson(`/api/items/${itemId}/article-editorial-assignments`, {
    method: "POST",
    token,
    body: {
      assignee_user_id: assigneeUserId,
      internal_note: "preview sanitization editorial assignment",
      replace_active: true,
    },
  });
  assert(result.response.ok, `assign editor failed: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function saveEditorWork(token, itemId) {
  const body = "<p>Initial preview sanitization seed</p>";
  const result = await requestJson(`/api/items/${itemId}/editor-work`, {
    method: "PUT",
    token,
    body: {
      item: {
        title: "Preview Sanitization Article",
        summary: "Preview sanitization smoke excerpt",
        slug: "preview-sanitization-article",
        meta_title: "Preview Sanitization Meta",
        meta_description: "Preview sanitization smoke meta description",
        description_clean: body,
        description_raw: body,
      },
      draft: {
        draft_title: "Preview Sanitization Article",
        excerpt: "Preview sanitization smoke excerpt",
        body,
        meta_title: "Preview Sanitization Meta",
        meta_description: "Preview sanitization smoke meta description",
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
  await waitForCondition(client, 'document.querySelectorAll("#article-process-bar .step").length === 3');
}

async function verifyPreviewSanitization(client) {
  const payload = [
    "<p>Smoke safe paragraph</p>",
    '<img src="https://example.com/preview-safe.jpg" alt="safe-image" onerror=alert(1)>',
    '<a href="javascript:alert(1)">bad link</a>',
    "<script>window.__xss = true;</script>",
    "<div>wrapped text</div>",
    '<iframe src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" onload=alert(1)></iframe>',
  ].join("");

  await evaluate(client, `(function () {
    const body = document.getElementById("article-body");
    body.value = ${JSON.stringify(payload)};
    body.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);

  await waitForCondition(client, 'String(document.querySelector("#article-preview .preview-body")?.innerHTML || "").length > 0', 10000);
  const result = await evaluate(client, `(() => {
    const root = document.querySelector("#article-preview .preview-body");
    const html = root?.innerHTML || "";
    const img = root?.querySelector("img");
    const iframe = root?.querySelector("iframe");
    return {
      html,
      containsScriptTag: /<script/i.test(html),
      containsEventHandler: /onerror=|onload=/i.test(html),
      containsJavascriptHref: /javascript:/i.test(html),
      wrappedVisible: /wrapped text/i.test(root?.textContent || ""),
      imageSrc: img?.getAttribute("src") || "",
      imageAlt: img?.getAttribute("alt") || "",
      iframeSrc: iframe?.getAttribute("src") || "",
      iframeHasLoading: iframe?.getAttribute("loading") || "",
      iframeHasAllowfullscreen: iframe?.hasAttribute("allowfullscreen") || false,
      anchorCount: root?.querySelectorAll("a").length || 0,
      badLinkTextVisible: /bad link/i.test(root?.textContent || ""),
    };
  })()`);

  assert(result?.containsScriptTag === false, `preview should strip script tags: ${JSON.stringify(result)}`);
  assert(result?.containsEventHandler === false, `preview should strip inline event handlers: ${JSON.stringify(result)}`);
  assert(result?.containsJavascriptHref === false, `preview should strip javascript urls: ${JSON.stringify(result)}`);
  assert(result?.wrappedVisible === true, `preview should preserve unwrapped text from unsupported tags: ${JSON.stringify(result)}`);
  assert(result?.imageSrc === "https://example.com/preview-safe.jpg", `preview should keep safe image src: ${JSON.stringify(result)}`);
  assert(result?.imageAlt === "safe-image", `preview should keep safe image alt: ${JSON.stringify(result)}`);
  assert(result?.iframeSrc === "https://www.youtube.com/embed/dQw4w9WgXcQ", `preview should normalize safe iframe src: ${JSON.stringify(result)}`);
  assert(result?.iframeHasLoading === "lazy", `preview should set iframe loading=lazy: ${JSON.stringify(result)}`);
  assert(result?.iframeHasAllowfullscreen === true, `preview should retain allowfullscreen on iframe: ${JSON.stringify(result)}`);
  assert(result?.anchorCount === 0, `preview should unwrap invalid javascript links instead of rendering anchors: ${JSON.stringify(result)}`);
  assert(result?.badLinkTextVisible === true, `preview should preserve invalid link text: ${JSON.stringify(result)}`);
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
    assertLoginRole(adminLogin, ["admin", "owner"], "preview sanitization browser smoke admin");
    assertLoginRole(editorLogin, ["editor"], "preview sanitization browser smoke editor");

    const item = await createItem(adminLogin.token);
    const itemId = Number(item?.id || 0);
    assert(itemId > 0, "item id missing");

    await assignEditor(adminLogin.token, itemId, editorId);
    await uploadCoverAsset(adminLogin.token, itemId);
    await saveEditorWork(editorLogin.token, itemId);

    browserHandle = startBrowser(browserPath);
    const wsUrl = await waitForBrowserWsUrl(browserHandle);
    cdp = await connectCdp(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    await openWorkspaceAs(cdp, editorLogin.token, itemId);
    await waitForCondition(cdp, 'String(document.getElementById("workspace-auth-status")?.textContent || "").includes("(editor)")');
    await verifyPreviewSanitization(cdp);

    console.log(JSON.stringify({
      ok: true,
      base_url: BASE_URL,
      browser: browserPath,
      smoke_item_id: itemId,
      checks: {
        editor_workspace_loaded: true,
        preview_sanitization: true,
      },
    }, null, 2));
  } catch (err) {
    keepArtifacts = true;
    console.error(`smoke-article-preview-sanitization-browser: FAILED - ${String(err?.message || err)}`);
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
      console.error(`smoke-article-preview-sanitization-browser: backend stop issue - ${String(stopErr?.message || stopErr)}`);
      process.exitCode = 1;
    }
    if (!keepArtifacts) {
      await rmTempRoot();
    }
  }
}

main();
