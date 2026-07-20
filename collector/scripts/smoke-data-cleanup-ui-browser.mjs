import "dotenv/config";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase } from "../db/client.mjs";
import { assertLoginRole, resolveSmokeActor } from "./shared-smoke-auth.mjs";

// Browser gate for root PROJECT_POLICY.md §3 Delete Tier Contract: smoke-data-cleanup.mjs proves the
// API tiers, this proves the Data Cleanup table actually renders them — that a confirm_required group
// is tickable per record, that Purge stays shut until every one is ticked, that an open assignment is
// one of those confirmable groups (naming its assignee) rather than a dead end, and that a hard_blocker
// offers no override at all and says why next to its disabled button.
// Runs against its own backend + temp DB, so it never touches real data.

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const TEMP_ROOT = path.join(CWD, "tmp-runtime-data-cleanup-ui-smoke");
const PORT = Number(process.env.SMOKE_LOCAL_PORT || 5103);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = Number(process.env.SMOKE_BROWSER_DEBUG_PORT || 9239);
const BROWSER_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const OWNER_AUTH = resolveSmokeActor({
  label: "data cleanup UI browser smoke owner login",
  emailEnvKeys: ["COLLECTOR_SMOKE_ADMIN_EMAIL", "BACKEND_AUTH_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_SMOKE_ADMIN_PASSWORD", "BACKEND_AUTH_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_ADMIN_USER_ID", "COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_ADMIN_ROLE", "COLLECTOR_TEST_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_ADMIN_NAME", "COLLECTOR_TEST_USER_NAME"],
  defaultRole: "owner",
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nowIso() {
  return new Date().toISOString();
}

function logStep(step, detail = "") {
  const suffix = String(detail || "").trim();
  console.error(`[${nowIso()}] smoke-data-cleanup-ui step=${step}${suffix ? ` ${suffix}` : ""}`);
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
    OPENAI_API_KEY: "",
  };
}

async function rmTempRoot() {
  await fs.rm(TEMP_ROOT, { recursive: true, force: true });
}

function runNode(args, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: CWD, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${String(chunk || "")}`.slice(-8000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk || "")}`.slice(-8000); });
    child.on("error", (err) => reject(new Error(`${label} failed to start: ${String(err?.message || err)}`)));
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${label} exited with code ${code}. stdout: ${stdout} stderr: ${stderr}`));
    });
  });
}

function startBackendReady(env) {
  const child = spawn(process.execPath, ["scripts/backend-ready.mjs"], { cwd: CWD, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdoutTail = "";
  let stderrTail = "";
  child.stdout.on("data", (chunk) => { stdoutTail = `${stdoutTail}${String(chunk || "")}`.slice(-8000); });
  child.stderr.on("data", (chunk) => { stderrTail = `${stderrTail}${String(chunk || "")}`.slice(-8000); });
  return { child, getOutput: () => ({ stdoutTail, stderrTail }) };
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
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function login(auth) {
  if (auth?.token) {
    const result = await requestJson("/api/auth/me", { token: auth.token });
    assert(result.response.ok, `token auth/me failed for ${String(auth?.email || "")}: ${JSON.stringify(result.payload)}`);
    return { token: auth.token, user: result.payload?.user || auth.user || null };
  }
  const result = await requestJson("/api/auth/login", {
    method: "POST",
    body: { email: auth?.email, password: auth?.password },
  });
  assert(result.response.ok, `login failed for ${String(auth?.email || "")}: ${JSON.stringify(result.payload)}`);
  assert(result.payload?.token, `login token missing for ${String(auth?.email || "")}`);
  return result.payload;
}

// Fixtures are written straight to the temp DB: there is no API that creates a soft-deleted item
// already carrying a curated field pack, which is exactly the state this gate needs.
function createDeletedItem(db, { titleSuffix, withFieldPack = false, withPublishedArticle = false, withAssignment = false, withApprovedContext = false }) {
  const uid = `smoke-cleanup-ui-${crypto.randomUUID()}`;
  const title = `Smoke Cleanup UI ${titleSuffix}`;
  const slug = `smoke-cleanup-ui-${titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
  const itemResult = db.prepare(`
    INSERT INTO content_items (
      item_uid, type, category, lang, title, normalized_title, slug, description_raw, workflow_status, is_deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(uid, "place", "attraction", "th", title, title.toLowerCase(), slug, "smoke cleanup ui fixture", "raw");
  const itemId = Number(itemResult.lastInsertRowid || 0) || 0;
  assert(itemId > 0, `failed to create deleted item for ${titleSuffix}`);

  if (withFieldPack) {
    db.prepare(`
      INSERT INTO field_packs (
        content_item_id, status, is_current, ai_summary, ai_highlights_json, ai_unknowns_json,
        verified_facts_json, uncertain_facts_json, social_shot_emphasis_json, social_on_camera_points_json, updated_by
      ) VALUES (?, ?, 1, ?, '[]', '[]', '[]', '[]', '[]', '[]', ?)
    `).run(itemId, "ready_for_field", `Smoke field pack for ${titleSuffix}`, "smoke-data-cleanup-ui");
  }
  if (withAssignment) {
    db.prepare(`
      INSERT INTO content_assignments (assignment_uid, content_item_id, assignee_name, state)
      VALUES (?, ?, ?, ?)
    `).run(`smoke-ui-assignment-${crypto.randomUUID()}`, itemId, "Smoke Assignee", "assigned");
  }
  if (withPublishedArticle) {
    db.prepare(`
      INSERT INTO published_articles (
        content_item_id, slug, title, body, excerpt, meta_title, meta_description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, `${slug}-published`, title, `Published body for ${titleSuffix}`, `Published excerpt for ${titleSuffix}`, title, "smoke", "published");
  }
  if (withApprovedContext) {
    const evidenceId = Number(db.prepare(`
      INSERT INTO evidence_blocks (content_item_id, block_type, text_value, status)
      VALUES (?, ?, ?, ?)
    `).run(itemId, "fact", "Smoke evidence", "active").lastInsertRowid || 0) || 0;
    db.prepare(`
      INSERT INTO approved_context_blocks (content_item_id, evidence_block_id, selected_text, status, approved_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(itemId, evidenceId, "Smoke approved context", "active", "smoke-data-cleanup-ui@example.com");
  }
  return { id: itemId };
}

function resolveBrowserPath() {
  return BROWSER_PATHS.find((browserPath) => browserPath && fsSync.existsSync(browserPath)) || "";
}

function startBrowser(browserPath) {
  const child = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${path.join(TEMP_ROOT, "browser-profile")}`,
    "--window-size=1440,960",
    "about:blank",
  ], { cwd: CWD, stdio: ["ignore", "pipe", "pipe"] });
  let stderrTail = "";
  child.stderr.on("data", (chunk) => { stderrTail = `${stderrTail}${String(chunk || "")}`.slice(-8000); });
  return { child, getOutput: () => ({ stderrTail }) };
}

async function stopBrowser(handle) {
  if (!handle?.child) return;
  handle.child.kill();
  const startedAt = Date.now();
  while (handle.child.exitCode == null && Date.now() - startedAt < 5000) {
    await delay(100);
  }
  if (handle.child.exitCode == null) handle.child.kill("SIGKILL");
}

async function waitForBrowserWsUrl(handle, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (handle.child.exitCode != null) {
      throw new Error(`browser exited early with code ${handle.child.exitCode}. stderr: ${handle.getOutput().stderrTail}`);
    }
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = Array.isArray(list) ? list.find((entry) => String(entry?.type || "") === "page" && entry?.webSocketDebuggerUrl) : null;
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await delay(250);
  }
  throw new Error(`browser debug endpoint timeout. stderr: ${handle.getOutput().stderrTail}`);
}

async function connectCdp(wsUrl) {
  assert(typeof WebSocket === "function", "global WebSocket is not available in this Node runtime");
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (event) => reject(new Error(`cdp websocket failed: ${String(event?.message || "open error")}`)));
  });

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data || "{}"));
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || "CDP error"));
    else entry.resolve(message.result || {});
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  return { send, close: () => { try { ws.close(); } catch {} } };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result?.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails)}`);
  }
  return result?.result?.value;
}

async function waitForCondition(client, expression, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await evaluate(client, expression);
      if (value) return value;
    } catch (err) {
      lastError = String(err?.message || err);
    }
    await delay(250);
  }
  throw new Error(`condition timeout: ${expression}${lastError ? ` (last error: ${lastError})` : ""}`);
}

// window.confirm/prompt would block the CDP session forever, so they are stubbed before app.js runs
// and their text is captured instead — the purge confirm text is part of what this gate checks.
async function openPageAs(client, token, pathnameAndQuery) {
  const bootScript = `
    try { sessionStorage.setItem("collector_token", ${JSON.stringify(String(token || ""))}); } catch {}
    try { localStorage.setItem("collector_token", ${JSON.stringify(String(token || ""))}); } catch {}
    window.__smokeDialogs = [];
    window.confirm = (message) => { window.__smokeDialogs.push({ type: "confirm", message: String(message) }); return true; };
    window.prompt = (message) => { window.__smokeDialogs.push({ type: "prompt", message: String(message) }); return "data cleanup ui browser smoke"; };
    window.alert = (message) => { window.__smokeDialogs.push({ type: "alert", message: String(message) }); };
  `;
  if (client.__smokeBootScriptId) {
    await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: client.__smokeBootScriptId }).catch(() => {});
  }
  const result = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: bootScript });
  client.__smokeBootScriptId = result?.identifier || "";
  await client.send("Page.navigate", { url: `${BASE_URL}${pathnameAndQuery}` });
}

function purgeButtonSelector(itemId) {
  return `#table-data-cleanup tbody button[data-action="cleanup-purge"][data-id="${itemId}"]`;
}

async function main() {
  const env = buildEnv();
  const browserPath = resolveBrowserPath();
  assert(browserPath, "No Edge/Chrome executable found for browser smoke");

  await rmTempRoot();
  const backendHandle = startBackendReady(env);
  let browserHandle = null;
  let cdp = null;
  let db = null;
  const checks = {};

  try {
    logStep("backend.ready");
    await waitForHealth(backendHandle);

    logStep("auth.login");
    const ownerLogin = await login(OWNER_AUTH);
    assertLoginRole(ownerLogin, ["owner"], "data cleanup UI browser smoke owner");

    logStep("fixture.create");
    db = openDatabase(env.DB_PATH, path.join(CWD, "database", "schema.sql"));
    const confirmItem = createDeletedItem(db, { titleSuffix: "Confirm Required", withFieldPack: true });
    const hardItem = createDeletedItem(db, { titleSuffix: "Hard Blocked", withPublishedArticle: true });
    // The assignment family is confirm_required, not a hard blocker: this fixture is the browser-side
    // proof that an open assignment offers a tickable override naming the assignee, and purges once
    // ticked — the behaviour §3 changed to, and the reason both smoke scripts had to move together.
    const assignmentItem = createDeletedItem(db, { titleSuffix: "Assignment Confirm", withAssignment: true });
    const cascadeItem = createDeletedItem(db, { titleSuffix: "Cascade Guard", withApprovedContext: true });

    browserHandle = startBrowser(browserPath);
    cdp = await connectCdp(await waitForBrowserWsUrl(browserHandle));
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    logStep("panel.open");
    await openPageAs(cdp, ownerLogin.token, "/index.html?tab=users");
    await waitForCondition(cdp, '!document.getElementById("tab-users")?.classList.contains("hidden")', 20000);
    await evaluate(cdp, 'document.getElementById("tab-users")?.click(); true;');
    await waitForCondition(cdp, '!document.getElementById("data-cleanup-panel")?.classList.contains("hidden")', 15000);
    checks.panel_visible_for_owner = true;

    await evaluate(cdp, 'document.getElementById("btn-data-cleanup-toggle")?.click(); true;');
    await waitForCondition(cdp, '!document.getElementById("data-cleanup-body")?.classList.contains("hidden")', 10000);
    await evaluate(cdp, 'document.getElementById("btn-data-cleanup-load")?.click(); true;');
    await waitForCondition(cdp, `Boolean(document.querySelector('${purgeButtonSelector(confirmItem.id)}'))`, 15000);

    logStep("confirm.render");
    const confirmRow = await evaluate(cdp, `(() => {
      const tr = document.querySelector('${purgeButtonSelector(confirmItem.id)}')?.closest("tr");
      const boxes = Array.from(tr?.querySelectorAll('input[data-cleanup-confirm-item="${confirmItem.id}"]') || []);
      return {
        groups: boxes.map((box) => String(box.dataset.cleanupConfirmGroup || "")),
        label: boxes[0]?.closest("label")?.textContent.trim() || "",
        details: Array.from(tr?.querySelectorAll(".cleanup-confirm-group .muted") || []).map((node) => node.textContent.trim()),
        purge_disabled: Boolean(tr?.querySelector('button[data-action="cleanup-purge"]')?.disabled),
      };
    })()`);
    assert(confirmRow.groups.includes("field_packs"), `confirm_required checkbox missing for field_packs: ${JSON.stringify(confirmRow.groups)}`);
    assert(confirmRow.details.length >= 1, "confirm_required group must show per-record detail");
    assert(confirmRow.purge_disabled === true, "purge must stay disabled before every confirm group is ticked");
    checks.confirm_checkbox_rendered = confirmRow.groups;
    checks.confirm_detail_rendered = confirmRow.details;
    checks.confirm_label = confirmRow.label;
    checks.purge_disabled_before_tick = true;

    logStep("confirm.tick");
    await evaluate(cdp, `(() => {
      document.querySelectorAll('input[data-cleanup-confirm-item="${confirmItem.id}"]').forEach((box) => {
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return true;
    })()`);
    await waitForCondition(cdp, `!document.querySelector('${purgeButtonSelector(confirmItem.id)}')?.disabled`, 10000);
    checks.purge_enabled_after_tick = true;

    logStep("confirm.purge");
    await evaluate(cdp, `document.querySelector('${purgeButtonSelector(confirmItem.id)}')?.click(); true;`);
    await waitForCondition(cdp, `!document.querySelector('${purgeButtonSelector(confirmItem.id)}')`, 20000);
    checks.purged_row_gone = true;
    checks.purge_status_text = await evaluate(cdp, 'document.getElementById("data-cleanup-status")?.textContent.trim() || ""');

    const dialogs = await evaluate(cdp, "JSON.stringify(window.__smokeDialogs || [])");
    const confirmDialog = JSON.parse(dialogs).find((entry) => entry.type === "confirm");
    assert(confirmDialog, "purge must ask for confirmation before destroying data");
    assert(
      confirmDialog.message.includes("field_packs"),
      `purge confirm must name the overridden groups: ${JSON.stringify(confirmDialog)}`
    );
    checks.purge_confirm_names_overrides = confirmDialog.message;

    logStep("purge.audit");
    const auditRow = db.prepare(
      "SELECT details_json FROM audit_logs WHERE action='item.purge' AND CAST(target_id AS INTEGER)=? ORDER BY id DESC LIMIT 1"
    ).get(confirmItem.id);
    assert(auditRow, `item.purge audit row missing for item ${confirmItem.id}. audit_logs=${JSON.stringify(db.prepare("SELECT action, target_type, target_id FROM audit_logs ORDER BY id DESC LIMIT 10").all())}`);
    const auditDetails = JSON.parse(auditRow.details_json || "{}");
    const overrides = Array.isArray(auditDetails?.confirmed_overrides) ? auditDetails.confirmed_overrides : [];
    assert(
      overrides.some((group) => String(group?.key || "") === "field_packs"),
      `audit must record the overridden group: ${JSON.stringify(auditDetails)}`
    );
    assert(
      overrides.every((group) => String(group?.confirm_reason_th || "").trim()),
      `audit must record why confirmation was required: ${JSON.stringify(overrides)}`
    );
    assert(
      overrides.every((group) => Array.isArray(group?.confirm_details) && group.confirm_details.length > 0),
      `audit must record per-record detail: ${JSON.stringify(overrides)}`
    );
    checks.audit_recorded_overrides = overrides.map((group) => group.key);

    logStep("hard.blocked");
    const hardRow = await evaluate(cdp, `(() => {
      const button = document.querySelector('${purgeButtonSelector(hardItem.id)}');
      const tr = button?.closest("tr");
      return {
        present: Boolean(button),
        disabled: Boolean(button?.disabled),
        blocker_text: tr?.children[4]?.textContent.trim() || "",
        action_text: tr?.children[5]?.textContent.trim() || "",
        checkbox_count: (tr?.querySelectorAll('input[type="checkbox"]') || []).length,
      };
    })()`);
    assert(hardRow.present, "hard-blocked row missing from the table");
    assert(hardRow.disabled === true, "hard_blocker purge button must stay disabled");
    assert(hardRow.checkbox_count === 0, "hard_blocker must not offer a confirmation checkbox");
    // A disabled button with no stated reason is the bug this asserts against: the def's Thai hint must
    // be on screen next to the button, not only in a tooltip or in the blockers column.
    assert(
      hardRow.action_text.includes("Purge ไม่ได้") && hardRow.action_text.includes("unpublish"),
      `disabled Purge must state the hard blocker's remediation: ${JSON.stringify(hardRow.action_text)}`
    );
    checks.hard_blocked_disabled = true;
    checks.hard_blocker_text = hardRow.blocker_text;
    checks.hard_blocked_reason_text = hardRow.action_text;

    logStep("assignment.confirm");
    const assignmentRow = await evaluate(cdp, `(() => {
      const tr = document.querySelector('${purgeButtonSelector(assignmentItem.id)}')?.closest("tr");
      const boxes = Array.from(tr?.querySelectorAll('input[data-cleanup-confirm-item="${assignmentItem.id}"]') || []);
      return {
        groups: boxes.map((box) => String(box.dataset.cleanupConfirmGroup || "")),
        details: Array.from(tr?.querySelectorAll(".cleanup-confirm-group .muted") || []).map((node) => node.textContent.trim()),
        purge_disabled: Boolean(tr?.querySelector('button[data-action="cleanup-purge"]')?.disabled),
      };
    })()`);
    assert(
      assignmentRow.groups.includes("assignments"),
      `open assignment must offer a confirm checkbox, not a hard block: ${JSON.stringify(assignmentRow.groups)}`
    );
    assert(assignmentRow.purge_disabled === true, "assignment purge must stay disabled before the tick");
    assert(
      assignmentRow.details.some((line) => line.includes("Smoke Assignee")),
      `assignment detail must name whose work is being destroyed: ${JSON.stringify(assignmentRow.details)}`
    );
    checks.assignment_confirm_checkbox_rendered = assignmentRow.groups;
    checks.assignment_detail_rendered = assignmentRow.details;

    await evaluate(cdp, `(() => {
      document.querySelectorAll('input[data-cleanup-confirm-item="${assignmentItem.id}"]').forEach((box) => {
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return true;
    })()`);
    await waitForCondition(cdp, `!document.querySelector('${purgeButtonSelector(assignmentItem.id)}')?.disabled`, 10000);
    await evaluate(cdp, `document.querySelector('${purgeButtonSelector(assignmentItem.id)}')?.click(); true;`);
    await waitForCondition(cdp, `!document.querySelector('${purgeButtonSelector(assignmentItem.id)}')`, 20000);
    checks.assignment_purged_after_confirm = true;

    const assignmentAudit = db.prepare(
      "SELECT details_json FROM audit_logs WHERE action='item.purge' AND CAST(target_id AS INTEGER)=? ORDER BY id DESC LIMIT 1"
    ).get(assignmentItem.id);
    assert(assignmentAudit, `item.purge audit row missing for assignment item ${assignmentItem.id}`);
    const assignmentOverrides = JSON.parse(assignmentAudit.details_json || "{}")?.confirmed_overrides || [];
    assert(
      assignmentOverrides.some((group) => String(group?.key || "") === "assignments"),
      `audit must record the assignment override: ${JSON.stringify(assignmentOverrides)}`
    );
    checks.assignment_audit_recorded_override = true;

    const cascadeReferences = await requestJson(`/api/admin/deleted-items/${cascadeItem.id}/references`, { token: ownerLogin.token });
    assert(cascadeReferences.response.ok, "cascade guard references request failed");
    assert(!(cascadeReferences.payload?.groups || []).some((row) => row?.key === "evidence_blocks"), "browser smoke: evidence must not be a SAFE cleanup candidate");
    assert((cascadeReferences.payload?.safe_sweep_skipped || []).some((row) => row?.key === "evidence_blocks"), "browser smoke: cascade skip hint missing");
    checks.cascade_guard_skip_hint = true;

    console.log(JSON.stringify({
      ok: true,
      fixtures: {
        confirm_required_item_id: confirmItem.id,
        hard_blocked_item_id: hardItem.id,
        assignment_confirm_item_id: assignmentItem.id,
        cascade_guard_item_id: cascadeItem.id,
      },
      checks,
    }, null, 2));
  } finally {
    if (cdp) cdp.close();
    await stopBrowser(browserHandle);
    await stopBackend(env, backendHandle);
    try { db?.close?.(); } catch {}
    // The backend releases its own sqlite handle only once the process is fully gone.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await rmTempRoot();
        break;
      } catch (err) {
        if (attempt === 5) throw err;
        await delay(500);
      }
    }
  }
}

main().catch((err) => {
  console.error(`smoke-data-cleanup-ui: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
