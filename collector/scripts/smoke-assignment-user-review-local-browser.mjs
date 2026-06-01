import "dotenv/config";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolveSmokeActor, assertLoginRole } from "./shared-smoke-auth.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const dirs = resolvePaths(CWD);
const schemaPath = path.join(dirs.rootDir, "database", "schema.sql");
const BASE_URL = String(process.env.SMOKE_LOCAL_BASE_URL || "http://127.0.0.1:5062").replace(/\/+$/, "");
const DEBUG_PORT = Number(process.env.SMOKE_BROWSER_DEBUG_PORT || 9235);
const BROWSER_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const OWNER_ACTOR = resolveSmokeActor({
  label: "assignment local browser smoke owner",
  emailEnvKeys: ["COLLECTOR_ASSIGNMENT_SMOKE_OWNER_EMAIL", "BACKEND_AUTH_EMAIL", "COLLECTOR_SMOKE_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_ASSIGNMENT_SMOKE_OWNER_PASSWORD", "BACKEND_AUTH_PASSWORD", "COLLECTOR_SMOKE_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_USER_NAME"],
  defaultRole: "owner",
});
const USER_ACTOR = resolveSmokeActor({
  label: "assignment local browser smoke user",
  emailEnvKeys: ["COLLECTOR_ASSIGNMENT_SMOKE_USER_EMAIL", "COLLECTOR_SMOKE_USER_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_ASSIGNMENT_SMOKE_USER_PASSWORD", "COLLECTOR_SMOKE_USER_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_REVIEW_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_REVIEW_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_REVIEW_USER_NAME"],
  defaultRole: "user",
});
const ASSIGNMENT_MARKER = "manual-smoke-live-assignment-user-review";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveBrowserPath() {
  return BROWSER_PATHS.find((browserPath) => browserPath && fsSync.existsSync(browserPath)) || "";
}

function openRepo() {
  const db = openDatabase(dirs.dbPath, schemaPath);
  return { db, repo: createRepository(db) };
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

async function login(actor) {
  if (actor?.token) {
    const result = await requestJson("/api/auth/me", { token: actor.token });
    assert(result.response.ok, `token auth/me failed for ${String(actor?.email || "")}: ${JSON.stringify(result.payload)}`);
    return {
      token: actor.token,
      user: result.payload?.user || actor.user || null,
    };
  }
  const result = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email: actor?.email, password: actor?.password },
  });
  assert(result.response.ok, `login failed for ${String(actor?.email || "")}: ${JSON.stringify(result.payload)}`);
  assert(result.payload?.token, `login token missing for ${String(actor?.email || "")}`);
  return result.payload;
}

function ensureSmokeItemAndExternalAssignment(userId, ownerEmail) {
  const { db, repo } = openRepo();
  try {
    const itemMarker = Date.now();
    const saved = repo.saveItemWithFieldPack(
      {
        type: "place",
        category: "attractions",
        lang: "th",
        title: `Manual Smoke Assignment Flow ${itemMarker}`,
        slug: `manual-smoke-assignment-flow-${itemMarker}`,
        summary: "รายการทดสอบ live local app สำหรับ flow user submit และ review external assignment",
        description_raw: "manual smoke local app assignment flow",
        description_clean: "manual smoke local app assignment flow",
        meta_title: "Manual Smoke Assignment Flow",
        meta_description: "ใช้ยืนยันว่า user ส่งงานแทน external และรับงานผ่านได้",
        workflow_status: "content_in_progress",
      },
      {
        status: "ready_for_field",
        is_current: 1,
        editor_summary: "field pack สำหรับ manual smoke assignment flow",
        verified_facts: ["ยืนยันชื่อสถานที่", "ยืนยันเวลาเปิด-ปิด"],
        story_angle: "ใช้ตรวจว่าผู้ดูแลใส่ข้อมูลแทน external worker และรับงานผ่านได้",
        field_notes: "ข้อมูล mock สำหรับ live smoke",
        social_hook: "manual smoke",
        field_pack_checklists: [
          { checklist_type: "must_verify_fact", item_text: "ยืนยันชื่อสถานที่", status: "todo", item_order: 0 },
          { checklist_type: "must_ask_question", item_text: "ถามเวลาเปิด-ปิด", status: "todo", item_order: 1 },
        ],
      },
      ownerEmail
    );

    const itemId = Number(saved?.item?.id || 0) || 0;
    assert(itemId > 0, "smoke item id missing");
    repo.backfillWorkflowHeads(ownerEmail);
    repo.ensureWorkflowModel(itemId);

    const assignment = repo.createAssignment(
      {
        content_item_id: itemId,
        assignment_kind: "field",
        assignee_name: "External Manual Smoke Worker",
        assignee_contact: "@manual-smoke-worker",
        external_assignee_profile_json: {
          name: "External Manual Smoke Worker",
          line_id: "@manual-smoke-worker",
        },
        state: "assigned",
        brief_json: {
          expected_deliverables: ["raw_notes"],
          captures: ["ภาพรวมสถานที่", "บรรยากาศภายใน"],
          questions: ["เวลาเปิด-ปิดคือกี่โมง"],
          verified_facts: ["ยืนยันชื่อสถานที่", "ยืนยันเวลาเปิด-ปิด"],
        },
        requirements_json: {
          expected_deliverables: ["raw_notes"],
        },
        contributor_note: "manual smoke external assignment",
        internal_note: `${ASSIGNMENT_MARKER} | created ${new Date().toISOString()}`,
      },
      Number(userId || 0),
      {
        actor_email: ownerEmail,
        actor_role: "owner",
        reason_code: "manual_smoke_assignment_created",
        note: ASSIGNMENT_MARKER,
      }
    );

    const assignmentId = Number(assignment?.id || 0) || 0;
    assert(assignmentId > 0, "smoke assignment id missing");
    return { itemId, assignmentId };
  } finally {
    db.close();
  }
}

function startBrowser(browserPath) {
  const userDataDir = path.join(CWD, "tmp-runtime-assignment-local-browser-profile");
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

async function loginThroughUi(client, email, password, pathnameAndQuery = "/") {
  await navigate(client, `${BASE_URL}${pathnameAndQuery}`);
  await waitForCondition(client, 'Boolean(document.getElementById("btn-login"))', 15000);
  await evaluate(
    client,
    `(() => {
      const emailInput = document.getElementById("auth-email");
      const passwordInput = document.getElementById("auth-password");
      const loginButton = document.getElementById("btn-login");
      if (!emailInput || !passwordInput || !loginButton) return false;
      emailInput.value = ${JSON.stringify(email)};
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      passwordInput.value = ${JSON.stringify(password)};
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
      loginButton.click();
      return true;
    })()`
  );
  await waitForCondition(
    client,
    'document.body.classList.contains("is-authenticated") && !String(document.getElementById("auth-status")?.textContent || "").includes("ยังไม่ได้เข้าสู่ระบบ")',
    20000
  );
}

async function openAuthenticatedRoute(client, pathnameAndQuery) {
  await navigate(client, `${BASE_URL}${pathnameAndQuery}`);
  await waitForCondition(
    client,
    'document.body.classList.contains("is-authenticated") && !String(document.getElementById("auth-status")?.textContent || "").includes("ยังไม่ได้เข้าสู่ระบบ")',
    15000
  );
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
  await waitForCondition(
    client,
    'document.body.classList.contains("is-authenticated") && Boolean(sessionStorage.getItem("collector_token"))',
    20000
  );
}

async function readAssignmentState(token, assignmentId) {
  const result = await requestJson(`/api/assignments/${assignmentId}`, { token });
  assert(result.response.ok, `fetch assignment failed: ${JSON.stringify(result.payload)}`);
  return result.payload?.assignment || null;
}

async function main() {
  const browserPath = resolveBrowserPath();
  assert(browserPath, "No Edge/Chrome executable found for browser smoke");

  const health = await requestJson("/api/health");
  assert(health.response.ok && health.payload?.ok === true, `collector app is not healthy at ${BASE_URL}`);

  const ownerLogin = await login(OWNER_ACTOR);
  const userLogin = await login(USER_ACTOR);
  assertLoginRole(ownerLogin, ["owner", "admin"], "owner/admin");
  assertLoginRole(userLogin, ["user"], "user");
  const smokeUserId = Number(userLogin?.user?.id || 0) || 0;
  assert(smokeUserId > 0, `collector-projected user id missing: ${JSON.stringify(userLogin?.user || null)}`);
  const seeded = ensureSmokeItemAndExternalAssignment(smokeUserId, String(ownerLogin?.user?.email || OWNER_ACTOR?.email || ""));
  const actionableAssignments = await requestJson("/api/assignments/mine?scope=actionable&limit=50", { token: userLogin.token });
  assert(actionableAssignments.response.ok, `fetch actionable assignments failed: ${JSON.stringify(actionableAssignments.payload)}`);
  assert(
    Array.isArray(actionableAssignments.payload?.assignments)
      && actionableAssignments.payload.assignments.some((row) => Number(row?.id || 0) === seeded.assignmentId),
    `seeded assignment ${seeded.assignmentId} should appear in actionable assignments: ${JSON.stringify(actionableAssignments.payload)}`
  );

  let browserHandle = null;
  let cdp = null;
  try {
    browserHandle = startBrowser(browserPath);
    const wsUrl = await waitForBrowserWsUrl(browserHandle);
    cdp = await connectCdp(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    await openPageAs(cdp, userLogin.token, `/?tab=handoff&item_id=${seeded.itemId}`);
    await waitForCondition(cdp, 'window.location.search.includes("tab=handoff")', 15000);
    await waitForCondition(
      cdp,
      `String(document.getElementById("auth-status")?.textContent || "").includes(${JSON.stringify(String(userLogin?.user?.email || USER_ACTOR?.email || ""))})`,
      15000
    );
    const handoffSnapshot = await evaluate(cdp, `(() => ({
      href: window.location.href,
      auth: document.getElementById("auth-status")?.textContent || "",
      listTitle: document.getElementById("assignment-list-title")?.textContent || "",
      loginVisible: !document.body.classList.contains("is-authenticated")
    }))()`);
    assert(handoffSnapshot?.loginVisible === false, `handoff route should stay authenticated: ${JSON.stringify(handoffSnapshot)}`);

    await openPageAs(
      cdp,
      userLogin.token,
      `/?tab=work&assignment_id=${seeded.assignmentId}&item_id=${seeded.itemId}`
    );
    await waitForCondition(cdp, 'document.querySelectorAll("#assignment-process-steps .step").length === 3');
    await waitForCondition(cdp, `String(document.getElementById("auth-status")?.textContent || "").length > 0`, 15000);
    await evaluate(cdp, 'document.getElementById("btn-assignments-load")?.click(); true;');
    await waitForCondition(
      cdp,
      `Boolean(document.querySelector('#table-assignments tbody button[data-action="open-assignment"][data-id="${seeded.assignmentId}"]'))`,
      20000
    );
    await evaluate(
      cdp,
      `document.querySelector('#table-assignments tbody button[data-action="open-assignment"][data-id="${seeded.assignmentId}"]')?.click() || true;`
    );
    await waitForCondition(
      cdp,
      `String(document.getElementById("assignment-selected-summary")?.textContent || "").includes("${seeded.assignmentId}")`,
      10000
    );
    await waitForCondition(cdp, `Boolean(document.getElementById("btn-assignment-submit"))`, 10000);

    const workSnapshot = await evaluate(cdp, `(() => ({
      href: window.location.href,
      auth: document.getElementById("auth-status")?.textContent || "",
      summary: document.getElementById("assignment-selected-summary")?.textContent || "",
      status: document.getElementById("assignment-status")?.textContent || "",
      submitDisabled: Boolean(document.getElementById("btn-assignment-submit")?.disabled),
      verifiedInputs: document.querySelectorAll("#assignment-submission-verified-fields textarea, #assignment-submission-verified-fields input").length,
      questionInputs: document.querySelectorAll("#assignment-submission-question-fields textarea, #assignment-submission-question-fields input").length
    }))()`);
    assert(workSnapshot?.submitDisabled === false, `submit should be enabled for user-managed external assignment: ${JSON.stringify(workSnapshot)}`);

    await evaluate(cdp, `(() => {
      const verified = document.querySelector("#assignment-submission-verified-fields textarea, #assignment-submission-verified-fields input");
      if (verified) {
        verified.value = "manual smoke verified";
        verified.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const question = document.querySelector("#assignment-submission-question-fields textarea, #assignment-submission-question-fields input");
      if (question) {
        question.value = "manual smoke answer";
        question.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const additional = document.getElementById("assignment-submission-additional-text");
      if (additional) {
        additional.value = "manual smoke additional text";
        additional.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    })()`);

    await evaluate(cdp, 'document.getElementById("btn-assignment-submit")?.click(); true;');
    await waitForCondition(cdp, 'window.location.search.includes("tab=review")', 20000);
    await waitForCondition(cdp, `window.location.search.includes("assignment_id=${seeded.assignmentId}")`, 10000);
    await waitForCondition(cdp, '!document.getElementById("btn-assignment-accept-submission")?.disabled', 20000);

    const reviewSnapshot = await evaluate(cdp, `(() => ({
      href: window.location.href,
      reviewText: document.getElementById("assignment-review-workspace-help")?.textContent || "",
      acceptDisabled: Boolean(document.getElementById("btn-assignment-accept-submission")?.disabled),
      requestRevisionDisabled: Boolean(document.getElementById("btn-assignment-request-revision")?.disabled)
    }))()`);
    assert(reviewSnapshot?.acceptDisabled === false, `accept should be enabled on review page: ${JSON.stringify(reviewSnapshot)}`);

    await evaluate(cdp, `(() => {
      const note = document.getElementById("assignment-review-note");
      if (note) {
        note.value = "manual smoke accept";
        note.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    })()`);
    await evaluate(cdp, 'document.getElementById("btn-assignment-accept-submission")?.click(); true;');
    await waitForCondition(cdp, 'String(document.getElementById("assignment-status")?.textContent || "").includes("รับงาน")', 20000);

    const finalAssignment = await readAssignmentState(userLogin.token, seeded.assignmentId);
    assert(String(finalAssignment?.state || "").trim().toLowerCase() === "accepted", `assignment should be accepted after review: ${JSON.stringify(finalAssignment)}`);
    assert(Number(finalAssignment?.assigned_by_user_id || 0) === smokeUserId, `assignment assigner should remain smoke user: ${JSON.stringify(finalAssignment)}`);

    console.log(JSON.stringify({
      ok: true,
      base_url: BASE_URL,
      browser: browserPath,
      db_path: dirs.dbPath,
      smoke_user_email: String(userLogin?.user?.email || USER_ACTOR?.email || ""),
      item_id: seeded.itemId,
      assignment_id: seeded.assignmentId,
      checks: {
        handoff_route_loaded_after_login: true,
        work_page_loaded: true,
        user_submit_external_assignment: true,
        redirect_to_review: true,
        user_accept_submission: true,
      },
    }, null, 2));
  } catch (err) {
    const runtimeErrors = cdp?.drain?.("Runtime.exceptionThrown") || [];
    const consoleCalls = cdp?.drain?.("Runtime.consoleAPICalled") || [];
    const loadingFailed = cdp?.drain?.("Network.loadingFailed") || [];
    console.error(`smoke-assignment-user-review-local-browser: FAILED - ${String(err?.message || err)}`);
    console.error(`runtime_errors=${JSON.stringify(runtimeErrors)}`);
    console.error(`console=${JSON.stringify(consoleCalls)}`);
    console.error(`loading_failed=${JSON.stringify(loadingFailed)}`);
    process.exitCode = 1;
  } finally {
    if (cdp) {
      await cdp.close().catch(() => {});
    }
    if (browserHandle) {
      await stopBrowser(browserHandle).catch(() => {});
    }
  }
}

main();
